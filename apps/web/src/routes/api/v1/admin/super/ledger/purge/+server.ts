import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { formatEntryId } from '@clt/shared';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { reauthenticate } from '$lib/server/reauthentication';

/**
 * POST /api/v1/admin/super/ledger/purge — Plan 023 step 13.
 *
 * The one route that can delete an entry. Entries are immutable, so `maintenance_purge_entries`
 * is the only sanctioned path and it is not reachable from the app otherwise; this route
 * wraps it with the three conditions the plan requires:
 *
 *   1. re-authentication — `aal2` proves the session once held a factor, not that the
 *      person typing now is the seat. The password is verified against GoTrue and the
 *      verification session is discarded.
 *   2. typed confirmation — the caller must reproduce the entry's display id, which only
 *      the impact preview hands out. This is not ceremony: it makes "purge the entry I
 *      meant" a deliberate act rather than a mis-clicked row.
 *   3. the RPC's own refusals — a closed month and a reconciled entry still stop it, and
 *      a reason shorter than the RPC's minimum is refused before the call.
 *
 * No month lock is taken here: the purge refuses a closed month and a reconciled entry,
 * and it recomputes settlements inside its own transaction, so a second writer cannot
 * observe a half-applied state.
 */

const bodySchema = z.object({
  centerId: z.string().uuid('centerId must be a uuid'),
  entryId: z.string().uuid('entryId must be a uuid'),
  confirmation: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(10).max(500),
  password: z.string().min(1).max(200),
});

const RPC_ERRORS: Record<string, number> = {
  center_not_found: 404,
  entry_not_found: 404,
  month_closed: 422,
  reconciled: 409,
  entry_is_reconciled: 409,
  reason_required: 422,
  empty_entry_list: 422,
  unauthorized: 403,
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'ledger.write_any_center');

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
  const { centerId, entryId, confirmation, reason, password } = parsed.data;

  const pool = getDbPool();

  const target = await pool.query(
    `SELECT e.entry_number::text AS entry_number,
            e.entry_date::text   AS entry_date,
            e.status::text       AS status,
            c.code               AS center_code,
            u.email              AS actor_email
       FROM entries e
       JOIN centers c ON c.id = e.center_id
       LEFT JOIN auth.users u ON u.id = $3
      WHERE e.id = $1 AND e.center_id = $2`,
    [entryId, centerId, caller.userId],
  );
  const row = target.rows[0];
  if (!row) {
    return json({ error: 'entry_not_found' }, 404);
  }

  const displayId = formatEntryId(
    String(row.center_code),
    String(row.entry_date),
    Number(row.entry_number),
  );
  if (confirmation.toUpperCase() !== displayId.toUpperCase()) {
    return json({ error: 'confirmation_mismatch', expected: displayId }, 422);
  }

  const reauth = await reauthenticate(row.actor_email ?? null, password);
  if (reauth === 'unavailable') {
    return json({ error: 'reauthentication_unavailable' }, 503);
  }
  if (reauth === 'wrong_password') {
    return json({ error: 'reauthentication_failed' }, 401);
  }

  try {
    const result = await pool.query(
      `SELECT maintenance_purge_entries($1::uuid, ARRAY[$2::uuid], $3, $4::uuid) AS result`,
      [centerId, entryId, reason, caller.userId],
    );
    return json({ ok: true, entryId, displayId, result: result.rows[0]?.result ?? null }, 200);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = Object.keys(RPC_ERRORS).find((reason) => message.includes(reason));
    if (code) return json({ error: code }, RPC_ERRORS[code]!);
    return json({ error: 'purge_failed', message }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
