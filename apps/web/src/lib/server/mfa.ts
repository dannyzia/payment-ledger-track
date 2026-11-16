import { createHash, randomInt } from 'node:crypto';
import type { Json } from '$lib/database.types';
import { getServiceSupabase } from '$lib/server/supabase';

/**
 * Plan 023 step 5 — 2FA recovery.
 *
 * The recovery path exists before mandatory TOTP is switched on, because a sole
 * Super Admin who loses the authenticator has no second person to unlock the seat
 * (Plan 023 §6.4).
 *
 * Codes are stored only as SHA-256 hashes. They live in the account's
 * `app_metadata`, which is writable only with the service role key and never
 * reaches the browser: `auth.users` is not readable by `anon` or `authenticated`,
 * so no new table (and no change to the 20-table counts in PRD §17/§18) is needed.
 * Each code is single-use: consuming removes its hash, so replay fails.
 *
 * Consuming a code does not grant a session by itself — GoTrue issues the session,
 * not this app. It clears the account's TOTP factors and forces immediate
 * re-enrolment, which is the same effect as the operator command in
 * `scripts/ops/reset-mfa.ts`, except self-service and audited separately.
 */

export const RECOVERY_CODE_COUNT = 10;

/** Crockford-style alphabet: no I, L, O, U, 0 or 1, so a code cannot be misread. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 12;
const METADATA_KEY = 'mfa_recovery';

export interface RecoveryCodeState {
  hashes: string[];
  issued_at: string;
}

/** A single displayable code: `XXXX-XXXX-XXXX`. */
export function generateRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const seen = new Set<string>();
  const codes: string[] = [];
  while (codes.length < count) {
    const code = generateRecoveryCode();
    if (seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

/** Uppercase and strip separators, so `abcd efgh` and `ABCD-EFGH` are one code. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The hash is bound to the user id, so one account's hash cannot be replayed
 * against another account even if two users were issued identical codes.
 */
export function hashRecoveryCode(userId: string, code: string): string {
  return createHash('sha256')
    .update(`${userId}:${normalizeRecoveryCode(code)}`)
    .digest('hex');
}

/** Reads the stored state from an `app_metadata` object; null means never issued. */
export function readRecoveryState(
  appMetadata: Record<string, unknown> | null | undefined,
): RecoveryCodeState | null {
  const raw = appMetadata?.[METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const state = raw as { hashes?: unknown; issued_at?: unknown };
  if (!Array.isArray(state.hashes)) return null;
  return {
    hashes: state.hashes.filter((hash): hash is string => typeof hash === 'string'),
    issued_at: typeof state.issued_at === 'string' ? state.issued_at : '',
  };
}

/**
 * Writes one platform-row audit entry (center_id NULL) in the caller's transaction.
 * Audit is a hard rule (5), so a recovery action that cannot be audited must fail
 * rather than silently succeed.
 */
async function audit(
  userId: string,
  eventName: string,
  oldValues: Json | null,
  newValues: Json,
): Promise<void> {
  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('log_audit_event', {
    // log_audit_event takes a nullable center_id in SQL; the generated types do not
    // model the null, and a platform row has no center.
    p_center_id: null as unknown as string,
    p_actor_id: userId,
    p_event_name: eventName,
    p_target_table: 'auth.users',
    p_target_id: userId,
    ...(oldValues ? { p_old_values: oldValues } : {}),
    p_new_values: newValues,
  });
  if (error) {
    throw new Error(`audit_write_failed: ${error.message}`);
  }
}

async function loadAppMetadata(userId: string): Promise<Record<string, unknown>> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new Error(`user_lookup_failed: ${error?.message ?? 'not found'}`);
  }
  return (data.user.app_metadata ?? {}) as Record<string, unknown>;
}

/** How many unused codes the account still holds. */
export async function recoveryCodesRemaining(userId: string): Promise<number> {
  const metadata = await loadAppMetadata(userId);
  return readRecoveryState(metadata)?.hashes.length ?? 0;
}

/**
 * Replaces the account's unused codes with a fresh batch and returns the plaintext
 * exactly once. Nothing else can read them afterwards — only the hashes remain.
 */
export async function issueRecoveryCodes(
  userId: string,
  count: number = RECOVERY_CODE_COUNT,
): Promise<string[]> {
  const supabase = getServiceSupabase();
  const metadata = await loadAppMetadata(userId);
  const previous = readRecoveryState(metadata);

  const codes = generateRecoveryCodes(count);
  const hashes = codes.map((code) => hashRecoveryCode(userId, code));

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...metadata,
      [METADATA_KEY]: { hashes, issued_at: new Date().toISOString() } satisfies RecoveryCodeState,
    },
  });
  if (error) {
    throw new Error(`recovery_code_write_failed: ${error.message}`);
  }

  await audit(
    userId,
    'mfa.recovery_codes_issued',
    previous ? { unused_before: previous.hashes.length, issued_at: previous.issued_at } : null,
    { unused_after: hashes.length, source: 'super_admin_security_screen' },
  );

  return codes;
}

/**
 * Consumes one code. Returns false for an unknown, already-used or malformed code —
 * the caller must not distinguish those cases in its response.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const metadata = await loadAppMetadata(userId);
  const state = readRecoveryState(metadata);
  if (!state || state.hashes.length === 0) return false;

  const hash = hashRecoveryCode(userId, code);
  const index = state.hashes.indexOf(hash);
  if (index === -1) return false;

  const remaining = state.hashes.filter((_, position) => position !== index);
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...metadata,
      [METADATA_KEY]: { hashes: remaining, issued_at: state.issued_at } satisfies RecoveryCodeState,
    },
  });
  if (error) {
    throw new Error(`recovery_code_write_failed: ${error.message}`);
  }

  await audit(userId, 'mfa.recovery_code_used', null, { unused_after: remaining.length });
  return true;
}

/**
 * Deletes every MFA factor on the account. Used by a consumed recovery code and by
 * the operator command: the account drops to `aal1` and must enrol again before any
 * `/admin/super/*` route opens.
 */
export async function deleteAllFactors(userId: string): Promise<string[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
  if (error) {
    throw new Error(`factor_list_failed: ${error.message}`);
  }

  const deleted: string[] = [];
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
      userId,
      id: factor.id,
    });
    if (deleteError) {
      throw new Error(`factor_delete_failed: ${factor.id}: ${deleteError.message}`);
    }
    deleted.push(factor.id);
  }
  return deleted;
}

/** True when the account holds at least one verified factor (TOTP). */
export async function hasVerifiedFactor(userId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
  if (error) {
    throw new Error(`factor_list_failed: ${error.message}`);
  }
  return (data?.factors ?? []).some((factor) => factor.status === 'verified');
}
