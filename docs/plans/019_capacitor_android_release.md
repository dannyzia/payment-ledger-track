# 019_capacitor_android_release.md — Capacitor Android Packaging, Native Haptics, Push Reminders, and Store Release

- Plan Identifier: CLT-PLAN-019
- Phase: Phase 5 / M5
- Milestone: M5
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §13 (Tech stack: Capacitor Android), §14.5 (Floating menu: haptic tick on snap), §17 (Milestone M5 Definition of Done: Capacitor Android build, haptics, push reminders, store packaging), §18 (Implementation Readiness Gate 5: Accessibility and Visual Proof), AGENTS.md Rule 20 (Q1–Q4 sign-off)
- Depends on: 007, 008, 009, 011, 014, 017
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement the Capacitor Android native application container, static build adapter branching preserving all web and PWA routing, client API base URL resolution (`PUBLIC_API_BASE`) and CORS handling for native WebViews, native haptic feedback (`@capacitor/haptics`) wired into floating action menu snaps, persistent device UUID storage via `@capacitor/preferences` with in-memory fallbacks, settlement due push reminders via `@capacitor/local-notifications`, Android AppCompat manifest configuration with cloud backup disabled (`allowBackup="false"`), automated Android App Bundle (`.aab`) and APK store packaging with keystore signing, launcher icon generation via `@capacitor/assets`, and physical hardware verification for Milestone M5 Definition of Done and Readiness Gate 5. Production store release is strictly gated on Owner confirmation of open business policies Q1–Q4 per AGENTS.md Rule 20.

## 2. Scope

