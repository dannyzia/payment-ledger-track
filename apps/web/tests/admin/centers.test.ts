import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * The super-admin centres routes, over a fixture client.
 *
 * These routes were the only `/admin/super/*` API surface without a test of its own, and
 * they are the ones that create a tenant: `rpc_create_center` writes the centre, then the
 * route provisions the owner in GoTrue. The failure modes worth pinning are the ones a
 * typecheck cannot see — the actor passed to the RPC being the seat rather than a body
 * field, `code` staying immutable through PATCH, the audit row carrying both before and
 * after, and the platform capabilities being what actually refuses an owner.
 *
 * The fake replaces the Supabase client, because that is the boundary these routes use:
 * a table builder that applies the predicates it is given, an admin stub that records what
 * it was asked to do, and an RPC that can refuse. The capability registry is **not**
 * mocked — the denial cases below go through the real `requireCapability`.
 */

const FIXTURE = vi.hoisted(() => {
  const MHK = '11111111-1111-4111-8111-111111111111';
  const RMP = '22222222-2222-4222-8222-222222222222';
  const OWNER_A = '33333333-3333-4333-8333-333333333333';
  const SEAT = '44444444-4444-4444-8444-444444444444';

  interface Center {
    id: string;
    center_number: number;
    code: string;
    name: string;
    legal_entity_name: string;
    bin_number: string | null;
    trade_license_number: string | null;
    address: string;
    phone: string;
    status: string;
    created_at: string;
  }

  interface Profile {
    id: string;
    full_name: string;
    center_id: string | null;
    role: string;
    active: boolean;
  }

  interface AuthUser {
    id: string;
    email: string;
    user_metadata: Record<string, unknown>;
    app_metadata: Record<string, unknown>;
  }

  interface State {
    centers: Center[];
    profiles: Profile[];
    users: AuthUser[];
    audit: Array<Record<string, unknown>>;
    rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
    rpcResult: Record<string, unknown> | null;
    rpcError: { message: string } | null;
    adminCalls: Array<{ op: string; args: unknown[] }>;
    centersError: { message: string } | null;
  }

  function initialState(): State {
    return {
      centers: [
        {
          id: RMP,
          center_number: 2,
          code: 'RMP',
          name: 'Rampura',
          legal_entity_name: 'Rampura Learning Centre',
          bin_number: null,
          trade_license_number: null,
          address: 'Rampura, Dhaka',
          phone: '+8801700000002',
          status: 'suspended',
          created_at: '2026-10-30T00:00:00Z',
        },
        {
          id: MHK,
          center_number: 1,
          code: 'MHK',
          name: 'Mohakhali',
          legal_entity_name: 'Mohakhali Learning Centre',
          bin_number: 'BIN-1',
          trade_license_number: 'TL-1',
          address: 'Mohakhali, Dhaka',
          phone: '+8801700000001',
          status: 'active',
          created_at: '2026-10-29T00:00:00Z',
        },
      ],
      profiles: [
        { id: OWNER_A, full_name: 'Owner A', center_id: MHK, role: 'owner', active: true },
        {
          id: SEAT,
          full_name: 'Platform Seat',
          center_id: null,
          role: 'super_admin',
          active: true,
        },
      ],
      users: [{ id: OWNER_A, email: 'owner.a@example.com', user_metadata: {}, app_metadata: {} }],
      audit: [],
      rpcCalls: [],
      rpcResult: null,
      rpcError: null,
      adminCalls: [],
      centersError: null,
    };
  }

  type Row = Record<string, unknown>;

  /** A chainable query builder that only does what these routes actually ask of it. */
  function makeBuilder(state: State, table: string) {
    const query = {
      table,
      op: 'select' as 'select' | 'update' | 'insert' | 'upsert',
      selectArg: undefined as string | undefined,
      filters: [] as Array<[string, unknown]>,
      values: undefined as Row | undefined,
      order: undefined as [string, { ascending: boolean }] | undefined,
      mode: undefined as 'single' | 'maybe' | undefined,
    };

    function rowsFor(): Row[] {
      const source =
        table === 'centers' ? state.centers : table === 'profiles' ? state.profiles : [];
      return (source as unknown as Row[]).filter((row) =>
        query.filters.every(([column, value]) => row[column] === value),
      );
    }

    function execute(): { data: unknown; error: unknown } {
      if (table === 'centers' && state.centersError && query.op === 'select') {
        return { data: null, error: state.centersError };
      }

      if (table === 'audit_log' && query.op === 'insert') {
        state.audit.push(query.values as Row);
        return { data: null, error: null };
      }

      if (table === 'centers' && query.op === 'update') {
        const row = rowsFor()[0];
        if (!row) return { data: null, error: { message: 'no rows' } };
        Object.assign(row, query.values);
        return { data: query.mode === 'single' ? row : [row], error: null };
      }

      if (table === 'profiles' && query.op === 'update') {
        const row = rowsFor()[0];
        if (row) Object.assign(row, query.values);
        return { data: null, error: null };
      }

      if (table === 'profiles' && query.op === 'upsert') {
        const incoming = query.values as unknown as Profile;
        const existing = state.profiles.find((p) => p.id === incoming.id);
        if (existing) Object.assign(existing, incoming);
        else state.profiles.push(incoming);
        return { data: null, error: null };
      }

      let rows = rowsFor();
      if (query.order) {
        const [column, options] = query.order;
        rows = [...rows].sort((a, b) => {
          const left = Number(a[column]);
          const right = Number(b[column]);
          return options.ascending ? left - right : right - left;
        });
      }
      // Copies, like PostgREST: the route keeps `before` and then updates the row, and a
      // live reference would make the audit row's "before" show the new value.
      if (query.mode === 'single') {
        if (rows.length !== 1) return { data: null, error: { message: 'expected one row' } };
        return { data: { ...rows[0] }, error: null };
      }
      if (query.mode === 'maybe') return { data: rows[0] ? { ...rows[0] } : null, error: null };
      return { data: rows.map((row) => ({ ...row })), error: null };
    }

    const builder: Record<string, unknown> = {
      select: (arg?: string) => {
        query.selectArg = arg;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        query.filters.push([column, value]);
        return builder;
      },
      order: (column: string, options: { ascending: boolean }) => {
        query.order = [column, options];
        return builder;
      },
      single: () => {
        query.mode = 'single';
        return builder;
      },
      maybeSingle: () => {
        query.mode = 'maybe';
        return builder;
      },
      update: (values: Row) => {
        query.op = 'update';
        query.values = values;
        return builder;
      },
      insert: (values: Row) => {
        query.op = 'insert';
        query.values = values;
        return builder;
      },
      upsert: (values: Row) => {
        query.op = 'upsert';
        query.values = values;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve, reject),
    };

    return { builder, query };
  }

  function makeClient(state: State) {
    const queries: Array<{ table: string; op: string; values?: Row; filters?: unknown }> = [];
    return {
      queries,
      from(table: string) {
        const { builder, query } = makeBuilder(state, table);
        queries.push(query as never);
        return builder;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        state.rpcCalls.push({ name, args });
        return { data: state.rpcResult, error: state.rpcError };
      },
      auth: {
        admin: {
          async listUsers(...args: unknown[]) {
            state.adminCalls.push({ op: 'listUsers', args });
            return { data: { users: state.users }, error: null };
          },
          async createUser(payload: Record<string, unknown>) {
            state.adminCalls.push({ op: 'createUser', args: [payload] });
            const user: AuthUser = {
              id: '55555555-5555-4555-8555-555555555555',
              email: String(payload.email),
              user_metadata: (payload.user_metadata as Record<string, unknown>) ?? {},
              app_metadata: (payload.app_metadata as Record<string, unknown>) ?? {},
            };
            state.users.push(user);
            return { data: { user }, error: null };
          },
          async inviteUserByEmail(email: string, options?: Record<string, unknown>) {
            state.adminCalls.push({ op: 'inviteUserByEmail', args: [email, options] });
            const user: AuthUser = {
              id: '66666666-6666-4666-8666-666666666666',
              email,
              user_metadata: {},
              app_metadata: {},
            };
            state.users.push(user);
            return { data: { user }, error: null };
          },
          async updateUserById(id: string, patch: Record<string, unknown>) {
            state.adminCalls.push({ op: 'updateUserById', args: [id, patch] });
            const user = state.users.find((u) => u.id === id);
            if (user && patch.app_metadata) {
              user.app_metadata = { ...user.app_metadata, ...(patch.app_metadata as Row) };
            }
            return { data: { user }, error: null };
          },
          async getUserById(id: string) {
            state.adminCalls.push({ op: 'getUserById', args: [id] });
            return { data: { user: state.users.find((u) => u.id === id) ?? null }, error: null };
          },
        },
      },
    };
  }

  return { MHK, RMP, OWNER_A, SEAT, initialState, makeClient };
});

