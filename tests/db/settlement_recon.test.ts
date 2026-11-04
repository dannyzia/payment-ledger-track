import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

describe('Settlement, Reconciliation, and Month Close Integration Tests', () => {
  let pool: pg.Pool;

  // Actor IDs shared with tests/db/schema.test.ts and entries_sync.test.ts:
  // audit_log.actor FK pins profiles permanently (Rule 5), and the one_owner
  // invariant requires a sole shared active owner across suites.
  const OWNER_ID = '11111111-1111-1111-1111-111111111111';
  const ADMIN_ID = '11111111-1111-1111-1111-111111111120';
  const STAFF_ID = '11111111-1111-1111-1111-111111111112';

  const METHOD_CASH_ID = '00000000-0000-0000-0000-000000000010';
  const METHOD_BKASH_ID = '00000000-0000-0000-0000-000000000011';
  const METHOD_VISA_ID = '00000000-0000-0000-0000-000000000012';
  const METHOD_MC_ID = '00000000-0000-0000-0000-000000000013';

  const PAYABLE_VAT_ID = '00000000-0000-0000-0000-000000000020';
  const PAYABLE_BKASH_ID = '00000000-0000-0000-0000-000000000021';
  const PAYABLE_VISA_ID = '00000000-0000-0000-0000-000000000022';
  const PAYABLE_MC_ID = '00000000-0000-0000-0000-000000000023';
  const PAYABLE_CASH_ID = '00000000-0000-0000-0000-000000000024';

  const RATE_PROFILE_V1_ID = '00000000-0000-0000-0000-000000000030';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });

    // 1. Clean existing records in reverse dependency order
    await pool.query(`
      DELETE FROM month_close_events;
      DELETE FROM month_closes;
      DELETE FROM entry_reconciliation_exceptions;
      DELETE FROM statement_lines;
      DELETE FROM statement_payables;
      DELETE FROM statements;
      ALTER TABLE settlement_payments DISABLE TRIGGER trg_settlement_payments_immutable;
                  DELETE FROM settlement_payments;
      ALTER TABLE settlement_payments ENABLE TRIGGER trg_settlement_payments_immutable;
      DELETE FROM settlements;
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      ALTER TABLE method_rates DISABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles DISABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      DELETE FROM entries;
      DELETE FROM method_rates;
      DELETE FROM rate_profiles;
      DELETE FROM payment_methods;
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
      ALTER TABLE method_rates ENABLE TRIGGER trg_method_rates_draft_publish_lock;
      ALTER TABLE rate_profiles ENABLE TRIGGER trg_rate_profiles_draft_publish_lock;
      -- Profiles/auth.users are upserted below instead of deleted: append-only
      -- audit rows pin those profile rows forever via audit_log.actor FK.
    `);

    // 2. Seed Auth Users and Profiles
    await pool.query(`
      INSERT INTO auth.users (id, email) VALUES
        ('${OWNER_ID}', 'owner@test.local'),
        ('${ADMIN_ID}', 'admin@test.local'),
        ('${STAFF_ID}', 'staff@test.local')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO profiles (id, role, full_name, active) VALUES
        ('${OWNER_ID}', 'owner', 'Test Owner', true),
        ('${ADMIN_ID}', 'admin', 'Test Admin', true),
        ('${STAFF_ID}', 'staff', 'Test Staff', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;

      -- Seed Payment Methods initially inactive (satisfies trg_payment_methods_active_rate_check)
      INSERT INTO payment_methods (id, code, name, requires_txn_ref, active, sort_order) VALUES
        ('${METHOD_CASH_ID}', 'cash', 'Cash', false, false, 1),
        ('${METHOD_BKASH_ID}', 'bkash', 'bKash', true, false, 2),
        ('${METHOD_VISA_ID}', 'visa', 'Visa', true, false, 3),
        ('${METHOD_MC_ID}', 'mastercard', 'Mastercard', true, false, 4)
      ON CONFLICT (id) DO NOTHING;

      -- Seed Published Rate Profile v1
      INSERT INTO rate_profiles (id, version, status, vat_mode, vat_bp, commission_bp, commission_base, effective_from) VALUES
        ('${RATE_PROFILE_V1_ID}', 1, 'draft', 'percent_of_gross', 1000, 4200, 'gross', '2026-01-01')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO method_rates (rate_profile_id, method_id, charge_bp) VALUES
        ('${RATE_PROFILE_V1_ID}', '${METHOD_CASH_ID}', 0),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_VISA_ID}', 150),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_MC_ID}', 150)
      ON CONFLICT (rate_profile_id, method_id) DO NOTHING;

      -- Publish only after method rates exist (trg_rate_profiles_draft_publish_lock)
      UPDATE rate_profiles SET status = 'published', published_at = now() WHERE id = '${RATE_PROFILE_V1_ID}';

      -- Now activate payment methods
      UPDATE payment_methods SET active = true WHERE id IN ('${METHOD_CASH_ID}', '${METHOD_BKASH_ID}', '${METHOD_VISA_ID}', '${METHOD_MC_ID}');

      -- Seed Payables with exact Plan 003 schema columns
      INSERT INTO payables (id, code, name, kind, method_id, due_day, remind_days_before, active) VALUES
        ('${PAYABLE_VAT_ID}', 'PAY-VAT', 'Government VAT', 'vat', null, 15, 3, true),
        ('${PAYABLE_BKASH_ID}', 'PAY-BKASH', 'bKash Fee Payable', 'method_charge', '${METHOD_BKASH_ID}', 10, 3, true),
        ('${PAYABLE_VISA_ID}', 'PAY-VISA', 'Visa Fee Payable', 'method_charge', '${METHOD_VISA_ID}', 20, 3, true),
        ('${PAYABLE_MC_ID}', 'PAY-MC', 'Mastercard Fee Payable', 'method_charge', '${METHOD_MC_ID}', 20, 3, true),
        ('${PAYABLE_CASH_ID}', 'PAY-CASH', 'Cash Fee Payable', 'method_charge', '${METHOD_CASH_ID}', 20, 3, true)
      ON CONFLICT (id) DO NOTHING;

      -- Seed App Settings (id = true)
      INSERT INTO app_settings (id, reconcile_tolerance_poisha)
      VALUES (true, 100)
      ON CONFLICT (id) DO UPDATE SET reconcile_tolerance_poisha = 100;
    `);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('Test #26: Authoritative 5-state settlement lifecycle calculation', async () => {
    const r1 = await pool.query("SELECT calc_settlement_status(0, 0) as s");
    expect(r1.rows[0].s).toBe('not_applicable');

    const r2 = await pool.query("SELECT calc_settlement_status(10000, 0) as s");
    expect(r2.rows[0].s).toBe('due');

    const r3 = await pool.query("SELECT calc_settlement_status(10000, 4000) as s");
    expect(r3.rows[0].s).toBe('partly_paid');

    const r4 = await pool.query("SELECT calc_settlement_status(10000, 10000) as s");
    expect(r4.rows[0].s).toBe('paid');

    const r5 = await pool.query("SELECT calc_settlement_status(10000, 12000) as s");
    expect(r5.rows[0].s).toBe('overpaid');

    const r6 = await pool.query("SELECT calc_settlement_status(0, 5000) as s");
    expect(r6.rows[0].s).toBe('overpaid');
  });

  it('Test #13: Settlement payment reversal net reduction, bound enforcement, and immutability', async () => {
    const testMonth = '2026-03-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Set expected poisha to 100,000 for testing
    await pool.query("UPDATE settlements SET expected_poisha = 100000 WHERE id = $1", [settlementId]);

    // 1. Record primary payment of 50,000 poisha
    const payRes = await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 50000, $2::date, 'REF-001', null, 'Initial partial payment', false, null, $3::uuid
      ) as id
    `, [settlementId, testMonth, ADMIN_ID]);
    const initialPaymentId = payRes.rows[0].id;

    let check = await pool.query("SELECT paid_poisha, status FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].paid_poisha).toBe('50000');
    expect(check.rows[0].status).toBe('partly_paid');

    // 2. Attempt reversal exceeding original payment amount (60,000 > 50,000) -> must fail
    await expect(
      pool.query(`
        SELECT record_settlement_payment(
          $1::uuid, 60000, $2::date, 'REV-001', null, 'Excess reversal', true, $3::uuid, $4::uuid
        )
      `, [settlementId, testMonth, initialPaymentId, ADMIN_ID])
    ).rejects.toThrow('422 reversals_exceed_original_amount');

    // 3. Record valid partial reversal of 20,000 poisha
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 20000, $2::date, 'REV-002', null, 'Partial reversal', true, $3::uuid, $4::uuid
      )
    `, [settlementId, testMonth, initialPaymentId, ADMIN_ID]);

    check = await pool.query("SELECT paid_poisha, status FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].paid_poisha).toBe('30000');
    expect(check.rows[0].status).toBe('partly_paid');

    // 4. Attempt second reversal exceeding remaining balance (35,000 + 20,000 > 50,000) -> must fail
    await expect(
      pool.query(`
        SELECT record_settlement_payment(
          $1::uuid, 35000, $2::date, 'REV-003', null, 'Excess second reversal', true, $3::uuid, $4::uuid
        )
      `, [settlementId, testMonth, initialPaymentId, ADMIN_ID])
    ).rejects.toThrow('422 reversals_exceed_original_amount');

    // 5. Immutability trigger checks (BEFORE UPDATE OR DELETE raises 403)
    await expect(
      pool.query("UPDATE settlement_payments SET amount_poisha = 99999 WHERE id = $1", [initialPaymentId])
    ).rejects.toThrow('403 settlement_payments_immutable');

    await expect(
      pool.query("DELETE FROM settlement_payments WHERE id = $1", [initialPaymentId])
    ).rejects.toThrow('403 settlement_payments_immutable');
  });

  it('Test #5: Month Close Gating: Unreconciled Payables', async () => {
    const testMonth = '2026-04-01';
    // Create an active entry generating liability with mandatory txn_ref for bKash
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), $1::date, 'Gate Customer',
        $2::uuid, 100000, $3::uuid,
        '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        10000, 42000, 1150, 1150, 0, 46850, $4::uuid, 'BKASH-GATE-01'
      );
    `, [testMonth, METHOD_BKASH_ID, RATE_PROFILE_V1_ID, OWNER_ID]);

    // close_month must fail because bKash/VAT payables are unreconciled
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 unreconciled_payables_exist');
  });

  it('Test #6: Month Close Gating: Unapproved Overpayment', async () => {
    const testMonth = '2026-05-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Overpay settlement: expected 10,000, paid 15,000
    await pool.query("UPDATE settlements SET expected_poisha = 10000 WHERE id = $1", [settlementId]);
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 15000, $2::date, 'REF-OVER', null, 'Overpayment', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Reconcile statement to clear Gate 2
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        0, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [stmtRes.rows[0].id, OWNER_ID]);

    // close_month must fail on Gate 3 (unapproved overpayment)
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 unapproved_overpaid_settlement');
  });

  it('Test #7: Month Reopen Audit Logging & State Transitions', async () => {
    const testMonth = '2026-06-01';
    // Initialize empty month (all settlements not_applicable)
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    // Close month cleanly
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    let check = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('closed');

    // Attempt reopen with empty reason -> must fail
    await expect(
      pool.query("SELECT reopen_month($1::date, '   ', $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 reason_required');

    // Reopen month with valid reason
    await pool.query("SELECT reopen_month($1::date, 'Audit discrepancy found', $2::uuid)", [testMonth, OWNER_ID]);

    check = await pool.query("SELECT status, reopen_reason FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('open');
    expect(check.rows[0].reopen_reason).toBe('Audit discrepancy found');

    const eventCheck = await pool.query("SELECT action, reason FROM month_close_events WHERE month = $1 ORDER BY created_at DESC LIMIT 1", [testMonth]);
    expect(eventCheck.rows[0].action).toBe('reopen');
    expect(eventCheck.rows[0].reason).toBe('Audit discrepancy found');
  });

  it('Test #16: Combined Card Statement Reconciliation', async () => {
    const testMonth = '2026-07-01';
    const vEntryId = '00000000-0000-0000-0000-000000000071';
    const mcEntryId = '00000000-0000-0000-0000-000000000072';

    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES
        ('${vEntryId}', nextval('entry_seq'), '${testMonth}', 'Card Cust 1', '${METHOD_VISA_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb, 0, 42000, 1500, 1500, 0, 56500, '${OWNER_ID}', 'CARD-REF-01'),
        ('${mcEntryId}', nextval('entry_seq'), '${testMonth}', 'Card Cust 2', '${METHOD_MC_ID}', 200000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb, 0, 84000, 3000, 3000, 0, 113000, '${OWNER_ID}', 'CARD-REF-02')
      ON CONFLICT (id) DO NOTHING;
    `);

    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'CARD-REF-01', grossPoisha: '100000', feePoisha: '1500' },
      { lineDate: testMonth, reference: 'CARD-REF-02', grossPoisha: '200000', feePoisha: '3000' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'combined_card', $1::date, 'file', 'statements/2026-07/card.csv',
        $2::text, 4500, ARRAY[$3::uuid, $4::uuid], $5::jsonb, $6::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_VISA_ID, PAYABLE_MC_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Reconcile statement
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);

    const spCheck = await pool.query("SELECT status FROM statement_payables WHERE statement_id = $1", [statementId]);
    expect(spCheck.rows.length).toBe(2);
    expect(spCheck.rows.every(r => r.status === 'reconciled')).toBe(true);

    // Verify month successfully closes after combined card statement reconciliation
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    const closeCheck = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(closeCheck.rows[0].status).toBe('closed');
  });

  it('Test #17: Multi-Month Race Immunity & Lock Hierarchy', async () => {
    // Tests that procedures taking month locks in ascending month order run cleanly without deadlocks
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    const m1 = '2026-11-01';
    const m2 = '2026-12-01';

    try {
      const t1 = (async () => {
        await client1.query('BEGIN');
        await client1.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 11)");
        await client1.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 12)");
        await client1.query('SELECT generate_monthly_settlements($1::date)', [m1]);
        await client1.query('SELECT generate_monthly_settlements($1::date)', [m2]);
        await client1.query('COMMIT');
      })();

      const t2 = (async () => {
        await client2.query('BEGIN');
        await client2.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 11)");
        await client2.query("SELECT pg_advisory_xact_lock(1001, 2026 * 12 + 12)");
        await client2.query('SELECT generate_monthly_settlements($1::date)', [m1]);
        await client2.query('SELECT generate_monthly_settlements($1::date)', [m2]);
        await client2.query('COMMIT');
      })();

      await Promise.all([t1, t2]);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('Test #20: Zero-Liability Settlement Status', async () => {
    const testMonth = '2026-09-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const check = await pool.query("SELECT status FROM settlements WHERE month = $1", [testMonth]);
    expect(check.rows.length).toBeGreaterThan(0);
    expect(check.rows.every(r => r.status === 'not_applicable')).toBe(true);

    // Month closes cleanly without statement reconciliation because all settlements are not_applicable
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    const closeCheck = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(closeCheck.rows[0].status).toBe('closed');
  });

  it('Test #23: Statement Invalidation Cascade on Entry Modification', async () => {
    const testMonth = '2026-08-01';
    const entryId = '00000000-0000-0000-0000-000000000081';

    // Insert entry with 10,000 VAT
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Cascade Cust',
        '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        10000, 42000, 0, 0, 0, 48000, '${OWNER_ID}'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Create and reconcile Mode A VAT statement
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        10000, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Invalidate entry by voiding it (respects Hard Rule 4 immutability)
    await pool.query(`
      UPDATE entries
      SET status = 'voided', voided_by = '${OWNER_ID}', voided_at = now(), void_reason = 'Testing cascade'
      WHERE id = '${entryId}';
    `);

    // Statement should be invalidated back to 'open' and expected_poisha recalculated to 0
    check = await pool.query("SELECT status, expected_poisha FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('open');
    expect(check.rows[0].expected_poisha).toBe('0');
  });

  it('Test #34: Reconciliation Gating on Unapproved Overpaid Settlement', async () => {
    const testMonth = '2026-10-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Overpay settlement: expected 0, paid 5,000
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 5000, $2::date, 'REF-OVER-34', null, 'Overpay 34', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Create and reconcile statement
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        0, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [stmtRes.rows[0].id, OWNER_ID]);

    // close_month must fail because overpayment is unapproved
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 unapproved_overpaid_settlement');
  });

    it('Test #35: Dynamic Overpayment Approval Invalidation upon Balance Change', async () => {
    const testMonth = '2026-03-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id, expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2 LIMIT 1",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;
    const expected = Number(setRes.rows[0].expected_poisha);

    // Pay expected + 5,000 (surplus 5,000 poisha)
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, $2::bigint, $3::date, 'REF-OVER-35', null, 'Initial overpayment', false, null, $4::uuid
      )
    `, [settlementId, expected + 5000, testMonth, ADMIN_ID]);

    // Owner approves the exact surplus
    await pool.query("SELECT approve_settlement_overpayment($1::uuid, 'Approved surplus', $2::uuid)", [settlementId, OWNER_ID]);

    let check = await pool.query(
      "SELECT expected_poisha, paid_poisha, overpayment_review_status, overpayment_approved_amount_poisha FROM settlements WHERE id = $1",
      [settlementId]
    );
    // The approval binds to the exact live surplus (expected is live-recalculated);
    // assert the bound amount equals paid - expected dynamically.
    expect(check.rows[0].overpayment_review_status).toBe('approved');
    const surplus = Number(check.rows[0].paid_poisha) - Number(check.rows[0].expected_poisha);
    expect(surplus).toBeGreaterThan(0);
    expect(check.rows[0].overpayment_approved_amount_poisha).toBe(String(surplus));

    // Balance changes: additional payment of 2,000 -> surplus grows
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, 2000, $2::date, 'REF-OVER-35B', null, 'Additional payment', false, null, $3::uuid
      )
    `, [settlementId, testMonth, ADMIN_ID]);

    // Approval must be invalidated dynamically back to 'none'
    check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha, overpayment_reason FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('none');
    expect(check.rows[0].overpayment_approved_amount_poisha).toBeNull();
    expect(check.rows[0].overpayment_reason).toBeNull();
  });

  it('Test #37: Scoped Exception Isolation Across Payables', async () => {
    const testMonth = '2026-11-01';
    const entryId = '00000000-0000-0000-0000-000000000091';

    // Entry has both VAT and bKash charge
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Ex Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        10000, 42000, 1150, 1150, 0, 46850, '${OWNER_ID}', 'BKASH-EX-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Approve exception for bKash fee payable
    await pool.query(`
      SELECT review_entry_reconciliation_exception(
        $1::uuid, $2::uuid, 'approved', 'bKash variance exception', $3::uuid
      )
    `, [entryId, PAYABLE_BKASH_ID, OWNER_ID]);

    // Create file statement for VAT payable with an accepted dummy line (so zero unmatched lines remain on statement side)
    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'DUMMY-VAT-LINE', grossPoisha: '50000', feePoisha: '5000' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2026-11/vat.csv',
        $2::text, 10000, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_VAT_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Accept statement line
    const lineRes = await pool.query("SELECT id FROM statement_lines WHERE statement_id = $1", [statementId]);
    await pool.query("SELECT accept_statement_line($1::uuid, 'Accepted variance', $2::uuid)", [lineRes.rows[0].id, OWNER_ID]);

    // Reconcile must fail because entryId VAT liability is uncovered and lacks approved exception for VAT (exception on bKash does not isolate VAT)
    await expect(
      pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID])
    ).rejects.toThrow('422 unmatched_entries_without_approved_exceptions');
  });

  it('Test #39: First-Time Month Close Idempotent Upsert and Freeze Semantics', async () => {
    const testMonth = '2027-01-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    // First close
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    let check = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('closed');

    // Second close returns immediately without error (idempotent)
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);
    check = await pool.query("SELECT status FROM month_closes WHERE month = $1", [testMonth]);
    expect(check.rows[0].status).toBe('closed');
  });

  it('Test #40: Mode A Totals-Only Reconciliation & Variance Tolerance', async () => {
    const testMonth = '2026-12-01';
    // Expected is 0 poisha
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        50, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Within tolerance (50 poisha <= 100 poisha tolerance) -> succeeds without note
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Create second statement with variance exceeding tolerance (200 > 100)
    const stmtRes2 = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        200, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_BKASH_ID, OWNER_ID]);
    const statementId2 = stmtRes2.rows[0].id;

    // Fails without note
    await expect(
      pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId2, OWNER_ID])
    ).rejects.toThrow('422 variance_exceeds_tolerance');

    // Succeeds with explanatory note
    await pool.query("SELECT reconcile_statement($1::uuid, 'Approved bank charge variance', $2::uuid)", [statementId2, OWNER_ID]);
    check = await pool.query("SELECT status, note FROM statements WHERE id = $1", [statementId2]);
    expect(check.rows[0].status).toBe('reconciled');
    expect(check.rows[0].note).toBe('Approved bank charge variance');
  });

  it('Test #43: Customer Fee Zero Settlement Liability', async () => {
    const testMonth = '2027-02-01';
    // Cash transaction with customer fee 1,000 poisha, business fee 0
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Customer Fee Cust',
        '${METHOD_CASH_ID}', 50000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        0, 21000, 1000, 0, 1000, 29000, '${OWNER_ID}'
      );
    `);

    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const check = await pool.query(`
      SELECT s.expected_poisha, s.status
      FROM settlements s
      JOIN payables p ON p.id = s.payable_id
      WHERE s.month = $1 AND p.method_id = $2
    `, [testMonth, METHOD_CASH_ID]);

    expect(check.rows.length).toBe(1);
    expect(check.rows[0].expected_poisha).toBe('0');
    expect(check.rows[0].status).toBe('not_applicable');
  });

  it('Test #48: Cross-Table Trigger Lock Immunity', async () => {
    const testMonth = '2026-02-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      await client1.query('BEGIN');
      await client2.query('BEGIN');

      // Client 1 takes month lock and inserts entry (triggering settlement recalculation)
      await client1.query("SELECT pg_advisory_xact_lock(1001, 2027 * 12 + 3)");

      // Client 2 attempts settlement payment for same month (serializes cleanly on month lock)
      const p2 = client2.query(`
        SELECT record_settlement_payment(
          (SELECT id FROM settlements WHERE month = '${testMonth}' LIMIT 1),
          1000, '${testMonth}', 'LOCK-TEST', null, 'Lock test', false, null, '${OWNER_ID}'
        )
      `);

      // Client 1 inserts entry then commits
      await client1.query(`
        INSERT INTO entries (
          id, server_seq, entry_date, customer_name, method_id, gross_poisha,
          rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
          business_charge_poisha, customer_charge_poisha, net_poisha, created_by
        ) VALUES (
          gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Concurrent Cust',
          '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
          10000, 42000, 0, 0, 0, 48000, '${OWNER_ID}'
        );
      `);

      await client1.query('COMMIT');
      await p2;
      await client2.query('COMMIT');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('Test #49: Settlements Query & Dynamic Overpayment Handling', async () => {
    const testMonth = '2026-04-01';
    // 1. Invoke generate_monthly_settlements and assert clean execution
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query(
      "SELECT id FROM settlements WHERE month = $1 AND payable_id = $2",
      [testMonth, PAYABLE_VAT_ID]
    );
    const settlementId = setRes.rows[0].id;

    // Overpay settlement: pay live expected + 50,000
    const beforePay = await pool.query("SELECT expected_poisha FROM settlements WHERE id = $1", [settlementId]);
    const liveExpected = Number(beforePay.rows[0].expected_poisha);
    await pool.query(`
      SELECT record_settlement_payment(
        $1::uuid, $2::bigint, $3::date, 'REF-49', null, 'Overpay 49', false, null, $4::uuid
      )
    `, [settlementId, liveExpected + 50000, testMonth, ADMIN_ID]);

    // Owner approves surplus
    await pool.query("SELECT approve_settlement_overpayment($1::uuid, 'Approved ৳500 surplus', $2::uuid)", [settlementId, OWNER_ID]);

    let check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha, paid_poisha, expected_poisha FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('approved');
    expect(Number(check.rows[0].overpayment_approved_amount_poisha)).toBeGreaterThan(0);
    expect(Number(check.rows[0].overpayment_approved_amount_poisha))
      .toBe(Number(check.rows[0].paid_poisha) - Number(check.rows[0].expected_poisha));

    // Admin modifies an entry in the month, increasing expected_poisha
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Recalc Cust',
        '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        10000, 42000, 0, 0, 0, 48000, '${ADMIN_ID}'
      );
    `);

    // Verify trigger trg_settlements_recalc_status_and_overpayment resets all 5 overpayment columns
    check = await pool.query("SELECT overpayment_review_status, overpayment_approved_amount_poisha, overpayment_reason, overpayment_approved_by, overpayment_approved_at FROM settlements WHERE id = $1", [settlementId]);
    expect(check.rows[0].overpayment_review_status).toBe('none');
    expect(check.rows[0].overpayment_approved_amount_poisha).toBeNull();
    expect(check.rows[0].overpayment_reason).toBeNull();
    expect(check.rows[0].overpayment_approved_by).toBeNull();
    expect(check.rows[0].overpayment_approved_at).toBeNull();
  });

  it('Test #51: Statement Line Auto-Unmatch on Entry Void/Supersede', async () => {
    const testMonth = '2027-05-01';
    const entryId = '00000000-0000-0000-0000-000000000101';

    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Unmatch Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        0, 42000, 1150, 1150, 0, 56850, '${OWNER_ID}', 'BKASH-UNMATCH-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'BKASH-UNMATCH-01', grossPoisha: '100000', feePoisha: '1150' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-05/bkash.csv',
        $2::text, 1150, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    let lineCheck = await pool.query("SELECT match_status, matched_entry_id, is_active_match FROM statement_lines WHERE statement_id = $1", [statementId]);
    expect(lineCheck.rows[0].match_status).toBe('matched');
    expect(lineCheck.rows[0].matched_entry_id).toBe(entryId);
    expect(lineCheck.rows[0].is_active_match).toBe(true);

    // Void entry
    await pool.query(`
      UPDATE entries
      SET status = 'voided', voided_by = '${OWNER_ID}', voided_at = now(), void_reason = 'Customer cancelled'
      WHERE id = '${entryId}';
    `);

    // Statement line must be automatically unmatched via trg_entries_unmatch_statement_lines
    lineCheck = await pool.query("SELECT match_status, matched_entry_id, is_active_match FROM statement_lines WHERE statement_id = $1", [statementId]);
    expect(lineCheck.rows[0].match_status).toBe('unmatched');
    expect(lineCheck.rows[0].matched_entry_id).toBeNull();
    expect(lineCheck.rows[0].is_active_match).toBe(false);
  });

  it('Test #53: Line Unmatching Cascade Invalidation', async () => {
    const testMonth = '2027-06-01';
    const entryId = '00000000-0000-0000-0000-000000000111';

    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Unmatch Cascade Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        0, 42000, 1150, 1150, 0, 56850, '${OWNER_ID}', 'BKASH-CASC-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'BKASH-CASC-01', grossPoisha: '100000', feePoisha: '1150' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-06/bkash.csv',
        $2::text, 1150, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Reconcile statement
    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Unmatch line
    const lineRes = await pool.query("SELECT id FROM statement_lines WHERE statement_id = $1", [statementId]);
    await pool.query("SELECT unmatch_statement_line($1::uuid, 'Manual review required', $2::uuid)", [lineRes.rows[0].id, OWNER_ID]);

    // Statement and child payables must cascade back to 'open'
    check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('open');

    const spCheck = await pool.query("SELECT status FROM statement_payables WHERE statement_id = $1", [statementId]);
    expect(spCheck.rows[0].status).toBe('open');
  });

  it('Test #54: Exception Flip Invalidation Cascade', async () => {
    const testMonth = '2027-07-01';
    const entryId = '00000000-0000-0000-0000-000000000121';
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Flip Cust',
        '${METHOD_BKASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        0, 42000, 1150, 1150, 0, 56850, '${OWNER_ID}', 'BKASH-FLIP-01'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Approve exception
    await pool.query(`
      SELECT review_entry_reconciliation_exception(
        $1::uuid, $2::uuid, 'approved', 'Initial approved exception', $3::uuid
      )
    `, [entryId, PAYABLE_BKASH_ID, OWNER_ID]);

    // Reconcile statement covering bKash
    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'DUMMY-REF', grossPoisha: '50000', feePoisha: '500' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-07/bkash.csv',
        $2::text, 1150, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // Accept line so statement has no unmatched lines
    const lineRes = await pool.query("SELECT id FROM statement_lines WHERE statement_id = $1", [statementId]);
    await pool.query("SELECT accept_statement_line($1::uuid, 'Accepted dummy', $2::uuid)", [lineRes.rows[0].id, OWNER_ID]);

    await pool.query("SELECT reconcile_statement($1::uuid, null, $2::uuid)", [statementId, OWNER_ID]);
    let check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('reconciled');

    // Flip exception from approved to rejected
    await pool.query(`
      SELECT review_entry_reconciliation_exception(
        $1::uuid, $2::uuid, 'rejected', 'Exception revoked upon audit', $3::uuid
      )
    `, [entryId, PAYABLE_BKASH_ID, OWNER_ID]);

    // Statement and child payables must cascade back to 'open' via trg_entry_exceptions_invalidate_reconciliation
    check = await pool.query("SELECT status FROM statements WHERE id = $1", [statementId]);
    expect(check.rows[0].status).toBe('open');
  });

  it('Test #55: Live Settlement & Statement Expected Recalculation Trigger (H1)', async () => {
    const testMonth = '2027-08-01';
    const entryId = '00000000-0000-0000-0000-000000000551';

    // 1. Create an open statement covering VAT before any entries exist
    const stmtRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'manual_total', null, null,
        0, ARRAY[$2::uuid], null, $3::uuid
      ) as id
    `, [testMonth, PAYABLE_VAT_ID, OWNER_ID]);
    const statementId = stmtRes.rows[0].id;

    // 2. Insert entry in open month without running generate_monthly_settlements manually
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, txn_ref
      ) VALUES (
        '${entryId}', nextval('entry_seq'), '${testMonth}', 'Live Recalc Cust',
        '${METHOD_BKASH_ID}', 200000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        20000, 84000, 2300, 2300, 0, 93700, '${OWNER_ID}', 'BKASH-LIVE-01'
      );
    `);

    // Settlements expected_poisha must update dynamically via trg_entries_recalc_settlements
    const vatSet = await pool.query("SELECT expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_VAT_ID]);
    expect(vatSet.rows[0].expected_poisha).toBe('20000');

    const bkashSet = await pool.query("SELECT expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_BKASH_ID]);
    expect(bkashSet.rows[0].expected_poisha).toBe('2300');

    // Open statement expected_poisha must also update dynamically via trg_entries_recalc_settlements
    const stmtCheck = await pool.query("SELECT expected_poisha FROM statements WHERE id = $1", [statementId]);
    expect(stmtCheck.rows[0].expected_poisha).toBe('20000');

    // 3. Void the entry: settlements and open statement expected_poisha must dynamically drop to 0
    await pool.query(`
      UPDATE entries
      SET status = 'voided', voided_by = '${OWNER_ID}', voided_at = now(), void_reason = 'Testing dynamic recalc'
      WHERE id = '${entryId}'
    `);

    const vatAfterVoid = await pool.query("SELECT expected_poisha FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_VAT_ID]);
    expect(vatAfterVoid.rows[0].expected_poisha).toBe('0');

    const stmtAfterVoid = await pool.query("SELECT expected_poisha FROM statements WHERE id = $1", [statementId]);
    expect(stmtAfterVoid.rows[0].expected_poisha).toBe('0');
  });

  it('Test #58: Stale Review Month Close Gate', async () => {
    const testMonth = '2027-09-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    // Insert entry with stale_review_status = 'flagged'
    await pool.query(`
      INSERT INTO entries (
        id, server_seq, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, stale_rates, stale_review_status
      ) VALUES (
        gen_random_uuid(), nextval('entry_seq'), '${testMonth}', 'Stale Flagged Cust',
        '${METHOD_CASH_ID}', 100000, '${RATE_PROFILE_V1_ID}', '{"engineVersion": 1, "vat": {"mode": "percent_of_gross", "bp": 1000}}'::jsonb,
        0, 42000, 0, 0, 0, 58000, '${OWNER_ID}', true, 'flagged'
      );
    `);

    // close_month must fail on Gate 1
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID])
    ).rejects.toThrow('422 stale_review_pending');
  });

  it('Test Statement Supersession: Lifecycle, Payables Inheritance, and Line Invalidation', async () => {
    const testMonth = '2027-10-01';
    const lines = JSON.stringify([
      { lineDate: testMonth, reference: 'ORIG-LINE-1', grossPoisha: '50000', feePoisha: '500' }
    ]);
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const origRes = await pool.query(`
      SELECT create_statement(
        'single_payable', $1::date, 'file', 'statements/2027-10/orig.csv',
        $2::text, 500, ARRAY[$3::uuid], $4::jsonb, $5::uuid
      ) as id
    `, [testMonth, sha256, PAYABLE_BKASH_ID, lines, OWNER_ID]);
    const origId = origRes.rows[0].id;

    const repLines = JSON.stringify([
      { lineDate: testMonth, reference: 'REP-LINE-1', grossPoisha: '60000', feePoisha: '600' }
    ]);
    const repSha256 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

    // Supersede statement
    const repRes = await pool.query(`
      SELECT supersede_statement(
        $1::uuid, 'statements/2027-10/rep.csv', $2::text, 600, 'Superseded due to missing rows', $3::jsonb, $4::uuid
      ) as id
    `, [origId, repSha256, repLines, OWNER_ID]);
    const repId = repRes.rows[0].id;

    // Verify original statement is superseded and linked
    const origCheck = await pool.query("SELECT status, superseded_by FROM statements WHERE id = $1", [origId]);
    expect(origCheck.rows[0].status).toBe('superseded');
    expect(origCheck.rows[0].superseded_by).toBe(repId);

    // Verify original lines have is_active_match = false
    const origLineCheck = await pool.query("SELECT is_active_match FROM statement_lines WHERE statement_id = $1", [origId]);
    expect(origLineCheck.rows[0].is_active_match).toBe(false);

    // Verify replacement statement is open and inherited covered payables
    const repCheck = await pool.query("SELECT status, statement_total_poisha FROM statements WHERE id = $1", [repId]);
    expect(repCheck.rows[0].status).toBe('open');
    expect(repCheck.rows[0].statement_total_poisha).toBe('600');

    const repSpCheck = await pool.query("SELECT payable_id, status FROM statement_payables WHERE statement_id = $1", [repId]);
    expect(repSpCheck.rows.length).toBe(1);
    expect(repSpCheck.rows[0].payable_id).toBe(PAYABLE_BKASH_ID);
    expect(repSpCheck.rows[0].status).toBe('open');
  });

  it('Test Validation Guards: create_statement rejects invalid configurations', async () => {
    const testMonth = '2027-11-01';
    // 1. Empty payables
    await expect(
      pool.query(`
        SELECT create_statement('single_payable', $1::date, 'manual_total', null, null, 100, ARRAY[]::uuid[], null, $2::uuid)
      `, [testMonth, OWNER_ID])
    ).rejects.toThrow('422 payable_ids_required');

    // 2. Duplicate payables
    await expect(
      pool.query(`
        SELECT create_statement('combined_card', $1::date, 'manual_total', null, null, 100, ARRAY[$2::uuid, $2::uuid], null, $3::uuid)
      `, [testMonth, PAYABLE_VISA_ID, OWNER_ID])
    ).rejects.toThrow('422 duplicate_payable_ids');

    // 3. Negative total
    await expect(
      pool.query(`
        SELECT create_statement('single_payable', $1::date, 'manual_total', null, null, -500, ARRAY[$2::uuid], null, $3::uuid)
      `, [testMonth, PAYABLE_VAT_ID, OWNER_ID])
    ).rejects.toThrow('422 statement_total_must_be_non_negative');

    // 4. Single payable kind with multiple payables
    await expect(
      pool.query(`
        SELECT create_statement('single_payable', $1::date, 'manual_total', null, null, 100, ARRAY[$2::uuid, $3::uuid], null, $4::uuid)
      `, [testMonth, PAYABLE_VISA_ID, PAYABLE_MC_ID, OWNER_ID])
    ).rejects.toThrow('422 single_payable_requires_exactly_one_payable');
  });

  it('Test Role Gates: close_month and approve_settlement_overpayment reject non-owner actors', async () => {
    const testMonth = '2027-12-01';
    // Admin attempting to close month -> raises 403
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, ADMIN_ID])
    ).rejects.toThrow('403 unauthorized');

    // Staff attempting to close month -> raises 403
    await expect(
      pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, STAFF_ID])
    ).rejects.toThrow('403 unauthorized');

    // Admin attempting to approve overpayment -> raises 403
    await expect(
      pool.query("SELECT approve_settlement_overpayment(gen_random_uuid(), 'Admin reason', $1::uuid)", [ADMIN_ID])
    ).rejects.toThrow('403 unauthorized');
  });

  it('Test Closed Month Payment Guard: rejects reversals or excess payments on closed months', async () => {
    const testMonth = '2026-01-01';
    await pool.query('SELECT generate_monthly_settlements($1::date)', [testMonth]);

    const setRes = await pool.query("SELECT id FROM settlements WHERE month = $1 AND payable_id = $2", [testMonth, PAYABLE_VAT_ID]);
    const settlementId = setRes.rows[0].id;

    // Close month
    await pool.query("SELECT close_month($1::date, $2::uuid)", [testMonth, OWNER_ID]);

    // Payment exceeding expected (0) on closed month raises 422 month_closed
    await expect(
      pool.query(`
        SELECT record_settlement_payment(
          $1::uuid, 1000, $2::date, 'CLOSED-TEST', null, 'Closed month payment', false, null, $3::uuid
        )
      `, [settlementId, testMonth, OWNER_ID])
    ).rejects.toThrow('422 month_closed');
  });
});