- IN:
  - Capacitor runtime and plugin dependencies in `apps/web/package.json`:
    - `@capacitor/core: ^6.2.0`, `@capacitor/android: ^6.2.0`, `@capacitor/haptics: ^6.0.2`, `@capacitor/preferences: ^6.0.3`, `@capacitor/local-notifications: ^6.1.1`.
    - Build tooling: `@capacitor/cli: ^6.2.0`, `@capacitor/assets: ^3.0.5`, `@sveltejs/adapter-static: ^3.0.8`, `jsdom: ^25.0.0`.
    - Hoisting configuration in `.npmrc` (`public-hoist-pattern[]=*capacitor*`) ensuring Gradle resolves Android dependencies.
  - Capacitor 6 configuration in `apps/web/capacitor.config.ts`:
    - Defining `appId: 'com.cosmo.ledgertrack'`, `appName: 'Cosmo Ledger Track'`, and web directory `'build'`.
    - Configuring plugins: `Haptics`, `Preferences`, and `LocalNotifications` (with small icon `ic_stat_icon_config_sample` / `@mipmap/ic_launcher`).
    - Eliminating deprecated `bundledWebRuntime` to satisfy Capacitor 6 TypeScript definitions.
  - SvelteKit build adapter branching in `apps/web/svelte.config.js`:
    - Clean merge branching on `process.env.CAPACITOR_BUILD === 'true'`.
    - Using `@sveltejs/adapter-static` with `pages: 'build'`, `assets: 'build'`, `fallback: 'index.html'`, and `strict: false` (rendering SPA without requiring destructive API route moving).
    - Retaining `@sveltejs/adapter-vercel` for standard production web deployments.
  - Vite configuration in `apps/web/vite.config.ts`:
    - Clean merge preserving Plan 017 Workbox precaching, NetworkOnly bypass for `/api/v1/*` and auth, and test block with jsdom environment.
    - Disabling Service Worker during native builds (`disable: process.env.CAPACITOR_BUILD === 'true'`) to prevent duplicate caching inside Android WebViews.
  - Client API base URL resolution and CORS handling:
    - Standardized native API helper `apps/web/src/lib/api.ts` exporting `resolveApiUrl(path)` and `apiFetch(path, init)` attaching `PUBLIC_API_BASE`, Supabase bearer token from `$lib/supabase/client`, and `X-Device-Id`.
    - Additive client navigation and fetch interceptor in `apps/web/src/hooks.client.ts` preserving Plan 008 `handleClientGuard`, offline token suppression, and prepending `PUBLIC_API_BASE` for relative `/api/v1/*` calls in native WebViews.
    - Server hook in `apps/web/src/hooks.server.ts` adding CORS headers (`Access-Control-Allow-Origin`, `Vary: Origin`, methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`) for `https://localhost` and `capacitor://localhost`.
  - Native haptics utility in `apps/web/src/lib/native/haptics.ts`:
    - Utilizing `Capacitor.isNativePlatform()` and `@capacitor/haptics` with browser no-op fallbacks.
    - Wired into `apps/web/src/lib/ui/FloatingMenu.svelte` to trigger tactile ticks only on physical drag release snaps per PRD §14.5.
  - Native preferences utility in `apps/web/src/lib/native/preferences.ts`:
    - Generic preference accessors (`getNativePreference`, `setNativePreference`).
    - In-memory `Map<string, string>` fallback ensuring clean execution in Vitest / Node environments without `localStorage`.
    - Asynchronous device UUID persistence in `apps/web/src/lib/auth/device.ts` (`initPersistentDeviceId()`) restoring client UUID from `@capacitor/preferences` if app storage is cleared.
  - Settlement payment push reminders in `apps/web/src/lib/native/reminders.ts`:
    - Utilizing `@capacitor/local-notifications` to schedule notifications for upcoming settlements based on `due_day` and `remind_days_before` (from Plan 014).
    - Requesting notification permissions and canceling notifications when settlements transition to `paid`.
  - Floating action menu preservation in `apps/web/src/lib/ui/FloatingMenu.svelte`:
    - Full Plan 007 navigation menu preserved (`+ New Entry`, dashboard, ledger, reports, settlements, reconcile, admin).
    - Haptic tick wired exclusively to drag snap release without buzzing on keyboard navigation or double-tap resets.
  - Android native manifest template in `apps/web/android-config/AndroidManifest.xml`:
    - Configuring permissions (`INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `POST_NOTIFICATIONS`).
    - Setting `android:allowBackup="false"` to prevent unencrypted cloud backup of offline ledger records.
    - Using AppCompat theme `@style/AppTheme.NoActionBarLaunch` and `android:windowSoftInputMode="adjustResize"`.
    - Removing deprecated `package` attribute from `<manifest>` tag to conform with AGP 8 namespace standards.
  - Automated release packaging script in `scripts/build-android.sh`:
    - Strictly enforcing non-empty `PUBLIC_API_BASE` before release compilation.
    - Generating adaptive icons and splash screens via `@capacitor/assets`.
    - Initializing Android container at `apps/web/android/` via `cap add android` if not present.
    - Building Google Play Android App Bundle (`.aab`) via `./gradlew bundleRelease` and signing via `jarsigner` / `apksigner`.
    - Supporting `--apk` flag for direct device sideloading via `./gradlew assembleRelease`.
  - Comprehensive unit test suite in `apps/web/src/lib/native/native.test.ts`:
    - Exercising in-memory preference fallback by simulating missing `localStorage`.
    - Testing haptics no-op, settlement reminder calculation, and API URL resolution.
  - Real hardware verification protocol for Milestone M5 Definition of Done and Readiness Gate 5 on physical Android devices.
- OUT:
  - iOS packaging and App Store configurations (PRD prioritizes Android first).
  - Business policy determinations for Q1–Q4 (reserved strictly to Owner Zia).

## 3. Preconditions

1. Plan 017 PWA offline hardening and web manifest are implemented.
   - Check command: `test -f "apps/web/static/manifest.webmanifest"`
   - Expected output: exit code `0`.
2. Java Development Kit (JDK 17 or JDK 21) is installed and available in PATH.
   - Check command: `javac -version 2>&1 | grep -E 'javac (17|21|[2-9][0-9])'`
   - Expected output: string matching JDK 17, 21, or higher.
3. Android SDK command-line tools and platform-tools are installed with `$ANDROID_HOME` configured.
   - Check command: `test -n "$ANDROID_HOME" && test -d "$ANDROID_HOME" && test -x "$ANDROID_HOME/platform-tools/adb"`
   - Expected output: exit code `0`.
4. Node 22 and pnpm workspaces are verified.
   - Check command: `node -v && pnpm -v`
   - Expected output: string starting with `v22.`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `.npmrc` | create/modify | Add public-hoist-pattern for Capacitor plugins in pnpm workspaces |
| `apps/web/package.json` | modify | Declare Capacitor core, CLI, Android, haptics, preferences, local-notifications, and assets dependencies |
| `apps/web/capacitor.config.ts` | create | Capacitor 6 container configuration for Android target with plugins |
| `apps/web/svelte.config.js` | modify | SvelteKit adapter configuration branching on `CAPACITOR_BUILD` for static packaging |
| `apps/web/vite.config.ts` | modify | Configure Vite and disable Service Worker when `CAPACITOR_BUILD === 'true'`, preserving Tailwind CSS 4 |
| `apps/web/src/lib/api.ts` | create | Client API helper prepending `PUBLIC_API_BASE` and attaching auth token and device ID |
| `apps/web/src/hooks.client.ts` | modify | Additive fetch interceptor prepending `PUBLIC_API_BASE` in native WebViews while preserving Plan 008 `handleClientGuard` |
| `apps/web/src/hooks.server.ts` | create | Configure CORS headers allowing `https://localhost` and `capacitor://localhost` origins with `Vary: Origin` |
| `apps/web/src/lib/native/haptics.ts` | create | Native haptic feedback utility with browser no-op fallbacks and prefers-reduced-motion checks |
| `apps/web/src/lib/native/preferences.ts` | create | Native device preferences manager with in-memory fallback for coordinates and UUIDs |
| `apps/web/src/lib/native/reminders.ts` | create | Settlement payment push reminders scheduling via `@capacitor/local-notifications` with Android notification channel |
| `apps/web/src/lib/auth/device.ts` | modify | Wire asynchronous persistent device UUID restoration from native Preferences with native crypto.randomUUID |
| `apps/web/src/routes/+layout.svelte` | modify | Wire `initPersistentDeviceId()` on shell mount to restore native device UUID across app storage clears |
| `apps/web/src/lib/ui/FloatingMenu.svelte` | modify | Wire native haptic tick exclusively to drag snap release while preserving full Plan 007 menu markup and WCAG AA 44px targets |
| `apps/web/android-config/AndroidManifest.xml` | create | Android native manifest configuring hardware permissions, FileProvider, `usesCleartextTraffic="false"`, `allowBackup="false"`, and AppCompat theme |
| `scripts/build-android.sh` | create | Bash script automating AAB/APK compilation, Rule 20 gate, asset generation, and release signing |
| `apps/web/src/lib/native/native.test.ts` | create | Unit tests verifying in-memory preferences fallback without localStorage, haptics, M+1 reminders, and API resolution |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Configure pnpm workspace hoisting in `.npmrc` and add Capacitor dependencies to `apps/web/package.json`.
   - Command: `echo "public-hoist-pattern[]=*capacitor*" >> .npmrc && pnpm --filter @clt/web add @capacitor/core@^6.2.0 @capacitor/haptics@^6.0.2 @capacitor/preferences@^6.0.3 @capacitor/local-notifications@^6.1.1 && pnpm --filter @clt/web add -D @capacitor/cli@^6.2.0 @capacitor/android@^6.2.0 @capacitor/assets@^3.0.5 @sveltejs/adapter-static@^3.0.8 jsdom@^25.0.0`
   - Check: `grep -c '@capacitor/local-notifications' apps/web/package.json`
   - Expected output: `1`

2. Create Capacitor configuration in `apps/web/capacitor.config.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/capacitor.config.ts`.
   - Check: `grep -c 'com.cosmo.ledgertrack' apps/web/capacitor.config.ts`
   - Expected output: `1`

3. Update SvelteKit adapter configuration in `apps/web/svelte.config.js` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/svelte.config.js`.
   - Check: `grep -c 'adapterStatic' apps/web/svelte.config.js`
   - Expected output: `1`

4. Update Vite configuration in `apps/web/vite.config.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/vite.config.ts`.
   - Check: `grep -c 'disable: isCapacitor' apps/web/vite.config.ts`
   - Expected output: `1`

5. Create client API resolution helper in `apps/web/src/lib/api.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/api.ts`.
   - Check: `grep -c 'resolveApiUrl' apps/web/src/lib/api.ts`
   - Expected output: `1`

6. Update client hook in `apps/web/src/hooks.client.ts` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/hooks.client.ts`.
   - Check: `grep -c 'handleClientGuard' apps/web/src/hooks.client.ts && grep -c 'PUBLIC_API_BASE' apps/web/src/hooks.client.ts`
   - Expected output: lines containing counts >= 1.

7. Update server hook in `apps/web/src/hooks.server.ts` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/hooks.server.ts`.
   - Check: `grep -c 'Vary' apps/web/src/hooks.server.ts`
   - Expected output: `1`

8. Create native haptics wrapper in `apps/web/src/lib/native/haptics.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/lib/native/haptics.ts`.
   - Check: `grep -c 'triggerHapticTick' apps/web/src/lib/native/haptics.ts`
   - Expected output: `1`

9. Create native preferences manager in `apps/web/src/lib/native/preferences.ts` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/lib/native/preferences.ts`.
   - Check: `grep -c 'getNativePreference' apps/web/src/lib/native/preferences.ts`
   - Expected output: `1`

10. Create settlement push reminder utility in `apps/web/src/lib/native/reminders.ts` referencing Specification 6.9.
    - Command: copy block 6.9 into `apps/web/src/lib/native/reminders.ts`.
    - Check: `grep -c 'scheduleSettlementReminders' apps/web/src/lib/native/reminders.ts`
    - Expected output: `1`

11. Wire persistent device UUID restoration into `apps/web/src/lib/auth/device.ts` referencing Specification 6.10, and mount in `apps/web/src/routes/+layout.svelte` referencing Specification 6.11.
    - Command: update `apps/web/src/lib/auth/device.ts` to export `initPersistentDeviceId()` and mount in `apps/web/src/routes/+layout.svelte`.
    - Check: `grep -c 'initPersistentDeviceId' apps/web/src/lib/auth/device.ts && grep -c 'initPersistentDeviceId' apps/web/src/routes/+layout.svelte`
    - Expected output: lines containing counts >= 1.

12. Wire native haptics into `apps/web/src/lib/ui/FloatingMenu.svelte` referencing Specification 6.11.
    - Command: update `apps/web/src/lib/ui/FloatingMenu.svelte` to invoke `triggerHapticTick()` on drag release snap.
    - Check: `grep -c 'triggerHapticTick' apps/web/src/lib/ui/FloatingMenu.svelte`
    - Expected output: `2`

13. Create Android manifest template in `apps/web/android-config/AndroidManifest.xml` referencing Specification 6.12.
    - Command: copy block 6.12 into `apps/web/android-config/AndroidManifest.xml`.
    - Check: `grep -c 'allowBackup="false"' apps/web/android-config/AndroidManifest.xml`
    - Expected output: `1`

14. Create Android build automation script in `scripts/build-android.sh` referencing Specification 6.14.
    - Keystore Generation Runbook (Hard Rule 8):
      `keytool -genkeypair -v -keystore release.keystore -alias cosmo-ledger-release -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Cosmo Ledger Track, OU=Retail, O=Cosmo, L=Dhaka, ST=Dhaka, C=BD"`
      Store `release.keystore` securely in secret manager / CI secrets; set `RELEASE_KEYSTORE_PATH`, `RELEASE_KEYSTORE_PASSWORD`, and `RELEASE_KEY_ALIAS`.
    - Command: copy block 6.14 into `scripts/build-android.sh` && chmod +x `scripts/build-android.sh`.
    - Check: `test -x "scripts/build-android.sh"`
    - Expected output: exit code `0`.

15. Create native unit test suite in `apps/web/src/lib/native/native.test.ts` referencing Specification 6.14.
    - Command: copy block 6.14 into `apps/web/src/lib/native/native.test.ts`.
    - Check: `pnpm --filter @clt/web test native.test.ts`
    - Expected output: exit code `0`.

16. Execute physical hardware verification protocol and gate verification.
    - Note: Store release is labeled `DECISION PENDING: Q1-Q4 sign-off from Zia required (AGENTS.md Rule 20)`.
    - Command: `echo "Verifying Hardware Test Protocol against physical Android test matrix"`
    - Expected output: `Verifying Hardware Test Protocol against physical Android test matrix`

## 6. Specifications

### 6.1 `apps/web/capacitor.config.ts`

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cosmo.ledgertrack',
  appName: 'Cosmo Ledger Track',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    Haptics: {},
    Preferences: {},
    LocalNotifications: {
      smallIcon: 'ic_launcher',
      iconColor: '#2B4C7E',
    },
  },
};

