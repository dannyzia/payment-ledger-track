import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { CachedPayable, CachedProfile, CachedRateProfile, LocalEntry } from './index';

const mockSessionUser: {
  id: string;
  email: string;
  role: 'staff' | 'admin' | 'owner' | 'super_admin';
  centerId: string | null;
} = {
  id: 'user-1',
  email: 'admin@test.local',
  role: 'admin',
  centerId: null,
};

vi.mock('$lib/auth/session.svelte', () => ({
  session: {
    get user() {
      return mockSessionUser;
    },
    ensureSession: vi.fn(async () => true),
  },
}));

vi.mock('$lib/auth/device', () => ({
  getOrGenerateDeviceId: () => 'device-test-1',
}));

vi.mock('$lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token-1' } },
      })),
      refreshSession: vi.fn(async () => ({ data: { session: null } })),
    },
  },
}));

vi.mock('$lib/sync/runner.svelte', () => ({
  syncRunner: {
    stop: vi.fn(),
  },
}));

const { db, getCenterDb } = await import('./index');
const {
  pruneReplacedMethods,
  pruneReplacedRateProfiles,
  pruneReplacedPayables,
  pruneReplacedMonthCloses,
  pruneReplacedProfiles,
  pruneReplacedSettlements,
  pruneReplacedStatements,
} = await import('./prune');
const { executeIncrementalPull, resetSuperCenterCache, invalidateInFlightPull } =
  await import('$lib/sync/pull');

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

const memoryLocalStorage = createMemoryStorage();
const memorySessionStorage = createMemoryStorage();
vi.stubGlobal('localStorage', memoryLocalStorage);
vi.stubGlobal('sessionStorage', memorySessionStorage);

async function clearDatabase(database: typeof db): Promise<void> {
  await Promise.all([
    database.entries.clear(),
    database.outbox.clear(),
    database.rejectedOps.clear(),
    database.rateProfiles.clear(),
    database.methods.clear(),
    database.payables.clear(),
    database.monthCloses.clear(),
    database.profiles.clear(),
    database.settlements.clear(),
    database.settlementPayments.clear(),
    database.statements.clear(),
    database.statementLines.clear(),
    database.meta.clear(),
    database.appSettings.clear(),
  ]);
}

function sampleProfile(id: string, status: 'published' | 'draft' = 'published'): CachedRateProfile {
  return {
    id,
    version: 1,
    status,
    effective_from: '2026-01-01',
    vat_mode: 'manual',
    vat_bp: 0,
    commission_bp: 4200,
    commission_base: 'gross_minus_vat',
    method_rates: {},
  };
}

function sampleEntry(id: string, overrides: Partial<LocalEntry> = {}): LocalEntry {
  return {
    id,
    local_id: `#LOCAL-${id.slice(0, 6)}`,
    entry_date: '2026-11-05',
    customer_name: 'Student A',
    sub_qty: 1,
    method_id: 'live-bkash',
    gross_poisha: '10000',
    vat_poisha: '0',
    commission_poisha: '4200',
    charge_poisha: '150',
    business_charge_poisha: '150',
    customer_charge_poisha: '0',
    net_poisha: '5650',
    status: 'active',
    sync_status: 'synced',
    created_by: 'user-1',
    created_at: '2026-11-05T10:00:00.000Z',
    stale_rates: false,
    rate_profile_id: 'live-published',
    ...overrides,
  };
}

