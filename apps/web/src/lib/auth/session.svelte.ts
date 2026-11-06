import { supabase } from '$lib/supabase/client';
import { goto } from '$app/navigation';
import { isAuthRoute } from '$lib/auth/routes';
import type { Session } from '@supabase/supabase-js';

export interface UserSessionProfile {
  id: string;
  email: string;
  role: 'staff' | 'admin' | 'owner';
  active: boolean;
  fullName?: string | undefined;
}

export const PROFILE_CACHE_KEY = 'clt_cached_profile';

export class SessionStore {
  user = $state<UserSessionProfile | null>(null);
  isOnline = $state<boolean>(true);
  loading = $state<boolean>(true);
  /**
   * CLT-R-015: a cached profile is not proof of a session. When Supabase holds
   * no session but a profile cache exists, the shell used to render as signed in
   * (Sign Out, empty data) and /login bounced straight back to /dashboard.
   */
  authMissing = $state<boolean>(false);

  constructor() {
    if (typeof window !== 'undefined') {
      this.isOnline = window.navigator.onLine;

      window.addEventListener('online', () => {
        this.isOnline = true;
        this.revalidateActiveProfile();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
      });

      // Synchronously restore cached profile for immediate offline access (PRD §9.3)
      this.restoreCachedProfile();

      // Listen to Supabase auth state transitions with offline suppression (PRD §9.3)
      supabase.auth.onAuthStateChange(async (event, sbSession) => {
        if (event === 'SIGNED_OUT') {
          this.clearLocalSession();
        } else if (sbSession && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
          await this.syncFromSupabaseSession(sbSession);
        }
      });
    }
  }

  private restoreCachedProfile(): void {
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.id && parsed.role) {
          this.user = parsed;
        }
      }
    } catch {
      // Ignore cache read errors
    } finally {
      this.loading = false;
    }
  }

  private setLocalSession(profile: UserSessionProfile): void {
    this.user = profile;
    this.authMissing = false;
    try {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } catch {
      // Storage quota or private mode fallback
    }
  }

  clearLocalSession(): void {
    this.user = null;
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch {
      // Ignore
    }
  }

  /** Drop the cached profile and mark the shell as signed out (CLT-R-015). */
  markSignedOut(): void {
    this.authMissing = true;
    this.clearLocalSession();
  }

  /**
   * CLT-R-015: ask Supabase whether a session actually exists, and treat the
   * absence of one as signed-out instead of leaving a hollow signed-in shell.
   * Offline with a stored session still returns that session, so staff are not
   * locked out (PRD §9.3); a failed lookup leaves the cache in place rather
   * than guessing.
   */
  async ensureSession(): Promise<boolean> {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        this.authMissing = false;
        return true;
      }
    } catch {
      // Cannot tell: trust the cached profile rather than risk a lockout.
      return this.user !== null;
    }

    this.markSignedOut();
    if (typeof window !== 'undefined' && !isAuthRoute(window.location.pathname)) {
      goto('/login');
    }
    return false;
  }

  async syncFromSupabaseSession(sbSession: Session): Promise<void> {
    if (!sbSession?.user) {
      if (this.isOnline) {
        this.clearLocalSession();
      }
      return;
    }

    const userId = sbSession.user.id;
    const email = sbSession.user.email ?? '';
    const initialRole = ((sbSession.user.app_metadata?.role ?? 'staff') as UserSessionProfile['role']);

    this.setLocalSession({
      id: userId,
      email,
      role: initialRole,
      active: true,
      fullName: sbSession.user.user_metadata?.full_name,
    });

    if (this.isOnline) {
      await this.revalidateActiveProfile(sbSession.access_token);
    }
  }

  async revalidateActiveProfile(token?: string): Promise<void> {
    if (!this.isOnline) return;

    try {
      const accessToken = token ?? (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) return;

      const res = await fetch('/api/v1/auth/session', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'user_deactivated' || data.message === 'user_deactivated' || res.status === 401) {
          await this.signOut();
          return;
        }
      }

      if (res.ok) {
        const data = await res.json();
        if (this.user) {
          this.setLocalSession({
            ...this.user,
            role: data.role,
            active: data.active,
            fullName: data.fullName ?? this.user.fullName,
          });
        }
      }
    } catch {
      // Suppress network errors while offline/reconnecting (PRD §9.3)
    }
  }

  async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore network errors
    } finally {
      this.clearLocalSession();
      if (typeof window !== 'undefined') {
        goto('/login');
      }
    }
  }
}

export const session = new SessionStore();