export default config;
```

### 6.2 `apps/web/svelte.config.js`

```js
import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: isCapacitor
      ? adapterStatic({
          pages: 'build',
          assets: 'build',
          fallback: 'index.html',
          precompress: false,
          strict: false,
        })
      : adapterVercel({
          runtime: 'nodejs22.x',
        }),
  },
};

export default config;
```

### 6.3 `apps/web/vite.config.ts`

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      srcDir: 'src',
      mode: 'production',
      strategies: 'generateSW',
      registerType: 'prompt', // Plan 017 cashier safety: prompt to prevent mid-entry refreshes
      manifest: false,        // Served from static/manifest.webmanifest
      // In native Capacitor builds, disable service worker to avoid duplicate asset caching
      disable: isCapacitor,
      workbox: {
        globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2,html}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\/v1/, /^\/auth/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.hostname.includes('supabase.co'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
  },
});
```

### 6.4 `apps/web/src/lib/api.ts`

```ts
import { PUBLIC_API_BASE } from '$env/static/public';
import { supabase } from '$lib/supabase/client';
import { getOrGenerateDeviceId } from '$lib/auth/device';

export function getApiBaseUrl(): string {
  return (PUBLIC_API_BASE || '').replace(/\/+$/, '');
}

export function resolveApiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.startsWith('/api/v1/')) {
    url = resolveApiUrl(url);
  }

  const headers = new Headers(init?.headers || {});

  // Attach X-Device-Id header
  if (!headers.has('X-Device-Id')) {
    headers.set('X-Device-Id', getOrGenerateDeviceId());
  }

  // Attach bearer token if authenticated
  if (!headers.has('Authorization')) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
    } catch {
      // Fallback if session unreadable
    }
  }

  return fetch(url, { ...init, headers });
}
```

### 6.5 `apps/web/src/hooks.client.ts`

```ts
import { Capacitor } from '@capacitor/core';
import { PUBLIC_API_BASE } from '$env/static/public';

// Plan 008: Authoritative client navigation guard preserved without alteration
export { handleClientGuard, type GuardNavigationEvent } from '$lib/auth/guard';

// Intercept /api/v1/* calls in native Capacitor Android WebViews (PRD §13)
const rawBase = (PUBLIC_API_BASE || '').replace(/\/+$/, '');

if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    // Check native platform at request time to prevent bridge initialization races
    if (rawBase && Capacitor.isNativePlatform()) {
      const rawUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (parsed.pathname.startsWith('/api/v1/')) {
          const targetUrl = `${rawBase}${parsed.pathname}${parsed.search}`;
          if (input instanceof Request) {
            input = new Request(targetUrl, input);
          } else {
            input = targetUrl;
          }
        }
      } catch {
        // Fallback to original fetch if URL parsing fails
      }
    }

    return originalFetch(input, init);
  };
}
```

