import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Preflight for the physical-device journey.
 *
 * Each failure here used to surface as something unrelated and misleading: a
 * locked handset makes Playwright's actionability waits hang ("page.click:
 * timeout"), a missing `adb reverse` rule makes the app sit offline, and a
 * reversed port that hosts a different application answers 404 to every API
 * call. None of those are defects in the app, and none of them name themselves
 * in the failure, so they are checked up front.
 */

export const APP_PACKAGE = 'com.cosmo.ledgertrack';
export const CDP_PORT = 9222;

/** `/api/v1/auth/session` answers 401 without a token; 200 also means this app. */
const OUR_API_STATUSES = new Set([200, 401]);

export interface ReverseRule {
  devicePort: number;
  hostPort: number;
}

export interface DeviceObservations {
  adbState: string | null;
  deviceLocked: boolean | null;
  webviewSocket: string | null;
  cdpPackage: string | null;
  reverseRules: ReverseRule[];
  apiStatusByHostPort: Array<{ hostPort: number; status: number | null }>;
}

export interface PreflightProblem {
  what: string;
  fix: string;
}

export interface PreflightAssessment {
  problems: PreflightProblem[];
  notes: string[];
}

/** `deviceLocked=1` means the keyguard is up and the WebView will not paint. */
export function parseDeviceLocked(output: string): boolean | null {
  const matches = Array.from(output.matchAll(/deviceLocked=([01])/g), (m) => m[1]);
  if (matches.length === 0) return null;
  return matches.includes('1');
}

export function parseWebViewSocket(unixTable: string): string | null {
  return unixTable.match(/webview_devtools_remote_\d+/)?.[0] ?? null;
}

export function parseReverseRules(reverseList: string): ReverseRule[] {
  const rules: ReverseRule[] = [];
  for (const line of reverseList.split('\n')) {
    const match = line.match(/tcp:(\d+)\s+tcp:(\d+)/);
    if (match) rules.push({ devicePort: Number(match[1]), hostPort: Number(match[2]) });
  }
  return rules;
}

export function assessPreflight(
  observations: DeviceObservations,
  appPackage = APP_PACKAGE,
): PreflightAssessment {
  const problems: PreflightProblem[] = [];
  const notes: string[] = [];

  if (observations.adbState === null) {
    problems.push({
      what: 'adb could not be run, so the handset cannot be inspected.',
      fix: 'Set ADB=/path/to/platform-tools/adb or ANDROID_HOME, or write `sdk.dir` into apps/web/android/local.properties.',
    });
    return { problems, notes };
  }

  if (observations.adbState !== 'device') {
    problems.push({
      what: `No usable adb device (state: ${observations.adbState}).`,
      fix: 'Plug the phone in, run `adb devices`, and accept the USB debugging prompt.',
    });
    return { problems, notes };
  }

  if (observations.deviceLocked === true) {
    problems.push({
      what: 'The handset is at its lock screen (deviceLocked=1), so its WebView produces no animation frames: clicks time out and screenshots never return. It reads like an app bug but is not one.',
      fix: 'Unlock the phone and keep the screen awake, then re-run the journey.',
    });
  } else if (observations.deviceLocked === false) {
    notes.push('device unlocked');
  }

  if (observations.webviewSocket === null) {
    problems.push({
      what: 'No WebView DevTools socket: the app is not running, or WebView debugging is off.',
      fix: `Launch it with \`adb shell am start -n ${appPackage}/.MainActivity\` and retry.`,
    });
  } else if (observations.cdpPackage === null) {
    problems.push({
      what: `The DevTools endpoint on 127.0.0.1:${CDP_PORT} did not answer for ${observations.webviewSocket}.`,
      fix: `Run \`adb forward tcp:${CDP_PORT} localabstract:${observations.webviewSocket}\`.`,
    });
  } else if (observations.cdpPackage !== appPackage) {
    problems.push({
      what: `Port ${CDP_PORT} is attached to ${observations.cdpPackage}, not ${appPackage}.`,
      fix: `Re-point it: \`adb forward --remove tcp:${CDP_PORT}\` then forward the ${appPackage} socket.`,
    });
  } else {
    notes.push(`WebView attached (${observations.cdpPackage})`);
  }

  if (observations.reverseRules.length === 0) {
    problems.push({
      what: "No `adb reverse` rules: the app's baked API origin (normally http://localhost:5173) has no route to this machine, so the phone stays offline.",
      fix: "Start this project's dev server and map it, e.g. `pnpm --filter @clt/web dev --port 5180 --strictPort`, then `adb reverse tcp:5173 tcp:5180` and `adb reverse tcp:54321 tcp:54321` for Supabase.",
    });
  } else if (
    observations.apiStatusByHostPort.length > 0 &&
    !observations.apiStatusByHostPort.some(
      (probe) => probe.status !== null && OUR_API_STATUSES.has(probe.status),
    )
  ) {
    const detail = observations.apiStatusByHostPort
      .map(
        (probe) =>
          `host :${probe.hostPort} → ${probe.status === null ? 'nothing listening' : `HTTP ${probe.status}`}`,
      )
      .join(', ');

    problems.push({
      what: `No reversal reaches this app's API (${detail}). A port answering 404 to /api/v1/auth/session is serving a different application.`,
      fix: "Point the device port at this project's dev server: `adb reverse tcp:5173 tcp:<port>`; the check expects 401 from /api/v1/auth/session.",
    });
  } else {
    for (const probe of observations.apiStatusByHostPort) {
      if (probe.status === null || !OUR_API_STATUSES.has(probe.status)) continue;
      const rule = observations.reverseRules.find(
        (candidate) => candidate.hostPort === probe.hostPort,
      );
      notes.push(
        `backend reachable: device :${rule?.devicePort ?? '?'} → host :${probe.hostPort} (HTTP ${probe.status})`,
      );
    }
  }

  return { problems, notes };
}

