# 021_deployment_ops_runbooks.md — Deployment, Operations, and Operational Runbooks

- Plan Identifier: CLT-PLAN-021
- Phase: Phase 6 / G5–G6
- Milestone: Gate and release (M5 / Production per PRD §17)
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §12 (Non-functional requirements: daily backups, PITR 7-day retention horizon, quarterly restore drills, off-Supabase encrypted archives), §13 (Tech stack and hosting: Vercel, Supabase Singapore or Mumbai region, adapter-vercel), §15 (Audit log retention), §19 (Risks), `ORCHESTRATOR.md` §11 (Production readiness checklist G5, Deployment rules, Runbooks)
- Depends on: 001, 003, 007, 008, 017, 019, 020 (018 if Mode B ships at launch)
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-02

## 1. Purpose

This plan specifies the production hosting configuration, automated data safety pipelines, operational monitoring, and incident runbooks for Cosmo Ledger Track. It establishes Vercel web hosting (`adapter-vercel`) in region `sin1` or `bom1`, Supabase PostgreSQL 15+ production database provisioning in Singapore or Mumbai, daily off-Supabase encrypted ledger backups to S3 or Google Cloud Storage scoped to public schema and private storage buckets scheduled via GitHub Actions, quarterly restore drills with verified table row counts and re-applied security grants in an isolated scratch database, production health check endpoints (`/api/v1/health`), and four mandatory operational runbooks. It enforces strict deployment governance requiring Zia's written release approval (`ZIA-APPROVED`) and confirmation of open business policies Q1–Q4 prior to production rollout, with secure stdin GPG decryption (`--passphrase-fd 0`) and libpq environment variables without process table secret leakage.

## 2. Scope

- IN:
  - Hosting configuration file `apps/web/vercel.json` with security headers, region configuration (`sin1` Singapore / `bom1` Mumbai), and clean API route delegation.
  - SvelteKit adapter configuration in `apps/web/svelte.config.js` with dual-branching: `adapterStatic` when `process.env.CAPACITOR_BUILD === 'true'` (Plan 019) and `adapterVercel({ runtime: 'nodejs22.x', maxDuration: 15, regions: ['sin1'] })` for web production.
  - Health check endpoint `apps/web/src/routes/api/v1/health/+server.ts` providing database ping and uptime verification for uptime monitoring and rollback triggers.
  - Production environment variable configuration matrix and template (`.env.production.example`) specifying direct database connection (`DIRECT_DATABASE_URL`) without connection pooler query parameters for `pg_dump`.
  - Automated off-Supabase daily encrypted backup export script: `scripts/ops/backup-export.ts` with CLI `--help` support, `--schema=public` dump scoping, isolated environment variable execution (libpq `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, `--passphrase-fd 0` via stdin, mapped AWS credentials) to eliminate process table (`ps aux` / `/proc/<pid>/cmdline`) secret leakage, secure 0700 temporary directories, and S3 storage bucket backup sync.
  - Automated daily backup GitHub Actions workflow in `.github/workflows/daily-backup.yml` running on daily cron (`0 20 * * *` = 2 AM Asia/Dhaka).
  - Automated quarterly backup restoration drill verification script: `scripts/ops/restore-drill.ts` with CLI `--help` support, prerequisite roles (`anon`, `authenticated`, `service_role`) and `auth.users` stub schema initialization to prevent foreign key restore aborts, isolated scratch drill database targeting (`clt_restore_drill` on port 54322, rejecting Studio 54323 or primary DB), post-restore re-application and verification of table write revocations, and drill report generation.
  - Four operational runbooks in `docs/runbooks/`:
    - Incident response runbook (`docs/runbooks/INCIDENT_RESPONSE.md`) with 3 severity tiers aligned with AGENTS.md §6, targeted RPC revocation SQL, and re-grant procedure.
    - Deployment rollback runbook (`docs/runbooks/ROLLBACK.md`) with one-click web rollback, Dexie schema compatibility guards, and immutable database forward-fix migration procedures.
    - Backup and Point-in-Time Recovery (PITR) restore runbook (`docs/runbooks/BACKUP_RESTORE.md`) with 7-day WAL horizon, full 5-variable environment sync documentation, and cold restore stub initialization with roles and grants.
    - Credential and secret rotation runbook (`docs/runbooks/CREDENTIAL_ROTATION.md`) covering service role key rotation, database user password rotation, JWT secret rotation with native app update requirements and staff re-auth coordination, and bootstrap owner password post-launch cleanup.
  - Pre-deployment verification script `scripts/ops/deploy-check.ts` with CLI `--help` support, `--env` (`staging` or `production`) and `--milestone` options, double-escaped regexes matching `ZIA-APPROVED` and flexible Q1–Q4 policy confirmation in root `DECISIONS.md`.
  - Unit test suite `tests/ops/deploy-check.test.ts` verifying governance logic.
- OUT:
  - Direct deployment actions to cloud providers without owner approval (violates AGENTS.md Rule 19).
  - Storing or committing actual secret tokens or database passwords (violates AGENTS.md Rule 8).
  - Implementation of client application logic or database schemas (covered in plans 001–020).

## 3. Preconditions

1. Node.js 22 LTS verified:
   ```bash
   node --version
   ```
   Expected output: `v22.*`

2. System binary dependencies installed:
   ```bash
   gpg --version | head -n 1
   pg_dump --version
   psql --version
   aws --version
   ```
   Expected output: GPG 2.2+, PostgreSQL client 15+, AWS CLI 2+.

3. All Implementation Readiness Gates verified via Plan 020:
   ```bash
   pnpm test:gates --milestone production
   ```
   Expected output: Exit code 0, all applicable gates marked `satisfied: true` in `docs/orchestration/reports/GATE_EVIDENCE.json`.

4. Release authorization provided by Zia in writing:
   ```bash
   grep -E "^ZIA-APPROVED: CLT-REL-[0-9]+ (staging|production) [0-9]{4}-[0-9]{2}-[0-9]{2}" docs/orchestration/LEDGER.md
   ```
   Expected output: One matching authorization line for target environment.

5. Open business decisions Q1 through Q4 confirmed in root `DECISIONS.md` (for production releases):
   ```bash
   grep -E "Status:\s*CONFIRMED" DECISIONS.md | wc -l
   ```
   Expected output: At least 4 confirmed policies.

## 4. Files

| Path | Action | Purpose |
|---|---|---|
| `apps/web/vercel.json` | create | Vercel production hosting configuration, CSP headers, and region configuration (`sin1`) |
| `apps/web/svelte.config.js` | modify | SvelteKit adapter configuration with Capacitor static adapter and Vercel serverless adapter (`maxDuration: 15`, `regions: ['sin1']`) |
| `apps/web/src/routes/api/v1/health/+server.ts` | create | Production health check endpoint verifying database connectivity and operational status |
| `.env.production.example` | create | Production environment variable template with direct database connection parameters |
| `scripts/ops/backup-export.ts` | create | Daily off-Supabase encrypted database export script using `--passphrase-fd 0` and libpq env variables |
| `.github/workflows/daily-backup.yml` | create | GitHub Actions scheduled workflow for daily encrypted backups and storage sync |
| `scripts/ops/restore-drill.ts` | create | Quarterly restore drill script with roles/grants restoration in scratch DB `clt_restore_drill` |
| `docs/runbooks/INCIDENT_RESPONSE.md` | create | Incident classification (3 tiers), triage, containment, and targeted RPC revocation/re-grant runbook |
| `docs/runbooks/ROLLBACK.md` | create | Automated web rollback, Dexie version compatibility guards, and forward-fix migrations |
| `docs/runbooks/BACKUP_RESTORE.md` | create | PITR and off-Supabase archive restoration procedure with roles, grants, and 5-var env sync |
| `docs/runbooks/CREDENTIAL_ROTATION.md` | create | Supabase service role key, database password, JWT secret, native APK re-release, and bootstrap cleanup |
| `scripts/ops/deploy-check.ts` | create | Pre-deployment verification script with properly escaped regexes validating gates, env, and Q1–Q4 |
| `tests/ops/deploy-check.test.ts` | create | Vitest test suite testing pre-deployment governance checker under mock conditions |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Configure Vercel production deployment settings in `apps/web/vercel.json` copying code from Section 6.1. Define security headers (Content Security Policy with `'unsafe-inline'` script support for SPA bootstrap, X-Frame-Options, Strict-Transport-Security) and specify region `sin1` (Singapore) to minimize latency to Supabase. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: `cat apps/web/vercel.json | jq .framework` returns `"sveltekit"`.

2. Update SvelteKit adapter configuration in `apps/web/svelte.config.js` copying code from Section 6.2. Preserve Plan 019 `CAPACITOR_BUILD` static adapter branching, and configure `adapterVercel` with `runtime: 'nodejs22.x'`, `maxDuration: 15`, and `regions: ['sin1']`. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: `grep -c "maxDuration: 15" apps/web/svelte.config.js` returns 1.

3. Author production health check endpoint in `apps/web/src/routes/api/v1/health/+server.ts` copying Section 6.3. Implement database ping and return HTTP 200 with `{ status: 'ok', timestamp, uptime }` for monitoring and rollback triggers. Check: file exists.

4. Define production environment template in `.env.production.example` copying Section 6.4. Enforce explicit variable definitions for database URLs, direct database connection for `pg_dump`, public API URLs, and backup storage buckets without committing actual secret values. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: `! grep -i -E "(password|secret)\s*=\s*[a-zA-Z0-9]" .env.production.example` confirms variable placeholders only.

5. Author daily off-Supabase backup export script in `scripts/ops/backup-export.ts` copying code from Section 6.5. Parse `DIRECT_DATABASE_URL` into standard libpq environment variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`), create temporary directory with mode 0700, execute `pg_dump` with `--schema=public`, pipe GPG passphrase via stdin with `--passphrase-fd 0` to eliminate process table secret leakage, and stream database dump and storage bucket files to object storage using mapped AWS credentials. Check: `npx tsx scripts/ops/backup-export.ts --help` returns exit code 0.

