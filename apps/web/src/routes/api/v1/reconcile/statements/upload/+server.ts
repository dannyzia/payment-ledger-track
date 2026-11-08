import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { createHash } from 'crypto';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { bkashCsvAdapter } from '$lib/server/reconcile/adapters/bkash-csv';
import { cardCombinedCsvAdapter } from '$lib/server/reconcile/adapters/card-combined-csv';
import type { StatementAdapter, ParsedStatement } from '$lib/server/reconcile/adapters/types';

const ALLOWED_MIME_TYPES = [
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/pdf',
];

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  // Enforce 10 MB maximum payload check before processing
  const contentLength = event.request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
    throw error(413, 'payload_too_large: File exceeds 10 MB limit');
  }

  const formData = await event.request.formData().catch(() => null);
  if (!formData) {
    throw error(400, 'invalid_form_data');
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    throw error(400, 'missing_file');
  }

  if (file.size > 10 * 1024 * 1024) {
    throw error(413, 'payload_too_large: File exceeds 10 MB limit');
  }

  const mimeType = (file.type || '').toLowerCase();
  if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw error(415, `unsupported_media_type: ${mimeType}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Compute 64-character SHA-256 hex digest
  const fileSha256 = createHash('sha256').update(buffer).digest('hex');

  // Adapter selection: inspect headers via accepts() or resolve explicit adapterId
  const explicitAdapterId = formData.get('adapterId')?.toString();
  let adapter: StatementAdapter | null = null;

  if (explicitAdapterId) {
    if (explicitAdapterId === bkashCsvAdapter.id) adapter = bkashCsvAdapter;
    else if (explicitAdapterId === cardCombinedCsvAdapter.id) adapter = cardCombinedCsvAdapter;
  }

  if (!adapter) {
    if (bkashCsvAdapter.accepts(buffer, mimeType)) {
      adapter = bkashCsvAdapter;
    } else if (cardCombinedCsvAdapter.accepts(buffer, mimeType)) {
      adapter = cardCombinedCsvAdapter;
    }
  }

  if (!adapter) {
    throw error(422, 'no_matching_adapter: Unable to identify statement format from headers');
  }

  // Parse statement lines server-side under service_role
  let parsed: ParsedStatement;
  try {
    parsed = await adapter.parse(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error parsing statement file';
    throw error(422, `parse_failed: ${message || 'Error parsing statement file'}`);
  }

  const supabase = getServiceSupabase();

  // Ensure private statements storage bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === 'statements')) {
    await supabase.storage.createBucket('statements', { public: false });
  }

  // Extract and validate month prefix for partition path (e.g. '2026-03')
  const monthParam = formData.get('month')?.toString();
  if (monthParam && !/^\d{4}-\d{2}(-01)?$/.test(monthParam)) {
    throw error(400, 'invalid_month_format: Expected YYYY-MM or YYYY-MM-01');
  }
  const monthPrefix = monthParam ? monthParam.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const storagePath = `statements/${monthPrefix}/${fileSha256}`;

  // Stream file directly to Supabase private storage
  const { error: uploadErr } = await supabase.storage
    .from('statements')
    .upload(storagePath, buffer, {
      contentType: file.type || 'text/csv',
      upsert: true,
    });

  if (uploadErr) {
    throw error(500, `storage_upload_failed: ${uploadErr.message}`);
  }

  return json({
    path: storagePath,
    fileSha256,
    linesCount: parsed.lines.length,
    parsedLines: parsed.lines.map((l) => ({
      lineIndex: l.lineIndex,
      lineDate: l.date,
      reference: l.reference,
      grossPoisha: l.grossPoisha ? l.grossPoisha.toString() : '0',
      feePoisha: l.feePoisha ? l.feePoisha.toString() : '0',
      raw: l.raw,
    })),
    detectedAdapter: adapter.id,
    previewSummary: {
      totalGrossPoisha: parsed.summary.totalGrossPoisha.toString(),
      totalFeePoisha: parsed.summary.totalFeePoisha.toString(),
      linesCount: parsed.summary.linesCount,
      minDate: parsed.summary.minDate,
      maxDate: parsed.summary.maxDate,
    },
  });
};
