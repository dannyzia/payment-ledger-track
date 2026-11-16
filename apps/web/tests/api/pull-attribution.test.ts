import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 12, at the API boundary (design §6.7).
 *
 * A platform-created entry is written by a super-admin profile that belongs to no
 * center, so the pull never delivers that profile in `profiles`. Without
 * `created_by_role` a center device can only show a bare uuid, which reads as an
 * unknown user. This test runs the shipped handler and pins the two things that
 * carry the attribution: the profiles join in the statement, and the field in the
 * JSON a device receives.
 *
 * The fake pool is the process boundary; it records each statement so the SQL can be
 * asserted without a live database.
 */

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const PLATFORM_USER = '55555555-5555-4555-8555-555555555555';

const state = vi.hoisted(() => ({
  statements: [] as string[],
  createdByRole: 'super_admin' as 'super_admin' | 'owner',
}));

vi.mock('$lib/server/auth', () => ({
  getCallerContext: async () => ({
    userId: USER_ID,
    role: 'owner',
    centerId: CENTER_ID,
    active: true,
  }),
}));

vi.mock('$lib/server/supabase', () => {
  // The metadata half of the pull chains filters freely; an empty, thenable chain
  // answers every shape with no rows so only the entry statement is under test.
  const emptyChain = (): Record<string, unknown> => {
    const result = { data: [], error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };

  return {
    getServiceSupabase: () => ({
      from: () => emptyChain(),
      rpc: async () => ({ data: null, error: null }),
    }),
  };
});

vi.mock('$lib/server/db', () => ({
  getDbPool: () => ({
    query: async (sql: string) => {
      state.statements.push(sql);
      if (sql.includes('current_seq')) {
        return { rows: [{ current_seq: '7' }], rowCount: 1 };
      }
      return {
        rows: [
          {
            id: ENTRY_ID,
            center_id: CENTER_ID,
            server_seq: '7',
            entry_number: 1,
            entry_date: '2026-11-16',
            customer_name: 'Platform sale',
            sub_qty: 1,
            sub_description: null,
            method_id: '66666666-6666-4666-8666-666666666666',
            gross_poisha: '50000',
            vat_poisha: '0',
            commission_poisha: '0',
            charge_poisha: '0',
            business_charge_poisha: '0',
            customer_charge_poisha: '0',
            net_poisha: '50000',
            txn_ref: null,
            notes: null,
            status: 'active',
            created_by: PLATFORM_USER,
            created_by_role: state.createdByRole,
            created_at: '2026-11-16T10:00:00.000Z',
            stale_rates: false,
            rate_profile_id: '77777777-7777-4777-8777-777777777777',
            supersedes_id: null,
            device_id: DEVICE_ID,
            snapshot: null,
            watermark: '7',
            scanned_count: 1,
          },
        ],
        rowCount: 1,
      };
    },
  }),
}));

const { GET: pullHandler } = await import('../../src/routes/api/v1/sync/pull/+server');

function pullEvent(since = '0'): RequestEvent {
  const url = new URL(`http://localhost/api/v1/sync/pull?since=${since}&deviceId=${DEVICE_ID}`);
  return {
    request: new Request(url, { headers: { Authorization: 'Bearer test-token' } }),
    url,
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent;
}

describe('Pull carries the creator role (Plan 023 step 12)', () => {
  beforeEach(() => {
    state.statements = [];
    state.createdByRole = 'super_admin';
  });

  it('returns created_by_role for a platform-created entry', async () => {
    const response = await pullHandler(pullEvent());
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      entries: Array<{ created_by: string; created_by_role?: string }>;
    };

    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.created_by).toBe(PLATFORM_USER);
    expect(body.entries[0]?.created_by_role).toBe('super_admin');
  });

  it('reads the role from profiles in the same statement as the entry', async () => {
    await pullHandler(pullEvent());

    const pullStatement = state.statements.find((sql) => sql.includes('from batch_meta'));
    expect(pullStatement).toBeDefined();
    expect(pullStatement).toMatch(/p\.role::text as created_by_role/i);
    expect(pullStatement).toMatch(/left join profiles\s+p\s+on\s+p\.id\s*=\s*s\.created_by/i);
  });

  it('leaves a center-authored entry with its own role, not the platform label', async () => {
    state.createdByRole = 'owner';

    const response = await pullHandler(pullEvent());
    const body = (await response.json()) as {
      entries: Array<{ created_by_role?: string }>;
    };

    expect(body.entries[0]?.created_by_role).toBe('owner');
  });
});