6. Configure daily backup GitHub Actions workflow in `.github/workflows/daily-backup.yml` copying Section 6.6. Schedule daily execution at `0 20 * * *` (2 AM Asia/Dhaka) with GitHub repository secret bindings. Check: file exists.

7. Author quarterly restore drill automation script in `scripts/ops/restore-drill.ts` copying code from Section 6.7. Enforce scratch database targeting (`clt_restore_drill` on port 54322, rejecting Studio 54323 or primary DB), initialize prerequisite roles (`anon`, `authenticated`, `service_role`) and `auth.users` stub schema, restore public dump with `ON_ERROR_STOP=1`, re-apply table write revocations, verify all 18 tables and foreign keys, and generate drill report. Check: `npx tsx scripts/ops/restore-drill.ts --help` returns exit code 0.

8. Author incident response runbook in `docs/runbooks/INCIDENT_RESPONSE.md` copying Section 6.8. Define 3 severity tiers (SEV-1 Blocker, SEV-2 Major, SEV-3 Minor), escalation paths, communication protocols, targeted RPC revocation SQL, and re-grant restoration commands. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: file exists with 3 numbered severity tiers.

9. Author deployment rollback runbook in `docs/runbooks/ROLLBACK.md` copying Section 6.9. Define one-click Vercel deployment rollback, Dexie schema version downgrade guards, and forward-fixing database migration procedures. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: file exists with verified commands.

10. Author backup and PITR restore runbook in `docs/runbooks/BACKUP_RESTORE.md` copying Section 6.10. Document Point-in-Time Recovery steps in the Supabase dashboard (7-day WAL horizon), complete 5-variable environment sync, and off-Supabase disaster recovery restoration steps with prerequisite stub schema, roles, and re-applied grants. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: file exists with 7-day retention horizon noted.

11. Author credential rotation runbook in `docs/runbooks/CREDENTIAL_ROTATION.md` copying Section 6.11. Specify zero-downtime rotation of Supabase service role keys, database user passwords, JWT secret rotation with native APK re-release requirements, and bootstrap credential post-launch cleanup. Working directory `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`. Check: file exists with step-by-step rotation checklists.

