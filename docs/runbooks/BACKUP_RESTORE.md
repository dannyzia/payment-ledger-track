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

## 3. Scheduled Drills

`scripts/ops/restore-drill.ts` automates §2 into the isolated scratch database
`clt_restore_drill` (port 54322; it refuses Studio 54323 and the primary DB) and
writes `docs/orchestration/reports/RESTORE_DRILL_<timestamp>.json` with per-table
row counts and a write-revocation check. Run it quarterly, and record the report.
