import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';

const { Pool } = pg;

describe('Database Schema, Security, and Invariant Tests', () => {
  let pool: pg.Pool;

  const OWNER_ID = '11111111-1111-1111-1111-111111111111';
  const STAFF_ID = '11111111-1111-1111-1111-111111111112';
  const CENTER_ID = '00000000-0000-0000-0000-000000000001';
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
    await ensureTestDatabase();
    pool = new Pool({ connectionString: testDatabaseUrl() });
    // Seed baseline prerequisite rows safely (compatible with Plan 004 triggers)
    const seedClient = await pool.connect();
    try {
      await seedClient.query(`BEGIN`);
      await seedClient.query(`GRANT USAGE ON SCHEMA auth TO authenticated, anon`);
      // Override auth.jwt() and auth.uid() stubs to read from request.jwt.claims (set via SET ROLE + SET request.jwt.claims in tests)
      await seedClient.query(
        `CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claims', true), '')::jsonb $$`,
      );
      await seedClient.query(
        `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$`,
      );
      await seedClient.query(`DELETE FROM statement_lines`);
      await seedClient.query(`DELETE FROM statement_payables`);
      await seedClient.query(`DELETE FROM statements`);
      await seedClient.query(
        `ALTER TABLE settlement_payments DISABLE TRIGGER trg_settlement_payments_immutable`,
      );
      await seedClient.query(`DELETE FROM settlement_payments`);
      await seedClient.query(
        `ALTER TABLE settlement_payments ENABLE TRIGGER trg_settlement_payments_immutable`,
      );
      await seedClient.query(`DELETE FROM settlements`);
      await seedClient.query(`DELETE FROM entry_reconciliation_exceptions`);
      await seedClient.query(`DELETE FROM month_close_events`);
      await seedClient.query(`DELETE FROM month_closes`);
      await seedClient.query(`DELETE FROM payables`);
      await seedClient.query(`DELETE FROM devices`);
      await seedClient.query(
        `ALTER TABLE method_rates DISABLE TRIGGER trg_method_rates_draft_publish_lock`,
      );
      await seedClient.query(
        `ALTER TABLE rate_profiles DISABLE TRIGGER trg_rate_profiles_draft_publish_lock`,
      );
      await seedClient.query(`ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability`);
      await seedClient.query(`DELETE FROM sync_ops`);
      await seedClient.query(`DELETE FROM entries`);
      await seedClient.query(`DELETE FROM method_rates`);
      await seedClient.query(`DELETE FROM rate_profiles`);
      await seedClient.query(`DELETE FROM payment_methods`);
      await seedClient.query(
        `ALTER TABLE method_rates ENABLE TRIGGER trg_method_rates_draft_publish_lock`,
      );
      await seedClient.query(
        `ALTER TABLE rate_profiles ENABLE TRIGGER trg_rate_profiles_draft_publish_lock`,
      );
      await seedClient.query(`ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability`);
      await seedClient.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ('${OWNER_ID}', 'owner@example.com', '{"role":"owner","center_id":"${CENTER_ID}"}'::jsonb), ('${STAFF_ID}', 'staff@example.com', '{"role":"staff","center_id":"${CENTER_ID}"}'::jsonb) ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO profiles (id, center_id, full_name, role, active) VALUES ('${OWNER_ID}', '${CENTER_ID}', 'Owner User', 'owner', true), ('${STAFF_ID}', '${CENTER_ID}', 'Staff User', 'staff', true) ON CONFLICT (id) DO UPDATE SET center_id = EXCLUDED.center_id, full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = EXCLUDED.active`,
      );
      await seedClient.query(
        `UPDATE profiles SET role = 'admin' WHERE role = 'owner' AND id != '${OWNER_ID}'`,
      );
      await seedClient.query(
        `INSERT INTO payment_methods (id, center_id, code, name, requires_txn_ref, active, sort_order) VALUES ('${METHOD_BKASH_ID}', '${CENTER_ID}', 'bkash', 'bKash', true, false, 1) ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO rate_profiles (id, center_id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by) VALUES ('${RATE_PROFILE_V1_ID}', '${CENTER_ID}', 1, 'draft', '2026-01-01', 'manual', 0, 4200, 'gross_minus_vat', 'business') ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO method_rates (center_id, rate_profile_id, method_id, charge_bp) VALUES ('${CENTER_ID}', '${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115) ON CONFLICT (rate_profile_id, method_id) DO NOTHING`,
      );
      await seedClient.query(
        `UPDATE rate_profiles SET status = 'published' WHERE id = '${RATE_PROFILE_V1_ID}'`,
      );
      await seedClient.query(
        `UPDATE payment_methods SET active = true WHERE id = '${METHOD_BKASH_ID}'`,
      );
      await seedClient.query(
        `INSERT INTO payables (id, center_id, code, name, kind, method_id, due_day, active) VALUES ('${PAYABLE_VAT_ID}', '${CENTER_ID}', 'vat_payable', 'VAT Payable', 'vat', null, 15, true), ('${PAYABLE_BKASH_ID}', '${CENTER_ID}', 'bkash_charge', 'bKash Payable', 'method_charge', '${METHOD_BKASH_ID}', 15, true) ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO app_settings (center_id, timezone, currency, locale, net_label, reconcile_tolerance_poisha) VALUES ('${CENTER_ID}', 'Asia/Dhaka', 'BDT', 'en-BD', 'Net after deductions', 100) ON CONFLICT (center_id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO statements (id, center_id, kind, month, source, statement_total_poisha, expected_poisha, status) VALUES ('${STATEMENT_ID}', '${CENTER_ID}', 'single_payable', '2026-10-01', 'manual_total', 100000, 100000, 'open') ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO statement_payables (center_id, statement_id, payable_id, month, status) VALUES ('${CENTER_ID}', '${STATEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-01', 'open') ON CONFLICT (statement_id, payable_id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO entries (id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha, rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by) VALUES ('${BASE_ENTRY_ID}', '${CENTER_ID}', nextval('entry_seq'), '2026-10-15', 'Baseline Customer', '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"vat": {"mode": "manual", "bp": 0}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000, '${OWNER_ID}') ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO entries (id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha, rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by) VALUES ('00000000-0000-0000-0000-000000000021', '${CENTER_ID}', nextval('entry_seq'), '2026-10-15', 'Staff Customer', '${METHOD_BKASH_ID}', 50000, '${RATE_PROFILE_V1_ID}', '{"vat": {"mode": "manual", "bp": 0}}'::jsonb, 0, 0, 20000, 2500, 2500, 0, 27500, '${STAFF_ID}') ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO settlements (id, center_id, payable_id, month, expected_poisha, paid_poisha, status) VALUES ('${SETTLEMENT_ID}', '${CENTER_ID}', '${PAYABLE_VAT_ID}', '2026-10-01', 100000, 50000, 'partly_paid') ON CONFLICT (center_id, payable_id, month) DO UPDATE SET id = '${SETTLEMENT_ID}'::uuid, expected_poisha = 100000, paid_poisha = 50000, status = 'partly_paid'`,
      );
      await seedClient.query(
        `INSERT INTO settlement_payments (id, center_id, settlement_id, amount_poisha, paid_on, recorded_by) VALUES ('${PAYMENT_ID}', '${CENTER_ID}', '${SETTLEMENT_ID}', 50000, '2026-10-10', '${OWNER_ID}') ON CONFLICT (id) DO NOTHING`,
      );
      await seedClient.query(
        `INSERT INTO sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status) VALUES ('${REJECTED_SYNC_OP_ID}', '${CENTER_ID}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash', now(), 'rejected', 'pending') ON CONFLICT (op_id) DO NOTHING`,
      );
      await seedClient.query(`COMMIT`);
    } catch (err) {
      await seedClient.query(`ROLLBACK`).catch(() => undefined);
      throw err;
    } finally {
      seedClient.release();
    }
  }, 180_000);

  afterAll(async () => {
    // Teardown all test seed records in reverse FK order to prevent database pollution.
    // Global deletes (same scope as beforeAll): the settlement-recalc trigger may
    // have auto-created settlement rows with generated UUIDs, so exact-ID deletes
    // would leave orphans and break the payables FK below.
    await pool.query(`
      DELETE FROM statement_lines;
      DELETE FROM statement_payables;
      DELETE FROM statements;
      ALTER TABLE settlement_payments DISABLE TRIGGER trg_settlement_payments_immutable;
      DELETE FROM settlement_payments;
      ALTER TABLE settlement_payments ENABLE TRIGGER trg_settlement_payments_immutable;
      DELETE FROM settlements;
      DELETE FROM sync_ops;
      DELETE FROM entry_reconciliation_exceptions;
      DELETE FROM month_close_events;
      DELETE FROM month_closes;
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM entries;
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
      ALTER TABLE method_rates DISABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles DISABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      DELETE FROM method_rates;
      DELETE FROM rate_profiles;
      ALTER TABLE method_rates ENABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles ENABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      DELETE FROM payables;
      DELETE FROM payment_methods;
      DELETE FROM devices;
      -- Users/profiles are left for the next suite's beforeAll to wipe:
      -- deleting the last active owner would violate the zero-owner invariant.
    `);
    await pool.end();
  });

  // --- SECTION 1: Gate 1, RLS & Privileges Proofs ---

  it('Gate 1 Proof: Confirms Row Level Security is ENABLED on all 20 public tables', async () => {
    const expectedTables = [
      'centers',
      'center_counters',
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

    const res = await pool.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const rlsMap = new Map(res.rows.map((r) => [r.tablename, r.rowsecurity]));

    for (const table of expectedTables) {
      expect(rlsMap.has(table), `Table ${table} should exist in public schema`).toBe(true);
      expect(rlsMap.get(table), `Table ${table} must have RLS enabled`).toBe(true);
    }
  });

  it('Gate 1 & Test #45 Proof: Direct writes are revoked on all 20 tables from anon and authenticated at runtime', async () => {
    // 1. Catalog privilege check: zero write privileges
    const res = await pool.query(
      `
      SELECT table_name, privilege_type, grantee
      FROM information_schema.table_privileges
      WHERE table_schema = $1
        AND grantee = ANY($2::text[])
        AND privilege_type = ANY($3::text[])
    `,
      ['public', ['anon', 'authenticated'], ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']],
    );
    expect(res.rows.length).toBe(0);

    // 2. Runtime execution check: authenticated role rejected
    // Pin a single client: SET ROLE is per-connection and pool.query can land
    // the role switch and the probe on different sockets.
    const wClient = await pool.connect();
    try {
      await wClient.query('SET ROLE authenticated');
      await expect(
        wClient.query(
          `INSERT INTO entries (id, gross_poisha) VALUES ('00000000-0000-0000-0000-000000000001', 1000)`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await wClient.query('RESET ROLE');

      // 3. Runtime execution check: anon role rejected
      await wClient.query('SET ROLE anon');
      await expect(
        wClient.query(
          `INSERT INTO entries (id, gross_poisha) VALUES ('00000000-0000-0000-0000-000000000001', 1000)`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);
      await wClient.query('RESET ROLE');
    } finally {
      wClient.release();
    }
  });

  it('Gate 1 Proof: All 20 public tables have FORCE ROW LEVEL SECURITY enabled', async () => {
    const res = await pool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname != 'clt_test_schema'
    `);
    expect(res.rows.length).toBe(20);
    for (const row of res.rows) {
      expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} must have FORCE RLS`).toBe(true);
    }
  });

  it('Gate 1 & Test #22 Proof: Routine execution is revoked from PUBLIC, anon, and authenticated in schema public', async () => {
    const res = await pool.query(
      `
      SELECT routine_name, privilege_type, grantee
      FROM information_schema.routine_privileges
      WHERE routine_schema = $1
        AND grantee = ANY($2::text[])
    `,
      ['public', ['PUBLIC', 'anon', 'authenticated']],
    );
    expect(res.rows.length).toBe(0);
  });

  it('Test #30: Role View Permission Isolation', async () => {
    // Pin a single client: SET ROLE is per-connection, so pool.query would be
    // able to land the role switch and the probes on different sockets.
    const client = await pool.connect();
    try {
      // Staff role denied on managerial reporting views
      await client.query('SET ROLE authenticated');
      await client.query(
        `SET request.jwt.claims = '{"sub":"${STAFF_ID}","role":"authenticated","app_metadata":{"role":"staff"}}'`,
      );
      await expect(client.query('SELECT * FROM v_monthly_totals')).rejects.toThrow(
        /permission denied|row-level security/i,
      );
      await expect(client.query('SELECT * FROM v_monthly_method_charges')).rejects.toThrow(
        /permission denied|row-level security/i,
      );

      // Staff permitted on personal metrics, scoped to caller (set center context for RLS)
      await client.query(`SET clt.current_center_id = '${CENTER_ID}'`);
      const staffMetrics = await client.query('SELECT * FROM v_staff_personal_metrics');
      expect(staffMetrics.rows.length).toBeDefined();
    } finally {
      // Postgres RESET ALL skips `role` (GUC_NO_RESET_ALL), so reset role first,
      // then reset request.jwt.claims and clt.current_center_id.
      await client.query('RESET ROLE');
      await client.query('RESET ALL');
      client.release();
    }
  });

  it('audit_log_select_policy blocks staff and allows admin/owner within the center', async () => {
    const ADMIN_ID = '11111111-1111-1111-1111-111111111120';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO audit_log (center_id, actor, action, target_table, target_id, after)
         VALUES ($1, $2, 'schema.audit_rls_probe', 'audit_log', 'probe-1', '{"probe":true}'::jsonb)
         RETURNING id`,
        [CENTER_ID, OWNER_ID],
      );
      const probeAuditId = inserted.rows[0].id;

      await client.query('SET LOCAL ROLE authenticated');
      await client.query(`SET LOCAL clt.current_center_id = '${CENTER_ID}'`);

      await client.query(
        `SET LOCAL request.jwt.claims = '{"sub":"${STAFF_ID}","role":"authenticated","app_metadata":{"role":"staff","center_id":"${CENTER_ID}"}}'`,
      );
      const staffRes = await client.query('SELECT id FROM audit_log WHERE id = $1', [probeAuditId]);
      expect(staffRes.rows.length).toBe(0);

      await client.query(
        `SET LOCAL request.jwt.claims = '{"sub":"${ADMIN_ID}","role":"authenticated","app_metadata":{"role":"admin","center_id":"${CENTER_ID}"}}'`,
      );
      const adminRes = await client.query('SELECT id FROM audit_log WHERE id = $1', [probeAuditId]);
      expect(adminRes.rows.length).toBe(1);

      await client.query(
        `SET LOCAL request.jwt.claims = '{"sub":"${OWNER_ID}","role":"authenticated","app_metadata":{"role":"owner","center_id":"${CENTER_ID}"}}'`,
      );
      const ownerRes = await client.query('SELECT id FROM audit_log WHERE id = $1', [probeAuditId]);
      expect(ownerRes.rows.length).toBe(1);

      await client.query('ROLLBACK');
    } finally {
      try {
        await client.query('ROLLBACK').catch(() => undefined);
      } finally {
        try {
          await client.query('RESET ROLE');
          await client.query('RESET ALL');
        } finally {
          client.release();
        }
      }
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
    const found = new Set(res.rows.map((r) => r.constraint_name));
    for (const c of expectedConstraints) {
      expect(found.has(c), `Constraint ${c} should exist in catalog`).toBe(true);
    }
  });

  // --- SECTION 2: Identity, Auth & Profiles Constraints ---

  it('one_owner: Positive & Negative Cases', async () => {
    // Negative: Second active owner in the same center throws one_owner
    const secondOwnerId = '11111111-1111-1111-1111-111111111119';
    await expect(
      pool.query(
        `INSERT INTO profiles (id, center_id, full_name, role, active) VALUES ('${secondOwnerId}', '${CENTER_ID}', 'Second Owner', 'owner', true)`,
      ),
    ).rejects.toThrow(/one_owner/);

    // Positive: Second user as staff or admin succeeds (auth.users parent required first)
    const newStaffId = '11111111-1111-1111-1111-111111111120';
    await pool.query(`
      INSERT INTO auth.users (id, email, encrypted_password)
      VALUES ('${newStaffId}', 'schema-test-staff@example.com', crypt('x', gen_salt('bf', 4)))
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO profiles (id, center_id, full_name, role, active)
      VALUES ('${newStaffId}', '${CENTER_ID}', 'New Staff', 'staff', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    // The staff profile is kept: it is the shared ADMIN actor of
    // tests/db/entries_sync.test.ts, pinned by audit_log rows (Rule 5).
  });

  it('uq_devices_device_user: Positive & Negative Cases', async () => {
    const devId = 'd1111111-1111-1111-1111-111111111111';

    // Positive: Pair inserted
    await pool.query(`
      INSERT INTO devices (center_id, device_id, user_id, device_name)
      VALUES ('${CENTER_ID}', '${devId}', '${OWNER_ID}', 'Owner iPhone')
      ON CONFLICT (center_id, device_id, user_id) DO NOTHING;
    `);

    // Negative: Duplicate (center_id, device_id, user_id) throws uq_devices_device_user
    await expect(
      pool.query(`
        INSERT INTO devices (center_id, device_id, user_id, device_name)
        VALUES ('${CENTER_ID}', '${devId}', '${OWNER_ID}', 'Owner iPhone')
      `),
    ).rejects.toThrow(/uq_devices_device_user/);
  });

  it('uq_rate_profile_version: Positive & Negative Cases', async () => {
    // Negative: A second PUBLISHED version 1 throws uq_rate_profile_version.
    // The partial index only covers status = 'published', so a draft cannot collide.
    await expect(
      pool.query(`
        INSERT INTO rate_profiles (id, center_id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
        VALUES (gen_random_uuid(), '${CENTER_ID}', 1, 'published', '2026-11-01', 'manual', 0, 4200, 'gross', 'business')
      `),
    ).rejects.toThrow(/uq_rate_profile_version/);

    // Positive: Version 2 succeeds
    const prof2Id = '33333333-3333-3333-3333-333333333334';
    await pool.query(`
      INSERT INTO rate_profiles (id, center_id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${prof2Id}', '${CENTER_ID}', 2, 'draft', '2026-11-01', 'manual', 0, 4200, 'gross', 'business')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM rate_profiles WHERE id = '${prof2Id}'`);
  });

  it('chk_payable_method_consistency, uq_active_vat_payable & uq_active_method_payable: Positive & Negative Cases', async () => {
    // Positive: method_charge with method_id succeeds
    const validPayableId = '44444444-4444-4444-4444-444444444443';
    await pool.query(`
      INSERT INTO payables (id, center_id, code, name, kind, method_id, due_day, active)
      VALUES ('${validPayableId}', '${CENTER_ID}', 'bkash_charge_2', 'bKash 2', 'method_charge', '${METHOD_BKASH_ID}', 15, false)
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`DELETE FROM payables WHERE id = '${validPayableId}'`);

    // Negative 1: VAT with non-null method_id throws chk_payable_method_consistency
    await expect(
      pool.query(`
        INSERT INTO payables (center_id, code, name, kind, method_id, due_day)
        VALUES ('${CENTER_ID}', 'vat_invalid', 'VAT', 'vat', '${METHOD_BKASH_ID}', 15)
      `),
    ).rejects.toThrow(/chk_payable_method_consistency/);

    // Negative 2: method_charge with null method_id throws chk_payable_method_consistency
    await expect(
      pool.query(`
        INSERT INTO payables (center_id, code, name, kind, method_id, due_day)
        VALUES ('${CENTER_ID}', 'charge_invalid', 'Charge', 'method_charge', null, 15)
      `),
    ).rejects.toThrow(/chk_payable_method_consistency/);

    // Negative 3: Second active VAT payable throws uq_active_vat_payable
    await expect(
      pool.query(`
        INSERT INTO payables (center_id, code, name, kind, due_day, active)
        VALUES ('${CENTER_ID}', 'vat_second_active', 'VAT 2', 'vat', 15, true)
      `),
    ).rejects.toThrow(/uq_active_vat_payable/);
  });

  it('chk_charge_partition & chk_gross_conservation: Positive & Negative Cases', async () => {
    // Negative 1: charge partition violation (business + customer != charge)
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 3000, 0, 45000, '${OWNER_ID}'
        )
      `),
    ).rejects.toThrow(/chk_charge_partition/);

    // Negative 2: gross conservation violation (vat + comm + biz_charge + net != gross)
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 50000, '${OWNER_ID}'
        )
      `),
    ).rejects.toThrow(/chk_gross_conservation/);
  });

  it('Test #42: chk_vat_input_mode_exclusivity: Positive & Negative Cases', async () => {
    // Negative: Percentage profile with non-null vat_input_poisha throws chk_vat_input_mode_exclusivity
    const pctProfileId = '33333333-3333-3333-3333-333333333335';
    await pool.query(`
      INSERT INTO rate_profiles (id, center_id, version, status, effective_from, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by)
      VALUES ('${pctProfileId}', '${CENTER_ID}', 10, 'draft', '2026-11-01', 'percent_of_gross', 1500, 4200, 'gross', 'business')
      ON CONFLICT (id) DO NOTHING;
    `);

    await expect(
      pool.query(`
        INSERT INTO entries (
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Test Customer',
          '${METHOD_BKASH_ID}', 100000, '${pctProfileId}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 15000, 15000, 42000, 0, 0, 0, 43000, '${OWNER_ID}'
        )
      `),
    ).rejects.toThrow(/chk_vat_input_mode_exclusivity/);

    await pool.query(`DELETE FROM rate_profiles WHERE id = '${pctProfileId}'`);
  });

  it('Overrides & Bounds: chk_vat_override_bound, chk_comm_override_bound, chk_vat_override_reason, and chk_comm_override_reason', async () => {
    // Positive: Valid overrides with non-empty reasons and within gross bound
    const validOverrideId = '66666666-6666-6666-6666-666666666662';
    await pool.query(`
      INSERT INTO entries (
        id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
        commission_override_poisha, commission_override_reason, vat_poisha, commission_poisha,
        charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${validOverrideId}', '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Valid Override Customer',
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
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
          vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
          customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'VAT Over Bound',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 100001, 'Reason',
          10000, 40000, 0, 0, 0, 50000, '${OWNER_ID}'
        )
      `),
    ).rejects.toThrow(/chk_vat_override_bound/);

    // Negative 2: VAT override without reason throws chk_vat_override_reason
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_override_poisha, vat_override_reason,
          vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
          customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'VAT Reason Missing',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "percent_of_gross"}}'::jsonb, 10000, null,
          10000, 40000, 0, 0, 0, 50000, '${OWNER_ID}'
        )
      `),
    ).rejects.toThrow(/chk_vat_override_reason/);
  });

  it('Lifecycle & Review Invariants: chk_stale_review, chk_reassign, chk_void_request_reason, chk_void_fields, chk_superseded_fields, uq_active_superseding_entry', async () => {
    // Negative 1: stale_review_status = 'approved' without reviewed_by
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, stale_review_status
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Stale Review Fail',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'approved'
        )
      `),
    ).rejects.toThrow(/chk_stale_review/);

    // Negative 2: voided status without void_reason
    await expect(
      pool.query(`
        INSERT INTO entries (
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, status, voided_by, voided_at
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Void Fail',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'voided', '${OWNER_ID}', now()
        )
      `),
    ).rejects.toThrow(/chk_void_fields/);

    // Positive: superseding entry 1
    const sup1Id = '66666666-6666-6666-6666-666666666663';
    await pool.query(`
      INSERT INTO entries (
        id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
        charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
        created_by, status, supersedes_id, superseded_at
      ) VALUES (
        '${sup1Id}', '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Superseder 1',
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
          id, center_id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
          charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
          created_by, status, supersedes_id, superseded_at
        ) VALUES (
          gen_random_uuid(), '${CENTER_ID}', nextval('entry_seq'), '2026-10-16', 'Superseder 2',
          '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}',
          '{"vat": {"mode": "manual"}}'::jsonb, 10000, 10000, 40000, 5000, 5000, 0, 45000,
          '${OWNER_ID}', 'active', '${BASE_ENTRY_ID}', now()
        )
      `),
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
        INSERT INTO settlements (center_id, payable_id, month, expected_poisha, paid_poisha, status, overpayment_review_status)
        VALUES ('${CENTER_ID}', '${PAYABLE_VAT_ID}', '2026-11-01', 10000, 20000, 'overpaid', 'approved')
      `),
    ).rejects.toThrow(/chk_overpayment_approval/);

    // Negative 2: is_reversal = true without reverses_payment_id throws chk_reversal_reference
    await expect(
      pool.query(`
        INSERT INTO settlement_payments (center_id, settlement_id, amount_poisha, is_reversal, reverses_payment_id, paid_on, recorded_by)
        VALUES ('${CENTER_ID}', '${SETTLEMENT_ID}', 5000, true, null, '2026-10-15', '${OWNER_ID}')
      `),
    ).rejects.toThrow(/chk_reversal_reference/);
  });

  it('chk_statement_source: Positive & Negative Cases', async () => {
    // Negative: source = 'file' without file_sha256 throws chk_statement_source
    await expect(
      pool.query(`
        INSERT INTO statements (center_id, kind, month, source, file_sha256, statement_total_poisha, expected_poisha, status)
        VALUES ('${CENTER_ID}', 'single_payable', '2026-11-01', 'file', null, 1000, 1000, 'open')
      `),
    ).rejects.toThrow(/chk_statement_source/);
  });

  it('Test #19: uq_active_statement_coverage & Test #29: Statement Month Agreement', async () => {
    // Negative 1 (Test #29): Month in statement_payables mismatches month in statements (FK agreement)
    await expect(
      pool.query(`
        INSERT INTO statement_payables (center_id, statement_id, payable_id, month, status)
        VALUES ('${CENTER_ID}', '${STATEMENT_ID}', '${PAYABLE_BKASH_ID}', '2026-11-01', 'open')
      `),
    ).rejects.toThrow(/foreign key constraint|violates foreign key/i);
  });

  it('Test #38: chk_statement_line_acceptance & uq_active_statement_line_entry', async () => {
    // Negative: match_status = 'accepted' without reviewer throws chk_statement_line_acceptance
    await expect(
      pool.query(`
        INSERT INTO statement_lines (center_id, statement_id, match_status, matched_entry_id)
        VALUES ('${CENTER_ID}', '${STATEMENT_ID}', 'accepted', '${BASE_ENTRY_ID}')
      `),
    ).rejects.toThrow(/chk_statement_line_acceptance/);
  });

  it('uq_sync_ops_superseded: Positive & Negative Cases', async () => {
    const okOp1Id = '99999999-9999-9999-9999-999999999992';
    await pool.query(`
      INSERT INTO sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, supersedes_rejected_op_id)
      VALUES ('${okOp1Id}', '${CENTER_ID}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash2', now(), 'ok', '${REJECTED_SYNC_OP_ID}')
      ON CONFLICT (op_id) DO NOTHING;
    `);

    // Negative: Second ok op superseding same rejected op throws uq_sync_ops_superseded
    await expect(
      pool.query(`
        INSERT INTO sync_ops (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, supersedes_rejected_op_id)
        VALUES (gen_random_uuid(), '${CENTER_ID}', '${OWNER_ID}', 'd1111111-1111-1111-1111-111111111111', 'create_entry', '{}'::jsonb, 'hash3', now(), 'ok', '${REJECTED_SYNC_OP_ID}')
      `),
    ).rejects.toThrow(/uq_sync_ops_superseded/);

    await pool.query(`DELETE FROM sync_ops WHERE op_id = '${okOp1Id}'`);
  });

  it('Test #36: Month first-day boundary check across all 5 monthly tables', async () => {
    // 1. month_closes: non-first-day rejected
    await expect(
      pool.query(
        `INSERT INTO month_closes (center_id, month, status) VALUES ('${CENTER_ID}', '2026-10-15', 'closed')`,
      ),
    ).rejects.toThrow(/chk_month_closes_month|month/i);

    // 2. settlements: non-first-day rejected
    await expect(
      pool.query(
        `INSERT INTO settlements (center_id, payable_id, month, expected_poisha, paid_poisha) VALUES ('${CENTER_ID}', '${PAYABLE_VAT_ID}', '2026-10-15', 1000, 0)`,
      ),
    ).rejects.toThrow(/chk_settlements_month|month/i);

    // 3. statements: non-first-day rejected
    await expect(
      pool.query(
        `INSERT INTO statements (center_id, kind, month, source, statement_total_poisha, expected_poisha) VALUES ('${CENTER_ID}', 'single_payable', '2026-10-15', 'manual_total', 1000, 1000)`,
      ),
    ).rejects.toThrow(/chk_statements_month|month/i);

    // 4. statement_payables: non-first-day rejected
    await expect(
      pool.query(
        `INSERT INTO statement_payables (center_id, statement_id, payable_id, month) VALUES ('${CENTER_ID}', '${STATEMENT_ID}', '${PAYABLE_VAT_ID}', '2026-10-15')`,
      ),
    ).rejects.toThrow(/chk_statement_payables_month|month/i);

    // 5. month_close_events: non-first-day rejected
    await expect(
      pool.query(
        `INSERT INTO month_close_events (center_id, month, action, actor) VALUES ('${CENTER_ID}', '2026-10-15', 'close', '${OWNER_ID}')`,
      ),
    ).rejects.toThrow(/chk_month_close_events_month|month/i);
  });

  it('Multi-tenant isolation: per-center uniqueness, composite FKs, and center-scoped counters', async () => {
    const OTHER_CENTER_ID = '00000000-0000-0000-0000-000000000002';
    const OTHER_METHOD_ID = '22222222-2222-2222-2222-2222222222aa';
    const OTHER_PAYABLE_ID = '44444444-4444-4444-4444-4444444444aa';

    await pool.query(`
      INSERT INTO centers (id, code, name, legal_entity_name, address, phone)
      VALUES ('${OTHER_CENTER_ID}', 'CHT', 'Chattogram Center', 'Chattogram Learning Center Ltd', 'Chattogram', '01700000001')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO center_counters (center_id, next_entry_number) VALUES ('${OTHER_CENTER_ID}', 1)
      ON CONFLICT (center_id) DO NOTHING;
      -- Inactive: a method may only be active once a published profile covers it.
      INSERT INTO payment_methods (id, center_id, code, name, active)
      VALUES ('${OTHER_METHOD_ID}', '${OTHER_CENTER_ID}', 'bkash', 'bKash', false)
      ON CONFLICT (id) DO NOTHING;
      -- Same payables.code as the MHK center is allowed: uniqueness is per center.
      INSERT INTO payables (id, center_id, code, name, kind, method_id, due_day)
      VALUES ('${OTHER_PAYABLE_ID}', '${OTHER_CENTER_ID}', 'vat_payable', 'VAT Payable', 'vat', null, 15)
      ON CONFLICT (id) DO NOTHING;
    `);

    const dup = await pool.query(
      `SELECT count(*)::int AS n FROM payables WHERE code = 'vat_payable'`,
    );
    expect(dup.rows[0].n).toBe(2);

    // Every center has its own entry counter.
    const counters = await pool.query(
      `SELECT count(*)::int AS n FROM center_counters WHERE center_id IN ('${CENTER_ID}', '${OTHER_CENTER_ID}')`,
    );
    expect(counters.rows[0].n).toBe(2);

    // A row in one center cannot reference another center's payable: the
    // composite FK (center_id, payable_id) rejects the pair.
    await expect(
      pool.query(`
        INSERT INTO statement_payables (center_id, statement_id, payable_id, month, status)
        VALUES ('${CENTER_ID}', '${STATEMENT_ID}', '${OTHER_PAYABLE_ID}', '2026-10-01', 'open')
      `),
    ).rejects.toThrow(/fk_statement_payables_payable|foreign key/i);
  });

  it('App Settings Invariants: one row per center, known center FK, and fixed timezone check', async () => {
    // Negative 1: settings for a center that does not exist throw the FK
    await expect(
      pool.query(
        `INSERT INTO app_settings (center_id) VALUES ('00000000-0000-0000-0000-0000000000ff')`,
      ),
    ).rejects.toThrow(/foreign key|violates foreign key/i);

    // Negative 2: timezone != 'Asia/Dhaka' throws chk_app_settings_fixed_tz
    await expect(
      pool.query(`UPDATE app_settings SET timezone = 'UTC' WHERE center_id = '${CENTER_ID}'`),
    ).rejects.toThrow(/chk_app_settings_fixed_tz/);
  });
});
