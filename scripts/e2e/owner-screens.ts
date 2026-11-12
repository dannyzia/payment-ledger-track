/**
 * What the owner-only screen check asserts, kept apart from the CLI so it can be
 * tested without a handset.
 *
 * `/reports` and `/settlements` carry their own client-side guard: a staff session
 * renders an "Access Restricted" notice in place of the page. `/admin` has no such
 * notice — its hub renders for anyone, and the gate is the menu link plus the
 * admin APIs returning 403 — so the route check alone cannot prove ownership
 * there; `assessOwnerNav` does, by requiring the links the floating menu only
 * shows to admin and owner roles (CLT-R-031).
 */
export interface OwnerRoute {
  path: string;
  /** Heading the route renders when the session is allowed in. */
  heading: string;
}

export const OWNER_ROUTES: OwnerRoute[] = [
  { path: '/reports', heading: 'Monthly Reports' },
  { path: '/settlements', heading: 'Monthly Settlements' },
  { path: '/admin', heading: 'Admin Hub' },
];

/** Shown by the reports and settlements pages instead of their content. */
export const RESTRICTED_MARKER = 'Access Restricted';

/** Links the mobile menu only renders for admin and owner roles. */
export const OWNER_NAV_LINKS = ['/reports', '/settlements', '/admin'];

/**
 * The pages whose own guard replaces their content for a staff session. `/admin`
 * is not in this list: its hub renders for anyone and only its data is gated, so
 * the staff check reads the menu and probes the admin APIs for it instead.
 */
export const STAFF_GUARDED_ROUTES = ['/reports', '/settlements'];

export interface AdminApiProbe {
  path: string;
  method?: 'GET' | 'POST';
  /**
   * What an owner session gets from this endpoint. Reads answer 200; the writes
   * stop at their schema (400) because the probe body is empty, which is proof the
   * role gate let the request through without any chance of a real mutation.
   */
  expectedOwnerStatus: number;
  /**
   * Sent as JSON. Empty on purpose: the owner-only routes check the role before
   * they read the body, so `{}` is refused without any chance of closing a month
   * or transferring an account even if the role gate is what turns out to be
   * missing. Every one of these bodies also fails its schema, so the probe cannot
   * mutate anything on a route that forgot its guard.
   */
  body?: unknown;
}

/**
 * Endpoints whose refusal is what keeps staff out of the hub's data and the
 * owner-only operations. They are real routes, so this checks enforcement rather
 * than a hidden button — including the write paths, where a GET-only probe would
 * miss a mutation that trusted the session instead of its role.
 */
export const ADMIN_API_PROBES: AdminApiProbe[] = [
  { path: '/api/v1/admin/users', expectedOwnerStatus: 200 },
  { path: '/api/v1/admin/devices', expectedOwnerStatus: 200 },
  { path: '/api/v1/admin/settings', expectedOwnerStatus: 200 },
  { path: '/api/v1/admin/audit', expectedOwnerStatus: 200 },
  { path: '/api/v1/months/close', method: 'POST', body: {}, expectedOwnerStatus: 400 },
  { path: '/api/v1/months/reopen', method: 'POST', body: {}, expectedOwnerStatus: 400 },
  {
    path: '/api/v1/admin/transfer-ownership',
    method: 'POST',
    body: {},
    expectedOwnerStatus: 400,
  },
];

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Reduces a device URL to the route path, ignoring query and trailing slashes. */
export function normalizePath(raw: string): string {
  try {
    const pathname = new URL(raw, 'https://localhost').pathname.replace(/\/+$/, '');
    return pathname || '/';
  } catch {
    return raw;
  }
}

/**
 * Judges one route visit. A redirect is reported before the content is, because
 * a redirected page can still contain the heading text (the dashboard links to
 * reports), which would otherwise read as a pass.
 */
export function assessOwnerRoute(params: {
  path: string;
  heading: string;
  finalUrl: string;
  text: string;
}): { ok: boolean; detail: string } {
  const landedOn = normalizePath(params.finalUrl);
  if (landedOn !== params.path) {
    return { ok: false, detail: `redirected to ${landedOn} instead of staying on ${params.path}` };
  }

  const text = collapse(params.text);
  if (text.includes(RESTRICTED_MARKER)) {
    return {
      ok: false,
      detail: `page rendered its "${RESTRICTED_MARKER}" notice: ${text.slice(0, 140)}`,
    };
  }

  if (!text.includes(params.heading)) {
    return {
      ok: false,
      detail: `heading "${params.heading}" not found; page said: ${text.slice(0, 140)}`,
    };
  }

  return { ok: true, detail: `${params.heading} rendered, no restriction notice` };
}

/**
 * Judges a staff session's visit to a guarded route. Being redirected away counts
 * as kept out just as much as seeing the restriction notice; what must never
 * happen is the privileged content rendering.
 */
