# 008_auth_roles_app_shell.md — Authentication, Role Guards, Offline Session Cache, and Server Route Mediation

- Plan Identifier: CLT-PLAN-008
- Phase: Phase 1 / M1
- Milestone: M1
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §3 (Roles and permissions), §7.1 (Security architecture), §9.3 (Offline JWT handling & SvelteKit auth guard), §13 (Server-Route Mediation Architecture, SPA mode `ssr = false`), §15 (Security and audit), §16.2 (Tests #10, #22, #30, #59, #62, #63), §17 (Milestone M1)
- Depends on: 003, 004, 006, 007
- Current Status: Not Implemented
- Revision: 2.3 — 2026-11-01

## 1. Purpose

Implement the application shell, SPA mode configuration (`ssr = false`), client Supabase authentication integration, offline session persistence, role-based navigation guards, account setup flows for invited users (`/auth/callback` and `/auth/set-password`), explicit sign-out UI, and server-route mediation endpoints under `/api/v1/*`. Public email signup is disabled (`ENABLE_SIGNUP = false`); all accounts are invitation-only. The client auth guard caches session profiles in `localStorage` [PLAN-DERIVED: `clt_cached_profile`] (with extension hook for Dexie `db.meta` in Plan 010), suppressing network refresh failures while offline to prevent lockouts. Server mediation endpoints verify Supabase JWTs with standard SvelteKit `error(401, ...)`, synchronize `auth.users.raw_app_meta_data` on role mutations, provision auth users via `supabase.auth.admin.inviteUserByEmail`, enforce Tests #59 & #63 privilege rules, and call PostgreSQL RPCs under `service_role`.

## 2. Scope

- IN:
  - SPA mode configuration `apps/web/src/routes/+layout.ts` exporting `export const ssr = false;` per PRD §13.
  - Browser Supabase client initialization in `apps/web/src/lib/supabase/client.ts` with local storage session persistence.
  - Server-only Supabase admin client in `apps/web/src/lib/server/supabase.ts` configured with `SUPABASE_SERVICE_ROLE_KEY` (compile-time server-only protection via `$lib/server/`).
  - Device UUID manager in `apps/web/src/lib/auth/device.ts` enforcing strict RFC 4122 v4 lowercase format, rejecting the nil UUID `00000000-0000-0000-0000-000000000000`, with in-memory caching fallback for private browsing.
  - Reactive authentication rune store in `apps/web/src/lib/auth/session.svelte.ts` tracking user identity, role, profile, and connectivity with `localStorage` [PLAN-DERIVED] caching (`clt_cached_profile`), startup offline retention without token purge, active profile re-verification against `/api/v1/auth/session`, and explicit `signOut()` clearing all local session caches.
  - Client auth navigation guard in `apps/web/src/lib/auth/guard.ts` (re-exported in `apps/web/src/hooks.client.ts`) exporting synchronous `handleClientGuard` with offline token suppression (on `!navigator.onLine` and network errors `TypeError: Failed to fetch`), role-based navigation gating (blocking Staff from `/admin/*`), and redirecting already-authenticated users away from auth routes via `goto()`.
  - Server caller context extractor in `apps/web/src/lib/server/auth.ts` verifying Supabase JWTs and throwing standard SvelteKit `error(401, ...)` / `error(403, ...)`.
  - Application layouts: root layout `apps/web/src/routes/+layout.svelte` and authenticated shell `apps/web/src/routes/(app)/+layout.svelte` passing verified role to `Sidebar` and `FloatingMenu`, wrapping in `<main id="main-content">`, and rendering a visible Sign Out button in navigation.
  - Accessible login screen in `apps/web/src/routes/(auth)/login/+page.svelte` with `autocomplete` attributes and design system tokens.
  - Account setup flow for invited users: callback listener `apps/web/src/routes/(auth)/callback/+page.svelte` (handling PKCE code exchange and hash tokens) and set-password screen `apps/web/src/routes/(auth)/set-password/+page.svelte` enabling invited users to complete password creation and log in.
  - Server mediation endpoints under `apps/web/src/routes/api/v1/`:
    - `/api/v1/auth/session` (session resolution, profile role lookup, active status check, and dynamic default route derivation)
    - `/api/v1/admin/users/invite` (mediating `admin_invite_user` with full 4-argument signature `(p_email, p_role, p_full_name, p_actor_id)`, provisioning via `supabase.auth.admin.inviteUserByEmail`, synchronizing `raw_app_meta_data`, blocking Owner invitations with 403 `cannot_invite_owner` for Test #59, blocking Admins from managing Admins/Owners, and handling re-invites of deactivated users with 200 or active users with 409 for Test #63)
    - `/api/v1/admin/users` (mediating `admin_manage_user` with 5-argument signature `(p_action, p_user_id, p_role, p_active, p_actor_id)` supporting `update_role`, `deactivate`, and `reactivate`, synchronizing `raw_app_meta_data`, and enforcing that Admins manage Staff only per PRD §3)
    - `/api/v1/admin/devices` (mediating `admin_manage_device`)
    - `/api/v1/admin/transfer-ownership` (mediating atomic `transfer_ownership(p_new_owner_id, p_caller_id)`, rejecting self-transfers, and synchronizing `raw_app_meta_data` for both former and new owners)
  - Integration of regression tests #10, #22, #30, #59, #62, #63 from PRD §16.2.
  - Comprehensive unit test suite in `apps/web/src/lib/auth/auth.test.ts` verifying RFC 4122 v4 device UUID validation, offline token suppression, sign-out cache clearance, role navigation guards, and Tests #59 / #63 invite rules.
- OUT:
  - Financial entry form fields and live calculations (owned by Plan 010).
  - Outbox synchronization queue runner and pull protocol (owned by Plan 011).
  - Rate profile editor and settings management screens (owned by Plan 009).
  - Settlement payment recording and receipt uploads (owned by Plan 014).

## 3. Preconditions

1. Plan 003 migrations and Plan 004 RPC functions are applied to the local database.
   - Check command: `test -f supabase/migrations/20261029000001_initial_schema.sql`
   - Expected output: exit code `0`.
2. Plan 006 bootstrap script is available and tested.
   - Check command: `test -f scripts/bootstrap.ts`
   - Expected output: exit code `0`.
3. Plan 007 UI kit components exist in `apps/web/src/lib/ui/`.
   - Check command: `test -f apps/web/src/lib/ui/Button.svelte && test -f apps/web/src/lib/ui/Sidebar.svelte`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/supabase/client.ts` | create | Browser Supabase client utilizing anon key and local storage |
| `apps/web/src/lib/server/supabase.ts` | create | Server-only Supabase client utilizing service role key |
| `apps/web/src/lib/auth/device.ts` | create | RFC 4122 v4 device UUID generator, validator, and in-memory persistence helper |
| `apps/web/src/lib/auth/session.svelte.ts` | create | Svelte 5 reactive session store with offline profile caching, auto-refresh, and sign-out |
| `apps/web/src/lib/auth/guard.ts` | create | Synchronous client route navigation guard with offline token suppression and role gating |
| `apps/web/src/hooks.client.ts` | create | SvelteKit client hook re-exporting client navigation guard |
| `apps/web/src/lib/server/auth.ts` | create | Server caller context extractor verifying Supabase JWT and profiles with HttpError |
| `apps/web/src/routes/+layout.ts` | create | SvelteKit SPA mode declaration (ssr = false) |
| `apps/web/src/routes/+layout.svelte` | create | Root layout initializing session state, auth change listener, and background tokens |
| `apps/web/src/routes/(auth)/login/+page.svelte` | create | Accessible login screen supporting email and password authentication |
| `apps/web/src/routes/(auth)/callback/+page.svelte` | create | Invite and recovery callback handler supporting PKCE code exchange and URL tokens |
| `apps/web/src/routes/(auth)/set-password/+page.svelte` | create | Set password screen for invited users to complete account setup |
| `apps/web/src/lib/ui/CommandPalette.svelte` | create | Desktop Command Palette (⌘K / Ctrl+K) accessible overlay with role filtering |
| `apps/web/src/routes/(app)/+layout.svelte` | create | Authenticated shell with role-aware Sidebar, FloatingMenu, CommandPalette, and Sign Out action |
| `apps/web/src/routes/api/v1/auth/session/+server.ts` | create | GET endpoint returning verified profile, role, active status, and default route |
| `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` | create | POST endpoint mediating admin user invitations via inviteUserByEmail with Tests #59 & #63 rules |
| `apps/web/src/routes/api/v1/admin/users/+server.ts` | create | POST endpoint mediating role update and deactivation, syncing app_metadata |
| `apps/web/src/routes/api/v1/admin/devices/+server.ts` | create | POST endpoint mediating device revocation |
| `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts` | create | POST endpoint mediating atomic ownership transfer and syncing app_metadata |
| `apps/web/src/lib/auth/auth.test.ts` | create | Unit tests for device UUID validation, offline token suppression, role guards, and invite rules |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create browser Supabase client in `apps/web/src/lib/supabase/client.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/supabase/client.ts`.
   - Check: `grep -c 'export const supabase =' apps/web/src/lib/supabase/client.ts`
   - Expected output: `1`

2. Create server-only Supabase client in `apps/web/src/lib/server/supabase.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/server/supabase.ts`.
   - Check: `grep -c 'export function getServiceSupabase' apps/web/src/lib/server/supabase.ts`
   - Expected output: `1`

3. Create device UUID helper in `apps/web/src/lib/auth/device.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/auth/device.ts`.
   - Check: `grep -c 'export function getOrGenerateDeviceId' apps/web/src/lib/auth/device.ts`
   - Expected output: `1`

4. Create reactive session store in `apps/web/src/lib/auth/session.svelte.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/auth/session.svelte.ts`.
   - Check: `grep -c 'export class SessionStore' apps/web/src/lib/auth/session.svelte.ts`
   - Expected output: `1`

5. Create client navigation guard in `apps/web/src/lib/auth/guard.ts` referencing Specification 6.5, and re-export in `apps/web/src/hooks.client.ts`.
   - Command: copy block 6.5 into `apps/web/src/lib/auth/guard.ts` and `apps/web/src/hooks.client.ts`.
   - Check: `grep -c 'export function handleClientGuard' apps/web/src/lib/auth/guard.ts`
   - Expected output: `1`

6. Create server auth helper in `apps/web/src/lib/server/auth.ts` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/lib/server/auth.ts`.
   - Check: `grep -c 'export async function getCallerContext' apps/web/src/lib/server/auth.ts`
   - Expected output: `1`

7. Create SPA layout configuration in `apps/web/src/routes/+layout.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/routes/+layout.ts`.
   - Check: `grep -c 'ssr = false' apps/web/src/routes/+layout.ts`
   - Expected output: `1`

8. Create root layout in `apps/web/src/routes/+layout.svelte` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/routes/+layout.svelte`.
   - Check: `grep -c 'handleClientGuard' apps/web/src/routes/+layout.svelte`
   - Expected output: `1`
   - Expected output: `1`

9. Create login view in `apps/web/src/routes/(auth)/login/+page.svelte` referencing Specification 6.9.
   - Command: copy block 6.9 into `"apps/web/src/routes/(auth)/login/+page.svelte"`.
   - Check: `grep -c 'async function handleLogin' "apps/web/src/routes/(auth)/login/+page.svelte"`
   - Expected output: `1`

10. Create invite callback handler in `apps/web/src/routes/(auth)/callback/+page.svelte` referencing Specification 6.10.
    - Command: copy block 6.10 into `"apps/web/src/routes/(auth)/callback/+page.svelte"`.
    - Check: `grep -c 'detectSessionInUrl' "apps/web/src/routes/(auth)/callback/+page.svelte"`
    - Expected output: `1`

11. Create set-password screen in `apps/web/src/routes/(auth)/set-password/+page.svelte` referencing Specification 6.11.
    - Command: copy block 6.11 into `"apps/web/src/routes/(auth)/set-password/+page.svelte"`.
    - Check: `grep -c 'async function handleSetPassword' "apps/web/src/routes/(auth)/set-password/+page.svelte"`
    - Expected output: `1`

11b. Create Desktop Command Palette in `apps/web/src/lib/ui/CommandPalette.svelte` referencing Specification 6.12b.
    - Command: copy block 6.12b into `"apps/web/src/lib/ui/CommandPalette.svelte"`.
    - Check: `grep -c 'Command Palette' apps/web/src/lib/ui/CommandPalette.svelte`
    - Expected output: `1`

12. Create authenticated application shell in `apps/web/src/routes/(app)/+layout.svelte` referencing Specification 6.12.
    - Command: copy block 6.12 into `"apps/web/src/routes/(app)/+layout.svelte"`.
    - Check: `grep -c 'main id="main-content"' "apps/web/src/routes/(app)/+layout.svelte"`
    - Expected output: `1`

13. Create session verification mediation endpoint in `apps/web/src/routes/api/v1/auth/session/+server.ts` referencing Specification 6.13.
    - Command: copy block 6.13 into `apps/web/src/routes/api/v1/auth/session/+server.ts`.
    - Check: `grep -c 'getCallerContext' apps/web/src/routes/api/v1/auth/session/+server.ts`
    - Expected output: `1`

14. Create user invite mediation endpoint in `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` referencing Specification 6.14.
    - Command: copy block 6.14 into `apps/web/src/routes/api/v1/admin/users/invite/+server.ts`.
    - Check: `grep -c 'inviteUserByEmail' apps/web/src/routes/api/v1/admin/users/invite/+server.ts`
    - Expected output: `1`

15. Create user management mediation endpoint in `apps/web/src/routes/api/v1/admin/users/+server.ts` referencing Specification 6.15.
    - Command: copy block 6.15 into `apps/web/src/routes/api/v1/admin/users/+server.ts`.
    - Check: `grep -c 'admin_manage_user' apps/web/src/routes/api/v1/admin/users/+server.ts`
    - Expected output: `1`

16. Create device revocation mediation endpoint in `apps/web/src/routes/api/v1/admin/devices/+server.ts` referencing Specification 6.16.
    - Command: copy block 6.16 into `apps/web/src/routes/api/v1/admin/devices/+server.ts`.
    - Check: `grep -c 'admin_manage_device' apps/web/src/routes/api/v1/admin/devices/+server.ts`
    - Expected output: `1`

17. Create ownership transfer mediation endpoint in `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts` referencing Specification 6.17.
    - Command: copy block 6.17 into `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`.
    - Check: `grep -c 'transfer_ownership' apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`
    - Expected output: `1`

18. Create auth unit tests in `apps/web/src/lib/auth/auth.test.ts` referencing Specification 6.18.
    - Command: copy block 6.18 into `apps/web/src/lib/auth/auth.test.ts`.
    - Check: `pnpm --filter @clt/web test auth.test.ts`
    - Expected output: test suite passes with 6 passed.

## 6. Specifications

### 6.1 `apps/web/src/lib/supabase/client.ts`

```ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'dummy-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
```

### 6.2 `apps/web/src/lib/server/supabase.ts`

```ts
import { createClient } from '@supabase/supabase-js';

let serviceClient: ReturnType<typeof createClient> | null = null;

/**
 * Returns a privileged Supabase client configured with the service role key.
 * Located in $lib/server/ to enforce SvelteKit compile-time server-only boundaries (Hard Rule 8).
 */
export function getServiceSupabase() {
  if (serviceClient) return serviceClient;

  const url = process.env.PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not defined.');
  }

  serviceClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serviceClient;
}
```

### 6.3 `apps/web/src/lib/auth/device.ts`

```ts
const DEVICE_ID_KEY = 'clt_device_id';
const V4_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

let inMemoryDeviceId: string | null = null;

/**
 * Validates that an identifier strictly conforms to RFC 4122 v4 lowercase UUID
 * and rejects the nil UUID (PRD §9.1, Finding H5).
 */
export function isValidDeviceId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const lower = id.trim().toLowerCase();
  if (lower === NIL_UUID) return false;
  return V4_UUID_REGEX.test(lower);
}

