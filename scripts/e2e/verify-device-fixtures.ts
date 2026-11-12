#!/usr/bin/env tsx
/**
 * Smoke-check the device fixture credentials after any credential or role change.
 *
 *   pnpm exec tsx scripts/e2e/verify-device-fixtures.ts [--center=RMP]
 *
 * For every centre that has `CLT_DEVICE_<CODE>_ACCOUNT` and `_PASSWORD` in the
 * environment, this signs the connected handset in as that fixture through the
 * app's own form, then checks the cached profile: the account, the role the
 * fixture should hold (`CLT_DEVICE_<CODE>_ROLE`, default `staff`), and that it is
 * scoped to that centre — comparing against the database so a drifted role is
 * reported rather than passed. Centres without both variables are reported as
 * skipped, with the variable names.
 *
 * Exit code is non-zero if any configured fixture fails, or if nothing is
 * configured to check at all.
 */
import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { runDevicePreflight } from './device-preflight';
import { readCachedProfile, signInOnDevice } from './device-sign-in-flow';
import {
  assessFixture,
  planFixtureChecks,
  type CenterRow,
  type DbProfile,
} from './device-fixtures';

// The fixture variables live in the gitignored .env.local, like the journey's.
// dotenv does not override variables already exported in the shell, so a one-off
// `CLT_DEVICE_RMP_PASSWORD=… pnpm exec tsx …` still wins for sabotage testing.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const { Pool } = pg;

function readOption(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const only = readOption('center')?.toUpperCase();

const preflight = await runDevicePreflight();
for (const note of preflight.notes) console.log(`  • ${note}`);
if (preflight.problems.length > 0) {
  console.error('\n❌ FIXTURE CHECK PREFLIGHT FAILED — no credentials were tested:');
  for (const problem of preflight.problems) {
    console.error(`\n  • ${problem.what}\n    Fix: ${problem.fix}`);
  }
  process.exit(1);
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
});

let centers: CenterRow[];
let dbProfiles = new Map<string, DbProfile>();
try {
  centers = (
    await pool.query<CenterRow>('select id, code, name from centers order by center_number')
  ).rows;
} finally {
  await pool.end();
}

if (only && !centers.some((center) => center.code === only)) {
  console.error(
    `Center "${only}" was not found. Available centers: ${centers.map((center) => center.code).join(', ') || 'none'}.`,
  );
  process.exit(1);
}

const declared = planFixtureChecks(centers);
const plan = only
  ? {
      ready: declared.ready.filter((fixture) => fixture.code === only),
      incomplete: declared.incomplete.filter((fixture) => fixture.code === only),
    }
  : declared;

for (const fixture of plan.incomplete) {
  console.log(
    `  ${fixture.fixtureName}  SKIP  set ${fixture.missing.join(' and ')} in .env.local to check ${fixture.centerName}`,
  );
}

if (plan.ready.length === 0) {
  console.error(
    '\n❌ Nothing to verify: no fixture has every variable it needs.\n' +
      '   Declare fixtures with CLT_DEVICE_FIXTURES and give each CLT_DEVICE_<NAME>_ACCOUNT,\n' +
      '   _PASSWORD and _CENTER — see docs/runbooks/DEVICE_JOURNEY.md §4.',
  );
  process.exit(1);
}

if (plan.ready.length > 0) {
  const emails = plan.ready.map((fixture) => fixture.email.toLowerCase());
  const profilePool = new Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  try {
    const rows = await profilePool.query<{ email: string; role: string; center_id: string | null }>(
      `select lower(u.email) as email, p.role, p.center_id
         from auth.users u
         join profiles p on p.id = u.id
        where lower(u.email) = any($1::text[])`,
      [emails],
    );
    dbProfiles = new Map(
      rows.rows.map((row) => [row.email, { role: row.role, centerId: row.center_id }]),
    );
  } finally {
    await profilePool.end();
  }
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const results: Array<{ code: string; email: string; ok: boolean; detail: string }> = [];

try {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  const initialProfile = await readCachedProfile(page);

  for (const fixture of plan.ready) {
    const label = `${fixture.fixtureName} (${fixture.centerName})`;
    let detail: string;
    let ok = false;

    try {
      await signInOnDevice(page, {
        email: fixture.email,
        password: fixture.password,
        passwordSource: fixture.passwordVar,
      });

      const outcome = assessFixture({
        expectedRole: fixture.expectedRole,
        expectedCenterId: fixture.centerId,
        session: await readCachedProfile(page),
        database: dbProfiles.get(fixture.email.toLowerCase()) ?? null,
      });
      ok = outcome.ok;
      detail = outcome.detail;
    } catch (err) {
      // Name the variable here too: the whole point is knowing which credential
      // to correct, and the sign-in helper already knows which one it used.
      const firstLine = err instanceof Error ? err.message.split('\n')[0] : String(err);
      detail = `${firstLine} (password from ${fixture.passwordVar})`;
    }

    results.push({ code: fixture.fixtureName, email: fixture.email, ok, detail });
    console.log(
      `  ${fixture.fixtureName}  ${ok ? 'PASS' : 'FAIL'}  ${fixture.email} → ${ok ? `${label}: ${detail}` : detail}`,
    );
  }

  // Leave the handset as it was found when that account's password is configured.
  const restore = plan.ready.find(
    (fixture) => fixture.email.toLowerCase() === initialProfile?.email?.toLowerCase(),
  );
  if (restore && results.at(-1)?.code !== restore.code) {
    await signInOnDevice(page, {
      email: restore.email,
      password: restore.password,
      passwordSource: restore.passwordVar,
    });
    console.log(`  Restored session: ${restore.email}`);
  }
} finally {
  await browser.close();
}

const passed = results.filter((result) => result.ok).length;
const failed = results.length - passed;
console.log(
  `\nFixture credentials: ${passed} passed, ${failed} failed, ${plan.incomplete.length} skipped`,
);

if (failed > 0) {
  console.error(
    '\n❌ One or more fixtures are wrong. Correct the named variable in .env.local, or refresh the account with scripts/e2e/create-staff.ts (docs/runbooks/DEVICE_JOURNEY.md §4).',
  );
  process.exitCode = 1;
}
