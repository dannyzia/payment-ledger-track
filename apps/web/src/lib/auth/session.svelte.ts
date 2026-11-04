import { supabase } from '$lib/supabase/client';
import { goto } from '$app/navigation';
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
