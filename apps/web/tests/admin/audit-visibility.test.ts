import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 14 — the audit read model and `CLT-D-037`'s two visibility modes.
 *
 * `AUDIT_VISIBILITY_MODE` is `silent`, so the default path is the one that must be proved
 * to hide platform rows; `attributable_unnamed` is passed explicitly, which is also the
 * only reason the parameter exists. The fixture holds two platform rows — one carrying
 * `actor_role: super_admin` in its payload, one relying on the actor's profile — because
 * the model recognises both, and a row whose payload predates the role column must not
 * become visible merely because the payload is thin.
 *
 * Tenant scope is asserted through the query the model builds, not only through the rows
 * it returns: these reads run on the service role, which bypasses RLS, so the `center_id`
 * predicate is the isolation.
 */

const FIXTURE = vi.hoisted(() => {
  const CENTER = '11111111-1111-4111-8111-111111111111';
  const OTHER_CENTER = '22222222-2222-4222-8222-222222222222';
  const SEAT = '99999999-9999-4999-8999-999999999999';
  const OWNER = '33333333-3333-4333-8333-333333333333';
  const ADMIN = '44444444-4444-4444-8444-444444444444';
  const STAFF = '55555555-5555-4555-8555-555555555555';

  const row = (
    id: number,
    center_id: string,
    actor: string,
    action: string,
    actorRole: string | null,
  ) => ({
    id,
    center_id,
    actor,
    action,
    target_table: 'entries',
    at: `2026-11-1${id}T10:00:00.000Z`,
    before: null,
    after: actorRole === null ? { entry_number: id } : { actor_role: actorRole },
  });

  const rows = [
    row(6, CENTER, SEAT, 'entry.create', 'super_admin'),
    // No actor_role in the payload: recognised by the actor's profile instead.
    row(5, CENTER, SEAT, 'entry.void', null),
    row(4, CENTER, OWNER, 'settlement.approve_overpayment', 'owner'),
    row(3, CENTER, ADMIN, 'rate_profile.publish', 'admin'),
    row(2, CENTER, STAFF, 'entry.create', 'staff'),
    row(1, OTHER_CENTER, OWNER, 'entry.create', 'owner'),
  ];

  interface Query {
    table: string;
    filters: Record<string, unknown>;
    like: string | null;
    limit: number | null;
  }

  const log: Query[] = [];
  const state = { errorMessage: null as string | null };

  function resolve(query: Query): { data: unknown[] | null; error: { message: string } | null } {
    if (state.errorMessage) return { data: null, error: { message: state.errorMessage } };

    if (query.table === 'profiles') {
      const wanted = query.filters['role'];
      return { data: wanted === 'super_admin' ? [{ id: SEAT }] : [], error: null };
    }

    if (query.table !== 'audit_log') {
      throw new Error(`fixture supabase received an unknown table: ${query.table}`);
    }

    let selected = [...rows];

    const centerId = query.filters['center_id'];
    if (centerId !== undefined) selected = selected.filter((entry) => entry.center_id === centerId);

    const targetTable = query.filters['target_table'];
    if (targetTable !== undefined) {
      selected = selected.filter((entry) => entry.target_table === targetTable);
    }

    const actor = query.filters['actor'];
    if (actor !== undefined) selected = selected.filter((entry) => entry.actor === actor);

    const gte = query.filters['gte:at'];
    if (typeof gte === 'string') selected = selected.filter((entry) => entry.at >= gte);

    const lte = query.filters['lte:at'];
    if (typeof lte === 'string') selected = selected.filter((entry) => entry.at <= lte);

    if (query.like) {
      const needle = query.like.replaceAll('%', '').toLowerCase();
      selected = selected.filter((entry) => entry.action.toLowerCase().includes(needle));
    }

    selected.sort((a, b) => b.id - a.id);
    if (query.limit !== null) selected = selected.slice(0, query.limit);

    return { data: selected, error: null };
  }

  function fakeSupabase() {
    return {
      from(table: string) {
        const query: Query = { table, filters: {}, like: null, limit: null };
        log.push(query);
        const builder: Record<string, unknown> = {};
        builder['select'] = () => builder;
        builder['eq'] = (column: string, value: unknown) => {
          query.filters[column] = value;
          return builder;
        };
        builder['ilike'] = (_column: string, value: string) => {
          query.like = value;
          return builder;
        };
        builder['gte'] = (column: string, value: unknown) => {
          query.filters[`gte:${column}`] = value;
          return builder;
        };
        builder['lte'] = (column: string, value: unknown) => {
          query.filters[`lte:${column}`] = value;
          return builder;
        };
        builder['order'] = () => builder;
        builder['limit'] = (value: number) => {
          query.limit = value;
          return builder;
        };
        builder['then'] = (
          resolveRows: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(resolve(query)).then(resolveRows, reject);
        return builder;
      },
    };
  }

  return {
    CENTER,
    OTHER_CENTER,
    SEAT,
    OWNER,
    ADMIN,
    STAFF,
    rows,
    log,
    state,
    fakeSupabase,
    reset() {
      log.length = 0;
      state.errorMessage = null;
    },
    auditQueries() {
      return log.filter((query) => query.table === 'audit_log');
    },
  };
});

/** The route's caller; the read model tests pass their own object instead. */
let routeCaller: { role: 'owner' | 'admin' | 'staff' | 'super_admin'; centerId: string | null } = {
  role: 'owner',
  centerId: FIXTURE.CENTER,
};

vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: () => FIXTURE.fakeSupabase() }));

