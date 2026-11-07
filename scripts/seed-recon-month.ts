import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { calculateEntry, ENGINE_VERSION, type RateSnapshot } from '../packages/calc/src/index.ts';
import { computeJcsSha256 } from '../apps/web/src/lib/sync/canonical.ts';

/**
 * Seeds one clean month for exercising the month-close empty state:
 * "No open statement covers the outstanding payables for <month>. Create one in
 * Reconciliation." (`/months/close` → `[data-testid=blocking-statements]`).
 *
 * That branch needs a month that is open, has at least one payable-bearing
 * settlement that is not `not_applicable`, and has no statement at all. A month
 * with no entries auto-passes Gate 1, so the month needs one real entry; the
 * entry is pushed through `rpc_push_sync_op` (not inserted) so audit, server_seq,
 * settlement generation and financial invariants all behave as in production.
 *
 * Usage: pnpm db:seed:recon-month [YYYY-MM] [method-code]
 * Defaults: the month after the current Asia/Dhaka month, method `bkash`.
 *
 * Local only. Runs are idempotent through the fixture's transaction reference and
 * refuse any month that already holds entries, statements or settlements, so the
 * script cannot write into a month that carries real data.
 */

const { Pool } = pg;

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// devices.device_id is a UUID column, so the fixture device needs a real one; this
// fixed value keeps repeat runs on the same registry row.
const FIXTURE_DEVICE_ID = '00000000-0000-4000-8000-000000000001';

