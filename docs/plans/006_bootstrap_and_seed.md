# 006_bootstrap_and_seed.md — Database Bootstrap Runbook, Canonical Seeding, and Baseline Verification

- Plan Identifier: CLT-PLAN-006
- Phase: Phase 0 / M0
- Milestone: M0
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §7.4 (bootstrap runbook and seed script), §17 (Milestone M0 Definition of Done)
- Depends on: 003, 004, 005
- Current Status: Not Implemented
- Revision: 2.3 — 2026-11-01

## 1. Purpose

Implement the automated database initialization runner script (`scripts/bootstrap.ts`) and end-to-end baseline verification for Milestone M0. This script executes Steps 1 through 8 of PRD §7.4 under `service_role` credentials inside an isolated transaction protected by advisory lock `(1004, 1)`. The script provisions the initial Owner user in Supabase Auth, upserts the Owner profile, seeds canonical payment methods and payables, publishes Rate Profile v1 backdated to 2026-01-01 with operational method rates, activates payment methods, initializes singleton application settings, generates initial settlement records, and logs `Bootstrap completed successfully.`. Re-running the script against a previously bootstrapped database is non-destructive and idempotent, safely verifying existing baseline configurations without overwriting active roles, deactivated methods, or custom payable due days.

## 2. Scope

- IN:
  - TypeScript runner script `scripts/bootstrap.ts` executable via `tsx` (`pnpm db:bootstrap`).
  - Execution of PRD §7.4 Steps 1 to 8:
    - Step 1: Provision initial Owner authentication user via Supabase Auth Admin API (`createUser`) with paginated user lookup (`listUsers({ perPage: 100 })`) and `app_metadata: { role: 'owner' }`.
    - Step 2: Upsert Owner profile into `profiles` table (`id`, `full_name = 'Primary Owner'`, `role = 'owner'`, `active = true`) guarded against modifying demoted former owners on re-runs.
    - Step 3 `[PLAN-DERIVED]`: Seed 5 canonical payment methods: `cash`, `bkash`, `visa`, `mastercard`, `bank_transfer` (seeded initially with `active = false` to satisfy trigger ordering, activated in Step 6).
    - Step 4 `[PLAN-DERIVED]`: Seed 4 canonical payables: `vat_payable`, `bkash_charge_payable`, `visa_charge_payable`, `mastercard_charge_payable`.
    - Step 5 `[PLAN-DERIVED]`: Seed Rate Profile v1 in draft under `service_role` with `effective_from = '2026-01-01'`, `version = 1`, `status = 'draft'`, `vat_mode = 'manual'`, `vat_bp = 0`, `commission_bp = 4200`, `commission_base = 'gross_minus_vat'`, `charges_borne_by = 'business'`. (Bootstrap exemption documented in root `DECISIONS.md` CLT-D-002; draft state allows method rate insertion per PRD ISSUE 006-1).
    - Step 6 `[PLAN-DERIVED]`: Seed `method_rates` for Profile v1 (bKash 115 bp, Visa 150 bp, Mastercard 150 bp, others 0 bp), update Profile v1 to `status = 'published'`, and activate all 5 payment methods (`active = true`).
    - Step 7: Initialize singleton row in `app_settings` (`timezone = 'Asia/Dhaka'`, `currency = 'BDT'`, `locale = 'en-BD'`, `net_label = 'Net after deductions'`, `reconcile_tolerance_poisha = 100`).
    - Step 8: Initialize current-month settlements via internal procedure `generate_monthly_settlements((now() at time zone 'Asia/Dhaka')::date)`.
  - Audit logging of `system.bootstrap` event in `audit_log` with typed `$2::uuid` parameter.
  - Logging of `Bootstrap completed successfully.` on standard output.
  - Integration test `tests/db/bootstrap.test.ts` verifying all 18 public tables, clean bootstrap execution, profile, methods, payables, rate profile v1, method rates, settings, concrete current-month settlements, and complete idempotency.
- OUT:
  - Public authentication routes or web login screens (owned by Plan 008).
  - Admin management UI panels (owned by Plan 009).

## 3. Preconditions

1. Plan 003 is Implemented and all 18 public tables exist in PostgreSQL.
   - Check command: `pnpm vitest run tests/db/schema.test.ts`
   - Expected output: exit code `0`.
2. Plans 004 and 005 are Implemented (database functions, procedures, and triggers exist).
   - Check command: `test -f supabase/migrations/20261029000006_functions_settlement_recon_month.sql && echo "RPC_READY"`
   - Expected output: `RPC_READY`
3. Local Supabase container stack is running and reachable.
   - Check command: `supabase status`
   - Expected output: string containing `API URL: http://` and `DB URL: postgresql://`.
