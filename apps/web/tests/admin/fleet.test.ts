import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Plan 023 step 15 — the fleet routes over a fixture fleet.
 *
 * The dashboard aggregates across every center, so the thing that can go wrong silently is
 * arithmetic and scoping: a sum that mixes statuses, a window that starts a day early, a
 * count that includes revoked devices. The users and devices routes are the same shape:
 * the tenant comes from the request (the seat has no center), every action goes through an
 * RPC that re-checks authority, and a force sign-out revokes refresh tokens rather than
 * claiming a sign-out it did not perform.
 *
 * The fake pool recognises each statement by shape and mirrors the predicate the SQL
 * applies; the fake RPC records what it was called with so the action mapping is asserted.
 */

const FIXTURE = vi.hoisted(() => {
  const MHK = '11111111-1111-4111-8111-111111111111';
  const RMP = '22222222-2222-4222-8222-222222222222';
  const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const DEVICE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  interface State {
    centers: Array<{ id: string; code: string; name: string; status: string }>;
    entries: Array<{
      centerId: string;
      entryDate: string;
      status: string;
      grossPoisha: string;
      createdAt: string;
    }>;
    devices: Array<{
      deviceId: string;
      centerId: string;
      userId: string;
      deviceName: string | null;
      lastSeenAt: string;
      lastRateVersion: number;
      revoked: boolean;
    }>;
    users: Array<{
      id: string;
      fullName: string;
      email: string;
      role: string;
      active: boolean;
      centerId: string | null;
      createdAt: string;
    }>;
    rejected: number;
    staleRates: { flagged: number; pendingReview: number };
    backupAt: string | null;
    revokedTokens: number;
    rpcCalls: Array<Record<string, unknown>>;
    rpcError: { message: string } | null;
  }

  function initialState(): State {
    return {
      centers: [
        { id: MHK, code: 'MHK', name: 'Mohakhali', status: 'active' },
        { id: RMP, code: 'RMP', name: 'Rampura', status: 'suspended' },
      ],
      entries: [
        // MHK: two today, one a week ago, one outside the month.
        {
          centerId: MHK,
          entryDate: '2026-11-15',
          status: 'active',
          grossPoisha: '1000',
          createdAt: '2026-11-15T03:00:00Z',
        },
        {
          centerId: MHK,
          entryDate: '2026-11-15',
          status: 'active',
          grossPoisha: '2500',
          createdAt: '2026-11-15T04:00:00Z',
        },
        {
          centerId: MHK,
          entryDate: '2026-11-10',
          status: 'active',
          grossPoisha: '500',
          createdAt: '2026-11-10T04:00:00Z',
        },
        {
          centerId: MHK,
          entryDate: '2026-09-01',
          status: 'active',
          grossPoisha: '9999',
          createdAt: '2026-09-01T04:00:00Z',
        },
        // Voided today: counted nowhere.
        {
          centerId: MHK,
          entryDate: '2026-11-15',
          status: 'voided',
          grossPoisha: '7777',
          createdAt: '2026-11-15T05:00:00Z',
        },
        // RMP: one today.
        {
          centerId: RMP,
          entryDate: '2026-11-15',
          status: 'active',
          grossPoisha: '400',
          createdAt: '2026-11-15T06:00:00Z',
        },
      ],
      devices: [
        {
          deviceId: DEVICE,
          centerId: MHK,
          userId: USER_A,
          deviceName: 'Counter tablet',
          lastSeenAt: '2026-11-15T05:00:00Z',
          lastRateVersion: 3,
          revoked: false,
        },
        {
          deviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          centerId: RMP,
          userId: USER_B,
          deviceName: null,
          lastSeenAt: '2026-10-01T05:00:00Z',
          lastRateVersion: 1,
          revoked: false,
        },
        {
          deviceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          centerId: RMP,
          userId: USER_B,
          deviceName: 'Old phone',
          lastSeenAt: '2026-09-01T05:00:00Z',
          lastRateVersion: 1,
          revoked: true,
        },
      ],
      users: [
        {
          id: USER_A,
          fullName: 'Ayesha Rahman',
          email: 'ayesha@example.test',
          role: 'owner',
          active: true,
          centerId: MHK,
          createdAt: '2026-10-01T00:00:00Z',
        },
        {
          id: USER_B,
          fullName: 'Bashir Khan',
          email: 'bashir@example.test',
          role: 'staff',
          active: false,
          centerId: RMP,
          createdAt: '2026-10-02T00:00:00Z',
        },
      ],
      rejected: 2,
      staleRates: { flagged: 3, pendingReview: 1 },
      backupAt: null,
      revokedTokens: 2,
      rpcCalls: [],
      rpcError: null,
    };
  }

  const TODAY = '2026-11-15';

  /** Mirrors `(now() at time zone 'Asia/Dhaka')::date` for the fixture's fixed day. */
  function daysBefore(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - days);
    return value.toISOString().slice(0, 10);
  }

  function makeDb(state: State) {
    return {
      async query(sql: string, params: unknown[] = []) {
        if (/FROM centers\n *GROUP BY status/.test(sql)) {
          const byStatus = new Map<string, number>();
          for (const center of state.centers) {
            byStatus.set(center.status, (byStatus.get(center.status) ?? 0) + 1);
          }
          return {
            rows: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
          };
        }

        if (/LEFT JOIN entries e ON e\.center_id = c\.id/.test(sql)) {
          const weekStart = daysBefore(TODAY, 6);
          const monthStart = daysBefore(TODAY, 29);
          const rows = state.centers.map((center) => {
            const own = state.entries.filter(
              (entry) => entry.centerId === center.id && entry.status === 'active',
            );
            const inWindow = (entryDate: string, start: string) =>
              entryDate >= start && entryDate <= TODAY;
            const sum = (list: typeof own) =>
              list.reduce((total, entry) => total + BigInt(entry.grossPoisha), 0n).toString();

            return {
              id: center.id,
              code: center.code,
              name: center.name,
              status: center.status,
              entries_today: own.filter((entry) => entry.entryDate === TODAY).length,
              gross_today: sum(own.filter((entry) => entry.entryDate === TODAY)),
              entries_7d: own.filter((entry) => inWindow(entry.entryDate, weekStart)).length,
              gross_7d: sum(own.filter((entry) => inWindow(entry.entryDate, weekStart))),
              entries_30d: own.filter((entry) => inWindow(entry.entryDate, monthStart)).length,
              gross_30d: sum(own.filter((entry) => inWindow(entry.entryDate, monthStart))),
              last_entry_at: own.length
                ? own
                    .map((entry) => entry.createdAt)
                    .sort()
                    .at(-1)
                : null,
            };
          });
          return { rows };
        }

        if (/count\(\*\)::int AS total/.test(sql)) {
          const staleDays = Number(params[0]);
          const cutoff = new Date('2026-11-15T00:00:00Z');
          cutoff.setUTCDate(cutoff.getUTCDate() - staleDays);
          const stale = state.devices.filter(
            (device) => !device.revoked && new Date(device.lastSeenAt) < cutoff,
          );
          return {
            rows: [
              {
                total: state.devices.length,
                revoked: state.devices.filter((device) => device.revoked).length,
                stale: stale.length,
                last_seen_at: state.devices
                  .map((device) => device.lastSeenAt)
                  .sort()
                  .at(-1),
              },
            ],
          };
        }

        if (/FROM sync_ops/.test(sql)) {
          return {
            rows: [
              {
                count: state.rejected,
                oldest_created_at: state.rejected > 0 ? '2026-11-14T02:00:00Z' : null,
              },
            ],
          };
        }

        if (/stale_rates/.test(sql)) {
          return {
            rows: [
              {
                flagged_entries: state.staleRates.flagged,
                pending_review: state.staleRates.pendingReview,
              },
            ],
          };
        }

        if (/FROM audit_log/.test(sql)) {
          return { rows: [{ last_at: state.backupAt }] };
        }

        if (/FROM profiles p/.test(sql)) {
          const centerId = params.find((param) => param === MHK || param === RMP);
          const term = params.find(
            (param) => typeof param === 'string' && param.startsWith('%'),
          ) as string | undefined;
          const needle = term?.slice(1, -1).toLowerCase();
          const rows = state.users
            .filter((user) => (centerId ? user.centerId === centerId : true))
            .filter((user) =>
              needle
                ? user.fullName.toLowerCase().includes(needle) ||
                  user.email.toLowerCase().includes(needle)
                : true,
            )
            .sort(
              (a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName),
            )
            .map((user) => {
              const center = state.centers.find((candidate) => candidate.id === user.centerId);
              return {
                id: user.id,
                full_name: user.fullName,
                email: user.email,
                role: user.role,
                active: user.active,
                center_id: user.centerId,
                center_code: center?.code ?? null,
                center_name: center?.name ?? null,
                created_at: user.createdAt,
              };
            });
          return { rows };
        }

        if (/FROM devices d/.test(sql)) {
          const centerId = params.find((param) => param === MHK || param === RMP);
          const staleOnly = /make_interval/.test(sql);
          const cutoff = new Date('2026-10-31T00:00:00Z');
          const rows = state.devices
            .filter((device) => (centerId ? device.centerId === centerId : true))
            .filter((device) =>
              staleOnly ? !device.revoked && new Date(device.lastSeenAt) < cutoff : true,
            )
            .sort(
              (a, b) =>
                Number(a.revoked) - Number(b.revoked) || b.lastSeenAt.localeCompare(a.lastSeenAt),
            )
            .map((device) => {
              const center = state.centers.find((candidate) => candidate.id === device.centerId)!;
              const user = state.users.find((candidate) => candidate.id === device.userId);
              return {
                device_id: device.deviceId,
                device_name: device.deviceName,
                last_seen_at: device.lastSeenAt,
                last_rate_version: device.lastRateVersion,
                revoked: device.revoked,
                user_id: device.userId,
                full_name: user?.fullName ?? null,
                user_active: user?.active ?? null,
                center_id: center.id,
                center_code: center.code,
                center_name: center.name,
              };
            });
          return { rows };
        }

        if (/UPDATE auth\.refresh_tokens/.test(sql)) {
          return { rows: [], rowCount: state.revokedTokens };
        }

        throw new Error(`fixture pool received an unrecognised statement: ${sql.slice(0, 70)}`);
      },
    };
  }

  function fakeSupabase(state: State) {
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, ...args });
        return { data: null, error: state.rpcError };
      },
    };
  }

  return { MHK, RMP, USER_A, USER_B, DEVICE, initialState, makeDb, fakeSupabase };
});