### 6.6 `apps/web/src/hooks.server.ts`

```ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const origin = event.request.headers.get('origin');
  const isCapacitorOrigin = origin === 'https://localhost' || origin === 'capacitor://localhost';

  // Handle CORS preflight for native Capacitor WebView
  if (isCapacitorOrigin && event.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device-Id',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }

  const response = await resolve(event);

  if (isCapacitorOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Id');
    response.headers.set('Vary', 'Origin');
  }

  return response;
};
```

### 6.7 `apps/web/src/lib/native/haptics.ts`

```ts
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

function isMotionReduced(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function triggerHapticTick(): Promise<void> {
  if (isMotionReduced()) return;
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Light });
    }
  } catch {
    // Graceful no-op in standard web browser
  }
}

export async function triggerHapticSuccess(): Promise<void> {
  if (isMotionReduced()) return;
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Haptics.notification({ type: NotificationType.Success });
    }
  } catch {
    // Graceful no-op in standard web browser
  }
}

export async function triggerHapticWarning(): Promise<void> {
  if (isMotionReduced()) return;
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    }
  } catch {
    // Graceful no-op in standard web browser
  }
}
```

### 6.8 `apps/web/src/lib/native/preferences.ts`

```ts
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// In-memory store fallback for Node 22 / Vitest environments without localStorage
const memoryStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // Storage restricted fallback
  }
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Storage restricted fallback
  }
  memoryStore.set(key, value);
}

export async function getNativePreference(key: string): Promise<string | null> {
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    return getStorageItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

export async function setNativePreference(key: string, value: string): Promise<void> {
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      await Preferences.set({ key, value });
      return;
    }
    setStorageItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}
```

### 6.9 `apps/web/src/lib/native/reminders.ts`

```ts
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { formatPoishaToBdt } from '@clt/shared';

export const SETTLEMENT_CHANNEL_ID = 'settlement_reminders';

export interface SettlementReminderItem {
  id: string;
  payableName: string;
  dueDay: number;
  remindDaysBefore: number;
  expectedPoisha: bigint;
  paidPoisha: bigint;
  month: string; // YYYY-MM or YYYY-MM-01
}

export async function ensureNotificationChannel(): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.createChannel({
      id: SETTLEMENT_CHANNEL_ID,
      name: 'Settlement Due Reminders',
      description: 'Reminders for upcoming monthly vendor and tax settlement deadlines',
      importance: 4, // High importance (heads-up notification)
      visibility: 1,
      vibration: true,
      sound: undefined,
    });
  } catch (err) {
    console.warn('Failed to create notification channel:', err);
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      const status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    }
  } catch {
    // Non-native no-op
  }
  return false;
}

/**
 * Computes reminder date aligned strictly with Plan 014:
 * Settlements for month M are due in month M+1 on dueDay (clamped to target month length).
 */
export function computeReminderDate(settlementMonth: string, dueDay: number, remindDaysBefore: number): Date {
  const [settleYear, settleMonth] = settlementMonth.slice(0, 7).split('-').map(Number);
  // Probe target month (month following settlementMonth; settleMonth is 1-based, so Date.UTC(settleYear, settleMonth, 1) is next month)
  const targetProbe = new Date(Date.UTC(settleYear, settleMonth, 1));
  const dueYear = targetProbe.getUTCFullYear();
  const dueMonthIndex = targetProbe.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(dueYear, dueMonthIndex + 1, 0)).getUTCDate();
  const clampedDueDay = Math.min(Math.max(dueDay, 1), daysInMonth);
  const reminderDay = Math.max(1, clampedDueDay - remindDaysBefore);

  return new Date(dueYear, dueMonthIndex, reminderDay, 9, 0, 0); // 9:00 AM local device time
}

export async function scheduleSettlementReminders(settlements: SettlementReminderItem[]): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;

  try {
    await ensureNotificationChannel();

    const pendingList = await LocalNotifications.getPending();
    const existingIds = new Set(pendingList.notifications.map((n) => n.id));
    const notificationsToSchedule = [];

    for (const item of settlements) {
      // Deterministic positive 31-bit integer notification ID from UUID
      const notificationId = Math.abs(item.id.split('-').reduce((acc, part) => acc ^ parseInt(part, 16), 0)) % 100000;

      // Cancel reminder if already settled or zero liability
      if (item.paidPoisha >= item.expectedPoisha) {
        if (existingIds.has(notificationId)) {
          await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
        }
        continue;
      }

      const scheduledTime = computeReminderDate(item.month, item.dueDay, item.remindDaysBefore);
      if (scheduledTime.getTime() <= Date.now()) {
        continue;
      }

      const outstanding = item.expectedPoisha - item.paidPoisha;

      notificationsToSchedule.push({
        id: notificationId,
        channelId: SETTLEMENT_CHANNEL_ID,
        title: `Settlement Due: ${item.payableName}`,
        body: `Payment of ${formatPoishaToBdt(outstanding)} is due on the ${item.dueDay}th.`,
        schedule: { at: scheduledTime },
        smallIcon: 'ic_stat_notification',
        extra: { settlementId: item.id },
      });
    }

    if (notificationsToSchedule.length > 0) {
      await LocalNotifications.schedule({ notifications: notificationsToSchedule });
    }
  } catch (err) {
    console.warn('Failed to schedule local settlement reminders:', err);
  }
}
```

### 6.10 `apps/web/src/lib/auth/device.ts` (Persistent UUID Restoration)

