import { error } from '@sveltejs/kit';

/**
 * Plan 023 step 7 — assurance level, checked server-side on every request.
 *
 * The enforceable fact is the token's `aal` claim at the point of use, not a promise
 * from the browser. `getCallerContext` has already verified the token with
 * `supabase.auth.getUser` before this module decodes it, so decoding does not weaken
 * the check: an unverified or forged token never reaches here.
 *
 * Supabase puts `aal` in the access token (`aal1` for a password session, `aal2` once
 * a TOTP factor has been challenged in that session). No claim means no proof, and
 * absence is refused rather than assumed.
 */
export type AssuranceLevel = 'aal1' | 'aal2';

export interface AssuranceHolder {
  aal: AssuranceLevel | null;
}

interface TokenClaims {
  aal?: unknown;
}

function base64UrlDecode(segment: string): string {
  const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Reads `aal` from the JWT payload. Returns null for a malformed token or a token
 * without the claim; the caller decides, and the guard refuses null.
 */
export function decodeAssurance(token: string): AssuranceLevel | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;

  try {
    const claims = JSON.parse(base64UrlDecode(parts[1])) as TokenClaims;
    if (claims.aal === 'aal1' || claims.aal === 'aal2') return claims.aal;
    return null;
  } catch {
    return null;
  }
}

/**
 * Refuses a caller whose token has not reached the required assurance level.
 * `403 assurance_required` is deliberately distinct from `capability_denied`: the
 * role may act, the session has not proven its second factor.
 */
export function requireAssurance(caller: AssuranceHolder, required: AssuranceLevel): void {
  if (caller.aal === required) return;
  throw error(403, 'assurance_required');
}