vi.mock('$lib/server/auth', () => ({
  getCallerContext: async () => ({ userId: 'caller', ...routeCaller }),
}));

const { queryAuditLog } = await import('../../src/lib/server/audit-read-model');
const { AUDIT_VISIBILITY_MODE } = await import('../../src/lib/server/audit-visibility');
const { GET: auditRoute } = await import('../../src/routes/api/v1/admin/audit/+server');

const ALL = FIXTURE.rows.length;

function owner() {
  return { role: 'owner' as const, centerId: FIXTURE.CENTER };
}

function admin() {
  return { role: 'admin' as const, centerId: FIXTURE.CENTER };
}

function seat() {
  return { role: 'super_admin' as const, centerId: null };
}

beforeEach(() => {
  FIXTURE.reset();
  routeCaller = { role: 'owner', centerId: FIXTURE.CENTER };
});

describe('AUDIT_VISIBILITY_MODE (CLT-D-037, DECISION PENDING)', () => {
  it('ships the recorded default', () => {
    expect(AUDIT_VISIBILITY_MODE).toBe('silent');
  });
});

describe('queryAuditLog tenant scope', () => {
  it('gives the seat every center and the full record', async () => {
    const result = await queryAuditLog({}, seat());

    expect(result.error).toBeUndefined();
    expect(result.events).toHaveLength(ALL);
    expect(new Set(result.events.map((event) => event.center_id))).toEqual(
      new Set([FIXTURE.CENTER, FIXTURE.OTHER_CENTER]),
    );
    // Full fidelity: the platform actor is the seat's uuid, not a label.
    expect(result.events.find((event) => event.id === 6)?.actor).toBe(FIXTURE.SEAT);
  });

  it('lets the seat narrow to one center and ignores the mode', async () => {
    const result = await queryAuditLog({ centerId: FIXTURE.OTHER_CENTER }, seat(), 'silent');

    expect(result.events.map((event) => event.id)).toEqual([1]);
    expect(result.events[0]?.actor).toBe(FIXTURE.OWNER);
  });

  it('scopes an owner to its own center even when another center is requested', async () => {
    const result = await queryAuditLog({ centerId: FIXTURE.OTHER_CENTER }, owner());

    expect(result.events.every((event) => event.center_id === FIXTURE.CENTER)).toBe(true);
    expect(result.events.some((event) => event.id === 1)).toBe(false);
    expect(FIXTURE.auditQueries()[0]?.filters['center_id']).toBe(FIXTURE.CENTER);
  });

  it('refuses to read without a center when the caller has none', async () => {
    const result = await queryAuditLog({}, { role: 'admin', centerId: null });

    expect(result.events).toEqual([]);
    expect(result.error).toBe('center_required');
    expect(FIXTURE.auditQueries()).toEqual([]);
  });

  it('returns the query error instead of throwing', async () => {
    FIXTURE.state.errorMessage = 'connection reset';

    const result = await queryAuditLog({}, owner());

    expect(result.events).toEqual([]);
    expect(result.error).toBe('connection reset');
  });
});

