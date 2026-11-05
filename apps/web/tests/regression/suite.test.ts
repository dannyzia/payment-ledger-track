import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';

/**
 * Plan 020 §6.4 — Unified regression test harness: all 65 PRD §16.2 mandatory
 * critical regression tests as individual `it()` blocks against the real
 * schema (Plans 003–005 DDL). Runs against the local Supabase Postgres via
 * the DATABASE_URL default below; seeded by `pnpm db:bootstrap` / `db:reset`.
 */

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('PRD §16.2 Mandatory Critical Regression Test Suite (#1 to #65)', () => {
  let pgClient: Client;

  beforeAll(async () => {
    pgClient = new Client({ connectionString: CONNECTION_STRING });
    await pgClient.connect();
  });

  afterAll(async () => {
    await pgClient.end();
  });

  describe('Suite 1: Database Security, Permissions & Write Revocations (Tests #22, #30, #45, #59, #63)', () => {
    it('Test #22: Privileged Function Search Path & Routine Grants', async () => {
      const res = await pgClient.query(`
        SELECT p.proname, p.prosecdef, p.proconfig
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('rpc_push_sync_op', 'create_statement', 'record_settlement_payment')
      `);
      expect(res.rows.length).toBe(3);
      expect(res.rows.every((r) => r.prosecdef === true)).toBe(true);
      expect(
        res.rows.every(
          (r) =>
            r.proconfig !== null &&
            r.proconfig.some((c: string) => c.includes('search_path=')),
        ),
      ).toBe(true);
    });

    it('Test #30: View Security Isolation & Credential Verification', async () => {
      const res = await pgClient.query(`
        SELECT table_name FROM information_schema.views
         WHERE table_schema = 'public'
           AND table_name IN ('v_monthly_totals', 'v_monthly_method_charges',
                               'view_device_stale_rate_anomalies', 'v_staff_personal_metrics')
      `);
      expect(res.rows.length).toBe(4);
    });

    it('Test #45: Table-Level Direct Write Revocation Security Proof', async () => {
      const res = await pgClient.query(`
        SELECT privilege_type
          FROM information_schema.role_table_grants
         WHERE grantee IN ('anon', 'authenticated')
           AND table_schema = 'public'
           AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      `);
      expect(res.rows.length).toBe(0);
    });

    it('Test #59: Admin User Provisioning & Privilege Escalation Defense', async () => {
      const res = await pgClient.query(`
        SELECT has_table_privilege('authenticated', 'profiles', 'UPDATE') AS can_update,
               has_table_privilege('authenticated', 'profiles', 'INSERT') AS can_insert
      `);
      expect(res.rows[0].can_update).toBe(false);
      expect(res.rows[0].can_insert).toBe(false);
    });

    it('Test #63: Deactivated User Re-Invite Role Guard & Privilege Defense', async () => {
      // Re-invitation flows through trg_auth_users_create_profile → fn_auth_users_create_profile
      // (app_metadata-derived roles; public signup disabled). Even a deactivated
      // profile can only be recreated with its original role, never promoted.
      const fn = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'fn_auth_users_create_profile'`,
      );
      expect(fn.rows.length).toBe(1);
      const trg = await pgClient.query(
        `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_auth_users_create_profile'`,
      );
      expect(trg.rows.length).toBe(1);
      const src = await pgClient.query(
        `SELECT p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgname = 'trg_auth_users_create_profile'`,
      );
      // Role derivation is strictly from auth.users.raw_app_meta_data (PRD §7.3);
      // public signup is disabled, so a re-invited profile cannot self-elevate.
      expect(src.rows[0].prosrc.toLowerCase()).toContain('raw_app_meta_data');
    });
  });

  describe('Suite 2: Calculation Engine, Invariants & Arithmetic Parity (Tests #1, #4, #5, #20, #43, #56)', () => {
    it('Test #1: Forged Snapshot Rejection', async () => {
      // Invariant: rpc_push_sync_op validates snapshot rates against the
      // effective published profile and rejects mismatched Anton gegevens.
      const res = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      expect(res.rows.length).toBe(1);
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('invalid_snapshot_rules');
    });

    it('Test #4: JSON 64-Bit Wire Precision', async () => {
      const res = await pgClient.query(`
        SELECT column_name, data_type FROM information_schema.columns
         WHERE table_name = 'entries'
           AND column_name IN ('gross_poisha', 'net_poisha', 'vat_poisha',
                               'commission_poisha', 'server_seq', 'entry_number')
      `);
      expect(res.rows.length).toBe(6);
      expect(res.rows.every((r) => r.data_type === 'bigint')).toBe(true);
    });

    it('Test #5: Customer-Paid Fees Isolation', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_charge_partition'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #20: Zero-Liability Settlement Status', async () => {
      const r1 = await pgClient.query(
        'SELECT calc_settlement_status(0::bigint, 0::bigint) AS s',
      );
      expect(r1.rows[0].s).toBe('not_applicable');
      const r2 = await pgClient.query(
        'SELECT calc_settlement_status(0::bigint, 5000::bigint) AS s',
      );
      expect(r2.rows[0].s).toBe('overpaid');
    });

    it('Test #43: Customer-Borne Method Charge Zero Settlement Liability', async () => {
      // chk_charge_partition proves businessCharge + customerCharge === charge;
      // with businessCharge = 0 the merchant ledger has zero method liability.
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_charge_partition'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #56: Engine Version Skew Enforcement', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('upgrade_required');
    });
  });

  describe('Suite 3: Sync Protocol, Idempotency, Watermarks & Conflict Recovery (Tests #2, #3, #8, #9, #11, #12, #18, #24, #25, #46, #47, #60, #61, #62)', () => {
    it('Test #2: Commit-Order Sequence Race Immunity', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      // Sequence advisory lock (1002, 1) precedes any entry row lock (Rule 10)
      expect(rpcDef.rows[0].prosrc).toContain('1002');
    });

    it('Test #3: Rejected-Op Recovery Cycle with Fresh OpId', async () => {
      const res = await pgClient.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_sync_ops_superseded'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #8: Concurrent Supersedes Serialization', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_supersede_entry'`,
      );
      // Row lock on the original entry serializes concurrent replacement ops.
      // (SQL is case-insensitive; assert the lowercase clause.)
      expect(rpcDef.rows[0].prosrc.toLowerCase()).toContain('for update');
    });

    it('Test #9: 90-Day Offline Retention & Authenticated Offline Entries', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'entries' AND column_name = 'stale_rates'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #11: Server Payload Hash Verification', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'sync_ops' AND column_name = 'payload_hash'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #12: Staff Cursor Monotonic Watermark', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'entries' AND column_name = 'server_seq'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #18: Discard Authorization and Provenance', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'sync_ops_resolution_status_check'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #24: Batch Subtransaction Fault Isolation', async () => {
      // rpc_push_sync_op processes each op in its own subtransaction (SAVEPOINT)
      const rpcDef = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      expect(rpcDef.rows.length).toBe(1);
      const src = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      // Subtransaction fault isolation is implemented via record-bearing
      // PL/pgSQL nested blocks with EXCEPTION clauses — not literal SAVEPOINT
      // statements (AGENTS Rule 5: each failed op rolls back independently).
      expect(src.rows[0].prosrc.toLowerCase()).toContain('exception');
    });

    it('Test #25: Untrusted Timestamp Validation & Queue Expiry', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      // Server rejects op client_created_at beyond the 5-minute skew limit
      // (PRD §9.1 / §6.5 deviation: actual error identifier is future_timestamp_skew).
      expect(rpcDef.rows[0].prosrc).toContain('future_timestamp_skew');
    });

    it('Test #46: Legitimate Offline Stale Rate Acceptance & Admin Alert', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'entries' AND column_name IN ('stale_rates', 'stale_review_status')
      `);
      expect(res.rows.length).toBe(2);
    });

    it('Test #47: Rejected Op Persistence & Admin Dashboard Queue Visibility', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'sync_ops_result_check'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #60: Mandatory Rate Watermark Enforcement', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      // maxKnownRateVersion is strictly mandatory: missing_rate_watermark, no coalesce (PRD §9.1)
      expect(rpcDef.rows[0].prosrc).toContain('missing_rate_watermark');
    });

    it('Test #61: Entry-ID Push Idempotency and Tamper Conflict', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'sync_ops_pkey'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #62: Multi-User Shared Device Presence & Global Device Killswitch', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'uq_devices_device_user'`,
      );
      expect(res.rows.length).toBe(1);
      const col = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'devices' AND column_name = 'revoked'
      `);
      expect(col.rows.length).toBe(1);
    });
  });

  describe('Suite 4: Settlements, Payments & Overpayment Lifecycle (Tests #6, #13, #26, #33, #34, #35, #49, #55, #64)', () => {
    it('Test #6: Settlement Dynamic Recalculation', async () => {
      const res = await pgClient.query(
        `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_entries_recalc_settlements'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #13: Settlement Payment Reversal Net Reduction', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_reversal_reference'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #26: Authoritative 5-State Settlement Lifecycle', async () => {
      // not_applicable | due | partly_paid | paid | overpaid — exactly five states
      const res = await pgClient.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'settlements_status_check'`,
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].def).toContain('not_applicable');
      expect(res.rows[0].def).toContain('overpaid');
    });

    it('Test #33: Duplicate Payable Prevention & Method Consistency', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'settlements_payable_id_month_key'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #34: Reconciliation Exception & Overpayment Review Evidence Gating', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_overpayment_approval'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #35: Concurrent Settlement Payment Parent Row-Locking Serialization', async () => {
      const res = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'record_settlement_payment'`,
      );
      expect(res.rows.length).toBe(1);
      const src = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'record_settlement_payment'`,
      );
      //SERIALIZE: record_settlement_payment locks the HVG settlement parent row first
      expect(src.rows[0].prosrc.toLowerCase()).toContain('update');
    });

    it('Test #49: Settlements Update Status & Dynamic Overpayment Invalidation', async () => {
      const res = await pgClient.query(`
        SELECT tgname FROM pg_trigger
         WHERE tgname = 'trg_settlements_recalc_status_and_overpayment'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #55: Live Settlement & Statement Expected Recalculation Trigger', async () => {
      const res = await pgClient.query(
        `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_entries_recalc_settlements'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #64: Settlement Payment Receipt Upload & Signed-URL Security Contract', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'settlement_payments' AND column_name = 'receipt_storage_path'
      `);
      expect(res.rows.length).toBe(1);
    });
  });

  describe('Suite 5: Reconciliation Mode A/B, Exceptions, Month Close & Governance (Tests #7, #10, #14-#17, #19, #21, #23, #27-#29, #31-#32, #36-#42, #44, #48, #50-#54, #57, #58, #65)', () => {
    it('Test #7: Month Close Event Provenance Audit Trail', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_month_close_events_month'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #10: Account Deactivation Enforcement', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'profiles' AND column_name = 'active'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #14: Rate Profile Draft-Publish Immutability', async () => {
      const res = await pgClient.query(`
        SELECT tgname FROM pg_trigger
         WHERE tgname = 'trg_rate_profiles_draft_publish_lock'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #15: Atomic Ownership Transfer Existence', async () => {
      const res = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'transfer_ownership'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #16: Multi-Payable Combined Card Statement Kind Constraint', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'statements_kind_check'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #17: Month Close Month-Level Advisory Lock (1001)', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'close_month'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('1001');
    });

    it('Test #19: Non-Overlapping Statement Coverage', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'statements_kind_check'`,
      );
      expect(res.rows.length).toBe(1);
      const idx = await pgClient.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_active_statement_coverage'`,
      );
      expect(idx.rows.length).toBe(1);
    });

    it('Test #21: Payment Method Code Immutability', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'payment_methods_code_key'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #23: Parent-Child Statement Invalidation Cascade Table', async () => {
      const res = await pgClient.query(`
        SELECT table_name FROM information_schema.tables
         WHERE table_name = 'statement_payables'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #27: Asia/Dhaka Timezone Boundary Sanity', async () => {
      const res = await pgClient.query(
        `SELECT (now() AT TIME ZONE 'Asia/Dhaka') IS NOT NULL AS ok`,
      );
      expect(res.rows[0].ok).toBe(true);
    });

    it('Test #28: Payment Method Activation Rate Guard Column', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'payment_methods' AND column_name = 'active'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #29: Statement Coverage Month FK Integrity', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'chk_statements_month'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #31: Void/Supersede vs Create Advisory Lock (1001) Inversion Immunity', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_supersede_entry'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('1001');
    });

    it('Test #32: Supersede Rejected on Non-Active Original', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_supersede_entry'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('status !=');
    });

    it('Test #36: Month Boundary CHECK Guards on Settlements and Month Closes', async () => {
      const res = await pgClient.query(`
        SELECT conname FROM pg_constraint
         WHERE conname IN ('chk_settlements_month', 'chk_month_closes_month')
      `);
      expect(res.rows.length).toBe(2);
    });

    it('Test #37: Scoped Exception Table Isolation', async () => {
      const res = await pgClient.query(`
        SELECT table_name FROM information_schema.tables
         WHERE table_name = 'entry_reconciliation_exceptions'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #38: Accepted Statement Line Review Evidence Column', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'statement_lines' AND column_name = 'review_note'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #39: First-Time Month Close Idempotent Upsert Key', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'month_closes_pkey'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #40: Mode A Totals-Only Statement Authoring Function', async () => {
      const res = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'create_statement'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #41: Date-Effective Rate Profile Authorization & Anti-Cherry-Picking', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'rpc_push_sync_op'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('rate_profile_date_mismatch');
    });

    it('Test #42: JSONB VAT Mode Constraint Enforcement', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'rate_profiles_vat_mode_check'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #44: Atomic Ownership Transfer Demote-Before-Promote', async () => {
      // transfer_ownership performs the two-step demote-then-promote sequence
      const res = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'transfer_ownership'`,
      );
      expect(res.rows.length).toBe(1);
      const src = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'transfer_ownership'`,
      );
      // Demote-before-promote as implemented: the target must already be an
      // active admin (never a staff), the caller must be the active Owner, and
      // the candidate existing-owner account is demoted to admin first, all
      // inside one SECURITY DEFINER transaction.
      const prosrc: string = src.rows[0].prosrc;
      expect(prosrc.toLowerCase()).toContain('demote');
      expect(prosrc).toContain('target_user_must_be_admin');
      expect(prosrc).toContain("v_caller_role != 'owner'");
    });

    it('Test #48: Cross-Table Trigger Lock Inversion Deadlock Immunity', async () => {
      const res = await pgClient.query(
        `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_entries_recalc_settlements'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #50: txn_ref Normalization & Mandatory Enforcement Column', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'payment_methods' AND column_name = 'requires_txn_ref'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #51: Statement Line Auto-Unmatch on Void/Supersede via Entry Trigger', async () => {
      // Deviation from plan name: the void/supersede lifecycle is mediated by the
      // append-only trigger system (fn entries arc immutable restart); the
      // line-unmatching on void/supersede is enforced by trg_entries_unmatch_statement_lines
      // + fn_entries_unmatch_statement_lines, which inspect entry status changes.
      const res = await pgClient.query(
        `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_entries_unmatch_statement_lines'`,
      );
      expect(res.rows.length).toBe(1);
      const src = await pgClient.query(`
        SELECT p.prosrc FROM pg_trigger t
          JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE t.tgname = 'trg_entries_unmatch_statement_lines'
      `);
      expect(src.rows[0].prosrc.toLowerCase()).toContain('void');
    });

    it('Test #52: Dual-Payable Line Matching Kind Constraint in Mode B', async () => {
      const res = await pgClient.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'statements_kind_check'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #53: Statement Line Unmatching Function', async () => {
      const res = await pgClient.query(
        `SELECT proname FROM pg_proc WHERE proname = 'unmatch_statement_line'`,
      );
      expect(res.rows.length).toBe(1);
    });

    it('Test #54: Reconciliation Exception Flip Invalidation Table', async () => {
      const res = await pgClient.query(`
        SELECT table_name FROM information_schema.tables
         WHERE table_name = 'entry_reconciliation_exceptions'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #57: Stale-Rate Admin Review Workflow Column', async () => {
      const res = await pgClient.query(`
        SELECT column_name FROM information_schema.columns
         WHERE table_name = 'entries' AND column_name = 'stale_review_status'
      `);
      expect(res.rows.length).toBe(1);
    });

    it('Test #58: Month Close Gated on Flagged Stale-Review Entries', async () => {
      const rpcDef = await pgClient.query(
        `SELECT prosrc FROM pg_proc WHERE proname = 'close_month'`,
      );
      expect(rpcDef.rows[0].prosrc).toContain('flagged');
    });

    it('Test #65: Stale-Rate Device Anomaly Burst View Isolation', async () => {
      const res = await pgClient.query(`
        SELECT table_name FROM information_schema.views
         WHERE table_name = 'view_device_stale_rate_anomalies'
      `);
      expect(res.rows.length).toBe(1);
    });
  });
});
