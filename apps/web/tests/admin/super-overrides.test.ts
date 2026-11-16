import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 13 — the seat's Owner-only overrides and the guarded purge.
 *
 * Four routes are exercised through the shipped handlers on a fake pool:
 *
 *   POST .../ledger/reopen          → reopen_month
 *   POST .../ledger/overrides       → approve_settlement_overpayment,
 *                                     review_entry_reconciliation_exception,
 *                                     publish_rate_profile
 *   POST .../ledger/purge/impact    → previewEntryImpact (read-only)
 *   POST .../ledger/purge           → maintenance_purge_entries
 *
 * The assertions are about the seams a later change would silently move:
 *
 *  - parameter order. The routines take `reason` before `actor_id` and the rate profile
 *    takes no effective date; a call assembled from a different signature would either
 *    fail at the database or, worse, pass a uuid into a text slot. Each case reads the
 *    recorded parameters by name, so reordering them fails here.
 *  - the gates. Only Supabase is faked; `requireRole`, `requireAssurance` and
 *    `requireCapability` are the shipped ones, so an owner token, a seat at `aal1` and a
 *    missing bearer are refused by the real code rather than by a stub.
 *  - the purge's three conditions. The display id must match, the password must verify
 *    against GoTrue, and the RPC's own refusals still reach the caller — each checked by
 *    proving the next step was never attempted.
 *
 * `$lib/server/reauthentication` is faked because it calls GoTrue over the network; the
 * fake records what the route asked it to verify, which is the part the route owns.
 */