const CALLER = vi.hoisted(() => ({
  userId: 'seat-user',
  role: 'super_admin',
  aal: 'aal2',
  centerId: null,
}));

vi.mock('$lib/server/auth', () => ({
  getCallerContext: async () => CALLER,
  requireRole: () => undefined,
}));
vi.mock('$lib/server/assurance', () => ({ requireAssurance: () => undefined }));
vi.mock('$lib/server/capabilities', () => ({ requireCapability: () => undefined }));

const state = FIXTURE.initialState();

vi.mock('$lib/server/db', () => ({ getDbPool: () => FIXTURE.makeDb(state) }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: () => FIXTURE.fakeSupabase(state) }));

const dashboard = await import('../../src/routes/api/v1/admin/super/dashboard/+server');
const users = await import('../../src/routes/api/v1/admin/super/users/+server');
const devices = await import('../../src/routes/api/v1/admin/super/devices/+server');

function getEvent(url: string): RequestEvent {
  const parsed = new URL(url);
  return { url: parsed, request: new Request(parsed) } as unknown as RequestEvent;
}

function postEvent(url: string, body: unknown): RequestEvent {
  const parsed = new URL(url);
  return {
    url: parsed,
    request: new Request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}

function reset() {
  Object.assign(state, FIXTURE.initialState());
}

describe('GET /api/v1/admin/super/dashboard (plan 023 step 15)', () => {
  it('counts centers by status and active entries per window', async () => {
    reset();
    const response = await dashboard.GET(getEvent('http://localhost/api/v1/admin/super/dashboard'));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      centers: { total: number; byStatus: Record<string, number> };
      fleet: Array<{
        code: string;
        status: string;
        entries: { today: number; last7Days: number; last30Days: number };
        grossPoisha: { today: string; last7Days: string; last30Days: string };
        lastEntryAt: string | null;
      }>;
    };

    expect(body.centers.total).toBe(2);
    expect(body.centers.byStatus).toEqual({ active: 1, suspended: 1, archived: 0 });

    const mhk = body.fleet.find((row) => row.code === 'MHK')!;
    // The voided entry is excluded from both the count and the money.
    expect(mhk.entries).toEqual({ today: 2, last7Days: 3, last30Days: 3 });
    expect(mhk.grossPoisha).toEqual({ today: '3500', last7Days: '4000', last30Days: '4000' });
    expect(mhk.lastEntryAt).toBe('2026-11-15T04:00:00Z');

    const rmp = body.fleet.find((row) => row.code === 'RMP')!;
    expect(rmp.status).toBe('suspended');
    expect(rmp.entries).toEqual({ today: 1, last7Days: 1, last30Days: 1 });
    expect(rmp.grossPoisha.today).toBe('400');
  });

  it('reports fleet health and admits when the backup is not recorded', async () => {
    reset();
    const body = (await (
      await dashboard.GET(getEvent('http://localhost/api/v1/admin/super/dashboard'))
    ).json()) as {
      devices: { total: number; revoked: number; stale: number; staleAfterDays: number };
      rejectedOperations: { pending: number; oldestCreatedAt: string | null };
      staleRates: { flaggedEntries: number; pendingReview: number };
      backup: { recorded: boolean; lastSuccessAt: string | null; source: string };
    };

    // Two unrevoked devices, one of them quiet for 45 days; the revoked one is not stale.
    expect(body.devices).toMatchObject({ total: 3, revoked: 1, stale: 1, staleAfterDays: 14 });
    expect(body.rejectedOperations.pending).toBe(2);
    expect(body.rejectedOperations.oldestCreatedAt).toBe('2026-11-14T02:00:00Z');
    expect(body.staleRates).toEqual({ flaggedEntries: 3, pendingReview: 1 });
    // No row is written by the export, so it reports that instead of inventing a time.
    expect(body.backup).toMatchObject({ recorded: false, lastSuccessAt: null });
    expect(body.backup.source).toContain('backup-export');
  });
});

