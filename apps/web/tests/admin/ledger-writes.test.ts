import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 11 — the seat's void and supersede routes.
 *
 * Both routes exist to make one thing true: an apply cannot run against data the preview
 * did not describe. So the tests pin the ordering (month lock, then the version recompute,
 * then the write), the refusal (mismatch → `409 stale_preview` with **no** RPC call and a
 * ROLLBACK), and the fact that the write goes through the existing chain
 * (`rpc_push_sync_op` with one `void_entry` op / `rpc_supersede_entry`) rather than
 * touching `entries` itself.
 *
 * The fake client is the transaction boundary: it records every statement in order, so an
 * assertion can say "the lock came before the version read" instead of trusting the
 * comment that says so.
 */

const FIXTURE = vi.hoisted(() => {
  const CENTER = '11111111-1111-4111-8111-111111111111';
  const ENTRY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const REPLACEMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const SEAT = 'seat-user';

  interface State {
    entry: { entryDate: string; centerNumber: number } | null;
    snapshot: {
      entries: { maxServerSeq: string; count: number };
      settlements: Array<{
        id: string;
        status: string;
        expectedPoisha: string;
        paidPoisha: string;
      }>;
      statements: Array<{ id: string; status: string }>;
      monthClose: string | null;
    };
    rpc: { status: string; reason?: string } | { replacementEntryId: string };
    rpcThrows: string | null;
    statements: string[];
    commits: number;
    rollbacks: number;
    rpcCalls: Array<{ fn: string; params: unknown[] }>;
  }

  function initialState(): State {
    return {
      entry: { entryDate: '2026-11-04', centerNumber: 7 },
      snapshot: {
        entries: { maxServerSeq: '12', count: 4 },
        settlements: [{ id: 's1', status: 'due', expectedPoisha: '1000', paidPoisha: '0' }],
        statements: [],
        monthClose: null,
      },
      rpc: { status: 'ok' },
      rpcThrows: null,
      statements: [],
      commits: 0,
      rollbacks: 0,
      rpcCalls: [],
    };
  }

  function makeClient(state: State) {
    return {
      release: () => undefined,
      async query(sql: string, params: unknown[] = []) {
        const text = String(sql).trim();
        state.statements.push(text.split('\n')[0].trim());

        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          if (text === 'COMMIT') state.commits += 1;
          if (text === 'ROLLBACK') state.rollbacks += 1;
          return { rows: [], rowCount: 0 };
        }

        if (/pg_advisory_xact_lock/.test(text)) {
          expect(text.indexOf('1001')).toBeGreaterThan(-1);
          return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
        }

        if (/c\.center_number/.test(text)) {
          return {
            rows: state.entry
              ? [{ entry_date: state.entry.entryDate, center_number: state.entry.centerNumber }]
              : [],
            rowCount: state.entry ? 1 : 0,
          };
        }

        if (/max\(server_seq\)/.test(text)) {
          return {
            rows: [
              {
                max_server_seq: state.snapshot.entries.maxServerSeq,
                entry_count: state.snapshot.entries.count,
              },
            ],
          };
        }

        if (/FROM settlements/.test(text)) {
          return {
            rows: state.snapshot.settlements.map((row) => ({
              id: row.id,
              status: row.status,
              expected_poisha: row.expectedPoisha,
              paid_poisha: row.paidPoisha,
            })),
          };
        }

        if (/FROM statements/.test(text) && !/JOIN/.test(text)) {
          return { rows: state.snapshot.statements.map((row) => ({ ...row })) };
        }

        if (/FROM month_closes/.test(text)) {
          return { rows: state.snapshot.monthClose ? [{ status: state.snapshot.monthClose }] : [] };
        }

        if (/rpc_push_sync_op/.test(text)) {
          state.rpcCalls.push({ fn: 'rpc_push_sync_op', params });
          if (state.rpcThrows) throw new Error(state.rpcThrows);
          return { rows: [{ result: { results: [state.rpc] } }] };
        }

        if (/rpc_supersede_entry/.test(text)) {
          state.rpcCalls.push({ fn: 'rpc_supersede_entry', params });
          if (state.rpcThrows) throw new Error(state.rpcThrows);
          return { rows: [{ result: state.rpc }] };
        }

        throw new Error(`unexpected statement: ${text.slice(0, 70)}`);
      },
    };
  }

  function makePool(state: State) {
    return {
      async connect() {
        return makeClient(state);
      },
      async query(sql: string) {
        // Used by the supersede route's cross-month precheck.
        if (/SELECT entry_date::text AS entry_date FROM entries/.test(sql)) {
          state.statements.push('pool: entry date');
          return { rows: state.entry ? [{ entry_date: state.entry.entryDate }] : [] };
        }
        throw new Error(`unexpected pool statement: ${sql.slice(0, 70)}`);
      },
    };
  }

  return { CENTER, ENTRY, REPLACEMENT, SEAT, initialState, makePool };
});

