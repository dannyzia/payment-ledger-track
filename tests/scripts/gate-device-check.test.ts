import { describe, expect, it } from 'vitest';
import {
  DEVICE_CHECK_STATUS,
  assessDeviceCheck,
  deviceCheckEnv,
  isNonBlockingDeviceStatus,
} from '../../scripts/gate-device-check';

describe('assessDeviceCheck', () => {
  it('records a pass when the device checks are green', () => {
    const outcome = assessDeviceCheck({
      success: true,
      output: 'Fixture credentials: 3 passed, 0 failed, 0 skipped',
    });
    expect(outcome).toEqual({
      satisfied: true,
      status: DEVICE_CHECK_STATUS.passed,
      note: 'Fixture, owner-screen and staff-guard checks all passed on the connected handset.',
    });
  });

  it('treats a missing handset as not run, not as a pass', () => {
    const outcome = assessDeviceCheck({
      success: false,
      output: '❌ FIXTURE CHECK PREFLIGHT FAILED — no credentials were tested:\n  • no device',
    });
    expect(outcome.satisfied).toBe(false);
    expect(outcome.status).toBe(DEVICE_CHECK_STATUS.noEnvironment);
    expect(outcome.note).toContain('preflight failed');
    expect(isNonBlockingDeviceStatus(outcome.status)).toBe(true);
  });

  it('treats missing fixture credentials as not run', () => {
    const outcome = assessDeviceCheck({
      success: false,
      output: '❌ Nothing to verify: no fixture has every variable it needs.',
    });
    expect(outcome.status).toBe(DEVICE_CHECK_STATUS.noFixtures);
    expect(outcome.note).toContain('.env.local');
    expect(isNonBlockingDeviceStatus(outcome.status)).toBe(true);
  });

  it('treats a real failure on the handset as a gate failure', () => {
    const outcome = assessDeviceCheck({
      success: false,
      output:
        '❌ OWNER SCREEN CHECK FAILED:\n  • /reports: staff session rendered the page content',
    });
    expect(outcome.satisfied).toBe(false);
    expect(outcome.status).toBe(DEVICE_CHECK_STATUS.failed);
    expect(isNonBlockingDeviceStatus(outcome.status)).toBe(false);
  });

  it('does not count a passing status as non-blocking', () => {
    expect(isNonBlockingDeviceStatus(DEVICE_CHECK_STATUS.passed)).toBe(false);
  });
});

describe('deviceCheckEnv', () => {
  it('drops the browser suite stack overrides but keeps the fixture credentials', () => {
    const env = deviceCheckEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54342/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54341',
      PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54341',
      PUBLIC_API_BASE: '',
      CLT_DEVICE_FIXTURES: 'MHK,MHK_OWNER,RMP',
      CLT_DEVICE_MHK_ACCOUNT: 'device.check@cosmoledger.local',
      PATH: '/usr/bin',
    });

    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.PUBLIC_SUPABASE_URL).toBeUndefined();
    // An empty PUBLIC_API_BASE is still the isolated runner's value, so it goes too.
    expect(env.PUBLIC_API_BASE).toBeUndefined();
    expect(env.CLT_DEVICE_FIXTURES).toBe('MHK,MHK_OWNER,RMP');
    expect(env.CLT_DEVICE_MHK_ACCOUNT).toBe('device.check@cosmoledger.local');
    expect(env.PATH).toBe('/usr/bin');
  });
});
