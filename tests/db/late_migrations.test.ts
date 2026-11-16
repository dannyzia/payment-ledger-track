import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';

const { Client } = pg;

/**
 * Late-migration regressions, on a database built from `supabase/migrations` in
 * filename order (the throwaway `clt_test` database, CLT-D-026).
 *
 * Three migrations re-issue objects that earlier ones installed, and a re-issue is
 * where intent quietly disappears: `20261114000008` rewrote `rpc_push_sync_op` from
 * the 0005 body and dropped 0009's platform-seat allowances, which went unnoticed
 * until a clean build was probed. `20261116000010` now holds the authoritative push
 * body. Each case below asserts the *intent* of the late migrations rather than a
 * particular file:
 *
 *   - the seat may void through the push RPC and supersede through its own RPC;
 *   - the write guard is installed on all fifteen tenant tables, and it refuses a
 *     withheld center's insert even when the caller never goes through a route;
 *   - the retention sweep leaves a withheld center's queued rows alone.
 */

const ACTIVE = 'aa000000-0000-4000-8000-000000000001';
const WITHHELD = 'aa000000-0000-4000-8000-000000000002';
const SEAT = 'aa000000-0000-4000-8000-000000000011';
const OWNER = 'aa000000-0000-4000-8000-000000000012';
const STAFF = 'aa000000-0000-4000-8000-000000000013';
const METHOD = 'aa000000-0000-4000-8000-000000000021';
const RATE = 'aa000000-0000-4000-8000-000000000022';
const DEVICE = 'aa000000-0000-4000-8000-0000000000d1';

const VOID_ENTRY = 'aa000000-0000-4000-8000-000000000031';
const OWNER_VOID_ENTRY = 'aa000000-0000-4000-8000-000000000034';
const STAFF_VOID_ENTRY = 'aa000000-0000-4000-8000-000000000035';
const SUPERSEDE_ENTRY = 'aa000000-0000-4000-8000-000000000032';
const REPLACEMENT_ENTRY = 'aa000000-0000-4000-8000-000000000033';
const SEAT_OP = 'aa000000-0000-4000-8000-000000000041';

/** The snapshot the published cash method/profile below validates against. */
const SNAPSHOT = {
  version: 1,
  engineVersion: 1,
  vatMode: 'manual',
  vatBp: 0,
  commissionBp: 4200,
  commissionBase: 'gross_minus_vat',
  methodFeeBp: 0,
  chargesBorneBy: 'business',
  rateProfileId: RATE,
};

/** The fifteen tables 20261114000009 installs a write guard on. */
const GUARDED_TABLES = [
  'app_settings',
  'center_counters',
  'entries',
  'entry_reconciliation_exceptions',
  'method_rates',
  'month_close_events',
  'month_closes',
  'payables',
  'payment_methods',
  'rate_profiles',
  'settlement_payments',
  'settlements',
  'statement_lines',
  'statement_payables',
  'statements',
];

let db: pg.Client;

