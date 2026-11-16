# Backup and PITR Restore Runbook — Cosmo Ledger Track

Plan 021 §6.10. Two independent recovery paths: Supabase Point-in-Time Recovery
(managed) and the off-Supabase encrypted archive (cold restore).

## 1. Supabase Point-in-Time Recovery (PITR)

Supabase maintains Continuous WAL archiving with a 7-day retention horizon
[UNVERIFIED: Supabase Pro tier 7-day PITR retention is an add-on or
tier-dependent feature; verify exact SLA and pricing tier before production
launch].

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

The nightly job writes to `s3://<BACKUP_STORAGE_BUCKET>/daily/`:

| Object | Contents |
|---|---|
| `ledger_snapshot_<timestamp>.sql.gpg` | `public` schema, dumped with `--clean --if-exists` |
| `auth_snapshot_<timestamp>.sql.gpg` | `auth` schema: users, identities, MFA factors. Without it a restore brings back no logins and no 2FA enrolment |
| `manifest.json` | the latest run: `completedAt`, each file's S3 key, SHA-256 and size, and the Storage buckets synced |
| `manifest_<timestamp>.json` | the same record, kept per run |
| `storage/receipts/`, `storage/statements/` | the two private buckets the app creates (`receipts`, `statements`) |

If the primary Supabase project is lost or inaccessible:
1. Locate the latest `manifest.json` in `s3://<BACKUP_STORAGE_BUCKET>/daily/` and note the file names and sizes it records.
2. Decrypt both dumps using stdin pipe (never shell arguments):
   ```bash
   for f in ledger_snapshot auth_snapshot; do
     gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 -d \
       -o "${f}.sql" "${f}_<timestamp>.sql.gpg"
   done
   ```
3. Provision new PostgreSQL 15+ instance.
4. Restore the auth schema **first** (it has no `--clean`, so it must land before the public dump references it):
   ```bash
   psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f auth_snapshot.sql
   ```
   Only if `auth_snapshot.sql` is unavailable (an archive predating this runbook) do you fall back to the stub below, and then every user must re-enrol:
5. Pre-populate prerequisite roles and extension stubs before restoring the public dump:
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
6. Execute the public restoration script with `ON_ERROR_STOP=1`:
   ```bash
   psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f ledger_snapshot.sql
   ```
7. Re-apply table write revocations and service role grants:
   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
   REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
   ```
8. Sync storage files back into the new project's buckets:
   ```bash
   for bucket in receipts statements; do
     aws s3 sync "s3://<BACKUP_STORAGE_BUCKET>/storage/${bucket}/" "s3://<NEW_STORAGE_ENDPOINT>/${bucket}/"
   done
   ```
9. Execute verification suite against restored database.

### 2.1 Verifying the archive is alive

`scripts/ops/backup-verify.ts` answers one question: did a backup finish in the last 24 hours?

```bash
# CI: reads the manifest the export just wrote
tsx scripts/ops/backup-verify.ts

# Operator, against the bucket
BACKUP_STORAGE_BUCKET=<bucket> tsx scripts/ops/backup-verify.ts

# The verifier's own checks, offline, no AWS
tsx scripts/ops/backup-verify.ts --self-test
```

It exits non-zero with `backup_stale` (older than 24 h), `backup_manifest_missing` or `backup_manifest_unavailable`. The nightly workflow runs it after the export and opens a `Nightly backup failed` issue on any failure, so a silent week cannot repeat.

The export fails loudly on a missing secret rather than exiting quietly: `missing_environment: <names>`. `BACKUP_STORAGE_SOURCE` must name an S3-compatible base the backup keys can read; if the Supabase plan does not expose Storage over S3, that sync is the blocker, not something to skip.

[UNVERIFIED] A 7-year lifecycle rule on the destination bucket is a requirement, not a verified configuration; confirm it in the bucket policy before claiming retention.

## 3. Scheduled Drills

`scripts/ops/restore-drill.ts` automates §2 into the isolated scratch database
`clt_restore_drill` (port 54322; it refuses Studio 54323 and the primary DB) and
writes `docs/orchestration/reports/RESTORE_DRILL_<timestamp>.json` with per-table
row counts and a write-revocation check. Run it quarterly, and record the report.
