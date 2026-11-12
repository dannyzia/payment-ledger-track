import { describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseTarget,
  isLocalSupabaseHost,
} from '../../scripts/e2e/set-fixture-password';

describe('set-fixture-password local-target guard', () => {
  it('recognizes local Supabase hosts (127.0.0.1, localhost, ::1)', () => {
    expect(isLocalSupabaseHost('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabaseHost('http://localhost:54321')).toBe(true);
    expect(isLocalSupabaseHost('http://[::1]:54321')).toBe(true);
    expect(isLocalSupabaseHost('https://localhost:54341')).toBe(true);

    expect(isLocalSupabaseHost('https://abcdefghij.supabase.co')).toBe(false);
    expect(isLocalSupabaseHost('https://staging.cosmoledger.example')).toBe(false);
    expect(isLocalSupabaseHost('not-a-valid-url')).toBe(false);
  });

  it('allows local hosts without --allow-remote', () => {
    expect(() => assertLocalSupabaseTarget('http://127.0.0.1:54321')).not.toThrow();
    expect(() => assertLocalSupabaseTarget('http://localhost:54321')).not.toThrow();
    expect(() => assertLocalSupabaseTarget('http://[::1]:54321')).not.toThrow();
  });

  it('refuses remote or malformed SUPABASE_URL unless --allow-remote is passed', () => {
    expect(() => assertLocalSupabaseTarget('https://abcdefghij.supabase.co')).toThrow(
      /--allow-remote/,
    );
    expect(() => assertLocalSupabaseTarget('https://10.0.0.25:54321')).toThrow(/--allow-remote/);
    expect(() => assertLocalSupabaseTarget('not-a-valid-url')).toThrow(/--allow-remote/);

    expect(() => assertLocalSupabaseTarget('https://abcdefghij.supabase.co', true)).not.toThrow();
  });
});