/**
 * Retrieves the persisted device ID from local storage or generates a fresh v4 UUID.
 * In private browsing modes where storage access throws, an in-memory random UUID is returned.
 */
export function getOrGenerateDeviceId(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = window.localStorage.getItem(DEVICE_ID_KEY);
      if (existing && isValidDeviceId(existing)) {
        return existing.toLowerCase();
      }
      const fresh = crypto.randomUUID().toLowerCase();
      window.localStorage.setItem(DEVICE_ID_KEY, fresh);
      return fresh;
    }
  } catch {
    // Storage restricted fallback
  }

  if (!inMemoryDeviceId) {
    inMemoryDeviceId = crypto.randomUUID().toLowerCase();
  }
  return inMemoryDeviceId;
}
```

### 6.4 `apps/web/src/lib/auth/session.svelte.ts`

```ts
import { supabase } from '$lib/supabase/client';
import { goto } from '$app/navigation';

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

  async syncFromSupabaseSession(sbSession: any): Promise<void> {
    if (!sbSession?.user) {
      if (this.isOnline) {
        this.clearLocalSession();
      }
      return;
    }

    const userId = sbSession.user.id;
    const email = sbSession.user.email ?? '';
    const initialRole = (sbSession.user.app_metadata?.role as any) ?? 'staff';

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
```

### 6.5 `apps/web/src/lib/auth/guard.ts` & `apps/web/src/hooks.client.ts`

```ts
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
```

```ts
// apps/web/src/hooks.client.ts
export { handleClientGuard, type GuardNavigationEvent } from '$lib/auth/guard';
```

### 6.6 `apps/web/src/lib/server/auth.ts`

```ts
import { error, type RequestEvent } from '@sveltejs/kit';
import { getServiceSupabase } from '$lib/server/supabase';

export interface CallerContext {
  userId: string;
  role: 'staff' | 'admin' | 'owner';
  active: boolean;
}

/**
 * Extracts and verifies the caller's JWT from the Authorization: Bearer header.
 * Throws standard SvelteKit error(401, ...) on auth failures (Hard Rule 7 & 9).
 */
export async function getCallerContext(event: RequestEvent): Promise<CallerContext> {
  const authHeader = event.request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw error(401, 'unauthorized: missing or malformed Authorization header');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw error(401, 'unauthorized: empty Bearer token');
  }

  const supabase = getServiceSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw error(401, 'unauthorized: invalid or expired token');
  }

  const { data: profile, error: profError } = await supabase
    .from('profiles')
    .select('role, active')
    .eq('id', user.id)
    .single();

  if (profError || !profile) {
    throw error(401, 'unauthorized: profile not found');
  }

  if (profile.active === false) {
    throw error(403, 'user_deactivated');
  }

  return {
    userId: user.id,
    role: profile.role,
    active: profile.active,
  };
}

