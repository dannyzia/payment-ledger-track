// apps/web/src/lib/auth/guard.ts
import { session } from '$lib/auth/session.svelte';
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
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/callback') || pathname.startsWith('/set-password');
  const isStaffRestricted = pathname.startsWith('/reports') ||
                            pathname.startsWith('/settlements') ||
                            pathname.startsWith('/reconcile') ||
                            pathname.startsWith('/months/close') ||
                            pathname.startsWith('/admin');

  // 1. Authenticated active user visiting auth route -> redirect to dashboard
  if (session.user && session.user.active && isAuthRoute) {
    cancel();
    goto('/dashboard');
    return;
  }

  // 2. Unauthenticated (or deactivated) user accessing protected route
  if ((!session.user || !session.user.active) && !isAuthRoute) {
    cancel();
    goto('/login');
    return;
  }

  // 3. Role-based client navigation gating: Staff blocked from restricted routes (PRD §3, Rule R10)
  if (session.user?.role === 'staff' && isStaffRestricted) {
    cancel();
    goto('/dashboard');
    return;
  }

  // 4. Role-based client navigation gating: Admin blocked from Owner-only month close
  if (session.user?.role === 'admin' && pathname.startsWith('/months/close')) {
    cancel();
    goto('/reconcile');
    return;
  }
}