/**
 * adb is not on PATH on the machines this journey runs on and ANDROID_HOME is
 * usually not exported either, so the SDK location is taken from wherever the
 * project already recorded it — the generated android/local.properties —
 * before falling back to PATH.
 */
export function candidateAdbPaths(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string[] {
  const candidates: string[] = [];
  if (env.ADB) candidates.push(env.ADB);
  for (const sdk of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) {
    if (sdk) candidates.push(path.join(sdk, 'platform-tools', 'adb'));
  }

  try {
    const localProperties = fs.readFileSync(
      path.join(cwd, 'apps/web/android/local.properties'),
      'utf8',
    );
    const sdkDir = localProperties.match(/^sdk\.dir=(.+)$/m)?.[1]?.trim();
    if (sdkDir) candidates.push(path.join(sdkDir, 'platform-tools', 'adb'));
  } catch {
    // The android platform has not been generated on this machine.
  }

  if (env.HOME) {
    candidates.push(
      path.join(env.HOME, 'android-sdk', 'platform-tools', 'adb'),
      path.join(env.HOME, 'Android', 'Sdk', 'platform-tools', 'adb'),
    );
  }
  candidates.push('/usr/lib/android-sdk/platform-tools/adb', 'adb');
  return candidates;
}

export function resolveAdbPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  // An explicit ADB is trusted as given; discovered paths must exist.
  if (env.ADB) return env.ADB;
  const discovered = candidateAdbPaths(env, cwd).filter((candidate) => candidate !== 'adb');
  return discovered.find((candidate) => fs.existsSync(candidate)) ?? 'adb';
}

async function readCdpPackage(cdpUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { 'Android-Package'?: string };
    return body['Android-Package'] ?? null;
  } catch {
    return null;
  }
}

async function probeApiStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return response.status;
  } catch {
    return null;
  }
}

export async function runDevicePreflight(
  options: { adbPath?: string; cdpUrl?: string } = {},
): Promise<PreflightAssessment> {
  const adb = options.adbPath ?? resolveAdbPath();
  const cdpUrl = options.cdpUrl ?? `http://127.0.0.1:${CDP_PORT}`;

  const run = (args: string[]): string | null => {
    try {
      return execFileSync(adb, args, {
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  };

  const observations: DeviceObservations = {
    adbState: run(['get-state'])?.trim() || null,
    deviceLocked: null,
    webviewSocket: null,
    cdpPackage: null,
    reverseRules: [],
    apiStatusByHostPort: [],
  };

  if (observations.adbState === 'device') {
    const trust = run(['shell', 'dumpsys', 'trust']);
    if (trust) observations.deviceLocked = parseDeviceLocked(trust);

    const socket = run(['shell', 'cat', '/proc/net/unix']);
    if (socket) observations.webviewSocket = parseWebViewSocket(socket);

    const reverse = run(['reverse', '--list']);
    observations.reverseRules = reverse ? parseReverseRules(reverse) : [];

    if (observations.webviewSocket) {
      observations.cdpPackage = await readCdpPackage(cdpUrl);
      if (observations.cdpPackage === null) {
        run(['forward', `tcp:${CDP_PORT}`, `localabstract:${observations.webviewSocket}`]);
        observations.cdpPackage = await readCdpPackage(cdpUrl);
      }
    }

    const hostPorts = Array.from(new Set(observations.reverseRules.map((rule) => rule.hostPort)));
    for (const hostPort of hostPorts) {
      observations.apiStatusByHostPort.push({
        hostPort,
        status: await probeApiStatus(`http://127.0.0.1:${hostPort}/api/v1/auth/session`),
      });
    }
  }

  return assessPreflight(observations);
}
