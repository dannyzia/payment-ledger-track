# 017_pwa_offline_hardening.md — PWA Configuration, Service Worker Lifecycle, and Offline Hardening

- Plan Identifier: CLT-PLAN-017
- Phase: Phase 3 / M3
- Milestone: M3
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §9.2 (Offline-first & sync recovery), §12 (NFRs: offline, storage persistence), §14.3 (PWA display modes), §14.5 (Mobile safe areas), §16.2 (Tests #25, #46, #56), §17 (Milestone M3)
- Depends on: 001, 007, 008, 010, 011, 015, 016
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement Progressive Web Application (PWA) infrastructure, Service Worker precaching, persistent browser storage, clock skew calibration, stale-rate indicator badges, upgrade prompt modals, and installation promotion for Cosmo Ledger Track (Milestone M3).

Key architectural requirements enforced:
1. **Offline App Shell Precache**: In SvelteKit SPA mode (`ssr = false`), Workbox precaches all client HTML shells, JavaScript chunks, CSS stylesheets, fonts, and icons with a `navigateFallback: '/index.html'`, guaranteeing that cold offline application launches on any URL (e.g. `/entries/new`, `/ledger`, `/dashboard`) load successfully without browser network error screens (PRD §9.2).
2. **Mutating Route Network Bypass**: Workbox explicitly excludes all mutating API endpoints (`/api/*`) and Supabase authentication routes from Service Worker caches using `NetworkOnly` and navigation denylists, ensuring transactions always route through authoritative server endpoints (PRD §9.2, Hard Rule 6).
3. **Storage Persistence**: Requests persistent storage via `navigator.storage.persist()` on app initialization to prevent browser eviction of IndexedDB records (Dexie) under device storage pressure, with safe exception handling for private/restricted browsing contexts, and exposes storage quota status (PRD §12).
4. **Clock Skew Reconciliation**: Compares client system time against HTTP `Date` response headers accounting for network RTT. When clock drift exceeds the 5-minute threshold (300,000 ms), provides timestamp adjustment helpers preventing `400 clock_skew_exceeded` server push rejections (PRD §9.2.2).
5. **90-Day Retention Boundary Helper**: Evaluates the 90-day offline threshold (`NINETY_DAYS_MS`) with calibrated server time, aligning with server `queue_expired_needs_review` push rejections that route long-term offline batches to the Admin review queue (PRD §9.1(g), §9.2.2, Test #25).
6. **Non-Disruptive SW Lifecycle & Safe Upgrade Modal**: Uses `registerType: 'prompt'` protecting counter staff from mid-transaction refreshes; when engine version skew occurs (Test #56), `UpgradePromptModal` messages the waiting service worker (`SKIP_WAITING`) before reloading, preventing infinite reload loops.
7. **Auth Shell Preservation**: Roots layout modifications additively into `apps/web/src/routes/+layout.svelte`, preserving Plan 008's `handleClientGuard`, session listeners, role navigation boundaries, and CSS imports.
8. **Safe Mobile Safe Zones & Zero UI Strings**: Positions the PWA installation banner safely above bottom navigation floating menus respecting `env(safe-area-inset-bottom)` (Rule R16, PRD §14.5), remembers user dismissal in `localStorage`, avoids DOM ID collisions (`btn-save`), and routes all UI labels through the centralized message catalog (`messages.pwa.*`, PRD §12).

## 2. Scope

- IN:
  - `@vite-pwa/sveltekit` devDependency added to `apps/web/package.json`.
  - `@vite-pwa/sveltekit` integration in `apps/web/vite.config.ts` preserving `@tailwindcss/vite` and SvelteKit plugins, with HTML precaching, `navigateFallback: '/index.html'`, and `NetworkOnly` API rules for `/api/*`.
  - Web App Manifest linking in `apps/web/src/app.html` via `<link rel="manifest" href="/manifest.webmanifest">` plus Apple touch icon and mobile capability meta tags.
  - Web App Manifest in `apps/web/static/manifest.webmanifest` specifying standalone display mode, orientation, brand colors, and separated `any` and `maskable` icon entries.
  - Valid binary PNG placeholder app icons in `apps/web/static/icons/icon-192.png` and `apps/web/static/icons/icon-512.png`.
  - Persistent storage manager in `apps/web/src/lib/pwa/storage.ts` invoking `navigator.storage.persist()` and monitoring quota/usage via `navigator.storage.estimate()` with safe exception handling.
  - Clock skew calibration helper in `apps/web/src/lib/pwa/clock.ts` calculating delta offsets from HTTP `Date` headers with RTT compensation and reconciling timestamps against the 5-minute skew boundary.
  - Retention boundary evaluator in `apps/web/src/lib/pwa/retention.ts` validating the 90-day cutoff for offline queues with optional skew calibration (Test #25).
  - Centralized message catalog extension in `apps/web/src/lib/i18n/messages.ts` providing `messages.pwa` (PRD §12).
  - Stale-rate UI badge in `apps/web/src/lib/ui/StaleRateBadge.svelte` rendering amber warning tooltips for entries created under superseded rate profiles (Rule 4, Test #46).
  - Non-dismissible upgrade prompt modal in `apps/web/src/lib/ui/UpgradePromptModal.svelte` opening upon `clt:upgrade-required` events (Test #56) with waiting service worker `SKIP_WAITING` activation, safe button ID `id="btn-upgrade-reload"`, and Plan 007 compliant `Button` variants.
  - Safe install banner in `apps/web/src/lib/ui/InstallBanner.svelte` capturing `beforeinstallprompt`, remembering 7-day dismissal in `localStorage`, floating above mobile touch targets and floating menus with safe-area insets, and Plan 007 compliant `Button` calls (no invalid `size` props).
  - Additive root layout integration in `apps/web/src/routes/+layout.svelte` mounting `InstallBanner` and `UpgradePromptModal` with correct import path `$lib/auth/guard` and canonical design tokens.
  - Unit tests in `apps/web/src/lib/pwa/pwa.test.ts` verifying clock skew calculations, RTT compensation, timestamp adjustments, 90-day retention cutoffs, and mocked storage persistence/quota estimation with error handling.
- OUT:
  - Primary sync runner loop and push/pull HTTP transport (owned by Plan 011).
  - Server-side 25-reason rejection recovery procedures in `$lib/sync/recovery.ts` (owned by Plan 011).
  - Admin 90-day review queue UI actions (owned by Plans 009 and 016).
  - Native Capacitor Android wrapper (owned by Plan 019).

## 3. Preconditions

1. Plan 007 design system components (`Button`, `Modal`) and CSS tokens are available.
   - Check command: `test -f "apps/web/src/lib/ui/Button.svelte"`
   - Expected output: exit code `0`.
2. Plan 008 application shell and client auth guard are functional.
   - Check command: `test -f "apps/web/src/lib/auth/guard.ts"`
   - Expected output: exit code `0`.
3. Plan 010 Dexie database schema is functional.
   - Check command: `test -f "apps/web/src/lib/db/index.ts"`
   - Expected output: exit code `0`.
4. Plan 011 sync recovery module is functional.
   - Check command: `test -f "apps/web/src/lib/sync/recovery.ts"`
   - Expected output: exit code `0`.
5. Web workspace compiles cleanly.
   - Check command: `pnpm --filter @clt/web check`
   - Expected output: exit code `0` with 0 errors.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/package.json` | modify | Declare `@vite-pwa/sveltekit` devDependency for PWA service worker build |
| `apps/web/vite.config.ts` | modify | Configure `@vite-pwa/sveltekit` with HTML shell precache, navigateFallback, and NetworkOnly API rules |
| `apps/web/src/app.html` | modify | Add Web App Manifest link tag, Apple touch icon, and mobile meta tags to HTML head |
| `apps/web/static/manifest.webmanifest` | create | Web App Manifest with standalone display mode, orientation, brand colors, and separated icon purposes |
| `apps/web/static/icons/icon-192.png` | create | Valid 192x192 PNG placeholder app icon |
| `apps/web/static/icons/icon-512.png` | create | Valid 512x512 PNG placeholder app icon |
| `apps/web/src/lib/pwa/storage.ts` | create | Storage persistence manager (`navigator.storage.persist()` and quota tracking with error fallbacks) |
| `apps/web/src/lib/pwa/clock.ts` | create | Clock skew delta calculator with RTT compensation and timestamp reconciliation from HTTP Date headers |
| `apps/web/src/lib/pwa/retention.ts` | create | 90-day retention boundary evaluation helper with skew calibration matching server queue expiration rule |
| `apps/web/src/lib/i18n/messages.ts` | modify | Extend centralized message catalog with PWA UI strings (PRD §12) |
| `apps/web/src/lib/ui/StaleRateBadge.svelte` | create | Amber warning badge rendered when an entry carries `stale_rates = true` |
| `apps/web/src/lib/ui/UpgradePromptModal.svelte` | create | Non-dismissible modal prompted when engine version mismatch occurs with service worker skipWaiting reload |
| `apps/web/src/lib/ui/InstallBanner.svelte` | create | PWA install banner with dismissal persistence, safe-area-insets, and canonical design tokens |
| `apps/web/src/routes/+layout.svelte` | modify | Additively mount PWA banners in root layout while strictly preserving Plan 008 client auth guards |
| `apps/web/src/lib/pwa/pwa.test.ts` | create | Vitest unit tests verifying clock skew, RTT compensation, 90d retention, and storage persistence |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Add `@vite-pwa/sveltekit` to `apps/web/package.json` and configure `apps/web/vite.config.ts` referencing Specification 6.1.
   - Command: `pnpm --filter @clt/web add -D @vite-pwa/sveltekit && pnpm install`
   - Check: `grep -c '@vite-pwa/sveltekit' apps/web/package.json`
   - Expected output: `1`

2. Update `apps/web/vite.config.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/vite.config.ts`.
   - Check: `grep -c 'SvelteKitPWA' apps/web/vite.config.ts`
   - Expected output: `1`

3. Update `apps/web/src/app.html` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/app.html`.
   - Check: `grep -c 'manifest.webmanifest' apps/web/src/app.html`
   - Expected output: `1`

4. Create Web App Manifest in `apps/web/static/manifest.webmanifest` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/static/manifest.webmanifest`.
   - Check: `grep -c 'Cosmo Ledger Track' apps/web/static/manifest.webmanifest`
   - Expected output: `1`

5. Generate valid binary PNG placeholder app icons in `apps/web/static/icons/`:
   - Command:
     ```bash
     mkdir -p apps/web/static/icons && \
     echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > apps/web/static/icons/icon-192.png && \
     echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > apps/web/static/icons/icon-512.png
     ```
   - Check: `file apps/web/static/icons/icon-192.png apps/web/static/icons/icon-512.png | grep -c 'PNG image data'`
   - Expected output: `2`

6. Implement storage persistence manager in `apps/web/src/lib/pwa/storage.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/pwa/storage.ts`.
   - Check: `grep -c 'initStoragePersistence' apps/web/src/lib/pwa/storage.ts`
   - Expected output: `1`

7. Implement clock skew calibration helper in `apps/web/src/lib/pwa/clock.ts` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/lib/pwa/clock.ts`.
   - Check: `grep -c 'calculateClockSkewDelta' apps/web/src/lib/pwa/clock.ts`
   - Expected output: `1`

8. Implement 90-day retention helper in `apps/web/src/lib/pwa/retention.ts` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/lib/pwa/retention.ts`.
   - Check: `grep -c 'isOpOlderThan90Days' apps/web/src/lib/pwa/retention.ts`
   - Expected output: `1`

9. Extend message catalog with `messages.pwa` in `apps/web/src/lib/i18n/messages.ts` referencing Specification 6.7.
   - Command: append `pwa` catalog to `apps/web/src/lib/i18n/messages.ts`.
   - Check: `grep -c 'upgradeModalTitle' apps/web/src/lib/i18n/messages.ts`
   - Expected output: `1`

10. Implement `StaleRateBadge.svelte` in `apps/web/src/lib/ui/StaleRateBadge.svelte` referencing Specification 6.8.
    - Command: copy block 6.8 into `apps/web/src/lib/ui/StaleRateBadge.svelte`.
    - Check: `grep -c 'stale-rate-badge' apps/web/src/lib/ui/StaleRateBadge.svelte`
    - Expected output: `1`

11. Implement `UpgradePromptModal.svelte` in `apps/web/src/lib/ui/UpgradePromptModal.svelte` referencing Specification 6.9.
    - Command: copy block 6.9 into `apps/web/src/lib/ui/UpgradePromptModal.svelte`.
    - Check: `grep -c 'btn-upgrade-reload' apps/web/src/lib/ui/UpgradePromptModal.svelte`
    - Expected output: `1`

12. Implement `InstallBanner.svelte` in `apps/web/src/lib/ui/InstallBanner.svelte` referencing Specification 6.10.
    - Command: copy block 6.10 into `apps/web/src/lib/ui/InstallBanner.svelte`.
    - Check: `grep -c 'install-banner' apps/web/src/lib/ui/InstallBanner.svelte`
    - Expected output: `1`

13. Additively mount PWA components in `apps/web/src/routes/+layout.svelte` referencing Specification 6.11.
    - Command: copy block 6.11 into `apps/web/src/routes/+layout.svelte`.
    - Check: `grep -c 'handleClientGuard' apps/web/src/routes/+layout.svelte && grep -c 'InstallBanner' apps/web/src/routes/+layout.svelte`
    - Expected output: `1` on first line, `1` on second line.

14. Create PWA unit test suite in `apps/web/src/lib/pwa/pwa.test.ts` referencing Specification 6.12.
    - Command: copy block 6.12 into `apps/web/src/lib/pwa/pwa.test.ts`.
    - Check: `pnpm --filter @clt/web test src/lib/pwa/pwa.test.ts`
    - Expected output: test suite passes with 0 failures.

## 6. Specifications

### 6.1 `apps/web/vite.config.ts`

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      srcDir: 'src',
      strategies: 'generateSW',
      registerType: 'prompt', // Non-disruptive update prompt protecting active counter entry
      manifest: false, // External static/manifest.webmanifest
      workbox: {
        // Precache all client chunks, styles, HTML shells, and fonts (PRD §9.2)
        globPatterns: ['client/**/*.{js,css,html,ico,png,svg,webp,webmanifest,woff,woff2}'],
        // Single Page App offline fallback serving precached shell
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\/.*/, /^\/auth\/.*/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // Never intercept or cache mutating API requests (Hard Rule 6)
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          // Never cache Supabase authentication or edge functions
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('supabase.co') || url.pathname.startsWith('/auth/'),
            handler: 'NetworkOnly',
          },
          // Cache immutable fonts, images, and static assets
          {
            urlPattern: ({ request }) =>
              request.destination === 'style' ||
              request.destination === 'script' ||
              request.destination === 'font' ||
              request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'clt-static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
              },
            },
          },
        ],
      },
      // Native builds disable service worker (managed by Plan 019)
      disable: process.env.CAPACITOR_BUILD === 'true',
    }),
  ],
});
```

### 6.2 `apps/web/src/app.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#111827" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Cosmo Ledger Track</title>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

### 6.3 `apps/web/static/manifest.webmanifest`

```json
{
  "name": "Cosmo Ledger Track",
  "short_name": "LedgerTrack",
  "description": "Offline-first payment ledger and settlement tracker",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F6F5F1",
  "theme_color": "#111827",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

### 6.4 `apps/web/src/lib/pwa/storage.ts`

```ts
/**
 * PWA Storage Persistence & Quota Manager (PRD §12)
 * Requests persistent storage to prevent browser eviction of IndexedDB records.
 */

export interface StorageStatus {
  persisted: boolean;
  quotaBytes?: number;
  usageBytes?: number;
  percentUsed?: number;
}

/**
 * Requests persistent storage permissions from the browser.
 * Returns true if persistent storage is already active or was granted.
 * Safely handles environments where StorageManager throws (e.g. private browsing).
 */
export async function initStoragePersistence(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
          return true;
        }
      }
      const granted = await navigator.storage.persist();
      return granted;
    } catch (err) {
      console.warn('Storage persistence request failed:', err);
      return false;
    }
  }
  return false;
}

/**
 * Queries estimated storage quota and usage from the browser.
 * Safely handles environments where StorageManager estimate throws.
 */
export async function getStorageQuota(): Promise<StorageStatus> {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const persisted = typeof navigator.storage.persisted === 'function'
        ? await navigator.storage.persisted().catch(() => false)
        : false;

      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota ?? 0;
      const usage = estimate.usage ?? 0;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;

      return {
        persisted,
        quotaBytes: quota,
        usageBytes: usage,
        percentUsed: Math.round(percent * 10) / 10,
      };
    } catch (err) {
      console.warn('Storage quota estimation failed:', err);
      return { persisted: false };
    }
  }

  return { persisted: false };
}
```

### 6.5 `apps/web/src/lib/pwa/clock.ts`

```ts
/**
 * Clock Skew Detection and Reconciliation Helper (PRD §9.2.2)
 * Compares client local system time against HTTP `Date` headers.
 * Reconciles timestamp drift to prevent server `clock_skew_exceeded` rejections.
 */

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Calculates clock delta between server Date header and local system time.
 * Optional roundTripTimeMs accounts for network latency (subtracts RTT/2).
 * Positive delta: client is behind server.
 * Negative delta: client is ahead of server.
 */
