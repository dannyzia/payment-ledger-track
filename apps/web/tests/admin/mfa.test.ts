import { describe, it, expect } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  readRecoveryState,
} from '../../src/lib/server/mfa';

describe('2FA recovery codes (Plan 023 step 5)', () => {
  it('issues readable, unique codes with no ambiguous characters', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      // I, L, O, U, 0 and 1 are excluded so a code cannot be misread off paper.
      expect(code).not.toMatch(/[ILOU01]/);
    }
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode());
  });

  it('normalizes the ways a human types a code', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizeRecoveryCode(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN');
    expect(normalizeRecoveryCode('ABCD–EFGH–JKMN')).toBe('ABCDEFGHJKMN');
  });

  it('binds the hash to both the code and the account', () => {
    const code = 'ABCD-EFGH-JKMN';
    const hash = hashRecoveryCode('user-a', code);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode('user-a', 'abcdefghjkmn')).toBe(hash); // separators and case are noise
    expect(hashRecoveryCode('user-b', code)).not.toBe(hash); // not replayable across accounts
    expect(hashRecoveryCode('user-a', 'ABCD-EFGH-JKMP')).not.toBe(hash);
  });

  it('treats absent or malformed stored state as "no codes"', () => {
    expect(readRecoveryState(undefined)).toBeNull();
    expect(readRecoveryState({})).toBeNull();
    expect(readRecoveryState({ mfa_recovery: { hashes: 'not-an-array' } })).toBeNull();
    expect(
      readRecoveryState({ mfa_recovery: { hashes: ['a', 1, null], issued_at: 'now' } }),
    ).toEqual({ hashes: ['a'], issued_at: 'now' });
  });
});
