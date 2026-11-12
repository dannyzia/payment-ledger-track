/**
 * Fixture planning and assessment for the device smoke check.
 *
 * Fixtures are declared by name in `CLT_DEVICE_FIXTURES` (for example
 * `MHK,RMP,MHK_OWNER`), each with `CLT_DEVICE_<NAME>_ACCOUNT`, `_PASSWORD`,
 * `_CENTER` and optionally `_ROLE`. Two fixtures on the same centre therefore
 * coexist — the staff and owner accounts of Mohakhali — which a one-fixture-per-
 * centre scheme could not express.
 *
 * With `CLT_DEVICE_FIXTURES` unset, the older behaviour holds: every centre is
 * itself a fixture name (`MHK` → `CLT_DEVICE_MHK_*`), so existing setups keep
 * working.
 *
 * A fixture is only checkable when everything it needs is present; anything else
 * is a setup gap, and the gap is named rather than silently skipped. The
 * assessment compares the profile the app cached after sign-in with the centre
 * and role the fixture should have, and with the database row, so a drifted role
 * is reported as clearly as a rejected password.
 *
 * Kept apart from the CLI so all of it is testable without a handset.
 */
export interface CenterRow {
  id: string;
  code: string;
  name: string;
}

export interface FixtureCheck {
  fixtureName: string;
  centerId: string;
  code: string;
  centerName: string;
  accountVar: string;
  passwordVar: string;
  centerVar: string;
  /** Role the fixture should hold; `staff` unless CLT_DEVICE_<NAME>_ROLE says otherwise. */
  expectedRole: string;
  email?: string;
  password?: string;
}

export interface FixturePlan {
  ready: Array<FixtureCheck & { email: string; password: string }>;
  incomplete: Array<FixtureCheck & { missing: string[] }>;
}

export interface ProfileSnapshot {
  email?: string;
  role?: string;
  centerId?: string | null;
}

export interface DbProfile {
  role: string;
  centerId: string | null;
}

export function fixtureVariables(fixtureName: string): {
  prefix: string;
  accountVar: string;
  passwordVar: string;
  centerVar: string;
  roleVar: string;
} {
  const prefix = `CLT_DEVICE_${fixtureName.toUpperCase()}`;
  return {
    prefix,
    accountVar: `${prefix}_ACCOUNT`,
    passwordVar: `${prefix}_PASSWORD`,
    centerVar: `${prefix}_CENTER`,
    roleVar: `${prefix}_ROLE`,
  };
}

export function planFixtureChecks(
  centers: CenterRow[],
  env: NodeJS.ProcessEnv = process.env,
): FixturePlan {
  const ready: FixturePlan['ready'] = [];
  const incomplete: FixturePlan['incomplete'] = [];
  const byCode = new Map(centers.map((center) => [center.code.toUpperCase(), center]));

  const declared = env.CLT_DEVICE_FIXTURES?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  const definitions =
    declared && declared.length > 0
      ? declared.map((fixtureName) => ({
          fixtureName,
          centerCode: env[fixtureVariables(fixtureName).centerVar]?.trim().toUpperCase() ?? '',
        }))
      : centers.map((center) => ({
          fixtureName: center.code,
          centerCode: center.code.toUpperCase(),
        }));

  for (const definition of definitions) {
    const { fixtureName, centerCode } = definition;
    const vars = fixtureVariables(fixtureName);
    const center = centerCode ? byCode.get(centerCode) : undefined;
    const email = env[vars.accountVar]?.trim();
    const password = env[vars.passwordVar];
    const expectedRole = env[vars.roleVar]?.trim() || 'staff';

    const missing = [
      ...(center
        ? []
        : [`${vars.centerVar}${centerCode ? ` (unknown centre ${centerCode})` : ''}`]),
      ...(email ? [] : [vars.accountVar]),
      ...(password ? [] : [vars.passwordVar]),
    ];

    const base: FixtureCheck = {
      fixtureName,
      centerId: center?.id ?? '',
      code: center?.code ?? centerCode,
      centerName: center?.name ?? centerCode ?? 'unknown centre',
      accountVar: vars.accountVar,
      passwordVar: vars.passwordVar,
      centerVar: vars.centerVar,
      expectedRole,
      email,
      password,
    };

    if (missing.length === 0 && center && email && password) {
      ready.push({ ...base, email, password });
    } else {
      incomplete.push({ ...base, missing });
    }
  }

  return { ready, incomplete };
}

/**
 * Decides whether a sign-in produced the fixture it was meant to, and says which
 * side disagrees when it did not: the session the app holds, or the database row
 * behind it.
 */
export function assessFixture(params: {
  expectedRole: string;
  expectedCenterId: string;
  session: ProfileSnapshot | null;
  database: DbProfile | null;
}): { ok: boolean; detail: string } {
  const { expectedRole, expectedCenterId, session, database } = params;

  if (!session?.email) {
    return { ok: false, detail: 'no cached profile after sign-in' };
  }
  if (!database) {
    return { ok: false, detail: 'no profiles row in the database for this account' };
  }

  const agrees = (sessionRole: string | undefined) =>
    database.role === sessionRole ? 'database agrees' : `database says ${database.role}`;

  if (session.role !== expectedRole) {
    return {
      ok: false,
      detail: `role is ${session.role ?? 'missing'}, expected ${expectedRole} (${agrees(session.role)})`,
    };
  }

  const sessionCenter = session.centerId ?? null;
  if (sessionCenter !== expectedCenterId || database.centerId !== expectedCenterId) {
    const parts = [
      `session is scoped to center ${sessionCenter ?? 'none'}, expected ${expectedCenterId}`,
    ];
    if (database.centerId !== expectedCenterId) {
      parts.push(`database says ${database.centerId ?? 'none'}`);
    }
    return { ok: false, detail: parts.join('; ') };
  }

  return { ok: true, detail: `${session.role}, center matches` };
}
