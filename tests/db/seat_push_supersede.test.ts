import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';

const { Pool } = pg;

/**
 * The seat's two write paths, against a database built from `supabase/migrations`.
 *
 * Both were refused before the migrations were repaired. `20261114000008` re-created
 * `rpc_push_sync_op` from the 0005 body after 0009 had given it the platform
 * allowance, so the seat's push answered `403 unauthorized`; and `fk_entries_creator`
 * pointed `(center_id, created_by)` at `profiles (center_id, id)`, which no seat can
 * satisfy, so a seat write was refused at the insert even once the role gate admitted
 * it. `20261116000010` owns the push RPC now and `20261116000011` relaxed the creator
 * reference; this suite is the proof that both paths work together on a clean build.
 */

const CENTER = 'cc000000-0000-4000-8000-000000000001';
const OTHER_CENTER = 'cc000000-0000-4000-8000-000000000002';
const SEAT = 'cc000000-0000-4000-8000-000000000011';
const OWNER = 'cc000000-0000-4000-8000-000000000012';
const OUTSIDER = 'cc000000-0000-4000-8000-000000000013';
const METHOD = 'cc000000-0000-4000-8000-000000000021';
const RATE = 'cc000000-0000-4000-8000-000000000022';
const DEVICE = 'cc000000-0000-4000-8000-0000000000d1';
const PUSH_ENTRY = 'cc000000-0000-4000-8000-000000000031';
const REPLACEMENT = 'cc000000-0000-4000-8000-000000000032';
const PUSH_OP = 'cc000000-0000-4000-8000-000000000041';
const ENTRY_DATE = '2026-11-16';

/** 42% commission on gross, no VAT, no method fee — the profile seeded below. */
const SNAPSHOT = {
  version: 1,
  engineVersion: 1,
  vatMode: 'manual',
  vatBp: 0,
  commissionBp: 4200,
  commissionBase: 'gross',
  methodFeeBp: 0,
  chargesBorneBy: 'business',
  rateProfileId: RATE,
};

