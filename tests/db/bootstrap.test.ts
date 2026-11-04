import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { bootstrap } from '../../scripts/bootstrap';

const { Pool } = pg;

const BOOTSTRAP_EMAIL = 'owner@cosmoledger.local';

// Financial/config wipe so Role Profile v1 and canonical rows are seeded by
// bootstrap() even on batched suite runs where earlier suites left their own
// (different) seed record. Profiles and audit_log are deliberately kept:
// audit_log.actor FKs pin test profile IDs forever (Hard Rule 5).
async function wipeSeededData(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DELETE FROM statement_lines;
    DELETE FROM statement_payables;
    DELETE FROM statements;
    ALTER TABLE settlement_payments DISABLE TRIGGER trg_settlement_payments_immutable;
    DELETE FROM settlement_payments;
    ALTER TABLE settlement_payments ENABLE TRIGGER trg_settlement_payments_immutable;
    DELETE FROM settlements;
    DELETE FROM entry_reconciliation_exceptions;
    DELETE FROM month_close_events;
    DELETE FROM month_closes;
    DELETE FROM sync_ops;
    DELETE FROM devices;
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
  `);
}

describe('Bootstrap Runbook and Seeding Verification (PRD §7.4, §17 M0)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    await wipeSeededData(pool);

    // Create the bootstrap owner via the Auth Admin API when it does not exist
    // yet (batched suite runs: earlier suites' placeholder owners exist, GoTrue
    // provisioned the profile as 'staff'). On a fresh DB this is the first user.
    const { rows: cosmo } = await pool.query(
      "SELECT id FROM auth.users WHERE lower(email) = lower($1)",
      [BOOTSTRAP_EMAIL]
    );
    if (cosmo.length === 0) {
      const admin = createClient(
        process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      // Retry: db:reset cycles the auth container and the first call during
      // its warm-up window can transiently fail.
      // Role 'staff' at creation: the sole-active-owner partial index forbids a
      // second 'owner' profile while a placeholder owner still exists; the
      // atomic demote-before-promote swap below assigns the owner slot.
      let createError: string | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { error } = await admin.auth.admin.createUser({
          email: BOOTSTRAP_EMAIL,
          password: process.env.BOOTSTRAP_OWNER_PASSWORD || 'bootstrap-local-pass-1',
          email_confirm: true,
          app_metadata: { role: 'staff' },
        });
        if (!error) { createError = null; break; }
        createError = error.message;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (createError) {
        throw new Error(`test beforeAll could not create bootstrap owner in Auth: ${createError}`);
      }
    }

    // Atomic owner swap (demote-before-promote; deferred zero-owner constraint
    // evaluates post-transaction): placeholder test owners become admins, the
    // bootstrap account owns the sole active owner slot. pg's prepared
    // statements accept one command per query, so the swap is a client-side
    // transaction of three single-statement calls.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE profiles SET role = 'admin', updated_at = now() WHERE role = 'owner' AND id != (SELECT id FROM auth.users WHERE lower(email) = lower($1))",
        [BOOTSTRAP_EMAIL]
      );
      await client.query(
        "UPDATE profiles SET role = 'owner', active = true WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower($1))",
        [BOOTSTRAP_EMAIL]
      );
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }

    // Ensure clean database has executed bootstrap before assertions
    await bootstrap();
  }, 60000);

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
