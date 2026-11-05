import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { computeMonthlyAggregates } from '$lib/reports/aggregates';
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';

/**
 * Plan 020 §6.3 — Report view parity: SQL views `v_monthly_totals` and
 * `v_monthly_method_charges` vs the client aggregator
 * `computeMonthlyAggregates`, across seeded multi-month transactions
 * (PRD §10, §16.3). Zero poisha variance required (Hard Rule 2).
 * `entry_date::text` casts prevent timezone date shifts (Plan Pitfall 2).
 */

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SEED_MONTHS = ['2026-09', '2026-10', '2026-11'];

interface ViewRow {
  month: string;
  entries: number;
  total_sub_qty: number;
  gross: string;
  vat: string;
  commission: string;
  total_charge: string;
  business_charge: string;
  customer_charge: string;
  net: string;
}

interface MethodRow {
  month: string;
  code: string;
  business_charge: string;
  customer_charge: string;
  total_charge: string;
  entries: number;
}

describe('SQL View vs Client Aggregator Parity Tests', () => {
  let pgClient: Client;
  let methodsMap: Record<string, CachedPaymentMethod>;

  beforeAll(async () => {
    pgClient = new Client({ connectionString: CONNECTION_STRING });
    await pgClient.connect();

    // Clean and seed test transactions across 3 distinct months. Rows are
    // append-only by trigger (Rule 4): test cleanup is allowed to bypass it,
    // mirroring the established grand pattern in tests/db/* suites.
    await pgClient.query(`
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM entries WHERE notes LIKE 'VIEW_PARITY_SEED_%';
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
      INSERT INTO entries (
        id, entry_date, customer_name, sub_qty, sub_description, method_id,
        gross_poisha, rate_profile_id, snapshot, vat_input_poisha,
        vat_poisha, commission_poisha, charge_poisha, business_charge_poisha,
        customer_charge_poisha, net_poisha, notes, status, created_by
      )
      SELECT
        gen_random_uuid(),
        (d.month || '-15')::date,
        'Parity Test Customer',
        d.sub_qty,
        'Broadband install',
        m.method_id,
        d.gross,
        p.id,
        '{"vat":{"mode":"manual","bp":0}}'::jsonb,
        d.vat,
        d.vat,
        d.comm,
        d.charge,
        d.biz_charge,
        d.cust_charge,
        d.net,
        'VIEW_PARITY_SEED_' || d.month,
        'active',
        (SELECT id FROM profiles ORDER BY created_at LIMIT 1)
      FROM (VALUES
        ('2026-09', 1, 590900::bigint, 50900, 226800, 6795, 6795, 0, 306405),
        ('2026-09', 2, 590900::bigint, 50900, 226800, 6795, 0, 6795, 313200),
        ('2026-10', 1, 330000::bigint, 0, 138600, 11500, 11500, 0, 179900),
        ('2026-10', 1, 1000000::bigint, 100000, 400000, 15000, 15000, 0, 485000),
        ('2026-11', 3, 500000::bigint, 0, 0, 0, 0, 0, 500000),
        ('2026-11', 1, 750000::bigint, 75000, 315000, 8625, 0, 8625, 360000)
      ) AS d(month, sub_qty, gross, vat, comm, charge, biz_charge, cust_charge, net)
      CROSS JOIN LATERAL (
        SELECT id FROM payment_methods
        WHERE code = CASE WHEN d.gross % 2 = 0 THEN 'bkash' ELSE 'cash' END
        LIMIT 1
      ) AS m(method_id)
      CROSS JOIN LATERAL (SELECT id FROM rate_profiles ORDER BY effective_from LIMIT 1) p;
    `);

    methodsMap = {};
    for (const row of (await pgClient.query('SELECT id, code, active FROM payment_methods')).rows) {
      methodsMap[row.id] = {
        id: row.id,
        code: row.code,
        name: row.code,
        active: row.active,
      } as unknown as CachedPaymentMethod;
    }
  });

  afterAll(async () => {
    await pgClient.query(`
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM entries WHERE notes LIKE 'VIEW_PARITY_SEED_%';
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
    `);
    await pgClient.end();
  });

  async function fetchMonthlyRows(month: string): Promise<LocalEntry[]> {
    // entry_date::text cast (Pitfall 2): no toISOString / timezone reinterpretation
    const res = await pgClient.query(
      `SELECT id, entry_date::text AS entry_date, customer_name, sub_qty, sub_description,
              method_id, gross_poisha, vat_poisha, commission_poisha, charge_poisha,
              business_charge_poisha, customer_charge_poisha, net_poisha,
              status, rate_profile_id
         FROM entries
        WHERE date_trunc('month', entry_date) = $1::date
          AND status = 'active'
        ORDER BY entry_date, created_at`,
      [`${month}-01`],
    );

    return res.rows.map(
      (r) =>
        ({
          id: r.id,
          local_id: `#L-${r.id.slice(0, 4)}`,
          entry_date: r.entry_date,
          customer_name: r.customer_name,
          sub_qty: r.sub_qty,
          sub_description: r.sub_description,
          method_id: r.method_id,
          gross_poisha: r.gross_poisha,
          vat_poisha: r.vat_poisha,
          commission_poisha: r.commission_poisha,
          charge_poisha: r.charge_poisha,
          business_charge_poisha: r.business_charge_poisha,
          customer_charge_poisha: r.customer_charge_poisha,
          net_poisha: r.net_poisha,
          status: r.status,
          sync_status: 'synced',
          stale_rates: false,
          rate_profile_id: r.rate_profile_id,
          created_by: 'parity-seed',
          created_at: new Date().toISOString(),
        }) as unknown as LocalEntry,
    );
  }

  it('asserts zero-poisha variance between v_monthly_totals and computeMonthlyAggregates', async () => {
    for (const month of SEED_MONTHS) {
      const viewRes = await pgClient.query(
        `SELECT month::text AS month, entries, total_sub_qty, gross, vat,
                commission, total_charge, business_charge, customer_charge, net
           FROM v_monthly_totals
          WHERE month = $1::date`,
        [`${month}-01`],
      );

      const clientEntries = await fetchMonthlyRows(month);
      const clientAgg = computeMonthlyAggregates(clientEntries, month, methodsMap);
      const v = viewRes.rows[0] as ViewRow | undefined;

      // Seeded rows guarantee exactly one view row for each seeded month
      expect(v).toBeDefined();
      if (!v) continue;

      expect(Number(v.entries)).toBe(clientAgg.totalEntries);
      expect(BigInt(v.gross)).toBe(clientAgg.totalGrossPoisha);
      expect(BigInt(v.vat)).toBe(clientAgg.totalVatPoisha);
      expect(BigInt(v.commission)).toBe(clientAgg.totalCommissionPoisha);
      expect(BigInt(v.total_charge)).toBe(clientAgg.totalChargePoisha);
      expect(BigInt(v.business_charge)).toBe(clientAgg.totalBusinessChargesPoisha);
      expect(BigInt(v.customer_charge)).toBe(clientAgg.totalCustomerChargesPoisha);
      expect(BigInt(v.net)).toBe(clientAgg.totalNetPoisha);
      expect(Number(v.total_sub_qty)).toBe(clientAgg.totalSubQty);
    }
  });

  it('asserts zero-poisha variance between v_monthly_method_charges and the aggregator method breakdown', async () => {
    for (const month of SEED_MONTHS) {
      const viewRes = await pgClient.query(
        `SELECT month::text AS month, code, business_charge, customer_charge,
                total_charge, entries
           FROM v_monthly_method_charges
          WHERE month = $1::date
          ORDER BY code`,
        [`${month}-01`],
      );

      const clientEntries = await fetchMonthlyRows(month);
      const clientAgg = computeMonthlyAggregates(clientEntries, month, methodsMap);

      // Aggregate the client method breakdown by method code
      const clientByCode: Record<
        string,
        { entries: number; business: bigint; customer: bigint; charge: bigint }
      > = {};
      for (const methodCharge of clientAgg.methodCharges) {
        clientByCode[methodCharge.methodCode] = {
          entries: methodCharge.entryCount,
          business: methodCharge.totalBusinessChargePoisha,
          customer: methodCharge.totalCustomerChargePoisha,
          charge: methodCharge.totalChargePoisha,
        };
      }

      expect(viewRes.rows.length).toBeGreaterThan(0);
      for (const row of viewRes.rows as MethodRow[]) {
        const client = clientByCode[row.code];
        expect(client).toBeDefined();
        if (!client) continue;
        expect(Number(row.entries)).toBe(client.entries);
        expect(BigInt(row.business_charge)).toBe(client.business);
        expect(BigInt(row.customer_charge)).toBe(client.customer);
        expect(BigInt(row.total_charge)).toBe(client.charge);
      }
    }
  });
});