describe('silent mode', () => {
  it('hides both platform rows from an owner', async () => {
    const result = await queryAuditLog({}, owner(), 'silent');

    expect(result.events.map((event) => event.id)).toEqual([4, 3, 2]);
    expect(result.events.some((event) => event.actor === FIXTURE.SEAT)).toBe(false);
    // The row with no actor_role in its payload is hidden by the profile lookup.
    expect(result.events.some((event) => event.id === 5)).toBe(false);
  });

  it('hides the same rows from an admin', async () => {
    const result = await queryAuditLog({}, admin(), 'silent');

    expect(result.events.map((event) => event.id)).toEqual([4, 3, 2]);
    expect(result.events.map((event) => event.after?.actor_role)).toEqual([
      'owner',
      'admin',
      'staff',
    ]);
  });
});

describe('attributable_unnamed mode', () => {
  it('keeps the platform rows and masks the actor', async () => {
    const result = await queryAuditLog({}, owner(), 'attributable_unnamed');

    expect(result.events.map((event) => event.id)).toEqual([6, 5, 4, 3, 2]);
    const platformRows = result.events.filter((event) => event.id === 6 || event.id === 5);
    expect(platformRows.map((event) => event.actor)).toEqual(['platform', 'platform']);
    // The fact that the platform acted is disclosed; the operator is not.
    expect(platformRows.map((event) => event.after?.actor_role)).toEqual([
      'super_admin',
      undefined,
    ]);
    expect(result.events.some((event) => event.actor === FIXTURE.SEAT)).toBe(false);
  });

  it('leaves center-authored rows untouched', async () => {
    const silent = await queryAuditLog({}, owner(), 'silent');
    const attributed = await queryAuditLog({}, owner(), 'attributable_unnamed');

    const centerRows = attributed.events.filter((event) => event.id !== 6 && event.id !== 5);
    expect(centerRows).toEqual(silent.events);
    expect(centerRows.map((event) => event.actor)).toEqual([
      FIXTURE.OWNER,
      FIXTURE.ADMIN,
      FIXTURE.STAFF,
    ]);
  });

  it('still excludes another center’s rows', async () => {
    const result = await queryAuditLog({}, owner(), 'attributable_unnamed');

    expect(result.events.some((event) => event.center_id === FIXTURE.OTHER_CENTER)).toBe(false);
  });
});

describe('GET /api/v1/admin/audit delegates to the read model', () => {
  function event(query = ''): RequestEvent {
    const url = new URL(`http://localhost/api/v1/admin/audit${query}`);
    return { url, request: new Request(url) } as unknown as RequestEvent;
  }

  it('answers a center with the default mode applied', async () => {
    const response = await auditRoute(event());
    const body = (await response.json()) as { events: Array<{ id: number; actor: string }> };

    expect(response.status).toBe(200);
    expect(body.events.map((entry) => entry.id)).toEqual([4, 3, 2]);
    expect(FIXTURE.auditQueries()[0]?.filters['center_id']).toBe(FIXTURE.CENTER);
  });

  it('refuses staff and lets the seat read every center', async () => {
    routeCaller = { role: 'staff', centerId: FIXTURE.CENTER };
    const refused = await auditRoute(event());
    expect(refused.status).toBe(403);
    expect(FIXTURE.auditQueries()).toEqual([]);

    routeCaller = { role: 'super_admin', centerId: null };
    const seatRead = await auditRoute(event());
    const body = (await seatRead.json()) as { events: unknown[] };
    expect(seatRead.status).toBe(200);
    expect(body.events).toHaveLength(ALL);
  });

  it('passes the filters through and answers 500 on a query error', async () => {
    await auditRoute(event('?table=entries&action=create&limit=2'));

    const [query] = FIXTURE.auditQueries();
    expect(query?.filters['target_table']).toBe('entries');
    expect(query?.like).toBe('%create%');
    expect(query?.limit).toBe(2);

    FIXTURE.state.errorMessage = 'permission denied';
    const failed = await auditRoute(event());
    expect(failed.status).toBe(500);
    expect((await failed.json()) as { error: string }).toEqual({ error: 'permission denied' });
  });
});