4. Required environment variables set in local environment or `.env.local`:
   - `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
5. Supabase JS Client (`@supabase/supabase-js`) and `dotenv` installed in root workspace devDependencies (Plan 001 §6.2).
   - Check command: `pnpm exec node -e 'require("@supabase/supabase-js"); require("dotenv"); console.log("DEPS_READY")'`
   - Expected output: `DEPS_READY`

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `scripts/bootstrap.ts` | create | Standalone bootstrap runner provisioning initial owner, canonical seed data, and safe idempotency |
| `tests/db/bootstrap.test.ts` | create | Integration test suite verifying 18 tables, bootstrap execution, and idempotent re-execution |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Ensure `@supabase/supabase-js` and `dotenv` are available in root `devDependencies` (configured in Plan 001 §6.2; install if absent: `pnpm add -D -w @supabase/supabase-js dotenv`).
   - Check: `pnpm exec node -e 'import("@supabase/supabase-js").then(() => console.log("OK"))'`
   - Expected output: `OK`

2. Create bootstrap runner script `scripts/bootstrap.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `scripts/bootstrap.ts`.
   - Check: `head -n 25 scripts/bootstrap.ts`
   - Expected output: contains imports from `@supabase/supabase-js`, `pg`, and `dotenv`.

3. Create bootstrap integration test suite `tests/db/bootstrap.test.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `tests/db/bootstrap.test.ts`.
   - Check: `cat tests/db/bootstrap.test.ts | head -n 25`
   - Expected output: contains describe block for bootstrap runner.

4. Reset local database to apply clean migrations without seed data.
   - Command: `pnpm db:reset`
   - Check: check exit code.
   - Expected output: exits with code 0.

5. Execute bootstrap script using root script `pnpm db:bootstrap`.
   - Command: `pnpm db:bootstrap`
   - Check: check exit code and stdout.
   - Expected output: exits with code 0 and logs `Bootstrap completed successfully.`.

6. Execute bootstrap script a second time to verify complete non-destructive idempotency.
   - Command: `pnpm db:bootstrap`
   - Check: check exit code and stdout.
   - Expected output: exits with code 0 and logs `Bootstrap completed successfully.` without unique constraint violations.

7. Execute bootstrap test suite sequentially to prevent database concurrency collisions with parallel test suites.
   - Command: `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts`
   - Check: check exit code.
   - Expected output: exits with code 0 and all 10 assertions pass.

## 6. Specifications

### 6.1 `scripts/bootstrap.ts`

```typescript
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

// Load local environment files (.env.local takes precedence over .env)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { Pool } = pg;

