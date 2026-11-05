import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateClockSkewDelta, isClockSkewExceeded, reconcileTimestamp } from './clock';
import { isOpOlderThan90Days, NINETY_DAYS_MS } from './retention';
import { initStoragePersistence, getStorageQuota } from './storage';

afterEach(() => {
  // Restores the original navigator descriptor between tests: the plan's
  // Object.defineProperty restore pattern leaves navigator non-configurable,
  // which throws on the next stub (CLT-D-021 deviation).
  vi.unstubAllGlobals();
});

describe('PWA Clock Skew (PRD §9.2.2)', () => {
  it('calculates zero delta when client and server times match', () => {
    const nowIso = new Date('2026-10-29T10:00:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:00:00.000Z');

    const delta = calculateClockSkewDelta(nowIso, clientNow);
    expect(delta).toBe(0);
    expect(isClockSkewExceeded(delta)).toBe(false);
  });

  it('detects client clock ahead of server by 8 minutes', () => {
    const serverHeader = new Date('2026-10-29T10:00:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:08:00.000Z');

    const delta = calculateClockSkewDelta(serverHeader, clientNow);
    expect(delta).toBe(-8 * 60 * 1000);
    expect(isClockSkewExceeded(delta)).toBe(true);
  });

  it('detects client clock behind server by 6 minutes', () => {
    const serverHeader = new Date('2026-10-29T10:06:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:00:00.000Z');

    const delta = calculateClockSkewDelta(serverHeader, clientNow);
    expect(delta).toBe(6 * 60 * 1000);
    expect(isClockSkewExceeded(delta)).toBe(true);
  });

  it('accounts for network round-trip latency in clock delta calculation', () => {
    const serverHeader = new Date('2026-10-29T10:00:00.000Z').toUTCString();
    const clientNow = Date.parse('2026-10-29T10:00:00.000Z');
    const rttMs = 2000; // 2s RTT -> 1s transit

    const delta = calculateClockSkewDelta(serverHeader, clientNow, rttMs);
    expect(delta).toBe(1000);
  });

  it('reconciles client timestamp by applying server delta', () => {
    const clientTimestamp = '2026-10-29T10:08:00.000Z';
    const deltaMs = -8 * 60 * 1000;

    const reconciled = reconcileTimestamp(clientTimestamp, deltaMs);
    expect(reconciled).toBe('2026-10-29T10:00:00.000Z');
  });

  it('handles invalid server date header safely', () => {
    const delta = calculateClockSkewDelta('invalid-header');
    expect(delta).toBe(0);
    expect(isClockSkewExceeded(delta)).toBe(false);
  });
});

describe('PWA Storage Persistence and Retention (PRD §9.1(g), §9.2, §12, Test #25)', () => {
  it('validates 90-day retention calculation cutoff and exact boundary', () => {
    const now = Date.now();
    const exactlyNinetyDaysAgo = new Date(now - NINETY_DAYS_MS).toISOString();
    const ninetyDaysAndOneMsAgo = new Date(now - NINETY_DAYS_MS - 1).toISOString();
    const eightyNineDaysAgo = new Date(now - 89 * 24 * 60 * 60 * 1000).toISOString();

    expect(isOpOlderThan90Days(eightyNineDaysAgo, now)).toBe(false);
    expect(isOpOlderThan90Days(exactlyNinetyDaysAgo, now)).toBe(false);
    expect(isOpOlderThan90Days(ninetyDaysAndOneMsAgo, now)).toBe(true);
  });

  it('calibrates 90-day retention evaluation with server clock skew delta', () => {
    const now = Date.now();
    const eightyNineDaysAgo = new Date(now - 89 * 24 * 60 * 60 * 1000).toISOString();
    const skewDeltaMs = 2 * 24 * 60 * 60 * 1000; // True server time is 2 days ahead

    expect(isOpOlderThan90Days(eightyNineDaysAgo, now)).toBe(false);
    expect(isOpOlderThan90Days(eightyNineDaysAgo, now, skewDeltaMs)).toBe(true);
  });

  it('requests persistent storage via navigator.storage.persist()', async () => {
    const mockPersist = vi.fn().mockResolvedValue(true);
    const mockPersisted = vi.fn().mockResolvedValue(false);

    vi.stubGlobal('navigator', {
      storage: {
        persist: mockPersist,
        persisted: mockPersisted,
      },
    });

    const result = await initStoragePersistence();
    expect(result).toBe(true);
    expect(mockPersisted).toHaveBeenCalled();
    expect(mockPersist).toHaveBeenCalled();
  });

  it('handles already-persisted storage gracefully without re-requesting persist()', async () => {
    const mockPersist = vi.fn();
    const mockPersisted = vi.fn().mockResolvedValue(true);

    vi.stubGlobal('navigator', {
      storage: {
        persist: mockPersist,
        persisted: mockPersisted,
      },
    });

    const result = await initStoragePersistence();
    expect(result).toBe(true);
    expect(mockPersisted).toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('handles throwing storage API gracefully without crashing', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: vi.fn().mockRejectedValue(new Error('SecurityError')),
        persisted: vi.fn().mockRejectedValue(new Error('SecurityError')),
        estimate: vi.fn().mockRejectedValue(new Error('SecurityError')),
      },
    });

    const persistResult = await initStoragePersistence();
    expect(persistResult).toBe(false);

    const quotaResult = await getStorageQuota();
    expect(quotaResult.persisted).toBe(false);
  });

  it('reports storage quota and usage percentages accurately', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(true),
        estimate: vi.fn().mockResolvedValue({
          quota: 1000000,
          usage: 250000,
        }),
      },
    });

    const status = await getStorageQuota();
    expect(status.persisted).toBe(true);
    expect(status.quotaBytes).toBe(1000000);
    expect(status.usageBytes).toBe(250000);
    expect(status.percentUsed).toBe(25.0);
  });
});