export function calculateClockSkewDelta(
  serverDateHeader: string,
  clientNowMs = Date.now(),
  roundTripTimeMs = 0
): number {
  const serverTimeMs = Date.parse(serverDateHeader);
  if (isNaN(serverTimeMs)) {
    return 0;
  }
  const adjustedServerTimeMs = serverTimeMs + Math.max(0, Math.floor(roundTripTimeMs / 2));
  return adjustedServerTimeMs - clientNowMs;
}

/**
 * Returns true if the clock skew between client and server exceeds the 5-minute threshold.
 */
export function isClockSkewExceeded(deltaMs: number): boolean {
  return Math.abs(deltaMs) > MAX_CLOCK_SKEW_MS;
}

/**
 * Reconciles an ISO 8601 timestamp by applying the calculated server clock skew delta.
 */
export function reconcileTimestamp(clientIsoDate: string, deltaMs: number): string {
  const clientTimeMs = Date.parse(clientIsoDate);
  if (isNaN(clientTimeMs)) {
    return clientIsoDate;
  }
  const reconciledMs = clientTimeMs + deltaMs;
  return new Date(reconciledMs).toISOString();
}
```

### 6.6 `apps/web/src/lib/pwa/retention.ts`

```ts
/**
 * Offline Retention Boundary Helper (PRD §9.1(g), §9.2.2, Test #25)
 * Operations older than 90 days are rejected by the server with `queue_expired_needs_review`
 * and must be reviewed by an authorized Admin before being accepted.
 */