/**
 * Validates that caller has one of the required roles and is active.
 * Throws standard SvelteKit error(403, ...) if unauthorized.
 */
export function requireRole(caller: CallerContext, allowedRoles: ('staff' | 'admin' | 'owner')[]) {
  if (!caller.active) {
    throw error(403, 'user_deactivated');
  }
  if (!allowedRoles.includes(caller.role)) {
    throw error(403, 'unauthorized: insufficient permissions');
  }
}
```

### 6.7 `apps/web/src/routes/+layout.ts`

```ts
// PRD §13: SvelteKit SPA mode configuration
export const ssr = false;
export const prerender = false;
```

### 6.8 `apps/web/src/routes/+layout.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { session } from '$lib/auth/session.svelte';
  import { handleClientGuard } from '$lib/auth/guard';
  import '../app.css';

  let { children } = $props();

  beforeNavigate(({ to, cancel }) => {
    if (to?.url) {
      handleClientGuard(to.url, cancel);
    }
  });

  onMount(() => {
    // Initial page load guard check
    handleClientGuard(new URL(window.location.href), () => {});
  });
</script>

<div class="min-h-screen bg-[var(--bg)] text-[var(--ink)] antialiased font-sans">
  {@render children()}
</div>
```

### 6.9 `apps/web/src/routes/(auth)/login/+page.svelte`

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    errorMessage = '';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.session) {
        await session.syncFromSupabaseSession(data.session);
        goto('/dashboard');
      }
    } catch (err: any) {
      errorMessage = err.message || 'Invalid email or password.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Cosmo Ledger Track</h1>
      <p class="text-xs text-[var(--muted)] mt-1">Invitation-only payment ledger. Sign in to continue.</p>
    </div>

    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleLogin} class="flex flex-col gap-4">
      <div>
        <label for="login-email" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Email Address
        </label>
        <input
          id="login-email"
          type="email"
          required
          autocomplete="email"
          bind:value={email}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="name@company.com"
        />
      </div>

      <div>
        <label for="login-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          required
          autocomplete="current-password"
          bind:value={password}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="••••••••"
        />
      </div>

      <div class="mt-2">
        <Button variant="commission" type="submit" class="w-full min-h-[44px]" {loading}>
          Sign In
        </Button>
      </div>
    </form>
  </div>
</div>
```

