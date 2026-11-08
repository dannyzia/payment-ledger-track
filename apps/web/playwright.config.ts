import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// The spawned dev server runs in apps/web and vite loads only apps/web/.env;
// the service-role key and public API base live in the untracked root env
// files that db:bootstrap also reads. Load them here and inject into the
// webServer process below (values flow to the child only, never logged).
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 3; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const rootEnv: Record<string, string> = {};
for (const envName of ['.env', '.env.local']) {
  const envPath = path.join(repoRoot(), envName);
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    Object.assign(rootEnv, parsed);
  }
}
const webServerEnv: Record<string, string> = {};
for (const key of [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'PUBLIC_API_BASE',
]) {
  const value = rootEnv[key] ?? process.env[key];
  if (value) webServerEnv[key] = value;
}

/**
 * Plan 020 §6.5 — Playwright E2E configuration: mobile web emulation
 * (Pixel 5 viewport / DPR / UA), sequential offline-state tests, and
 * dev-server lifecycle management.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Refuses to write to the shared development database without an explicit
  // opt-in (CLT-R-029): these suites create real, undeletable entries.
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30000,
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [['html'], ['list']] : [['list']],
  use: {
    // Dedicated E2E port: 5173 is occupied by an unrelated local service on
    // the dev machine, so reuseExistingServer would serve the wrong app.
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:5199',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'Mobile-Pixel5',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: webServerEnv,
  },
});
