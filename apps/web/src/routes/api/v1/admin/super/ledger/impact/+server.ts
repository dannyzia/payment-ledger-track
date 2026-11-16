import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { previewEntryImpact } from '$lib/server/impact-preview';

/**
 * POST /api/v1/admin/super/ledger/impact — Plan 023 step 10.
 *
 * Read-only preview of a proposed void or supersede, plus the `dataVersion` that binds
 * it to the data it describes. It writes nothing: the apply routes (step 11) recompute
 * the version inside the transaction that takes the month lock and refuse a mismatch
 * with `409 stale_preview`.
 *
 * The scope is one center and derived from the entry itself, so a preview cannot be
 * asked for across centers and a cross-center entry id simply is not found.
 */

const bodySchema = z.object({
  centerId: z.string().uuid('centerId must be a uuid'),
  entryId: z.string().uuid('entryId must be a uuid'),
  action: z.enum(['void', 'supersede']),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'ledger.read_all');

  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_body', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const preview = await previewEntryImpact(getDbPool(), parsed.data);
  if (!preview) {
    return new Response(
      JSON.stringify({
        error: 'entry_not_found',
        message: 'no entry with that id in the named center',
      }),
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return new Response(JSON.stringify({ dataVersion: preview.dataVersion, preview }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
};