describe('Cached config pruning and pull consistency (CLT-R-026, CLT-T-079)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockSessionUser.role = 'admin';
    mockSessionUser.centerId = null;
    memoryLocalStorage.clear();
    memorySessionStorage.clear();
    await clearDatabase(db);
    await clearDatabase(getCenterDb('center-mhk'));
    await clearDatabase(getCenterDb('center-rmp'));
  });

  it('drops cached payment methods the server no longer returns', async () => {
    await db.methods.bulkPut([
      {
        id: 'old-bkash',
        code: 'bkash',
        name: 'bKash',
        requires_txn_ref: true,
        display_order: 20,
        active: true,
      },
      {
        id: 'live-bkash',
        code: 'bkash',
        name: 'bKash',
        requires_txn_ref: true,
        display_order: 20,
        active: true,
      },
      {
        id: 'live-cash',
        code: 'cash',
        name: 'Cash',
        requires_txn_ref: false,
        display_order: 10,
        active: true,
      },
    ]);

    const deleted = await pruneReplacedMethods(['live-bkash', 'live-cash']);

    expect(deleted).toBe(1);
    expect((await db.methods.toArray()).map((m) => m.id).sort()).toEqual([
      'live-bkash',
      'live-cash',
    ]);
  });

  it('deletes nothing when the server returns the same set', async () => {
    await db.methods.bulkPut([
      {
        id: 'live-cash',
        code: 'cash',
        name: 'Cash',
        requires_txn_ref: false,
        display_order: 10,
        active: true,
      },
    ]);

    expect(await pruneReplacedMethods(['live-cash'])).toBe(0);
    expect((await db.methods.toArray()).length).toBe(1);
  });

  it('drops replaced published profiles but keeps drafts', async () => {
    await db.rateProfiles.bulkPut([
      sampleProfile('old-published', 'published'),
      sampleProfile('live-published', 'published'),
      { ...sampleProfile('draft', 'draft'), effective_from: '2026-12-01' },
    ]);

    const deleted = await pruneReplacedRateProfiles(['live-published']);

    expect(deleted).toBe(1);
    expect((await db.rateProfiles.toArray()).map((p) => p.id).sort()).toEqual([
      'draft',
      'live-published',
    ]);
  });

  it('prunes all non-protected methods and published profiles when deliveredIds is empty', async () => {
    await db.methods.bulkPut([
      {
        id: 'stale-method',
        code: 'bkash',
        name: 'bKash',
        requires_txn_ref: true,
        display_order: 20,
        active: true,
      },
    ]);
    await db.rateProfiles.bulkPut([
      sampleProfile('stale-published', 'published'),
      sampleProfile('kept-draft', 'draft'),
    ]);

    expect(await pruneReplacedMethods([])).toBe(1);
    expect(await db.methods.toArray()).toHaveLength(0);

    expect(await pruneReplacedRateProfiles([])).toBe(1);
    expect((await db.rateProfiles.toArray()).map((p) => p.id)).toEqual(['kept-draft']);
  });

  it('prunes payables, monthCloses, profiles, settlements, and statements including on empty server arrays', async () => {
    const payable: CachedPayable = {
      id: 'pay-stale',
      name: 'Old Payable',
      kind: 'vat',
      due_day: 10,
      active: true,
    };
    const keepPayable: CachedPayable = {
      id: 'pay-live',
      name: 'Live Payable',
      kind: 'vat',
      due_day: 10,
      active: true,
    };
    const staffProfile: CachedProfile = {
      id: 'prof-stale',
      role: 'staff',
      display_name: 'Old User',
      active: true,
      default_route: '/entries/new',
      created_at: '2026-11-01T00:00:00.000Z',
    };

    await db.payables.bulkPut([payable, keepPayable]);
    await db.monthCloses.bulkPut([
      { month: '2026-10-01', status: 'closed' },
      { month: '2026-11-01', status: 'open' },
    ]);
    await db.profiles.put(staffProfile);
    await db.settlements.put({
      id: 'set-stale',
      month: '2026-11-01',
      payable_id: 'pay-live',
      expected_poisha: '500',
      paid_poisha: '0',
      status: 'due',
    });
    await db.statements.put({
      id: 'stmt-stale',
      month: '2026-11-01',
      kind: 'single_payable',
      source: 'manual_total',
      status: 'open',
    });

    expect(await pruneReplacedPayables(['pay-live'])).toBe(1);
    expect((await db.payables.toArray()).map((p) => p.id)).toEqual(['pay-live']);

    expect(await pruneReplacedMonthCloses(['2026-11-01'])).toBe(1);
    expect((await db.monthCloses.toArray()).map((c) => c.month)).toEqual(['2026-11-01']);

    expect(await pruneReplacedProfiles([])).toBe(1);
    expect(await db.profiles.toArray()).toHaveLength(0);

    expect(await pruneReplacedSettlements([])).toBe(1);
    expect(await db.settlements.toArray()).toHaveLength(0);

    expect(await pruneReplacedStatements([])).toBe(1);
    expect(await db.statements.toArray()).toHaveLength(0);
  });

  it('protects method and rate-profile IDs referenced by unsynced outbox, supersede replacements, unresolved rejectedOps, and pending entries', async () => {
    await db.methods.bulkPut([
      {
        id: 'm-outbox',
        code: 'bkash',
        name: 'Outbox Method',
        requires_txn_ref: true,
        display_order: 1,
        active: true,
      },
      {
        id: 'm-supersede',
        code: 'visa',
        name: 'Supersede Replacement Method',
        requires_txn_ref: false,
        display_order: 2,
        active: true,
      },
      {
        id: 'm-rejected',
        code: 'mc',
        name: 'Rejected Pending Method',
        requires_txn_ref: false,
        display_order: 3,
        active: true,
      },
      {
        id: 'm-resolved',
        code: 'cash',
        name: 'Resolved Safe To Drop',
        requires_txn_ref: false,
        display_order: 4,
        active: true,
      },
    ]);

    await db.rateProfiles.bulkPut([
      sampleProfile('rp-outbox', 'published'),
      sampleProfile('rp-supersede', 'published'),
      sampleProfile('rp-rejected', 'published'),
      sampleProfile('rp-resolved', 'published'),
    ]);

    await db.outbox.bulkPut([
      {
        opId: 'op-pending-create',
        userId: 'user-1',
        type: 'create_entry',
        payload: {
          entryId: 'e-1',
          methodId: 'm-outbox',
          snapshot: { rateProfileId: 'rp-outbox' },
        },
        clientCreatedAt: '2026-11-05T10:00:00.000Z',
        maxKnownRateVersion: 1,
        status: 'pending',
      },
      {
        opId: 'op-pending-supersede',
        userId: 'user-1',
        type: 'supersede_entry',
        payload: {
          originalEntryId: 'e-orig',
          replacement: {
            entryId: 'e-rep',
            methodId: 'm-supersede',
            rateProfileId: 'rp-supersede',
          },
        },
        clientCreatedAt: '2026-11-05T10:01:00.000Z',
        maxKnownRateVersion: 1,
        status: 'pending',
      },
      {
        opId: 'op-already-resolved',
        userId: 'user-1',
        type: 'create_entry',
        payload: {
          entryId: 'e-old',
          methodId: 'm-resolved',
          rateProfileId: 'rp-resolved',
        },
        clientCreatedAt: '2026-11-05T09:00:00.000Z',
        maxKnownRateVersion: 1,
        status: 'resolved',
      },
    ]);

    await db.rejectedOps.bulkPut([
      {
        opId: 'rej-pending',
        entry_id: 'e-rej',
        error_code: 'calc_mismatch',
        error_message: 'calc_mismatch',
        rejected_at: '2026-11-05T10:02:00.000Z',
        status: 'pending',
        payload: {
          methodId: 'm-rejected',
          snapshot: { rateProfileId: 'rp-rejected' },
        },
      },
      {
        opId: 'rej-discarded',
        entry_id: 'e-disc',
        error_code: 'calc_mismatch',
        error_message: 'calc_mismatch',
        rejected_at: '2026-11-05T09:05:00.000Z',
        status: 'discarded',
        payload: {
          methodId: 'm-resolved',
          rateProfileId: 'rp-resolved',
        },
      },
    ]);

    const deletedMethods = await pruneReplacedMethods([]);
    const deletedProfiles = await pruneReplacedRateProfiles([]);

    expect(deletedMethods).toBe(1);
    expect(deletedProfiles).toBe(1);
    expect((await db.methods.toArray()).map((m) => m.id).sort()).toEqual([
      'm-outbox',
      'm-rejected',
      'm-supersede',
    ]);
    expect((await db.rateProfiles.toArray()).map((p) => p.id).sort()).toEqual([
      'rp-outbox',
      'rp-rejected',
      'rp-supersede',
    ]);
  });

  it('isolates pruning per center database without deleting another center cache', async () => {
    const mhkDb = getCenterDb('center-mhk');
    const rmpDb = getCenterDb('center-rmp');

    await mhkDb.methods.put({
      id: 'mhk-stale',
      code: 'bkash',
      name: 'MHK Old',
      requires_txn_ref: true,
      display_order: 1,
      active: true,
    });
    await rmpDb.methods.put({
      id: 'rmp-live',
      code: 'bkash',
      name: 'RMP Live',
      requires_txn_ref: true,
      display_order: 1,
      active: true,
    });

    mockSessionUser.centerId = 'center-mhk';
    const deleted = await pruneReplacedMethods([], db);
    expect(deleted).toBe(1);
    expect(await mhkDb.methods.toArray()).toHaveLength(0);
    expect((await rmpDb.methods.toArray()).map((m) => m.id)).toEqual(['rmp-live']);
  });

  it('prunes deleted rows across batch 1 without wiping them when batch 2 omits metadata', async () => {
    await db.methods.bulkPut([
      {
        id: 'm-stale',
        code: 'old',
        name: 'Old',
        requires_txn_ref: false,
        display_order: 1,
        active: true,
      },
      {
        id: 'm-keep',
        code: 'cash',
        name: 'Cash',
        requires_txn_ref: false,
        display_order: 2,
        active: true,
      },
    ]);
    await db.payables.put({
      id: 'p-stale',
      name: 'Old Payable',
      kind: 'vat',
      due_day: 10,
      active: true,
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [],
            hasMore: true,
            nextCursor: '10',
            rateProfiles: [sampleProfile('rp-live', 'published')],
            methods: [
              {
                id: 'm-keep',
                code: 'cash',
                name: 'Cash',
                requires_txn_ref: false,
                sort_order: 10,
                active: true,
              },
            ],
            payables: [],
            monthCloses: [],
            profiles: [],
            settlements: [],
            statements: [],
            rejectedOps: [],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [],
            hasMore: false,
            nextCursor: '10',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await executeIncrementalPull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0] as string).toContain('includeMeta=true');
    expect(fetchMock.mock.calls[1][0] as string).toContain('includeMeta=false');
    expect((await db.methods.toArray()).map((m) => m.id)).toEqual(['m-keep']);
    expect((await db.rateProfiles.toArray()).map((p) => p.id)).toEqual(['rp-live']);
    expect(await db.payables.toArray()).toHaveLength(0);
  });

  it('does not prune admin-gated tables when a staff pull omits them', async () => {
    mockSessionUser.role = 'staff';
    await db.methods.put({
      id: 'm-stale',
      code: 'old',
      name: 'Old',
      requires_txn_ref: false,
      display_order: 1,
      active: true,
    });
    await db.profiles.put({
      id: 'prof-cached',
      role: 'admin',
      display_name: 'Admin',
      active: true,
      default_route: '/dashboard',
      created_at: '2026-11-01T00:00:00.000Z',
    });
    await db.settlements.put({
      id: 'set-cached',
      month: '2026-11-01',
      payable_id: 'p1',
      expected_poisha: '100',
      paid_poisha: '0',
      status: 'due',
    });
    await db.statements.put({
      id: 'stmt-cached',
      month: '2026-11-01',
      kind: 'single_payable',
      source: 'manual_total',
      status: 'open',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [],
            hasMore: false,
            nextCursor: '5',
            rateProfiles: [],
            methods: [],
            payables: [],
            monthCloses: [],
            rejectedOps: [],
          }),
          { status: 200 },
        ),
      ),
    );

    await executeIncrementalPull();

    expect(await db.methods.toArray()).toHaveLength(0);
    expect((await db.profiles.toArray()).map((p) => p.id)).toEqual(['prof-cached']);
    expect((await db.settlements.toArray()).map((s) => s.id)).toEqual(['set-cached']);
    expect((await db.statements.toArray()).map((s) => s.id)).toEqual(['stmt-cached']);
  });

  it('clears synced entries and resets cursor to 0 on 409 watermark mismatch while preserving pending entries', async () => {
    memoryLocalStorage.setItem('clt_server_cursor', '42');
    await db.meta.put({
      key: 'server_cursor',
      value: '42',
      updated_at: '2026-11-05T10:00:00.000Z',
    });
    await db.entries.bulkPut([
      sampleEntry('entry-synced', { sync_status: 'synced' }),
      sampleEntry('entry-pending', { sync_status: 'pending' }),
      sampleEntry('entry-rejected', { sync_status: 'rejected' }),
    ]);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'cursor_past_watermark', currentSequence: '0' }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entries: [],
            hasMore: false,
            nextCursor: '0',
            rateProfiles: [],
            methods: [],
            payables: [],
            monthCloses: [],
            rejectedOps: [],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await executeIncrementalPull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0] as string).toContain('since=42');
    expect(fetchMock.mock.calls[1][0] as string).toContain('since=0');
    expect(fetchMock.mock.calls[1][0] as string).toContain('includeMeta=true');
    expect((await db.entries.toArray()).map((e) => e.id).sort()).toEqual([
      'entry-pending',
      'entry-rejected',
    ]);
    expect(memoryLocalStorage.getItem('clt_server_cursor')).toBe('0');
    expect((await db.meta.get('server_cursor'))?.value).toBe('0');
  });

  it('resetSuperCenterCache clears cross-center tables and resets cursor while preserving queued outbox refs', async () => {
    memoryLocalStorage.setItem('clt_server_cursor', '99');
    await db.meta.put({
      key: 'server_cursor',
      value: '99',
      updated_at: '2026-11-05T10:00:00.000Z',
    });
    await db.entries.bulkPut([
      sampleEntry('entry-synced-old', { sync_status: 'synced' }),
      sampleEntry('entry-pending-keep', {
        sync_status: 'pending',
        method_id: 'm-keep',
        rate_profile_id: 'rp-keep',
      }),
    ]);
    await db.outbox.put({
      opId: 'op-keep',
      userId: 'user-1',
      type: 'create_entry',
      payload: {
        entryId: 'entry-pending-keep',
        methodId: 'm-keep',
        rateProfileId: 'rp-keep',
      },
      clientCreatedAt: '2026-11-05T10:00:00.000Z',
      maxKnownRateVersion: 1,
      status: 'pending',
    });
    await db.methods.bulkPut([
      {
        id: 'm-drop',
        code: 'cash',
        name: 'Drop',
        requires_txn_ref: false,
        display_order: 1,
        active: true,
      },
      {
        id: 'm-keep',
        code: 'bkash',
        name: 'Keep',
        requires_txn_ref: true,
        display_order: 2,
        active: true,
      },
    ]);
    await db.rateProfiles.bulkPut([
      sampleProfile('rp-drop', 'published'),
      sampleProfile('rp-keep', 'published'),
    ]);
    await db.payables.put({
      id: 'pay-drop',
      name: 'Drop',
      kind: 'vat',
      due_day: 10,
      active: true,
    });
    await db.monthCloses.put({ month: '2026-11-01', status: 'closed' });
    await db.settlements.put({
      id: 'set-drop',
      month: '2026-11-01',
      payable_id: 'pay-drop',
      expected_poisha: '100',
      paid_poisha: '0',
      status: 'due',
    });
    await db.statements.put({
      id: 'stmt-drop',
      month: '2026-11-01',
      kind: 'single_payable',
      source: 'manual_total',
      status: 'open',
    });

    await resetSuperCenterCache();

    expect((await db.entries.toArray()).map((e) => e.id)).toEqual(['entry-pending-keep']);
    expect((await db.methods.toArray()).map((m) => m.id)).toEqual(['m-keep']);
    expect((await db.rateProfiles.toArray()).map((p) => p.id)).toEqual(['rp-keep']);
    expect(await db.payables.toArray()).toHaveLength(0);
    expect(await db.monthCloses.toArray()).toHaveLength(0);
    expect(await db.settlements.toArray()).toHaveLength(0);
    expect(await db.statements.toArray()).toHaveLength(0);
    expect(memoryLocalStorage.getItem('clt_server_cursor')).toBe('0');
    expect((await db.meta.get('server_cursor'))?.value).toBe('0');
  });

  it('invalidateInFlightPull ignores stale responses if center switched mid-pull', async () => {
    let resolveFetch!: (value: Response) => void;
    const deferredFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(deferredFetch));

    const pullPromise = executeIncrementalPull();
    await new Promise((r) => setTimeout(r, 10));
    invalidateInFlightPull();

    resolveFetch(
      new Response(
        JSON.stringify({
          entries: [sampleEntry('stale-entry-should-not-write')],
          hasMore: false,
          nextCursor: '777',
          methods: [
            {
              id: 'stale-method-should-not-write',
              code: 'cash',
              name: 'Stale',
              requires_txn_ref: false,
              sort_order: 1,
              active: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(pullPromise).resolves.toBeUndefined();
    expect(await db.entries.toArray()).toHaveLength(0);
    expect(await db.methods.toArray()).toHaveLength(0);
    expect(memoryLocalStorage.getItem('clt_server_cursor')).toBeNull();
  });
});
