// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNativePreference, setNativePreference } from './preferences';
import { triggerHapticTick, triggerHapticSuccess, triggerHapticWarning } from './haptics';
import { computeReminderDate } from './reminders';
import { resolveApiUrl } from '$lib/api';

describe('Capacitor Native Utilities & Graceful Fallbacks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Native Preferences Fallback', () => {
    it('persists and retrieves values using standard browser storage', async () => {
      await setNativePreference('test_key', 'test_value_123');
      const val = await getNativePreference('test_key');
      expect(val).toBe('test_value_123');
    });

    it('falls back seamlessly to in-memory store when localStorage is restricted or undefined', async () => {
      // vi.stubGlobal sets globalThis.localStorage = undefined, which makes the
      // bare `typeof localStorage` guard in preferences.ts resolve to 'undefined'
      // (same approach as CLT-D-021 #8; direct delete leaves jsdom's window
      // binding intact because globalThis aliases the window proxy)
      vi.stubGlobal('localStorage', undefined);
      try {
        await setNativePreference('isolated_key', 'fallback_data');
        const retrieved = await getNativePreference('isolated_key');
        expect(retrieved).toBe('fallback_data');

        const missing = await getNativePreference('non_existent_key');
        expect(missing).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('Native Haptics Fallback', () => {
    it('executes triggerHapticTick safely in non-native test environments without throwing', async () => {
      await expect(triggerHapticTick()).resolves.toBeUndefined();
    });

    it('executes triggerHapticSuccess safely in non-native test environments without throwing', async () => {
      await expect(triggerHapticSuccess()).resolves.toBeUndefined();
    });

    it('executes triggerHapticWarning safely in non-native test environments without throwing', async () => {
      await expect(triggerHapticWarning()).resolves.toBeUndefined();
    });
  });

  describe('Settlement Reminders Calculation', () => {
    it('calculates reminder date in month M+1 based on payable dueDay and remindDaysBefore (PRD §10, §8.4)', () => {
      const settlementMonth = '2026-03-01'; // March settlement -> Due in April
      const dueDay = 15;
      const remindDaysBefore = 3;

      const reminderDate = computeReminderDate(settlementMonth, dueDay, remindDaysBefore);
      expect(reminderDate.getFullYear()).toBe(2026);
      expect(reminderDate.getMonth()).toBe(3); // April (0-indexed: 3)
      expect(reminderDate.getDate()).toBe(12);  // 15 - 3 = 12th
      expect(reminderDate.getHours()).toBe(9);
      expect(reminderDate.getMinutes()).toBe(0);
    });

    it('clamps reminder day to minimum day 1 if remindDaysBefore exceeds dueDay', () => {
      const settlementMonth = '2026-03-01';
      const dueDay = 2;
      const remindDaysBefore = 5;

      const reminderDate = computeReminderDate(settlementMonth, dueDay, remindDaysBefore);
      expect(reminderDate.getMonth()).toBe(3); // April
      expect(reminderDate.getDate()).toBe(1);
    });

    it('clamps dueDay to the target month length (February settlement due on the 28th)', () => {
      const settlementMonth = '2027-01-01'; // Due month: February 2027 (28 days)
      const reminderDate = computeReminderDate(settlementMonth, 28, 0);
      expect(reminderDate.getMonth()).toBe(1); // February
      expect(reminderDate.getDate()).toBe(28);
    });
  });

  describe('API URL Resolution', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('prepends configured PUBLIC_API_BASE to relative API paths', () => {
      vi.stubEnv('PUBLIC_API_BASE', 'https://api.cosmo-ledger.com');
      const resolved = resolveApiUrl('/api/v1/entries');
      expect(resolved).toBe('https://api.cosmo-ledger.com/api/v1/entries');
    });

    it('normalizes paths without a leading slash when a base is configured', () => {
      vi.stubEnv('PUBLIC_API_BASE', 'https://api.cosmo-ledger.com/');
      const resolved = resolveApiUrl('api/v1/sync/push');
      expect(resolved).toBe('https://api.cosmo-ledger.com/api/v1/sync/push');
    });

    it('passes paths through unchanged on web builds where no base is configured', () => {
      vi.stubEnv('PUBLIC_API_BASE', '');
      // Web SPA: relative fetch keeps same-origin behavior (adapter-vercel)
      expect(resolveApiUrl('api/v1/sync/push')).toBe('api/v1/sync/push');
    });
  });
});
