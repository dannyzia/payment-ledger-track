/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { goto } from '$app/navigation';
import { isValidDeviceId, getOrGenerateDeviceId } from './device';
import { accessDeniedUrl, handleClientGuard } from './guard';
import { session, PROFILE_CACHE_KEY } from './session.svelte';

// SvelteKit's goto() only runs inside the app browser runtime; in unit tests we
// assert the guard's cancel() decision, so redirect navigation is stubbed.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

describe('Auth & Client Guard Suite (PRD §9.3, §16.2 Tests #10, #22, #30, #59, #62, #63)', () => {
  beforeEach(() => {
    localStorage.clear();
    session.user = null;
    session.isOnline = true;
    session.loading = false;
    session.authMissing = false;
    session.withheldReason = null;
    session.aal = null;
    vi.restoreAllMocks();
    vi.mocked(goto).mockClear();
  });

  it('validates strict RFC 4122 v4 lowercase device UUIDs and rejects nil UUID', () => {
    const validV4 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    expect(isValidDeviceId(validV4)).toBe(true);

    expect(isValidDeviceId('00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isValidDeviceId('a1b2c3d4-e5f6-1a7b-8c9d-0e1f2a3b4c5d')).toBe(false);
    expect(isValidDeviceId('not-a-uuid')).toBe(false);

    const generated = getOrGenerateDeviceId();
    expect(isValidDeviceId(generated)).toBe(true);
    expect(generated).toBe(generated.toLowerCase());
  });

  it('suppresses auth redirect while offline when cached active profile exists (PRD §9.3)', () => {
    session.isOnline = false;
    session.user = {
      id: 'usr-1',
      email: 'staff@example.com',
      role: 'staff',
      active: true,
    };

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/entries/new'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(false);
  });

  it('redirects unauthenticated user to /login when navigating to protected route', () => {
    session.user = null;

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/dashboard'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(true);
  });

  it('blocks deactivated user from accessing protected routes', () => {
    session.user = {
      id: 'usr-deactivated',
      email: 'staff@example.com',
      role: 'staff',
      active: false,
    };

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/dashboard'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(true);
  });

  it('enforces role gating: Staff is blocked from /admin routes', () => {
    session.user = {
      id: 'usr-staff',
      email: 'staff@example.com',
      role: 'staff',
      active: true,
    };

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/admin/rates'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(true);
    // Not a silent bounce to the dashboard: the user is told which screen refused them.
    expect(goto).toHaveBeenCalledWith(accessDeniedUrl('/admin/rates'));
  });

  it('sends an Admin refused the owner-only month close to the Access Denied page', () => {
    session.user = {
      id: 'usr-admin',
      email: 'admin@example.com',
      role: 'admin',
      active: true,
    };

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/months/close'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(true);
    expect(goto).toHaveBeenCalledWith(accessDeniedUrl('/months/close'));
    expect(vi.mocked(goto).mock.calls.flat()).not.toContain('/reconcile');
  });

  it('lets a refused Staff user open the Access Denied page itself (no redirect loop)', () => {
    session.user = {
      id: 'usr-staff',
      email: 'staff@example.com',
      role: 'staff',
      active: true,
    };

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/access-denied?from=%2Freports'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(false);
    expect(goto).not.toHaveBeenCalled();
  });

  it('permits Admin access to /admin routes', () => {
    session.user = {
      id: 'usr-admin',
      email: 'admin@example.com',
      role: 'admin',
      active: true,
    };

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/admin/rates'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(false);
  });

  describe('platform seat assurance (Plan 023 step 6/7)', () => {
    const seat = (aal: 'aal1' | 'aal2' | null) => {
      session.user = {
        id: 'usr-seat',
        email: 'seat@example.com',
        role: 'super_admin',
        active: true,
      };
      session.aal = aal;
    };

    const visit = (path: string) => {
      let cancelled = false;
      handleClientGuard(new URL(`http://localhost${path}`), () => {
        cancelled = true;
      });
      return cancelled;
    };

    it('refuses the panel while the assurance level is still unknown', () => {
      // The race: on a hard load the level is read from the token asynchronously, so
      // the panel used to paint while the answer was null. Unknown is not proof.
      seat(null);

      expect(visit('/admin/super/centers')).toBe(true);
      expect(goto).toHaveBeenCalledWith('/admin/super/security?from=%2Fadmin%2Fsuper%2Fcenters');
    });

    it('keeps the refused screen’s query in the return path when assurance is unreadable', () => {
      // The same unknown level as above, but the refused screen carried a filter. The
      // return path must restore it: coming back to the unfiltered ledger would make the
      // seat think its scope survived the challenge when it did not.
      seat(null);

      expect(visit('/admin/super/ledger?centerId=abc&status=active')).toBe(true);
      expect(goto).toHaveBeenCalledWith(
        '/admin/super/security?from=%2Fadmin%2Fsuper%2Fledger%3FcenterId%3Dabc%26status%3Dactive',
      );
    });

    it('does not refuse the security screen when it carries a return path', () => {
      // Otherwise the redirected path would loop: the guard's own destination must stay
      // reachable with the parameter it just added, unreadable level included.
      seat(null);
      expect(visit('/admin/super/security?from=%2Fadmin%2Fsuper%2Fledger')).toBe(false);
      expect(goto).not.toHaveBeenCalled();
    });

    it('refuses the panel at aal1 and names the refused screen', () => {
      seat('aal1');

      expect(visit('/admin/super/ledger')).toBe(true);
      expect(goto).toHaveBeenCalledWith('/admin/super/security?from=%2Fadmin%2Fsuper%2Fledger');
    });

    it('opens the panel only once this session has proven aal2', () => {
      seat('aal2');

      expect(visit('/admin/super/centers')).toBe(false);
      expect(visit('/admin/super/ledger')).toBe(false);
      expect(goto).not.toHaveBeenCalled();
    });

    it('always allows the security screen, which is the way back to aal2', () => {
      seat(null);
      expect(visit('/admin/super/security')).toBe(false);
      seat('aal1');
      expect(visit('/admin/super/security')).toBe(false);
    });
  });

  it('treats a cached profile with no Supabase session as signed out (CLT-R-015)', () => {
    // The exact state reported from the device: profile cache present, so the
    // shell looked signed in, but supabase.auth.getSession() returned null.
    session.user = {
      id: 'usr-stale',
      email: 'owner@example.com',
      role: 'owner',
      active: true,
    };
    session.authMissing = true;

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/dashboard'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(true);
  });

  it('does not bounce /login back to the dashboard when the session is missing (CLT-R-015)', () => {
    session.user = {
      id: 'usr-stale',
      email: 'owner@example.com',
      role: 'owner',
      active: true,
    };
    session.authMissing = true;

    let cancelled = false;
    handleClientGuard(new URL('http://localhost/login'), () => {
      cancelled = true;
    });

    expect(cancelled).toBe(false);
  });

  it('signs out a withheld center at login instead of opening the shell (Plan 023 step 3)', async () => {
    session.user = {
      id: 'usr-suspended',
      email: 'owner@example.com',
      role: 'owner',
      active: true,
      centerId: 'cnt-suspended',
    };
    session.isOnline = true;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'center_suspended' }), { status: 403 }),
    );

    await session.revalidateActiveProfile('test-token');

    expect(session.withheldReason).toBe('center_suspended');
    expect(session.user).toBeNull();
  });

  it('sends a withheld center to the withheld screen and keeps its queued work (Plan 023 step 3)', async () => {
    session.user = {
      id: 'usr-suspended',
      email: 'owner@example.com',
      role: 'owner',
      active: true,
      centerId: 'cnt-suspended',
    };

    await session.withhold('center_archived');

    expect(session.withheldReason).toBe('center_archived');
    expect(session.user).toBeNull();
  });

  it('clears session cache and resets user state upon signOut (PRD §9.3)', async () => {
    localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({
        id: 'usr-to-logout',
        role: 'owner',
        active: true,
      }),
    );
    session.user = {
      id: 'usr-to-logout',
      email: 'owner@example.com',
      role: 'owner',
      active: true,
    };

    await session.signOut();

    expect(session.user).toBeNull();
    expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull();
  });
});
