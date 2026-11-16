import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireCapability } from '$lib/server/capabilities';
import {
  consumeRecoveryCode,
  deleteAllFactors,
  hasVerifiedFactor,
  issueRecoveryCodes,
  recoveryCodesRemaining,
} from '$lib/server/mfa';

/**
 * Plan 023 step 6 — the seat's own 2FA state.
 *
 * Self-service only: the target is always the caller, never a client-supplied id.
 *
 * This is the one `/admin/super` route deliberately NOT behind `requireAssurance`.
 * It is the path to `aal2`: a seat at `aal1` has to read its factor state, enrol and
 * retrieve recovery codes from here. Gating it would mean the only way to satisfy the
 * gate is a screen the gate refuses. The power routes (centers, search, ledger) carry
 * the gate; recovery-code issuance additionally requires a verified factor.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

const consumeBody = z.object({
  code: z.string().min(4).max(64),
});

async function requireSeat(caller: Awaited<ReturnType<typeof getCallerContext>>) {
  requireRole(caller, ['super_admin']);
  requireCapability(caller, 'security.manage');
}

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  await requireSeat(caller);

  return json(
    {
      factors: await hasVerifiedFactor(caller.userId),
      recoveryCodesRemaining: await recoveryCodesRemaining(caller.userId),
    },
    { headers: NO_STORE },
  );
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  await requireSeat(caller);

  // Codes replace the account's previous batch, so issuing them without a factor
  // would hand a password-only session a way back in. Step 7 adds the token's
  // `aal2` check to this route through `requireAssurance`; until then the factor
  // itself is the precondition.
  if (!(await hasVerifiedFactor(caller.userId))) {
    throw error(403, 'factor_required');
  }

  const codes = await issueRecoveryCodes(caller.userId);
  return json({ codes }, { headers: NO_STORE });
};

export const PUT: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  await requireSeat(caller);

  const parsed = consumeBody.safeParse(await event.request.json().catch(() => ({})));
  if (!parsed.success) {
    throw error(400, 'invalid_request: code is required');
  }

  const consumed = await consumeRecoveryCode(caller.userId, parsed.data.code);
  if (!consumed) {
    // One answer for unknown, spent and malformed codes: nothing to learn from it.
    throw error(403, 'invalid_recovery_code');
  }

  const deleted = await deleteAllFactors(caller.userId);
  return json({ recovered: true, factorsCleared: deleted.length }, { headers: NO_STORE });
};
