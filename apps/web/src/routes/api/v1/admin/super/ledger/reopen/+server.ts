import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';

/**
 * POST /api/v1/admin/super/ledger/reopen — Plan 023 step 13.
 *
 * Closes the loop on the platform's own void/supersede gates: those refuse a month with
 * status `closed`, so the seat needs a way to reopen one when it is asked to correct a
 * closed month. `reopen_month` is the routine an owner uses; this route calls it on the
 * seat's behalf rather than writing `month_closes` itself.
 *
 * `reopen_month` takes the month lock and refuses an unclosed month, so this route does
 * not pre-check either — a second writer cannot slip between a check here and the RPC,
 * and a duplicate reopen is the RPC's `422 month_not_closed` rather than a silent no-op.
 * The seat's admission comes from `20261116000012`, which resolves the actor's role from
 * the platform row when no centre profile exists.
 */

const bodySchema = z.object({
  centerId: z.string().uuid('centerId must be a uuid'),
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'month must be YYYY-MM or YYYY-MM-DD'),
  reason: z.string().trim().min(1).max(500),
});

const RPC_ERRORS: Record<string, number> = {
  center_not_found: 404,
  month_not_closed: 422,
  reason_required: 422,
  unauthorized: 403,
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'month.reopen');

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

  // The RPC truncates to the month, so a partial date is accepted as the month it names.
  const month = `${parsed.data.month.slice(0, 7)}-01`;

  try {
    const result = await getDbPool().query(
      `SELECT reopen_month($1::uuid, $2::date, $3, $4::uuid) AS result`,
      [parsed.data.centerId, month, parsed.data.reason, caller.userId],
    );
    return json(
      { ok: true, centerId: parsed.data.centerId, month, result: result.rows[0]?.result ?? null },
      200,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = Object.keys(RPC_ERRORS).find((reason) => message.includes(reason));
    if (code) return json({ error: code }, RPC_ERRORS[code]!);
    return json({ error: 'reopen_failed', message }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
