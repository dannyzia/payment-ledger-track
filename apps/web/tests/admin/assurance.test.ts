import { describe, it, expect } from 'vitest';
import { decodeAssurance, requireAssurance } from '../../src/lib/server/assurance';

/**
 * Plan 023 step 7 — the assurance claim is read from the token, and absence is refused.
 *
 * These are the primitives; the route-level use is asserted in
 * `super-authz.test.ts`, which drives the real handlers with `aal1` and `aal2` tokens.
 */

function jwt(payload: unknown): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

/** SvelteKit's `error()` throws `{ status, body }`, not a plain Error. */
function thrown(fn: () => void): { status: number; message: string | undefined } {
  try {
    fn();
  } catch (error) {
    const httpError = error as { status?: number; body?: { message?: string } };
    return { status: httpError.status ?? 0, message: httpError.body?.message };
  }
  throw new Error('expected the gate to throw');
}

describe('assurance level (Plan 023 §6.4)', () => {
  it('reads aal from the token payload', () => {
    expect(decodeAssurance(jwt({ sub: 'u1', aal: 'aal2' }))).toBe('aal2');
    expect(decodeAssurance(jwt({ sub: 'u1', aal: 'aal1' }))).toBe('aal1');
  });

  it('treats a missing, unknown or malformed claim as no proof', () => {
    expect(decodeAssurance(jwt({ sub: 'u1' }))).toBeNull();
    expect(decodeAssurance(jwt({ sub: 'u1', aal: 'aal3' }))).toBeNull();
    expect(decodeAssurance(jwt({ sub: 'u1', aal: 2 }))).toBeNull();
    expect(decodeAssurance('not-a-jwt')).toBeNull();
    expect(decodeAssurance('header.%%%.signature')).toBeNull();
    expect(decodeAssurance('')).toBeNull();
  });

  it('refuses anything below the required level, including an unknown level', () => {
    expect(thrown(() => requireAssurance({ aal: 'aal1' }, 'aal2'))).toEqual({
      status: 403,
      message: 'assurance_required',
    });
    expect(thrown(() => requireAssurance({ aal: null }, 'aal2'))).toEqual({
      status: 403,
      message: 'assurance_required',
    });
    expect(() => requireAssurance({ aal: 'aal2' }, 'aal2')).not.toThrow();
  });
});
