import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';

const { Client } = pg;

/**
 * Plan 023 steps 3 and 4 — a withheld center is actually withheld, and its queued
 * work is not aged out while nobody can resolve it (Goldfish blockers 4 and the
 * "status is written but read by nothing" finding in CLT-T-083).
 *
 * Runs on the throwaway `clt_test` database (CLT-D-026); the development database is
 * only the server this one is created on.
 */

const SUSPENDED_ID = '11111111-1111-1111-1111-111111111111';
const WRITE_SUSPENDED_ID = '66666666-6666-6666-6666-666666666666';
const WRITE_ARCHIVED_ID = '77777777-7777-7777-7777-777777777777';
const WRITE_ACTOR_ID = '88888888-8888-8888-8888-888888888888';
const ARCHIVED_ID = '22222222-2222-2222-2222-222222222222';
const ACTOR_ID = '33333333-3333-3333-3333-333333333333';
const DEVICE_ID = '44444444-4444-4444-4444-444444444444';
const QUEUED_OP_ID = '55555555-5555-5555-5555-555555555555';

const PUSH_OPS = JSON.stringify([
  {
    opId: QUEUED_OP_ID,
    type: 'create_entry',
    payload: {},
    clientCreatedAt: new Date().toISOString(),
  },
]);

let db: pg.Client;

/** The guard raises before any op is parsed, so a bare op body is enough. */
async function pushInto(centerId: string): Promise<string> {
  try {
    await db.query('select rpc_push_sync_op($1::uuid, $2, $3::uuid, $4::user_role, $5::jsonb)', [
      centerId,
      DEVICE_ID,
      ACTOR_ID,
      'staff',
      PUSH_OPS,
    ]);
    return 'accepted';
  } catch (thrown) {
    return (thrown as Error).message;
  }
}

async function entryCount(centerId: string): Promise<number> {
  const result = await db.query('select count(*)::int as n from entries where center_id = $1', [
    centerId,
  ]);
  return result.rows[0].n as number;
}

async function purge(centerId: string): Promise<number> {
  const result = await db.query('select purge_expired_sync_ops($1::uuid) as deleted', [centerId]);
  return Number(result.rows[0].deleted);
}

async function seedCenter(
  id: string,
  code: string,
  name: string,
  client: pg.Client = db,
): Promise<void> {
  await client.query(
    `insert into centers (id, code, name, legal_entity_name, address, phone)
     values ($1, $2, $3, $3 || ' Ltd', 'Dhaka', '01700000000')
     on conflict (id) do nothing`,
    [id, code, name],
  );
  // The write guard fires before the conflict check, so a fixture left suspended by an
  // earlier run cannot seed its counters. Seeding is setup, not business activity.
  await client.query("update centers set status = 'active' where id = $1 and status <> 'active'", [
    id,
  ]);
  await client.query('insert into center_counters (center_id) values ($1) on conflict do nothing', [
    id,
  ]);
}

describe('center suspension', () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    db = new Client({ connectionString: testDatabaseUrl() });
    await db.connect();

    await seedCenter(SUSPENDED_ID, 'SUS', 'Suspended Center');
    await seedCenter(ARCHIVED_ID, 'ARC', 'Archived Center');

    await db.query(
      "insert into auth.users (id, email) values ($1, 'suspension.tester@clt.local') on conflict (id) do nothing",
      [ACTOR_ID],
    );
    await db.query(
      `insert into profiles (id, center_id, full_name, role, active)
       values ($1, $2, 'Suspension Tester', 'staff', true)
       on conflict (id) do update set center_id = excluded.center_id, active = true`,
      [ACTOR_ID, SUSPENDED_ID],
    );

    // Status changes go through UPDATE so trg_centers_track_suspension stamps suspended_at.
    await db.query("update centers set status = 'suspended' where id = $1", [SUSPENDED_ID]);
    await db.query("update centers set status = 'archived' where id = $1", [ARCHIVED_ID]);
  });

  afterAll(async () => {
    await db?.end();
  });

  it('refuses a push from a suspended center and writes nothing', async () => {
    const before = await entryCount(SUSPENDED_ID);
    const message = await pushInto(SUSPENDED_ID);

    expect(message).toContain('403 center_suspended');
    expect(await entryCount(SUSPENDED_ID)).toBe(before);
  });

  it('refuses a push from an archived center', async () => {
    expect(await pushInto(ARCHIVED_ID)).toContain('403 center_archived');
  });

  it('pauses the retention clock across suspension and resumes it on reactivation', async () => {
    // A long suspension, simulated: the row exists, the wall clock moved 200 days.
    await db.query(
      `update centers
          set suspended_at = now() - interval '200 days',
              retention_offset = interval '0'
        where id = $1`,
      [SUSPENDED_ID],
    );

    await db.query(
      `insert into sync_ops
         (op_id, center_id, actor_id, device_id, op_type, payload, payload_hash,
          client_created_at, result, resolution_status, reason, created_at)
       values ($1, $2, $3, $4, 'void_entry', '{}'::jsonb, 'test-hash',
               now() - interval '120 days', 'rejected', 'resolved',
               'queue_expired_needs_review', now() - interval '120 days')
       on conflict (op_id) do nothing`,
      [QUEUED_OP_ID, SUSPENDED_ID, ACTOR_ID, DEVICE_ID],
    );

    // While suspended the sweep must not touch it, even though it is 120 days old.
    expect(await purge(SUSPENDED_ID)).toBe(0);

    // Reactivate: 200 days of withheld time are added to the offset.
    await db.query("update centers set status = 'active' where id = $1", [SUSPENDED_ID]);
    const offset = await db.query(
      "select retention_offset > interval '100 days' as paused, suspended_at is null as cleared from centers where id = $1",
      [SUSPENDED_ID],
    );
    expect(offset.rows[0].paused).toBe(true);
    expect(offset.rows[0].cleared).toBe(true);

    // The op is inside the window again: 120 days old minus 200 days withheld.
    expect(await purge(SUSPENDED_ID)).toBe(0);

    // With the pause removed the same row is expired, which proves the offset —
    // not the wall clock alone — decides.
    await db.query("update centers set retention_offset = interval '0' where id = $1", [
      SUSPENDED_ID,
    ]);
    expect(await purge(SUSPENDED_ID)).toBe(1);
  });
});