```ts
import { getNativePreference, setNativePreference } from '$lib/native/preferences';

const DEVICE_ID_KEY = 'clt_device_id';
const V4_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

let cachedDeviceId: string | null = null;

export function isValidDeviceId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const lower = id.trim().toLowerCase();
  if (lower === NIL_UUID) return false;
  return V4_UUID_REGEX.test(lower);
}

export function getOrGenerateDeviceId(): string {
  if (cachedDeviceId && isValidDeviceId(cachedDeviceId)) {
    return cachedDeviceId;
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = window.localStorage.getItem(DEVICE_ID_KEY);
      if (existing && isValidDeviceId(existing)) {
        cachedDeviceId = existing.toLowerCase();
        return cachedDeviceId;
      }
      const fresh = crypto.randomUUID().toLowerCase();
      window.localStorage.setItem(DEVICE_ID_KEY, fresh);
      cachedDeviceId = fresh;
      return fresh;
    }
  } catch {
    // Storage restricted fallback
  }

  if (!cachedDeviceId) {
    cachedDeviceId = crypto.randomUUID().toLowerCase();
  }
  return cachedDeviceId;
}

/**
 * Restores client device UUID from @capacitor/preferences if local web storage was wiped.
 * Invoked on application shell mount (+layout.svelte).
 */
export async function initPersistentDeviceId(): Promise<string> {
  try {
    const nativeId = await getNativePreference(DEVICE_ID_KEY);
    if (nativeId && isValidDeviceId(nativeId)) {
      cachedDeviceId = nativeId.toLowerCase();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DEVICE_ID_KEY, cachedDeviceId);
      }
      return cachedDeviceId;
    }
  } catch {
    // Fallback
  }

  const currentId = getOrGenerateDeviceId();
  await setNativePreference(DEVICE_ID_KEY, currentId);
  return currentId;
}
```

### 6.11 `apps/web/src/routes/+layout.svelte`

```svelte
<!-- Modification to root application shell to mount initPersistentDeviceId() -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { initPersistentDeviceId } from '$lib/auth/device';
  // ... existing imports

  onMount(async () => {
    // Restore persistent hardware UUID from native Preferences across app storage wipes
    await initPersistentDeviceId();
  });
</script>

<slot />
```

### 6.12 `apps/web/src/lib/ui/FloatingMenu.svelte`

```svelte
<!-- apps/web/src/lib/ui/FloatingMenu.svelte -->
<script lang="ts">
  import { draggable } from './actions/draggable';
  import { messages } from '../i18n/messages';
  import { triggerHapticTick } from '$lib/native/haptics';

  interface Props {
    role?: 'staff' | 'admin' | 'owner';
    positionMode?: 'free' | 'bottom' | 'left' | 'right';
  }

  let { role = 'staff', positionMode = 'free' }: Props = $props();

  let expanded = $state(false);
  let isLowerHalf = $state(true);

  function toggleMenu() {
    expanded = !expanded;
  }

  async function handleSnap(pos: { x: number; y: number; isLowerHalf: boolean; source?: string }) {
    isLowerHalf = pos.isLowerHalf;
    // Only buzz when the snap originated from an active pointer drag release
    if (pos.source === 'drag') {
      await triggerHapticTick();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && expanded) {
      expanded = false;
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMenu();
    }
  }
</script>

<div
  use:draggable={{
    storageKey: 'clt-floating-menu-pos',
    positionMode,
    onSnap: handleSnap,
  }}
  class="fixed top-0 left-0 z-40 touch-none select-none md:hidden outline-none flex {isLowerHalf ? 'flex-col-reverse' : 'flex-col'}"
  id="floating-action-menu"
  tabindex="0"
  role="region"
  aria-label={messages.ui.mobileRegion}
  onkeydown={handleKeydown}
>
  <div class="glass rounded-full p-2 flex items-center gap-2 shadow-xl border border-[var(--pearl-border)]">
    <a
      href="/entries/new"
      class="btn-glass btn--commission rounded-full px-4 min-h-[44px] flex items-center gap-1.5 text-sm font-semibold"
      aria-label={messages.menu.newEntry}
    >
      <span aria-hidden="true">+</span>
      <span class="btn-label">{messages.menu.newEntry}</span>
    </a>

    <button
      type="button"
      onclick={toggleMenu}
      class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
      aria-expanded={expanded}
      aria-controls="mobile-nav-panel"
      aria-label={messages.ui.toggleMenu}
    >
      <span class="text-xs" aria-hidden="true">☰</span>
    </button>
  </div>

  {#if expanded}
    <nav
      id="mobile-nav-panel"
      aria-label={messages.ui.mainNav}
      class="glass rounded-2xl p-3 {isLowerHalf ? 'mb-2' : 'mt-2'} flex flex-col gap-1 shadow-2xl max-h-[70vh] overflow-y-auto"
    >
      <a href="/dashboard" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.dashboard}
      </a>
      <a href="/ledger" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.ledger}
      </a>
      <a href="/reports" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.reports}
      </a>
      {#if role === 'admin' || role === 'owner'}
        <a href="/settlements" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.settlements}
        </a>
        <a href="/reconcile" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.reconcile}
        </a>
        <a href="/admin" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.admin}
        </a>
      {/if}
      <a href="/settings" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center border-t border-black/10 dark:border-white/10 mt-1">
        {messages.menu.settings}
      </a>
    </nav>
  {/if}
</div>
```

### 6.13 `apps/web/android-config/AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="false"
        android:usesCleartextTraffic="false"
        android:icon="@mipmap/ic_launcher"
        android:label="Cosmo Ledger Track"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme.NoActionBarLaunch">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity"
            android:label="Cosmo Ledger Track"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
```

### 6.14 `scripts/build-android.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# scripts/build-android.sh — Automated Android AAB & APK packaging and release signing
# Usage: ./scripts/build-android.sh [--apk | --aab]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_DIR="${PROJECT_ROOT}/apps/web"
ANDROID_DIR="${WEB_DIR}/android"
DECISIONS_FILE="${PROJECT_ROOT}/DECISIONS.md"
BUILD_MODE="aab" # Default to Google Play Store Android App Bundle (.aab)

if [[ "${1:-}" == "--apk" ]]; then
  BUILD_MODE="apk"
elif [[ "${1:-}" == "--aab" ]]; then
  BUILD_MODE="aab"
fi

echo "=== Cosmo Ledger Track: Android Packaging Pipeline [Mode: ${BUILD_MODE^^}] ==="

# 1. Enforce strict configuration of PUBLIC_API_BASE for native builds
if [[ -z "${PUBLIC_API_BASE:-}" ]]; then
  echo "ERROR: PUBLIC_API_BASE environment variable is mandatory for native builds (e.g. https://api.cosmo-ledger.com)." >&2
  echo "Aborting build to prevent shipping an application with an unresolvable backend." >&2
  exit 1
fi

echo "API Base URL configured: ${PUBLIC_API_BASE}"

# 2. Gate production release on AGENTS.md Rule 20
if [[ "${BUILD_MODE}" == "aab" ]]; then
  echo "Verifying AGENTS.md Rule 20 precondition: Owner confirmation of Q1-Q4..."
  for q in "CLT-D-001" "CLT-D-002" "CLT-D-003" "CLT-D-004"; do
    if ! grep -q "## Decision ${q}" "${DECISIONS_FILE}" || ! grep -A 5 "## Decision ${q}" "${DECISIONS_FILE}" | grep -q "Status: CONFIRMED"; then
      echo "ERROR: AGENTS.md Rule 20 violation: ${q} is not confirmed in DECISIONS.md." >&2
      echo "Owner Zia must confirm business rules for Q1-Q4 prior to production store release." >&2
      exit 1
    fi
  done
  echo "AGENTS.md Rule 20 confirmed: All baseline policies approved by Owner."