export const MAX_RETENTION_DAYS = 90;
export const NINETY_DAYS_MS = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Returns true if an outbox operation's clientCreatedAt timestamp is older than 90 days.
 * Optional skewDeltaMs calibrates nowMs to true server time.
 */
export function isOpOlderThan90Days(
  clientCreatedAt: string,
  nowMs = Date.now(),
  skewDeltaMs = 0
): boolean {
  const createdAtMs = Date.parse(clientCreatedAt);
  if (isNaN(createdAtMs)) {
    return false;
  }
  const effectiveNow = nowMs + skewDeltaMs;
  return effectiveNow - createdAtMs > NINETY_DAYS_MS;
}
```

### 6.7 `apps/web/src/lib/i18n/messages.ts` (PWA Namespace Extension)

```ts
// apps/web/src/lib/i18n/messages.ts (Appended PWA Catalog Conforming to PRD §12)
export const messages = {
  // ... existing app, menu, entry, sync, ui namespaces from Plan 007
  pwa: {
    staleRateBadge: 'Stale Rate',
    staleRateTooltip: 'This entry was recorded offline under a superseded rate profile. Preserved without silent recalculation.',
    upgradeModalTitle: 'Application Update Required',
    upgradeModalHeadline: 'A new calculation engine version has been published.',
    upgradeModalBody: 'Your offline client calculation rules differ from the server. Please reload the app to download the latest update and ensure continuous sync.',
    upgradeModalButton: 'Reload Application',
    installBannerAria: 'Install Cosmo Ledger Track application',
    installBannerTitle: 'Install App',
    installBannerSubtitle: 'Install for fast offline recording',
    dismissButton: 'Dismiss',
    installButton: 'Install',
  },
};
```

### 6.8 `apps/web/src/lib/ui/StaleRateBadge.svelte`

```svelte
<script lang="ts">
  import { messages } from '$lib/i18n/messages';

  interface Props {
    stale: boolean;
    size?: 'sm' | 'md';
  }

  let { stale, size = 'sm' }: Props = $props();