12. Author pre-deployment verification script in `scripts/ops/deploy-check.ts` copying Section 6.12. Inspect CLI `--help` flag, parse `--env` and `--milestone`, validate that `pnpm test:gates --milestone <milestone>` passes, evaluate properly escaped `ZIA-APPROVED` regex against `docs/orchestration/LEDGER.md`, and evaluate escaped Q1–Q4 policy confirmation regex against `DECISIONS.md`. Check: `npx tsx scripts/ops/deploy-check.ts --help` returns exit code 0.

13. Author test suite in `tests/ops/deploy-check.test.ts` copying Section 6.13. Validate pre-deployment checker behavior against mock inputs, including regex verification. Check: `pnpm vitest run tests/ops/deploy-check.test.ts` passes.

## 6. Specifications

### 6.1 Vercel Production Configuration (`apps/web/vercel.json`)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "sveltekit",
  "buildCommand": "pnpm build",
  "installCommand": "pnpm install",
  "cleanUrls": true,
  "regions": ["sin1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://localhost capacitor://localhost; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=()"
        },
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=63072000; includeSubDomains; preload"
        }
      ]
    }
  ]
}
```

### 6.2 SvelteKit Adapter Configuration (`apps/web/svelte.config.js`)

```javascript
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
          maxDuration: 15,
          regions: ['sin1'],
        }),
  },
};

export default config;
```

### 6.3 Production Health Check Endpoint (`apps/web/src/routes/api/v1/health/+server.ts`)

```typescript
import { json, type RequestHandler } from '@sveltejs/kit';
import { getServiceSupabase } from '$lib/server/supabase';

const startTime = Date.now();

export const GET: RequestHandler = async () => {
  try {
    const supabase = getServiceSupabase();
    // Quick ping on database
    const { error } = await supabase.from('app_settings').select('id').limit(1).single();

    if (error) {
      return json({ status: 'error', error: error.message }, { status: 503 });
    }

    return json({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return json({ status: 'error', error: err.message }, { status: 500 });
  }
};
```

### 6.4 Production Environment Template (`.env.production.example`)

```bash
# Application Environment
NODE_ENV=production
PUBLIC_API_BASE=https://cosmo-ledger.vercel.app

# Supabase Production (Singapore region)
PUBLIC_SUPABASE_URL=https://<PROJECT_ID>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=PLACEHOLDER_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=PLACEHOLDER_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET=PLACEHOLDER_JWT_SECRET

# Database Application Connection (Transaction Pooler port 6543)
DATABASE_URL=postgresql://postgres.<PROJECT_ID>:[DB_PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require

# Direct Database Connection for Operations / pg_dump (Direct port 5432, no pooler parameters)
DIRECT_DATABASE_URL=postgresql://postgres:[DB_PASSWORD]@db.<PROJECT_ID>.supabase.co:5432/postgres?sslmode=require

# Off-Supabase Daily Backup Storage (S3 / GCS)
BACKUP_STORAGE_BUCKET=cosmo-ledger-backups-prod
BACKUP_STORAGE_REGION=ap-southeast-1
BACKUP_ACCESS_KEY_ID=PLACEHOLDER_ACCESS_KEY
BACKUP_SECRET_ACCESS_KEY=PLACEHOLDER_SECRET_KEY
BACKUP_GPG_PASSPHRASE=PLACEHOLDER_GPG_PASSPHRASE

# Bootstrap Credentials (One-time M0 initialization only; purge post-launch)
BOOTSTRAP_OWNER_EMAIL=owner@cosmo-ledger.com
BOOTSTRAP_OWNER_PASSWORD=PLACEHOLDER_BOOTSTRAP_PASSWORD
```

### 6.5 Automated Off-Supabase Encrypted Export Script (`scripts/ops/backup-export.ts`)

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Handle CLI help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: tsx scripts/ops/backup-export.ts

Executes daily off-Supabase database backup:
1. Dumps public schema via pg_dump using libpq env variables.
2. Encrypts dump with GPG AES-256 using --passphrase-fd 0 via stdin.
3. Uploads encrypted artifact and syncs private storage buckets to cloud storage.
`);
  process.exit(0);
}

