import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 10 — the impact preview and the `dataVersion` that binds an apply to it.
 *
 * The hash is the whole safety property: an apply recomputes it inside the transaction
 * that takes the month lock and refuses on a mismatch, so if the version ignores a field
 * the apply can change, a preview that no longer describes the data would be accepted.
 * These tests therefore pin the tuple's composition field by field, then prove that a
 * change to each part of the data moves the hash, and that the preview reports the
 * effects — settlement deltas, statement matches that would reset, month state and
 * blockers — for the entry in question.
 */

const FIXTURE = vi.hoisted(() => {
  const MHK = '11111111-1111-4111-8111-111111111111';
  const RMP = '22222222-2222-4222-8222-222222222222';
  const ENTRY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const M_BK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const M_CD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const P_VAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const P_BK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const P_CD = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  interface State {
    entries: { maxServerSeq: string; count: number };
    settlements: Array<{
      id: string;
      payableId: string;
      kind: string;
      methodId: string | null;
      expectedPoisha: string;
      paidPoisha: string;
      status: string;
    }>;
    statements: Array<{ id: string; status: string }>;
    monthClose: string | null;
    entry: {
      id: string;
      centerId: string;
      entryNumber: string | null;
      entryDate: string;
      status: string;
      methodId: string;
      grossPoisha: string;
      vatPoisha: string;
      businessChargePoisha: string;
      customerChargePoisha: string;
    } | null;
    lines: Array<{ statementId: string; matchedEntryId: string; active: boolean }>;
  }

  function initialState(): State {
    return {
      entries: { maxServerSeq: '12', count: 4 },
      settlements: [
        {
          id: 'settle-vat',
          payableId: P_VAT,
          kind: 'vat',
          methodId: null,
          expectedPoisha: '1000',
          paidPoisha: '0',
          status: 'due',
        },
        {
          id: 'settle-bkash',
          payableId: P_BK,
          kind: 'method_charge',
          methodId: M_BK,
          expectedPoisha: '300',
          paidPoisha: '100',
          status: 'partly_paid',
        },
        {
          id: 'settle-card',
          payableId: P_CD,
          kind: 'method_charge',
          methodId: M_CD,
          expectedPoisha: '0',
          paidPoisha: '0',
          status: 'not_applicable',
        },
      ],
      statements: [
        { id: 'stmt-a', status: 'reconciled' },
        { id: 'stmt-b', status: 'superseded' },
      ],
      monthClose: null,
      entry: {
        id: ENTRY,
        centerId: MHK,
        entryNumber: '7',
        entryDate: '2026-11-04',
        status: 'active',
        methodId: M_BK,
        grossPoisha: '10000',
        vatPoisha: '1000',
        businessChargePoisha: '300',
        customerChargePoisha: '0',
      },
      lines: [
        { statementId: 'stmt-a', matchedEntryId: ENTRY, active: true },
        { statementId: 'stmt-a', matchedEntryId: ENTRY, active: true },
        { statementId: 'stmt-a', matchedEntryId: ENTRY, active: false },
      ],
    };
  }

  /**
   * A fake pool for the eight statements this feature issues, recognised by shape. It
   * mirrors the predicates the SQL applies (non-superseded statements, active match
   * lines) so an assertion failure means the module asked for the wrong thing.
   */
  function makeDb(state: State) {
    const queries: string[] = [];
    return {
      queries,
      async query(sql: string, params: unknown[] = []) {
        queries.push(sql);

        if (/max\(server_seq\)/.test(sql)) {
          return {
            rows: [
              { max_server_seq: state.entries.maxServerSeq, entry_count: state.entries.count },
            ],
          };
        }

        if (/FROM settlements/.test(sql) && !/JOIN payables/.test(sql)) {
          return {
            rows: state.settlements.map((row) => ({
              id: row.id,
              status: row.status,
              expected_poisha: row.expectedPoisha,
              paid_poisha: row.paidPoisha,
            })),
          };
        }

        if (/FROM settlements/.test(sql)) {
          // Mirrors the SQL's `ORDER BY p.kind, p.method_id, s.id`.
          return {
            rows: [...state.settlements]
              .sort(
                (a, b) =>
                  a.kind.localeCompare(b.kind) ||
                  (a.methodId ?? '').localeCompare(b.methodId ?? '') ||
                  a.id.localeCompare(b.id),
              )
              .map((row) => ({
                id: row.id,
                payable_id: row.payableId,
                kind: row.kind,
                method_id: row.methodId,
                expected_poisha: row.expectedPoisha,
                paid_poisha: row.paidPoisha,
              })),
          };
        }

        if (/FROM statements/.test(sql) && !/JOIN statement_lines/.test(sql)) {
          return {
            rows: state.statements
              .filter((row) => row.status !== 'superseded')
              .map((row) => ({ id: row.id, status: row.status })),
          };
        }

        if (/FROM month_closes/.test(sql)) {
          return { rows: state.monthClose ? [{ status: state.monthClose }] : [] };
        }

        if (/FROM entries/.test(sql)) {
          const entry = state.entry;
          if (!entry) return { rows: [] };
          return {
            rows: [
              {
                id: entry.id,
                entry_number: entry.entryNumber,
                entry_date: entry.entryDate,
                status: entry.status,
                method_id: entry.methodId,
                gross_poisha: entry.grossPoisha,
                vat_poisha: entry.vatPoisha,
                business_charge_poisha: entry.businessChargePoisha,
                customer_charge_poisha: entry.customerChargePoisha,
              },
            ],
          };
        }

        if (/JOIN statement_lines/.test(sql)) {
          const matched = state.lines.filter(
            (line) => line.active && line.matchedEntryId === String(params[2]),
          );
          const byStatement = new Map<string, number>();
          for (const line of matched) {
            byStatement.set(line.statementId, (byStatement.get(line.statementId) ?? 0) + 1);
          }
          return {
            rows: [...byStatement.entries()]
              .filter(([id]) =>
                state.statements.some(
                  (statement) => statement.id === id && statement.status !== 'superseded',
                ),
              )
              .map(([id, count]) => ({
                statement_id: id,
                status: state.statements.find((statement) => statement.id === id)!.status,
                matched_lines: count,
              })),
          };
        }

        throw new Error(`fixture pool received an unrecognised statement: ${sql.slice(0, 70)}`);
      },
    };
  }

  return { MHK, RMP, ENTRY, M_BK, initialState, makeDb };
});