const CALLER = vi.hoisted(() => ({
  userId: '44444444-4444-4444-8444-444444444444',
  role: 'super_admin' as string,
  active: true,
  centerId: null as string | null,
  aal: 'aal2',
}));

const state = FIXTURE.initialState();
const client = FIXTURE.makeClient(state);

vi.mock('$lib/server/auth', () => ({
  getCallerContext: async () => CALLER,
  requireRole: () => undefined,
}));
vi.mock('$lib/server/assurance', () => ({ requireAssurance: () => undefined }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: () => client }));

const centersRoute = await import('../../src/routes/api/v1/admin/super/centers/+server');
const centerRoute = await import('../../src/routes/api/v1/admin/super/centers/[id]/+server');

function requestEvent(
  body: unknown,
  options: { path?: string; id?: string; query?: string; raw?: string } = {},
): RequestEvent {
  const url = new URL(
    `http://localhost${options.path ?? '/api/v1/admin/super/centers'}${options.query ?? ''}`,
  );
  return {
    url,
    params: { id: options.id ?? FIXTURE.MHK },
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: options.raw ?? JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}

function getEvent(query = ''): RequestEvent {
  const url = new URL(`http://localhost/api/v1/admin/super/centers${query}`);
  return { url, params: {}, request: new Request(url) } as unknown as RequestEvent;
}

beforeEach(() => {
  Object.assign(state, FIXTURE.initialState());
  client.queries.length = 0;
  CALLER.role = 'super_admin';
  CALLER.active = true;
});

describe('GET /api/v1/admin/super/centers', () => {
  it('lists every centre in centre-number order, with the owner resolved', async () => {
    const response = await centersRoute.GET(getEvent());
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      centers: Array<Record<string, unknown> & { code: string }>;
    };
    expect(body.centers.map((c) => c.code)).toEqual(['MHK', 'RMP']);

    const mhk = body.centers[0];
    expect(mhk.owner_id).toBe(FIXTURE.OWNER_A);
    expect(mhk.owner_name).toBe('Owner A');
    // The email lives in GoTrue, not in `profiles`; the route joins it in.
    expect(mhk.owner_email).toBe('owner.a@example.com');

    const rmp = body.centers[1];
    expect(rmp.owner_id).toBeNull();
    expect(rmp.owner_email).toBeNull();
  });

  it('filters by status when the screen asks for one', async () => {
    const response = await centersRoute.GET(getEvent('?status=suspended'));
    const body = (await response.json()) as { centers: Array<{ code: string }> };
    expect(body.centers.map((c) => c.code)).toEqual(['RMP']);
  });

  it('surfaces a read failure instead of an empty register', async () => {
    state.centersError = { message: 'permission denied for table centers' };
    const response = await centersRoute.GET(getEvent());
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain('permission denied');
  });
});