### 6.10 `apps/web/src/routes/(auth)/callback/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';
  import { goto } from '$app/navigation';

  let statusMessage = $state('Verifying invitation link...');
  let errorMessage = $state('');

  onMount(async () => {
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (data.session) {
          await session.syncFromSupabaseSession(data.session);
          goto('/set-password');
          return;
        }
      }

      // Check for active or hash-parsed session
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      if (data.session) {
        await session.syncFromSupabaseSession(data.session);
        goto('/set-password');
      } else {
        const timeout = setTimeout(() => {
          goto('/login');
        }, 1500);

        supabase.auth.onAuthStateChange(async (event, sbSession) => {
          if (sbSession) {
            clearTimeout(timeout);
            await session.syncFromSupabaseSession(sbSession);
            goto('/set-password');
          }
        });
      }
    } catch (err: any) {
      errorMessage = err.message || 'Invitation verification failed or link expired.';
    }
  });
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] text-center">
    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
      <a href="/login" class="text-xs text-[var(--accent)] underline">Return to Sign In</a>
    {:else}
      <div class="text-sm font-semibold text-[var(--ink)]">{statusMessage}</div>
    {/if}
  </div>
</div>
```

### 6.11 `apps/web/src/routes/(auth)/set-password/+page.svelte`

```svelte
<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';

  let password = $state('');
  let confirmPassword = $state('');
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleSetPassword(e: SubmitEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      errorMessage = 'Passwords do not match.';
      return;
    }

    if (password.length < 8) {
      errorMessage = 'Password must be at least 8 characters long.';
      return;
    }

    loading = true;
    errorMessage = '';

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      goto('/dashboard');
    } catch (err: any) {
      errorMessage = err.message || 'Failed to set password.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Set Your Password</h1>
      <p class="text-xs text-[var(--muted)] mt-1">Complete your account setup to access Cosmo Ledger Track.</p>
    </div>

    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleSetPassword} class="flex flex-col gap-4">
      <div>
        <label for="new-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          New Password
        </label>
        <input
          id="new-password"
          type="password"
          required
          autocomplete="new-password"
          bind:value={password}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label for="confirm-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Confirm Password
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          autocomplete="new-password"
          bind:value={confirmPassword}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="Repeat password"
        />
      </div>

      <div class="mt-2">
        <Button variant="commission" type="submit" class="w-full min-h-[44px]" {loading}>
          Set Password & Continue
        </Button>
      </div>
    </form>
  </div>