const SCOPE = { centerId: FIXTURE.MHK, month: '2026-11-01' };

const { canonicalVersionTuple, computeDataVersion, loadVersionSnapshot, previewEntryImpact } =
  await import('../../src/lib/server/impact-preview');

async function versionFor(state: ReturnType<typeof FIXTURE.initialState>, scope = SCOPE) {
  return (await computeDataVersion(FIXTURE.makeDb(state), scope)).dataVersion;
}

describe('dataVersion composition (plan 023 step 10)', () => {
  it('hashes exactly the tuple the plan names, in a fixed order', async () => {
    const state = FIXTURE.initialState();
    const snapshot = await loadVersionSnapshot(FIXTURE.makeDb(state), SCOPE);

    expect(JSON.parse(canonicalVersionTuple(SCOPE, snapshot))).toEqual({
      v: 1,
      centerId: FIXTURE.MHK,
      month: '2026-11-01',
      // max(entries.server_seq) and count(entries)
      maxServerSeq: '12',
      entryCount: 4,
      // each settlement row's (id, status, expected, paid), sorted by id in SQL
      settlements: [
        ['settle-vat', 'due', '1000', '0'],
        ['settle-bkash', 'partly_paid', '300', '100'],
        ['settle-card', 'not_applicable', '0', '0'],
      ],
      // each active (non-superseded) statement's (id, status)
      statements: [['stmt-a', 'reconciled']],
      // whether a month_closes row exists
      monthClose: null,
    });
  });

  it('is a 64-character hex digest, stable across identical reads', async () => {
    const db = FIXTURE.makeDb(FIXTURE.initialState());
    const first = await computeDataVersion(db, SCOPE);
    const second = await computeDataVersion(db, SCOPE);

    expect(first.dataVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(second.dataVersion).toBe(first.dataVersion);
  });

  it('changes when any part of the bound data changes', async () => {
    const baseline = await versionFor(FIXTURE.initialState());

    const variants: Array<[string, (state: ReturnType<typeof FIXTURE.initialState>) => void]> = [
      ['settlement status', (s) => (s.settlements[0].status = 'partly_paid')],
      ['settlement expected', (s) => (s.settlements[0].expectedPoisha = '1001')],
      ['settlement paid', (s) => (s.settlements[1].paidPoisha = '101')],
      ['settlement removed', (s) => s.settlements.pop()],
      ['entries high-water mark', (s) => (s.entries.maxServerSeq = '13')],
      ['entry count', (s) => (s.entries.count = 5)],
      ['statement added', (s) => s.statements.push({ id: 'stmt-c', status: 'open' })],
      ['statement status', (s) => (s.statements[0].status = 'open')],
      ['month closed', (s) => (s.monthClose = 'closed')],
    ];

    for (const [label, mutate] of variants) {
      const state = FIXTURE.initialState();
      mutate(state);
      expect(await versionFor(state), `${label} must move the version`).not.toBe(baseline);
    }
  });

  it('ignores a superseded statement, which the read excludes', async () => {
    const state = FIXTURE.initialState();
    const baseline = await versionFor(state);

    // A superseded statement is not part of the bound data, so adding one changes nothing;
    // activating one does.
    state.statements.push({ id: 'stmt-c', status: 'superseded' });
    expect(await versionFor(state)).toBe(baseline);

    state.statements = [
      { id: 'stmt-a', status: 'reconciled' },
      { id: 'stmt-b', status: 'open' },
    ];
    expect(await versionFor(state)).not.toBe(baseline);
  });

  it('separates centers and months', async () => {
    const state = FIXTURE.initialState();
    const baseline = await versionFor(state);

    expect(await versionFor(state, { centerId: FIXTURE.RMP, month: SCOPE.month })).not.toBe(
      baseline,
    );
    expect(await versionFor(state, { centerId: SCOPE.centerId, month: '2026-12-01' })).not.toBe(
      baseline,
    );
  });
});

describe('previewEntryImpact (plan 023 step 10)', () => {
  it('reports the settlement deltas the void would cause', async () => {
    const preview = await previewEntryImpact(FIXTURE.makeDb(FIXTURE.initialState()), {
      centerId: FIXTURE.MHK,
      entryId: FIXTURE.ENTRY,
      action: 'void',
    });

    expect(preview).not.toBeNull();
    expect(preview!.month).toBe('2026-11-01');
    expect(preview!.entry).toMatchObject({ id: FIXTURE.ENTRY, status: 'active' });

    // The card stream has no contribution from this entry, so it is not listed.
    expect(preview!.settlementDeltas.map((delta) => delta.kind)).toEqual(['method_charge', 'vat']);

    const vat = preview!.settlementDeltas.find((delta) => delta.kind === 'vat')!;
    expect(vat).toMatchObject({
      expectedBefore: '1000',
      expectedAfter: '0',
      paidPoisha: '0',
      statusBefore: 'due',
      statusAfter: 'not_applicable',
    });

    const bkash = preview!.settlementDeltas.find((delta) => delta.kind === 'method_charge')!;
    expect(bkash).toMatchObject({
      expectedBefore: '300',
      expectedAfter: '0',
      paidPoisha: '100',
      statusBefore: 'partly_paid',
      // A payment already made against a liability that disappears.
      statusAfter: 'overpaid',
    });
    expect(preview!.warnings).toContain('settlement_becomes_overpaid');
    expect(preview!.blockers).toEqual([]);
  });

  it('lists the statements whose matches would reset', async () => {
    const preview = await previewEntryImpact(FIXTURE.makeDb(FIXTURE.initialState()), {
      centerId: FIXTURE.MHK,
      entryId: FIXTURE.ENTRY,
      action: 'supersede',
    });

    expect(preview!.statementsReset).toEqual([
      { statementId: 'stmt-a', status: 'reconciled', matchedLines: 2 },
    ]);
    expect(preview!.warnings).toContain('reconciled_statements_reset');
    // The inactive match line is not counted.
    expect(preview!.statementsReset[0].matchedLines).toBe(2);
  });

  it('blocks a closed month and an entry that is already inactive', async () => {
    const closed = FIXTURE.initialState();
    closed.monthClose = 'closed';
    const closedPreview = await previewEntryImpact(FIXTURE.makeDb(closed), {
      centerId: FIXTURE.MHK,
      entryId: FIXTURE.ENTRY,
      action: 'void',
    });
    expect(closedPreview!.blockers).toContain('month_closed');
    expect(closedPreview!.monthState).toEqual({ status: 'closed', closed: true });

    const inactive = FIXTURE.initialState();
    inactive.entry!.status = 'voided';
    const inactivePreview = await previewEntryImpact(FIXTURE.makeDb(inactive), {
      centerId: FIXTURE.MHK,
      entryId: FIXTURE.ENTRY,
      action: 'void',
    });
    expect(inactivePreview!.blockers).toContain('entry_not_active');
    // Nothing changes for an entry that no longer contributes.
    expect(inactivePreview!.settlementDeltas).toEqual([]);
  });

  it('returns null for an entry outside the named center', async () => {
    const state = FIXTURE.initialState();
    state.entry = null;
    expect(
      await previewEntryImpact(FIXTURE.makeDb(state), {
        centerId: FIXTURE.MHK,
        entryId: FIXTURE.ENTRY,
        action: 'void',
      }),
    ).toBeNull();
  });

  it('carries the same version an apply will recompute', async () => {
    const state = FIXTURE.initialState();
    const db = FIXTURE.makeDb(state);
    const preview = await previewEntryImpact(db, {
      centerId: FIXTURE.MHK,
      entryId: FIXTURE.ENTRY,
      action: 'void',
    });

    expect(preview!.dataVersion).toBe(await versionFor(FIXTURE.initialState()));

    // Any change between preview and apply moves it, which is what `409 stale_preview` keys on.
    state.settlements[0].paidPoisha = '250';
    expect(preview!.dataVersion).not.toBe(await versionFor(state));
  });
});

describe('POST /api/v1/admin/super/ledger/impact', () => {
  const state = FIXTURE.initialState();

  beforeEach(() => {
    Object.assign(state, FIXTURE.initialState());
    vi.resetModules();
  });

  async function loadRoute() {
    vi.doMock('$lib/server/auth', () => ({
      getCallerContext: async () => ({
        userId: 'seat',
        role: 'super_admin',
        aal: 'aal2',
        centerId: null,
      }),
      requireRole: () => undefined,
    }));
    vi.doMock('$lib/server/assurance', () => ({ requireAssurance: () => undefined }));
    vi.doMock('$lib/server/capabilities', () => ({ requireCapability: () => undefined }));
    vi.doMock('$lib/server/db', () => ({ getDbPool: () => FIXTURE.makeDb(state) }));
    return (await import('../../src/routes/api/v1/admin/super/ledger/impact/+server')).POST;
  }

  function event(body: unknown): RequestEvent {
    const url = new URL('http://localhost/api/v1/admin/super/ledger/impact');
    return {
      url,
      request: new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as unknown as RequestEvent;
  }

  it('returns the version and the preview together', async () => {
    const POST = await loadRoute();
    const response = await POST(
      event({ centerId: FIXTURE.MHK, entryId: FIXTURE.ENTRY, action: 'void' }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dataVersion: string;
      preview: { dataVersion: string; settlementDeltas: unknown[]; blockers: string[] };
    };
    expect(body.dataVersion).toBe(body.preview.dataVersion);
    expect(body.dataVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(body.preview.settlementDeltas).toHaveLength(2);
    expect(body.preview.blockers).toEqual([]);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses a malformed body', async () => {
    const POST = await loadRoute();

    const badAction = await POST(
      event({ centerId: FIXTURE.MHK, entryId: FIXTURE.ENTRY, action: 'delete' }),
    );
    expect(badAction.status).toBe(400);
    expect(((await badAction.json()) as { error: string }).error).toBe('invalid_body');

    const missingScope = await POST(event({ entryId: FIXTURE.ENTRY, action: 'void' }));
    expect(missingScope.status).toBe(400);
  });

  it('answers 404 for an entry the center does not hold', async () => {
    const POST = await loadRoute();
    state.entry = null;

    const response = await POST(
      event({ centerId: FIXTURE.MHK, entryId: FIXTURE.ENTRY, action: 'void' }),
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe('entry_not_found');
  });
});
