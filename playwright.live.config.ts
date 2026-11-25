import { defineConfig, devices } from '@playwright/test';

/**
 * Live production sweep (CLT-REL-002).
 *
 * This config points at the deployed origin and never starts a local server.
 * One browser context per role signs in during globalSetup and writes
 * `.playwright/auth-<role>.json`; every test restores that state instead of
 * re-authenticating. Tests only read the ledger: form fills are left unsaved,
 * and no STAMP & FILE / Close Month control is ever clicked.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/live_site_sweep.spec.ts', '**/live_onboarding_and_surfaces.spec.ts'],
  globalSetup: './tests/e2e/live-global-setup.ts',
  timeout: 15000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  // Headed windows fight for OS focus, so a visible run is single-worker by
  // default. Pass --workers=N on the CLI for a parallel headless run.
  workers: 1,
  retries: 0,
  outputDir: './test-results/live',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  use: {
    // Production by default; PLAYWRIGHT_TEST_BASE_URL points the same sweep at
    // the local stack when hosted credentials are not available.
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'https://payment-ledger-track.vercel.app',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 8000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'Desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'Mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
