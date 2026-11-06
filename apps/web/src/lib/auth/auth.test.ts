/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isValidDeviceId, getOrGenerateDeviceId } from './device';
import { handleClientGuard } from './guard';
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
    vi.restoreAllMocks();
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

  it('clears session cache and resets user state upon signOut (PRD §9.3)', async () => {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      id: 'usr-to-logout',
      role: 'owner',
      active: true,
    }));
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
