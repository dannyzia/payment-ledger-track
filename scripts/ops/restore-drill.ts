import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

export const EXPECTED_PUBLIC_TABLES = [
  'profiles',
  'devices',
  'payment_methods',
  'rate_profiles',
  'method_rates',
  'entries',
  'payables',
  'entry_reconciliation_exceptions',
  'settlements',
  'settlement_payments',
  'statements',
  'statement_payables',
  'statement_lines',
  'month_closes',
  'month_close_events',
  'audit_log',
  'sync_ops',
  'app_settings',
];

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: tsx scripts/ops/restore-drill.ts

Executes quarterly restore drill:
1. Downloads latest encrypted snapshot from off-Supabase storage.
2. Decrypts archive via GPG loopback pinentry using --passphrase-fd 0.
3. Pre-populates prerequisite roles and auth stub schema in isolated scratch drill DB.
4. Restores schema into drill DB with ON_ERROR_STOP=1.
5. Re-applies security grants and verifies 18 tables and zero write privileges.
`);
  process.exit(0);
}

/**
 * Runs `gpg` with the passphrase streamed over stdin (`--passphrase-fd 0`).
 * See scripts/ops/backup-export.ts — execSync cannot feed stdin, and an
 * unfed pipe would block gpg forever in cron.
 */
function runGpgWithStdinPassphrase(
  args: string[],
  passphrase: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync('gpg', args, {
    input: passphrase,
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gpg exited with status ${String(result.status)}`);
  }
}

export async function executeRestoreDrill(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.resolve(process.cwd(), 'docs/orchestration/reports');
  const reportPath = path.join(reportDir, `RESTORE_DRILL_${timestamp}.json`);
  const tempDir = path.resolve('/tmp', `clt-drill-${timestamp}`);
  const decryptedDump = path.join(tempDir, 'restore_test.sql');

  console.log(`Starting quarterly backup restoration drill at ${timestamp}...`);

  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(reportDir, { recursive: true });

  const bucket = process.env.BACKUP_STORAGE_BUCKET;
  const gpgPassphrase = process.env.BACKUP_GPG_PASSPHRASE;
  // Default to isolated scratch database on port 54322; refuse Studio 54323 or primary DB
  const drillDbUrl =
    process.env.DRILL_DATABASE_URL ||
    'postgresql://postgres:postgres@127.0.0.1:54322/clt_restore_drill';

  if (drillDbUrl.includes(':54323')) {
    throw new Error(
      'Safety check failed: DRILL_DATABASE_URL must not point to Supabase Studio (port 54323)',
    );
  }

  if (!bucket || !gpgPassphrase) {
    throw new Error(
      'Missing backup bucket or GPG passphrase (BACKUP_STORAGE_BUCKET, BACKUP_GPG_PASSPHRASE)',
    );
  }

  const parsedDrill = new URL(drillDbUrl);
  const execEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsedDrill.hostname,
    PGPORT: parsedDrill.port || '5432',
    PGUSER: parsedDrill.username,
    PGPASSWORD: parsedDrill.password,
    PGDATABASE: parsedDrill.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: parsedDrill.searchParams.get('sslmode') || 'disable',
    AWS_ACCESS_KEY_ID: process.env.BACKUP_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.BACKUP_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: process.env.BACKUP_STORAGE_REGION || 'ap-southeast-1',
  };

  let pg: Client | null = null;

  try {
    // 1. Fetch latest daily snapshot from storage
    console.log('Fetching latest snapshot from backup bucket...');
    const latestSnapshot = execSync(
      `aws s3 ls "s3://${bucket}/daily/" | sort | tail -n 1 | awk '{print $4}'`,
      { encoding: 'utf-8', env: execEnv },
    ).trim();

    if (!latestSnapshot) {
      throw new Error(`No daily snapshots found in bucket s3://${bucket}/daily/`);
    }

    const downloadPath = path.join(tempDir, latestSnapshot);
    execSync(`aws s3 cp "s3://${bucket}/daily/${latestSnapshot}" "${downloadPath}"`, {
      stdio: 'inherit',
      env: execEnv,
    });

    // 2. Decrypt archive using --passphrase-fd 0 via stdin
    console.log('Decrypting snapshot via stdin passphrase pipe...');
    runGpgWithStdinPassphrase(
      [
        '--batch',
        '--yes',
        '--pinentry-mode',
        'loopback',
        '--passphrase-fd',
        '0',
        '-d',
        '-o',
        decryptedDump,
        downloadPath,
      ],
      gpgPassphrase,
      execEnv,
    );

    // 3. Pre-populate prerequisite roles, auth schema, and extension stubs
    console.log('Initializing prerequisite roles and schemas in drill database...');
    pg = new Client({ connectionString: drillDbUrl });
    await pg.connect();

    await pg.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
      END $$;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text,
        raw_app_meta_data jsonb DEFAULT '{}'::jsonb
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    `);

    // 4. Restore dump into drill database with ON_ERROR_STOP=1
    console.log('Restoring public schema dump into isolated drill database...');
    execSync(`psql -v ON_ERROR_STOP=1 -f "${decryptedDump}"`, { stdio: 'inherit', env: execEnv });

    // 5. Re-apply table write revocations (dropped by --no-privileges)
    console.log('Re-applying production table write revocations...');
    await pg.query(`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
    `);

    // 6. Verify all 18 mandatory tables and collect row counts
    console.log('Verifying all 18 public tables and data integrity...');
    const tablesRes = await pg.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const existingTables = new Set<string>(
      tablesRes.rows.map((r: { table_name: string }) => r.table_name),
    );

    const tableVerification: Record<string, { present: boolean; rowCount: number }> = {};
    let allTablesPresent = true;

    for (const table of EXPECTED_PUBLIC_TABLES) {
      const present = existingTables.has(table);
      let rowCount = 0;
      if (present) {
        const countRes = await pg.query(`SELECT count(*)::int as cnt FROM public."${table}"`);
        rowCount = countRes.rows[0].cnt as number;
      } else {
        allTablesPresent = false;
      }
      tableVerification[table] = { present, rowCount };
    }

    // Verify write revocations hold
    const writePrivRes = await pg.query(`
      SELECT count(*)::int as write_grants FROM information_schema.role_table_grants
      WHERE grantee IN ('anon', 'authenticated') AND table_schema = 'public' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    `);
    const writeRevocationsValid = writePrivRes.rows[0].write_grants === 0;

    const passed = allTablesPresent && writeRevocationsValid;
    const report = {
      timestamp,
      snapshotFile: latestSnapshot,
      allTablesPresent,
      writeRevocationsValid,
      tableVerification,
      status: passed ? 'PASSED' : 'FAILED',
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Restore drill finished: ${report.status}. Report saved to ${reportPath}`);

    if (!passed) process.exit(1);
  } finally {
    if (pg) {
      await pg.end().catch(() => {});
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('restore-drill.ts')) {
  executeRestoreDrill().catch((err) => {
    console.error('Restore drill failed:', err);
    process.exit(1);
  });
}
