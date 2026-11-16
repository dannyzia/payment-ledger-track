import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityReturnTarget } from '$lib/auth/security-return';

/**
 * Plan 023 step 6 — the seat's redirected return path.
 *
 * The guard sends a seat with an unproven (or unreadable) assurance level to
 * `/admin/super/security?from=…`. Two things have to hold for that round trip:
 *
 *  - the refused screen comes back intact, query included, so a filtered ledger returns
 *    filtered;
 *  - the parameter cannot be used to leave the app, which is what makes the security
 *    screen safe to reach while signed in but unproven.
 *
 * The guard half is asserted in `auth.test.ts`; this file covers the screen layer, and
 * the source assertion keeps the screen on the helper rather than a second inline copy of
 * the rule that could drift from it.
 */

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCREEN = path.join(APP_ROOT, 'src/routes/(app)/admin/super/security/+page.svelte');

describe('securityReturnTarget (plan 023 step 6)', () => {
  it('returns the refused platform screen, query preserved', () => {
    expect(securityReturnTarget('/admin/super/ledger')).toBe('/admin/super/ledger');
    expect(securityReturnTarget('/admin/super/ledger?centerId=abc&status=active')).toBe(
      '/admin/super/ledger?centerId=abc&status=active',
    );
    expect(securityReturnTarget('/admin/super/users?q=bashir')).toBe('/admin/super/users?q=bashir');
    expect(securityReturnTarget('/admin')).toBe('/admin');
  });

  it('falls back when there is nothing to return to', () => {
    expect(securityReturnTarget(null)).toBeNull();
    expect(securityReturnTarget(undefined)).toBeNull();
    expect(securityReturnTarget('')).toBeNull();
    // Not a platform path: the seat's own screens are the only return targets.
    expect(securityReturnTarget('/dashboard')).toBeNull();
    expect(securityReturnTarget('/reports')).toBeNull();
    expect(securityReturnTarget('admin/super/ledger')).toBeNull();
  });

  it('refuses anything that would leave the app', () => {
    expect(securityReturnTarget('//evil.example/admin')).toBeNull();
    expect(securityReturnTarget('https://evil.example/admin')).toBeNull();
    expect(securityReturnTarget('http://localhost/admin/super/ledger')).toBeNull();
    // A traversal segment would resolve out of /admin/ inside the browser.
    expect(securityReturnTarget('/admin/../etc/passwd')).toBeNull();
    expect(securityReturnTarget('/admin/super/../../login')).toBeNull();
    // Raw whitespace and backslashes normalise differently in browsers than in this
    // check, so they are refused rather than reasoned about.
    expect(securityReturnTarget('/admin/super/ledger\nSet-Cookie: x')).toBeNull();
    expect(securityReturnTarget('/admin\\super\\ledger')).toBeNull();
    expect(securityReturnTarget('/admin/super/ ledger')).toBeNull();
  });

  it('is the only return-target rule the screen uses', () => {
    const source = fs.readFileSync(SCREEN, 'utf8');

    expect(source).toContain("import { securityReturnTarget } from '$lib/auth/security-return'");
    expect(source).toContain("securityReturnTarget(page.url.searchParams.get('from'))");
    // Two call sites: the already-proven return in load(), and finish() after a challenge.
    expect(source.match(/securityReturnTarget\(/g)?.length).toBe(2);
    // No second copy of the old inline rule.
    expect(source).not.toContain("from.startsWith('/admin/')");
  });
});