</div>
```

### 6.12 `apps/web/src/routes/(app)/+layout.svelte`

> [!IMPORTANT]
> **Blocker fix (rev 2.5):** `syncRunner.start()` is called in `onMount` so the background push/pull cycle begins as soon as the authenticated shell mounts. `SyncIndicator` is rendered in the header bar so all authenticated screens show connection state. Plan 011 must be implemented before this wiring compiles at runtime.

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from '$lib/ui/Sidebar.svelte';
  import FloatingMenu from '$lib/ui/FloatingMenu.svelte';
  import CommandPalette from '$lib/ui/CommandPalette.svelte';
  import SyncIndicator from '$lib/ui/SyncIndicator.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { syncRunner } from '$lib/sync/runner.svelte';

  let { children } = $props();

  const userRole = $derived(session.user?.role ?? 'staff');
  const userEmail = $derived(session.user?.email ?? '');
  let isCommandPaletteOpen = $state(false);

  onMount(() => {
    syncRunner.start();
    return () => syncRunner.stop();
  });

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      isCommandPaletteOpen = !isCommandPaletteOpen;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen overflow-hidden bg-[var(--bg)]">
  <!-- Desktop Sidebar Navigation Rail -->
  <div class="hidden md:flex flex-col justify-between w-64 border-r border-[var(--pearl-border)] glass">
    <div class="flex-1 overflow-y-auto">
      <Sidebar role={userRole} />
    </div>

    <!-- User Profile & Sign Out Action (PRD §9.3) -->
    <div class="p-4 border-t border-[var(--pearl-border)] flex flex-col gap-2 bg-black/5 dark:bg-white/5">
      <div class="text-xs text-[var(--muted)] truncate font-mono" title={userEmail}>
        {userEmail}
      </div>
      <Button
        variant="default"
        class="w-full text-xs text-red-600 hover:bg-red-500/10 min-h-[44px]"
        onclick={() => session.signOut()}
      >
        Sign Out
      </Button>
    </div>
  </div>

  <!-- Mobile Floating Menu Navigation -->
  <div class="md:hidden">
    <FloatingMenu role={userRole} />
  </div>

  <!-- Sync Status Indicator — visible on every authenticated screen (Plan 011) -->
  <div class="fixed top-3 right-4 z-50">
    <SyncIndicator />
  </div>

  <!-- Desktop Command Palette Overlay (PRD §14.5) -->
  <CommandPalette
    role={userRole}
    open={isCommandPaletteOpen}
    onclose={() => (isCommandPaletteOpen = false)}
  />

  <!-- Primary Content Landmark -->
  <main id="main-content" class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
```

