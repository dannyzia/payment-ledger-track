import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';

/**
 * POST /api/v1/admin/super/ledger/overrides — Plan 023 step 13.
 *
 * Three owner-level powers the seat needs when a centre asks it to act, each through the
 * routine the centre itself uses:
 *
 *   overpayment             → approve_settlement_overpayment
 *   reconciliation_exception→ review_entry_reconciliation_exception
 *   rate_profile            → publish_rate_profile
 *
 * The capability is chosen by `kind`, not by role: `super_admin` holds all three, but the
 * route must ask the registry for the power it is about to use so an owner-facing
 * equivalent could reuse the same body later. Nothing here computes money or decides
 * whether an exception is valid; those are the RPCs' rules.
 *
 * `20261116000012` admits the platform actor at each routine's gate. Until it existed,
 * each call answered `403 unauthorized` because the seat has no centre profile row.
 */

const overpayment = z.object({
  kind: z.literal('overpayment'),
  centerId: z.string().uuid(),
  settlementId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

const exception = z.object({
  kind: z.literal('reconciliation_exception'),
  centerId: z.string().uuid(),
  entryId: z.string().uuid(),
  payableId: z.string().uuid(),
  action: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).max(500),
});

const rateProfile = z.object({
  kind: z.literal('rate_profile'),
  centerId: z.string().uuid(),
  profileId: z.string().uuid(),
});

const bodySchema = z.discriminatedUnion('kind', [overpayment, exception, rateProfile]);

const RPC_ERRORS: Record<string, number> = {
  center_not_found: 404,
  settlement_not_found: 404,
  entry_not_found: 404,
  profile_not_found: 404,
  month_closed: 422,
  reason_required: 422,
  invalid_action: 422,
  overpayment_not_applicable: 422,
  not_a_draft: 422,
  unauthorized: 403,
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');

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

  const body = parsed.data;
  const pool = getDbPool();

  try {
    if (body.kind === 'overpayment') {
      requireCapability(caller, 'settlement.approve_overpayment');
      await pool.query(`SELECT approve_settlement_overpayment($1::uuid, $2::uuid, $3, $4::uuid)`, [
        body.centerId,
        body.settlementId,
        body.reason,
        caller.userId,
      ]);
      return json({ ok: true, kind: body.kind, settlementId: body.settlementId }, 200);
    }

    if (body.kind === 'reconciliation_exception') {
      requireCapability(caller, 'reconcile.review_exception');
      await pool.query(
        `SELECT review_entry_reconciliation_exception(
           $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid
         )`,
        [body.centerId, body.entryId, body.payableId, body.action, body.reason, caller.userId],
      );
      return json({ ok: true, kind: body.kind, entryId: body.entryId, action: body.action }, 200);
    }

    requireCapability(caller, 'rates.publish');
    await pool.query(`SELECT publish_rate_profile($1::uuid, $2::uuid, $3::uuid)`, [
      body.centerId,
      body.profileId,
      caller.userId,
    ]);
    return json({ ok: true, kind: body.kind, profileId: body.profileId }, 200);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = Object.keys(RPC_ERRORS).find((reason) => message.includes(reason));
    if (code) return json({ error: code }, RPC_ERRORS[code]!);
    return json({ error: 'override_failed', message }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
