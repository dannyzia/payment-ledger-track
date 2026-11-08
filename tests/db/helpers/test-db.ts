import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

/**
 * DB suites must never touch the shared development database (CLT-R-025).
 * They run against a throwaway database that this module creates, migrates and
 * keeps separate per run. The development database is only ever used as the
 * *server* the throwaway database is created on, and its name is only read.
 */
const DEV_DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TEST_DB_NAME = process.env.CLT_TEST_DB_NAME ?? 'clt_test';
const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(new URL('../../../supabase/migrations', import.meta.url)),
);

const PRELUDE_SQL = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

-- Minimal stand-in for the Supabase-managed auth schema: the migrations add
-- profile-provisioning triggers to auth.users and RLS policies call auth.uid()/
-- auth.jwt(). The tests never rely on GoTrue behaviour.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
create or replace function auth.jwt() returns jsonb language sql stable as $fn$ select '{}'::jsonb $fn$;
`;

function devUrl(): URL {
  return new URL(process.env.DATABASE_URL ?? DEV_DEFAULT_URL);
}

/**
 * Resolves the connection string the DB suites should use. Set
 * CLT_TEST_DATABASE_URL to point at an externally provisioned throwaway
 * database (CI); otherwise the local server gets a database named clt_test.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.CLT_TEST_DATABASE_URL;
  if (explicit && explicit.trim()) {
    assertThrowaway(explicit.trim());
    return explicit.trim();
  }
  const url = devUrl();
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

function adminUrl(): string {
  const url = devUrl();
  url.pathname = '/postgres';
  return url.toString();
}

/** A database is only droppable/writable here if its name marks it as throwaway. */
function assertThrowaway(connectionString: string): string {
  const name = new URL(connectionString).pathname.replace(/^\//, '');
  if (name === TEST_DB_NAME || /(^|_)test($|_)/i.test(name)) return name;
  throw new Error(
    `Refusing to use database "${name}" for destructive tests: its name does not mark it as a throwaway test database.`,
  );
}

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
}

/**
 * pg_cron's `create extension`/`cron.schedule` only works in the database named
 * by cron.database_name (the `postgres` database in Supabase local). Retention
 * scheduling is irrelevant to these suites, so that one block is skipped; every
 * other statement in the migration runs verbatim. The block must be found —
 * otherwise provisioning fails loudly rather than silently drifting.
 */
function withoutCronSchedule(sql: string, name: string): string {
  const marker = '-- 26. Scheduled Cron Job';
  const start = sql.indexOf(marker);
  if (start === -1) {
    if (sql.includes('cron.schedule(')) {
      throw new Error(`${name}: contains a pg_cron job but not the expected scheduling block`);
    }
    if (name.startsWith('20261029000005')) {
      throw new Error(
        `${name}: expected the pg_cron scheduling block, found none (migration changed?)`,
      );
    }
    return sql;
  }
  const endToken = '\nend $$;\n';
  const end = sql.indexOf(endToken, start);
  if (end === -1) throw new Error(`${name}: pg_cron scheduling block is not closed as expected`);
  return sql.slice(0, start) + sql.slice(end + endToken.length);
}

async function dropAndCreate(admin: pg.Client): Promise<void> {
  const name = assertThrowaway(testDatabaseUrl());
  await admin.query(
    'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
    [name],
  );
  await admin.query(`drop database if exists "${name}"`);
  await admin.query(`create database "${name}"`);
}

async function provision(explicitlyProvided: boolean): Promise<void> {
  const target = assertThrowaway(testDatabaseUrl());
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    // One provisioning at a time across workers.
    await admin.query('select pg_advisory_lock(918273645)');
    try {
      const files = migrationFiles();
      const hash = createHash('sha256')
        .update(PRELUDE_SQL)
        .update(files.map((f) => `${f.name}\n${f.sql}`).join('\n'))
        .digest('hex');

      if (explicitlyProvided) {
        const probe = new Client({ connectionString: testDatabaseUrl() });
        await probe.connect();
        try {
          const ready = await probe.query("select to_regclass('public.clt_test_schema') as t");
          if (!ready.rows[0].t) {
            throw new Error(
              `CLT_TEST_DATABASE_URL points at "${target}", which is not provisioned. ` +
                'Run the migrations there first or unset it to use the auto-provisioned clt_test database.',
            );
          }
        } finally {
          await probe.end();
        }
        return;
      }

      const existing = await admin.query('select 1 from pg_database where datname = $1', [target]);
      if (existing.rowCount) {
        const probe = new Client({ connectionString: testDatabaseUrl() });
        try {
          await probe.connect();
          const row = await probe.query("select to_regclass('public.clt_test_schema') as t");
          if (row.rows[0].t) {
            const stamp = await probe.query(
              'select migrations_sha256 from public.clt_test_schema where id = 1',
            );
            if (stamp.rows[0]?.migrations_sha256 === hash) return;
          }
        } catch {
          // Fall through to a rebuild.
        } finally {
          await probe.end().catch(() => undefined);
        }
      }

      await dropAndCreate(admin);

      const db = new Client({ connectionString: testDatabaseUrl() });
      await db.connect();
      try {
        await db.query(PRELUDE_SQL);
        for (const file of files) {
          const sql = withoutCronSchedule(file.sql, file.name);
          try {
            await db.query(sql);
          } catch (error) {
            throw new Error(
              `Applying ${file.name} to the test database failed: ${(error as Error).message}`,
            );
          }
        }
        await db.query(
          'create table public.clt_test_schema (id int primary key, migrations_sha256 text not null, provisioned_at timestamptz not null default now())',
        );
        await db.query(
          'insert into public.clt_test_schema (id, migrations_sha256) values (1, $1)',
          [hash],
        );
      } finally {
        await db.end();
      }
    } finally {
      await admin.query('select pg_advisory_unlock(918273645)');
    }
  } finally {
    await admin.end();
  }
}

let provisioning: Promise<void> | null = null;

/** Idempotent: creates/migrates the throwaway database once per process. */
export function ensureTestDatabase(): Promise<void> {
  const explicitlyProvided = Boolean(process.env.CLT_TEST_DATABASE_URL?.trim());
  provisioning ??= provision(explicitlyProvided);
  return provisioning;
}
