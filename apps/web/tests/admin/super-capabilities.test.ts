import { describe, it, expect } from 'vitest';
import type { UserRole } from '@clt/shared';
import {
  ALL_CAPABILITIES,
  PERMISSIONS,
  SUPER_ADMIN_ONLY_CAPABILITIES,
  canManageUser,
  hasCapability,
  hasCenterCapability,
  isCenterScoped,
  requireCapability,
} from '$lib/server/capabilities';

/**
 * Plan 023 step 1 — the seat is a capability set, not prose. These assertions are the
 * brake on "the Super Admin can do anything": Owner's capabilities must always be a
 * subset of the Super Admin's, and the center roles must nest, or the registry has
 * drifted and the build should fail.
 */

const CENTER_ROLES: UserRole[] = ['staff', 'admin', 'owner'];

/** SvelteKit's HttpError exposes `status` and `body.message`, not a plain message. */
function httpError(fn: () => void): { status: number; message: string | undefined } {
  try {
    fn();
  } catch (thrown) {
    const err = thrown as { status?: number; body?: { message?: string } };
    return { status: err.status ?? 0, message: err.body?.message };
  }
  throw new Error('expected the guard to throw');
}

describe('capability registry', () => {
  it('gives the Super Admin every Owner capability', () => {
    for (const capability of PERMISSIONS.owner) {
      expect(PERMISSIONS.super_admin.has(capability)).toBe(true);
    }
    // And the seat is strictly larger: platform-only capabilities exist and no
    // center-scoped role holds them.
    expect(SUPER_ADMIN_ONLY_CAPABILITIES.length).toBeGreaterThan(0);
    for (const capability of SUPER_ADMIN_ONLY_CAPABILITIES) {
      expect(PERMISSIONS.super_admin.has(capability)).toBe(true);
      for (const role of CENTER_ROLES) {
        expect(PERMISSIONS[role].has(capability)).toBe(false);
      }
    }
  });

  it('nests staff inside admin inside owner', () => {
    for (const capability of PERMISSIONS.staff) {
      expect(PERMISSIONS.admin.has(capability)).toBe(true);
    }
    for (const capability of PERMISSIONS.admin) {
      expect(PERMISSIONS.owner.has(capability)).toBe(true);
    }
    // Strict, so an emptied or duplicated group is caught rather than passing silently.
    expect(PERMISSIONS.staff.size).toBeLessThan(PERMISSIONS.admin.size);
    expect(PERMISSIONS.admin.size).toBeLessThan(PERMISSIONS.owner.size);
    expect(PERMISSIONS.owner.size).toBeLessThan(PERMISSIONS.super_admin.size);
    // A capability nobody holds would be dead weight in the union.
    for (const capability of ALL_CAPABILITIES) {
      expect(PERMISSIONS.super_admin.has(capability)).toBe(true);
    }
  });

  it('shows the platform navigation only to a role that holds its capabilities', () => {
    // The app shell gates these three links on these capabilities (Sidebar and
    // FloatingMenu). If a center role ever gained one, the link would appear in a
    // shell whose routes still refuse it — so the gate is asserted here, at the
    // registry, rather than by reading Svelte markup.
    const platformNavigation = ['center.read_all', 'ledger.read_all', 'audit.read_all'] as const;

    for (const role of CENTER_ROLES) {
      for (const capability of platformNavigation) {
        expect(hasCapability(role, capability), `${role} must not see ${capability}`).toBe(false);
      }
    }
    for (const capability of platformNavigation) {
      expect(hasCapability('super_admin', capability)).toBe(true);
    }
  });

  it('separates center reach from the capability itself', () => {
    // The seat holds report.read, settlement.read and month.close, yet must not open
    // the franchise screens: those require a center, which the seat does not have.
    for (const capability of ['report.read', 'settlement.read', 'month.close'] as const) {
      expect(hasCapability('super_admin', capability)).toBe(true);
      expect(hasCenterCapability('super_admin', capability)).toBe(false);
    }

    expect(isCenterScoped('super_admin')).toBe(false);
    for (const role of CENTER_ROLES) expect(isCenterScoped(role)).toBe(true);

    expect(hasCenterCapability('owner', 'report.read')).toBe(true);
    expect(hasCenterCapability('admin', 'report.read')).toBe(true);
    expect(hasCenterCapability('staff', 'report.read')).toBe(false);
    expect(hasCenterCapability('owner', 'month.reopen')).toBe(true);
    expect(hasCenterCapability('admin', 'month.reopen')).toBe(false);
  });

  it('lets an owner manage anyone but an owner, and an admin manage staff only', () => {
    // The users screen asks this instead of restating role pairs in markup.
    expect(canManageUser('owner', 'staff')).toBe(true);
    expect(canManageUser('owner', 'admin')).toBe(true);
    expect(canManageUser('owner', 'owner')).toBe(false);
    expect(canManageUser('owner', 'super_admin')).toBe(false);

    expect(canManageUser('admin', 'staff')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('admin', 'owner')).toBe(false);

    expect(canManageUser('staff', 'staff')).toBe(false);
    // The seat manages nobody from inside a center; its user tools are platform routes.
    expect(canManageUser('super_admin', 'staff')).toBe(false);
  });

  it('denies by default and refuses an inactive caller', () => {
    expect(
      httpError(() => requireCapability({ role: 'staff', active: true }, 'rates.publish')),
    ).toEqual({ status: 403, message: 'capability_denied' });
    expect(
      httpError(() => requireCapability({ role: 'admin', active: true }, 'month.close')),
    ).toEqual({ status: 403, message: 'capability_denied' });
    expect(
      httpError(() => requireCapability({ role: 'owner', active: true }, 'center.suspend')),
    ).toEqual({ status: 403, message: 'capability_denied' });
    expect(
      httpError(() => requireCapability({ role: 'owner', active: false }, 'rates.publish')),
    ).toEqual({ status: 403, message: 'user_deactivated' });
    expect(() => requireCapability({ role: 'owner', active: true }, 'rates.publish')).not.toThrow();
    expect(() =>
      requireCapability({ role: 'super_admin', active: true }, 'ledger.write_any_center'),
    ).not.toThrow();
  });
});
