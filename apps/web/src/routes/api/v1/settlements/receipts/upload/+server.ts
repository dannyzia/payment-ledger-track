import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import {
  validateReceiptUpload,
  detectMagicBytes,
  MAX_RECEIPT_FILE_SIZE,
} from '$lib/settlements/receipt-validation';

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }),
      { status: 403 },
    );
  }

  // Fast-fail on Content-Length header before reading large buffer into memory
  const contentLength = event.request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RECEIPT_FILE_SIZE) {
    return new Response(
      JSON.stringify({ error: 'payload_too_large', message: 'File exceeds 5 MB limit' }),
      { status: 413 },
    );
  }

  const formData = await event.request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'missing_file', message: 'File is required' }), {
      status: 400,
    });
  }

  const validation = validateReceiptUpload(file.size, file.type);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: validation.statusCode ?? 400,
    });
  }

  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Binary magic-byte inspection preventing extension and MIME spoofing attacks
  const magic = detectMagicBytes(uint8);
  if (!magic) {
    return new Response(
      JSON.stringify({
        error: 'invalid_file_signature',
        message: 'Binary signature does not match allowed types (PNG, JPEG, WebP, PDF)',
      }),
      { status: 415 },
    );
  }

  const supabase = getServiceSupabase();

  // Ensure private receipts bucket exists in storage
  const { data: bucket } = await supabase.storage.getBucket('receipts');
  if (!bucket) {
    await supabase.storage.createBucket('receipts', { public: false });
  }

  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
    .format(new Date())
    .slice(0, 7);
  const path = `receipts/${month}/${crypto.randomUUID()}.${magic.ext}`;

  const { error: uploadError } = await supabase.storage.from('receipts').upload(path, arrayBuffer, {
    contentType: magic.mime,
    upsert: false,
  });

  if (uploadError) {
    return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ path }), { status: 200 });
};
