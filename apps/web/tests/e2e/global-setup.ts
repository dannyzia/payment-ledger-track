import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

/**
 * CLT-T-061 — E2E suites must not write to the shared development database by
 * accident (CLT-R-029).
 *
 * Unlike `tests/db`, these suites cannot run against a throwaway database:
 * they sign in through Supabase Auth and drive the real UI, so the app server
 * they talk to writes wherever its `DATABASE_URL` points. Every run therefore
 * leaves real entries behind — and because the config retries once, a failing
 * run leaves two. There is no delete path for entries (they are immutable),
 * so a mistake cannot be undone from the app.
 *
 * The name-based check below mirrors `tests/db/helpers/test-db.ts`: a database
 * whose name marks it as throwaway runs unattended; anything else — the dev
 * database included — needs `CLT_E2E_ALLOW_SHARED_DB=1` in the environment.
 */

const OPT_IN_VAR = 'CLT_E2E_ALLOW_SHARED_DB';
const DEV_DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DISPOSABLE_NAME = /(^|[_-])(test|e2e)($|[_-])/i;

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

/** The suites read credentials from the same untracked root env as `db:bootstrap`. */
for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(repoRoot(), envName);
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

export function databaseName(connectionString: string): string {
  try {
    return new URL(connectionString).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is not a valid connection string');
  }
}

export function isDisposableDatabaseName(name: string): boolean {
  return DISPOSABLE_NAME.test(name);
}

export function e2eTargetDatabase(): string {
  const url = process.env.DATABASE_URL || DEV_DEFAULT_URL;
  const parsed = new URL(url);
  return `${databaseName(url)} on ${parsed.host}`;
}

/**
 * The isolated stack (scripts/e2e/isolated-stack.ts) runs this suite against a
 * second Supabase project on its own ports. It is accepted only when that
 * marker is set *and* the target is demonstrably not the development stack, so
 * a stray marker cannot turn into a dev-database write.
 */
function isIsolatedStack(url: string): boolean {
  if (process.env.CLT_E2E_ISOLATED !== '1') return false;
  const parsed = new URL(url);
  return parsed.port === '54342';
}

export default function globalSetup(): void {
  const url = process.env.DATABASE_URL || DEV_DEFAULT_URL;
  const name = databaseName(url);
  const host = new URL(url).host;
  const optIn = process.env[OPT_IN_VAR] === '1';

  if (isIsolatedStack(url)) {
    console.log(`E2E writes go to the isolated throwaway stack on ${host}.`);
    return;
  }
  if (isDisposableDatabaseName(name)) {
    console.log(`E2E writes go to throwaway database "${name}" on ${host}.`);
    return;
  }
  if (optIn) {
    console.log(`E2E writes go to database "${name}" on ${host} (${OPT_IN_VAR}=1).`);
    return;
  }
  throw new Error(
    [
      `Refusing to run E2E against database "${name}" on ${host}.`,
      'These tests create real entries through the app and entries cannot be deleted,',
      'and the suite retries once, so a failing run writes two.',
      `Set ${OPT_IN_VAR}=1 to accept that, or point DATABASE_URL at a database whose`,
      'name contains "test" or "e2e".',
    ].join(' '),
  );
}