async function seed(): Promise<void> {
  await db.query(
    `
    INSERT INTO auth.users (id, email) VALUES
      ('${SEAT}', 'seat.late@cosmo.local'),
      ('${OWNER}', 'owner.late@cosmo.local'),
      ('${STAFF}', 'staff.late@cosmo.local')
    ON CONFLICT (id) DO NOTHING;

    -- Both centers start active: the write guard covers center_counters, so a
    -- suspended center cannot have its fixtures created. The withheld one is
    -- suspended at the end of this seed.
    INSERT INTO centers (id, code, name, legal_entity_name, address, phone, status) VALUES
      ('${ACTIVE}', 'LMA', 'Late Active', 'Late Active Ltd', 'Dhaka', '01700000001', 'active'),
      ('${WITHHELD}', 'LMH', 'Late Withheld', 'Late Withheld Ltd', 'Dhaka', '01700000002', 'active')
    ON CONFLICT (id) DO UPDATE SET status = 'active';

    INSERT INTO center_counters (center_id, next_entry_number) VALUES
      ('${ACTIVE}', 1), ('${WITHHELD}', 1)
    ON CONFLICT (center_id) DO NOTHING;

    INSERT INTO profiles (id, center_id, full_name, role, active) VALUES
      ('${SEAT}', NULL, 'Platform Seat', 'super_admin', true),
      ('${OWNER}', '${ACTIVE}', 'Late Owner', 'owner', true),
      ('${STAFF}', '${ACTIVE}', 'Late Staff', 'staff', true)
    ON CONFLICT (id) DO UPDATE SET center_id = EXCLUDED.center_id, role = EXCLUDED.role, active = EXCLUDED.active;

    INSERT INTO payment_methods (center_id, id, code, name, requires_txn_ref, active, sort_order)
    VALUES ('${ACTIVE}', '${METHOD}', 'cash', 'Cash', false, false, 1)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO rate_profiles (
      center_id, id, version, effective_from, status, vat_mode, vat_bp,
      commission_base, commission_bp, charges_borne_by, created_by
    ) VALUES (
      '${ACTIVE}', '${RATE}', 1, '2026-01-01', 'draft', 'manual', 0,
      'gross_minus_vat', 4200, 'business', '${OWNER}'
    ) ON CONFLICT (id) DO NOTHING;
    `,
  );

  // The draft/publish lock raises before a conflict resolves, so guard on state.
  await db.query(`
    INSERT INTO method_rates (center_id, rate_profile_id, method_id, charge_bp)
    SELECT '${ACTIVE}', '${RATE}', '${METHOD}', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM method_rates WHERE rate_profile_id = '${RATE}' AND method_id = '${METHOD}'
    );

    UPDATE rate_profiles SET status = 'published'
    WHERE id = '${RATE}' AND status <> 'published';

    UPDATE payment_methods SET active = true
    WHERE id = '${METHOD}' AND active = false;
  `);

  await db.query(`
    ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
    DELETE FROM entries WHERE id IN ('${VOID_ENTRY}', '${OWNER_VOID_ENTRY}', '${STAFF_VOID_ENTRY}', '${SUPERSEDE_ENTRY}', '${REPLACEMENT_ENTRY}');
    ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
  `);

  await db.query(`UPDATE centers SET status = 'suspended' WHERE id = '${WITHHELD}'`);

  // Two active entries, written directly: this suite is about what the RPCs and
  // triggers do, not about the create path. gross 100000 = commission 42000 + net 58000.
  await db.query(`
    INSERT INTO entries (
      id, center_id, entry_date, customer_name, sub_qty, method_id, gross_poisha,
      rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
      charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
      created_by, device_id, client_created_at
    ) VALUES
      ('${VOID_ENTRY}', '${ACTIVE}', '2026-10-05', 'Void candidate', 1, '${METHOD}', 100000,
       '${RATE}', '${JSON.stringify(SNAPSHOT)}'::jsonb, 0, 0, 42000, 0, 0, 0, 58000,
       '${OWNER}', '${DEVICE}', now()),
      ('${SUPERSEDE_ENTRY}', '${ACTIVE}', '2026-10-06', 'Supersede candidate', 1, '${METHOD}', 100000,
       '${RATE}', '${JSON.stringify(SNAPSHOT)}'::jsonb, 0, 0, 42000, 0, 0, 0, 58000,
       '${OWNER}', '${DEVICE}', now()),
      ('${OWNER_VOID_ENTRY}', '${ACTIVE}', '2026-10-07', 'Owner control', 1, '${METHOD}', 100000,
       '${RATE}', '${JSON.stringify(SNAPSHOT)}'::jsonb, 0, 0, 42000, 0, 0, 0, 58000,
       '${OWNER}', '${DEVICE}', now()),
      ('${STAFF_VOID_ENTRY}', '${ACTIVE}', '2026-10-08', 'Staff control', 1, '${METHOD}', 100000,
       '${RATE}', '${JSON.stringify(SNAPSHOT)}'::jsonb, 0, 0, 42000, 0, 0, 0, 58000,
       '${OWNER}', '${DEVICE}', now());
  `);
}

async function seedQueuedOps(): Promise<void> {
  await db.query(`DELETE FROM sync_ops WHERE center_id IN ('${ACTIVE}', '${WITHHELD}')`);

  // Rejected and resolved 200 days ago: past the 90-day retention window in both
  // centers, differing only in whether the center is active.
  await db.query(`
    INSERT INTO sync_ops (
      op_id, center_id, actor_id, device_id, op_type, payload, payload_hash,
      client_created_at, result, resolution_status, created_at
    ) VALUES
      (gen_random_uuid(), '${ACTIVE}', '${OWNER}', '${DEVICE}', 'create_entry',
       '{}'::jsonb, 'late-migration-test', now() - interval '200 days', 'rejected', 'resolved',
       now() - interval '200 days'),
      (gen_random_uuid(), '${WITHHELD}', '${OWNER}', '${DEVICE}', 'create_entry',
       '{}'::jsonb, 'late-migration-test', now() - interval '200 days', 'rejected', 'resolved',
       now() - interval '200 days')
  `);
}

