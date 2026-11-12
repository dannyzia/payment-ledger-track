import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';
import { bootstrap } from '../../scripts/bootstrap';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false });

const { Pool } = pg;

// This suite drives the real Supabase Auth Admin API against a clean, empty
// Supabase database matching SUPABASE_URL (e.g. an isolated e2e stack via
// supabase db reset). It stays opt-in so a plain `pnpm test` never touches
// local data (CLT-R-025). Run deliberately with CLT_BOOTSTRAP_DB_TEST=1.
const BOOTSTRAP_DB_TEST = process.env.CLT_BOOTSTRAP_DB_TEST === '1';

describe.skipIf(!BOOTSTRAP_DB_TEST)(
  'Bootstrap Runbook and Seeding Verification (PRD §7.4, §17 M0)',
  () => {
    let pool: pg.Pool | undefined;

    function db(): pg.Pool {
      if (!pool) {
        throw new Error('Database pool was not initialized');
      }
      return pool;
    }

    beforeAll(async () => {
      const candidatePool = new Pool({
        connectionString:
          process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      });
      try {
        const { rows } = await candidatePool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM centers',
        );
        if (rows[0].n > 0) {
          throw new Error(
            `bootstrap.test.ts requires a clean empty Supabase database (e.g. isolated e2e stack via supabase db reset); found ${rows[0].n} existing center(s).`,
          );
        }
        pool = candidatePool;
      } catch (err) {
        await candidatePool.end();
        throw err;
      }

      // Ensure clean database has executed bootstrap before assertions.
      // bootstrap() creates the platform super_admin profile and provisions
      // the MHK and RMP franchise centers; it does NOT perform an owner swap
      // (the bootstrap owner is the platform super_admin, not a center owner).
      await bootstrap();
    }, 60000);

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
    });

    it('verifies all 20 public tables exist in database', async () => {
      const expectedTables = [
        'app_settings',
        'audit_log',
        'center_counters',
        'centers',
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

      const res = await db().query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);

      const tables = res.rows
        .map((r) => r.table_name)
        .filter((t) => t !== 'clt_test_schema')
        .sort();
      expect(tables).toEqual(expectedTables);
    });

    it('verifies platform super_admin profile exists', async () => {
      const res = await db().query(
        "SELECT role, active, full_name, center_id FROM profiles WHERE role = 'super_admin'",
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].role).toBe('super_admin');
      expect(res.rows[0].active).toBe(true);
      expect(res.rows[0].full_name).toBe('Platform Super Admin');
      expect(res.rows[0].center_id).toBeNull();
    });

    it('verifies both franchise centers provisioned', async () => {
      const res = await db().query('SELECT code, name FROM centers ORDER BY code');
      expect(res.rows.length).toBe(2);
      expect(res.rows.map((r) => r.code)).toEqual(['MHK', 'RMP']);
    });

    it('verifies 5 canonical payment methods seeded and active per center', async () => {
      const res = await db().query(`
        SELECT c.code AS center_code, pm.code, pm.active
        FROM payment_methods pm
        JOIN centers c ON c.id = pm.center_id
        ORDER BY c.code, pm.sort_order
      `);
      const activeRows = res.rows.filter((r) => r.active === true);
      expect(activeRows.length).toBe(10);

      for (const centerCode of ['MHK', 'RMP']) {
        const centerRows = res.rows.filter((r) => r.center_code === centerCode);
        expect(centerRows.length).toBe(5);
        expect(centerRows.map((r) => r.code)).toEqual([
          'cash',
          'bkash',
          'visa',
          'mastercard',
          'bank_transfer',
        ]);
        expect(centerRows.every((r) => r.active === true)).toBe(true);
      }
    });

    it('verifies 4 canonical payables seeded per center', async () => {
      const res = await db().query(`
        SELECT c.code AS center_code, p.code, p.kind
        FROM payables p
        JOIN centers c ON c.id = p.center_id
        ORDER BY c.code, p.code
      `);
      expect(res.rows.length).toBe(8);

      for (const centerCode of ['MHK', 'RMP']) {
        const centerRows = res.rows.filter((r) => r.center_code === centerCode);
        expect(centerRows.length).toBe(4);
        expect(centerRows.map((r) => r.code)).toEqual([
          'bkash_charge_payable',
          'mastercard_charge_payable',
          'vat_payable',
          'visa_charge_payable',
        ]);
      }
    });

    it('verifies Rate Profile v1 is published and backdated to 2026-01-01 per center', async () => {
      const res = await db().query(`
        SELECT c.code AS center_code, rp.version, rp.status, rp.effective_from::text AS eff, rp.vat_mode, rp.commission_bp
        FROM rate_profiles rp
        JOIN centers c ON c.id = rp.center_id
        WHERE rp.version = 1 AND rp.status = 'published'
        ORDER BY c.code
      `);
      expect(res.rows.length).toBe(2);
      expect(res.rows.map((r) => r.center_code)).toEqual(['MHK', 'RMP']);
      for (const row of res.rows) {
        expect(row.status).toBe('published');
        expect(row.eff).toBe('2026-01-01');
        expect(row.vat_mode).toBe('manual');
        expect(row.commission_bp).toBe(4200);
      }
    });

    it('verifies method rates for Profile v1 match operational defaults across all 5 methods per center', async () => {
      const res = await db().query(`
        SELECT c.code AS center_code, m.code, mr.charge_bp
        FROM method_rates mr
        JOIN payment_methods m ON m.id = mr.method_id AND m.center_id = mr.center_id
        JOIN rate_profiles rp ON rp.id = mr.rate_profile_id AND rp.center_id = mr.center_id
        JOIN centers c ON c.id = rp.center_id
        WHERE rp.version = 1 AND rp.status = 'published'
        ORDER BY c.code, m.code
      `);
      expect(res.rows.length).toBe(10);

      for (const centerCode of ['MHK', 'RMP']) {
        const centerRows = res.rows.filter((r) => r.center_code === centerCode);
        expect(centerRows.length).toBe(5);
        const rateMap = Object.fromEntries(centerRows.map((r) => [r.code, r.charge_bp]));
        expect(rateMap.bkash).toBe(115);
        expect(rateMap.visa).toBe(150);
        expect(rateMap.mastercard).toBe(150);
        expect(rateMap.cash).toBe(0);
        expect(rateMap.bank_transfer).toBe(0);
      }
    });

    it('verifies app_settings rows initialized per center', async () => {
      const res = await db().query(`
        SELECT c.code AS center_code, s.timezone, s.currency, s.locale, s.reconcile_tolerance_poisha
        FROM app_settings s
        JOIN centers c ON c.id = s.center_id
        ORDER BY c.code
      `);
      expect(res.rows.length).toBe(2);
      expect(res.rows.map((r) => r.center_code)).toEqual(['MHK', 'RMP']);
      for (const row of res.rows) {
        expect(row.timezone).toBe('Asia/Dhaka');
        expect(row.currency).toBe('BDT');
        expect(row.locale).toBe('en-BD');
        expect(row.reconcile_tolerance_poisha).toBe('100');
      }
    });

    it('verifies system.bootstrap event recorded in audit_log', async () => {
      const res = await db().query(
        "SELECT center_id, action, target_table, target_id, after FROM audit_log WHERE action = 'system.bootstrap'",
      );
      expect(res.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.rows[0].center_id).toBeNull();
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
      const superAdminRes = await db().query(
        "SELECT count(*)::int AS count FROM profiles WHERE role = 'super_admin'",
      );
      expect(superAdminRes.rows[0].count).toBe(1);

      const centersRes = await db().query('SELECT count(*)::int AS count FROM centers');
      expect(centersRes.rows[0].count).toBe(2);

      const methodsRes = await db().query(
        'SELECT count(*)::int AS count FROM payment_methods WHERE active = true',
      );
      expect(methodsRes.rows[0].count).toBe(10);

      const payablesRes = await db().query('SELECT count(*)::int AS count FROM payables');
      expect(payablesRes.rows[0].count).toBe(8);

      const profilesRes = await db().query(
        "SELECT count(*)::int AS count FROM rate_profiles WHERE version = 1 AND status = 'published'",
      );
      expect(profilesRes.rows[0].count).toBe(2);

      const settingsRes = await db().query('SELECT count(*)::int AS count FROM app_settings');
      expect(settingsRes.rows[0].count).toBe(2);
    });
  },
);