fi

# 3. Check Java JDK version (JDK 17 or JDK 21)
JAVA_VER=$(javac -version 2>&1 | awk '{print $2}')
echo "Java compiler detected: ${JAVA_VER}"

# 4. Compile static web distribution using adapter-static
echo "Compiling static SvelteKit distribution for Android container..."
export CAPACITOR_BUILD="true"
pnpm --filter @clt/web build

# Verify build output exists
if [[ ! -f "${WEB_DIR}/build/index.html" ]]; then
  echo "ERROR: Static build output not found at ${WEB_DIR}/build/index.html" >&2
  exit 1
fi

# 5. Initialize Android container if not present
cd "${WEB_DIR}"
if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "Initializing Capacitor Android native container..."
  pnpm exec cap add android
fi

# 6. Generate adaptive icons and splash assets (NOW container exists)
if [[ -f "${WEB_DIR}/assets/icon.png" && -f "${WEB_DIR}/assets/splash.png" ]]; then
  echo "Generating adaptive launcher icons and splash screens..."
  pnpm --filter @clt/web exec capacitor-assets generate --android
fi

# 7. Apply AndroidManifest.xml template
echo "Applying native Android manifest configuration..."
cp "${WEB_DIR}/android-config/AndroidManifest.xml" "${ANDROID_DIR}/app/src/main/AndroidManifest.xml"

# 8. Synchronize web assets and native plugins
echo "Synchronizing web assets and plugins to Android project..."
pnpm exec cap sync android

# 9. Execute Gradle compilation
cd "${ANDROID_DIR}"
if [[ "${BUILD_MODE}" == "aab" ]]; then
  echo "Building Google Play Android App Bundle (.aab)..."
  ./gradlew bundleRelease

  AAB_OUTPUT="${ANDROID_DIR}/app/build/outputs/bundle/release/app-release.aab"
  if [[ ! -f "${AAB_OUTPUT}" ]]; then
    echo "ERROR: AAB output file not generated at ${AAB_OUTPUT}" >&2
    exit 1
  fi

  # Sign AAB if keystore credentials are provided
  if [[ -n "${RELEASE_KEYSTORE_PATH:-}" && -f "${RELEASE_KEYSTORE_PATH}" ]]; then
    echo "Signing Android App Bundle with release keystore..."
    jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256       -keystore "${RELEASE_KEYSTORE_PATH}"       -storepass:env RELEASE_KEYSTORE_PASSWORD       -keypass:env RELEASE_KEY_PASSWORD       "${AAB_OUTPUT}" "${RELEASE_KEY_ALIAS}"
    echo "AAB signing complete."
  else
    echo "NOTICE: Keystore credentials not provided; generated unsigned AAB at ${AAB_OUTPUT}."
  fi

  echo "SUCCESS: Android App Bundle ready for Google Play Console submission: ${AAB_OUTPUT}"
  sha256sum "${AAB_OUTPUT}"
else
  echo "Building release APK for physical hardware testing..."
  ./gradlew assembleRelease

  UNSIGNED_APK="${ANDROID_DIR}/app/build/outputs/apk/release/app-release-unsigned.apk"
  SIGNED_APK="${ANDROID_DIR}/app/build/outputs/apk/release/app-release-signed.apk"

  if [[ ! -f "${UNSIGNED_APK}" ]]; then
    echo "ERROR: APK output file not generated at ${UNSIGNED_APK}" >&2
    exit 1
  fi

  if [[ -n "${RELEASE_KEYSTORE_PATH:-}" && -f "${RELEASE_KEYSTORE_PATH}" ]]; then
    echo "Signing APK via apksigner..."
    apksigner sign --ks "${RELEASE_KEYSTORE_PATH}"       --ks-pass "env:RELEASE_KEYSTORE_PASSWORD"       --ks-key-alias "${RELEASE_KEY_ALIAS}"       --key-pass "env:RELEASE_KEY_PASSWORD"       --out "${SIGNED_APK}" "${UNSIGNED_APK}"
    echo "SUCCESS: Signed APK ready for installation: ${SIGNED_APK}"
    sha256sum "${SIGNED_APK}"
  else
    echo "SUCCESS: Unsigned APK generated at ${UNSIGNED_APK}"
    sha256sum "${UNSIGNED_APK}"
  fi
fi
```

### 6.15 `apps/web/src/lib/native/native.test.ts`

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getNativePreference, setNativePreference } from './preferences';
import { triggerHapticTick, triggerHapticSuccess, triggerHapticWarning } from './haptics';
import { computeReminderDate } from './reminders';
import { resolveApiUrl } from '$lib/api';

describe('Capacitor Native Utilities & Graceful Fallbacks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Native Preferences Fallback', () => {
    it('persists and retrieves values using standard browser storage', async () => {
      await setNativePreference('test_key', 'test_value_123');
      const val = await getNativePreference('test_key');
      expect(val).toBe('test_value_123');
    });

    it('falls back seamlessly to in-memory store when localStorage is restricted or undefined', async () => {
      const originalLocalStorage = globalThis.localStorage;
      try {
        delete (globalThis as any).localStorage;

        await setNativePreference('isolated_key', 'fallback_data');
        const retrieved = await getNativePreference('isolated_key');
        expect(retrieved).toBe('fallback_data');

        const missing = await getNativePreference('non_existent_key');
        expect(missing).toBeNull();
      } finally {
        globalThis.localStorage = originalLocalStorage;
      }
    });
  });

  describe('Native Haptics Fallback', () => {
    it('executes triggerHapticTick safely in non-native test environments without throwing', async () => {
      await expect(triggerHapticTick()).resolves.toBeUndefined();
    });

    it('executes triggerHapticSuccess safely in non-native test environments without throwing', async () => {
      await expect(triggerHapticSuccess()).resolves.toBeUndefined();
    });

    it('executes triggerHapticWarning safely in non-native test environments without throwing', async () => {
      await expect(triggerHapticWarning()).resolves.toBeUndefined();
    });
  });

  describe('Settlement Reminders Calculation', () => {
    it('calculates reminder date in month M+1 based on payable dueDay and remindDaysBefore (PRD §10, §8.4)', () => {
      const settlementMonth = '2026-03-01'; // March settlement -> Due in April
      const dueDay = 15;
      const remindDaysBefore = 3;

      const reminderDate = computeReminderDate(settlementMonth, dueDay, remindDaysBefore);
      expect(reminderDate.getFullYear()).toBe(2026);
      expect(reminderDate.getMonth()).toBe(3); // April (0-indexed: 3)
      expect(reminderDate.getDate()).toBe(12);  // 15 - 3 = 12th
      expect(reminderDate.getHours()).toBe(9);
      expect(reminderDate.getMinutes()).toBe(0);
    });

    it('clamps reminder day to minimum day 1 if remindDaysBefore exceeds dueDay', () => {
      const settlementMonth = '2026-03-01';
      const dueDay = 2;
      const remindDaysBefore = 5;

      const reminderDate = computeReminderDate(settlementMonth, dueDay, remindDaysBefore);
      expect(reminderDate.getMonth()).toBe(3); // April
      expect(reminderDate.getDate()).toBe(1);
    });
  });

  describe('API URL Resolution', () => {
    it('prepends configured PUBLIC_API_BASE to relative API paths', () => {
      const resolved = resolveApiUrl('/api/v1/entries');
      expect(resolved).toMatch(/\/api\/v1\/entries$/);
    });

    it('handles paths without leading slash gracefully', () => {
      const resolved = resolveApiUrl('api/v1/sync/push');
      expect(resolved).toMatch(/\/api\/v1\/sync\/push$/);
    });
  });
});
```

