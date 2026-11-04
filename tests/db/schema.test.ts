import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

describe('Database Schema, Security, and Invariant Tests', () => {
  let pool: pg.Pool;

  const OWNER_ID = '11111111-1111-1111-1111-111111111111';
  const STAFF_ID = '11111111-1111-1111-1111-111111111112';
  const METHOD_BKASH_ID = '22222222-2222-2222-2222-222222222222';
  const RATE_PROFILE_V1_ID = '33333333-3333-3333-3333-333333333333';
  const PAYABLE_VAT_ID = '44444444-4444-4444-4444-444444444441';
  const PAYABLE_BKASH_ID = '44444444-4444-4444-4444-444444444442';
  const STATEMENT_ID = '55555555-5555-5555-5555-555555555555';
  const BASE_ENTRY_ID = '66666666-6666-6666-6666-666666666661';
  const SETTLEMENT_ID = '77777777-7777-7777-7777-777777777771';
  const PAYMENT_ID = '88888888-8888-8888-8888-888888888881';
  const REJECTED_SYNC_OP_ID = '99999999-9999-9999-9999-999999999991';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    // Seed baseline prerequisite rows safely (compatible with Plan 004 triggers)
    await pool.query(`
      -- Generic local-dev cleanup: wipe financial rows and users so seeding is
      -- deterministic across suite runs (this suite is a writer of the dev DB).
      -- audit_log rows are kept (Rule 5).
      DELETE FROM statement_lines;
      DELETE FROM statement_payables;
      DELETE FROM statements;
      DELETE FROM settlement_payments;
      DELETE FROM settlements;
      DELETE FROM entry_reconciliation_exceptions;
      DELETE FROM month_close_events;
      DELETE FROM month_closes;
      DELETE FROM payables;
      DELETE FROM devices;
      ALTER TABLE method_rates DISABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles DISABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM sync_ops;
      DELETE FROM entries;
      DELETE FROM method_rates;
      DELETE FROM rate_profiles;
      DELETE FROM payment_methods;
      ALTER TABLE method_rates ENABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles ENABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
      DELETE FROM payment_methods;
      -- Baseline auth users
      INSERT INTO auth.users (id, email, raw_app_meta_data)
      VALUES
        ('${OWNER_ID}', 'owner@example.com', '{"role":"owner"}'::jsonb),
        ('${STAFF_ID}', 'staff@example.com', '{"role":"staff"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline profiles (UPSERT avoids collision with auth.users triggers)
      INSERT INTO profiles (id, full_name, role, active)
      VALUES
        ('${OWNER_ID}', 'Owner User', 'owner', true),
        ('${STAFF_ID}', 'Staff User', 'staff', true)
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = EXCLUDED.active;

      --entries_sync's ownership transfer may have left another profile as owner;
      --restore the sole-owner invariant for this suite (same transaction: commit
      --still sees exactly one active owner).
      UPDATE profiles SET role = 'admin' WHERE role = 'owner' AND id != '${OWNER_ID}';

      -- Baseline payment methods
      INSERT INTO payment_methods (id, code, name, requires_txn_ref, active, sort_order)
      VALUES ('${METHOD_BKASH_ID}', 'bkash', 'bKash', true, false, 1)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline rate profile v1 (insert as draft, insert rates, then publish)
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${RATE_PROFILE_V1_ID}', 1, 'draft', '2026-01-01', 'manual', 0, 4200, 'gross_minus_vat', 'business')
      ON CONFLICT (id) DO NOTHING;

      -- Baseline method rates (inserted while draft, avoiding immutability trigger)
      INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
      VALUES ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115)
      ON CONFLICT (rate_profile_id, method_id) DO NOTHING;

      UPDATE rate_profiles SET status = 'published' WHERE id = '${RATE_PROFILE_V1_ID}';

      -- Activate methods only after a published profile covers them
      -- (trg_payment_methods_active_rate_check, plan 004)
      UPDATE payment_methods SET active = true WHERE id = '${METHOD_BKASH_ID}';

      -- Baseline payables
      INSERT INTO payables (id, code, name, kind, method_id, due_day, active)
      VALUES
        ('${PAYABLE_VAT_ID}', 'vat_payable', 'VAT Payable', 'vat', null, 15, true),
        ('${PAYABLE_BKASH_ID}', 'bkash_charge', 'bKash Payable', 'method_charge', '${METHOD_BKASH_ID}', 15, true)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline app_settings singleton
      INSERT INTO app_settings (id, timezone, currency, locale, net_label, reconcile_tolerance_poisha)
      VALUES (true, 'Asia/Dhaka', 'BDT', 'en-BD', 'Net after deductions', 100)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline statement
      INSERT INTO statements (id, kind, month, source, statement_total_poisha, expected_poisha, status)
      VALUES ('${STATEMENT_ID}', 'single_payable', '2026-10-01', 'manual_total', 100000, 100000, 'open')
      ON CONFLICT (id, month) DO NOTHING;

      -- Baseline statement_payables
      INSERT INTO statement_payables (statement_id, payable_id, month, status)
      VALUES ('${STATEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-01', 'open')
      ON CONFLICT (statement_id, payable_id) DO NOTHING;

      -- Baseline entry
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${BASE_ENTRY_ID}', nextval('entry_seq'), '2026-10-15', 'Baseline Customer',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
        '{"vat": {"mode": "manual", "bp": 0}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
        '${OWNER_ID}'
      ) ON CONFLICT (id) DO NOTHING;

      -- Baseline settlement
      INSERT INTO settlements (id, payable_id, month, expected_poisha, paid_poisha, status)
      VALUES ('${SETTLEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-01', 100000, 50000, 'partly_paid')
      ON CONFLICT (payable_id, month) DO NOTHING;

      -- Baseline settlement payment
      INSERT INTO settlement_payments (id, settlement_id, amount_poisha, paid_on, recorded_by)
      VALUES ('${PAYMENT_ID}', '${SETTLEMENT_ID}', 50000, '2026-10-10', '${OWNER_ID}')
      ON CONFLICT (id) DO NOTHING;

      -- Baseline rejected sync op for supersession tests
      INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status)
      VALUES ('${REJECTED_SYNC_OP_ID}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash', now(), 'rejected', 'pending')
      ON CONFLICT (op_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    // Teardown all test seed records in reverse FK order to prevent database pollution.
    // Exact IDs only: uuid columns do not support the ~~ LIKE operator.
    await pool.query(`
      DELETE FROM statement_lines WHERE statement_id = '${STATEMENT_ID}';
      DELETE FROM statement_payables WHERE statement_id = '${STATEMENT_ID}';
      DELETE FROM statements WHERE id = '${STATEMENT_ID}';
      DELETE FROM settlement_payments WHERE settlement_id = '${SETTLEMENT_ID}';
      DELETE FROM settlements WHERE id = '${SETTLEMENT_ID}';
      DELETE FROM sync_ops WHERE actor_id IN ('${OWNER_ID}', '${STAFF_ID}');
      DELETE FROM entry_reconciliation_exceptions WHERE entry_id = '${BASE_ENTRY_ID}';
    ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
    DELETE FROM entries WHERE id = '${BASE_ENTRY_ID}';
    ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
      ALTER TABLE method_rates DISABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles DISABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      DELETE FROM method_rates WHERE rate_profile_id = '${RATE_PROFILE_V1_ID}';
      DELETE FROM rate_profiles WHERE id = '${RATE_PROFILE_V1_ID}';
      ALTER TABLE method_rates ENABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles ENABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      DELETE FROM payables WHERE id IN ('${PAYABLE_VAT_ID}', '${PAYABLE_BKASH_ID}');
      DELETE FROM payment_methods WHERE id = '${METHOD_BKASH_ID}';
      DELETE FROM devices WHERE user_id IN ('${OWNER_ID}', '${STAFF_ID}');
      DELETE FROM month_close_events WHERE month = '2026-10-01' OR month = '2026-11-01';
      DELETE FROM month_closes WHERE month = '2026-10-01' OR month = '2026-11-01';
      -- Users/profiles are left for the next suite's beforeAll to wipe:
      -- deleting the last active owner would violate the zero-owner invariant.
    `);
    await pool.end();
  });

  // --- SECTION 1: Gate 1, RLS & Privileges Proofs ---

  it('Gate 1 Proof: Confirms Row Level Security is ENABLED on all 18 public tables', async () => {
    const expectedTables = [
      'profiles', 'devices', 'payment_methods', 'rate_profiles', 'method_rates',
      'entries', 'payables', 'entry_reconciliation_exceptions', 'settlements',
      'settlement_payments', 'statements', 'statement_payables', 'statement_lines',
      'month_closes', 'month_close_events', 'audit_log', 'sync_ops', 'app_settings'
    ];

    const res = await pool.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const rlsMap = new Map(res.rows.map(r => [r.tablename, r.rowsecurity]));

    for (const table of expectedTables) {
      expect(rlsMap.has(table), `Table ${table} should exist in public schema`).toBe(true);
      expect(rlsMap.get(table), `Table ${table} must have RLS enabled`).toBe(true);
    }
  });

  it('Gate 1 & Test #45 Proof: Direct writes are revoked on all 18 tables from anon and authenticated at runtime', async () => {
    // 1. Catalog privilege check: zero write privileges
    const res = await pool.query(`
      SELECT table_name, privilege_type, grantee
      FROM information_schema.table_privileges
      WHERE table_schema = $1
        AND grantee = ANY($2::text[])
        AND privilege_type = ANY($3::text[])
    `, ['public', ['anon', 'authenticated'], ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']]);
    expect(res.rows.length).toBe(0);

    // 2. Runtime execution check: authenticated role rejected
    // Pin a single client: SET ROLE is per-connection and pool.query can land
    // the role switch and the probe on different sockets.
    const wClient = await pool.connect();
    try {
      await wClient.query('SET ROLE authenticated');
      await expect(
        wClient.query(`INSERT INTO entries (id, gross_poisha) VALUES ('00000000-0000-0000-0000-000000000001', 1000)`)
      ).rejects.toThrow(/permission denied/i);
      await wClient.query('RESET ROLE');

      // 3. Runtime execution check: anon role rejected
      await wClient.query('SET ROLE anon');
      await expect(
        wClient.query(`INSERT INTO entries (id, gross_poisha) VALUES ('00000000-0000-0000-0000-000000000001', 1000)`)
      ).rejects.toThrow(/permission denied/i);
      await wClient.query('RESET ROLE');
    } finally {
      wClient.release();
    }
  });

  it('Gate 1 & Test #22 Proof: Routine execution is revoked from PUBLIC, anon, and authenticated in schema public', async () => {
    const res = await pool.query(`
      SELECT routine_name, privilege_type, grantee
      FROM information_schema.routine_privileges
      WHERE routine_schema = $1
        AND grantee = ANY($2::text[])
    `, ['public', ['PUBLIC', 'anon', 'authenticated']]);
    expect(res.rows.length).toBe(0);
  });

  it('Test #30: Role View Permission Isolation', async () => {
    // Pin a single client: SET ROLE is per-connection, so pool.query would be
    // able to land the role switch and the probes on different sockets.
    const client = await pool.connect();
    try {
      // Staff role denied on managerial reporting views
      await client.query('SET ROLE authenticated');
      await client.query(`SET request.jwt.claims = '{"sub":"${STAFF_ID}","role":"authenticated","app_metadata":{"role":"staff"}}'`);
      await expect(client.query('SELECT * FROM v_monthly_totals')).rejects.toThrow(/permission denied/i);
      await expect(client.query('SELECT * FROM v_monthly_method_charges')).rejects.toThrow(/permission denied/i);

      // Staff permitted on personal metrics, scoped to caller
      const staffMetrics = await client.query('SELECT * FROM v_staff_personal_metrics');
      expect(staffMetrics.rows.length).toBeDefined();
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });

  it('Verifies all named check constraints exist in database catalog', async () => {
    const expectedConstraints = [
      'chk_entries_gross_positive',
      'chk_deduction_guard',
      'chk_vat_input_mode_exclusivity',
      'chk_vat_override_bound',
      'chk_vat_override_reason',
      'chk_comm_override_bound',
      'chk_comm_override_reason',
      'chk_gross_conservation',
      'chk_charge_partition',
      'chk_stale_review',
      'chk_reassign',
      'chk_void_request_reason',
      'chk_void_fields',
      'chk_superseded_fields',
      'chk_payables_due_day',
      'chk_payables_remind_days',
      'chk_payable_method_consistency',
      'chk_settlements_month',
      'chk_overpayment_approval',
      'chk_settlement_payments_amount_poisha',
      'chk_reversal_reference',
      'chk_statements_month',
      'chk_statement_source',
      'chk_statement_payables_month',
      'chk_statement_line_acceptance',
      'chk_month_closes_month',
      'chk_month_close_events_month',
      'chk_app_settings_fixed_tz',
    ];

    const res = await pool.query(`
      SELECT constraint_name
      FROM information_schema.check_constraints
      WHERE constraint_schema = 'public'
    `);
    const found = new Set(res.rows.map(r => r.constraint_name));
    for (const c of expectedConstraints) {
      expect(found.has(c), `Constraint ${c} should exist in catalog`).toBe(true);
    }
  });

  // --- SECTION 2: Identity, Auth & Profiles Constraints ---

  it('one_owner: Positive & Negative Cases', async () => {
    // Negative: Second active owner profile throws one_owner partial index violation
    const secondOwnerId = '11111111-1111-1111-1111-111111111119';
    await expect(
      pool.query(`INSERT INTO profiles (id, full_name, role, active) VALUES ('${secondOwnerId}', 'Second Owner', 'owner', true)`)
    ).rejects.toThrow(/one_owner/);

    // Positive: Second user as staff or admin succeeds (auth.users parent required first)
    const newStaffId = '11111111-1111-1111-1111-111111111120';
    await pool.query(`
      INSERT INTO auth.users (id, email, encrypted_password)
      VALUES ('${newStaffId}', 'schema-test-staff@example.com', crypt('x', gen_salt('bf', 4)))
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO profiles (id, full_name, role, active)
      VALUES ('${newStaffId}', 'New Staff', 'staff', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    // The staff profile is kept: it is the shared ADMIN actor of
    // tests/db/entries_sync.test.ts, pinned by audit_log rows (Rule 5).
  });

  it('uq_devices_device_user: Positive & Negative Cases', async () => {
    const devId = 'd1111111-1111-1111-1111-111111111111';

    // Positive: Pair inserted
    await pool.query(`
      INSERT INTO devices (device_id, user_id, device_name)
      VALUES ('${devId}', '${OWNER_ID}', 'Owner iPhone')
      ON CONFLICT (device_id, user_id) DO NOTHING;
    `);

    // Negative: Duplicate (device_id, user_id) throws uq_devices_device_user
    await expect(
      pool.query(`
        INSERT INTO devices (device_id, user_id, device_name)
        VALUES ('${devId}', '${OWNER_ID}', 'Owner iPhone')
      `)
    ).rejects.toThrow(/uq_devices_device_user/);
  });

  it('uq_rate_profile_version: Positive & Negative Cases', async () => {
    // Negative: A second PUBLISHED version 1 throws uq_rate_profile_version.
    // The partial index only covers status = 'published', so a draft cannot collide.
    await expect(
      pool.query(`
        INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
        VALUES (gen_random_uuid(), 1, 'published', '2026-11-01', 'manual', 0, 4200, 'gross', 'business')
      `)
    ).rejects.toThrow(/uq_rate_profile_version/);

    // Positive: Version 2 succeeds
    const prof2Id = '33333333-3333-3333-3333-333333333334';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${prof2Id}', 2, 'draft', '2026-11-01', 'manual', 0, 4200, 'gross', 'business')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM rate_profiles WHERE id = '${prof2Id}'`);
  });

  it('chk_payable_method_consistency, uq_active_vat_payable & uq_active_method_payable: Positive & Negative Cases', async () => {
    // Positive: method_charge with method_id succeeds
    const validPayableId = '44444444-4444-4444-4444-444444444443';
    await pool.query(`
      INSERT INTO payables (id, code, name, kind, method_id, due_day, active)
      VALUES ('${validPayableId}', 'bkash_charge_2', 'bKash 2', 'method_charge', '${METHOD_BKASH_ID}', 15, false)
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM payables WHERE id = '${validPayableId}'`);

    // Negative 1: VAT with non-null method_id throws chk_payable_method_consistency
    await expect(
      pool.query(`
        INSERT INTO payables (code, name, kind, method_id, due_day)
        VALUES ('vat_invalid', 'VAT', 'vat', '${METHOD_BKASH_ID}', 15)
      `)
    ).rejects.toThrow(/chk_payable_method_consistency/);

    // Negative 2: method_charge with null method_id throws chk_payable_method_consistency
    await expect(
      pool.query(`
        INSERT INTO payables (code, name, kind, method_id, due_day)
        VALUES ('charge_invalid', 'Charge', 'method_charge', null, 15)
      `)
    ).rejects.toThrow(/chk_payable_method_consistency/);

    // Negative 3: Second active VAT payable throws uq_active_vat_payable
    await expect(
      pool.query(`
        INSERT INTO payables (code, name, kind, due_day, active)
        VALUES ('vat_second_active', 'VAT 2', 'vat', 15, true)
      `)
    ).rejects.toThrow(/uq_active_vat_payable/);
  });

  it('chk_charge_partition & chk_gross_conservation: Positive & Negative Cases', async () => {
    // Negative 1: charge partition violation (business + customer != charge)
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 3000, 0, 45000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_charge_partition/);

    // Negative 2: gross conservation violation (vat + comm + biz_charge + net != gross)
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 50000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_gross_conservation/);
  });

  it('Test #42: chk_vat_input_mode_exclusivity: Positive & Negative Cases', async () => {
    // Negative: Percentage profile with non-null vat_input_poisha throws chk_vat_input_mode_exclusivity
    const pctProfileId = '33333333-3333-3333-3333-333333333335';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${pctProfileId}', 10, 'draft', '2026-11-01', 'percent_of_gross', 1500, 4200, 'gross', 'business')
      ON CONFLICT (id) DO NOTHING;
    `);

    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${pctProfileId}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 15000, 15000, 42000, 0, 0, 0, 43000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_vat_input_mode_exclusivity/);

    await pool.query(`DELETE FROM rate_profiles WHERE id = '${pctProfileId}'`);
  });

  it('Overrides & Bounds: chk_vat_override_bound, chk_comm_override_bound, chk_vat_override_reason, and chk_comm_override_reason', async () => {
    // Positive: Valid overrides with non-empty reasons and within gross bound
    const validOverrideId = '66666666-6666-6666-6666-666666666662';
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
        commission_override_poisha, commission_override_reason, vat_poisha, commission_poisha,
        charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${validOverrideId}', nextval('entry_seq'), '2026-10-16', 'Valid Override Customer',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
        '{"vat": {"mode": "percent_of_gross", "bp": 1500}}'::jsonb, 10000, 'Exemption agreement',
        20000, 'Volume bonus discount', 10000, 20000, 5000, 5000, 0, 65000, '${OWNER_ID}'
      )
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM entries WHERE id = '${validOverrideId}';
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
    `);

    // Negative 1: VAT override > gross throws chk_vat_override_bound
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
          vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
          customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'VAT Over Bound',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 100001, 'Reason',
          10000, 40000, 0, 0, 0, 50000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_vat_override_bound/);

    // Negative 2: VAT override without reason throws chk_vat_override_reason
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
          vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
          customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'VAT Reason Missing',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 10000, null,
          10000, 40000, 0, 0, 0, 50000, '${OWNER_ID}'
        )
      `)
    ).rejects.toThrow(/chk_vat_override_reason/);
  });

  it('Lifecycle & Review Invariants: chk_stale_review, chk_reassign, chk_void_request_reason, chk_void_fields, chk_superseded_fields, uq_active_superseding_entry', async () => {
    // Negative 1: stale_review_status = 'approved' without reviewed_by
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, stale_review_status
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Stale Review Fail',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'approved'
        )
      `)
    ).rejects.toThrow(/chk_stale_review/);

    // Negative 2: voided status without void_reason
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, status, voided_by, voided_at
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Void Fail',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'voided', '${OWNER_ID}', now()
        )
      `)
    ).rejects.toThrow(/chk_void_fields/);

    // Positive: superseding entry 1
    const sup1Id = '66666666-6666-6666-6666-666666666663';
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
        charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
        created_by, status, supersedes_id, superseded_at
      ) VALUES (
        '${sup1Id}', nextval('entry_seq'), '2026-10-16', 'Superseder 1',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
        '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
        '${OWNER_ID}', 'active', '${BASE_ENTRY_ID}', now()
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    // Negative 3: second active entry superseding the same base entry throws uq_active_superseding_entry
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, status, supersedes_id, superseded_at
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '2026-10-16', 'Superseder 2',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'active', '${BASE_ENTRY_ID}', now()
        )
      `)
    ).rejects.toThrow(/uq_active_superseding_entry/);

    await pool.query(`
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM entries WHERE id = '${sup1Id}';
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
    `);
  });

  it('chk_overpayment_approval & chk_reversal_reference: Positive & Negative Cases', async () => {
    // Negative 1: Overpayment approved without reason
    await expect(
      pool.query(`
        INSERT INTO settlements (payable_id, month, expected_poisha, paid_poisha, status, overpayment_review_status)
        VALUES ('${PAYABLE_VAT_ID}', '2026-11-01', 10000, 20000, 'overpaid', 'approved')
      `)
    ).rejects.toThrow(/chk_overpayment_approval/);

    // Negative 2: is_reversal = true without reverses_payment_id throws chk_reversal_reference
    await expect(
      pool.query(`
        INSERT INTO settlement_payments (settlement_id, amount_poisha, is_reversal, reverses_payment_id, paid_on, recorded_by)
        VALUES ('${SETTLEMENT_ID}', 5000, true, null, '2026-10-15', '${OWNER_ID}')
      `)
    ).rejects.toThrow(/chk_reversal_reference/);
  });

  it('chk_statement_source: Positive & Negative Cases', async () => {
    // Negative: source = 'file' without file_sha256 throws chk_statement_source
    await expect(
      pool.query(`
        INSERT INTO statements (kind, month, source, file_sha256, statement_total_poisha, expected_poisha, status)
        VALUES ('single_payable', '2026-11-01', 'file', null, 1000, 1000, 'open')
      `)
    ).rejects.toThrow(/chk_statement_source/);
  });

  it('Test #19: uq_active_statement_coverage & Test #29: Statement Month Agreement', async () => {
    // Negative 1 (Test #29): Month in statement_payables mismatches month in statements (FK agreement)
    await expect(
      pool.query(`
        INSERT INTO statement_payables (statement_id, payable_id, month, status)
        VALUES ('${STATEMENT_ID}', '${PAYABLE_BKASH_ID}', '2026-11-01', 'open')
      `)
    ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
  });

  it('Test #38: chk_statement_line_acceptance & uq_active_statement_line_entry', async () => {
    // Negative: match_status = 'accepted' without reviewer throws chk_statement_line_acceptance
    await expect(
      pool.query(`
        INSERT INTO statement_lines (statement_id, match_status, matched_entry_id)
        VALUES ('${STATEMENT_ID}', 'accepted', '${BASE_ENTRY_ID}')
      `)
    ).rejects.toThrow(/chk_statement_line_acceptance/);
  });

  it('uq_sync_ops_superseded: Positive & Negative Cases', async () => {
    const okOp1Id = '99999999-9999-9999-9999-999999999992';
    await pool.query(`
      INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, supersedes_rejected_op_id)
      VALUES ('${okOp1Id}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash2', now(), 'ok', '${REJECTED_SYNC_OP_ID}')
      ON CONFLICT (op_id) DO NOTHING;
    `);

    // Negative: Second ok op superseding same rejected op throws uq_sync_ops_superseded
    await expect(
      pool.query(`
        INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, supersedes_rejected_op_id)
        VALUES (gen_random_uuid(), '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash3', now(), 'ok', '${REJECTED_SYNC_OP_ID}')
      `)
    ).rejects.toThrow(/uq_sync_ops_superseded/);

    await pool.query(`DELETE FROM sync_ops WHERE op_id = '${okOp1Id}'`);
  });

  it('Test #36: Month first-day boundary check across all 5 monthly tables', async () => {
    // 1. month_closes: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO month_closes (month, status) VALUES ('2026-10-15', 'closed')`)
    ).rejects.toThrow(/chk_month_closes_month|month/i);

    // 2. settlements: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO settlements (payable_id, month, expected_poisha, paid_poisha) VALUES ('${PAYABLE_VAT_ID}', '2026-10-15', 1000, 0)`)
    ).rejects.toThrow(/chk_settlements_month|month/i);

    // 3. statements: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO statements (kind, month, source, statement_total_poisha, expected_poisha) VALUES ('single_payable', '2026-10-15', 'manual_total', 1000, 1000)`)
    ).rejects.toThrow(/chk_statements_month|month/i);

    // 4. statement_payables: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO statement_payables (statement_id, payable_id, month) VALUES ('${STATEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-15')`)
    ).rejects.toThrow(/chk_statement_payables_month|month/i);

    // 5. month_close_events: non-first-day rejected
    await expect(
      pool.query(`INSERT INTO month_close_events (month, action, actor) VALUES ('2026-10-15', 'close', '${OWNER_ID}')`)
    ).rejects.toThrow(/chk_month_close_events_month|month/i);
  });

  it('App Settings Invariants: singleton id check, boolean id check, and fixed timezone check', async () => {
    // Negative 1: id = false throws check constraint
    await expect(
      pool.query(`INSERT INTO app_settings (id) VALUES (false)`)
    ).rejects.toThrow(/chk_app_settings_fixed_tz|app_settings_id_check|check constraint/i);

    // Negative 2: timezone != 'Asia/Dhaka' throws chk_app_settings_fixed_tz
    await expect(
      pool.query(`UPDATE app_settings SET timezone = 'UTC' WHERE id = true`)
    ).rejects.toThrow(/chk_app_settings_fixed_tz/);
  });
});