/**
 * PLAN 023 §6.3, CLT-T-083 — a withheld center accepts no writes.
 *
 * The push guard covers the device path; these cases cover everything that used to be
 * unguarded: settlement and reconciliation rows, month close, configuration, and a direct
 * write that never passes through a route at all. The exclusion list is tested as well,
 * because blocking `audit_log` would break Hard Rule 5 and blocking `profiles` would stop
 * the platform from managing people on a withheld center.
 */
describe('center write enforcement', () => {
  // Its own connection: the suite above closes the shared one after its last test.
  let wdb: pg.Client;

  async function attempt(sql: string, params: unknown[] = []): Promise<string> {
    try {
      await wdb.query(sql, params);
      return 'accepted';
    } catch (thrown) {
      return (thrown as Error).message;
    }
  }

  beforeAll(async () => {
    wdb = new Client({ connectionString: testDatabaseUrl() });
    await wdb.connect();

    await seedCenter(WRITE_SUSPENDED_ID, 'WSU', 'Withheld Writes', wdb);
    await seedCenter(WRITE_ARCHIVED_ID, 'WAR', 'Archived Writes', wdb);

    // Rows seeded while the centers are still active, so the later refusals are about the
    // status and not about a missing fixture.
    await wdb.query(
      "insert into auth.users (id, email) values ($1, 'write.guard@clt.local') on conflict (id) do nothing",
      [WRITE_ACTOR_ID],
    );
    await wdb.query(
      `insert into profiles (id, center_id, full_name, role, active)
       values ($1, $2, 'Write Guard', 'staff', true)
       on conflict (id) do update set center_id = excluded.center_id, active = true`,
      [WRITE_ACTOR_ID, WRITE_SUSPENDED_ID],
    );
    await wdb.query(
      "insert into app_settings (center_id, net_label) values ($1, 'Net') on conflict (center_id) do nothing",
      [WRITE_SUSPENDED_ID],
    );
    await wdb.query(
      `insert into payables (center_id, code, name, kind, due_day, remind_days_before)
       values ($1, 'WSU-VAT', 'Withheld VAT', 'vat', 5, 3)
       on conflict (center_id, code) do nothing`,
      [WRITE_SUSPENDED_ID],
    );
    // The archived centre needs a row of its own: a trigger only fires on rows a
    // statement actually touches, and an empty table would "accept" an update of nothing.
    await wdb.query(
      `insert into payables (center_id, code, name, kind, due_day, remind_days_before)
       values ($1, 'WAR-VAT', 'Archived VAT', 'vat', 5, 3)
       on conflict (center_id, code) do nothing`,
      [WRITE_ARCHIVED_ID],
    );
    // The device row is keyed by (center_id, device_id); reruns reuse it.
    await wdb.query(
      `insert into devices (center_id, device_id, user_id, device_name, last_seen_at)
       values ($1, $2, $3, 'Counter', now())
       on conflict do nothing`,
      [WRITE_SUSPENDED_ID, DEVICE_ID, WRITE_ACTOR_ID],
    );

    await wdb.query("update centers set status = 'suspended' where id = $1", [WRITE_SUSPENDED_ID]);
    await wdb.query("update centers set status = 'archived' where id = $1", [WRITE_ARCHIVED_ID]);
  });

  afterAll(async () => {
    await wdb?.end();
  });

  it('installs the guard on every tenant table that carries business state', async () => {
    const result = await wdb.query(
      `select c.relname as table_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where t.tgname like 'trg_%_center_writable' and not t.tgisinternal
        order by 1`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
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
    ]);

    // None of the exemptions was caught in the sweep.
    for (const table of ['centers', 'audit_log', 'sync_ops', 'profiles', 'devices']) {
      const guarded = await wdb.query(
        `select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relname = $1 and t.tgname = 'trg_' || $1 || '_center_writable'`,
        [table],
      );
      expect(guarded.rowCount, `${table} must stay writable`).toBe(0);
    }
  });

  it('refuses entry, settlement, month and configuration writes while suspended', async () => {
    // Entries: the guard fires before the row is even validated, so a bare insert is
    // enough to prove the refusal comes from the status and not from a constraint.
    expect(
      await attempt('insert into entries (center_id) values ($1)', [WRITE_SUSPENDED_ID]),
    ).toContain('403 center_suspended');

    expect(
      await attempt("update app_settings set net_label = 'Final' where center_id = $1", [
        WRITE_SUSPENDED_ID,
      ]),
    ).toContain('403 center_suspended');

    expect(
      await attempt('update payables set name = name where center_id = $1', [WRITE_SUSPENDED_ID]),
    ).toContain('403 center_suspended');

    expect(
      await attempt(
        "insert into month_closes (center_id, month, status) values ($1, '2026-12-01', 'closed')",
        [WRITE_SUSPENDED_ID],
      ),
    ).toContain('403 center_suspended');

    // Deletion is maintenance, not business activity, so it stays allowed — the only
    // paths that delete tenant rows are the owner-authorised purge and fixture cleanup.
    expect(await attempt('delete from payables where code = $1', ['DOES-NOT-EXIST'])).toBe(
      'accepted',
    );

    // The settlement generator writes settlements, so it is refused too — not by editing
    // its body but by the table it writes to.
    expect(
      await attempt("select generate_monthly_settlements($1::uuid, '2026-12-01'::date)", [
        WRITE_SUSPENDED_ID,
      ]),
    ).toContain('403 center_suspended');
  });

  it('names archival separately from suspension', async () => {
    expect(
      await attempt('update payables set name = name where center_id = $1', [WRITE_ARCHIVED_ID]),
    ).toContain('403 center_archived');
  });

  it('leaves the audit trail, people, devices and the center row itself writable', async () => {
    expect(
      await attempt(
        `insert into audit_log (center_id, actor, action, target_table, target_id)
         values ($1, $2, 'center.probe', 'centers', $3)`,
        [WRITE_SUSPENDED_ID, WRITE_ACTOR_ID, WRITE_SUSPENDED_ID],
      ),
    ).toBe('accepted');

    expect(
      await attempt('update profiles set full_name = full_name where center_id = $1', [
        WRITE_SUSPENDED_ID,
      ]),
    ).toBe('accepted');

    expect(
      await attempt('update devices set device_name = device_name where center_id = $1', [
        WRITE_SUSPENDED_ID,
      ]),
    ).toBe('accepted');

    // Reactivation is a write to `centers`, which the guard does not cover.
    expect(
      await attempt("update centers set name = 'Renamed While Withheld' where id = $1", [
        WRITE_SUSPENDED_ID,
      ]),
    ).toBe('accepted');
  });

  it('starts accepting writes again the moment the center is reactivated', async () => {
    await wdb.query("update centers set status = 'active' where id = $1", [WRITE_SUSPENDED_ID]);

    expect(
      await attempt("update payables set name = 'After Reactivation' where center_id = $1", [
        WRITE_SUSPENDED_ID,
      ]),
    ).toBe('accepted');

    expect(
      await attempt("update app_settings set net_label = 'Final' where center_id = $1", [
        WRITE_SUSPENDED_ID,
      ]),
    ).toBe('accepted');

    // Leave the fixture as it was found — while it is still active, because the guard
    // would (correctly) refuse these writes afterwards.
    await wdb.query("update payables set name = 'Withheld VAT' where code = 'WSU-VAT'");
    await wdb.query("update app_settings set net_label = 'Net' where center_id = $1", [
      WRITE_SUSPENDED_ID,
    ]);
    await wdb.query("update centers set status = 'suspended' where id = $1", [WRITE_SUSPENDED_ID]);
  });
});
