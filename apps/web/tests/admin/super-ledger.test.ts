import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 9 — `/api/v1/admin/super/ledger` against a fixture fleet.
 *
 * The route is the one place where the app reads more than one center with the
 * privileged pool, which bypasses RLS: the `centerId` predicate is the only thing keeping
 * one center's rows out of another's page and totals. So this test runs the shipped
 * handler over a two-center fixture and pins the three properties that would silently
 * break if the predicate moved or the aggregates drifted:
 *
 *  - scope isolation: a single-center read never returns the other center's rows, and its
 *    totals describe only that center;
 *  - cursor pagination: pages are keyset on `(server_seq, id)`, tile without overlap, and
 *    the last page reports no cursor;
 *  - total accuracy: totals are computed over the whole scope, not the page, and money
 *    stays integer poisha in decimal strings.
 *
 * The fake pool is the process boundary. It reads the placeholders out of each statement
 * (`e.center_id = $1`, `LIMIT $3`, …) instead of assuming an argument order, so a route
 * change that reorders predicates keeps working while a route change that drops one
 * fails the assertions.
 */

const FIXTURE = vi.hoisted(() => {
  const MHK = '11111111-1111-4111-8111-111111111111';
  const RMP = '22222222-2222-4222-8222-222222222222';
  const CASH = '33333333-3333-4333-8333-333333333333';
  const BANK = '44444444-4444-4444-8444-444444444444';
  const UPI = '55555555-5555-4555-8555-555555555555';
  const U_OWNER = '66666666-6666-4666-8666-666666666666';
  const U_ADMIN = '77777777-7777-4777-8777-777777777777';
  const U_STAFF = '88888888-8888-4888-8888-888888888888';

  const centers = [
    { id: MHK, code: 'MHK', name: 'MHK Center' },
    { id: RMP, code: 'RMP', name: 'RMP Center' },
  ];
  const methods = [
    { id: CASH, code: 'CASH', name: 'Cash' },
    { id: BANK, code: 'BANK', name: 'Bank transfer' },
    { id: UPI, code: 'UPI', name: 'UPI' },
  ];
  const profiles = [
    { id: U_OWNER, full_name: 'Owner One', role: 'owner' },
    { id: U_ADMIN, full_name: 'Admin Two', role: 'admin' },
    { id: U_STAFF, full_name: 'Staff Three', role: 'staff' },
  ];

  interface FixtureEntry {
    id: string;
    center_id: string;
    server_seq: number;
    entry_number: number;
    entry_date: string;
    customer_name: string;
    txn_ref: string;
    method_id: string;
    gross_poisha: string;
    vat_poisha: string;
    commission_poisha: string;
    charge_poisha: string;
    net_poisha: string;
    status: string;
    stale_rates: boolean;
    created_by: string;
    created_at: string;
  }

  const entry = (
    seq: number,
    center_id: string,
    entry_date: string,
    method_id: string,
    gross: number,
    status: string,
    created_by: string,
    stale_rates = false,
  ): FixtureEntry => ({
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    center_id,
    server_seq: seq,
    entry_number: seq,
    entry_date,
    customer_name: `Customer ${seq}`,
    txn_ref: `TXN-${seq}`,
    method_id,
    gross_poisha: String(gross),
    vat_poisha: '0',
    commission_poisha: '0',
    charge_poisha: '0',
    net_poisha: String(gross),
    status,
    stale_rates,
    created_by,
    created_at: `${entry_date}T10:00:00.000Z`,
  });

  const entries: FixtureEntry[] = [
    entry(1, MHK, '2026-11-01', CASH, 1000, 'active', U_OWNER),
    entry(2, RMP, '2026-11-01', BANK, 2000, 'active', U_ADMIN),
    entry(3, MHK, '2026-11-02', CASH, 1500, 'active', U_OWNER),
    entry(4, MHK, '2026-11-03', BANK, 2500, 'voided', U_STAFF),
    entry(5, RMP, '2026-11-03', CASH, 500, 'active', U_ADMIN),
    entry(6, MHK, '2026-11-04', CASH, 12500, 'active', U_OWNER),
    entry(7, MHK, '2026-11-05', UPI, 700, 'superseded', U_STAFF),
    entry(8, RMP, '2026-11-05', BANK, 900, 'active', U_ADMIN),
  ];

  type Params = unknown[];

  /** The index of the placeholder matched by `pattern`, so params are read by meaning. */
  function indexOf(sql: string, pattern: RegExp): number | null {
    const match = sql.match(pattern);
    return match ? Number(match[1]) : null;
  }

  function at(params: Params, sql: string, pattern: RegExp): unknown {
    const index = indexOf(sql, pattern);
    return index === null ? undefined : params[index - 1];
  }

  function filtered(sql: string, params: Params) {
    const centerId = at(params, sql, /e\.center_id = \$(\d+)/);
    const from = at(params, sql, /e\.entry_date >= \$(\d+)::date/);
    const to = at(params, sql, /e\.entry_date <= \$(\d+)::date/);
    const methodId = at(params, sql, /e\.method_id = \$(\d+)/);
    const status = at(params, sql, /e\.status = \$(\d+)::entry_status/);
    const createdBy = at(params, sql, /e\.created_by = \$(\d+)/);

    return entries.filter(
      (row) =>
        (centerId === undefined || row.center_id === centerId) &&
        (from === undefined || row.entry_date >= String(from)) &&
        (to === undefined || row.entry_date <= String(to)) &&
        (methodId === undefined || row.method_id === methodId) &&
        (status === undefined || row.status === status) &&
        (createdBy === undefined || row.created_by === createdBy),
    );
  }

  const centerOf = (id: string) => centers.find((center) => center.id === id)!;
  const methodOf = (id: string) => methods.find((method) => method.id === id);
  const profileOf = (id: string) => profiles.find((profile) => profile.id === id);

  const log: Array<{ kind: string; sql: string; params: Params }> = [];

  function run(sql: string, params: Params = []): unknown[] {
    if (/SELECT e\.id,/.test(sql)) {
      log.push({ kind: 'page', sql, params });
      let rows = filtered(sql, params);

      const cursor = sql.match(/\(e\.server_seq, e\.id\) < \(\$(\d+)::bigint, \$(\d+)::uuid\)/);
      if (cursor) {
        const seq = Number(params[Number(cursor[1]) - 1]);
        const id = String(params[Number(cursor[2]) - 1]);
        rows = rows.filter(
          (row) => row.server_seq < seq || (row.server_seq === seq && row.id < id),
        );
      }

      const limitIndex = indexOf(sql, /LIMIT \$(\d+)\s*$/);
      const limit = limitIndex === null ? rows.length : Number(params[limitIndex - 1]);

      return rows
        .sort((a, b) => b.server_seq - a.server_seq || (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map((row) => {
          const center = centerOf(row.center_id);
          const method = methodOf(row.method_id);
          const profile = profileOf(row.created_by);
          return {
            id: row.id,
            center_id: row.center_id,
            server_seq: String(row.server_seq),
            entry_number: String(row.entry_number),
            entry_date: row.entry_date,
            customer_name: row.customer_name,
            txn_ref: row.txn_ref,
            method_id: row.method_id,
            gross_poisha: row.gross_poisha,
            vat_poisha: row.vat_poisha,
            commission_poisha: row.commission_poisha,
            charge_poisha: row.charge_poisha,
            net_poisha: row.net_poisha,
            status: row.status,
            stale_rates: row.stale_rates,
            created_by: row.created_by,
            created_at: row.created_at,
            center_code: center.code,
            center_name: center.name,
            method_code: method?.code ?? null,
            method_name: method?.name ?? null,
            created_by_name: profile?.full_name ?? null,
            created_by_role: profile?.role ?? null,
          };
        });
    }

    if (/count\(\*\)::int/.test(sql)) {
      log.push({ kind: 'totals', sql, params });
      const rows = filtered(sql, params);
      return centers
        .map((center) => {
          const own = rows.filter((row) => row.center_id === center.id);
          return {
            center_id: center.id,
            code: center.code,
            name: center.name,
            entry_count: own.length,
            gross_poisha: own.reduce((sum, row) => sum + BigInt(row.gross_poisha), 0n).toString(),
          };
        })
        .filter((row) => row.entry_count > 0)
        .sort((a, b) => a.code.localeCompare(b.code));
    }

    if (/SELECT DISTINCT pm\.id/.test(sql)) {
      log.push({ kind: 'methods', sql, params });
      const used = new Set(filtered(sql, params).map((row) => row.method_id));
      return methods
        .filter((method) => used.has(method.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((method) => ({ id: method.id, code: method.code, name: method.name }));
    }

    if (/SELECT DISTINCT p\.id/.test(sql)) {
      log.push({ kind: 'creators', sql, params });
      const used = new Set(filtered(sql, params).map((row) => row.created_by));
      return profiles
        .filter((profile) => used.has(profile.id))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .map((profile) => ({ id: profile.id, full_name: profile.full_name, role: profile.role }));
    }

    throw new Error(`fixture pool received an unrecognised statement: ${sql.slice(0, 60)}`);
  }

  return {
    MHK,
    RMP,
    CASH,
    BANK,
    UPI,
    U_OWNER,
    U_ADMIN,
    U_STAFF,
    entries,
    log,
    run,
  };
});

vi.mock('$lib/server/auth', () => ({
  getCallerContext: async () => ({
    userId: 'seat-user',
    role: 'super_admin',
    aal: 'aal2',
    centerId: null,
  }),
  requireRole: () => undefined,
}));
vi.mock('$lib/server/assurance', () => ({ requireAssurance: () => undefined }));
vi.mock('$lib/server/capabilities', () => ({ requireCapability: () => undefined }));
vi.mock('$lib/server/db', () => ({
  getDbPool: () => ({
    query: async (sql: string, params: unknown[]) => ({ rows: FIXTURE.run(sql, params) }),
  }),
}));

const { GET } = await import('../../src/routes/api/v1/admin/super/ledger/+server');

type LedgerRow = {
  id: string;
  centerId: string;
  centerCode: string;
  serverSeq: string;
  entryId: string | null;
  entryDate: string;
  grossPoisha: string;
  status: string;
  createdByName: string | null;
};

type LedgerBody = {
  scope: { centerId: string; from: string | null; to: string | null };
  entries: LedgerRow[];
  nextCursor: string | null;
  totals: {
    count: number;
    grossPoisha: string;
    byCenter: Array<{
      centerId: string;
      code: string;
      count: number;
      grossPoisha: string;
    }>;
  };
  facets: { methods: Array<{ code: string }>; creators: Array<{ id: string }> };
};

function event(query: Record<string, string>): RequestEvent {
  const url = new URL('http://localhost/api/v1/admin/super/ledger');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { url, request: new Request(url) } as unknown as RequestEvent;
}

async function read(query: Record<string, string>): Promise<LedgerBody> {
  const response = await GET(event(query));
  return (await response.json()) as LedgerBody;
}

beforeEach(() => {
  FIXTURE.log.length = 0;
});

const MHK_GROSS = '18200'; // 1000 + 1500 + 2500 + 12500 + 700
const RMP_GROSS = '3400'; // 2000 + 500 + 900
const FLEET_GROSS = '21600';

describe('GET /api/v1/admin/super/ledger against a fixture fleet', () => {
  it('keeps one center out of another center’s page and totals', async () => {
    const body = await read({ centerId: FIXTURE.MHK, limit: '50' });

    expect(body.entries).toHaveLength(5);
    expect(new Set(body.entries.map((row) => row.centerId))).toEqual(new Set([FIXTURE.MHK]));
    expect(body.entries.map((row) => row.centerCode)).toEqual(['MHK', 'MHK', 'MHK', 'MHK', 'MHK']);
    expect(body.totals.byCenter).toHaveLength(1);
    expect(body.totals.byCenter[0]).toMatchObject({
      centerId: FIXTURE.MHK,
      code: 'MHK',
      count: 5,
      grossPoisha: MHK_GROSS,
    });
    expect(body.totals).toMatchObject({ count: 5, grossPoisha: MHK_GROSS });

    // The other center's rows exist in the fixture and must not appear anywhere here.
    const rmpIds = FIXTURE.entries
      .filter((row) => row.center_id === FIXTURE.RMP)
      .map((row) => row.id);
    expect(body.entries.filter((row) => rmpIds.includes(row.id))).toEqual([]);
    expect(body.entries.some((row) => row.grossPoisha === '2000')).toBe(false);
    expect(body.totals.byCenter.map((center) => center.code)).not.toContain('RMP');
  });

  it('reads the whole fleet when the scope is the literal all', async () => {
    const body = await read({ centerId: 'all' });

    expect(body.scope.centerId).toBe('all');
    expect(body.entries).toHaveLength(8);
    expect(body.totals.byCenter.map((center) => center.code)).toEqual(['MHK', 'RMP']);
    expect(body.totals.byCenter.map((center) => center.grossPoisha)).toEqual([
      MHK_GROSS,
      RMP_GROSS,
    ]);
    expect(body.totals).toMatchObject({ count: 8, grossPoisha: FLEET_GROSS });
  });

  it('pages by keyset without overlap and stops at the last page', async () => {
    const first = await read({ centerId: FIXTURE.MHK, limit: '2' });

    expect(first.entries.map((row) => row.serverSeq)).toEqual(['7', '6']);
    expect(first.nextCursor).toBe(`${first.entries[1].serverSeq}:${first.entries[1].id}`);
    // Totals describe the scope, never the page.
    expect(first.totals).toMatchObject({ count: 5, grossPoisha: MHK_GROSS });

    const second = await read({
      centerId: FIXTURE.MHK,
      limit: '2',
      cursor: first.nextCursor!,
    });

    expect(second.entries.map((row) => row.serverSeq)).toEqual(['4', '3']);
    expect(
      second.entries.filter((row) => first.entries.some((row2) => row2.id === row.id)),
    ).toEqual([]);
    expect(second.nextCursor).toBe(`${second.entries[1].serverSeq}:${second.entries[1].id}`);
    expect(second.totals).toMatchObject({ count: 5, grossPoisha: MHK_GROSS });

    const third = await read({
      centerId: FIXTURE.MHK,
      limit: '2',
      cursor: second.nextCursor!,
    });

    expect(third.entries.map((row) => row.serverSeq)).toEqual(['1']);
    expect(third.nextCursor).toBeNull();
    expect(third.totals).toMatchObject({ count: 5, grossPoisha: MHK_GROSS });

    const seen = [...first.entries, ...second.entries, ...third.entries].map((row) => row.id);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('keeps totals on the whole scope while a filter narrows the page', async () => {
    const body = await read({
      centerId: 'all',
      from: '2026-11-03',
      to: '2026-11-04',
      limit: '50',
    });

    expect(body.entries.map((row) => row.serverSeq)).toEqual(['6', '5', '4']);
    expect(body.totals).toMatchObject({ count: 3, grossPoisha: '15500' }); // 2500 + 500 + 12500
    expect(body.totals.byCenter.map((center) => center.count)).toEqual([2, 1]);
    expect(body.scope).toMatchObject({ from: '2026-11-03', to: '2026-11-04' });

    const active = await read({ centerId: FIXTURE.MHK, status: 'active', limit: '50' });
    expect(active.entries.map((row) => row.serverSeq)).toEqual(['6', '3', '1']);
    expect(active.totals).toMatchObject({ count: 3, grossPoisha: '15000' }); // 1000 + 1500 + 12500

    const cash = await read({ centerId: 'all', methodId: FIXTURE.CASH, limit: '50' });
    expect(cash.entries.every((row) => row.grossPoisha !== '2000')).toBe(true);
    // Seq 1, 3, 5 and 6 are the cash entries: 1000 + 1500 + 500 + 12500.
    expect(cash.totals).toMatchObject({ count: 4, grossPoisha: '15500' });

    // Facets follow the same scope, so a filter menu cannot offer a value the page cannot show.
    expect(active.facets.creators.map((creator) => creator.id)).toEqual([FIXTURE.U_OWNER]);
    expect(cash.facets.methods.map((method) => method.code)).toEqual(['CASH']);
  });

  it('keeps money as integer poisha strings and formats the display id', async () => {
    const body = await read({ centerId: FIXTURE.MHK, limit: '1' });

    expect(body.entries[0]).toMatchObject({
      grossPoisha: '700',
      serverSeq: '7',
      status: 'superseded',
      entryDate: '2026-11-05',
      createdByName: 'Staff Three',
      createdByRole: 'staff',
    });
    expect(typeof body.entries[0].grossPoisha).toBe('string');
    expect(body.entries[0].grossPoisha).toMatch(/^\d+$/);
    expect(body.entries[0].entryId).toBe('E-MHK-202611-000007');
    expect(typeof body.totals.grossPoisha).toBe('string');
    expect(body.totals.grossPoisha).toMatch(/^\d+$/);
  });

  it('refuses an omitted scope and a malformed cursor', async () => {
    const { url } = event({});
    const missing = await GET({ url, request: new Request(url) } as unknown as RequestEvent);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe('center_scope_required');

    const bad = await GET(event({ centerId: 'all', cursor: 'not-a-cursor' }) as RequestEvent);
    expect(bad.status).toBe(400);
    expect((await bad.json()) as { error: string }).toMatchObject({ error: 'invalid_query' });
  });
});