function dhakaMonth(offsetMonths: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const [yearRaw, monthRaw] = parts.split('-');
  const total = Number(yearRaw) * 12 + (Number(monthRaw) - 1) + offsetMonths;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const host = new URL(databaseUrl).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing to seed non-local database host "${host}"`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed test data with NODE_ENV=production');
  }

  const month = process.argv[2] ?? dhakaMonth(1);
  const methodCode = process.argv[3] ?? 'bkash';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`Month must be YYYY-MM, got "${month}"`);
  }
  const monthStart = `${month}-01`;
  const txnRef = `SEED-${month.replace('-', '')}-RECON`;

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const owner = await client.query<{ id: string }>(
      `select id from profiles where role = 'owner' and active order by created_at limit 1`,
    );
    if (owner.rowCount === 0)
      throw new Error('No active owner profile; run pnpm db:bootstrap first');
    const ownerId = owner.rows[0]!.id;

    const fixture = await client.query<{ id: string; entry_number: string | null }>(
      `select id, entry_number from entries where txn_ref = $1 and status = 'active' limit 1`,
      [txnRef],
    );
    if (fixture.rowCount && fixture.rows[0]) {
      console.log(
        `Already seeded: entry ${fixture.rows[0].entry_number ?? fixture.rows[0].id} carries ${txnRef}`,
      );
      await reportMonth(client, monthStart);
      return;
    }

    const occupied = await client.query<{
      entries: string;
      statements: string;
      settlements: string;
      closes: string;
    }>(
      `select
         (select count(*) from entries where date_trunc('month', entry_date)::date = $1) as entries,
         (select count(*) from statements where month = $1) as statements,
         (select count(*) from settlements where month = $1) as settlements,
         (select count(*) from month_closes where month = $1) as closes`,
      [monthStart],
    );
    const counts = occupied.rows[0]!;
    if (
      Number(counts.entries) +
        Number(counts.statements) +
        Number(counts.settlements) +
        Number(counts.closes) >
      0
    ) {
      throw new Error(
        `Month ${month} is not empty (entries ${counts.entries}, statements ${counts.statements}, ` +
          `settlements ${counts.settlements}, closes ${counts.closes}); pick another month`,
      );
    }

    const profile = await client.query<{
      id: string;
      version: number;
      vat_mode: RateSnapshot['vat']['mode'];
      vat_bp: number;
      commission_bp: number;
      commission_base: RateSnapshot['commission']['base'];
      charges_borne_by: RateSnapshot['chargesBorneBy'];
    }>(
      `select id, version, vat_mode, vat_bp, commission_bp, commission_base, charges_borne_by
       from rate_profiles
       where status = 'published' and effective_from <= $1
       order by effective_from desc, version desc
       limit 1`,
      [monthStart],
    );
    if (profile.rowCount === 0) throw new Error(`No published rate profile covers ${monthStart}`);
    const p = profile.rows[0]!;

    const method = await client.query<{ id: string; code: string; charge_bp: number }>(
      `select pm.id, pm.code, mr.charge_bp
       from payment_methods pm
       join method_rates mr on mr.method_id = pm.id and mr.rate_profile_id = $1
       where pm.code = $2 and pm.active`,
      [p.id, methodCode],
    );
    if (method.rowCount === 0)
      throw new Error(`Method "${methodCode}" is not active under profile ${p.version}`);
    const m = method.rows[0]!;

    const grossPoisha = 250000n; // ৳2,500.00
    const snapshot: RateSnapshot = {
      rateProfileId: p.id,
      version: p.version,
      engineVersion: ENGINE_VERSION,
      vat: { mode: p.vat_mode, bp: p.vat_bp },
      commission: { bp: p.commission_bp, base: p.commission_base },
      chargeBp: m.charge_bp,
      chargesBorneBy: p.charges_borne_by,
      rounding: 'half_up',
    };
    const calc = calculateEntry({
      grossPoisha,
      snapshot,
      vatInputPoisha: p.vat_mode === 'manual' ? 0n : undefined,
    });

    const entryId = crypto.randomUUID().toLowerCase();
    const clientCreatedAt = new Date().toISOString();
    const payload = {
      id: entryId,
      entryId,
      entryDate: monthStart,
      customerName: `Recon fixture ${month}`,
      subQty: 1,
      subDescription: 'Seed for the month-close empty-state reconciliation link',
      methodId: m.id,
      grossPoisha: grossPoisha.toString(),
      snapshot,
      rateSnapshot: snapshot,
      vatInputPoisha: p.vat_mode === 'manual' ? '0' : null,
      vatOverridePoisha: null,
      commissionOverridePoisha: null,
      vatPoisha: calc.vatPoisha.toString(),
      commissionPoisha: calc.commissionPoisha.toString(),
      chargePoisha: calc.chargePoisha.toString(),
      businessChargePoisha: calc.businessChargePoisha.toString(),
      customerChargePoisha: calc.customerChargePoisha.toString(),
      netPoisha: calc.netAfterDeductionsPoisha.toString(),
      netAfterDeductionsPoisha: calc.netAfterDeductionsPoisha.toString(),
      txnRef,
      notes: `Seeded fixture for ${month}: unpaid payables, no statements.`,
      rateProfileId: p.id,
    };

    const opId = crypto.randomUUID().toLowerCase();
    const serverHash = await computeJcsSha256({
      type: 'create_entry',
      payload,
      supersedesRejectedOpId: null,
      clientCreatedAt,
      maxKnownRateVersion: p.version,
    });
    const op = {
      opId,
      type: 'create_entry',
      payload,
      clientCreatedAt,
      payloadHash: serverHash,
      serverHash,
      maxKnownRateVersion: p.version,
    };

    const pushed = await client.query<{ result: unknown }>(
      `select rpc_push_sync_op($1, $2, 'owner'::user_role, $3::jsonb) as result`,
      [FIXTURE_DEVICE_ID, ownerId, JSON.stringify([op])],
    );
    const result = pushed.rows[0]?.result as
      { results?: Array<{ status?: string; reason?: string }> } | undefined;
    const first = result?.results?.[0];
    if (first?.status !== 'ok') {
      throw new Error(`Push rejected: ${JSON.stringify(result ?? null)}`);
    }

    const stored = await client.query<{ entry_number: string | null }>(
      `select entry_number from entries where id = $1`,
      [entryId],
    );
    console.log(
      `Seeded ${month}: entry ${stored.rows[0]?.entry_number ?? entryId} on ${m.code}, gross ${grossPoisha}`,
    );
    console.log(`Charge ${calc.businessChargePoisha} poisha → bkash payable becomes due`);
    await reportMonth(client, monthStart);
    console.log(
      `Open /months/close?month=${month} and use the empty-state link to ${'/reconcile?month=' + month}`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

async function reportMonth(client: pg.PoolClient, monthStart: string): Promise<void> {
  const settlements = await client.query<{ code: string; status: string; expected: string }>(
    `select p.code, s.status, s.expected_poisha::text as expected
     from settlements s join payables p on p.id = s.payable_id
     where s.month = $1 order by p.code`,
    [monthStart],
  );
  const statements = await client.query<{ count: string }>(
    `select count(*)::text as count from statements where month = $1`,
    [monthStart],
  );
  for (const row of settlements.rows) {
    console.log(`  settlement ${row.code}: ${row.status} (expected ${row.expected} poisha)`);
  }
  const liable = settlements.rows.filter(
    (r) => r.status !== 'not_applicable' && r.status !== 'reconciled',
  );
  console.log(`  statements: ${statements.rows[0]?.count ?? '0'} (needs 0)`);
  console.log(`  unreconciled liable settlements: ${liable.length} (needs >= 1)`);
  if (statements.rows[0]?.count !== '0')
    throw new Error('Month has statements; the empty-state branch needs none');
  if (liable.length === 0)
    throw new Error('No payable-bearing settlement was generated for this month');
}

await main();