export function assessStaffRoute(params: { path: string; finalUrl: string; text: string }): {
  ok: boolean;
  detail: string;
} {
  const landedOn = normalizePath(params.finalUrl);
  if (landedOn !== params.path) {
    return { ok: true, detail: `redirected to ${landedOn}, so the page was never shown` };
  }

  const text = collapse(params.text);
  if (text.includes(RESTRICTED_MARKER)) {
    return { ok: true, detail: `"${RESTRICTED_MARKER}" notice shown instead of the page` };
  }

  return {
    ok: false,
    detail: `staff session rendered the page content instead of blocking it: ${text.slice(0, 140)}`,
  };
}

/**
 * The staff half of CLT-R-031: the privileged links must not be offered at all,
 * not merely redirect when followed.
 */
export function assessStaffNav(links: string[]): { ok: boolean; detail: string } {
  const present = new Set(links.map((link) => normalizePath(link)));
  const leaked = OWNER_NAV_LINKS.filter((link) => present.has(link));

  if (leaked.length > 0) {
    return { ok: false, detail: `menu offers ${leaked.join(', ')} to a staff session (CLT-R-031)` };
  }

  return { ok: true, detail: `menu omits ${OWNER_NAV_LINKS.join(', ')}` };
}

function probeLabel(probe: { path: string; method?: string }): string {
  return probe.method && probe.method !== 'GET' ? `${probe.method} ${probe.path}` : probe.path;
}

/**
 * Judges the same endpoints for an owner session — the other half of the role
 * gate. A refusal (401/403) here is the failure: it would mean the owner is locked
 * out of their own operations. The writes are expected to answer 400 rather than
 * 200, because their empty probe body cannot pass validation; anything that
 * differs from the expected status means the endpoint did not behave as inspected,
 * so it is reported instead of guessed at.
 */
export function assessOwnerApiAccess(params: {
  hasToken: boolean;
  probes: Array<{ path: string; method?: string; status: number; expected: number }>;
}): { ok: boolean; detail: string } {
  if (!params.hasToken) {
    return {
      ok: false,
      detail:
        'no Supabase session token was found in the WebView storage, so the APIs could not be probed',
    };
  }

  if (params.probes.length === 0) {
    return { ok: false, detail: 'no endpoints were probed' };
  }

  const unreachable = params.probes.filter((probe) => probe.status === 0);
  if (unreachable.length > 0) {
    return {
      ok: false,
      detail: `could not reach ${unreachable.map((probe) => probeLabel(probe)).join(', ')} — the check is inconclusive`,
    };
  }

  const refused = params.probes.filter((probe) => probe.status === 401 || probe.status === 403);
  if (refused.length > 0) {
    return {
      ok: false,
      detail: `owner token was refused by ${refused.map((probe) => `${probeLabel(probe)} (${probe.status})`).join(', ')}`,
    };
  }

  const unexpected = params.probes.filter((probe) => probe.status !== probe.expected);
  if (unexpected.length > 0) {
    return {
      ok: false,
      detail: unexpected
        .map((probe) => `${probeLabel(probe)} answered ${probe.status}, expected ${probe.expected}`)
        .join(', '),
    };
  }

  const reads = params.probes.filter((probe) => probe.expected === 200).length;
  const writes = params.probes.length - reads;
  return {
    ok: true,
    detail: `${reads} reads 200, ${writes} writes 400 at validation (no mutation), none refused`,
  };
}

/**
 * Judges the API probes. Only an authentication/authorisation refusal proves the
 * route is closed to staff: a 200 means it trusted the session, and any other
 * status (400, 422, 500) means something other than the role gate answered, so
 * the check would be guessing if it passed that.
 */
export function assessAdminApiRefusals(params: {
  hasToken: boolean;
  probes: Array<{ path: string; method?: string; status: number }>;
}): { ok: boolean; detail: string } {
  if (!params.hasToken) {
    return {
      ok: false,
      detail:
        'no Supabase session token was found in the WebView storage, so the APIs could not be probed',
    };
  }

  if (params.probes.length === 0) {
    return { ok: false, detail: 'no admin endpoints were probed' };
  }

  const unreachable = params.probes.filter((probe) => probe.status === 0);
  if (unreachable.length > 0) {
    return {
      ok: false,
      detail: `could not reach ${unreachable.map((probe) => probeLabel(probe)).join(', ')} — the check is inconclusive`,
    };
  }

  const served = params.probes.filter((probe) => probe.status >= 200 && probe.status < 300);
  if (served.length > 0) {
    return {
      ok: false,
      detail: `staff session was served ${served.map((probe) => `${probeLabel(probe)} (${probe.status})`).join(', ')}`,
    };
  }

  const notRefused = params.probes.filter((probe) => probe.status !== 401 && probe.status !== 403);
  if (notRefused.length > 0) {
    return {
      ok: false,
      detail: `expected 403, got ${notRefused
        .map((probe) => `${probeLabel(probe)} (${probe.status})`)
        .join(', ')} — the role gate may not be what refused the request`,
    };
  }

  return {
    ok: true,
    detail: params.probes.map((probe) => `${probeLabel(probe)} ${probe.status}`).join(', '),
  };
}