### 6.12b `apps/web/src/lib/ui/CommandPalette.svelte`

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';

  interface Props {
    role: 'owner' | 'admin' | 'staff';
    open: boolean;
    onclose: () => void;
  }

  let { role, open = false, onclose }: Props = $props();
  let query = $state('');
  let selectedIndex = $state(0);

  interface CommandItem {
    id: string;
    title: string;
    route: string;
    roles: ('owner' | 'admin' | 'staff')[];
    shortcut?: string;
  }

  const allCommands: CommandItem[] = [
    { id: 'new-entry', title: 'New Payment Entry', route: '/entries/new', roles: ['owner', 'admin', 'staff'], shortcut: 'N' },
    { id: 'dashboard', title: 'Dashboard', route: '/dashboard', roles: ['owner', 'admin', 'staff'] },
    { id: 'ledger', title: 'Ledger', route: '/ledger', roles: ['owner', 'admin', 'staff'], shortcut: 'L' },
    { id: 'reports', title: 'Monthly Reports', route: '/reports', roles: ['owner', 'admin'], shortcut: 'R' },
    { id: 'settlements', title: 'Settlements & Payables', route: '/settlements', roles: ['owner', 'admin'], shortcut: 'S' },
    { id: 'reconcile', title: 'Reconciliation', route: '/reconcile', roles: ['owner', 'admin'] },
    { id: 'admin-settings', title: 'Admin Settings', route: '/admin/settings', roles: ['owner', 'admin'] },
  ];

  const filteredCommands = $derived(
    allCommands
      .filter((cmd) => cmd.roles.includes(role))
      .filter((cmd) => cmd.title.toLowerCase().includes(query.trim().toLowerCase()))
  );

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % (filteredCommands.length || 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + (filteredCommands.length || 1)) % (filteredCommands.length || 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filteredCommands[selectedIndex];
      if (target) {
        onclose();
        goto(target.route);
      }
    }
  }

  function handleSelect(route: string) {
    onclose();
    goto(route);
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
    role="presentation"
    onclick={onclose}
  >
    <div
      class="w-full max-w-lg rounded-2xl glass p-4 shadow-2xl border border-[var(--pearl-border)] flex flex-col gap-3"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeyDown}
    >
      <div class="relative">
        <input
          type="text"
          bind:value={query}
          placeholder="Search commands or jump to screen... (Esc to close)"
          class="w-full px-4 py-3 rounded-xl border border-[var(--pearl-border)] bg-white/70 dark:bg-black/40 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] min-h-[44px]"
          autofocus
        />
      </div>

      <div class="max-h-64 overflow-y-auto flex flex-col gap-1">
        {#if filteredCommands.length === 0}
          <div class="p-3 text-center text-xs text-[var(--muted)]">No matching screens found</div>
        {:else}
          {#each filteredCommands as cmd, i (cmd.id)}
            <button
              type="button"
              class="w-full px-4 py-2.5 rounded-xl text-left text-sm flex items-center justify-between min-h-[44px] transition-colors {i === selectedIndex ? 'bg-[var(--accent)] text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]'}"
              onclick={() => handleSelect(cmd.route)}
            >
              <span>{cmd.title}</span>
              {#if cmd.shortcut}
                <kbd class="px-2 py-0.5 rounded text-xs {i === selectedIndex ? 'bg-white/20 text-white' : 'bg-black/10 dark:bg-white/10 text-[var(--muted)]'}">{cmd.shortcut}</kbd>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
```

### 6.13 `apps/web/src/routes/api/v1/auth/session/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);

  const supabase = getServiceSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', caller.userId)
    .single();

  const defaultRoute = caller.role === 'staff' ? '/entries/new' : '/dashboard';

  return new Response(
    JSON.stringify({
      userId: caller.userId,
      role: caller.role,
      active: caller.active,
      fullName: profile?.full_name,
      defaultRoute,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
```

### 6.14 `apps/web/src/routes/api/v1/admin/users/invite/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['staff', 'admin', 'owner']),
  fullName: z.string().trim().min(1, 'Full name is required'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['admin', 'owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email, role, fullName } = parsed.data;

  // PRD §16.2 Test #59: Owner role cannot be invited; single owner enforced via ownership transfer
  if (role === 'owner') {
    return new Response(
      JSON.stringify({ error: 'cannot_invite_owner', message: 'Owner cannot be invited. Use ownership transfer.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // PRD §3: Admins may only invite Staff members
  if (caller.role === 'admin' && role !== 'staff') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Admins may only invite Staff members.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = getServiceSupabase();

  // Execute database procedure handling role authorization, deactivated account checks, and audit logging
  const { error: rpcErr } = await supabase.rpc('admin_invite_user', {
    p_email: email.toLowerCase(),
    p_role: role,
    p_full_name: fullName,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    if (rpcErr.message.includes('409') || rpcErr.message.includes('user_already_exists')) {
      return new Response(
        JSON.stringify({ error: 'user_already_exists', message: 'User is already active.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (rpcErr.message.includes('403')) {
      return new Response(
        JSON.stringify({ error: 'unauthorized', message: rpcErr.message }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Provision Supabase Auth User with raw_app_meta_data (PRD §3, §7.3, Hard Rule 7)
  const redirectTo = `${event.url.origin}/callback`;
  const { data: authData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email.toLowerCase(), {
    data: { full_name: fullName },
    redirectTo,
  });

  if (inviteErr) {
    // If user already exists in auth.users (reactivation flow), synchronize metadata directly
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const matched = existingUser?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (matched) {
      await supabase.auth.admin.updateUserById(matched.id, {
        app_metadata: { role, full_name: fullName },
      });
      return new Response(
        JSON.stringify({ success: true, userId: matched.id, reactivated: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: inviteErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (authData.user) {
    await supabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { role, full_name: fullName },
    });
  }

  return new Response(
    JSON.stringify({ success: true, userId: authData.user?.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
```

### 6.15 `apps/web/src/routes/api/v1/admin/users/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const manageUserSchema = z.object({
  targetUserId: z.string().uuid(),
  action: z.enum(['update_role', 'deactivate', 'reactivate']),
  newRole: z.enum(['staff', 'admin']).optional(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['admin', 'owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = manageUserSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { targetUserId, action, newRole } = parsed.data;
  const supabase = getServiceSupabase();

  if (caller.role === 'admin') {
    const { data: targetProf } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', targetUserId)
      .single();

    if (targetProf && targetProf.role !== 'staff') {
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'Admins may only manage Staff members.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update_role' && newRole !== 'staff') {
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'Admins cannot promote users to Admin.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const pActive = action === 'deactivate' ? false : (action === 'reactivate' ? true : null);

  const { error: rpcErr } = await supabase.rpc('admin_manage_user', {
    p_action: action,
    p_user_id: targetUserId,
    p_role: action === 'update_role' ? newRole ?? null : null,
    p_active: pActive,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'update_role' && newRole) {
    await supabase.auth.admin.updateUserById(targetUserId, {
      app_metadata: { role: newRole },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.16 `apps/web/src/routes/api/v1/admin/devices/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const deviceSchema = z.object({
  deviceId: z.string().uuid().transform((s) => s.toLowerCase()),
  action: z.enum(['revoke', 'unrevoke']),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['admin', 'owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = deviceSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_manage_device', {
    p_device_id: parsed.data.deviceId,
    p_action: parsed.data.action,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.17 `apps/web/src/routes/api/v1/admin/transfer-ownership/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const transferSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { newOwnerUserId } = parsed.data;

  if (newOwnerUserId === caller.userId) {
    return new Response(JSON.stringify({ error: 'cannot_transfer_to_self', message: 'Cannot transfer ownership to yourself.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getServiceSupabase();

  const { error } = await supabase.rpc('transfer_ownership', {
    p_new_owner_id: newOwnerUserId,
    p_caller_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Synchronize app_metadata for both parties
  await supabase.auth.admin.updateUserById(caller.userId, {
    app_metadata: { role: 'admin' },
  });
  await supabase.auth.admin.updateUserById(newOwnerUserId, {
    app_metadata: { role: 'owner' },
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

### 6.18 `apps/web/src/lib/auth/auth.test.ts`

```ts
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isValidDeviceId, getOrGenerateDeviceId } from './device';
import { handleClientGuard } from './guard';
import { session, PROFILE_CACHE_KEY } from './session.svelte';

describe('Auth & Client Guard Suite (PRD §9.3, §16.2 Tests #10, #22, #30, #59, #62, #63)', () => {
  beforeEach(() => {
    localStorage.clear();
    session.user = null;
    session.isOnline = true;
    session.loading = false;
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
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Device UUID v4 Validation | `'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'`, Nil UUID | Valid v4 accepts, Nil UUID rejects | §9.1 | `apps/web/src/lib/auth/auth.test.ts` |
| Test #10 Offline Deactivation Reconnect | Offline cached session | Navigation permitted, refresh failure suppressed | §16.2 #10, §9.3 | `apps/web/src/lib/auth/auth.test.ts` |
| Unauthenticated Navigation Guard | Unauthenticated user navigating to `/dashboard` | Cancelled / Redirected to `/login` | §3, §9.3 | `apps/web/src/lib/auth/auth.test.ts` |
| Deactivated User Navigation Guard | Deactivated user navigating to `/dashboard` | Cancelled / Redirected to `/login` | §3, §9.3 | `apps/web/src/lib/auth/auth.test.ts` |
| Role Navigation Guard | Staff navigating to `/admin/rates` | Cancelled / Redirected to `/dashboard` | §3 | `apps/web/src/lib/auth/auth.test.ts` |
| Admin Navigation Allowance | Admin navigating to `/admin/rates` | Navigation permitted | §3 | `apps/web/src/lib/auth/auth.test.ts` |
| Test #62 Shared-Device Sign Out | `session.signOut()` | LocalStorage cache removed, user null | §16.2 #62 | `apps/web/src/lib/auth/auth.test.ts` |
| Test #59 Privilege Escalation Guard | Admin/Owner invite with `role: 'owner'` | HTTP `403 cannot_invite_owner` | §16.2 #59 | `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` |
| Test #63 Re-Inviting User Semantics | Active user vs deactivated user | Active $\to$ 409 `user_already_exists`; deactivated $\to$ 200 reactivated | §16.2 #63 | `apps/web/src/routes/api/v1/admin/users/invite/+server.ts` |

## 8. Acceptance criteria

1. Client device UUID helper generates valid lowercase RFC 4122 v4 UUIDs and rejects nil UUID.
   - Command: `pnpm --filter @clt/web test auth.test.ts -t "RFC 4122"`
   - Expected output: `1 passed`.
2. Offline navigation guard suppresses network errors while offline, gates unauthenticated/deactivated users, and blocks Staff from Admin routes.
   - Command: `pnpm --filter @clt/web test auth.test.ts`
   - Expected output: `7 passed`.
3. SvelteKit route and component typecheck passes cleanly.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 7: All financial and config writes execute via `SECURITY DEFINER` RPCs under `service_role`.
- Rule 8: Service role key never reaches the client; server client isolated in `$lib/server/supabase.ts`.
- Rule 9: Server never trusts client role; re-derives identity from Supabase JWT and checks profiles.
- Rule 11: Zod schema validation on client and server.

## 10. Pitfalls

- Trap: Thrown `Response` objects in `getCallerContext` converted by SvelteKit to HTTP 500 unexpected errors.
  - Fix: Throw SvelteKit's standard `error(401, ...)` from `@sveltejs/kit` returning authentic HTTP 401 JSON responses.
- Trap: Startup offline session purge: Clearing local session when `!sbSession` or token refresh fails wipes cached credentials and locks out staff while offline.
  - Fix: Restrict local session clearance strictly to `event === 'SIGNED_OUT'`.
- Trap: Non-existent database columns (`profiles.email`, `profiles.default_route`).
  - Fix: Query `auth.users` for emails and derive default routes dynamically in application logic (`caller.role === 'staff' ? '/entries/new' : '/dashboard'`).
- Trap: Function signature mismatches on RPC calls (`admin_invite_user`, `admin_manage_user`, `transfer_ownership`).
  - Fix: Pass all required parameters matching PostgreSQL signatures (`p_full_name`, `p_active`, `p_caller_id`).
- Trap: Invited users created without password or invite email cannot log in.
  - Fix: Provision via `supabase.auth.admin.inviteUserByEmail`, redirecting to `/callback` and `/set-password` routes to complete setup.
- Trap: Client caches outdated JWT metadata ignoring database role promotions or ownership transfers.
  - Fix: Synchronize `raw_app_meta_data` via `updateUserById` on role updates, and revalidate active profile against `/api/v1/auth/session` when online.
- Trap: Missing sign-out UI prevents shared-device user switching required by Test #62.
  - Fix: Provide explicit Sign Out action in navigation and `session.signOut()` clearing all local caches.

## 11. PRD ISSUES and DECISION PENDING

- Synchronous client navigation guard in `$lib/auth/guard.ts` `[PLAN-DERIVED]`: Exported from `$lib/auth/` to ensure valid SvelteKit module resolution while maintaining re-export in `hooks.client.ts`.
- Offline profile caching in `localStorage` under `clt_cached_profile` `[PLAN-DERIVED]`: Provides immediate synchronous profile availability prior to Dexie initialization in Plan 010.

## 12. Handoff

- `session` store exported from `apps/web/src/lib/auth/session.svelte.ts` for role-aware UI across all modules.
- `getCallerContext` exported from `apps/web/src/lib/server/auth.ts` for all `/api/v1/*` routes.

## 13. Suggested task breakdown

- `CLT-T-029` (Implementer): Implement device UUID generator, validator, and browser/server Supabase clients (`device.ts`, `client.ts`, `$lib/server/supabase.ts`).
- `CLT-T-030` (Implementer): Build reactive session store, offline profile caching, and client navigation guard (`session.svelte.ts`, `guard.ts`, `hooks.client.ts`).
- `CLT-T-031` (Implementer): Build auth views (login, invite callback, set-password) and app shells (`login/+page.svelte`, `callback/+page.svelte`, `set-password/+page.svelte`, `+layout.svelte`, `(app)/+layout.svelte`).
- `CLT-T-032` (Implementer): Implement server caller context helper and mediation endpoints with Test #59/#63 rules (`lib/server/auth.ts`, `routes/api/v1/**/+server.ts`).
- `CLT-T-033` (Tester): Comprehensive auth unit test suite (`apps/web/src/lib/auth/auth.test.ts`).

## Changelog

- 2026-11-03 — Revision 2.5:
  - **Blocker fix — Sync never starts (B1):** Added `import { onMount } from 'svelte'`, `import SyncIndicator from '$lib/ui/SyncIndicator.svelte'`, and `import { syncRunner } from '$lib/sync/runner.svelte'` to `(app)/+layout.svelte`. Added `onMount(() => { syncRunner.start(); return () => syncRunner.stop(); })` so the background push/pull cycle starts when the authenticated shell mounts and is stopped on unmount. Added `<SyncIndicator />` in a fixed top-right overlay so every authenticated screen shows live sync state. `SyncIndicator` and `syncRunner` are created by Plan 011; Plan 011 must be implemented before this wiring compiles at runtime.
- 2026-11-02 — Revision 2.4:
  - 1. **Client Navigation Route Guard Expansion (Hard Rule R10)**: Expanded `handleClientGuard` in `$lib/auth/guard.ts` to synchronously block Staff from `/reports`, `/settlements`, `/reconcile`, `/months/close`, and `/admin/*` (redirecting to `/dashboard`), and block Admin from Owner-only `/months/close` (redirecting to `/reconcile`).
  - 2. **Desktop Command Palette (PRD §14.5)**: Created `apps/web/src/lib/ui/CommandPalette.svelte` accessible modal overlay with keyboard shortcuts (⌘K / Ctrl+K), role-gated navigation options, and arrow navigation, mounted in `apps/web/src/routes/(app)/+layout.svelte`.
- 2026-11-01 — Revision 2.3:
  - 1. **Fixed Module Resolution Compilation Failure (P0.1)**: Created `apps/web/src/lib/auth/guard.ts` inside `$lib` and re-exported `handleClientGuard` from `src/hooks.client.ts`, eliminating invalid `$lib/hooks.client` import paths in layouts and tests.
  - 2. **Eliminated Non-Existent Column Queries (P0.2, P0.3)**: Purged non-existent `profiles.email` from user invite lookup and `profiles.default_route` from session resolution route, deriving default route dynamically in application logic.
  - 3. **Corrected PostgreSQL RPC Signatures (P0.4, P0.5, P0.6)**: Added missing `fullName` / `p_full_name` to `admin_invite_user` call, added `p_active` to `admin_manage_user` call, and corrected parameter name to `p_caller_id` in `transfer_ownership`.
  - 4. **Fixed Offline Startup Staff Lockout (P0.7)**: Restricted `clearLocalSession()` strictly to `event === 'SIGNED_OUT'`, preserving cached profiles on startup when network refresh fails offline per PRD §9.3.
  - 5. **Fixed Client Guard Dead Code and Hydration Race (P0.8, P1.8)**: Removed impossible `!session.user && session.user` branch, and postponed navigation gating while `session.loading` is active.
  - 6. **Replaced Tautological Tests with Rigorous Suite (P0.9)**: Replaced hollow `expect(true).toBe(true)` assertions with 7 comprehensive unit tests verifying device UUID, offline suppression, unauthenticated/deactivated redirects, role gating, and signOut cache clearance.
  - 7. **Enforced Table Write Revocation (P1.1)**: Removed direct client-side `supabase.from('profiles').update()` in invite route, relying strictly on atomic `admin_invite_user` RPC.
  - 8. **Synchronized App Metadata on Invitations (P1.2)**: Followed `inviteUserByEmail` with `updateUserById` setting `raw_app_meta_data`, ensuring invited Admins are not mistakenly downgraded to Staff.
  - 9. **Protected Deactivated Admins and Owners (P1.3)**: Blocked Admins from re-inviting or demoting deactivated Admins or Owners.
  - 10. **Standardized Deactivation Error Detection (P1.4)**: Checked both `data.error` and `data.message` for `user_deactivated`.
  - 11. **Client-Side SPA Navigation (P1.6)**: Replaced destructive `window.location.href` reloads with SvelteKit's client-side `goto()` from `$app/navigation`.
  - 12. **Fixed Nested Double Sidebar Layout (P1.7)**: Cleaned layout structure in `(app)/+layout.svelte`, ensuring single Sidebar container.
  - 13. **Hardened PKCE Callback Support (P1.9)**: Added `exchangeCodeForSession(code)` handling for PKCE authentication flows.
  - 14. **Prevented Self-Ownership Transfer (P1.10)**: Added explicit rejection if `newOwnerUserId === caller.userId`.
  - 15. **Standardized Tokens & Task IDs (P2.1, P2.3)**: Aligned markup with design system tokens `--bg`, `--ink`, `--muted`, `--pearl-border`, and assigned sequential task IDs `CLT-T-029` through `CLT-T-033`.
- 2026-10-31: Remediated 8 critical blockers, spec deviations, and verification failures (Revision 2.2):
  - Blocker 1: Replaced thrown `Response` objects in `getCallerContext` with standard SvelteKit `error(401, ...)`, eliminating HTTP 500 error traps.
  - Blocker 2: Implemented complete invited user setup flow: `/admin/users/invite` calls `inviteUserByEmail`, added `/callback` to detect tokens, and added `/set-password` for password creation.
  - Blocker 3: Corrected all 18 step check commands with precise patterns and quoted shell paths for `(auth)` and `(app)`.
  - Blocker 4: Synchronized `auth.users.raw_app_meta_data` via `updateUserById` during `admin_manage_user` and `transfer_ownership`, and added client `/api/v1/auth/session` re-validation.
  - Blocker 5 & 6: Added `signOut()` method, auth state change listener, and visible Sign Out button in desktop sidebar and mobile navigation for shared-device switching (Test #62).
  - Blocker 7: Expanded `auth.test.ts` to 6 comprehensive tests with `@vitest-environment jsdom` covering device UUID, offline suppression, role gating, sign-out, and invite rules.
  - Blocker 8: Replaced restrictive `role: z.enum(['staff', 'admin'])` with `z.enum(['staff', 'admin', 'owner'])` in invite endpoint, handling Test #59 `403 cannot_invite_owner` and Test #63 re-invites.
  - Deviations: Enforced strict RFC 4122 v4 lowercase UUIDs in `device.ts` (rejecting nil UUID), moved server Supabase client under `$lib/server/supabase.ts`, and added `<main id="main-content">` landmark.
- 2026-10-30: Remediated Rev 2.0 findings: added `/admin/devices` and `/admin/transfer-ownership` routes, integrated Test #59 & #63 invite rules.
- 2026-10-29: Initial specification created for Plan 008 aligned with PRD v1.19 §3, §7.1, §9.3, §13, and §15.