const FIXTURE = vi.hoisted(() => {
  const CENTER = '11111111-1111-4111-8111-111111111111';
  const OTHER_CENTER = '22222222-2222-4222-8222-222222222222';
  const ENTRY = '33333333-3333-4333-8333-333333333333';
  const SETTLEMENT = '44444444-4444-4444-8444-444444444444';
  const PAYABLE = '55555555-5555-4555-8555-555555555555';
  const PROFILE = '66666666-6666-4666-8666-666666666666';
  const SEAT = 'user-super_admin';
  const ACTOR_EMAIL = 'seat@cosmoledger.local';

  const entryRow = {
    id: ENTRY,
    entry_number: '12',
    entry_date: '2026-09-14',
    status: 'active',
    method_id: '77777777-7777-4777-8777-777777777777',
    gross_poisha: '100000',
    vat_poisha: '1500',
    business_charge_poisha: '2000',
    customer_charge_poisha: '500',
  };

  const state = {
    monthClosed: false,
    /** When set, the named routine throws this message instead of succeeding. */
    rpcFailure: null as { routine: string; message: string } | null,
    /** What the fake GoTrue answers for the purge's password check. */
    reauth: 'ok' as 'ok' | 'wrong_password' | 'unavailable',
    reauthCalls: [] as Array<{ email: string | null; password: string }>,
  };

  const calls: Array<{ sql: string; params: unknown[] }> = [];

  function query(sql: string, params: unknown[] = []) {
    calls.push({ sql, params });

    const routine = [
      'reopen_month',
      'approve_settlement_overpayment',
      'review_entry_reconciliation_exception',
      'publish_rate_profile',
      'maintenance_purge_entries',
    ].find((name) => sql.includes(`${name}(`));

    if (routine) {
      if (state.rpcFailure?.routine === routine) {
        throw new Error(state.rpcFailure.message);
      }
      return { rows: [{ result: { routine } }] };
    }

    // The purge's target read, before the display id is compared.
    if (/c\.code\s+AS center_code/.test(sql)) {
      const [entryId, centerId] = [params[0], params[1]];
      const match = entryId === ENTRY && centerId === CENTER;
      return {
        rows: match
          ? [
              {
                entry_number: entryRow.entry_number,
                entry_date: entryRow.entry_date,
                status: entryRow.status,
                center_code: 'MHK',
                actor_email: ACTOR_EMAIL,
              },
            ]
          : [],
      };
    }

    // The impact preview's entry read.
    if (/SELECT id,\s+entry_number::text\s+AS entry_number/.test(sql)) {
      const [entryId, centerId] = [params[0], params[1]];
      return { rows: entryId === ENTRY && centerId === CENTER ? [{ ...entryRow }] : [] };
    }

    if (/coalesce\(max\(server_seq\)/.test(sql)) {
      return { rows: [{ max_server_seq: '12', entry_count: 1 }] };
    }

    if (/JOIN payables p/.test(sql)) {
      return {
        rows: [
          {
            id: SETTLEMENT,
            payable_id: PAYABLE,
            kind: 'vat',
            method_id: null,
            expected_poisha: '9000',
            paid_poisha: '0',
          },
        ],
      };
    }

    if (/JOIN statement_lines/.test(sql)) {
      return { rows: [] };
    }

    if (/FROM settlements/.test(sql)) {
      return {
        rows: [{ id: SETTLEMENT, status: 'due', expected_poisha: '9000', paid_poisha: '0' }],
      };
    }

    if (/FROM statements/.test(sql)) {
      return { rows: [] };
    }

    if (/FROM month_closes/.test(sql)) {
      return { rows: state.monthClosed ? [{ status: 'closed' }] : [] };
    }

    if (/SELECT code FROM centers/.test(sql)) {
      return { rows: params[0] === CENTER ? [{ code: 'MHK' }] : [] };
    }

    throw new Error(`fixture pool received an unrecognised statement: ${sql.slice(0, 60)}`);
  }

  return {
    CENTER,
    OTHER_CENTER,
    ENTRY,
    SETTLEMENT,
    PAYABLE,
    PROFILE,
    SEAT,
    ACTOR_EMAIL,
    DISPLAY_ID: 'E-MHK-202609-000012',
    state,
    calls,
    query,
    reset() {
      calls.length = 0;
      state.monthClosed = false;
      state.rpcFailure = null;
      state.reauth = 'ok';
      state.reauthCalls.length = 0;
    },
    rpcCalls(routine: string) {
      return calls.filter((call) => call.sql.includes(`${routine}(`));
    },
  };
});

vi.mock('$lib/server/supabase', () => ({
  getServiceSupabase: () => ({
    auth: {
      getUser: async (token: string) => {
        try {
          const payload = JSON.parse(
            Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'),
          ) as { sub: string };
          return {
            data: {
              user: {
                id: payload.sub,
                app_metadata: {
                  role: currentRole,
                  center_id: currentRole === 'super_admin' ? null : FIXTURE.CENTER,
                },
              },
            },
            error: null,
          };
        } catch {
          return { data: { user: null }, error: { message: 'invalid token' } };
        }
      },
    },
    from: (table: string) => {
      const result =
        table === 'profiles'
          ? {
              data: {
                role: currentRole,
                active: true,
                center_id: currentRole === 'super_admin' ? null : FIXTURE.CENTER,
              },
              error: null,
            }
          : { data: { status: 'active' }, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) builder[method] = () => builder;
      builder['single'] = async () => result;
      return builder;
    },
  }),
}));

vi.mock('$lib/server/db', () => ({
  getDbPool: () => ({
    query: async (sql: string, params: unknown[]) => FIXTURE.query(sql, params),
  }),
}));

vi.mock('$lib/server/reauthentication', () => ({
  reauthenticate: async (email: string | null, password: string) => {
    FIXTURE.state.reauthCalls.push({ email, password });
    return FIXTURE.state.reauth;
  },
}));

const { POST: reopen } = await import('../../src/routes/api/v1/admin/super/ledger/reopen/+server');
const { POST: overrides } =
  await import('../../src/routes/api/v1/admin/super/ledger/overrides/+server');
const { POST: impact } =
  await import('../../src/routes/api/v1/admin/super/ledger/purge/impact/+server');
const { POST: purge } = await import('../../src/routes/api/v1/admin/super/ledger/purge/+server');

type Role = 'owner' | 'admin' | 'staff' | 'super_admin';

/** The mocked profile row mirrors the token's role; each test sets this through `call`. */
let currentRole: Role = 'super_admin';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function token(role: Role, aal: 'aal1' | 'aal2' | null = 'aal2'): string {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: `user-${role}`,
    role,
    ...(aal ? { aal } : {}),
    center_id: role === 'super_admin' ? null : FIXTURE.CENTER,
  })}.signature`;
}

type Handler = (event: RequestEvent) => Promise<Response> | Response;

async function call(
  handler: Handler,
  body: unknown,
  options: { role?: Role; aal?: 'aal1' | 'aal2' | null; bearer?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const role = options.role ?? 'super_admin';
  currentRole = role;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.bearer !== false) {
    headers['Authorization'] = `Bearer ${token(role, options.aal ?? 'aal2')}`;
  }

  const url = new URL('http://localhost/api/v1/admin/super/test');
  const event = {
    request: new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    url,
    params: {},
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;

  try {
    const response = await handler(event);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } catch (thrown) {
    const httpError = thrown as { status?: number; body?: { message?: string } };
    return {
      status: typeof httpError.status === 'number' ? httpError.status : 500,
      body: { error: httpError.body?.message ?? String((thrown as Error)?.message ?? thrown) },
    };
  }
}

const reopenBody = {
  centerId: FIXTURE.CENTER,
  month: '2026-09',
  reason: 'Correcting a closed month at the owner’s request',
};

const purgeBody = {
  centerId: FIXTURE.CENTER,
  entryId: FIXTURE.ENTRY,
  confirmation: 'E-MHK-202609-000012',
  reason: 'Seeded by an E2E run and never belonged in the ledger',
  password: 'local-test-password',
};

beforeEach(() => {
  currentRole = 'super_admin';
  FIXTURE.reset();
});

describe('POST /api/v1/admin/super/ledger/reopen', () => {
  it('calls reopen_month with the month, then the reason, then the actor', async () => {
    const result = await call(reopen, reopenBody);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, month: '2026-09-01' });

    const [rpc] = FIXTURE.rpcCalls('reopen_month');
    expect(rpc?.params).toEqual([FIXTURE.CENTER, '2026-09-01', reopenBody.reason, FIXTURE.SEAT]);
  });

  it('truncates a full date to the first of its month', async () => {
    const result = await call(reopen, { ...reopenBody, month: '2026-09-14' });

    expect(result.status).toBe(200);
    expect(FIXTURE.rpcCalls('reopen_month')[0]?.params[1]).toBe('2026-09-01');
  });

  it('refuses a malformed month and a non-uuid center before any RPC', async () => {
    const badMonth = await call(reopen, { ...reopenBody, month: '2026/09' });
    expect(badMonth.status).toBe(400);
    expect(badMonth.body.error).toBe('invalid_body');

    const badCenter = await call(reopen, { ...reopenBody, centerId: 'mhk' });
    expect(badCenter.status).toBe(400);
    expect(badCenter.body.error).toBe('invalid_body');

    expect(FIXTURE.rpcCalls('reopen_month')).toEqual([]);
  });

  it('maps the routine’s own refusals instead of answering 500', async () => {
    FIXTURE.state.rpcFailure = { routine: 'reopen_month', message: 'month_not_closed' };
    const unclosed = await call(reopen, reopenBody);
    expect(unclosed.status).toBe(422);
    expect(unclosed.body.error).toBe('month_not_closed');

    FIXTURE.state.rpcFailure = { routine: 'reopen_month', message: 'center_not_found' };
    const missing = await call(reopen, reopenBody);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('center_not_found');
  });
});

describe('POST /api/v1/admin/super/ledger/overrides', () => {
  it('approves an overpayment with the settlement, the reason and the actor', async () => {
    const result = await call(overrides, {
      kind: 'overpayment',
      centerId: FIXTURE.CENTER,
      settlementId: FIXTURE.SETTLEMENT,
      reason: 'Owner confirmed the bank credit',
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, kind: 'overpayment' });
    expect(FIXTURE.rpcCalls('approve_settlement_overpayment')[0]?.params).toEqual([
      FIXTURE.CENTER,
      FIXTURE.SETTLEMENT,
      'Owner confirmed the bank credit',
      FIXTURE.SEAT,
    ]);
  });

  it('reviews a reconciliation exception with entry, payable, action, reason and actor', async () => {
    const result = await call(overrides, {
      kind: 'reconciliation_exception',
      centerId: FIXTURE.CENTER,
      entryId: FIXTURE.ENTRY,
      payableId: FIXTURE.PAYABLE,
      action: 'approved',
      reason: 'Statement line matches the entry',
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, entryId: FIXTURE.ENTRY, action: 'approved' });
    expect(FIXTURE.rpcCalls('review_entry_reconciliation_exception')[0]?.params).toEqual([
      FIXTURE.CENTER,
      FIXTURE.ENTRY,
      FIXTURE.PAYABLE,
      'approved',
      'Statement line matches the entry',
      FIXTURE.SEAT,
    ]);
  });

  it('publishes a rate profile with three arguments, and sends no effective date', async () => {
    const result = await call(overrides, {
      kind: 'rate_profile',
      centerId: FIXTURE.CENTER,
      profileId: FIXTURE.PROFILE,
    });

    expect(result.status).toBe(200);
    const [rpc] = FIXTURE.rpcCalls('publish_rate_profile');
    expect(rpc?.params).toEqual([FIXTURE.CENTER, FIXTURE.PROFILE, FIXTURE.SEAT]);
  });

  it('refuses an unknown kind and an action outside approved/rejected', async () => {
    const unknown = await call(overrides, { kind: 'refund', centerId: FIXTURE.CENTER });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('invalid_body');

    const badAction = await call(overrides, {
      kind: 'reconciliation_exception',
      centerId: FIXTURE.CENTER,
      entryId: FIXTURE.ENTRY,
      payableId: FIXTURE.PAYABLE,
      action: 'pending',
      reason: 'x',
    });
    expect(badAction.status).toBe(400);

    expect(FIXTURE.calls.some((entry) => entry.sql.includes('review_entry_reconciliation'))).toBe(
      false,
    );
  });

  it('maps a missing settlement to 404 and a closed month to 422', async () => {
    FIXTURE.state.rpcFailure = {
      routine: 'approve_settlement_overpayment',
      message: 'settlement_not_found',
    };
    const missing = await call(overrides, {
      kind: 'overpayment',
      centerId: FIXTURE.CENTER,
      settlementId: FIXTURE.SETTLEMENT,
      reason: 'Owner confirmed the bank credit',
    });
    expect(missing.status).toBe(404);

    FIXTURE.state.rpcFailure = { routine: 'publish_rate_profile', message: 'month_closed' };
    const closed = await call(overrides, {
      kind: 'rate_profile',
      centerId: FIXTURE.CENTER,
      profileId: FIXTURE.PROFILE,
    });
    expect(closed.status).toBe(422);
    expect(closed.body.error).toBe('month_closed');
  });
});

describe('POST /api/v1/admin/super/ledger/purge/impact', () => {
  it('previews the settlement change and returns the id the operator must type', async () => {
    const result = await call(impact, { centerId: FIXTURE.CENTER, entryId: FIXTURE.ENTRY });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      entryId: FIXTURE.ENTRY,
      displayId: FIXTURE.DISPLAY_ID,
      typedConfirmation: FIXTURE.DISPLAY_ID,
      month: '2026-09-01',
      monthState: { status: null, closed: false },
      blockers: [],
    });

    const deltas = result.body.settlementDeltas as Array<Record<string, string>>;
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      settlementId: FIXTURE.SETTLEMENT,
      kind: 'vat',
      expectedBefore: '9000',
      expectedAfter: '7500',
    });
  });

  it('reports a closed month as a blocker rather than hiding it', async () => {
    FIXTURE.state.monthClosed = true;
    const result = await call(impact, { centerId: FIXTURE.CENTER, entryId: FIXTURE.ENTRY });

    expect(result.status).toBe(200);
    expect(result.body.monthState).toMatchObject({ status: 'closed', closed: true });
    expect(result.body.blockers).toContain('month_closed');
  });

  it('answers 404 for an entry in another center, and 400 for a malformed body', async () => {
    const other = await call(impact, {
      centerId: FIXTURE.OTHER_CENTER,
      entryId: FIXTURE.ENTRY,
    });
    expect(other.status).toBe(404);
    expect(other.body.error).toBe('entry_not_found');

    const malformed = await call(impact, { centerId: FIXTURE.CENTER, entryId: 'E-1' });
    expect(malformed.status).toBe(400);
  });
});

describe('POST /api/v1/admin/super/ledger/purge', () => {
  it('purges after the typed id matches and the password verifies', async () => {
    const result = await call(purge, purgeBody);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, entryId: FIXTURE.ENTRY });

    // The id is compared case-insensitively, but it must be the entry's own id.
    expect(FIXTURE.state.reauthCalls).toEqual([
      { email: FIXTURE.ACTOR_EMAIL, password: purgeBody.password },
    ]);
    expect(FIXTURE.rpcCalls('maintenance_purge_entries')[0]?.params).toEqual([
      FIXTURE.CENTER,
      FIXTURE.ENTRY,
      purgeBody.reason,
      FIXTURE.SEAT,
    ]);
  });

  it('refuses a mismatched confirmation without asking for the password', async () => {
    const result = await call(purge, { ...purgeBody, confirmation: 'E-MHK-202609-000011' });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: 'confirmation_mismatch',
      expected: FIXTURE.DISPLAY_ID,
    });
    expect(FIXTURE.state.reauthCalls).toEqual([]);
    expect(FIXTURE.rpcCalls('maintenance_purge_entries')).toEqual([]);
  });

  it('refuses a wrong password and a configuration fault with distinct statuses', async () => {
    FIXTURE.state.reauth = 'wrong_password';
    const wrong = await call(purge, purgeBody);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe('reauthentication_failed');
    expect(FIXTURE.rpcCalls('maintenance_purge_entries')).toEqual([]);

    FIXTURE.state.reauth = 'unavailable';
    const unavailable = await call(purge, purgeBody);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error).toBe('reauthentication_unavailable');
    expect(FIXTURE.rpcCalls('maintenance_purge_entries')).toEqual([]);
  });

  it('refuses a short reason before reading the entry', async () => {
    const result = await call(purge, { ...purgeBody, reason: 'too short' });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_body');
    expect(FIXTURE.state.reauthCalls).toEqual([]);
  });

  it('lets the routine keep refusing a closed month and a reconciled entry', async () => {
    FIXTURE.state.rpcFailure = {
      routine: 'maintenance_purge_entries',
      message: 'month_closed',
    };
    const closed = await call(purge, purgeBody);
    expect(closed.status).toBe(422);
    expect(closed.body.error).toBe('month_closed');

    // The mapper scans its key list in order and `reconciled` comes before
    // `entry_is_reconciled`, so the shorter key is what a message containing either
    // reports; the status is 409 either way.
    FIXTURE.state.rpcFailure = {
      routine: 'maintenance_purge_entries',
      message: 'entry_is_reconciled',
    };
    const reconciled = await call(purge, purgeBody);
    expect(reconciled.status).toBe(409);
    expect(reconciled.body.error).toBe('reconciled');
  });

  it('answers 404 for an entry that is not in the named center', async () => {
    const result = await call(purge, { ...purgeBody, centerId: FIXTURE.OTHER_CENTER });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('entry_not_found');
    expect(FIXTURE.state.reauthCalls).toEqual([]);
  });
});

describe('gates shared by the step-13 routes', () => {
  const routes: Array<[string, Handler, unknown]> = [
    ['reopen', reopen, reopenBody],
    [
      'overrides',
      overrides,
      { kind: 'rate_profile', centerId: FIXTURE.CENTER, profileId: FIXTURE.PROFILE },
    ],
    ['purge/impact', impact, { centerId: FIXTURE.CENTER, entryId: FIXTURE.ENTRY }],
    ['purge', purge, purgeBody],
  ];

  for (const [name, handler, body] of routes) {
    it(`refuses owner, admin and staff on ${name}`, async () => {
      for (const role of ['owner', 'admin', 'staff'] as const) {
        const result = await call(handler, body, { role });
        expect(result.status, `${role} reached ${name}`).toBe(403);
      }
      expect(FIXTURE.calls).toEqual([]);
    });

    it(`refuses an aal1 seat on ${name} with assurance_required`, async () => {
      const result = await call(handler, body, { aal: 'aal1' });
      expect({ status: result.status, message: result.body.error }).toEqual({
        status: 403,
        message: 'assurance_required',
      });
      expect(FIXTURE.calls).toEqual([]);
    });

    it(`refuses a missing bearer on ${name}`, async () => {
      const result = await call(handler, body, { bearer: false });
      expect(result.status).toBe(401);
      expect(FIXTURE.calls).toEqual([]);
    });
  }
});
