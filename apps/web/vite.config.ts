import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Server-private env (SUPABASE_SERVICE_ROLE_KEY, bootstrap owner creds)
  // lives in the untracked root .env/.env.local that db:bootstrap also reads;
  // dev servers are spawned from apps/web, so the monorepo root is the env
  // base rather than leaving Vite to look for cwd-relative .env files.
  envDir: '../../',
  plugins: [
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      srcDir: 'src',
      strategies: 'generateSW',
      registerType: 'prompt', // Non-disruptive update prompt protecting active counter entry
      manifest: false, // External static/manifest.webmanifest, linked from app.html
      workbox: {
        // Precache all client chunks, styles, HTML shells, fonts, and icons (PRD §9.2);
        // the plugin auto-appends 'prerendered/**/*.{html,json}' for this globDirectory.
        globPatterns: ['client/**/*.{js,css,html,ico,png,svg,webp,webmanifest,woff,woff2}'],
        // Single Page App offline fallback serving the precached root shell
        navigateFallback: '/',
        navigateFallbackDenylist: [/^\/api\/.*/, /^\/auth\/.*/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // Never intercept or cache mutating API requests (Hard Rule 6)
          {
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkOnly',
          },
          // Never cache Supabase authentication or edge functions
          {
            urlPattern: /^https:\/\/[^/]*supabase\.co\/.*/,
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
  test: {
    // Vitest collects web-app unit tests from src plus the Plan 020 test suites
    // (tests/calc, tests/reports, tests/regression); Playwright specs in
    // tests/e2e are executed separately via `pnpm test:e2e`.
    // Scope test globs to this app's own suites: a bare 'tests/**/*.test.ts'
    // resolves from the workspace root and double-collects root-level
    // tests/ops (Plan 021) in this project as well.
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/calc/**/*.test.ts',
      'tests/reports/**/*.test.ts',
      'tests/regression/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
  },
});
