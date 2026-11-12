/**
 * How the M5 gate report should record the physical-device check.
 *
 * GS-4 said a green `--milestone M5` run proves Gate 5 by way of `pnpm test:e2e`
 * alone, which never touches a handset. The gate now runs
 * `pnpm test:e2e:device` and records what happened — but the distinction that
 * matters is *why* a run did not pass:
 *
 * - the checks ran and failed — that is a Gate 5 failure;
 * - the checks could not start (no handset, WebView/CDP not attached, backend
 *   unreachable, or no fixtures configured) — that is a missing prerequisite, not
 *   a failing app, and it must be reported as not run rather than as a pass.
 *
 * Only the second kind is non-blocking for the gate command, and it is still
 * written into the report with a status that says so, so the JSON can never be
 * read as "the device passed". The Gate 5 sign-off itself still needs the pasted
 * `pnpm test:e2e:device` output (checklist item H36).
 */
export const DEVICE_CHECK_STATUS = {
  passed: 'passed',
  failed: 'failed',
  noEnvironment: 'not_run_no_environment',
  noFixtures: 'not_run_no_fixtures',
} as const;

export type DeviceCheckStatus = (typeof DEVICE_CHECK_STATUS)[keyof typeof DEVICE_CHECK_STATUS];

export interface DeviceCheckAssessment {
  satisfied: boolean;
  status: DeviceCheckStatus;
  note: string;
}

/** Statuses that describe a missing prerequisite rather than a failed check. */
/**
 * Variables the browser suites point at their own stack (the isolated one sets all
 * of these). The device scripts must not inherit them: the handset talks to its own
 * backend, and the fixture rows live in that backend's database, so an inherited
 * DATABASE_URL makes every fixture look wrong — which is how the first isolated
 * Gate 5 run reported a device failure that did not exist.
 */
export const BROWSER_SUITE_ENV_KEYS = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PUBLIC_SUPABASE_URL',
  'PUBLIC_SUPABASE_ANON_KEY',
  'PUBLIC_API_BASE',
] as const;

/**
 * The environment the device check runs under: the caller's, minus the browser
 * suite's stack overrides. The device scripts then read `.env.local` and their own
 * documented defaults, which describe the backend the handset is actually using.
 */
export function deviceCheckEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of BROWSER_SUITE_ENV_KEYS) delete env[key];
  return env;
}

export const NON_BLOCKING_DEVICE_STATUSES: DeviceCheckStatus[] = [
  DEVICE_CHECK_STATUS.noEnvironment,
  DEVICE_CHECK_STATUS.noFixtures,
];

export function isNonBlockingDeviceStatus(status: string | undefined): boolean {
  return NON_BLOCKING_DEVICE_STATUSES.some((candidate) => candidate === status);
}

export function assessDeviceCheck(params: {
  success: boolean;
  output: string;
}): DeviceCheckAssessment {
  if (params.success) {
    return {
      satisfied: true,
      status: DEVICE_CHECK_STATUS.passed,
      note: 'Fixture, owner-screen and staff-guard checks all passed on the connected handset.',
    };
  }

  // Each of these three is emitted by the scripts' own preflight or fixture
  // planning, so they identify an unusable test environment rather than a defect.
  if (/PREFLIGHT FAILED/.test(params.output)) {
    return {
      satisfied: false,
      status: DEVICE_CHECK_STATUS.noEnvironment,
      note: 'Device check did not run: preflight failed (handset, WebView/CDP or backend not available). Attach the device and run pnpm test:e2e:device; Gate 5 sign-off needs its pasted pass.',
    };
  }

  if (/Nothing to verify/.test(params.output)) {
    return {
      satisfied: false,
      status: DEVICE_CHECK_STATUS.noFixtures,
      note: 'Device check did not run: no fixture credentials are configured. Set CLT_DEVICE_* in .env.local (docs/runbooks/DEVICE_JOURNEY.md §4) and run pnpm test:e2e:device.',
    };
  }

  return {
    satisfied: false,
    status: DEVICE_CHECK_STATUS.failed,
    note: 'The device check ran and failed on the handset; Gate 5 cannot pass until it is green.',
  };
}