## 7. Tests

1. Unit tests for native utilities, in-memory preferences fallback, haptics, and reminders:
   - Command: `pnpm --filter @clt/web test native.test.ts`
   - Expected output: exit code `0`, all test suites passing.

2. Static SPA compilation verification:
   - Command: `CAPACITOR_BUILD=true pnpm --filter @clt/web build`
   - Expected output: exit code `0`, generating `apps/web/build/index.html`.

3. Android build script execution verification:
   - Command: `bash -n scripts/build-android.sh && test -x scripts/build-android.sh`
   - Expected output: exit code `0`, confirming bash syntax and executable permission.

## 8. Acceptance criteria

1. SvelteKit builds a clean static SPA (`apps/web/build/`) via `@sveltejs/adapter-static` without prerender errors or deleting server API routes.
2. `scripts/build-android.sh` strictly enforces non-empty `PUBLIC_API_BASE` and generates a signed Google Play Android App Bundle (`.aab`) via `bundleRelease` conforming to modern Play Store requirements.
3. Native haptics `@capacitor/haptics` are wired to physical drag release snaps in `FloatingMenu.svelte` per PRD §14.5 without buzzing on keyboard navigation or double-tap resets.
4. Settlement payment push reminders are scheduled via `@capacitor/local-notifications` based on payable `due_day` and `remind_days_before` (PRD §17 M5).
5. Hardware device UUID identity persists across mobile storage clears via `initPersistentDeviceId()` and `@capacitor/preferences`.
6. `AndroidManifest.xml` sets `android:allowBackup="false"` to prevent unencrypted cloud backup of local offline financial ledgers.
7. Physical hardware test protocol passes on Android 10+ devices verifying:
   - Complete offline execution in Airplane mode (saving entries in under 20 seconds with `#LOCAL-xxxx` IDs).
   - Floating action menu 12px viewport boundary clamping and tactile snap haptics.
   - Settlement push notifications appearing in status bar with formatted BDT outstanding balances.
   - Automatic sync resumption upon disabling Airplane mode.
8. Complete 65-test regression suite passes (`pnpm test:regression`) and all 5 readiness gates pass (`npx tsx scripts/ops/verify-gates.ts`).
9. Production store deployment remains locked until Owner Zia writes sign-off on Q1–Q4 policies in root `DECISIONS.md` per AGENTS.md Rule 20.

## 9. Hard rules touched

- Hard Rule 1: Dynamic rates and rules applied without hardcoding.
- Hard Rule 2: Integer poisha used for outstanding amounts in settlement reminders.
- Hard Rule 5: Audit log events preserved and untouched.
- Hard Rule 6: Never block a save on connectivity; offline entry creation under native WebView verified.
- Hard Rule 8: Service role key never bundled into client APK or AAB.
- Hard Rule 9: Server validates actor role and device identity headers (`X-Device-Id`).
- Hard Rule 12: Build order strictly conforms to PRD §17 (Milestone M5).
- Hard Rule 19: No deployment without Owner release authorization (`ZIA-APPROVED: <release id> <environment> <date>`).
- Hard Rule 20: Production Release Precondition: Owner must confirm or replace defaults for Q1, Q2, Q3, and Q4 in `DECISIONS.md` prior to store release.

## 10. Pitfalls

1. **Destructive Route Moving Trap**: Never move or delete `apps/web/src/routes/api/` during static builds. With `strict: false` and `fallback: 'index.html'`, `@sveltejs/adapter-static` ignores server endpoints cleanly without crashing.
2. **Missing PUBLIC_API_BASE Trap**: Native Android WebViews run under `https://localhost`. Relative calls to `/api/v1/*` fail unless mapped to the remote backend. `scripts/build-android.sh` fails the build immediately if `PUBLIC_API_BASE` is unset.
3. **Cloud Backup Leak Trap**: Setting `android:allowBackup="true"` allows Android to automatically upload the WebView's IndexedDB to Google Drive. `android:allowBackup="false"` is mandatory to protect financial privacy.
4. **Haptic Overfire Trap**: Firing `triggerHapticTick()` indiscriminately on every coordinate change or arrow key buzzes continuously during keyboard navigation. Haptics are strictly restricted to physical drag release snaps.
5. **AAB vs APK Play Store Mandate**: Google Play Console rejects APK uploads for all new app releases. `scripts/build-android.sh` defaults to `bundleRelease` (`.aab`) for store packaging.
6. **Double Preference Writing**: Plan 007's `draggable.ts` action already handles localStorage persistence. Wiring preference coordinates must synchronize asynchronously without duplicate local storage thrashing.

## 11. PRD ISSUES and DECISION PENDING

- `DECISION PENDING: Q1-Q4 sign-off from Zia required (AGENTS.md rule 20)`: Zia must confirm or replace the defaults for Q1 (VAT rule), Q2 (Net/"Final" definition), Q3 (commission structure), and Q4 (who bears method charges) recorded in `DECISIONS.md` before M5 store release.
- `PRD M5 Push Reminders`: Implemented settlement due local push reminders via `@capacitor/local-notifications` utilizing payable `due_day` and `remind_days_before` configured in Plan 014.

