import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { formatEntryId } from '@clt/shared';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { previewEntryImpact } from '$lib/server/impact-preview';

/**
 * POST /api/v1/admin/super/ledger/purge/impact — Plan 023 step 13.
 *
 * Read-only preview for the guarded purge: the entry, what its removal does to the
 * month's settlements, and every reason the purge would refuse. It also returns the
 * display id the caller must type back, so the route that executes cannot be driven by
 * an id pasted from an error message.
 *
 * The purge recomputes settlements with the same routine a void uses
 * (`generate_monthly_settlements`), so the preview borrows the void impact rather than
 * inventing a second arithmetic path. The `blockers` array is the RPC's own refusal set:
 * a closed month and a reconciled entry still stop the purge, exactly as the CLI does.
 */

const bodySchema = z.object({
  centerId: z.string().uuid('centerId must be a uuid'),
  entryId: z.string().uuid('entryId must be a uuid'),
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
    return json({ error: 'invalid_json' }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const pool = getDbPool();
  const preview = await previewEntryImpact(pool, { ...parsed.data, action: 'void' });
  if (!preview) {
    return json({ error: 'entry_not_found' }, 404);
  }

  const center = await pool.query(`SELECT code FROM centers WHERE id = $1`, [parsed.data.centerId]);
  const code = center.rows[0]?.code;
  if (!code) {
    return json({ error: 'center_not_found' }, 404);
  }

  const displayId = preview.entry.entryNumber
    ? formatEntryId(String(code), preview.entry.entryDate, Number(preview.entry.entryNumber))
    : null;

  return json(
    {
      ok: true,
      centerId: parsed.data.centerId,
      entryId: preview.entryId,
      displayId,
      /** What the operator must type back exactly; null when the id cannot be composed. */
      typedConfirmation: displayId,
      entry: preview.entry,
      month: preview.month,
      monthState: preview.monthState,
      settlementDeltas: preview.settlementDeltas,
      blockers: preview.blockers,
      warnings: preview.warnings,
    },
    200,
  );
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
