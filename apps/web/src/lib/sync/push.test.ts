import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id: 'user-1' }, access_token: 'token-1' } },
      })),
      refreshSession: vi.fn(async () => ({ data: { session: null } })),
    },
  },
}));

vi.mock('$lib/auth/device', () => ({ getOrGenerateDeviceId: () => 'device-1' }));
vi.mock('./canonical', () => ({ computeJcsSha256: vi.fn(async () => 'hash-1') }));
vi.mock('./recovery', () => ({ handleOpRejection: vi.fn() }));

const pendingOp = {
  opId: 'op-1',
  userId: 'user-1',
  type: 'create_entry',
  payload: { entryId: 'entry-1', entryDate: '2026-11-06', grossPoisha: '10000' },
  clientCreatedAt: '2026-11-06T10:00:00.000Z',
  maxKnownRateVersion: 1,
  status: 'pending',
};

vi.mock('$lib/db', () => {
  const outbox = {
    where: () => ({
      equals: () => ({
        and: () => ({ sortBy: async () => [pendingOp] }),
      }),
    }),
    delete: vi.fn(),
  };
  const entries = { update: vi.fn() };
  return { db: { outbox, entries } };
});

const { flushOutboxPush } = await import('./push');

describe('Push transport classification (CLT-R-016)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a dropped connection as network_offline, not a sync error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await expect(flushOutboxPush()).rejects.toThrow('network_offline');
  });

  it('still reports a server-side failure as an ordinary error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'internal' }), { status: 500 }),
      ),
    );

    await expect(flushOutboxPush()).resolves.toEqual({
      success: false,
      pushedCount: 0,
    });
  });

  it('keeps a 401 with no refreshable session in the error path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
      ),
    );

    await expect(flushOutboxPush()).resolves.toEqual({
      success: false,
      pushedCount: 0,
    });
  });
});