export async function bootstrap(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL || (process.env.NODE_ENV === 'production' ? '' : 'owner@cosmoledger.local');
  const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to execute bootstrap script');
  }

  if (!ownerEmail) {
    throw new Error('BOOTSTRAP_OWNER_EMAIL is required to execute bootstrap script in production');
  }

  if (!ownerPassword) {
    throw new Error('BOOTSTRAP_OWNER_PASSWORD is required to execute bootstrap script');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------------------
    // Pre-Transaction Auth Phase (Prevents holding DB locks across network I/O)
    // -------------------------------------------------------------------------
    const { rows: existingOwners } = await client.query(
      "SELECT id, role FROM profiles WHERE role = 'owner' AND active = true LIMIT 1"
    );
    const activeOwnerExists = existingOwners.length > 0;

    let ownerUserId: string | null = null;
    let page = 1;

    while (true) {
      const { data: userList, error: listError } = await supabase.auth.admin.listUsers({
        page,
        perPage: 100,
      });

      if (listError) {
        throw new Error(`Failed to list auth users: ${listError.message}`);
      }

      const existingUser = userList.users.find(
        (u) => u.email?.toLowerCase() === ownerEmail.toLowerCase()
      );

      if (existingUser) {
        ownerUserId = existingUser.id;
        break;
      }

      if (userList.users.length < 100) {
        break;
      }
      page++;
    }

    if (ownerUserId) {
      // Reconcile role: 'owner' in app_metadata ONLY if no active owner exists OR this user is already the active owner
      if (!activeOwnerExists || existingOwners[0].id === ownerUserId) {
        const { error: updateError } = await supabase.auth.admin.updateUserById(ownerUserId, {
          app_metadata: { role: 'owner' },
        });
        if (updateError) {
          throw new Error(`Failed to update owner auth metadata: ${updateError.message}`);
        }
      }
    } else {
      // Guard against creating a new owner if an active owner already exists in PostgreSQL
      if (activeOwnerExists) {
        throw new Error(
          `Cannot create new owner auth user: active owner already exists with profile ID ${existingOwners[0].id}`
        );
      }

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        app_metadata: { role: 'owner' },
        user_metadata: { full_name: 'Primary Owner' },
      });

      if (createError || !newUser?.user) {
        throw new Error(`Failed to create owner auth user: ${createError?.message ?? 'unknown'}`);
      }
      ownerUserId = newUser.user.id;
    }

    // -------------------------------------------------------------------------
    // Transaction & Advisory Lock (PRD §7.2, Finding 2)
    // Acquire dedicated bootstrap advisory lock (1004, 1) to serialize concurrent runs
    // -------------------------------------------------------------------------
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1004, 1);');

    // -------------------------------------------------------------------------
    // Non-Destructive Idempotency Guard (PRD §7.4, Rule 18)
    // Verify comprehensive baseline state before certifying existing baseline verified
    // -------------------------------------------------------------------------
    const { rows: bootstrapAudit } = await client.query(
      "SELECT 1 FROM audit_log WHERE action = 'system.bootstrap' LIMIT 1"
    );
    const { rows: publishedProfile } = await client.query(
      "SELECT id FROM rate_profiles WHERE version = 1 AND status = 'published' LIMIT 1"
    );
    const { rows: activeOwner } = await client.query(
      "SELECT 1 FROM profiles WHERE role = 'owner' AND active = true LIMIT 1"
    );
    const { rows: payablesCount } = await client.query(
      "SELECT count(*) as count FROM payables"
    );
    const { rows: methodsCount } = await client.query(
      "SELECT count(*) as count FROM payment_methods WHERE active = true"
    );

    if (
      bootstrapAudit.length > 0 &&
      publishedProfile.length > 0 &&
      activeOwner.length > 0 &&
      parseInt(payablesCount[0].count, 10) >= 4 &&
      parseInt(methodsCount[0].count, 10) >= 5
    ) {
      await client.query('COMMIT');
      process.stdout.write('Database already bootstrapped. Existing baseline verified.\nBootstrap completed successfully.\n');
      return;
    }

    // -------------------------------------------------------------------------
    // Step 2: Upsert Owner Profile (PRD §7.4 Step 2)
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO profiles (id, full_name, role, active)
      VALUES ($1, 'Primary Owner', 'owner', true)
      ON CONFLICT (id) DO UPDATE SET full_name = 'Primary Owner';
    `, [ownerUserId]);

    // -------------------------------------------------------------------------
    // Step 3 [PLAN-DERIVED]: Seed Canonical Payment Methods (PRD §7.4 Step 3)
    // Note: Seeded initially with active = false to prevent chicken-and-egg trigger
    // failure with trg_payment_methods_active_rate_check before Rate Profile v1 is
    // published. Activated in Step 6 after method_rates are seeded and Profile v1 is published.
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO payment_methods (code, name, requires_txn_ref, sort_order, active) VALUES
        ('cash', 'Cash', false, 1, false),
        ('bkash', 'bKash', true, 2, false),
        ('visa', 'Visa', true, 3, false),
        ('mastercard', 'Mastercard', true, 4, false),
        ('bank_transfer', 'Bank Transfer', true, 5, false)
      ON CONFLICT (code) DO NOTHING;
    `);

    // -------------------------------------------------------------------------
    // Step 4 [PLAN-DERIVED]: Seed Canonical Payables (PRD §7.4 Step 4)
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO payables (code, name, kind, method_id, due_day, remind_days_before, active) VALUES
        ('vat_payable', 'Government VAT Challan', 'vat', null, 15, 3, true),
        ('bkash_charge_payable', 'bKash Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'bkash'), 10, 3, true),
        ('visa_charge_payable', 'Visa Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'visa'), 15, 3, true),
        ('mastercard_charge_payable', 'Mastercard Merchant Charge', 'method_charge', (SELECT id FROM payment_methods WHERE code = 'mastercard'), 15, 3, true)
      ON CONFLICT (code) DO NOTHING;
    `);

    // -------------------------------------------------------------------------
    // Step 5 [PLAN-DERIVED]: Seed Rate Profile v1 in Draft (PRD §7.4 Step 5, PRD ISSUE 006-1)
    // Note: Profile v1 is seeded initially with status = 'draft' so that Step 6 can
    // insert method_rates without tripping trg_method_rates_draft_publish_lock.
    // Draft row is updated with exact canonical baseline parameters before publishing.
    // -------------------------------------------------------------------------
    const profileRes = await client.query(`
      SELECT id, status FROM rate_profiles WHERE version = 1 ORDER BY (status = 'published') DESC, created_at ASC LIMIT 1;
    `);

    let profileId: string;
    let alreadyPublished = false;

    if (profileRes.rows.length > 0) {
      profileId = profileRes.rows[0].id;
      alreadyPublished = profileRes.rows[0].status === 'published';

      if (!alreadyPublished) {
        // Enforce canonical baseline configuration on pre-existing draft
        await client.query(`
          UPDATE rate_profiles SET
            effective_from = '2026-01-01',
            vat_mode = 'manual',
            vat_bp = 0,
            commission_base = 'gross_minus_vat',
            commission_bp = 4200,
            charges_borne_by = 'business',
            note = 'Initial system rate profile v1 (seeded via M0 bootstrap; effective 2026-01-01)'
          WHERE id = $1;
        `, [profileId]);
      }
    } else {
      const insertProfile = await client.query(`
        INSERT INTO rate_profiles (
          id, version, status, effective_from, vat_mode, vat_bp,
          commission_base, commission_bp, charges_borne_by, note, created_by
        ) VALUES (
          gen_random_uuid(), 1, 'draft', '2026-01-01', 'manual', 0,
          'gross_minus_vat', 4200, 'business',
          'Initial system rate profile v1 (seeded via M0 bootstrap; effective 2026-01-01)',
          $1
        ) RETURNING id;
      `, [ownerUserId]);
      profileId = insertProfile.rows[0].id;
    }

    // -------------------------------------------------------------------------
    // Step 6 [PLAN-DERIVED]: Seed method_rates for Profile v1 & Publish (PRD §7.4 Step 6)
    // -------------------------------------------------------------------------
    if (!alreadyPublished) {
      await client.query(`
        INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
        SELECT $1::uuid, m.id,
          CASE m.code
            WHEN 'bkash' THEN 115
            WHEN 'visa' THEN 150
            WHEN 'mastercard' THEN 150
            ELSE 0
          END
        FROM payment_methods m
        ON CONFLICT (rate_profile_id, method_id) DO UPDATE SET charge_bp = EXCLUDED.charge_bp;
      `, [profileId]);

      // Direct update to published under service_role (Bootstrap Exemption CLT-D-002)
      await client.query(`
        UPDATE rate_profiles
        SET status = 'published', published_at = now()
        WHERE id = $1;
      `, [profileId]);

      // Activate payment methods now that Profile v1 is published and covers all 5 methods
      await client.query(`
        UPDATE payment_methods
        SET active = true
        WHERE code IN ('cash', 'bkash', 'visa', 'mastercard', 'bank_transfer');
      `);
    }

    // -------------------------------------------------------------------------
    // Step 7: Initialize app_settings (PRD §7.4 Step 7)
    // -------------------------------------------------------------------------
    await client.query(`
      INSERT INTO app_settings (id, timezone, currency, locale, net_label, reconcile_tolerance_poisha)
      VALUES (true, 'Asia/Dhaka', 'BDT', 'en-BD', 'Net after deductions', 100)
      ON CONFLICT (id) DO NOTHING;
    `);

    // -------------------------------------------------------------------------
    // Step 8: Initialize Monthly Settlements (PRD §7.4 Step 8)
    // -------------------------------------------------------------------------
    await client.query(`
      SELECT generate_monthly_settlements((now() at time zone 'Asia/Dhaka')::date);
    `);

    // Typed parameter $2::uuid resolves PostgreSQL 42P18 type inference error
    await client.query(`
      INSERT INTO audit_log (actor, action, target_table, target_id, after)
      VALUES ($1::uuid, 'system.bootstrap', 'system', 'bootstrap', jsonb_build_object('status', 'completed', 'profile_id', $2::uuid));
    `, [ownerUserId, profileId]);

    await client.query('COMMIT');

    // Explicit success announcement for runner CLI and Plan 008 precondition verification
    process.stdout.write('Bootstrap completed successfully.\n');

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Direct CLI invocation
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  bootstrap().catch((err) => {
    process.stderr.write(`Bootstrap failed: ${String(err)}\n`);
    process.exit(1);
  });
}
```

### 6.2 `tests/db/bootstrap.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { bootstrap } from '../../scripts/bootstrap';

const { Pool } = pg;

describe('Bootstrap Runbook and Seeding Verification (PRD §7.4, §17 M0)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    // Ensure clean database has executed bootstrap before assertions
    await bootstrap();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('verifies all 18 public tables exist in database', async () => {
    const expectedTables = [
      'app_settings',
      'audit_log',
      'devices',
      'entries',
      'entry_reconciliation_exceptions',
      'method_rates',
      'month_close_events',
      'month_closes',
      'payables',
      'payment_methods',
      'profiles',
      'rate_profiles',
      'settlement_payments',
      'settlements',
      'statement_lines',
      'statement_payables',
      'statements',
      'sync_ops',
    ].sort();

    const res = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tables = res.rows.map((r) => r.table_name).sort();
    expect(tables).toEqual(expectedTables);
  });

  it('verifies primary owner account exists in profiles with role owner', async () => {
    const res = await pool.query("SELECT role, active FROM profiles WHERE role = 'owner'");
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].role).toBe('owner');
    expect(res.rows[0].active).toBe(true);
  });

  it('verifies 5 canonical payment methods seeded and active', async () => {
    const res = await pool.query('SELECT code, active FROM payment_methods ORDER BY sort_order');
    expect(res.rows.length).toBe(5);
    const codes = res.rows.map((r) => r.code);
    expect(codes).toEqual(['cash', 'bkash', 'visa', 'mastercard', 'bank_transfer']);
    expect(res.rows.every((r) => r.active === true)).toBe(true);
  });

  it('verifies 4 canonical payables seeded', async () => {
    const res = await pool.query('SELECT code, kind FROM payables ORDER BY code');
    expect(res.rows.length).toBe(4);
    const codes = res.rows.map((r) => r.code);
    expect(codes).toEqual([
      'bkash_charge_payable',
      'mastercard_charge_payable',
      'vat_payable',
      'visa_charge_payable',
    ]);
  });

  it('verifies Rate Profile v1 is published and backdated to 2026-01-01', async () => {
    const res = await pool.query(`
      SELECT version, status, effective_from::text as eff, vat_mode, commission_bp
      FROM rate_profiles WHERE version = 1 AND status = 'published'
    `);
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].status).toBe('published');
    expect(res.rows[0].eff).toBe('2026-01-01');
    expect(res.rows[0].vat_mode).toBe('manual');
    expect(res.rows[0].commission_bp).toBe(4200);
  });

  it('verifies method rates for Profile v1 match operational defaults across all 5 methods', async () => {
    const res = await pool.query(`
      SELECT m.code, mr.charge_bp
      FROM method_rates mr
      JOIN payment_methods m ON m.id = mr.method_id
      JOIN rate_profiles rp ON rp.id = mr.rate_profile_id
      WHERE rp.version = 1 AND rp.status = 'published'
      ORDER BY m.code
    `);
    expect(res.rows.length).toBe(5);
    const rateMap = Object.fromEntries(res.rows.map((r) => [r.code, r.charge_bp]));
    expect(rateMap.bkash).toBe(115);
    expect(rateMap.visa).toBe(150);
    expect(rateMap.mastercard).toBe(150);
    expect(rateMap.cash).toBe(0);
    expect(rateMap.bank_transfer).toBe(0);
  });

  it('verifies singleton app_settings row initialized', async () => {
    const res = await pool.query('SELECT timezone, currency, locale, reconcile_tolerance_poisha FROM app_settings');
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].timezone).toBe('Asia/Dhaka');
    expect(res.rows[0].currency).toBe('BDT');
    expect(res.rows[0].locale).toBe('en-BD');
    expect(res.rows[0].reconcile_tolerance_poisha).toBe('100');
  });

  it('verifies initial monthly settlement rows generated for current month', async () => {
    const res = await pool.query(`
      SELECT count(*) as count
      FROM settlements
      WHERE month = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)::date
    `);
    expect(parseInt(res.rows[0].count, 10)).toBe(4);

    const states = await pool.query(`
      SELECT s.status, s.expected_poisha, s.paid_poisha, p.code as payable_code
      FROM settlements s
      JOIN payables p ON p.id = s.payable_id
      WHERE s.month = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)::date
      ORDER BY p.code
    `);
    expect(states.rows.length).toBe(4);
    for (const row of states.rows) {
      expect(['not_applicable', 'due', 'partly_paid', 'paid', 'overpaid']).toContain(row.status);
      expect(BigInt(row.expected_poisha)).toBeGreaterThanOrEqual(0n);
      expect(BigInt(row.paid_poisha)).toBeGreaterThanOrEqual(0n);
    }
  });

  it('verifies system.bootstrap event recorded in audit_log', async () => {
    const res = await pool.query(
      "SELECT action, target_table, target_id, after FROM audit_log WHERE action = 'system.bootstrap'"
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[0].action).toBe('system.bootstrap');
    expect(res.rows[0].target_table).toBe('system');
    expect(res.rows[0].target_id).toBe('bootstrap');
    expect(res.rows[0].after.status).toBe('completed');
  });

  it('verifies bootstrap script executes idempotently twice without error', async () => {
    // Assert that executing bootstrap twice in succession completes without throwing
    await expect(bootstrap()).resolves.not.toThrow();
    await expect(bootstrap()).resolves.not.toThrow();

    // Verify invariants remain intact
    const ownerRes = await pool.query("SELECT count(*) as count FROM profiles WHERE role = 'owner'");
    expect(parseInt(ownerRes.rows[0].count, 10)).toBe(1);

    const methodsRes = await pool.query("SELECT count(*) as count FROM payment_methods WHERE active = true");
    expect(parseInt(methodsRes.rows[0].count, 10)).toBe(5);

    const profilesRes = await pool.query("SELECT count(*) as count FROM rate_profiles WHERE version = 1 AND status = 'published'");
    expect(parseInt(profilesRes.rows[0].count, 10)).toBe(1);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| 18 Public Tables Exist | Query `information_schema.tables` for public base tables | All 18 table names exist and match canonical schema | §7, §7.4 | `tests/db/bootstrap.test.ts` |
| Owner Profile Exists | `SELECT role, active FROM profiles WHERE role = 'owner'` | 1 row, `role = 'owner'`, `active = true` | §7.4 Step 2 | `tests/db/bootstrap.test.ts` |
| Payment Methods Seeded | `SELECT code, active FROM payment_methods ORDER BY sort_order` | 5 rows: cash, bkash, visa, mastercard, bank_transfer (all active = true) | §7.4 Step 3 | `tests/db/bootstrap.test.ts` |
| Payables Seeded | `SELECT code FROM payables` | 4 rows: vat_payable, bkash, visa, mastercard | §7.4 Step 4 | `tests/db/bootstrap.test.ts` |
| Profile v1 Backdated | `SELECT effective_from, version FROM rate_profiles WHERE version = 1 AND status = 'published'` | `effective_from = '2026-01-01'`, `version = 1`, `status = 'published'`, `commission_bp = 4200` | §7.4 Step 5 | `tests/db/bootstrap.test.ts` |
| Method Rates Seeded | Query `method_rates` for Profile v1 | 5 rows: bKash: 115, Visa: 150, Mastercard: 150, Cash: 0, Bank Transfer: 0 | §7.4 Step 6 | `tests/db/bootstrap.test.ts` |
| App Settings Seeded | `SELECT timezone, currency, locale FROM app_settings` | `Asia/Dhaka`, `BDT`, `en-BD` | §7.4 Step 7 | `tests/db/bootstrap.test.ts` |
| Settlements Initialized | `SELECT count(*) FROM settlements WHERE month = date_trunc('month', (now() at time zone 'Asia/Dhaka')::date)::date` | 4 rows with valid settlement statuses and non-negative amounts | §7.4 Step 8 | `tests/db/bootstrap.test.ts` |
| System Bootstrap Audit Event | `SELECT action, target_table, target_id FROM audit_log WHERE action = 'system.bootstrap'` | 1 row, target_table = 'system', target_id = 'bootstrap', status = 'completed' | §15.1 | `tests/db/bootstrap.test.ts` |
| Bootstrap Idempotency | Execute `bootstrap()` twice consecutively | Both executions resolve without error, maintaining unique owner, 5 methods, and 1 published profile v1 | §17 M0 | `tests/db/bootstrap.test.ts` |

## 8. Acceptance Criteria

| Criterion | Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|---|
| Clean Bootstrap Run | `pnpm db:bootstrap` exits 0 | `pnpm db:bootstrap` | exits with code 0 and logs `Bootstrap completed successfully.` |
| Repeated Bootstrap Run | Idempotent second run | `pnpm db:bootstrap` | exits with code 0 and logs `Bootstrap completed successfully.` |
| 18 Tables Verified | Query information schema | `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts -t "verifies all 18 public tables exist"` | exits with code 0, 1 passed |
| Owner Profile Verified | Query profiles table | `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts -t "verifies primary owner account exists"` | exits with code 0, 1 passed |
| Rate Profile v1 Verified | Query published rate profile v1 | `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts -t "verifies Rate Profile v1 is published"` | exits with code 0, 1 passed |
| Initial Settlements Created | 4 settlement rows for current month | `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts -t "verifies initial monthly settlement rows"` | exits with code 0, 1 passed |
| Bootstrap Test Suite Passes | Vitest assertions pass | `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts` | exits with code 0, 10 passed |

## 9. Hard Rules Touched

- Rule 1: Never hardcode rates; operational rates are seeded exclusively as database records in `rate_profiles`.
- Rule 2: Integer poisha throughout; settlement records and tolerance values calculate in `bigint`.
- Rule 5: Every state change writes `audit_log`; bootstrap script appends `system.bootstrap` audit event with typed `$2::uuid` parameter.
- Rule 7: Bootstrap operates under direct database connection via `DATABASE_URL` (`pg.Pool`) inside an isolated transaction with dedicated advisory lock `pg_advisory_xact_lock(1004, 1)` [PLAN-DERIVED: bootstrap mutual exclusion], and invokes Supabase Auth Admin API with `SUPABASE_SERVICE_ROLE_KEY`.
- Rule 8: No secrets committed; script reads credentials from `.env.local` or process environment.
- Rule 12: Build order follows PRD §17; completes M0 Definition of Done on clean database.
- Rule 14: Does not edit PRD; adopts established bootstrap-seed exemption recorded in root `DECISIONS.md` CLT-D-002.
- Rule 17: No invented commands or data; matches PRD §7.4 values verbatim with explicit `[PLAN-DERIVED]` annotations for execution order.
- Rule 18: No destructive commands on live database; idempotency guard prevents resetting roles, methods, or due dates on re-runs.
- Rule 20: Preconditions for production; baseline rates explicitly acknowledged as operational defaults pending Q1–Q4 owner sign-off.

## 10. Pitfalls

1. Day-one backdating trap: Publishing Rate Profile v1 with `publish_rate_profile()`.
   - Symptom: Procedure raises `publish_backdating_rejected` because `effective_from = '2026-01-01'` is in the past.
   - Fix: Seed Profile v1 directly with `status = 'published'` via the bootstrap script under `service_role` as permitted by PRD §7.4 Step 5 and CLT-D-002.
2. Published method rates insertion lock: Seeding Profile v1 with `status = 'published'` before inserting `method_rates`.
   - Symptom: Trigger `trg_method_rates_draft_publish_lock` raises exception `403 method_rates_published_profile_immutable`.
   - Fix: Seed Profile v1 initially with `status = 'draft'`, insert `method_rates` for the draft profile, then update Profile v1 to `status = 'published'` (PRD ISSUE 006-1).
3. Duplicate user auth collisions: Re-running bootstrap against a previously provisioned Supabase Auth instance.
   - Symptom: `createUser` throws `email_exists`.
   - Fix: Paginate `listUsers({ perPage: 100 })` across all pages first; if user exists, reuse existing auth UUID as specified in block 6.1 Step 1.
4. Missing service role key: Running bootstrap without `SUPABASE_SERVICE_ROLE_KEY`.
   - Symptom: GoTrue Supabase Auth Admin API calls (`createUser`, `updateUserById`, `listUsers`) fail with 401 Unauthorized.
   - Fix: Ensure `SUPABASE_SERVICE_ROLE_KEY` is exported in environment before running `pnpm db:bootstrap`. (Note: PostgreSQL table writes connect directly via `pg.Pool` with `DATABASE_URL`).
5. Chicken-and-egg trigger crash on payment methods activation (`trg_payment_methods_active_rate_check`):
   - Symptom: Inserting `payment_methods` with `active = true` before Profile v1 is published raises `422 no_published_rate_profile`.
   - Fix: Seed `payment_methods` in Step 3 with `active = false`, and activate them (`SET active = true`) in Step 6 only after Profile v1 is published and covered in `method_rates`.
6. Destructive re-runs against live databases:
   - Symptom: Re-running bootstrap resets demoted owners back to `owner`, re-activates deactivated payment methods, and resets customized payable due dates.
   - Fix: Non-destructive idempotency guard in `scripts/bootstrap.ts` detects existing `system.bootstrap` audit log and published Profile v1, verifies baseline integrity, logs completion, and returns without mutating live configurations.
7. Variadic `jsonb_build_object` type inference failure (PostgreSQL 42P18):
   - Symptom: `could not determine data type of parameter $2` raised when inserting audit row.
   - Fix: Explicitly cast `$2` to UUID (`$2::uuid`) in SQL query.
8. Concurrent test execution collisions:
   - Symptom: Vitest parallel workers run `bootstrap.test.ts` concurrently with `entries_sync.test.ts` and `settlement_recon.test.ts`, causing unique constraint collisions and settlement recalculation drift.
   - Fix: Execute integration database test suites sequentially using `--no-file-parallelism`.

## 11. PRD ISSUES and DECISION PENDING

- Dedicated bootstrap advisory lock `pg_advisory_xact_lock(1004, 1)` `[PLAN-DERIVED]`: PRD §7.2 specifies advisory lock classes 1001 (Month), 1002 (Sequence), and 1003 (Rate Profile Version). Bootstrap introduces class 1004 (`(1004, 1)`) to serialize concurrent bootstrap executions without colliding with operational financial locks.
- PRD ISSUE 006-1 `[PLAN-DERIVED]`: PRD §7.4 Step 5 seeds Profile v1 with `status = 'published'` before Step 6 inserts `method_rates`. However, trigger `trg_method_rates_draft_publish_lock` (PRD §7.1 and Plan 004) enforces that published method rates are immutable, raising exception `403 method_rates_published_profile_immutable` upon any insert where `rate_profiles.status = 'published'`. Bootstrap resolves this ordering conflict by inserting Profile v1 with `status = 'draft'`, inserting `method_rates` in Step 6, and then immediately updating Profile v1 to `status = 'published'` with `published_at = now()`.
- Trigger `trg_payment_methods_active_rate_check` ordering `[PLAN-DERIVED]`: The active method rate guard enforces that `active = true` cannot be set without a published rate profile covering that method in `method_rates`. Bootstrap resolves this by seeding payment methods with `active = false` in Step 3 (satisfying foreign keys for payables in Step 4), and activating them in Step 6 immediately after Rate Profile v1 is published.
- Non-destructive idempotency guard `[PLAN-DERIVED]`: Re-running bootstrap checks for existing published Profile v1 and `system.bootstrap` audit row. If present, it skips mutating profiles, methods, and payables, preserving live operational changes while fulfilling idempotency requirements.
- Baseline rate profile operational defaults (42% commission, 115 bp bKash fee, 150 bp card fee, manual VAT) and backdated profile v1 (`effective_from = '2026-01-01'`) are formally accepted in root `DECISIONS.md` CLT-D-002 per PRD §7.4 Step 5 and AGENTS.md Rule 20.

## 12. Handoff

Once this plan is Implemented, subsequent plans rely on:
- Active database populated with all 18 public tables, initial Owner account, canonical methods (`cash`, `bkash`, `visa`, `mastercard`, `bank_transfer`), payables, Rate Profile v1, and settings.
- Command: `pnpm db:bootstrap` to initialize clean databases.
- Verification command: `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts`.

## 13. Suggested Task Breakdown

- **CLT-T-022** (Implementer): Author database initialization runner script `scripts/bootstrap.ts` executing Steps 1 through 8 of PRD §7.4 under `service_role` credentials with advisory lock `(1004, 1)`, typed audit insert `$2::uuid`, and non-destructive idempotency guard.
- **CLT-T-023** (Implementer): Author integration test suite `tests/db/bootstrap.test.ts` verifying all 18 public tables, clean bootstrap execution, profile, methods, payables, rate profile v1, method rates, settings, settlements, and idempotency.
- **CLT-T-024** (Tester): Execute `pnpm db:reset && pnpm db:bootstrap` and `pnpm vitest run --no-file-parallelism tests/db/bootstrap.test.ts` on clean database instances to verify 100% test pass.

## Changelog

- 2026-11-01 — Revision 2.3:
  - 1. **Fixed Direct CLI Invocation**: Replaced fragile template comparison with `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`, preventing silent no-op exits on relative paths and paths with spaces.
  - 2. **Pre-Transaction Auth Phase**: Moved Supabase Auth API user lookup and creation prior to `client.query('BEGIN')`, eliminating external HTTP latency inside open database transactions.
  - 3. **Eliminated Demoted Owner Auth Overwrite**: Added check for existing active owner in `profiles` to prevent overwriting demoted owners or creating split-brain owner permissions.
  - 4. **Handled `updateUserById` Errors**: Added explicit check asserting `{ error: updateError }` on `updateUserById`.
  - 5. **Gated Payment Method Re-Activation**: Moved payment method activation inside `if (!alreadyPublished)` block to prevent overwriting admin deactivations on re-runs.
  - 6. **Comprehensive Baseline Idempotency Guard**: Added count assertions for active owner, payables (>=4), and methods (>=5) before certifying baseline verified.
  - 7. **Production Environment Safety**: Enforced `BOOTSTRAP_OWNER_EMAIL` as strictly mandatory in production environments.
  - 8. **Self-Contained Test Suite**: Added `await bootstrap();` in `tests/db/bootstrap.test.ts` `beforeAll` so test suite executes cleanly on fresh database instances.
  - 9. **Added Audit Log Assertion**: Added explicit test in `bootstrap.test.ts` asserting `system.bootstrap` event in `audit_log`.
  - 10. **Shielded Rollback**: Wrapped transaction rollback in try/catch to prevent masking root execution errors.
  - 11. **Documented Plan-Derived Lock 1004 & Corrected Pitfall 4**: Formally annotated `(1004, 1)` advisory lock and corrected Pitfall 4 regarding direct `pg.Pool` connection.
- 2026-10-30 — Revision 2.2:
  - Resolved Blocker 1: Fixed PostgreSQL 42P18 type inference failure in final audit insert by explicitly casting `$2` to UUID (`$2::uuid`) in `scripts/bootstrap.ts`.
  - Resolved Blocker 2: Fixed broken bash command syntax in Section 8 Acceptance Criteria by replacing broken single-quoted inline node commands with `--no-file-parallelism` Vitest filter commands.
  - Resolved Blocker 3: Implemented non-destructive idempotency guard in `scripts/bootstrap.ts` checking for existing `system.bootstrap` audit log and published Profile v1, preventing destructive overwrites of demoted owners, deactivated payment methods, or custom payable due days on live database re-runs.
  - Resolved Blocker 4: Enforced canonical baseline parameters (`effective_from = '2026-01-01'`, `vat_mode = 'manual'`, `commission_bp = 4200`) on existing draft Profile v1 rows before publishing, preventing stray test drafts from bypassing Hard Rule 1 and Rule 20.
  - Resolved Blocker 5: Configured `--no-file-parallelism` for database integration test execution to prevent concurrency collisions with Plan 004/005 test suites. Updated settlement assertion to accept non-negative dynamic liabilities in shared environments.
  - Resolved Real Defect 1: Replaced unpaginated `listUsers()` with a paginated while loop (`perPage: 100`) in `scripts/bootstrap.ts`, preventing `email_exists` errors on large user directories.
  - Resolved Real Defect 2: Wrapped bootstrap execution in an isolated database transaction (`BEGIN ... COMMIT`) protected by dedicated advisory lock `pg_advisory_xact_lock(1004, 1)`.
  - Resolved Real Defect 3: Added `dotenv` loading at the top of `scripts/bootstrap.ts` for `.env.local` and `.env`.
  - Resolved Real Defect 4: Implemented explicit programmatically executed idempotency test calling `bootstrap()` twice in `tests/db/bootstrap.test.ts`.
  - Resolved Real Defect 5: Added test assertion verifying all 18 canonical public tables exist in database per PRD §7.4 verification requirements.
  - Resolved Real Defect 6: Reconciled test assertion count in Step 7 and Section 7 to 9 tests.
  - Resolved Real Defect 7: Aligned trigger and error names in Pitfall 2 and PRD ISSUE 006-1 to exact Plan 004 definitions (`trg_method_rates_draft_publish_lock` and `403 method_rates_published_profile_immutable`).
  - Resolved Real Defect 8: Formally annotated all execution order deviations in Steps 3–6 and idempotency guards as `[PLAN-DERIVED]`.
  - Resolved Housekeeping: Standardized task roles in Section 13 strictly to roster roles (`Implementer` and `Tester`).
- 2026-10-30 — Revision 2.1: Standardized task IDs to sequential identifiers `CLT-T-022`, `CLT-T-023`, `CLT-T-024`.
- 2026-10-30 — Revision 2.0: Resolved chicken-and-egg trigger crash with `trg_payment_methods_active_rate_check`, added stdout success log, and added `@supabase/supabase-js`.
- 2026-10-29 — Revision 1.0: Initial specification of Plan 006 for M0 database bootstrap runbook and canonical seeding.