let pool: pg.Pool;

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO auth.users (id, email) VALUES
      ('${SEAT}', 'seat.seat@cosmo.local'),
      ('${OWNER}', 'owner.seat@cosmo.local'),
      ('${OUTSIDER}', 'outsider.seat@cosmo.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO centers (id, code, name, legal_entity_name, address, phone, status) VALUES
      ('${CENTER}', 'SPC', 'Seat Push', 'Seat Push Ltd', 'Dhaka', '01700000021', 'active'),
      ('${OTHER_CENTER}', 'SPD', 'Seat Other', 'Seat Other Ltd', 'Dhaka', '01700000022', 'active')
    ON CONFLICT (id) DO UPDATE SET status = 'active';

    INSERT INTO center_counters (center_id, next_entry_number) VALUES
      ('${CENTER}', 1), ('${OTHER_CENTER}', 1)
    ON CONFLICT (center_id) DO NOTHING;

    INSERT INTO profiles (id, center_id, full_name, role, active) VALUES
      ('${SEAT}', NULL, 'Platform Seat', 'super_admin', true),
      ('${OWNER}', '${CENTER}', 'Seat Owner', 'owner', true),
      ('${OUTSIDER}', '${OTHER_CENTER}', 'Other Centre Owner', 'owner', true)
    ON CONFLICT (id) DO UPDATE SET center_id = EXCLUDED.center_id, role = EXCLUDED.role, active = true;

    INSERT INTO payment_methods (center_id, id, code, name, requires_txn_ref, active, sort_order)
    VALUES ('${CENTER}', '${METHOD}', 'cash', 'Cash', false, false, 1)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO rate_profiles (
      center_id, id, version, effective_from, status, vat_mode, vat_bp,
      commission_base, commission_bp, charges_borne_by, created_by
    ) VALUES (
      '${CENTER}', '${RATE}', 1, '2026-01-01', 'draft', 'manual', 0,
      'gross', 4200, 'business', '${OWNER}'
    ) ON CONFLICT (id) DO NOTHING;
  `);

  // The draft/publish lock raises before a conflict resolves, so guard on state.
  await pool.query(`
    INSERT INTO method_rates (center_id, rate_profile_id, method_id, charge_bp)
    SELECT '${CENTER}', '${RATE}', '${METHOD}', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM method_rates WHERE rate_profile_id = '${RATE}' AND method_id = '${METHOD}'
    );

    UPDATE rate_profiles SET status = 'published' WHERE id = '${RATE}' AND status <> 'published';
    UPDATE payment_methods SET active = true WHERE id = '${METHOD}' AND active = false;
  `);
}

function entryPayload(id: string, customerName: string) {
  return {
    id,
    entryDate: ENTRY_DATE,
    customerName,
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
  };
}

describe('the platform seat writes through the shipped migrations', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    pool = new Pool({ connectionString: testDatabaseUrl() });
    await seed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('push_as_seat: rpc_push_sync_op accepts a create_entry from the seat', async () => {
    const ops = [
      {
        opId: PUSH_OP,
        type: 'create_entry',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: entryPayload(PUSH_ENTRY, 'Platform sale'),
      },
    ];

    const result = await pool.query(
      'SELECT rpc_push_sync_op($1::uuid, $2::text, $3::uuid, $4::user_role, $5::jsonb) AS result',
      [CENTER, DEVICE, SEAT, 'super_admin', JSON.stringify(ops)],
    );

    expect(result.rows[0].result.results[0].status).toBe('ok');

    const entry = await pool.query(
      'SELECT status, created_by, center_id FROM entries WHERE id = $1',
      [PUSH_ENTRY],
    );
    expect(entry.rowCount).toBe(1);
    expect(entry.rows[0].status).toBe('active');
    expect(entry.rows[0].created_by).toBe(SEAT);
    expect(entry.rows[0].center_id).toBe(CENTER);

    const audit = await pool.query(
      `SELECT actor, after->>'actor_role' AS actor_role FROM audit_log
       WHERE action = 'entry.create' AND target_id = $1`,
      [PUSH_ENTRY],
    );
    expect(audit.rows[0].actor).toBe(SEAT);
    expect(audit.rows[0].actor_role).toBe('super_admin');
  });

  it('supersede_as_seat: rpc_supersede_entry replaces the seat entry', async () => {
    const replacement = {
      ...entryPayload(REPLACEMENT, 'Platform sale, corrected'),
      deviceId: DEVICE,
    };

    const result = await pool.query(
      'SELECT rpc_supersede_entry($1::uuid, $2::uuid, $3::jsonb, $4::uuid) AS res',
      [CENTER, PUSH_ENTRY, JSON.stringify(replacement), SEAT],
    );

    expect(result.rows[0].res.status).toBe('ok');
    expect(result.rows[0].res.replacementEntryId).toBe(REPLACEMENT);

    const original = await pool.query('SELECT status FROM entries WHERE id = $1', [PUSH_ENTRY]);
    expect(original.rows[0].status).toBe('superseded');

    const replacementRow = await pool.query(
      'SELECT status, created_by, supersedes_id FROM entries WHERE id = $1',
      [REPLACEMENT],
    );
    expect(replacementRow.rows[0].status).toBe('active');
    expect(replacementRow.rows[0].created_by).toBe(SEAT);
    expect(replacementRow.rows[0].supersedes_id).toBe(PUSH_ENTRY);

    const audit = await pool.query(
      `SELECT actor, after->>'actor_role' AS actor_role FROM audit_log
       WHERE action = 'entry.supersede' AND target_id = $1`,
      [PUSH_ENTRY],
    );
    expect(audit.rows[0].actor).toBe(SEAT);
    expect(audit.rows[0].actor_role).toBe('super_admin');
  });

  it('records the role on a void request as well as on a void', async () => {
    // `request_void` is the amendment a centre role performs, so its payload has to name
    // the role for the same reason entry.create does.
    const ops = [
      {
        opId: 'cc000000-0000-4000-8000-000000000042',
        type: 'request_void',
        clientCreatedAt: new Date().toISOString(),
        maxKnownRateVersion: 1,
        payload: { entryId: REPLACEMENT, reason: 'requested correction' },
      },
    ];

    const result = await pool.query(
      'SELECT rpc_push_sync_op($1::uuid, $2::text, $3::uuid, $4::user_role, $5::jsonb) AS result',
      [CENTER, DEVICE, OWNER, 'owner', JSON.stringify(ops)],
    );
    expect(result.rows[0].result.results[0].status).toBe('ok');

    const audit = await pool.query(
      `SELECT actor, after->>'actor_role' AS actor_role FROM audit_log
       WHERE action = 'entry.void_request' AND target_id = $1`,
      [REPLACEMENT],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].actor).toBe(OWNER);
    expect(audit.rows[0].actor_role).toBe('owner');
  });

  it('keeps the tenant rule: a centre-scoped creator from another centre is refused', async () => {
    // What the composite foreign key used to enforce, now carried by the trigger that
    // replaced it: only the platform seat may author a row from outside the centre.
    await expect(
      pool.query(
        `INSERT INTO entries (
           id, center_id, entry_date, customer_name, sub_qty, method_id, gross_poisha,
           rate_profile_id, snapshot, vat_input_poisha, vat_poisha, commission_poisha,
           charge_poisha, business_charge_poisha, customer_charge_poisha, net_poisha,
           created_by, device_id, client_created_at
         ) VALUES (
           $1, $2, $3, 'Wrong centre creator', 1, $4, 100000,
           $5, $6::jsonb, 0, 0, 42000, 0, 0, 0, 58000,
           $7, $8, now()
         )`,
        [
          'cc000000-0000-4000-8000-000000000033',
          CENTER,
          ENTRY_DATE,
          METHOD,
          RATE,
          JSON.stringify(SNAPSHOT),
          OUTSIDER,
          DEVICE,
        ],
      ),
    ).rejects.toThrow(/entry_creator_center_mismatch/);
  });
});