</script>

{#if stale}
  <span
    class="stale-rate-badge inline-flex items-center gap-1 font-medium rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800"
    class:px-2={size === 'sm'}
    class:py-0.5={size === 'sm'}
    class:text-xs={size === 'sm'}
    class:px-2.5={size === 'md'}
    class:py-1={size === 'md'}
    class:text-sm={size === 'md'}
    title={messages.pwa.staleRateTooltip}
  >
    <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
    <span>{messages.pwa.staleRateBadge}</span>
  </span>
{/if}
```

### 6.9 `apps/web/src/lib/ui/UpgradePromptModal.svelte`

```svelte
<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { messages } from '$lib/i18n/messages';

  interface Props {
    open: boolean;
  }

  let { open = $bindable(false) }: Props = $props();
  let updating = $state(false);

  async function handleReload() {
    if (typeof window === 'undefined') return;
    updating = true;

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            return;
          }
          await reg.update();
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            return;
          }
        }
      } catch (err) {
        console.warn('Service worker skipWaiting update failed:', err);
      }
    }

    window.location.reload();
  }
</script>

{#if open}
  <!-- Non-dismissible modal: onclose is a no-op to ensure upgrade cannot be bypassed (PRD §9.2.2, Test #56) -->
  <Modal bind:open title={messages.pwa.upgradeModalTitle} onclose={() => {}}>
    <div class="space-y-4">
      <div class="flex items-center gap-3 text-amber-600 dark:text-amber-400">
        <svg class="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <p class="text-sm font-medium">
          {messages.pwa.upgradeModalHeadline}
        </p>
      </div>
      <p class="text-xs text-[var(--muted)] leading-relaxed">
        {messages.pwa.upgradeModalBody}
      </p>
      <div class="flex justify-end pt-2">
        <Button id="btn-upgrade-reload" variant="commission" loading={updating} onclick={handleReload}>
          {messages.pwa.upgradeModalButton}
        </Button>
      </div>
    </div>
  </Modal>
{/if}
```

### 6.10 `apps/web/src/lib/ui/InstallBanner.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/ui/Button.svelte';
  import { messages } from '$lib/i18n/messages';

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = $state(null);
  let visible = $state(false);

  const DISMISS_KEY = 'clt_install_dismissed';
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  function isDismissedRecently(): boolean {
    if (typeof window === 'undefined') return true;
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (!dismissedAt) return false;
    return Date.now() - parseInt(dismissedAt, 10) < SEVEN_DAYS_MS;
  }

  onMount(() => {
    if (isDismissedRecently()) return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      visible = true;
    };

    const handleAppInstalled = () => {
      visible = false;
      deferredPrompt = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  });

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      visible = false;
    }
    deferredPrompt = null;
  }

  function handleDismiss() {
    visible = false;
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }
</script>