describe('GET /api/v1/admin/super/users (plan 023 step 15)', () => {
  it('lists every center and reports each user’s center', async () => {
    reset();
    const response = await users.GET(getEvent('http://localhost/api/v1/admin/super/users'));
    const body = (await response.json()) as {
      users: Array<{ id: string; centerCode: string | null; active: boolean }>;
    };

    expect(body.users.map((user) => user.id)).toEqual([FIXTURE.USER_A, FIXTURE.USER_B]);
    expect(body.users.map((user) => user.centerCode)).toEqual(['MHK', 'RMP']);
  });

  it('searches by name or email and narrows to one center', async () => {
    reset();
    const byName = (await (
      await users.GET(getEvent('http://localhost/api/v1/admin/super/users?q=bashir'))
    ).json()) as { users: Array<{ id: string }> };
    expect(byName.users.map((user) => user.id)).toEqual([FIXTURE.USER_B]);

    const byEmail = (await (
      await users.GET(getEvent('http://localhost/api/v1/admin/super/users?q=ayesha@'))
    ).json()) as { users: Array<{ id: string }> };
    expect(byEmail.users.map((user) => user.id)).toEqual([FIXTURE.USER_A]);

    const byCenter = (await (
      await users.GET(getEvent(`http://localhost/api/v1/admin/super/users?centerId=${FIXTURE.RMP}`))
    ).json()) as { users: Array<{ id: string }> };
    expect(byCenter.users.map((user) => user.id)).toEqual([FIXTURE.USER_B]);
  });

  it('refuses a malformed center filter', async () => {
    reset();
    const response = await users.GET(
      getEvent('http://localhost/api/v1/admin/super/users?centerId=not-a-uuid'),
    );
    expect(response.status).toBe(400);
  });

  it('maps disable, enable and force sign-out onto the RPC actions', async () => {
    reset();
    const target = `http://localhost/api/v1/admin/super/users`;

    for (const [action, rpcAction] of [
      ['disable', 'deactivate'],
      ['enable', 'reactivate'],
      ['force_signout', 'force_signout'],
    ] as const) {
      const response = await users.POST(
        postEvent(target, { centerId: FIXTURE.MHK, userId: FIXTURE.USER_A, action }),
      );
      expect(response.status).toBe(200);
      const call = state.rpcCalls.at(-1)!;
      expect(call).toMatchObject({
        name: 'admin_manage_user',
        p_center_id: FIXTURE.MHK,
        p_user_id: FIXTURE.USER_A,
        p_action: rpcAction,
        p_actor_id: 'seat-user',
      });
    }
  });

  it('reports the revoked session count on force sign-out only', async () => {
    reset();
    const url = 'http://localhost/api/v1/admin/super/users';

    const forced = await users.POST(
      postEvent(url, { centerId: FIXTURE.MHK, userId: FIXTURE.USER_A, action: 'force_signout' }),
    );
    expect((await forced.json()) as { sessionsRevoked: number }).toMatchObject({
      sessionsRevoked: 2,
    });

    const disabled = await users.POST(
      postEvent(url, { centerId: FIXTURE.MHK, userId: FIXTURE.USER_A, action: 'disable' }),
    );
    expect((await disabled.json()) as { sessionsRevoked: number }).toMatchObject({
      sessionsRevoked: 0,
    });
  });

  it('surfaces an RPC refusal as 403 and a bad body as 400', async () => {
    reset();
    const url = 'http://localhost/api/v1/admin/super/users';

    state.rpcError = { message: '403 unauthorized' };
    const refused = await users.POST(
      postEvent(url, { centerId: FIXTURE.MHK, userId: FIXTURE.USER_A, action: 'disable' }),
    );
    expect(refused.status).toBe(403);

    state.rpcError = null;
    const bad = await users.POST(postEvent(url, { centerId: FIXTURE.MHK, action: 'disable' }));
    expect(bad.status).toBe(400);
  });
});

