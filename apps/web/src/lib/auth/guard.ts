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

  // Plan 023 step 3: once the server has refused the center, every route leads to
  // the withheld screen. It is the only surface that explains what happened, and
  // it is reachable signed-out.
  if (session.withheldReason && pathname !== '/withheld') {
    cancel();
    goto('/withheld');
    return;
  }

  // Plan 023 step 6: the platform seat opens only on a token that has PROVEN its
  // second factor. `aal !== 'aal2'` deliberately includes `null` — the level is
  // read from the token asynchronously, so a hard load used to reach a panel while
  // the answer was still unknown; the server refused every call (403) but the shell
  // painted. Unknown is not proof, so it fails closed here too. The security screen
  // is the one place a seat holder may stand while the factor is missing or unproven.
  const onSecurityScreen = pathname.startsWith('/admin/super/security');
  if (session.user?.role === 'super_admin' && session.aal !== 'aal2' && !onSecurityScreen) {
    cancel();
    // The query is part of the refused screen: `/admin/super/ledger?centerId=…` must come
    // back with its filter, not as the unfiltered ledger.
    const refused = `${pathname}${toUrl.search}`;
    goto(`/admin/super/security?from=${encodeURIComponent(refused)}`);
    return;
  }

  // The download landing page is accessible to everyone (signed-in or signed-out)
  if (pathname.startsWith('/download')) {
    return;
  }

  const onAuthRoute = isAuthRoute(pathname);
  const isStaffRestricted =
    pathname.startsWith('/reports') ||
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
    goto(accessDeniedUrl(pathname));
    return;
  }

  // 4. Role-based client navigation gating: Admin blocked from Owner-only month close
  if (isSignedIn && session.user?.role === 'admin' && pathname.startsWith('/months/close')) {
    cancel();
    goto(accessDeniedUrl(pathname));
    return;
  }

  // 5. The Access Denied screen itself must never redirect, or 3 and 4 loop through it.
}

/**
 * Where a refused navigation lands. It names the screen that was refused so the page
 * can say which one, instead of dropping the user on the dashboard with no
 * explanation as the guard used to (the page-level notices in reports, settlements,
 * reconcile and months/close sat behind these redirects and never rendered).
 */
export function accessDeniedUrl(pathname: string): string {
  return `/access-denied?from=${encodeURIComponent(pathname)}`;
}
