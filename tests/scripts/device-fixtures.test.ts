import { describe, expect, it } from 'vitest';
import {
  assessFixture,
  fixtureVariables,
  planFixtureChecks,
  type CenterRow,
} from '../../scripts/e2e/device-fixtures';

const centers: CenterRow[] = [
  { id: 'mhk-id', code: 'MHK', name: 'Kumon Mohakhali Center' },
  { id: 'rmp-id', code: 'RMP', name: 'Kumon Rampura Center' },
];

const env = {
  CLT_DEVICE_MHK_ACCOUNT: 'device.check@cosmoledger.local',
  CLT_DEVICE_MHK_PASSWORD: 'mhk-secret',
  CLT_DEVICE_MHK_CENTER: 'MHK',
  CLT_DEVICE_RMP_ACCOUNT: 'rmp.check@cosmoledger.local',
  CLT_DEVICE_RMP_PASSWORD: 'rmp-secret',
  CLT_DEVICE_RMP_CENTER: 'RMP',
};

const session = {
  email: 'rmp.check@cosmoledger.local',
  role: 'staff',
  centerId: 'rmp-id',
};

const database = { role: 'staff', centerId: 'rmp-id' };

describe('fixtureVariables', () => {
  it('builds the per-fixture names', () => {
    expect(fixtureVariables('mhk_owner')).toMatchObject({
      accountVar: 'CLT_DEVICE_MHK_OWNER_ACCOUNT',
      passwordVar: 'CLT_DEVICE_MHK_OWNER_PASSWORD',
      centerVar: 'CLT_DEVICE_MHK_OWNER_CENTER',
      roleVar: 'CLT_DEVICE_MHK_OWNER_ROLE',
    });
  });
});

describe('planFixtureChecks', () => {
  it('treats each centre as a fixture when no registry is declared', () => {
    const plan = planFixtureChecks(centers, env);
    expect(plan.ready.map((fixture) => fixture.fixtureName)).toEqual(['MHK', 'RMP']);
    expect(plan.incomplete).toEqual([]);
  });

  it('carries the credentials, centre id and default role through', () => {
    const [first] = planFixtureChecks(centers, env).ready;
    expect(first).toMatchObject({
      centerId: 'mhk-id',
      email: 'device.check@cosmoledger.local',
      password: 'mhk-secret',
      expectedRole: 'staff',
    });
  });

  it('supports two fixtures on the same centre', () => {
    const plan = planFixtureChecks(centers, {
      ...env,
      CLT_DEVICE_FIXTURES: 'MHK,MHK_OWNER,RMP',
      CLT_DEVICE_MHK_OWNER_ACCOUNT: 'owner.mhk@cosmoledger.local',
      CLT_DEVICE_MHK_OWNER_PASSWORD: 'owner-secret',
      CLT_DEVICE_MHK_OWNER_CENTER: 'MHK',
      CLT_DEVICE_MHK_OWNER_ROLE: 'owner',
    });
    expect(plan.ready.map((fixture) => fixture.fixtureName)).toEqual(['MHK', 'MHK_OWNER', 'RMP']);
    const owner = plan.ready[1];
    expect(owner.centerId).toBe('mhk-id');
    expect(owner.expectedRole).toBe('owner');
  });

  it('says when a declared fixture points at an unknown centre', () => {
    const plan = planFixtureChecks(centers, {
      ...env,
      CLT_DEVICE_FIXTURES: 'GHOST',
      CLT_DEVICE_GHOST_ACCOUNT: 'ghost@cosmoledger.local',
      CLT_DEVICE_GHOST_PASSWORD: 'secret',
      CLT_DEVICE_GHOST_CENTER: 'XYZ',
    });
    expect(plan.ready).toEqual([]);
    expect(plan.incomplete[0].missing[0]).toContain('CLT_DEVICE_GHOST_CENTER');
    expect(plan.incomplete[0].missing[0]).toContain('unknown centre XYZ');
  });

  it('names a missing variable instead of skipping silently', () => {
    const plan = planFixtureChecks(centers, { ...env, CLT_DEVICE_RMP_PASSWORD: undefined });
    expect(plan.ready.map((fixture) => fixture.fixtureName)).toEqual(['MHK']);
    expect(plan.incomplete[0].missing).toEqual(['CLT_DEVICE_RMP_PASSWORD']);
  });

  it('reports everything when nothing is configured', () => {
    // Without a registry each centre is its own fixture, so its centre is known
    // from the database and only the credentials can be missing.
    const plan = planFixtureChecks(centers, {});
    expect(plan.ready).toEqual([]);
    expect(plan.incomplete[0].missing).toEqual([
      'CLT_DEVICE_MHK_ACCOUNT',
      'CLT_DEVICE_MHK_PASSWORD',
    ]);
  });

  it('treats a blank account as missing', () => {
    const plan = planFixtureChecks(centers, { ...env, CLT_DEVICE_MHK_ACCOUNT: '   ' });
    expect(plan.incomplete[0].missing).toEqual(['CLT_DEVICE_MHK_ACCOUNT']);
  });
});

describe('assessFixture', () => {
  const params = {
    expectedRole: 'staff',
    expectedCenterId: 'rmp-id',
    session,
    database,
  };

  it('passes a fixture with the right role and centre', () => {
    expect(assessFixture(params)).toEqual({ ok: true, detail: 'staff, center matches' });
  });

  it('passes an owner fixture', () => {
    expect(
      assessFixture({
        ...params,
        expectedRole: 'owner',
        session: { ...session, role: 'owner' },
        database: { role: 'owner', centerId: 'rmp-id' },
      }),
    ).toEqual({ ok: true, detail: 'owner, center matches' });
  });

  it('catches a drifted role and says the database agrees with the session', () => {
    const outcome = assessFixture({
      ...params,
      session: { ...session, role: 'owner' },
      database: { role: 'owner', centerId: 'rmp-id' },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toBe('role is owner, expected staff (database agrees)');
  });

  it('distinguishes a stale session from a changed row', () => {
    const outcome = assessFixture({
      ...params,
      session: { ...session, role: 'owner' },
      database: { role: 'staff', centerId: 'rmp-id' },
    });
    expect(outcome.detail).toBe('role is owner, expected staff (database says staff)');
  });

  it('catches a session scoped to the wrong centre', () => {
    const outcome = assessFixture({
      ...params,
      session: { ...session, centerId: 'mhk-id' },
      database: { role: 'staff', centerId: 'mhk-id' },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('scoped to center mhk-id, expected rmp-id');
    expect(outcome.detail).toContain('database says mhk-id');
  });

  it('catches a database row pinned to another centre while the session looks right', () => {
    const outcome = assessFixture({ ...params, database: { role: 'staff', centerId: 'mhk-id' } });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('database says mhk-id');
  });

  it('reports a missing profile row', () => {
    expect(assessFixture({ ...params, database: null }).detail).toBe(
      'no profiles row in the database for this account',
    );
  });

  it('reports a missing session', () => {
    expect(assessFixture({ ...params, session: null }).detail).toBe(
      'no cached profile after sign-in',
    );
  });
});