const CALLER = vi.hoisted(() => ({
  userId: 'seat-user',
  role: 'super_admin',
  aal: 'aal2',
  centerId: null,
}));

const state = FIXTURE.initialState();

vi.mock('$lib/server/auth', () => ({
  getCallerContext: async () => CALLER,
  requireRole: () => undefined,
}));
vi.mock('$lib/server/assurance', () => ({ requireAssurance: () => undefined }));
vi.mock('$lib/server/capabilities', () => ({ requireCapability: () => undefined }));
vi.mock('$lib/server/db', () => ({ getDbPool: () => FIXTURE.makePool(state) }));

const { dataVersionOf } = await import('../../src/lib/server/impact-preview');
const voidRoute = await import('../../src/routes/api/v1/admin/super/ledger/void/+server');
const supersedeRoute = await import('../../src/routes/api/v1/admin/super/ledger/supersede/+server');

const SCOPE = { centerId: FIXTURE.CENTER, month: '2026-11-01' };

function currentVersion(): string {
  return dataVersionOf(SCOPE, {
    entries: state.snapshot.entries,
    settlements: state.snapshot.settlements,
    statements: state.snapshot.statements,
    monthClose: state.snapshot.monthClose as 'closed' | 'open' | null,
  });
}

function post(body: unknown): RequestEvent {
  const url = new URL('http://localhost/api/v1/admin/super/ledger/void');
  return {
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}

beforeEach(() => {
  Object.assign(state, FIXTURE.initialState());
});

describe('POST /api/v1/admin/super/ledger/void (plan 023 step 11)', () => {
  it('applies through rpc_push_sync_op once the version matches', async () => {
    const version = currentVersion();
    const response = await voidRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: version,
        reason: 'duplicate of E-MHK-202611-000004',
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; dataVersion: string; opId: string };
    expect(body.ok).toBe(true);
    expect(body.dataVersion).toBe(version);
    expect(body.opId).toMatch(/^[0-9a-f-]{36}$/);

    // The scope predicate is part of the read, not a caller assumption.
    expect(state.statements).toContain('BEGIN');
    expect(state.commits).toBe(1);
    expect(state.rollbacks).toBe(0);

    // Lock, then the version read, then the write — in that order.
    const lockIndex = state.statements.findIndex((line) => line.includes('pg_advisory_xact_lock'));
    const versionIndex = state.statements.findIndex((line) => line.includes('max(server_seq)'));
    const writeIndex = state.statements.findIndex((line) => line.includes('rpc_push_sync_op'));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(versionIndex).toBeGreaterThan(lockIndex);
    expect(writeIndex).toBeGreaterThan(versionIndex);

    expect(state.rpcCalls).toHaveLength(1);
    const [centerId, deviceId, actorId, ops] = state.rpcCalls[0].params as [
      string,
      string,
      string,
      string,
    ];
    expect(centerId).toBe(FIXTURE.CENTER);
    expect(deviceId).toBe(`platform:${FIXTURE.SEAT}`);
    expect(actorId).toBe(FIXTURE.SEAT);

    const parsedOps = JSON.parse(ops) as Array<{
      type: string;
      payload: { entryId: string; reason: string };
    }>;
    expect(parsedOps).toHaveLength(1);
    expect(parsedOps[0].type).toBe('void_entry');
    expect(parsedOps[0].payload.entryId).toBe(FIXTURE.ENTRY);
    expect(parsedOps[0].payload.reason).toBe('duplicate of E-MHK-202611-000004');
  });

  it('refuses a stale preview without calling the RPC', async () => {
    const stale = currentVersion();
    // The settlement row moves after the preview.
    state.snapshot.settlements[0].expectedPoisha = '1200';

    const response = await voidRoute.POST(
      post({ centerId: FIXTURE.CENTER, entryId: FIXTURE.ENTRY, dataVersion: stale }),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; expected: string };
    expect(body.error).toBe('stale_preview');
    expect(body.expected).toBe(currentVersion());
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.rollbacks).toBe(1);
    expect(state.commits).toBe(0);
  });

  it('reports the RPC’s refusal and rolls back', async () => {
    state.rpc = { status: 'rejected', reason: 'month_closed' };

    const response = await voidRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: currentVersion(),
      }),
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe('month_closed');
    expect(state.rollbacks).toBe(1);
    expect(state.commits).toBe(0);
  });

  it('answers 404 for an entry the center does not hold, before the write', async () => {
    state.entry = null;

    const response = await voidRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: currentVersion(),
      }),
    );

    expect(response.status).toBe(404);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.rollbacks).toBe(1);
  });

  it('refuses a body without a usable dataVersion', async () => {
    const missing = await voidRoute.POST(
      post({ centerId: FIXTURE.CENTER, entryId: FIXTURE.ENTRY }),
    );
    expect(missing.status).toBe(400);

    const short = await voidRoute.POST(
      post({ centerId: FIXTURE.CENTER, entryId: FIXTURE.ENTRY, dataVersion: 'abc' }),
    );
    expect(short.status).toBe(400);
    expect(state.statements).toHaveLength(0);
  });
});