/** Judges the mobile menu's links, which is the only client-side gate on /admin. */
export function assessOwnerNav(links: string[]): { ok: boolean; detail: string } {
  const present = new Set(links.map((link) => normalizePath(link)));
  const missing = OWNER_NAV_LINKS.filter((link) => !present.has(link));

  if (missing.length > 0) {
    return {
      ok: false,
      detail: `menu is missing ${missing.join(', ')} — it showed ${links.length === 0 ? 'nothing' : links.join(', ')}`,
    };
  }

  return { ok: true, detail: `menu offers ${OWNER_NAV_LINKS.join(', ')}` };
}

/**
 * Picks the fixture to sign in as. Fixtures are named, so an owner and a staff
 * account can share a centre; selecting by declared role avoids assuming the
 * owner is whichever fixture ends in `_OWNER` or comes first.
 */
export function selectFixtureForRole(
  plan: {
    ready: Array<{ fixtureName: string; expectedRole: string }>;
    incomplete?: Array<{ fixtureName: string; expectedRole?: string; missing: string[] }>;
  },
  role: string,
  requested?: string,
): { fixture?: { fixtureName: string; expectedRole: string }; problem?: string } {
  const wantedRole = role.toLowerCase();
  const readyNames = plan.ready.map((fixture) => fixture.fixtureName);

  if (requested) {
    const wanted = requested.trim();
    const match = plan.ready.find(
      (fixture) => fixture.fixtureName.toUpperCase() === wanted.toUpperCase(),
    );
    if (match) return { fixture: match };

    const incomplete = plan.incomplete?.find(
      (fixture) => fixture.fixtureName.toUpperCase() === wanted.toUpperCase(),
    );
    if (incomplete) {
      return {
        problem: `Fixture ${incomplete.fixtureName} is not fully configured: set ${incomplete.missing.join(' and ')} in .env.local (docs/runbooks/DEVICE_JOURNEY.md §4).`,
      };
    }

    return {
      problem: `No fixture named "${wanted}". Configured fixtures: ${[...readyNames, ...(plan.incomplete ?? []).map((fixture) => fixture.fixtureName)].join(', ') || 'none'}.`,
    };
  }

  const matches = plan.ready.filter((fixture) => fixture.expectedRole.toLowerCase() === wantedRole);
  if (matches.length === 0) {
    const shaped = (plan.incomplete ?? []).filter(
      (fixture) => (fixture.expectedRole ?? 'staff').toLowerCase() === wantedRole,
    );
    if (shaped.length > 0) {
      return {
        problem: `${wantedRole} fixture ${shaped[0].fixtureName} is not fully configured: set ${shaped[0].missing.join(' and ')} in .env.local (docs/runbooks/DEVICE_JOURNEY.md §4).`,
      };
    }
    return {
      problem:
        wantedRole === 'owner'
          ? 'No configured fixture declares CLT_DEVICE_<NAME>_ROLE=owner, and these screens need an owner session. Add an owner fixture (docs/runbooks/DEVICE_JOURNEY.md §4), or pass --account/--password for an owner account.'
          : `No configured fixture declares CLT_DEVICE_<NAME>_ROLE=${wantedRole}. Every fixture defaults to staff, so declare one explicitly or pass --account/--password for a ${wantedRole} account.`,
    };
  }

  // Several staff fixtures are normal (one per centre); only the single owner is
  // ambiguous enough to stop, since two owner accounts could sit on different
  // centres and the check would silently pick the wrong one.
  if (matches.length > 1 && wantedRole === 'owner') {
    return {
      problem: `More than one owner fixture is configured (${matches.map((fixture) => fixture.fixtureName).join(', ')}). Pass --fixture=<name> to choose one.`,
    };
  }

  return { fixture: matches[0] };
}

/** Owner-specific wrapper kept for the owner-screen CLI's default path. */
export function selectOwnerFixture(
  plan: {
    ready: Array<{ fixtureName: string; expectedRole: string }>;
    incomplete?: Array<{ fixtureName: string; expectedRole?: string; missing: string[] }>;
  },
  requested?: string,
): { fixture?: { fixtureName: string; expectedRole: string }; problem?: string } {
  return selectFixtureForRole(plan, 'owner', requested);
}