describe('GET|POST /api/v1/admin/super/devices (plan 023 step 15)', () => {
  it('lists devices across centers with their user and state', async () => {
    reset();
    const body = (await (
      await devices.GET(getEvent('http://localhost/api/v1/admin/super/devices'))
    ).json()) as {
      staleAfterDays: number;
      devices: Array<{
        deviceId: string;
        centerCode: string;
        revoked: boolean;
        userName: string | null;
      }>;
    };

    expect(body.staleAfterDays).toBe(14);
    expect(body.devices).toHaveLength(3);
    expect(body.devices[0]).toMatchObject({
      deviceId: FIXTURE.DEVICE,
      centerCode: 'MHK',
      revoked: false,
      userName: 'Ayesha Rahman',
    });
    // Revoked devices sort last.
    expect(body.devices.at(-1)!.revoked).toBe(true);
  });

  it('filters by center and by silence', async () => {
    reset();
    const byCenter = (await (
      await devices.GET(
        getEvent(`http://localhost/api/v1/admin/super/devices?centerId=${FIXTURE.RMP}`),
      )
    ).json()) as { devices: Array<{ centerCode: string }> };
    expect(byCenter.devices).toHaveLength(2);
    expect(byCenter.devices.every((device) => device.centerCode === 'RMP')).toBe(true);

    const stale = (await (
      await devices.GET(getEvent('http://localhost/api/v1/admin/super/devices?staleOnly=true'))
    ).json()) as { devices: Array<{ revoked: boolean }> };
    expect(stale.devices).toHaveLength(1);
    expect(stale.devices[0].revoked).toBe(false);
  });

  it('sends revoke and unrevoke to the device RPC with the named center', async () => {
    reset();
    const url = 'http://localhost/api/v1/admin/super/devices';

    for (const action of ['revoke', 'unrevoke'] as const) {
      const response = await devices.POST(
        postEvent(url, { centerId: FIXTURE.MHK, deviceId: FIXTURE.DEVICE, action }),
      );
      expect(response.status).toBe(200);
      expect(state.rpcCalls.at(-1)).toMatchObject({
        name: 'admin_manage_device',
        p_center_id: FIXTURE.MHK,
        p_device_id: FIXTURE.DEVICE,
        p_action: action,
        p_actor_id: 'seat-user',
      });
    }
  });

  it('refuses a non-uuid device id', async () => {
    reset();
    const response = await devices.POST(
      postEvent('http://localhost/api/v1/admin/super/devices', {
        centerId: FIXTURE.MHK,
        deviceId: 'echo',
        action: 'revoke',
      }),
    );
    expect(response.status).toBe(400);
  });
});
