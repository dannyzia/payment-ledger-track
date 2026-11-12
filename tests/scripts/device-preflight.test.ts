import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessPreflight,
  candidateAdbPaths,
  parseDeviceLocked,
  parseReverseRules,
  parseWebViewSocket,
  resolveAdbPath,
  type DeviceObservations,
} from '../../scripts/e2e/device-preflight';

const healthy: DeviceObservations = {
  adbState: 'device',
  deviceLocked: false,
  webviewSocket: 'webview_devtools_remote_3020',
  cdpPackage: 'com.cosmo.ledgertrack',
  reverseRules: [
    { devicePort: 54321, hostPort: 54321 },
    { devicePort: 5173, hostPort: 5180 },
  ],
  apiStatusByHostPort: [
    { hostPort: 54321, status: 200 },
    { hostPort: 5180, status: 401 },
  ],
};

describe('parseDeviceLocked', () => {
  it('reads the current user line from dumpsys trust', () => {
    const output =
      '  User "Owner" (id=0, flags=0xc13) (current): trusted=0, trustManaged=0, deviceLocked=1, strongAuthRequired=0x0';
    expect(parseDeviceLocked(output)).toBe(true);
  });

  it('reports unlocked when the flag is clear', () => {
    expect(parseDeviceLocked('deviceLocked=0, strongAuthRequired=0x0')).toBe(false);
  });

  it('returns null when the flag is absent', () => {
    expect(parseDeviceLocked('trust state unavailable')).toBeNull();
  });
});

describe('parseWebViewSocket', () => {
  it('picks the WebView DevTools socket out of the unix table', () => {
    const table = [
      '0000000000000000: 00000002 00000000 00010000 0001 01 41234 @webview_devtools_remote_3020',
      '0000000000000000: 00000002 00000000 00010000 0001 01 41235 /dev/socket/adbd',
    ].join('\n');
    expect(parseWebViewSocket(table)).toBe('webview_devtools_remote_3020');
  });

  it('returns null when the app is not running', () => {
    expect(parseWebViewSocket('/dev/socket/adbd')).toBeNull();
  });
});

describe('parseReverseRules', () => {
  it('parses adb reverse --list output', () => {
    expect(parseReverseRules('UsbFfs tcp:5173 tcp:5180\nUsbFfs tcp:54321 tcp:54321\n')).toEqual([
      { devicePort: 5173, hostPort: 5180 },
      { devicePort: 54321, hostPort: 54321 },
    ]);
  });

  it('returns no rules when nothing is reversed', () => {
    expect(parseReverseRules('')).toEqual([]);
  });
});

describe('adb discovery', () => {
  it('prefers an explicit ADB path', () => {
    expect(resolveAdbPath({ ADB: '/custom/adb' }, os.tmpdir())).toBe('/custom/adb');
  });

  it('falls back to the SDK recorded in android/local.properties', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clt-adb-'));
    const sdk = path.join(root, 'sdk');
    fs.mkdirSync(path.join(root, 'apps/web/android'), { recursive: true });
    fs.mkdirSync(path.join(sdk, 'platform-tools'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/web/android/local.properties'), 'sdk.dir=' + sdk + '\n');
    fs.writeFileSync(path.join(sdk, 'platform-tools', 'adb'), '');

    expect(candidateAdbPaths({}, root)).toContain(path.join(sdk, 'platform-tools', 'adb'));
    expect(resolveAdbPath({}, root)).toBe(path.join(sdk, 'platform-tools', 'adb'));
  });

  it('reports something runnable when nothing is found', () => {
    expect(resolveAdbPath({}, os.tmpdir())).toBe('adb');
  });
});

describe('assessPreflight', () => {
  it('passes a healthy device', () => {
    const { problems, notes } = assessPreflight(healthy);
    expect(problems).toEqual([]);
    expect(notes).toContain('device unlocked');
    expect(notes).toContain('WebView attached (com.cosmo.ledgertrack)');
    expect(notes).toContain('backend reachable: device :5173 → host :5180 (HTTP 401)');
  });

  it('names the lock screen instead of letting clicks time out', () => {
    const { problems } = assessPreflight({ ...healthy, deviceLocked: true });
    expect(problems).toHaveLength(1);
    expect(problems[0].what).toContain('lock screen');
    expect(problems[0].fix).toContain('Unlock');
  });

  it('reports a missing WebView socket when the app is not running', () => {
    const { problems } = assessPreflight({ ...healthy, webviewSocket: null, cdpPackage: null });
    expect(problems.map((problem) => problem.what).join(' ')).toContain(
      'No WebView DevTools socket',
    );
  });

  it('reports a DevTools port attached to another app', () => {
    const { problems } = assessPreflight({ ...healthy, cdpPackage: 'com.example.other' });
    expect(problems[0].what).toContain('not com.cosmo.ledgertrack');
  });

  it('reports a port serving a different application as 404', () => {
    const { problems } = assessPreflight({
      ...healthy,
      reverseRules: [{ devicePort: 5173, hostPort: 5173 }],
      apiStatusByHostPort: [{ hostPort: 5173, status: 404 }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].what).toContain('HTTP 404');
    expect(problems[0].what).toContain('different application');
  });

  it('reports nothing listening behind the reversal', () => {
    const { problems } = assessPreflight({
      ...healthy,
      apiStatusByHostPort: [{ hostPort: 5180, status: null }],
    });
    expect(problems[0].what).toContain('nothing listening');
  });

  it('reports missing reverse rules', () => {
    const { problems } = assessPreflight({
      ...healthy,
      reverseRules: [],
      apiStatusByHostPort: [],
    });
    expect(problems[0].what).toContain('No `adb reverse` rules');
  });

  it('reports an unusable device before anything else', () => {
    const { problems } = assessPreflight({ ...healthy, adbState: 'unauthorized' });
    expect(problems).toHaveLength(1);
    expect(problems[0].what).toContain('unauthorized');
  });

  it('reports a missing adb binary', () => {
    const { problems } = assessPreflight({ ...healthy, adbState: null });
    expect(problems[0].fix).toContain('ANDROID_HOME');
  });
});