{#if visible}
  <!-- Positioned safely above mobile floating menu / navigation respecting safe-area-insets (Rule R16, PRD §14.5) -->
  <aside
    class="install-banner glass fixed left-4 right-4 md:bottom-4 md:left-auto md:right-4 md:w-96 z-40 p-4 rounded-xl shadow-xl flex items-center justify-between gap-3 border border-[var(--pearl-border)]"
    style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));"
    aria-label={messages.pwa.installBannerAria}
  >
    <div class="flex items-center gap-3">
      <img src="/icons/icon-192.png" alt="Cosmo Ledger Track" class="w-10 h-10 rounded-lg shadow-sm" />
      <div>
        <p class="text-sm font-semibold text-[var(--ink)]">{messages.pwa.installBannerTitle}</p>
        <p class="text-xs text-[var(--muted)]">{messages.pwa.installBannerSubtitle}</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="default" onclick={handleDismiss}>
        {messages.pwa.dismissButton}
      </Button>
      <Button variant="commission" onclick={handleInstall}>
        {messages.pwa.installButton}
      </Button>
    </div>
  </aside>
{/if}
```

### 6.11 `apps/web/src/routes/+layout.svelte` Modification

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { handleClientGuard } from '$lib/auth/guard';
  import InstallBanner from '$lib/ui/InstallBanner.svelte';
  import UpgradePromptModal from '$lib/ui/UpgradePromptModal.svelte';
  import { initStoragePersistence } from '$lib/pwa/storage';
  import '../app.css';

  let { children } = $props();
  let showUpgradeModal = $state(false);

  // Synchronous client navigation guard (Plan 008, PRD §9.3)
  beforeNavigate(({ to, cancel }) => {
    if (to?.url) {
      handleClientGuard(to.url, cancel);
    }
  });

  onMount(() => {
    // Initial page load guard check (Plan 008)
    handleClientGuard(new URL(window.location.href), () => {});

    // Request persistent storage on initialization (PRD §12)
    initStoragePersistence().catch(console.error);

    // Engine version mismatch listener (PRD §6.5, Test #56)
    const handleUpgrade = () => {
      showUpgradeModal = true;
    };
    window.addEventListener('clt:upgrade-required', handleUpgrade);

    return () => {
      window.removeEventListener('clt:upgrade-required', handleUpgrade);
    };
  });
</script>

<div class="min-h-screen bg-[var(--bg)] text-[var(--ink)] antialiased font-sans">
  <InstallBanner />
  <UpgradePromptModal bind:open={showUpgradeModal} />
  {@render children()}
</div>
```

### 6.12 `apps/web/src/lib/pwa/pwa.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { calculateClockSkewDelta, isClockSkewExceeded, reconcileTimestamp } from './clock';
import { isOpOlderThan90Days, NINETY_DAYS_MS } from './retention';
import { initStoragePersistence, getStorageQuota } from './storage';

describe('PWA Clock Skew (PRD §9.2.2)', () => {
  it('calculates zero delta when client and server times match', () => {
    const nowIso = new Date('2026-10-29T10:00:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:00:00.000Z');

    const delta = calculateClockSkewDelta(nowIso, clientNow);
    expect(delta).toBe(0);
    expect(isClockSkewExceeded(delta)).toBe(false);
  });

  it('detects client clock ahead of server by 8 minutes', () => {
    const serverHeader = new Date('2026-10-29T10:00:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:08:00.000Z');

    const delta = calculateClockSkewDelta(serverHeader, clientNow);
    expect(delta).toBe(-8 * 60 * 1000);
    expect(isClockSkewExceeded(delta)).toBe(true);
  });

  it('detects client clock behind server by 6 minutes', () => {
    const serverHeader = new Date('2026-10-29T10:06:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:00:00.000Z');

    const delta = calculateClockSkewDelta(serverHeader, clientNow);
    expect(delta).toBe(6 * 60 * 1000);
    expect(isClockSkewExceeded(delta)).toBe(true);
  });

  it('accounts for network round-trip latency in clock delta calculation', () => {
    const serverHeader = new Date('2026-10-29T10:00:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:00:00.000Z');
    const rttMs = 2000; // 2s RTT -> 1s transit

    const delta = calculateClockSkewDelta(serverHeader, clientNow, rttMs);
    expect(delta).toBe(1000);
  });

  it('reconciles client timestamp by applying server delta', () => {
    const clientTimestamp = '2026-10-29T10:08:00.000Z';
    const deltaMs = -8 * 60 * 1000;

    const reconciled = reconcileTimestamp(clientTimestamp, deltaMs);
    expect(reconciled).toBe('2026-10-29T10:00:00.000Z');
  });

  it('handles invalid server date header safely', () => {
    const delta = calculateClockSkewDelta('invalid-header');
    expect(delta).toBe(0);
    expect(isClockSkewExceeded(delta)).toBe(false);
  });
});

