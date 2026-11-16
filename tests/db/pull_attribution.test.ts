import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';
import { PULL_ENTRIES_SQL } from '../../apps/web/src/lib/server/pull-query';

const { Pool } = pg;

/**
 * Plan 023 step 12, at the database rather than through a fake pool.
 *
 * `apps/web/tests/api/pull-attribution.test.ts` mocks `pg`, so it proves the handler
 * passes a field through and that the statement *text* contains a join. It cannot
 * prove that Postgres resolves `p.role` from it. This suite pushes real entries
 * through `rpc_push_sync_op` and runs the statement the route ships
 * (`$lib/server/pull-query`) against them, so the attribution is read from rows the
 * database actually wrote.
 *
 * The platform case needed a schema change before it could run honestly:
 * `fk_entries_creator` used to point `(center_id, created_by)` at
 * `profiles (center_id, id)`, which no super_admin can satisfy. `20261116000011`
 * replaced it with `profiles (id)` plus a centre guard, so the seat now authors a real
 * row here instead of one this suite fabricated by dropping the constraint.
 */

const CENTER = 'bb000000-0000-4000-8000-000000000001';
const SEAT = 'bb000000-0000-4000-8000-000000000011';
const OWNER = 'bb000000-0000-4000-8000-000000000012';
const METHOD = 'bb000000-0000-4000-8000-000000000021';
const RATE = 'bb000000-0000-4000-8000-000000000022';
const DEVICE = 'bb000000-0000-4000-8000-0000000000d1';
const OWNER_ENTRY = 'bb000000-0000-4000-8000-000000000031';
const SEAT_ENTRY = 'bb000000-0000-4000-8000-000000000032';
const OWNER_OP = 'bb000000-0000-4000-8000-000000000041';
const SEAT_OP = 'bb000000-0000-4000-8000-000000000042';
const ENTRY_DATE = '2026-11-16';

/** Matches the published profile seeded below: 42% commission on gross, no VAT, no fee. */
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
      ('${SEAT}', 'seat.pull@cosmo.local'),
      ('${OWNER}', 'owner.pull@cosmo.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO centers (id, code, name, legal_entity_name, address, phone, status)
    VALUES ('${CENTER}', 'PLA', 'Pull Attribution', 'Pull Attribution Ltd', 'Dhaka', '01700000011', 'active')
    ON CONFLICT (id) DO UPDATE SET status = 'active';

    INSERT INTO center_counters (center_id, next_entry_number) VALUES ('${CENTER}', 1)
    ON CONFLICT (center_id) DO NOTHING;

    INSERT INTO profiles (id, center_id, full_name, role, active) VALUES
      ('${SEAT}', NULL, 'Platform Seat', 'super_admin', true),
      ('${OWNER}', '${CENTER}', 'Pull Owner', 'owner', true)
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

interface PushArgs {
  callerId: string;
  callerRole: 'owner' | 'super_admin';
  entryId: string;
  opId: string;
}

/** One `create_entry` op through the shipped RPC, exactly as the sync route sends it. */
async function push(
  client: pg.Pool | pg.PoolClient,
  { callerId, callerRole, entryId, opId }: PushArgs,
): Promise<{ results: Array<{ status: string; reason?: string }> }> {
  const ops = [
    {
      opId,
      type: 'create_entry',
      clientCreatedAt: new Date().toISOString(),
      maxKnownRateVersion: 1,
      payload: {
        id: entryId,
        entryDate: ENTRY_DATE,
        customerName: 'Pull attribution',
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
      },
    },
  ];

  const result = await client.query(
    'SELECT rpc_push_sync_op($1::uuid, $2::text, $3::uuid, $4::user_role, $5::jsonb) AS result',
    [CENTER, DEVICE, callerId, callerRole, JSON.stringify(ops)],
  );
  return result.rows[0].result;
}

/** Runs the statement the pull route ships, with the route's parameter order. */
async function pull(
  client: pg.Pool | pg.PoolClient,
  callerRole: string,
  callerId: string,
): Promise<Array<{ id: string; created_by: string; created_by_role: string }>> {
  const { rows } = await client.query(PULL_ENTRIES_SQL, ['0', callerRole, callerId, CENTER]);
  return rows.filter((row) => row.id !== null);
}

describe('pull attributes an entry from Postgres rows (Plan 023 step 12)', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    pool = new Pool({ connectionString: testDatabaseUrl() });
    await seed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns the creator role for a centre-authored entry pushed through the RPC', async () => {
    const pushed = await push(pool, {
      callerId: OWNER,
      callerRole: 'owner',
      entryId: OWNER_ENTRY,
      opId: OWNER_OP,
    });
    expect(pushed.results[0]?.status).toBe('ok');

    const rows = await pull(pool, 'owner', OWNER);
    const entry = rows.find((row) => row.id === OWNER_ENTRY);

    expect(entry, 'the pushed entry is missing from the pull statement').toBeDefined();
    expect(entry!.created_by).toBe(OWNER);
    expect(entry!.created_by_role).toBe('owner');
  });

  it('returns super_admin for a platform author whose entry the seat pushed', async () => {
    const pushed = await push(pool, {
      callerId: SEAT,
      callerRole: 'super_admin',
      entryId: SEAT_ENTRY,
      opId: SEAT_OP,
    });
    expect(pushed.results[0]?.status).toBe('ok');

    const rows = await pull(pool, 'super_admin', '00000000-0000-4000-8000-000000000000');
    const seatEntry = rows.find((row) => row.id === SEAT_ENTRY);
    const ownerEntry = rows.find((row) => row.id === OWNER_ENTRY);

    expect(seatEntry, 'the platform entry is missing from the pull statement').toBeDefined();
    expect(seatEntry!.created_by).toBe(SEAT);
    expect(seatEntry!.created_by_role).toBe('super_admin');
    // The same statement must not mislabel the centre-authored row beside it.
    expect(ownerEntry?.created_by_role).toBe('owner');
  });
});
