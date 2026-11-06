// apps/web/src/lib/auth/guard.ts
import { session } from '$lib/auth/session.svelte';
import { isAuthRoute } from '$lib/auth/routes';
import { goto } from '$app/navigation';

export interface GuardNavigationEvent {
  toUrl: URL;
  cancel: () => void;
}

/**
 * Synchronous client navigation guard (PRD §9.3).
 * Suppresses network refresh errors while offline to prevent staff lockouts.
 */
export function handleClientGuard(toUrl: URL, cancel: () => void): void {
  // If initial session hydration is in progress, postpone guard decision
  if (session.loading) {
    return;
  }

  const pathname = toUrl.pathname;
  const onAuthRoute = isAuthRoute(pathname);
  const isStaffRestricted = pathname.startsWith('/reports') ||
                            pathname.startsWith('/settlements') ||
                            pathname.startsWith('/reconcile') ||
                            pathname.startsWith('/months/close') ||
                            pathname.startsWith('/admin');

  // CLT-R-015: a cached profile with no Supabase session is signed out, not
  // signed in — otherwise /login bounces back to the hollow dashboard.
  const isSignedIn = session.user !== null && session.user.active && !session.authMissing;

  // 1. Authenticated active user visiting auth route -> redirect to dashboard
  if (isSignedIn && onAuthRoute) {
    cancel();
    goto('/dashboard');
    return;
  }

  // 2. Unauthenticated (or deactivated) user accessing protected route
  if (!isSignedIn && !onAuthRoute) {
    cancel();
    goto('/login');
    return;
  }

  // 3. Role-based client navigation gating: Staff blocked from restricted routes (PRD §3, Rule R10)
  if (isSignedIn && session.user?.role === 'staff' && isStaffRestricted) {
    cancel();
    goto('/dashboard');
    return;
  }

  // 4. Role-based client navigation gating: Admin blocked from Owner-only month close
  if (isSignedIn && session.user?.role === 'admin' && pathname.startsWith('/months/close')) {
    cancel();
    goto('/reconcile');
    return;
  }
}