describe('POST /api/v1/admin/super/centers', () => {
  const valid = {
    code: 'TKA',
    name: 'Tejgaon',
    legalEntityName: 'Tejgaon Learning Centre',
    address: 'Tejgaon, Dhaka',
    phone: '+8801700000003',
    ownerEmail: 'Owner.New@Example.com',
    ownerName: 'New Owner',
  };

  it('provisions the centre as the seat, with absent optional fields as NULL', async () => {
    state.rpcResult = { center_id: '77777777-7777-4777-8777-777777777777', code: 'TKA' };

    const response = await centersRoute.POST(requestEvent(valid));
    expect(response.status).toBe(201);

    expect(state.rpcCalls).toHaveLength(1);
    const { name, args } = state.rpcCalls[0];
    expect(name).toBe('rpc_create_center');
    // The actor is the session, never a body field.
    expect(args.p_actor_id).toBe(FIXTURE.SEAT);
    expect(args.p_code).toBe('TKA');
    expect(args.p_bin_number).toBeNull();
    expect(args.p_trade_license).toBeNull();

    const body = (await response.json()) as { success: boolean; center: { code: string } };
    expect(body.success).toBe(true);
    expect(body.center.code).toBe('TKA');
  });

  it('invites a new owner and pins the role and centre into its app metadata', async () => {
    state.rpcResult = { center_id: '77777777-7777-4777-8777-777777777777' };

    const response = await centersRoute.POST(requestEvent(valid));
    const body = (await response.json()) as { ownerProvisioned: boolean; ownerError: null };

    expect(body.ownerProvisioned).toBe(true);
    expect(body.ownerError).toBeNull();

    const invite = state.adminCalls.find((call) => call.op === 'inviteUserByEmail');
    expect(invite).toBeDefined();
    // Lowercased, and the callback is this origin's, not a body-supplied URL.
    expect(invite!.args[0]).toBe('owner.new@example.com');
    expect((invite!.args[1] as { redirectTo: string }).redirectTo).toBe(
      'http://localhost/callback',
    );

    const metadata = state.adminCalls.find((call) => call.op === 'updateUserById');
    expect((metadata!.args[1] as { app_metadata: unknown }).app_metadata).toEqual({
      role: 'owner',
      center_id: '77777777-7777-4777-8777-777777777777',
    });
  });

  it('reuses an existing auth user instead of inviting over it', async () => {
    state.rpcResult = { center_id: FIXTURE.MHK };

    await centersRoute.POST(requestEvent({ ...valid, ownerEmail: 'owner.a@example.com' }));

    expect(state.adminCalls.some((call) => call.op === 'inviteUserByEmail')).toBe(false);
    expect(state.adminCalls.some((call) => call.op === 'createUser')).toBe(false);
    const metadata = state.adminCalls.find((call) => call.op === 'updateUserById');
    expect(
      (metadata!.args[1] as { app_metadata: { center_id: string } }).app_metadata.center_id,
    ).toBe(FIXTURE.MHK);
  });

  it('refuses a payload the schema rejects, before touching the RPC', async () => {
    const lower = await centersRoute.POST(requestEvent({ ...valid, code: 'tka' }));
    expect(lower.status).toBe(400);
    expect(((await lower.json()) as { error: string }).error).toBe('invalid_payload');

    const noEmail = await centersRoute.POST(requestEvent({ ...valid, ownerEmail: 'not-an-email' }));
    expect(noEmail.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('maps a taken code to 409 and any other refusal to 422', async () => {
    state.rpcError = { message: '422 center_code_taken' };
    const taken = await centersRoute.POST(requestEvent(valid));
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe('center_code_taken');

    state.rpcError = { message: '422 missing_bootstrap_field' };
    const other = await centersRoute.POST(requestEvent(valid));
    expect(other.status).toBe(422);
  });

  it('reports a failed owner provisioning without losing the created centre', async () => {
    state.rpcResult = { center_id: '77777777-7777-4777-8777-777777777777' };
    const response = await centersRoute.POST(
      requestEvent({ ...valid, ownerPassword: 'correct-horse-1' }),
    );

    // createUser path succeeds here, so the provisioning flag is what changes a centre
    // that exists from one that exists with a usable owner.
    expect(response.status).toBe(201);
    const body = (await response.json()) as { ownerProvisioned: boolean };
    expect(body.ownerProvisioned).toBe(true);
    expect(state.adminCalls.some((call) => call.op === 'createUser')).toBe(true);
  });
});

describe('PATCH /api/v1/admin/super/centers/[id]', () => {
  it('suspends a centre, writing the audit row with both sides of the change', async () => {
    const response = await centerRoute.PATCH(requestEvent({ status: 'suspended' }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { center: { status: string } };
    expect(body.center.status).toBe('suspended');

    expect(state.audit).toHaveLength(1);
    const audit = state.audit[0];
    expect(audit.action).toBe('center.update');
    expect(audit.actor).toBe(FIXTURE.SEAT);
    expect(audit.center_id).toBe(FIXTURE.MHK);
    expect((audit.before as { status: string }).status).toBe('active');
    expect((audit.after as { status: string }).status).toBe('suspended');
  });

  it('refuses a status change from a role without the platform capability', async () => {
    // The real registry enforces this: owners hold centre-scoped powers only. The role
    // guard is mocked out of the way, so the capability is what refuses.
    CALLER.role = 'owner';

    await expect(centerRoute.PATCH(requestEvent({ status: 'suspended' }))).rejects.toMatchObject({
      status: 403,
      body: { message: 'capability_denied' },
    });
    expect(state.audit).toHaveLength(0);
  });

  it('keeps `code` out of the update even when the body carries it', async () => {
    const response = await centerRoute.PATCH(requestEvent({ code: 'NEW', name: 'Renamed' }));
    expect(response.status).toBe(200);

    const update = client.queries.find((q) => q.table === 'centers' && q.op === 'update');
    expect(update).toBeDefined();
    expect(Object.keys(update!.values as object)).toEqual(['name']);
    expect(state.centers.find((c) => c.id === FIXTURE.MHK)!.code).toBe('MHK');
  });

  it('returns 404 for a centre that does not exist, without writing', async () => {
    const response = await centerRoute.PATCH(
      requestEvent({ status: 'archived' }, { id: '99999999-9999-4999-8999-999999999999' }),
    );
    expect(response.status).toBe(404);
    expect(state.audit).toHaveLength(0);
  });

  it('rejects a malformed id, an empty body and malformed JSON before any work', async () => {
    const badId = await centerRoute.PATCH(requestEvent({ status: 'active' }, { id: 'mhk' }));
    expect(badId.status).toBe(400);

    const empty = await centerRoute.PATCH(requestEvent({}));
    expect(empty.status).toBe(400);

    const broken = await centerRoute.PATCH(requestEvent(null, { raw: '{oops' }));
    expect(broken.status).toBe(400);
    expect(state.audit).toHaveLength(0);
  });

  it('renames the active owner in both profiles and GoTrue', async () => {
    const response = await centerRoute.PATCH(requestEvent({ ownerName: 'Renamed Owner' }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { ownerUpdated: boolean }).ownerUpdated).toBe(true);

    expect(state.profiles.find((p) => p.id === FIXTURE.OWNER_A)!.full_name).toBe('Renamed Owner');
    const authUpdate = state.adminCalls.find(
      (call) =>
        call.op === 'updateUserById' &&
        (call.args[1] as { user_metadata?: unknown }).user_metadata !== undefined,
    );
    expect(authUpdate).toBeDefined();
  });
});
