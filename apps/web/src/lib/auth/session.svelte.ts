import { supabase } from '$lib/supabase/client';
import { db } from '$lib/db';
import { goto } from '$app/navigation';
import { isAuthRoute } from '$lib/auth/routes';
import { isWithheldReason, type WithheldReason } from '$lib/ui/withheld-notice';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '@clt/shared';

export interface UserSessionProfile {
  id: string;
  email: string;
  role: UserRole;
  active: boolean;
  centerId?: string | null;
  centerCode?: string | null;
  centerName?: string | null;
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
  /**
   * Plan 023 step 3: set when the server refuses this center as suspended or
   * archived. The shell must not open; /login shows the reason from this field.
   */
  withheldReason = $state<WithheldReason | null>(null);
  /**
   * Plan 023 step 6: the platform seat is mandatory-TOTP. `aal` is the assurance
   * level of the current token; null means "not known yet" (offline, or before the
   * first session event). Only an explicit `aal1` closes the panel, so an offline
   * start never locks the owner of the seat out. The server check is step 7.
   */
  aal = $state<'aal1' | 'aal2' | null>(null);

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
        } else if (
          sbSession &&
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')
        ) {
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

    // A successful sign-in clears an earlier withheld notice (the center was
    // reactivated, or a different account signed in).
    this.withheldReason = null;

    const userId = sbSession.user.id;
    const email = sbSession.user.email ?? '';
    const initialRole = (sbSession.user.app_metadata?.role ?? 'staff') as UserRole;
    const initialCenterId = (sbSession.user.app_metadata?.center_id as string | undefined) ?? null;

    this.setLocalSession({
      id: userId,
      email,
      role: initialRole,
      active: true,
      centerId: initialCenterId,
      fullName: sbSession.user.user_metadata?.full_name,
    });

    // Local JWT state, no network needed: this is what the guard gates the seat on.
    await this.refreshAssurance();

    if (this.isOnline) {
      await this.revalidateActiveProfile(sbSession.access_token);
    }
  }

  /** Re-reads the token's assurance level after enrolling, challenging or refreshing. */
  async refreshAssurance(): Promise<'aal1' | 'aal2' | null> {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const level = data?.currentLevel as 'aal1' | 'aal2' | undefined;
      this.aal = level ?? null;
    } catch {
      // Keep the last known level rather than inventing one.
    }
    return this.aal;
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
        const code = (data.error as string | undefined) ?? (data.message as string | undefined);

        if (code === 'user_deactivated' || res.status === 401) {
          await this.signOut();
          return;
        }

        // Plan 023 step 3: a withheld center is refused at login, not only when it
        // tries to sync. Without this the shell opened and every call failed behind it.
        if (isWithheldReason(code)) {
          this.withheldReason = code;
          await this.signOut(true);
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
            centerId: data.centerId ?? this.user.centerId ?? null,
            centerCode: data.centerCode ?? this.user.centerCode ?? null,
            centerName: data.centerName ?? this.user.centerName ?? null,
            fullName: data.fullName ?? this.user.fullName,
          });
        }
      }
    } catch {
      // Suppress network errors while offline/reconnecting (PRD §9.3)
    }
  }

  /**
   * Plan 023 step 3: the server refused this center as suspended or archived.
   * Sign out without deleting the outbox — queued entries must survive until the
   * center is reactivated — and send the user to the withheld screen rather than
   * to a login form that cannot help them.
   */
  async withhold(reason: WithheldReason): Promise<void> {
    this.withheldReason = reason;
    try {
      await supabase.auth.signOut();
    } catch {
      // A failed provider sign-out must not stop the local cut-off.
    }
    this.clearLocalSession();
    if (typeof window !== 'undefined') {
      goto('/withheld');
    }
  }

  /**
   * CLT-T-075 shift-handover protection: signing out with pending offline ops warns
   * and leaves the outbox untouched on disk, so the next shift can finish the upload.
   * clearLocalSession only drops in-memory state and the profile cache.
   */
  async signOut(force: boolean = false): Promise<boolean> {
    if (!force && typeof window !== 'undefined') {
      let pendingCount = 0;
      try {
        pendingCount = await db.outbox.where('status').equals('pending').count();
      } catch {
        // Cannot read the outbox; do not block the sign-out on a read failure.
        pendingCount = 0;
      }
      if (pendingCount > 0 && typeof window.confirm === 'function') {
        const proceed = window.confirm(
          `${pendingCount} payments pending sync. Keep tablet connected to finish upload before signing out. Sign out anyway?`,
        );
        if (!proceed) {
          return false;
        }
      }
    }

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
    return true;
  }
}

export const session = new SessionStore();
