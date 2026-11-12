import { describe, expect, it } from 'vitest';
import {
  OWNER_ROUTES,
  assessAdminApiRefusals,
  assessOwnerApiAccess,
  assessOwnerNav,
  assessOwnerRoute,
  assessStaffNav,
  assessStaffRoute,
  normalizePath,
  selectFixtureForRole,
  selectOwnerFixture,
} from '../../scripts/e2e/owner-screens';

const reports = OWNER_ROUTES[0];

describe('normalizePath', () => {
  it('reduces a device URL to its route path', () => {
    expect(normalizePath('https://localhost/reports?month=2026-11')).toBe('/reports');
    expect(normalizePath('/settlements/')).toBe('/settlements');
    expect(normalizePath('https://localhost')).toBe('/');
  });
});

describe('assessOwnerRoute', () => {
  it('passes when the owner stays on the route and sees its heading', () => {
    const outcome = assessOwnerRoute({
      path: reports.path,
      heading: reports.heading,
      finalUrl: 'https://localhost/reports',
      text: 'Monthly Reports Aggregated financial statements',
    });
    expect(outcome).toEqual({
      ok: true,
      detail: 'Monthly Reports rendered, no restriction notice',
    });
  });

  it('reports a redirect before inspecting content', () => {
    // The dashboard links to reports, so its text can contain the heading; the
    // redirect has to win or a bounced session would read as a pass.
    const outcome = assessOwnerRoute({
      path: reports.path,
      heading: reports.heading,
      finalUrl: 'https://localhost/login',
      text: 'Monthly Reports',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe('redirected to /login instead of staying on /reports');
  });

  it('fails when the guarded page renders its restriction notice', () => {
    const outcome = assessOwnerRoute({
      path: '/settlements',
      heading: 'Monthly Settlements',
      finalUrl: 'https://localhost/settlements',
      text: 'Access Restricted Settlement and Liability Tracking is restricted to Admin and Owner roles.',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('Access Restricted');
  });

  it('fails when the heading never renders', () => {
    const outcome = assessOwnerRoute({
      path: '/admin',
      heading: 'Admin Hub',
      finalUrl: 'https://localhost/admin',
      text: 'Something went wrong',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('heading "Admin Hub" not found');
  });
});

describe('assessOwnerNav', () => {
  it('passes when every privileged link is offered', () => {
    const outcome = assessOwnerNav(['/dashboard', '/reports', '/settlements', '/admin']);
    expect(outcome.ok).toBe(true);
  });

  it('names the missing links, which is how a staff-level menu is caught', () => {
    const outcome = assessOwnerNav(['/dashboard', '/ledger']);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('/reports, /settlements, /admin');
  });
});

describe('assessStaffRoute', () => {
  it('passes when the notice replaces the page content', () => {
    const outcome = assessStaffRoute({
      path: '/reports',
      finalUrl: 'https://localhost/reports',
      text: '🔒 Access Restricted Monthly Reports and Settlement Statements are restricted to Admin and Owner roles.',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain('notice shown');
  });

  it('passes when the staff session is redirected away entirely', () => {
    const outcome = assessStaffRoute({
      path: '/settlements',
      finalUrl: 'https://localhost/dashboard',
      text: 'Staff Dashboard',
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain('redirected to /dashboard');
  });

  it('fails when the privileged content renders', () => {
    // The restriction notice quotes the page headings, so content has to be
    // detected by the notice's absence rather than by a heading being missing.
    const outcome = assessStaffRoute({
      path: '/reports',
      finalUrl: 'https://localhost/reports',
      text: 'Monthly Reports Aggregated financial statements, daily breakdown',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('instead of blocking it');
  });
});

describe('assessStaffNav', () => {
  it('passes when the privileged links are absent (CLT-R-031)', () => {
    const outcome = assessStaffNav(['/dashboard', '/ledger']);
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain('/reports, /settlements, /admin');
  });

  it('fails and names the leaked links', () => {
    const outcome = assessStaffNav(['/dashboard', '/reports', '/admin']);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('/reports, /admin');
  });
});

describe('assessAdminApiRefusals', () => {
  it('passes when every admin endpoint refuses the staff token', () => {
    const outcome = assessAdminApiRefusals({
      hasToken: true,
      probes: [
        { path: '/api/v1/admin/users', status: 403 },
        { path: '/api/v1/admin/devices', status: 403 },
      ],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain('/api/v1/admin/users 403');
  });

  it('passes for a refused write probe and names its method', () => {
    const outcome = assessAdminApiRefusals({
      hasToken: true,
      probes: [{ path: '/api/v1/months/close', method: 'POST', status: 403 }],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toBe('POST /api/v1/months/close 403');
  });

  it('does not accept a validation failure as proof the role gate ran', () => {
    // A missing role check would let the request reach the schema, which answers
    // 400 — indistinguishable from a refusal unless the status is pinned.
    const outcome = assessAdminApiRefusals({
      hasToken: true,
      probes: [{ path: '/api/v1/months/close', method: 'POST', status: 400 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('expected 403, got POST /api/v1/months/close (400)');
  });

  it('fails when an endpoint serves a staff session', () => {
    const outcome = assessAdminApiRefusals({
      hasToken: true,
      probes: [{ path: '/api/v1/admin/users', status: 200 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('was served /api/v1/admin/users (200)');
  });

  it('stays inconclusive rather than passing when the probe could not connect', () => {
    const outcome = assessAdminApiRefusals({
      hasToken: true,
      probes: [{ path: '/api/v1/admin/users', status: 0 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('inconclusive');
  });

  it('fails when the session token cannot be found', () => {
    const outcome = assessAdminApiRefusals({ hasToken: false, probes: [] });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('no Supabase session token');
  });
});

describe('assessOwnerApiAccess', () => {
  it('passes when the owner reads succeed and the writes stop at validation', () => {
    const outcome = assessOwnerApiAccess({
      hasToken: true,
      probes: [
        { path: '/api/v1/admin/users', status: 200, expected: 200 },
        { path: '/api/v1/months/close', method: 'POST', status: 400, expected: 400 },
      ],
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toBe(
      '1 reads 200, 1 writes 400 at validation (no mutation), none refused',
    );
  });

  it('fails when the owner token is refused', () => {
    const outcome = assessOwnerApiAccess({
      hasToken: true,
      probes: [{ path: '/api/v1/months/close', method: 'POST', status: 403, expected: 400 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('owner token was refused by POST /api/v1/months/close (403)');
  });

  it('fails when a write is unexpectedly carried out', () => {
    const outcome = assessOwnerApiAccess({
      hasToken: true,
      probes: [{ path: '/api/v1/months/close', method: 'POST', status: 200, expected: 400 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('answered 200, expected 400');
  });

  it('stays inconclusive when an endpoint cannot be reached', () => {
    const outcome = assessOwnerApiAccess({
      hasToken: true,
      probes: [{ path: '/api/v1/admin/users', status: 0, expected: 200 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('inconclusive');
  });
});

describe('selectFixtureForRole', () => {
  const ready = (fixtureName: string, expectedRole: string) => ({ fixtureName, expectedRole });

  it('picks the staff fixture for the negative check', () => {
    const selection = selectFixtureForRole(
      { ready: [ready('MHK', 'staff'), ready('MHK_OWNER', 'owner')] },
      'staff',
    );
    expect(selection.fixture?.fixtureName).toBe('MHK');
  });

  it('takes the first of several staff fixtures instead of refusing', () => {
    const selection = selectFixtureForRole(
      { ready: [ready('MHK', 'staff'), ready('RMP', 'staff'), ready('MHK_OWNER', 'owner')] },
      'staff',
    );
    expect(selection.fixture?.fixtureName).toBe('MHK');
    expect(selection.problem).toBeUndefined();
  });

  it('says so when no fixture declares the wanted role', () => {
    const selection = selectFixtureForRole({ ready: [ready('MHK', 'staff')] }, 'admin');
    expect(selection.problem).toContain('CLT_DEVICE_<NAME>_ROLE=admin');
  });
});

describe('selectOwnerFixture', () => {
  const ready = (fixtureName: string, expectedRole: string) => ({ fixtureName, expectedRole });

  it('picks the fixture declared as owner, not the first one', () => {
    const selection = selectOwnerFixture({
      ready: [ready('MHK', 'staff'), ready('MHK_OWNER', 'owner'), ready('RMP', 'staff')],
    });
    expect(selection.fixture?.fixtureName).toBe('MHK_OWNER');
  });

  it('explains how to add an owner fixture when none is declared', () => {
    const selection = selectOwnerFixture({ ready: [ready('MHK', 'staff')] });
    expect(selection.fixture).toBeUndefined();
    expect(selection.problem).toContain('CLT_DEVICE_<NAME>_ROLE=owner');
  });

  it('reports the missing variables of an incomplete owner fixture', () => {
    const selection = selectOwnerFixture({
      ready: [],
      incomplete: [
        {
          fixtureName: 'MHK_OWNER',
          expectedRole: 'owner',
          missing: ['CLT_DEVICE_MHK_OWNER_PASSWORD'],
        },
      ],
    });
    expect(selection.problem).toContain('CLT_DEVICE_MHK_OWNER_PASSWORD');
  });

  it('honours an explicit fixture name', () => {
    const selection = selectOwnerFixture(
      { ready: [ready('MHK', 'staff'), ready('MHK_OWNER', 'owner')] },
      'mhk',
    );
    expect(selection.fixture?.fixtureName).toBe('MHK');
  });

  it('lists the configured fixtures for an unknown name', () => {
    const selection = selectOwnerFixture({ ready: [ready('MHK_OWNER', 'owner')] }, 'NOPE');
    expect(selection.problem).toContain('No fixture named "NOPE"');
    expect(selection.problem).toContain('MHK_OWNER');
  });

  it('asks for --fixture when two owners are configured', () => {
    const selection = selectOwnerFixture({
      ready: [ready('MHK_OWNER', 'owner'), ready('RMP_OWNER', 'owner')],
    });
    expect(selection.problem).toContain('--fixture');
    expect(selection.problem).toContain('RMP_OWNER');
  });
});
