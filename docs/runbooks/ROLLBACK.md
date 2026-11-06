# Deployment Rollback Runbook — Cosmo Ledger Track

Plan 021 §6.9. Web rollback is a Vercel dashboard action; database rollback is
a forward fix, never a destructive reversal (AGENTS.md Rule 4, Rule 18).

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
3. The offline service worker and app shell (Plan 017) must maintain backward compatibility with previous schema definitions. Never delete stores or indexes during a rollback.

## 4. Database Migration Rollback

Because financial tables are append-only and immutable (AGENTS.md Rule 4):
1. **Never drop tables or truncate columns** in production.
2. If an erroneous migration was applied, author a forward-fixing migration:
   ```bash
   supabase migration new rollback_<name>
   ```
3. Author the reversal DDL and deploy using Supabase CLI with owner authorization
   (Rule 19: requires a `ZIA-APPROVED:` line naming the release and environment):
   ```bash
   supabase db push
   ```