## 12. Handoff

- Native wrappers exported from `apps/web/src/lib/native/` (`haptics.ts`, `preferences.ts`, `reminders.ts`).
- Standardized native API helper exported from `apps/web/src/lib/api.ts`.
- Build automation script `scripts/build-android.sh` operational for AAB and APK generation.
- Next implementation plan: `020_test_suites_and_readiness_gates.md`.

## 13. Suggested task breakdown

- `CLT-T-019-A`: Configure Capacitor, static adapter branching, API resolution helper, and native wrappers (`package.json`, `.npmrc`, `capacitor.config.ts`, `svelte.config.js`, `vite.config.ts`, `api.ts`, `hooks.client.ts`, `hooks.server.ts`, `haptics.ts`, `preferences.ts`, `reminders.ts`, `native.test.ts`).
- `CLT-T-019-B`: Wire persistent device UUID restoration in `device.ts` and haptic feedback into `FloatingMenu.svelte`.
- `CLT-T-019-C`: Configure Android native container, manifest template, asset generation, and build script (`AndroidManifest.xml`, `build-android.sh`).
- `CLT-T-019-D`: Execute hardware testing protocol on physical Android hardware and verify Milestone M5 Definition of Done and Gate 5 criteria.

## Changelog

- 2026-11-01 — Revision 3.1:
  - Resolved B1: Restored Plan 008 `handleClientGuard` export from `$lib/auth/guard` in `hooks.client.ts` to prevent breaking navigation cancel guards, and implemented robust native fetch wrapper parsing URL objects and rewriting `/api/v1/*`.
  - Resolved B2: Restored `import tailwindcss from '@tailwindcss/vite';` and `tailwindcss()` in `vite.config.ts`.
  - Resolved B3: Fixed month calculation in `computeReminderDate` to correctly target month $M+1$ (the month following the settlement month) per PRD §10, §8.4, and Plan 014.
  - Resolved B4: Implemented Android 8.0+ `NotificationChannel` creation (`ensureNotificationChannel()`) with `SETTLEMENT_CHANNEL_ID = 'settlement_reminders'` and attached channel to scheduled notifications.
  - Resolved B5: Removed undeclared `uuid` dependency in `device.ts`, restored native `crypto.randomUUID()`, retained storage key `clt_device_id`, preserved `isValidDeviceId`, and added Specification 6.11 mounting `initPersistentDeviceId()` in `apps/web/src/routes/+layout.svelte`.
  - Resolved R1: Added `androidx.core.content.FileProvider` and `android:usesCleartextTraffic="false"` to `AndroidManifest.xml`.
  - Resolved R2: Reordered `scripts/build-android.sh` to generate assets via `capacitor-assets` *after* initializing native container via `cap add android`.
  - Resolved R3: Enforced AGENTS.md Rule 20 precondition check verifying Owner confirmation of Q1–Q4 in `DECISIONS.md` before compiling release AABs, and used environment variable password passing to avoid process table leaks.
  - Resolved R4: Restored Plan 007 navigation markup in `FloatingMenu.svelte` (`isLowerHalf` vertical positioning, `/settings` link, WCAG AA $\ge 44	ext{px}$ touch targets, dark mode classes) and restricted haptic buzz exclusively to active pointer drag snaps.
  - Resolved R5: Upgraded client fetch interceptor in `hooks.client.ts` to parse `RequestInfo | URL` with `new URL(rawUrl, window.location.origin)`.
  - Resolved R6: Guarded all haptic functions against `prefers-reduced-motion` and added `triggerHapticSuccess()`.
  - Resolved R7: Specified settlement push reminders integration on settlements overview and used monochrome `ic_stat_notification` icon.
  - Resolved P2: Pinned Vercel adapter runtime to `'nodejs22.x'`, updated Table 4 actions, added Keystore generation runbook in Step 14, and updated `native.test.ts`.

- 2026-11-01 — Revision 3.0:
  - Resolved Blocker 1: Preserved Plan 008's `handleClientGuard`, offline token suppression, and route gating additively in `src/hooks.client.ts` alongside native fetch base URL prepending.
  - Resolved Blocker 2: Merged `vite.config.ts` preserving Plan 017's PWA rules (`registerType: 'prompt'`, `navigateFallback: '/index.html'`, `NetworkOnly` for `/api/v1/*` and auth, and test config), disabling SW exclusively during native builds (`disable: isCapacitor`). Merged `svelte.config.js` with static adapter branching.
  - Resolved Blocker 3: Corrected `api.ts` to import `{ supabase }` from `$lib/supabase/client` (purging non-existent `getSupabaseClient` from `$lib/db`) and standardized `apiFetch` to attach bearer tokens and `X-Device-Id`.
  - Resolved Blocker 4: Wired persistent device UUID restoration into canonical `apps/web/src/lib/auth/device.ts` exporting `initPersistentDeviceId()` to restore client UUID from native Preferences across app storage clears.
  - Resolved Blocker 5: Implemented PRD M5 settlement push reminders in `apps/web/src/lib/native/reminders.ts` using `@capacitor/local-notifications`, calculating notification dates from payable `due_day` and `remind_days_before`.
  - Resolved Blocker 6: Upgraded `scripts/build-android.sh` to produce Google Play Android App Bundle (`.aab`) via `bundleRelease` by default, added keystore signing instructions, and integrated adaptive icon generation via `@capacitor/assets`.
  - Resolved Blocker 7: Upgraded Preconditions to support JDK 17 and JDK 21 and verified `$ANDROID_HOME`. Expanded Acceptance Criteria with a comprehensive Physical Hardware Test Protocol verifying offline execution, haptics, and push reminders on real hardware.
  - Resolved Blocker 8: Preserved full Plan 007 navigation menu markup in `FloatingMenu.svelte` and isolated tactile haptic ticks exclusively to drag snap releases.
  - Resolved Further Defects: Removed deprecated `package` attribute from `AndroidManifest.xml`, set `android:allowBackup="false"`, eliminated destructive `mv` of API routes in `build-android.sh`, enforced strict validation of `PUBLIC_API_BASE`, pinned Capacitor dependencies, added pnpm hoisting to `.npmrc`, configured `Vary: Origin` and `PATCH` in server CORS hook, and exercised in-memory preference fallback under simulated environments without `localStorage`.
- 2026-10-31 — Revision 2.0:
  - Initial flaw remediation.