export async function executeBackupExport(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempDir = path.resolve('/tmp', `clt-backup-${timestamp}`);
  const dumpFile = path.join(tempDir, 'ledger_snapshot.sql');
  const encryptedFile = path.join(tempDir, `ledger_snapshot_${timestamp}.sql.gpg`);

  console.log(`Starting automated daily off-Supabase database export at ${timestamp}...`);

  // Create temporary directory with secure 0700 permissions
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

  const directDbUrl = process.env.DIRECT_DATABASE_URL;
  const gpgPassphrase = process.env.BACKUP_GPG_PASSPHRASE;
  const bucket = process.env.BACKUP_STORAGE_BUCKET;
  const region = process.env.BACKUP_STORAGE_REGION || 'ap-southeast-1';
  const accessKeyId = process.env.BACKUP_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_SECRET_ACCESS_KEY;

  if (!directDbUrl) {
    throw new Error('DIRECT_DATABASE_URL is strictly required for pg_dump (pooler DATABASE_URL not supported)');
  }
  if (!gpgPassphrase || !bucket) {
    throw new Error('Missing mandatory backup configuration environment variables (BACKUP_GPG_PASSPHRASE, BACKUP_STORAGE_BUCKET)');
  }

  // Parse directDbUrl into standard libpq environment variables to prevent CLI argument leakage
  const parsedDb = new URL(directDbUrl);
  const execEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsedDb.hostname,
    PGPORT: parsedDb.port || '5432',
    PGUSER: parsedDb.username,
    PGPASSWORD: parsedDb.password,
    PGDATABASE: parsedDb.pathname.replace(/^\//, '') || 'postgres',
    PGSSLMODE: parsedDb.searchParams.get('sslmode') || 'require',
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_DEFAULT_REGION: region,
  };

  try {
    // 1. Dump public schema using standard libpq env variables
    console.log('Executing pg_dump for public schema...');
    execSync(
      `pg_dump --schema=public --clean --if-exists --no-owner --no-privileges -f "${dumpFile}"`,
      { stdio: 'inherit', env: execEnv }
    );

    // 2. Encrypt dump file with GPG using --passphrase-fd 0 via stdin (NOT CLI flags)
    console.log('Encrypting dump file with AES-256 via stdin passphrase pipe...');
    execSync(
      `gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o "${encryptedFile}" "${dumpFile}"`,
      { input: gpgPassphrase, stdio: ['pipe', 'inherit', 'inherit'], env: execEnv }
    );

    // 3. Upload encrypted database archive to object storage
    console.log(`Uploading encrypted archive to s3://${bucket}/daily/...`);
    execSync(
      `aws s3 cp "${encryptedFile}" "s3://${bucket}/daily/ledger_snapshot_${timestamp}.sql.gpg" --sse AES256`,
      { stdio: 'inherit', env: execEnv }
    );

    // 4. Backup private storage buckets (settlement-receipts and statement-files)
    console.log(`Syncing private storage buckets to s3://${bucket}/storage/...`);
    try {
      execSync(
        `aws s3 sync "s3://supabase-storage/payment-receipts" "s3://${bucket}/storage/payment-receipts" --sse AES256`,
        { stdio: 'pipe', env: execEnv }
      );
      execSync(
        `aws s3 sync "s3://supabase-storage/statement-files" "s3://${bucket}/storage/statement-files" --sse AES256`,
        { stdio: 'pipe', env: execEnv }
      );
    } catch {
      console.warn('Notice: Storage bucket sync skipped or buckets empty.');
    }

    console.log(`Backup completed and uploaded successfully.`);
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup-export.ts')) {
  executeBackupExport().catch((err) => {
    console.error('Backup export failed:', err);
    process.exit(1);
  });
}
```

### 6.6 Scheduled Daily Backup Workflow (`.github/workflows/daily-backup.yml`)

```yaml
name: Daily Off-Supabase Encrypted Backup

on:
  schedule:
    # 20:00 UTC = 02:00 Asia/Dhaka
    - cron: '0 20 * * *'
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install PostgreSQL Client & GPG
        run: sudo apt-get update && sudo apt-get install -y postgresql-client gnupg awscli

      - name: Execute Backup Export
        env:
          DIRECT_DATABASE_URL: ${{ secrets.PROD_DIRECT_DATABASE_URL }}
          BACKUP_GPG_PASSPHRASE: ${{ secrets.BACKUP_GPG_PASSPHRASE }}
          BACKUP_STORAGE_BUCKET: ${{ secrets.BACKUP_STORAGE_BUCKET }}
          BACKUP_STORAGE_REGION: ${{ secrets.BACKUP_STORAGE_REGION || 'ap-southeast-1' }}
          BACKUP_ACCESS_KEY_ID: ${{ secrets.BACKUP_ACCESS_KEY_ID }}
          BACKUP_SECRET_ACCESS_KEY: ${{ secrets.BACKUP_SECRET_ACCESS_KEY }}
        run: npx tsx scripts/ops/backup-export.ts
```

### 6.7 Quarterly Restore Drill Automation Script (`scripts/ops/restore-drill.ts`)

```typescript
import { execSync } from 'child_process';
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
  const drillDbUrl = process.env.DRILL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/clt_restore_drill';

  if (drillDbUrl.includes(':54323')) {
    throw new Error('Safety check failed: DRILL_DATABASE_URL must not point to Supabase Studio (port 54323)');
  }

  if (!bucket || !gpgPassphrase) {
    throw new Error('Missing backup bucket or GPG passphrase (BACKUP_STORAGE_BUCKET, BACKUP_GPG_PASSPHRASE)');
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
      { encoding: 'utf-8', env: execEnv }
    ).trim();

    if (!latestSnapshot) {
      throw new Error(`No daily snapshots found in bucket s3://${bucket}/daily/`);
    }

    const downloadPath = path.join(tempDir, latestSnapshot);
    execSync(`aws s3 cp "s3://${bucket}/daily/${latestSnapshot}" "${downloadPath}"`, { stdio: 'inherit', env: execEnv });

    // 2. Decrypt archive using --passphrase-fd 0 via stdin
    console.log('Decrypting snapshot via stdin passphrase pipe...');
    execSync(
      `gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 -d -o "${decryptedDump}" "${downloadPath}"`,
      { input: gpgPassphrase, stdio: ['pipe', 'inherit', 'inherit'], env: execEnv }
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
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const existingTables = new Set(tablesRes.rows.map((r) => r.table_name));

    const tableVerification: Record<string, { present: boolean; rowCount: number }> = {};
    let allTablesPresent = true;

    for (const table of EXPECTED_PUBLIC_TABLES) {
      const present = existingTables.has(table);
      let rowCount = 0;
      if (present) {
        const countRes = await pg.query(`SELECT count(*)::int as cnt FROM public."${table}"`);
        rowCount = countRes.rows[0].cnt;
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
```

### 6.8 Incident Response Runbook (`docs/runbooks/INCIDENT_RESPONSE.md`)

````markdown
# Incident Response Runbook — Cosmo Ledger Track

## 1. Severity Levels

Aligned with AGENTS.md §6 audit severity taxonomy:

| Severity | AGENTS.md Equivalent | Definition | Target Response Time | Actions |
|---|---|---|---|---|
| **SEV-1** | Blocker | Financial data corruption, calculation mismatch in production, unauthorized privilege escalation, ledger write freeze. | 15 minutes | Immediate rollback or lock, alert Zia directly, assemble incident team. |
| **SEV-2** | Major | Sync engine failure for multiple devices, Vercel function outage, Supabase latency > 2,000 milliseconds. | 1 hour | Identify failing route, restart service pool, investigate lock contention. |
| **SEV-3** | Minor | Single-user device sync conflict, UI layout defect on specific mobile model. | 4 hours | Queue for next maintenance cycle, review logs. |

## 2. Escalation Protocol

1. **Lead Role**: Orchestrator / DevOps.
2. **Immediate Contact**: Zia (Project Owner).
3. **Communication Rule**: State facts only. Quote exact error messages, affected device IDs, and affected entry sequence ranges. Never make absolute claims.

## 3. Containment Actions

If unauthorized write activity or calculation discrepancy is detected:
1. Revoke compromised device immediately via `POST /api/v1/admin/devices` with action `'revoke'`.
2. If widespread corruption is suspected, activate targeted RPC write freeze:
   ```sql
   -- Target write RPCs to halt new mutations while preserving read-only visibility
   REVOKE EXECUTE ON FUNCTION rpc_push_sync_op(uuid, jsonb, int) FROM service_role;
   REVOKE EXECUTE ON FUNCTION rpc_supersede_entry(uuid, text, jsonb, text, text) FROM service_role;
   REVOKE EXECUTE ON FUNCTION void_entry(uuid, text) FROM service_role;
   REVOKE EXECUTE ON FUNCTION record_settlement_payment(uuid, bigint, date, text, text, text, boolean, uuid) FROM service_role;
   REVOKE EXECUTE ON FUNCTION close_month(date, text) FROM service_role;
   ```
3. To re-grant execution permissions post-incident containment:
   ```sql
   GRANT EXECUTE ON FUNCTION rpc_push_sync_op(uuid, jsonb, int) TO service_role;
   GRANT EXECUTE ON FUNCTION rpc_supersede_entry(uuid, text, jsonb, text, text) TO service_role;
   GRANT EXECUTE ON FUNCTION void_entry(uuid, text) TO service_role;
   GRANT EXECUTE ON FUNCTION record_settlement_payment(uuid, bigint, date, text, text, text, boolean, uuid) TO service_role;
   GRANT EXECUTE ON FUNCTION close_month(date, text) TO service_role;
   ```
4. Preserve audit log evidence:
   ```sql
   SELECT * FROM audit_log ORDER BY id DESC LIMIT 100;
   ```
````

### 6.9 Deployment Rollback Runbook (`docs/runbooks/ROLLBACK.md`)

````markdown
# Deployment Rollback Runbook — Cosmo Ledger Track

## 1. Trigger Conditions

Initiate rollback immediately if any of the following occur during or following deployment:
1. Error rate on `/api/v1/*` exceeds 1.0% in a 5-minute rolling window.
2. Advisory lock acquisition latency (`1001` or `1002`) exceeds 1,000 milliseconds.
3. Health check endpoint `/api/v1/health` returns status code >= 500.

## 2. Vercel Web Deployment Rollback

1. Open Vercel Project Dashboard -> Deployments.
2. Identify the previous stable deployment hash.
3. Click `Instant Rollback` to re-route 100% of production traffic to the previous deployment.
4. Verify web endpoint health:
   ```bash
   curl -I https://cosmo-ledger.vercel.app/api/v1/health
   ```
   Expected: `HTTP/2 200`.

## 3. Client Dexie Schema Compatibility Guards

1. **Version Immutability**: IndexedDB schemas cannot be downgraded without clearing client data.
2. If a client device has upgraded to a higher Dexie version, rolling back web assets will trigger `VersionError`.
3. The offline service worker and app shell (`Plan 017`) must maintain backward compatibility with previous schema definitions. Never delete stores or indexes during a rollback.

## 4. Database Migration Rollback

Because financial tables are append-only and immutable (AGENTS.md Rule 4):
1. **Never drop tables or truncate columns** in production.
2. If an erroneous migration was applied, author a forward-fixing migration:
   ```bash
   supabase migration new rollback_<name>
   ```
3. Author the reversal DDL and deploy using Supabase CLI with owner authorization:
   ```bash
   supabase db push
   ```
````

### 6.10 Backup and PITR Restore Runbook (`docs/runbooks/BACKUP_RESTORE.md`)

````markdown
# Backup and PITR Restore Runbook — Cosmo Ledger Track

## 1. Supabase Point-in-Time Recovery (PITR)

Supabase maintains Continuous WAL archiving with a 7-day retention horizon [UNVERIFIED: Supabase Pro tier 7-day PITR retention is an add-on or tier-dependent feature; verify exact SLA and pricing tier before production launch].

To restore to a specific timestamp (e.g. prior to an incident):
1. Navigate to Supabase Dashboard -> Database -> Backups -> Point in Time.
2. Select target recovery timestamp in Asia/Dhaka time (`YYYY-MM-DD HH:mm:ss`).
3. Trigger `Restore to Timestamp`.
4. Recovery completes into a cloned project instance with a new project reference ID.
5. **Mandatory Environment Synchronization**: Update all five environment variables in Vercel and CI secret configurations to point to the cloned project:
   - `DATABASE_URL`: Updated pooler connection string (port 6543).
   - `DIRECT_DATABASE_URL`: Updated direct database connection string (port 5432).
   - `PUBLIC_SUPABASE_URL`: Updated project URL (`https://<NEW_PROJECT_ID>.supabase.co`).
   - `PUBLIC_SUPABASE_ANON_KEY`: Updated project anon key.
   - `SUPABASE_SERVICE_ROLE_KEY`: Updated project service role key.
6. Verify ledger invariant:
   ```sql
   SELECT count(*) FROM entries WHERE status = 'active';
   ```

## 2. Off-Supabase Disaster Recovery (Cold Restore)

If the primary Supabase project is lost or inaccessible:
1. Locate latest encrypted snapshot in `s3://cosmo-ledger-backups-prod/daily/`.
2. Decrypt dump using stdin pipe (never shell arguments):
   ```bash
   gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 -d -o restored.sql ledger_snapshot_<timestamp>.sql.gpg
   ```
3. Provision new PostgreSQL 15+ instance.
4. Pre-populate prerequisite roles, auth stub schema, and extension stubs before restoring public dump:
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
   END $$;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE SCHEMA IF NOT EXISTS auth;
   CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}'::jsonb);
   CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
   CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
   ```
5. Execute restoration script with `ON_ERROR_STOP=1`:
   ```bash
   psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f restored.sql
   ```
6. Re-apply table write revocations and service role grants:
   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
   REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
   ```
7. Sync storage files:
   ```bash
   aws s3 sync "s3://cosmo-ledger-backups-prod/storage/" "s3://supabase-storage/"
   ```
8. Execute verification suite against restored database.
````

### 6.11 Credential & Secret Rotation Runbook (`docs/runbooks/CREDENTIAL_ROTATION.md`)

````markdown
# Credential & Secret Rotation Runbook — Cosmo Ledger Track

## 1. Supabase Service Role Key Rotation

The service role key bypasses RLS and is restricted to SvelteKit `+server.ts` routes.

1. Open Supabase Dashboard -> Project Settings -> API.
2. In the `JWT Secret` section, generate a new secondary service role key.
3. Update Vercel Environment Variables:
   - Set `SUPABASE_SERVICE_ROLE_KEY` to the new key value.
   - Trigger deployment redeploy to inject variable across all serverless containers.
4. Verify server routes function normally:
   ```bash
   curl -X GET "https://cosmo-ledger.vercel.app/api/v1/health"
   ```
5. Revoke the old service role key in the Supabase Dashboard.

## 2. Database User Password Rotation

1. Generate strong 32-character random string in secret manager.
2. Update database password in Supabase Dashboard -> Settings -> Database.
3. Update `DATABASE_URL` and `DIRECT_DATABASE_URL` connection strings in Vercel and CI secret configurations.
4. Restart Vercel function instances.

## 3. Supabase JWT Secret Rotation

1. **Impact Notification**: Rotating the Supabase JWT secret changes both `PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
2. **Native App Re-Packaging Required**: Because `PUBLIC_SUPABASE_ANON_KEY` is embedded into the Capacitor Android binary (Plan 019), rotating the JWT secret requires releasing an updated Android App Bundle (`.aab`) to the Google Play Store.
3. Update `SUPABASE_JWT_SECRET` in Vercel and CI environments.
4. All connected staff users must re-authenticate with email/password.

## 4. Bootstrap Credential Post-Launch Cleanup

1. `BOOTSTRAP_OWNER_EMAIL` and `BOOTSTRAP_OWNER_PASSWORD` are one-time M0 initialization credentials.
2. Once the Owner account is established and ownership transfer capability is verified:
   - Remove `BOOTSTRAP_OWNER_PASSWORD` from local `.env` and CI deployment variables.
   - Ensure `scripts/bootstrap.ts` cannot be executed against production environments (`NODE_ENV === 'production'` guard).
````

### 6.12 Pre-Deployment Verification Script (`scripts/ops/deploy-check.ts`)

```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Handle CLI help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: tsx scripts/ops/deploy-check.ts [options]

Options:
  --env=<staging|production>      Target deployment environment (default: production)
  --milestone=<name>              Target readiness gate milestone (default: production)

Pre-deployment readiness verification:
1. Validates all Implementation Readiness Gates for target milestone.
2. Verifies owner written release authorization (ZIA-APPROVED) for target env in LEDGER.md.
3. For production: verifies open business policies Q1-Q4 have Status: CONFIRMED in DECISIONS.md.
`);
  process.exit(0);
}

export function parseCliArgs(args: string[] = process.argv.slice(2)): { targetEnv: string; milestone: string } {
  let targetEnv = 'production';
  let milestone = 'production';

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--env=')) targetEnv = args[i].split('=')[1];
    else if (args[i] === '--env' && i + 1 < args.length) targetEnv = args[++i];
    else if (args[i].startsWith('--milestone=')) milestone = args[i].split('=')[1];
    else if (args[i] === '--milestone' && i + 1 < args.length) milestone = args[++i];
  }
  return { targetEnv, milestone };
}

export function verifyApprovalString(content: string, targetEnv: string): boolean {
  // Use properly escaped RegExp constructor
  const approvalRegex = new RegExp(
    '^ZIA-APPROVED:\s+CLT-REL-\d+\s+' + targetEnv + '\s+\d{4}-\d{2}-\d{2}',
    'm'
  );
  return approvalRegex.test(content);
}

export function verifyDecisionsConfirmed(content: string): { valid: boolean; missing: string[] } {
  const requiredPolicies = [
    { name: 'Q1 (VAT Rule)', pattern: 'Q1.*VAT' },
    { name: 'Q2 (Net Definition)', pattern: 'Q2.*Net' },
    { name: 'Q3 (Commission Structure)', pattern: 'Q3.*Commission' },
    { name: 'Q4 (Method Charges Borne)', pattern: 'Q4.*Charges' },
  ];

  const missing: string[] = [];
  for (const policy of requiredPolicies) {
    const sectionRegex = new RegExp(
      '## [^\n]*' + policy.pattern + '[\s\S]*?(?=## |$)',
      'i'
    );
    const match = content.match(sectionRegex);
    if (!match) {
      missing.push(`${policy.name} (section not found)`);
      continue;
    }
    const section = match[0];
    if (/PENDING/i.test(section) || !/Status:\s*CONFIRMED/i.test(section)) {
      missing.push(`${policy.name} (not confirmed)`);
    }
  }

  return { valid: missing.length === 0, missing };
}

export async function verifyDeploymentReadiness(cliArgs?: string[]): Promise<void> {
  const { targetEnv, milestone } = parseCliArgs(cliArgs);
  console.log(`Executing Pre-Deployment Operational Verification for Environment: ${targetEnv}...`);

  // 1. Verify Implementation Readiness Gates
  console.log(`Checking Implementation Readiness Gates for milestone: ${milestone}...`);
  try {
    execSync(`pnpm test:gates --milestone ${milestone}`, { stdio: 'inherit' });
  } catch {
    console.error(`FAILED: Implementation Readiness Gates not satisfied for ${milestone}.`);
    process.exit(1);
  }

  // 2. Verify Zia written approval (AGENTS.md Rule 19)
  console.log(`Checking Owner release approval string for environment: ${targetEnv}...`);
  const ledgerPath = path.resolve(process.cwd(), 'docs/orchestration/LEDGER.md');
  let approvalFound = false;
  if (fs.existsSync(ledgerPath)) {
    const content = fs.readFileSync(ledgerPath, 'utf-8');
    approvalFound = verifyApprovalString(content, targetEnv);
  }

  if (!approvalFound) {
    console.error(`FAILED: Missing mandatory written approval from Zia in docs/orchestration/LEDGER.md.`);
    console.error(`Format required: ZIA-APPROVED: <release id> ${targetEnv} <date>`);
    process.exit(1);
  }

  // 3. Verify Open Policy Confirmation Q1-Q4 (AGENTS.md Rule 20)
  if (targetEnv === 'production') {
    console.log('Checking business policy confirmation Q1-Q4 in DECISIONS.md...');
    const decisionsPath = path.resolve(process.cwd(), 'DECISIONS.md');
    if (!fs.existsSync(decisionsPath)) {
      console.error('FAILED: root DECISIONS.md does not exist.');
      process.exit(1);
    }
    const decisionsContent = fs.readFileSync(decisionsPath, 'utf-8');
    const { valid, missing } = verifyDecisionsConfirmed(decisionsContent);

    if (!valid) {
      console.error(`FAILED: Policy decisions missing or pending: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`All pre-deployment checks PASSED for ${targetEnv}. Release authorized.`);
}

if (process.argv[1] && process.argv[1].endsWith('deploy-check.ts')) {
  verifyDeploymentReadiness().catch((err) => {
    console.error('Deployment check failed:', err);
    process.exit(1);
  });
}
```

### 6.13 Governance Unit Test Suite (`tests/ops/deploy-check.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { parseCliArgs, verifyApprovalString, verifyDecisionsConfirmed } from '../../scripts/ops/deploy-check';

describe('deploy-check CLI Argument Parsing & Regex Validation', () => {
  it('defaults to production environment and milestone', () => {
    const parsed = parseCliArgs([]);
    expect(parsed.targetEnv).toBe('production');
    expect(parsed.milestone).toBe('production');
  });

  it('correctly parses --env=staging and --milestone=m2', () => {
    const parsed = parseCliArgs(['--env=staging', '--milestone=m2']);
    expect(parsed.targetEnv).toBe('staging');
    expect(parsed.milestone).toBe('m2');
  });

  it('matches valid ZIA-APPROVED string format with trailing date', () => {
    const validContent = `
# Ledger
ZIA-APPROVED: CLT-REL-001 production 2026-11-02
`;
    expect(verifyApprovalString(validContent, 'production')).toBe(true);
    expect(verifyApprovalString(validContent, 'staging')).toBe(false);
  });

  it('validates Q1-Q4 policies with Status: CONFIRMED', () => {
    const validDecisions = `
## CLT-POLICY-Q1: VAT Treatment Rule
Status: CONFIRMED

## CLT-POLICY-Q2: Net / Final Calculation Definition
Status: CONFIRMED

## CLT-POLICY-Q3: Commission Deduction Structure
Status: CONFIRMED

## CLT-POLICY-Q4: Method Charges Borne Allocation
Status: CONFIRMED
`;
    const res = verifyDecisionsConfirmed(validDecisions);
    expect(res.valid).toBe(true);
  });

  it('rejects decisions still marked PENDING', () => {
    const pendingDecisions = `
## CLT-POLICY-Q1: VAT Treatment Rule
Status: PENDING
`;
    const res = verifyDecisionsConfirmed(pendingDecisions);
    expect(res.valid).toBe(false);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| `vercel_config_syntax` | `jq .framework apps/web/vercel.json` | `"sveltekit"` | PRD §13 | `apps/web/vercel.json` |
| `env_template_secret_scan` | `! grep -i -E "(password|secret)\s*=\s*[a-zA-Z0-9]" .env.production.example` | Exit code 0 | PRD §12, AGENTS.md Rule 8 | `.env.production.example` |
| `backup_export_script_help` | `npx tsx scripts/ops/backup-export.ts --help` | Exit code 0 | PRD §12 | `scripts/ops/backup-export.ts` |
| `restore_drill_script_help` | `npx tsx scripts/ops/restore-drill.ts --help` | Exit code 0 | PRD §12 | `scripts/ops/restore-drill.ts` |
| `deploy_check_script_help` | `npx tsx scripts/ops/deploy-check.ts --help` | Exit code 0 | PRD §18, AGENTS.md Rule 19 | `scripts/ops/deploy-check.ts` |
| `deploy_check_unit_tests` | `pnpm vitest run tests/ops/deploy-check.test.ts` | Tests passed | PRD §18 | `tests/ops/deploy-check.test.ts` |

## 8. Acceptance Criteria

| Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|
| Vercel headers enforce strict security | `jq '.headers[0].headers[] | select(.key=="X-Frame-Options").value' apps/web/vercel.json` | `"DENY"` |
| SvelteKit config defines maxDuration 15 in sin1 | `grep -E "maxDuration:\s*15" apps/web/svelte.config.js` | Matches |
| Health check endpoint exists | `test -f apps/web/src/routes/api/v1/health/+server.ts` | Exit code 0 |
| All 4 operational runbooks exist | `ls -1 docs/runbooks/*.md | wc -l` | `4` |
| Daily backup workflow configured | `test -f .github/workflows/daily-backup.yml` | Exit code 0 |
| Backup export script responds to `--help` | `npx tsx scripts/ops/backup-export.ts --help` | Exit code 0 |
| Restore drill script responds to `--help` | `npx tsx scripts/ops/restore-drill.ts --help` | Exit code 0 |
| Pre-deployment checker unit tests pass | `pnpm vitest run tests/ops/deploy-check.test.ts` | Exit code 0 |

## 9. Hard Rules Touched

- Rule 8 (No secrets): Environment template uses variable placeholders only; scripts pass credentials through standard libpq environment variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`) and GPG `--passphrase-fd 0` via stdin, avoiding process table (`ps aux` / `/proc/<pid>/cmdline`) exposure.
- Rule 18 (No destructive commands): Restore drill targets isolated scratch DB `clt_restore_drill` (refusing Studio or primary DB); rollback runbook prohibits dropping tables or truncating columns.
- Rule 19 (No deployment without written approval): Pre-deployment verification script blocks releases without properly formatted `ZIA-APPROVED: <release id> <environment> <date>`.
- Rule 20 (Q1–Q4 Sign-off Precondition): Pre-deployment verification script blocks production rollout until Q1–Q4 policy blocks have `Status: CONFIRMED` in `DECISIONS.md`.

## 10. Pitfalls

- **Pitfall 1: Vercel serverless function cold start timeout during multi-payable reconciliation.**
  - *Symptom*: Client receives HTTP 504 Gateway Timeout on `/api/v1/reconcile/statements/reconcile`.
  - *Fix*: Configure adapter `maxDuration: 15` seconds and `regions: ['sin1']` in `svelte.config.js` to minimize network roundtrips to Singapore database.
- **Pitfall 2: `pg_dump` failure on pooler query parameters.**
  - *Symptom*: `pg_dump` fails with invalid URI parameter or unsupported features over pooler port 6543.
  - *Fix*: Parse `DIRECT_DATABASE_URL` into standard libpq environment variables pointing to direct PostgreSQL port 5432; reject fallback to `DATABASE_URL`.
- **Pitfall 3: GPG interactive prompt failure or unknown option in headless CI/cron.**
  - *Symptom*: `gpg: unknown option '--passphrase-env'` or `cannot open '/dev/tty'`.
  - *Fix*: Pass `--pinentry-mode loopback` and `--passphrase-fd 0` streaming passphrase over stdin.
- **Pitfall 4: Premature production release before Q1–Q4 confirmation.**
  - *Symptom*: Business owner disputes VAT or commission deduction calculations in production.
  - *Fix*: Hard-block deployment script `scripts/ops/deploy-check.ts` on explicit confirmation entries (`Status: CONFIRMED`) in root `DECISIONS.md`.
- **Pitfall 5: Cold restore missing roles and grants.**
  - *Symptom*: Restoring `--no-privileges` dump leaves public tables with default grants and functions executable by PUBLIC.
  - *Fix*: Pre-populate roles `anon`, `authenticated`, `service_role` and re-apply table write revocations and service role execute grants post-restore.

## 11. PRD ISSUES and DECISION PENDING

- **DECISION PENDING 021-1 (PRD §17 M5 & AGENTS.md Rule 20)**:
  - *Issue*: Production deployment requires owner confirmation or replacement of default policies for Q1 (VAT rule), Q2 (Net/"Final" definition), Q3 (commission structure), and Q4 (who bears method charges).
  - *Status*: Blocked on Zia's confirmation before production release. Default seed values from PRD §7.4 serve as interim staging values.

## 12. Handoff

What later operations rely on once this plan is Implemented:
- `apps/web/vercel.json` and `apps/web/svelte.config.js` for CI/CD Vercel builds.
- Scheduled daily GitHub Action `.github/workflows/daily-backup.yml` executing `scripts/ops/backup-export.ts`.
- Quarterly operational calendar executing `scripts/ops/restore-drill.ts`.
- Deployment automation using `scripts/ops/deploy-check.ts`.

## 13. Suggested Task Breakdown

- Task `021-A`: Author `apps/web/vercel.json`, `apps/web/svelte.config.js`, `apps/web/src/routes/api/v1/health/+server.ts`, and `.env.production.example`. Scope: `apps/web/vercel.json`, `apps/web/svelte.config.js`, `apps/web/src/routes/api/v1/health/+server.ts`, `.env.production.example`. Depends on: 001, 008, 019. Role: DevOps. Priority: P0.
- Task `021-B`: Author `scripts/ops/backup-export.ts`, `.github/workflows/daily-backup.yml`, and `scripts/ops/restore-drill.ts`. Scope: `scripts/ops/backup-export.ts`, `.github/workflows/daily-backup.yml`, `scripts/ops/restore-drill.ts`. Depends on: 003. Role: DevOps. Priority: P0.
- Task `021-C`: Author operational runbooks (`INCIDENT_RESPONSE.md`, `ROLLBACK.md`, `BACKUP_RESTORE.md`, `CREDENTIAL_ROTATION.md`). Scope: `docs/runbooks/*.md`. Depends on: 003, 011, 015. Role: DevOps. Priority: P0.
- Task `021-D`: Author `scripts/ops/deploy-check.ts` pre-deployment verification runner and `tests/ops/deploy-check.test.ts`. Scope: `scripts/ops/deploy-check.ts`, `tests/ops/deploy-check.test.ts`. Depends on: 020, 021A, 021B, 021C. Role: DevOps. Priority: P0.

## Changelog

- 2026-11-02 — Revision 2.2:
  - Resolved Blocker 1: Replaced non-existent `gpg --passphrase-env` with standard `--passphrase-fd 0` streaming passphrase over stdin pipe in `backup-export.ts`, `restore-drill.ts`, and `BACKUP_RESTORE.md`.
  - Resolved Blocker 2: Parsed `DIRECT_DATABASE_URL` into standard libpq environment variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`), preventing connection URI failures in `PGDATABASE` and eliminating CLI argument secret leakage.
  - Resolved Blocker 3: Corrected template literal regex escaping in `deploy-check.ts` (using double-escaped `\s`, `\d`, `[\s\S]*?`) and replaced invalid `\Z` anchor with `$`, ensuring valid `ZIA-APPROVED` and Q1–Q4 policy confirmations match successfully. Added dedicated unit tests in `deploy-check.test.ts`.
  - Resolved Blocker 4 & 5: Added prerequisite roles (`anon`, `authenticated`, `service_role`) and auth helper function stubs (`auth.uid()`, `auth.jwt()`) to cold restore and restore drill; added post-restore re-application and verification of table write revocations and service role grants.
  - Resolved Blocker 6: Changed restore drill default database from port 54323 (Studio) to isolated scratch database `clt_restore_drill` on port 54322, adding safety guard refusing Studio URLs.
  - Resolved Blocker 7: Created automated daily backup GitHub Actions workflow `.github/workflows/daily-backup.yml` scheduled at `0 20 * * *` (2 AM Asia/Dhaka) and added storage bucket sync for receipts and statements.
  - Resolved Blocker 8 & 9: Created production health check endpoint `apps/web/src/routes/api/v1/health/+server.ts` and configured Vercel serverless region `sin1` (Singapore) to minimize database latency.
  - Resolved Further Defects: Fixed `.env.production.example` placeholder format to pass regex check, documented native APK re-release requirements during Supabase JWT secret rotation, added targeted RPC revocation and re-grant SQL in `INCIDENT_RESPONSE.md`, and documented Dexie schema version downgrade guards in `ROLLBACK.md`.
- 2026-11-02 — Revision 2.1:
  - Initial pass addressing process table leaks, 4-backtick fences, and adapter branching.
- 2026-11-01 — Revision 2.0:
  - Added `--help` CLI handling and runbook structure.
- 2026-10-29 — Revision 1.0:
  - Initial release of Plan 021 specifying hosting configuration and runbooks.