describe('POST /api/v1/admin/super/ledger/supersede (plan 023 step 11)', () => {
  const replacement = {
    entryDate: '2026-11-04',
    customerName: 'Corrected customer',
    methodId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    grossPoisha: '100000',
    txnRef: 'TXN-CORRECTED',
    snapshot: { engineVersion: 1, version: 3 },
  };

  it('passes the replacement to rpc_supersede_entry untouched', async () => {
    state.rpc = { replacementEntryId: FIXTURE.REPLACEMENT };

    const response = await supersedeRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: currentVersion(),
        replacement,
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { replacementEntryId: string }).toMatchObject({
      originalEntryId: FIXTURE.ENTRY,
      replacementEntryId: FIXTURE.REPLACEMENT,
    });
    expect(state.commits).toBe(1);

    const [centerId, entryId, payload, actorId] = state.rpcCalls[0].params as [
      string,
      string,
      string,
      string,
    ];
    expect(centerId).toBe(FIXTURE.CENTER);
    expect(entryId).toBe(FIXTURE.ENTRY);
    expect(actorId).toBe(FIXTURE.SEAT);
    // The server does not recompute money: what the caller built with `calc` is forwarded,
    // and the RPC's own backstops are what verify it.
    expect(JSON.parse(payload)).toEqual(replacement);
  });

  it('refuses a stale preview without calling the RPC', async () => {
    const stale = currentVersion();
    state.snapshot.entries.count = 5;

    const response = await supersedeRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: stale,
        replacement,
      }),
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe('stale_preview');
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.rollbacks).toBe(1);
  });

  it('maps an RPC refusal thrown as an error to its HTTP status', async () => {
    state.rpcThrows = '422 month_closed';

    const response = await supersedeRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: currentVersion(),
        replacement,
      }),
    );

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe('month_closed');
    expect(state.rollbacks).toBe(1);
  });

  it('refuses a replacement that moves the entry to another month', async () => {
    const response = await supersedeRoute.POST(
      post({
        centerId: FIXTURE.CENTER,
        entryId: FIXTURE.ENTRY,
        dataVersion: currentVersion(),
        replacement: { ...replacement, entryDate: '2026-12-02' },
      }),
    );

    // The preview is bound to one month, so a cross-month move is step 13's reassignment,
    // not a versioned supersede.
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe(
      'cross_month_supersede_unsupported',
    );
    // One read to learn the original month; no transaction, lock or write.
    expect(state.statements).toEqual(['pool: entry date']);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
