#!/usr/bin/env tsx
/**
 * CLT-R-029 — run the Playwright E2E suite against its own throwaway Supabase
 * stack instead of the development database.
 *
 * The suite signs in through Supabase Auth and saves real entries through the
 * app, and entries are immutable, so every run against the dev database leaves
 * rows nobody can delete from the UI. This script owns a second Supabase
 * project (`e2e/supabase/config.toml`, ports 54341/54342) and:
 *
 *   1. starts it if it is not already running;
 *   2. rebuilds it from `supabase/migrations` (`db reset`), so a run starts from
 *      the schema in the repo, never from a copy of dev data;
 *   3. bootstraps the owner account in that stack;
 *   4. runs Playwright with the app server pointed at the throwaway stack on its
 *      own port (5198 by default), so a dev server on 5199 is left alone;
 *   5. stops the stack unless `--keep` is passed.
 *
 * Usage:
 *   pnpm test:e2e:isolated            # full suite, stack torn down afterwards
 *   pnpm test:e2e:isolated --keep     # leave the stack running
 *   pnpm test:e2e:isolated -- offline_sync   # extra args go to Playwright
 *
 * The script refuses to continue if the "isolated" stack resolves to the
 * development stack's ports. That check is the whole point: a typo in the port
 * offset must fail loudly rather than write to the dev database.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const WORKDIR = 'e2e';
const APP_PORT = process.env.E2E_APP_PORT || '5198';
const EXPECTED_API_PORT = '54341';
const EXPECTED_DB_PORT = '54342';
const DEV_API_PORT = '54321';
const DEV_DB_PORT = '54322';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  throw new Error('run this from inside the repository');
}

const root = repoRoot();
for (const envName of ['.env', '.env.local']) {
  const envPath = path.join(root, envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

type StackStatus = {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

function readStatus(): StackStatus | null {
  const raw = capture('pnpm', ['exec', 'supabase', 'status', '--workdir', WORKDIR, '-o', 'json']);
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1)) as Partial<StackStatus>;
    if (!parsed.API_URL || !parsed.DB_URL || !parsed.ANON_KEY || !parsed.SERVICE_ROLE_KEY)
      return null;
    return parsed as StackStatus;
  } catch {
    return null;
  }
}

function assertIsolated(status: StackStatus): void {
  const api = new URL(status.API_URL);
  const db = new URL(status.DB_URL);
  if (api.port === DEV_API_PORT || db.port === DEV_DB_PORT) {
    throw new Error(
      `refusing to run: the "${WORKDIR}" stack resolved to the development ports (${status.API_URL}). ` +
        'Fix e2e/supabase/config.toml before running the suite.',
    );
  }
  if (api.port !== EXPECTED_API_PORT || db.port !== EXPECTED_DB_PORT) {
    throw new Error(
      `refusing to run: expected ports ${EXPECTED_API_PORT}/${EXPECTED_DB_PORT}, got ${api.port}/${db.port}`,
    );
  }
}

async function entryCount(databaseUrl: string): Promise<number | null> {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from entries',
    );
    return Number(result.rows[0]?.count ?? NaN);
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const keep = argv.includes('--keep');
  const separated = argv.indexOf('--');
  const playwrightArgs =
    separated === -1 ? argv.filter((a) => a !== '--keep') : argv.slice(separated + 1);

  const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL;
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) {
    throw new Error(
      'BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD are required (root .env) — the suite signs in as this account.',
    );
  }

  const devUrl =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const devBefore = await entryCount(devUrl);

  let status = readStatus();
  if (!status) {
    console.log('→ starting the isolated Supabase stack');
    run('pnpm', ['exec', 'supabase', 'start', '--workdir', WORKDIR]);
    status = readStatus();
    if (!status) throw new Error('the isolated stack did not report a status');
  }
  assertIsolated(status);

  console.log('→ rebuilding the isolated database from supabase/migrations');
  run('pnpm', ['exec', 'supabase', 'db', 'reset', '--workdir', WORKDIR]);
  // The reset restarts containers; re-read in case the keys were regenerated.
  status = readStatus() ?? status;
  assertIsolated(status);

  console.log('→ bootstrapping the owner account in the isolated stack');
  const stackEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: status.DB_URL,
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    PUBLIC_SUPABASE_URL: status.API_URL,
    PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    BOOTSTRAP_OWNER_EMAIL: ownerEmail,
    BOOTSTRAP_OWNER_PASSWORD: ownerPassword,
  };
  run('pnpm', ['exec', 'tsx', 'scripts/bootstrap.ts'], stackEnv);

  console.log(`→ running Playwright against ${status.API_URL} (app on :${APP_PORT})`);
  const playwrightEnv: NodeJS.ProcessEnv = {
    ...stackEnv,
    PUBLIC_API_BASE: '',
    CLT_E2E_ISOLATED: '1',
    PLAYWRIGHT_TEST_BASE_URL: `http://localhost:${APP_PORT}`,
  };
  const playwrightArgsFinal = playwrightArgs.length > 0 ? playwrightArgs : [];
  run(
    'pnpm',
    ['--filter', '@clt/web', 'exec', 'playwright', 'test', ...playwrightArgsFinal],
    playwrightEnv,
  );

  const devAfter = await entryCount(devUrl);
  const e2eCount = await entryCount(status.DB_URL);
  console.log(
    `→ entries: isolated stack ${e2eCount ?? 'unknown'}, development database ${devBefore ?? '?'} → ${devAfter ?? '?'}`,
  );
  if (devBefore !== null && devAfter !== null && devBefore !== devAfter) {
    throw new Error(
      `the development database changed during the run (${devBefore} → ${devAfter}); the isolation is broken`,
    );
  }

  if (!keep) {
    console.log('→ stopping the isolated stack');
    run('pnpm', ['exec', 'supabase', 'stop', '--workdir', WORKDIR]);
  } else {
    console.log(`→ stack left running (API ${status.API_URL}, DB ${status.DB_URL})`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