describe('Late migrations keep their intent on a clean database', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    db = new Client({ connectionString: testDatabaseUrl() });
    await db.connect();
    await seed();
  }, 180_000);

  afterAll(async () => {
    if (!db) return;
    await db.query(`
      ALTER TABLE entries DISABLE TRIGGER trg_entries_immutability;
      DELETE FROM entries WHERE id IN ('${VOID_ENTRY}', '${OWNER_VOID_ENTRY}', '${STAFF_VOID_ENTRY}', '${SUPERSEDE_ENTRY}', '${REPLACEMENT_ENTRY}');
      ALTER TABLE entries ENABLE TRIGGER trg_entries_immutability;
      DELETE FROM sync_ops WHERE center_id IN ('${ACTIVE}', '${WITHHELD}');
    `);
    await db.end();
  });

  it('the platform seat voids through rpc_push_sync_op with no membership and no device row', async () => {
    // The three allowances 20261114000008 dropped by re-issuing the 0005 body, each
    // asserted separately so losing one fails here rather than in the field: the seat
    // is not a member of the center, it holds no device row in it, and `void_entry`
    // admits it anyway.
    const membership = await db.query(
      `SELECT count(*)::int AS n FROM profiles WHERE id = $1 AND center_id = $2`,
      [SEAT, ACTIVE],
    );
    expect(membership.rows[0].n).toBe(0);

    const deviceBefore = await db.query(
      `SELECT count(*)::int AS n FROM devices WHERE device_id = $1`,
      [DEVICE],
    );
    expect(deviceBefore.rows[0].n).toBe(0);

    const result = await db.query(
      `SELECT rpc_push_sync_op($1::uuid, $2, $3::uuid, $4::user_role, $5::jsonb) AS res`,
      [
        ACTIVE,
        DEVICE,
        SEAT,
        'super_admin',
        JSON.stringify([
          {
            opId: SEAT_OP,
            type: 'void_entry',
            clientCreatedAt: new Date().toISOString(),
            maxKnownRateVersion: 1,
            payload: { entryId: VOID_ENTRY, reason: 'late-migration seat void' },
          },
        ]),
      ],
    );

    const outcome = result.rows[0].res as { results: Array<{ status: string; reason?: string }> };
    expect(outcome.results[0]?.status, JSON.stringify(outcome)).toBe('ok');

    // Presence registration is skipped for a platform caller, because a device row needs
    // a center profile to reference. The exemption keeps that skip from becoming a
    // failure; if it is dropped, the push above is rejected before it reaches the entry.
    const deviceAfter = await db.query(
      `SELECT count(*)::int AS n FROM devices WHERE device_id = $1`,
      [DEVICE],
    );
    expect(deviceAfter.rows[0].n).toBe(0);

    const entry = await db.query('SELECT status FROM entries WHERE id = $1', [VOID_ENTRY]);
    expect(entry.rows[0].status).toBe('voided');

    const audit = await db.query(
      `SELECT actor::text AS actor, after->>'actor_role' AS actor_role FROM audit_log
       WHERE action = 'entry.void' AND target_id = $1`,
      [VOID_ENTRY],
    );
    expect(audit.rows.map((row) => row.actor)).toContain(SEAT);
    // The amendment carries the role too, not only entry.create: otherwise a platform
    // void and an owner's void read the same in the trail.
    expect(audit.rows.map((row) => row.actor_role)).toContain('super_admin');

    // The two controls the evidence probe also runs
    // (docs/orchestration/evidence/plan-023-void-seat-probe.sql): a center role still
    // voids, and a staff member is still refused. Without them, a body that admitted
    // everyone would pass the seat assertion for the wrong reason.
    const ownerVoid = await db.query(
      `SELECT rpc_push_sync_op($1::uuid, $2, $3::uuid, $4::user_role, $5::jsonb) AS res`,
      [
        ACTIVE,
        DEVICE,
        OWNER,
        'owner',
        JSON.stringify([
          {
            opId: 'aa000000-0000-4000-8000-000000000042',
            type: 'void_entry',
            clientCreatedAt: new Date().toISOString(),
            maxKnownRateVersion: 1,
            payload: { entryId: OWNER_VOID_ENTRY, reason: 'owner control void' },
          },
        ]),
      ],
    );
    expect(ownerVoid.rows[0].res.results[0].status).toBe('ok');
    const ownerEntry = await db.query('SELECT status FROM entries WHERE id = $1', [
      OWNER_VOID_ENTRY,
    ]);
    expect(ownerEntry.rows[0].status).toBe('voided');

    const staffVoid = await db.query(
      `SELECT rpc_push_sync_op($1::uuid, $2, $3::uuid, $4::user_role, $5::jsonb) AS res`,
      [
        ACTIVE,
        DEVICE,
        STAFF,
        'staff',
        JSON.stringify([
          {
            opId: 'aa000000-0000-4000-8000-000000000043',
            type: 'void_entry',
            clientCreatedAt: new Date().toISOString(),
            maxKnownRateVersion: 1,
            payload: { entryId: STAFF_VOID_ENTRY, reason: 'staff control void' },
          },
        ]),
      ],
    );
    expect(staffVoid.rows[0].res.results[0].status).toBe('rejected');
    expect(staffVoid.rows[0].res.results[0].reason).toBe('unauthorized');
    const staffEntry = await db.query('SELECT status FROM entries WHERE id = $1', [
      STAFF_VOID_ENTRY,
    ]);
    expect(staffEntry.rows[0].status).toBe('active');
  });

  it('rpc_supersede_entry admits the platform seat at its role gate', async () => {
    // An unknown original id is refused after the caller check, so the message says
    // which refusal came first: `422 parent_entry_not_found` means the seat was
    // admitted, `403 unauthorized` would mean it was not.
    await expect(
      db.query('SELECT rpc_supersede_entry($1::uuid, $2::uuid, $3::jsonb, $4::uuid)', [
        ACTIVE,
        'aa000000-0000-4000-8000-0000000000ff',
        JSON.stringify({}),
        SEAT,
      ]),
    ).rejects.toThrow('422 parent_entry_not_found');
  });

  it('rpc_supersede_entry replaces an entry when the seat is the actor', async () => {
    // Plan 023 §6.7 assumes a platform-created entry exists, so the seat's supersede
    // has to insert a row whose `created_by` is the seat. `20261116000011` replaced the
    // composite creator key (which no seat could satisfy) with `profiles (id)` plus a
    // centre guard, so the insert now succeeds instead of raising fk_entries_creator.
    const replacement = {
      id: REPLACEMENT_ENTRY,
      entryDate: '2026-10-07',
      customerName: 'Seat replacement',
      methodId: METHOD,
      grossPoisha: '100000',
      vatPoisha: '0',
      vatInputPoisha: '0',
      commissionPoisha: '42000',
      chargePoisha: '0',
      businessChargePoisha: '0',
      customerChargePoisha: '0',
      netPoisha: '58000',
      rateProfileId: RATE,
      snapshot: SNAPSHOT,
      reassignReason: 'late-migration seat supersede',
    };

    const result = await db.query(
      'SELECT rpc_supersede_entry($1::uuid, $2::uuid, $3::jsonb, $4::uuid) AS res',
      [ACTIVE, SUPERSEDE_ENTRY, JSON.stringify(replacement), SEAT],
    );
    expect(result.rows[0].res.status).toBe('ok');

    const original = await db.query('SELECT status, superseded_at FROM entries WHERE id = $1', [
      SUPERSEDE_ENTRY,
    ]);
    expect(original.rows[0].status).toBe('superseded');
    expect(original.rows[0].superseded_at).not.toBeNull();

    const created = await db.query('SELECT created_by FROM entries WHERE id = $1', [
      REPLACEMENT_ENTRY,
    ]);
    expect(created.rows[0].created_by).toBe(SEAT);
  });

  it('the write guard is installed on exactly the fifteen tenant tables', async () => {
    const triggers = await db.query(`
      SELECT c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND t.tgname = 'trg_' || c.relname || '_center_writable'
      ORDER BY c.relname
    `);

    expect(triggers.rows.map((row) => row.table_name)).toEqual(GUARDED_TABLES);
  });

  it('the write guard refuses a withheld center without any route in the way', async () => {
    await expect(
      db.query('INSERT INTO center_counters (center_id, next_entry_number) VALUES ($1, 99)', [
        WITHHELD,
      ]),
    ).rejects.toThrow('center_suspended');
  });

  it('purge_expired_sync_ops skips a withheld center and still sweeps an active one', async () => {
    await seedQueuedOps();

    const purged = await db.query('SELECT purge_expired_sync_ops(NULL) AS deleted');
    expect(Number(purged.rows[0].deleted)).toBeGreaterThanOrEqual(1);

    const remaining = await db.query(
      `SELECT center_id::text AS center_id FROM sync_ops WHERE payload_hash = 'late-migration-test'`,
    );
    expect(remaining.rows.map((row) => row.center_id)).toEqual([WITHHELD]);

    // Asking for the withheld center by id deletes nothing either.
    const direct = await db.query('SELECT purge_expired_sync_ops($1::uuid) AS deleted', [WITHHELD]);
    expect(Number(direct.rows[0].deleted)).toBe(0);
  });
});