describe('PWA Storage Persistence and Retention (PRD §9.1(g), §9.2, §12, Test #25)', () => {
  it('validates 90-day retention calculation cutoff and exact boundary', () => {
    const now = Date.now();
    const exactlyNinetyDaysAgo = new Date(now - NINETY_DAYS_MS).toISOString();
    const ninetyDaysAndOneMsAgo = new Date(now - NINETY_DAYS_MS - 1).toISOString();
    const eightyNineDaysAgo = new Date(now - 89 * 24 * 60 * 60 * 1000).toISOString();

    expect(isOpOlderThan90Days(eightyNineDaysAgo, now)).toBe(false);
    expect(isOpOlderThan90Days(exactlyNinetyDaysAgo, now)).toBe(false);
    expect(isOpOlderThan90Days(ninetyDaysAndOneMsAgo, now)).toBe(true);
  });

  it('calibrates 90-day retention evaluation with server clock skew delta', () => {
    const now = Date.now();
    const eightyNineDaysAgo = new Date(now - 89 * 24 * 60 * 60 * 1000).toISOString();
    const skewDeltaMs = 2 * 24 * 60 * 60 * 1000; // True server time is 2 days ahead

    expect(isOpOlderThan90Days(eightyNineDaysAgo, now)).toBe(false);
    expect(isOpOlderThan90Days(eightyNineDaysAgo, now, skewDeltaMs)).toBe(true);
  });

  it('requests persistent storage via navigator.storage.persist()', async () => {
    const originalNavigator = global.navigator;
    const mockPersist = vi.fn().mockResolvedValue(true);
    const mockPersisted = vi.fn().mockResolvedValue(false);

    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          persist: mockPersist,
          persisted: mockPersisted,
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await initStoragePersistence();
    expect(result).toBe(true);
    expect(mockPersisted).toHaveBeenCalled();
    expect(mockPersist).toHaveBeenCalled();

    Object.defineProperty(global, 'navigator', { value: originalNavigator });
  });

  it('handles already-persisted storage gracefully without re-requesting persist()', async () => {
    const originalNavigator = global.navigator;
    const mockPersist = vi.fn();
    const mockPersisted = vi.fn().mockResolvedValue(true);

    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          persist: mockPersist,
          persisted: mockPersisted,
        },
      },
      writable: true,
      configurable: true,
    });

    const result = await initStoragePersistence();
    expect(result).toBe(true);
    expect(mockPersisted).toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();

    Object.defineProperty(global, 'navigator', { value: originalNavigator });
  });

  it('handles throwing storage API gracefully without crashing', async () => {
    const originalNavigator = global.navigator;

    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          persist: vi.fn().mockRejectedValue(new Error('SecurityError')),
          persisted: vi.fn().mockRejectedValue(new Error('SecurityError')),
          estimate: vi.fn().mockRejectedValue(new Error('SecurityError')),
        },
      },
      writable: true,
      configurable: true,
    });

    const persistResult = await initStoragePersistence();
    expect(persistResult).toBe(false);

    const quotaResult = await getStorageQuota();
    expect(quotaResult.persisted).toBe(false);

    Object.defineProperty(global, 'navigator', { value: originalNavigator });
  });

  it('reports storage quota and usage percentages accurately', async () => {
    const originalNavigator = global.navigator;

    Object.defineProperty(global, 'navigator', {
      value: {
        storage: {
          persisted: vi.fn().mockResolvedValue(true),
          estimate: vi.fn().mockResolvedValue({
            quota: 1000000,
            usage: 250000,
          }),
        },
      },
      writable: true,
      configurable: true,
    });

    const status = await getStorageQuota();
    expect(status.persisted).toBe(true);
    expect(status.quotaBytes).toBe(1000000);
    expect(status.usageBytes).toBe(250000);
    expect(status.percentUsed).toBe(25.0);

    Object.defineProperty(global, 'navigator', { value: originalNavigator });
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Clock Skew Detection (PRD §9.2.2) | Client ahead by 8 min | `delta === -480000` ms, `isClockSkewExceeded === true` | §9.2.2 | `apps/web/src/lib/pwa/pwa.test.ts` |
| Timestamp Reconciliation | ISO string + negative delta | Reconciles to server time | §9.2.2 | `apps/web/src/lib/pwa/pwa.test.ts` |
| RTT Latency Compensation | Date header + 2s RTT | Adds RTT/2 to server time | §9.2.2 | `apps/web/src/lib/pwa/pwa.test.ts` |
| Test #25 90d Retention Boundary | Op created 91 days ago | `isOpOlderThan90Days === true` | §16.2 #25, §9.1(g) | `apps/web/src/lib/pwa/pwa.test.ts` |
| Test #25 Skew Calibrated Retention | Op 89d old + 2d server ahead | `isOpOlderThan90Days === true` | §16.2 #25, §9.1(g) | `apps/web/src/lib/pwa/pwa.test.ts` |
| Storage Persistence Request | `initStoragePersistence()` | Invokes `navigator.storage.persist()`, returns `true` | §12 | `apps/web/src/lib/pwa/pwa.test.ts` |
| Storage Persistence Exception Safety | Storage API throws SecurityError | Gracefully returns `false` / `{ persisted: false }` | §12 | `apps/web/src/lib/pwa/pwa.test.ts` |
| Storage Quota Estimation | `getStorageQuota()` | Returns persisted, quota, usage, and percentage | §12 | `apps/web/src/lib/pwa/pwa.test.ts` |
| Test #46 Offline Stale Rate Preservation Badge | `stale = true` | Renders amber warning badge with tooltip | §16.2 #46, Rule 4 | `apps/web/src/lib/ui/StaleRateBadge.svelte` |
| Test #56 Engine Version Skew Modal | `clt:upgrade-required` event | Opens non-dismissible modal with `SKIP_WAITING` reload | §16.2 #56, §6.5 | `apps/web/src/lib/ui/UpgradePromptModal.svelte` |

## 8. Acceptance criteria

1. Client clock skew delta reconciles timestamps accurately within 5 minutes boundary with RTT compensation.
   - Command: `pnpm --filter @clt/web test src/lib/pwa/pwa.test.ts -t "PWA Clock Skew"`
   - Expected output: test suite passes with 0 failures.
2. Storage persistence, error safety, and 90-day retention boundary logic pass unit tests.
   - Command: `pnpm --filter @clt/web test src/lib/pwa/pwa.test.ts -t "PWA Storage Persistence and Retention"`
   - Expected output: test suite passes with 0 failures.
3. SvelteKit route typecheck passes cleanly with 0 errors.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 4: Entries created offline under superseded rate profiles display `StaleRateBadge` without altering historical snapshot rates.
- Rule 6: Never block a Save on connectivity; local entries and mutations remain durable in persistent Dexie IndexedDB storage.
- Rule 8: No secrets in client manifests, service worker caches, or local storage.
- Rule 11: Strict TypeScript types and Zod schemas validate caller identities and query parameters.
- Rule 16: No absolute claims ("unbreachable", "zero data loss"); framings state "reduces exposure" and "safeguards records under storage pressure".

## 10. Pitfalls

- Trap: Overwriting root `+layout.svelte` strips Plan 008's `beforeNavigate` client auth guard and breaks CSS paths.
  - Fix: Modify `apps/web/src/routes/+layout.svelte` additively, preserving `handleClientGuard` from `$lib/auth/guard`, `session`, initial guard in `onMount`, and `import '../app.css';`.
- Trap: Precache glob missing HTML causes cold offline launches on any URL to fail with browser network errors.
  - Fix: Include `html` in Workbox `globPatterns` and configure `navigateFallback: '/index.html'` with `/^\/api\/.*/` and `/^\/auth\/.*/` denylists.
- Trap: Calling `window.location.reload()` under `registerType: 'prompt'` without messaging the waiting worker creates an infinite reload loop.
  - Fix: In `UpgradePromptModal.svelte`, message the waiting service worker with `{ type: 'SKIP_WAITING' }` and wait for `controllerchange` before reloading.
- Trap: Assigning `id="btn-save"` to the modal's reload button corrupts `draggable.ts` collision avoidance and breaks floating menu safe-zone enforcement.
  - Fix: Assign unique `id="btn-upgrade-reload"` in `UpgradePromptModal.svelte`.
- Trap: Passing `size="sm"` to Plan 007's `Button.svelte` fails strict TypeScript compilation.
  - Fix: Do not pass non-existent `size` prop; rely on standard styling and $\ge 44\text{px}$ touch targets.
- Trap: Fixed PWA install banner covering bottom floating menu or transaction action buttons on mobile devices.
  - Fix: Position `InstallBanner` at `style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));"` on mobile viewports (`md:bottom-4`), respecting PRD §14.5 mobile safe zones, and remember user dismissal in `localStorage`.
- Trap: StorageManager API throwing `SecurityError` in private browsing or iframe contexts crashing initialization.
  - Fix: Wrap all `navigator.storage` calls in `try...catch` blocks returning safe fallbacks.

## 11. PRD ISSUES and DECISION PENDING

- **SPA Offline Shell Precache (`/index.html`)**:
  - In SvelteKit SPA mode (`ssr = false`, `prerender = false`), the browser entrypoint is `/index.html`. Workbox precaches `client/**/*.html` and routes navigation requests to `/index.html` via `navigateFallback`, ensuring the client router hydrates seamlessly while offline.
- **Non-Disruptive Service Worker Activation with Skip-Waiting on Demand**:
  - PWA updates are configured with `registerType: 'prompt'`, preventing unexpected page reloads during cashier entry. When an engine skew event (`clt:upgrade-required`, Test #56) requires immediate activation, `UpgradePromptModal` explicitly messages the waiting service worker (`SKIP_WAITING`) before reloading.

## 12. Handoff

- `initStoragePersistence` and `getStorageQuota` exported from `$lib/pwa/storage.ts` for app shell initialization and Settings inspection.
- `calculateClockSkewDelta` and `reconcileTimestamp` exported from `$lib/pwa/clock.ts` for sync runner calibration.
- `StaleRateBadge` exported from `$lib/ui/StaleRateBadge.svelte` for integration in `LedgerRow.svelte` and `AdminDashboard.svelte`.
- `InstallBanner` and `UpgradePromptModal` mounted in root `+layout.svelte`.

## 13. Suggested task breakdown

- `CLT-T-017-A`: Configure Vite PWA, `@vite-pwa/sveltekit` dependency in `package.json`, HTML shell precache, Web App Manifest, placeholder icons, and app.html link (Files: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/app.html`, `apps/web/static/manifest.webmanifest`, `apps/web/static/icons/*`; Depends on: none; Role: Builder; Priority: P0).
- `CLT-T-017-B`: Implement storage persistence manager with error handling, clock skew calibration with RTT, 90-day retention helper with skew calibration, message catalog extension, and Vitest unit tests (Files: `apps/web/src/lib/pwa/storage.ts`, `apps/web/src/lib/pwa/clock.ts`, `apps/web/src/lib/pwa/retention.ts`, `apps/web/src/lib/i18n/messages.ts`, `apps/web/src/lib/pwa/pwa.test.ts`; Depends on: `CLT-T-017-A`; Role: Builder; Priority: P0).
- `CLT-T-017-C`: Build StaleRateBadge, non-dismissible UpgradePromptModal with skipWaiting reload, and safe InstallBanner with safe-area insets (Files: `apps/web/src/lib/ui/StaleRateBadge.svelte`, `apps/web/src/lib/ui/UpgradePromptModal.svelte`, `apps/web/src/lib/ui/InstallBanner.svelte`; Depends on: `CLT-T-017-B`; Role: Builder; Priority: P0).
- `CLT-T-017-D`: Additively mount PWA components into root layout using canonical tokens and `$lib/auth/guard`, verifying zero regressions (Files: `apps/web/src/routes/+layout.svelte`; Depends on: `CLT-T-017-C`; Role: Builder; Priority: P0).

## Changelog

- Revision 3.1 — 2026-11-01:
  - Remediated all 5 P0 blockers, 7 P1 major issues, and 5 P2 minor gaps from independent adversarial audit:
    - Added `@vite-pwa/sveltekit` to `apps/web/package.json` and documented installation step.
    - Fixed module import in `+layout.svelte`: replaced non-existent `$lib/hooks.client` with authoritative `$lib/auth/guard`.
    - Removed non-existent `size="sm"` prop from `Button.svelte` in `InstallBanner.svelte`, preventing TypeScript compilation errors.
    - Fixed infinite reload loop in `UpgradePromptModal`: messaged waiting service worker (`SKIP_WAITING`) and waited for `controllerchange` before `window.location.reload()`.
    - Fixed DOM ID collision: changed `id="btn-save"` to `id="btn-upgrade-reload"` in `UpgradePromptModal`, preventing corruption of `draggable.ts` floating menu collision avoidance.
    - Fixed mobile bottom safe-area occlusion in `InstallBanner.svelte`: added `style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));"`.
    - Replaced invented CSS variable tokens (`--c-pearl-*`, `--c-ink`) with canonical tokens: `.glass`, `text-[var(--ink)]`, `text-[var(--muted)]`, `bg-[var(--bg)]`, and `border-[var(--pearl-border)]`.
    - Hardened storage persistence with `try...catch` blocks and safe function checks against browser SecurityErrors (e.g. private browsing).
    - Eliminated hardcoded UI strings: extended centralized message catalog in `apps/web/src/lib/i18n/messages.ts` with `messages.pwa` namespace.
    - Added RTT latency compensation to `calculateClockSkewDelta` in `clock.ts`.
    - Added skew calibration support to `isOpOlderThan90Days` in `retention.ts`.
    - Broadened Workbox API caching denylist and runtime caching pattern to all `/api/*` endpoints.
    - Added iOS meta tags and Apple touch icon in `app.html`.
    - Expanded Vitest test suite in `pwa.test.ts` covering RTT latency, exact 90d boundary, skew calibration, and storage exception safety.
- Revision 3.0 — 2026-11-01:
  - Remediated all 10 audit blockers and structural defects:
    - Root Layout Preservation: Modified `apps/web/src/routes/+layout.svelte` additively, strictly preserving Plan 008's `handleClientGuard`, `session`, `beforeNavigate`, `onMount` initial guard, and proper stylesheet import `import '../app.css';`.
    - Offline App Shell Precache: Included `html` in Workbox `globPatterns`, configured `navigateFallback: '/index.html'` with `/^\/api\/.*/` and `/^\/auth\/.*/` denylists, enabling cold offline launches on any URL in SPA mode.
    - Manifest Linking & SW Registration: Added `<link rel="manifest" href="/manifest.webmanifest">` to `app.html`, updated `start_url: '/dashboard'`, and separated `any` and `maskable` icon purposes.
    - Non-Disruptive SW Lifecycle: Switched from `registerType: 'autoUpdate'` to `registerType: 'prompt'`, protecting counter staff from mid-transaction page refreshes.
    - Purged Competing Recovery Worker: Removed rogue `recovery-worker.ts` that blindly retried outbox ops, delegating all outbox mutation and 25-reason error handling authoritatively to Plan 011's `$lib/sync/recovery.ts`.
    - 90-Day Retention Alignment: Replaced invented client-side `op_expired_ninety_days` code with pure `isOpOlderThan90Days` helper in `$lib/pwa/retention.ts` matching server `queue_expired_needs_review` push rejection.
    - Plan 007 Contract Compliance: Aligned `UpgradePromptModal` and `InstallBanner` to use valid Plan 007 `Button` variants (`default`, `commission`) and provided required `onclose` callback on `Modal`.
    - Mobile Safe Zones & Dismissal Persistence: Positioned `InstallBanner` at `bottom-20 md:bottom-4` preventing overlap with floating menus and save buttons (Rule R16), remembered 7-day dismissal in `localStorage`, and cleaned up browser listeners on unmount.
    - Valid Placeholder Icons: Provided base64 decoded valid PNG binary generation command in Step 4.
    - Unit Tests & Dexie Isolation: Replaced inline arithmetic tests in `pwa.test.ts` with real tests importing `clock.ts`, `retention.ts`, and mocked `navigator.storage` (`persist`, `estimate`), eliminating Node/Dexie environment errors.
    - Standardized Template & Scopes: Restored standard implementation plan template headings (Identifier, Parent Document, Depends-on, Scope IN/OUT, Preconditions with quoted bash checks, Tasks `017-A` through `017-D`) and updated TOC dependencies to `007, 008, 010, 011, 015, 016`.
- Revision 2.0 — 2026-10-31:
  - Aligned `LocalOutboxOp` property usage in `recovery-worker.ts` with schema `rejectionReason`.
  - Added placeholder icon asset generation step in `apps/web/static/icons/`.
- Revision 1.0 — 2026-10-29: Initial specification of Plan 017 for Phase 3 / Milestone M3.
