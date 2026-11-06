import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { supabase } from '$lib/supabase/client';
import { session } from '$lib/auth/session.svelte';

/**
 * CLT-R-015: every screen in this group needs a real Supabase session, not just
 * a profile in localStorage. Without this check the app rendered a signed-in
 * shell (Sign Out, empty lists) whose sync then failed with a generic error,
 * and /login redirected straight back to it. The check runs before the first
 * render, so there is no flash of an empty dashboard.
 *
 * Offline is unaffected: supabase.auth.getSession() returns the stored session
 * when the token is present, so a staff member who worked offline yesterday is
 * not locked out (PRD §9.3).
 */
export const load = async () => {
  // SSR is off app-wide; this keeps the prerender pass from touching supabase.
  if (!browser) return;

  const { data } = await supabase.auth.getSession();
  const sbSession = data.session;

  if (!sbSession?.user) {
    session.markSignedOut();
    redirect(307, '/login');
  }

  // A session without a matching profile (cache wiped, or another account) is
  // hydrated from the session rather than left to the cached role.
  if (!session.user || session.user.id !== sbSession.user.id) {
    await session.syncFromSupabaseSession(sbSession);
  }
};
