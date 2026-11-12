import { describe, expect, it } from 'vitest';
import {
  DEVICE_CHECK_STATUS,
  assessDeviceCheck,
  deviceCheckEnv,
  isNonBlockingDeviceStatus,
  summarizeGateReport,
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

  it('classifies multi-stage output as failed when an earlier stage already ran before PREFLIGHT FAILED', () => {
    const outcome = assessDeviceCheck({
      success: false,
      output: [
        '  MHK_OWNER  PASS  owner.mhk@cosmoledger.local → Owner',
        'Fixture credentials: 2 passed, 0 failed, 0 skipped',
        '❌ OWNER SCREEN CHECK PREFLIGHT FAILED — no screens were visited:',
        '  • no device',
      ].join('\n'),
    });

    expect(outcome.satisfied).toBe(false);
    expect(outcome.status).toBe(DEVICE_CHECK_STATUS.failed);
    expect(isNonBlockingDeviceStatus(outcome.status)).toBe(false);
  });
});

describe('summarizeGateReport', () => {
  it('keeps allSatisfied false while allowing blockingChecksPassed when device check is not_run_*', () => {
    for (const status of [DEVICE_CHECK_STATUS.noEnvironment, DEVICE_CHECK_STATUS.noFixtures]) {
      const summary = summarizeGateReport({
        'Gate 1 (Database Proof)': { satisfied: true },
        'Gate 5 (Accessibility Proof)': { satisfied: true, status: 'automated_checks_passed' },
        'Gate 5 (Physical Device)': { satisfied: false, status },
      });
      expect(summary).toEqual({
        allSatisfied: false,
        blockingChecksPassed: true,
      });
    }
  });

  it('returns both true only when every gate is satisfied', () => {
    const summary = summarizeGateReport({
      'Gate 5 (Accessibility Proof)': { satisfied: true, status: 'automated_checks_passed' },
      'Gate 5 (Physical Device)': { satisfied: true, status: DEVICE_CHECK_STATUS.passed },
    });
    expect(summary).toEqual({
      allSatisfied: true,
      blockingChecksPassed: true,
    });
  });

  it('sets both false when the physical device check or another gate failed', () => {
    expect(
      summarizeGateReport({
        'Gate 5 (Accessibility Proof)': { satisfied: true, status: 'automated_checks_passed' },
        'Gate 5 (Physical Device)': { satisfied: false, status: DEVICE_CHECK_STATUS.failed },
      }),
    ).toEqual({
      allSatisfied: false,
      blockingChecksPassed: false,
    });

    expect(
      summarizeGateReport({
        'Gate 5 (Accessibility Proof)': { satisfied: false, status: 'failed' },
        'Gate 5 (Physical Device)': {
          satisfied: false,
          status: DEVICE_CHECK_STATUS.noEnvironment,
        },
      }),
    ).toEqual({
      allSatisfied: false,
      blockingChecksPassed: false,
    });
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
