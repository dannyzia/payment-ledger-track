import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';

const { Pool } = pg;

describe('Core Database Procedures, Sync Push Engine, and Concurrency Tests', () => {
  let pool: pg.Pool;

  // Actor IDs are shared with tests/db/schema.test.ts because audit_log.actor
  // has an FK to profiles and append-only audit rows pin those profiles forever:
  // suites must upsert profile roles, never delete users.
  const OWNER_ID = '11111111-1111-1111-1111-111111111111';
  const ADMIN_ID = '11111111-1111-1111-1111-111111111120';
  const STAFF_ID = '11111111-1111-1111-1111-111111111112';
  const METHOD_BKASH_ID = '10000000-0000-0000-0000-000000000001';
  const METHOD_CASH_ID = '10000000-0000-0000-0000-000000000002';
  const RATE_PROFILE_V1_ID = '20000000-0000-0000-0000-000000000001';
  const DEVICE_ID = 'd0000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await ensureTestDatabase();
    pool = new Pool({ connectionString: testDatabaseUrl() });

    // Clean teardown and deterministic setup of test fixtures
    await pool.query(`
      -- Clean previous test entries and sync_ops. A dirty re-run leaves a
      -- PUBLISHED rate profile whose immutability triggers block re-seeding;
      -- this suite owns the throwaway test database, so
      -- disable those two triggers for the cleanup as postgres, then re-enable.
      -- Generic cleanup: this suite owns the throwaway test database;
      -- wipe financial rows (incl. leftovers from other suites) so seeding is
      -- deterministic. audit_log rows are intentionally kept (Rule 5).
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

      -- Baseline auth.users and profiles
      INSERT INTO auth.users (id, email) VALUES
        ('${OWNER_ID}', 'owner@cosmo.local'),
        ('${ADMIN_ID}', 'admin@cosmo.local'),
        ('${STAFF_ID}', 'staff@cosmo.local')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO profiles (id, full_name, role, active) VALUES
        ('${OWNER_ID}', 'Zia Owner', 'owner', true),
        ('${ADMIN_ID}', 'Admin User', 'admin', true),
        ('${STAFF_ID}', 'Staff User', 'staff', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = EXCLUDED.active;

      -- Baseline payment methods initially inactive to avoid chicken-and-egg trigger crash
      INSERT INTO payment_methods (id, code, name, requires_txn_ref, active, sort_order) VALUES
        ('${METHOD_BKASH_ID}', 'bkash', 'bKash', true, false, 1),
        ('${METHOD_CASH_ID}', 'cash', 'Cash', false, false, 2)
      ON CONFLICT (id) DO NOTHING;

      -- Baseline published rate profile v1 (seeded as draft first, method rates added, then published)
      INSERT INTO rate_profiles (
        id, version, effective_from, status, vat_mode, vat_bp,
        commission_base, commission_bp, charges_borne_by, created_by
      ) VALUES (
        '${RATE_PROFILE_V1_ID}', 1, '2026-01-01', 'draft', 'manual', 0,
        'gross_minus_vat', 4200, 'business', '${OWNER_ID}'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO method_rates (rate_profile_id, method_id, charge_bp) VALUES
        ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 115),
        ('${RATE_PROFILE_V1_ID}', '${METHOD_CASH_ID}', 0)
      ON CONFLICT (rate_profile_id, method_id) DO NOTHING;

      UPDATE rate_profiles set status = 'published' where id = '${RATE_PROFILE_V1_ID}';
      UPDATE payment_methods set active = true where id in ('${METHOD_BKASH_ID}', '${METHOD_CASH_ID}');

      -- Register initial device presence (last_rate_version is NOT NULL)
      INSERT INTO devices (device_id, user_id, device_name, last_rate_version, revoked, last_seen_at) VALUES
        ('${DEVICE_ID}', '${STAFF_ID}', 'Test Device', 1, false, now())
      ON CONFLICT (device_id, user_id) DO UPDATE SET revoked = false;
    `);
  }, 180_000);

  afterAll(async () => {
    // Teardown test artifacts in reverse FK order. Entries are append-only via
    // trigger; cleanup is allowed to bypass it (this suite owns the throwaway test database).
    await pool.query(`
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      -- audit_log is append-only (Rule 5): test rows are left in place.
      ALTER TABLE settlement_payments DISABLE TRIGGER trg_settlement_payments_immutable;
                  DELETE FROM settlement_payments WHERE settlement_id IN (SELECT id FROM settlements WHERE month = '2026-10-01');
      ALTER TABLE settlement_payments ENABLE TRIGGER trg_settlement_payments_immutable;
      DELETE FROM settlements WHERE month = '2026-10-01';
      DELETE FROM sync_ops WHERE actor_id in ('${OWNER_ID}', '${ADMIN_ID}', '${STAFF_ID}');
      DELETE FROM entries WHERE created_by in ('${OWNER_ID}', '${ADMIN_ID}', '${STAFF_ID}');
      DELETE FROM devices WHERE device_id = '${DEVICE_ID}';
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
    `);
    await pool.end();
  });

  it('Test #1: Forged Snapshot Rejection (PRD §6.5, §16.2 Test #1)', async () => {
    const opId = 'a0000001-0000-0000-0000-000000000001';
    const entryId = 'b0000001-0000-0000-0000-000000000001';

    // Client attempts to forge lower chargeBp (100 instead of DB's 115)
    const forgedSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 100, // Forged lower rate
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const pushPayload = [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName: 'Customer Test 1',
          methodId: METHOD_BKASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '1000',
          businessChargePoisha: '1000',
          customerChargePoisha: '0',
          netPoisha: '57000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: forgedSnapshot,
          txnRef: 'TXN-FORGED-01',
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(pushPayload),
    ]);

    const result = res.rows[0].result;
    expect(result.results[0].status).toBe('rejected');
    expect(result.results[0].reason).toBe('invalid_snapshot_rules');

    // Assert audit log captures calc mismatch
    const auditRes = await pool.query(
      "SELECT count(*) FROM audit_log WHERE action = 'sync.calc_mismatch' AND target_id = $1",
      [opId],
    );
    expect(parseInt(auditRes.rows[0].count)).toBeGreaterThan(0);
  });

  it('Test #2: Commit-Order Sequence Race Immunity (PRD §7.2, §16.2 Test #2)', async () => {
    // Two concurrent transactions allocate entries; pg_advisory_xact_lock(1002, 1) strictly serializes them
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    const opId1 = 'a0000002-0000-0000-0000-000000000001';
    const entryId1 = 'b0000002-0000-0000-0000-000000000001';
    const opId2 = 'a0000002-0000-0000-0000-000000000002';
    const entryId2 = 'b0000002-0000-0000-0000-000000000002';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 115,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const makeOp = (opId: string, entryId: string, txnRef: string) => [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName: 'Concurrent Customer',
          methodId: METHOD_BKASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '1150',
          businessChargePoisha: '1150',
          customerChargePoisha: '0',
          netPoisha: '56850',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
          txnRef,
        },
      },
    ];

    try {
      const [res1, res2] = await Promise.all([
        client1.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
          DEVICE_ID,
          STAFF_ID,
          'staff',
          JSON.stringify(makeOp(opId1, entryId1, 'TXN-CONC-01')),
        ]),
        client2.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
          DEVICE_ID,
          STAFF_ID,
          'staff',
          JSON.stringify(makeOp(opId2, entryId2, 'TXN-CONC-02')),
        ]),
      ]);

      expect(res1.rows[0].result.results[0].status).toBe('ok');
      expect(res2.rows[0].result.results[0].status).toBe('ok');

      // Verify sequence monotonicity without gaps
      const seqRes = await pool.query(
        'SELECT server_seq, id FROM entries WHERE id IN ($1, $2) ORDER BY server_seq ASC',
        [entryId1, entryId2],
      );

      const seqs = seqRes.rows.map((r) => BigInt(r.server_seq));
      expect(seqs.length).toBe(2);
      expect(seqs[1] - seqs[0]).toBe(1n);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('Test #8: Concurrent Supersedes Serialization (PRD §7.3, §16.2 Test #8)', async () => {
    const origId = 'b0000008-0000-0000-0000-000000000000';
    const rep1Id = 'b0000008-0000-0000-0000-000000000001';
    const rep2Id = 'b0000008-0000-0000-0000-000000000002';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Insert active baseline entry to supersede
    await pool.query(`
      INSERT INTO entries (
        id, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, status
      ) VALUES (
        '${origId}', '2026-10-15', 'Original Entry', '${METHOD_CASH_ID}', 100000,
        '${RATE_PROFILE_V1_ID}', '${JSON.stringify(validSnapshot)}'::jsonb, 0, 0, 42000, 0,
        0, 0, 58000, '${STAFF_ID}', 'active'
      )
    `);

    const makeReplacement = (id: string) => ({
      id,
      entryDate: '2026-10-16',
      customerName: 'Replacement Entry',
      methodId: METHOD_CASH_ID,
      grossPoisha: '100000',
      vatPoisha: '0',
      vatInputPoisha: '0',
      commissionPoisha: '42000',
      chargePoisha: '0',
      businessChargePoisha: '0',
      customerChargePoisha: '0',
      netPoisha: '58000',
      rateProfileId: RATE_PROFILE_V1_ID,
      snapshot: validSnapshot,
      reassignReason: 'Correction of original note',
    });

    const c1 = await pool.connect();
    const c2 = await pool.connect();

    try {
      const results = await Promise.allSettled([
        c1.query('SELECT rpc_supersede_entry($1, $2, $3) as res', [
          origId,
          JSON.stringify(makeReplacement(rep1Id)),
          ADMIN_ID,
        ]),
        c2.query('SELECT rpc_supersede_entry($1, $2, $3) as res', [
          origId,
          JSON.stringify(makeReplacement(rep2Id)),
          ADMIN_ID,
        ]),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      // @ts-expect-error reason is unknown in PromiseRejectedResult
      expect(rejected[0].reason.message).toContain('cannot_supersede_non_active');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('Test #14: Rate Profile Draft-Publish Immutability Lock (PRD §7.1, §16.2 Test #14)', async () => {
    // UPDATE on published profile must be rejected
    await expect(
      pool.query(
        `UPDATE rate_profiles SET commission_bp = 5000 WHERE id = '${RATE_PROFILE_V1_ID}'`,
      ),
    ).rejects.toThrow('published_rate_profile_immutable');

    // Method rate insertion into published profile must be rejected
    await expect(
      pool.query(`
       INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
        VALUES ('${RATE_PROFILE_V1_ID}', '${METHOD_BKASH_ID}', 200)
      `),
    ).rejects.toThrow('method_rates_published_profile_immutable');
  });

  it('Test #15 & #44: Atomic Ownership Transfer & Demote-Before-Promote Order (PRD §7.3, §16.2 Test #15, #44)', async () => {
    // Attempt transfer to non-admin staff member must be rejected
    await expect(
      pool.query('SELECT transfer_ownership($1, $2)', [STAFF_ID, OWNER_ID]),
    ).rejects.toThrow('target_user_must_be_admin');

    // Transfer ownership to Admin
    await pool.query('SELECT transfer_ownership($1, $2)', [ADMIN_ID, OWNER_ID]);

    const res = await pool.query('SELECT id, role, active FROM profiles WHERE id in ($1, $2)', [
      OWNER_ID,
      ADMIN_ID,
    ]);
    const roles = Object.fromEntries(res.rows.map((r) => [r.id, r.role]));

    expect(roles[ADMIN_ID]).toBe('owner');
    expect(roles[OWNER_ID]).toBe('admin');

    // Transfer back to Zia for subsequent tests
    await pool.query('SELECT transfer_ownership($1, $2)', [OWNER_ID, ADMIN_ID]);
  });

  it('Test #18: Discard Authorization and Provenance (PRD §9.1, §16.2 Test #18)', async () => {
    const rejectedOpId = 'a0000018-0000-0000-0000-000000000001';
    await pool.query(`
      INSERT INTO sync_ops (op_id, actor_id, device_id, op_type, payload, payload_hash, client_created_at, result, resolution_status)
      VALUES ('${rejectedOpId}', '${STAFF_ID}', '${DEVICE_ID}', 'create_entry', '{}'::jsonb, 'hash', now(), 'rejected', 'pending')
    `);

    const discardOp = [
      {
        opId: 'a0000018-0000-0000-0000-000000000002',
        type: 'discard_rejected_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          rejectedOpId,
          reason: 'Duplicate entry submitted in error',
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(discardOp),
    ]);
    expect(res.rows[0].result.results[0].status).toBe('ok');

    const opRes = await pool.query('SELECT resolution_status FROM sync_ops WHERE op_id = $1', [
      rejectedOpId,
    ]);
    expect(opRes.rows[0].resolution_status).toBe('discarded');
  });

  it('Test #24: Batch Subtransaction Fault Isolation in rpc_push_sync_op (PRD §9.1, §16.2 Test #24)', async () => {
    const validOpId = 'a0000024-0000-0000-0000-000000000001';
    const validEntryId = 'b0000024-0000-0000-0000-000000000001';
    const invalidOpId = 'a0000024-0000-0000-0000-000000000002';
    const invalidEntryId = 'b0000024-0000-0000-0000-000000000002';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const batch = [
      {
        opId: validOpId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: validEntryId,
          entryDate: '2026-10-15',
          customerName: 'Valid Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
      {
        opId: invalidOpId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: invalidEntryId,
          entryDate: '2026-10-15',
          customerName: 'Invalid Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '99999', // Arithmetic mismatch violation
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(batch),
    ]);

    const results = res.rows[0].result.results;
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('rejected');
    expect(results[1].reason).toBe('calc_mismatch');

    // Verify valid entry committed to database
    const entryCheck = await pool.query('SELECT id FROM entries WHERE id = $1', [validEntryId]);
    expect(entryCheck.rows.length).toBe(1);
  });

  it('Test #31: Cross-Concurrency Lock Inversion Deadlock Immunity (PRD §7.2, §16.2 Test #31)', async () => {
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Client 1 touches 2026-10 then 2026-11
    const op1 = [
      {
        opId: 'a0000031-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000001',
          entryDate: '2026-10-10',
          customerName: 'Oct Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
      {
        opId: 'a0000031-0000-0000-0000-000000000002',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000002',
          entryDate: '2026-11-10',
          customerName: 'Nov Customer',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    // Client 2 touches 2026-11 then 2026-10
    const op2 = [
      {
        opId: 'a0000031-0000-0000-0000-000000000003',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000003',
          entryDate: '2026-11-15',
          customerName: 'Nov Customer 2',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
      {
        opId: 'a0000031-0000-0000-0000-000000000004',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000031-0000-0000-0000-000000000004',
          entryDate: '2026-10-20',
          customerName: 'Oct Customer 2',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    try {
      const [res1, res2] = await Promise.all([
        c1.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
          DEVICE_ID,
          STAFF_ID,
          'staff',
          JSON.stringify(op1),
        ]),
        c2.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
          DEVICE_ID,
          STAFF_ID,
          'staff',
          JSON.stringify(op2),
        ]),
      ]);

      expect(res1.rows[0].result.results[0].status).toBe('ok');
      expect(res2.rows[0].result.results[0].status).toBe('ok');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('Test #32: Supersede Non-Active Rejection (PRD §7.3, §16.2 Test #32)', async () => {
    const entryId = 'b0000032-0000-0000-0000-000000000001';
    const rep1Id = 'b0000032-0000-0000-0000-000000000002';
    const rep2Id = 'b0000032-0000-0000-0000-000000000003';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Insert active entry
    await pool.query(`
      INSERT INTO entries (
        id, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by, status
      ) VALUES (
        '${entryId}', '2026-10-15', 'Original Entry', '${METHOD_CASH_ID}', 100000,
        '${RATE_PROFILE_V1_ID}', '${JSON.stringify(validSnapshot)}'::jsonb, 0, 0, 42000, 0,
        0, 0, 58000, '${STAFF_ID}', 'active'
      )
    `);

    const replacement = (id: string) => ({
      id,
      entryDate: '2026-10-16',
      customerName: 'Replacement',
      methodId: METHOD_CASH_ID,
      grossPoisha: '100000',
      vatPoisha: '0',
      vatInputPoisha: '0',
      commissionPoisha: '42000',
      chargePoisha: '0',
      businessChargePoisha: '0',
      customerChargePoisha: '0',
      netPoisha: '58000',
      rateProfileId: RATE_PROFILE_V1_ID,
      snapshot: validSnapshot,
      reassignReason: 'Correction of original entry',
    });

    // First supersede succeeds
    await pool.query('SELECT rpc_supersede_entry($1, $2, $3)', [
      entryId,
      JSON.stringify(replacement(rep1Id)),
      ADMIN_ID,
    ]);

    // Second supersede against already superseded entry must be rejected
    await expect(
      pool.query('SELECT rpc_supersede_entry($1, $2, $3)', [
        entryId,
        JSON.stringify(replacement(rep2Id)),
        ADMIN_ID,
      ]),
    ).rejects.toThrow('cannot_supersede_non_active');
  });

  it('Test #41: Anti-Cherry-Picking Watermark & Deduction Guard Rejection (PRD §7.3, §9.1, §16.2 Test #41)', async () => {
    // 1. Deduction Guard Rejection (> 100% total deductions rejected at publish time)
    const excessiveProfileId = '20000000-0000-0000-0000-000000000099';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_base, commission_bp, created_by)
      VALUES ('${excessiveProfileId}', 99, 'draft', '2026-12-01', 'percent_of_gross', 1500, 'gross', 4500, '${ADMIN_ID}');
     INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
      VALUES
        ('${excessiveProfileId}', '${METHOD_BKASH_ID}', 4500),
        ('${excessiveProfileId}', '${METHOD_CASH_ID}', 0);
    `);

    // 1500 (VAT) + 4500 (Comm) + 4500 (bKash) = 10500 bp = 105% > 100%
    await expect(
      pool.query('SELECT publish_rate_profile($1, $2)', [excessiveProfileId, ADMIN_ID]),
    ).rejects.toThrow('deductions_exceed_100_percent');

    // 2. Anti-Cherry-Picking: client knows newer profile v2 but submits older profile v1
    const profileV2Id = '20000000-0000-0000-0000-000000000002';
    await pool.query(`
      INSERT INTO rate_profiles (id, version, status, effective_from, vat_mode, vat_bp, commission_base, commission_bp, created_by)
      VALUES ('${profileV2Id}', 2, 'draft', '2026-10-01', 'manual', 0, 'gross_minus_vat', 4000, '${ADMIN_ID}');
     INSERT INTO method_rates (rate_profile_id, method_id, charge_bp)
      VALUES
        ('${profileV2Id}', '${METHOD_BKASH_ID}', 115),
        ('${profileV2Id}', '${METHOD_CASH_ID}', 0);
      UPDATE rate_profiles SET status = 'published' WHERE id = '${profileV2Id}';
    `);

    const validSnapshotV1 = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Client watermark is 2, but client attempts to submit under Profile v1 for an Oct 15 entry
    const cherryPickOp = [
      {
        opId: 'a0000041-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 2,
        payload: {
          id: 'b0000041-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'Cherry Picker',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshotV1,
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(cherryPickOp),
    ]);
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('rate_profile_date_mismatch');
  });

  it('Test #56: Engine Version Skew Enforcement (PRD §9.1, §16.2 Test #56)', async () => {
    const skewedSnapshot = {
      version: 1,
      engineVersion: 999, // Incompatible engine version
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const op = [
      {
        opId: 'a0000056-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000056-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'Skew Client',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: skewedSnapshot,
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(op),
    ]);
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('upgrade_required');
  });

  it('Test #57: >৳50,000 Stale-Rate Review Workflow (PRD §7.3, §16.2 Test #57)', async () => {
    const entryId = 'b0000057-0000-0000-0000-000000000001';
    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    // Seed flagged entry over 50k BDT (6,000,000 poisha = 60,000 BDT)
    await pool.query(`
      INSERT INTO entries (
        id, entry_date, customer_name, method_id, gross_poisha,
        rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha, charge_poisha,
        business_charge_poisha, customer_charge_poisha, net_poisha, created_by,
        status, stale_rates, stale_review_status
      ) VALUES (
        '${entryId}', '2026-10-15', 'High Value Customer', '${METHOD_CASH_ID}', 6000000,
        '${RATE_PROFILE_V1_ID}', '${JSON.stringify(validSnapshot)}'::jsonb, 0, 0, 2520000, 0,
        0, 0, 3480000, '${STAFF_ID}', 'active', true, 'flagged'
      )
    `);

    // Admin approves stale review
    const approveRes = await pool.query('SELECT admin_review_stale_entry($1, $2, $3) as res', [
      entryId,
      'approved',
      ADMIN_ID,
    ]);
    expect(approveRes.rows[0].res.status).toBe('approved');

    const entryRes = await pool.query(
      'SELECT stale_review_status, stale_reviewed_by FROM entries WHERE id = $1',
      [entryId],
    );
    expect(entryRes.rows[0].stale_review_status).toBe('approved');
    expect(entryRes.rows[0].stale_reviewed_by).toBe(ADMIN_ID);

    // Verify audit log
    const auditRes = await pool.query(
      "SELECT count(*) FROM audit_log WHERE action = 'entry.stale_review_approve' AND target_id = $1",
      [entryId],
    );
    expect(parseInt(auditRes.rows[0].count)).toBeGreaterThan(0);
  });

  it('Test #59: User Provisioning & Privilege Defense (PRD §7.3, §16.2 Test #59)', async () => {
    const newUserId = '00000000-0000-0000-0000-000000000059';

    // Insert user with forged raw_user_meta_data role: 'owner'
    await pool.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${newUserId}', 'hacker@cosmo.local', '{"role": "owner"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);

    // Verify trigger forced profile role to staff
    const profileRes = await pool.query('SELECT role FROM profiles WHERE id = $1', [newUserId]);
    expect(profileRes.rows[0].role).toBe('staff');

    // Verify admin_invite_user blocks inviting an owner
    await expect(
      pool.query('SELECT admin_invite_user($1, $2, $3, $4)', [
        'newowner@cosmo.local',
        'owner',
        'New Owner',
        OWNER_ID,
      ]),
    ).rejects.toThrow('cannot_invite_owner');
  });

  it('Test #60: Mandatory Rate Watermark Enforcement (PRD §9.1, §16.2 Test #60)', async () => {
    const op = [
      {
        opId: 'a0000060-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        // maxKnownRateVersion omitted
        payload: {
          id: 'b0000060-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'No Watermark',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: {
            version: 1,
            engineVersion: 1,
            vatMode: 'manual',
            vatBp: 0,
            commissionBp: 4200,
            commissionBase: 'gross_minus_vat',
            methodFeeBp: 0,
            chargesBorneBy: 'business',
            rateProfileId: RATE_PROFILE_V1_ID,
          },
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(op),
    ]);
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('missing_rate_watermark');
  });

  it('Test #61: Entry-ID Push Idempotency and Tamper Conflict (PRD §9.1, §16.2 Test #61)', async () => {
    const opId = 'a0000061-0000-0000-0000-000000000001';
    const entryId = 'b0000061-0000-0000-0000-000000000001';

    const validSnapshot = {
      version: 1,
      engineVersion: 1,
      vatMode: 'manual',
      vatBp: 0,
      commissionBp: 4200,
      commissionBase: 'gross_minus_vat',
      methodFeeBp: 0,
      chargesBorneBy: 'business',
      rateProfileId: RATE_PROFILE_V1_ID,
    };

    const makeOp = (customerName: string) => [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        serverHash: 'hash-v1',
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName,
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    // Initial push succeeds
    const res1 = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(makeOp('Original Customer')),
    ]);
    expect(res1.rows[0].result.results[0].status).toBe('ok');

    // Replay identical push: returns duplicate with sequence numbers
    const res2 = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(makeOp('Original Customer')),
    ]);
    expect(res2.rows[0].result.results[0].status).toBe('duplicate');
    expect(res2.rows[0].result.results[0].server_seq).toBeDefined();
    expect(res2.rows[0].result.results[0].entry_number).toBeDefined();

    // Replay with tampered payload: returns rejected with op_id_conflict_tampered
    const tamperedOp = [
      {
        opId,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        serverHash: 'tampered-hash',
        payload: {
          id: entryId,
          entryDate: '2026-10-15',
          customerName: 'Tampered Customer Name',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: validSnapshot,
        },
      },
    ];

    const res3 = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(tamperedOp),
    ]);
    expect(res3.rows[0].result.results[0].status).toBe('rejected');
    expect(res3.rows[0].result.results[0].reason).toBe('op_id_conflict_tampered');

    // Verify tamper audit event was logged
    const auditRes = await pool.query(
      "SELECT count(*) FROM audit_log WHERE action = 'security.tamper_detected' AND target_id = $1",
      [opId],
    );
    expect(parseInt(auditRes.rows[0].count)).toBeGreaterThan(0);
  });

  it('Test #62: Multi-User Shared Device Presence & Global Killswitch (PRD §7.3, §9.1, §16.2 Test #62)', async () => {
    // Admin revokes device
    await pool.query('SELECT admin_manage_device($1, $2, $3)', [DEVICE_ID, 'revoke', ADMIN_ID]);

    const op = [
      {
        opId: 'a0000062-0000-0000-0000-000000000001',
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: {
          id: 'b0000062-0000-0000-0000-000000000001',
          entryDate: '2026-10-15',
          customerName: 'Revoked Device Push',
          methodId: METHOD_CASH_ID,
          grossPoisha: '100000',
          vatPoisha: '0',
          vatInputPoisha: '0',
          commissionPoisha: '42000',
          chargePoisha: '0',
          businessChargePoisha: '0',
          customerChargePoisha: '0',
          netPoisha: '58000',
          rateProfileId: RATE_PROFILE_V1_ID,
          snapshot: {
            version: 1,
            engineVersion: 1,
            vatMode: 'manual',
            vatBp: 0,
            commissionBp: 4200,
            commissionBase: 'gross_minus_vat',
            methodFeeBp: 0,
            chargesBorneBy: 'business',
            rateProfileId: RATE_PROFILE_V1_ID,
          },
        },
      },
    ];

    const res = await pool.query('SELECT rpc_push_sync_op($1, $2, $3, $4) as result', [
      DEVICE_ID,
      STAFF_ID,
      'staff',
      JSON.stringify(op),
    ]);
    expect(res.rows[0].result.results[0].status).toBe('rejected');
    expect(res.rows[0].result.results[0].reason).toBe('device_revoked');

    // Unrevoke for clean state
    await pool.query('SELECT admin_manage_device($1, $2, $3)', [DEVICE_ID, 'unrevoke', ADMIN_ID]);
  });

  it('Test #63: Deactivated User Re-Invite Guard & Privilege Escalation Defense (PRD §7.3, §16.2 Test #63)', async () => {
    const deactAdminId = '00000000-0000-0000-0000-000000000063';
    await pool.query(`
      INSERT INTO auth.users (id, email) VALUES ('${deactAdminId}', 'deactadmin@cosmo.local') ON CONFLICT (id) DO NOTHING;
      INSERT INTO profiles (id, full_name, role, active) VALUES ('${deactAdminId}', 'Deactivated Admin', 'admin', false)
      ON CONFLICT (id) DO UPDATE SET active = false, role = 'admin';
    `);

    // Another Admin cannot reactivate an Admin account
    await expect(
      pool.query('SELECT admin_invite_user($1, $2, $3, $4)', [
        'deactadmin@cosmo.local',
        'admin',
        'Deactivated Admin',
        ADMIN_ID,
      ]),
    ).rejects.toThrow('unauthorized');

    // Owner can reactivate the Admin account
    await pool.query('SELECT admin_invite_user($1, $2, $3, $4)', [
      'deactadmin@cosmo.local',
      'admin',
      'Reactivated Admin',
      OWNER_ID,
    ]);

    const res = await pool.query('SELECT active, role FROM profiles WHERE id = $1', [deactAdminId]);
    expect(res.rows[0].active).toBe(true);
    expect(res.rows[0].role).toBe('admin');
  });
});
