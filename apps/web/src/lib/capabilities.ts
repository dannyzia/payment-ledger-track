import type { UserRole } from '@clt/shared';

/**
 * Plan 023 §6.1 — capability registry for the Super Admin panel, role-licensed.
 *
 * This module is deliberately client-safe (no `@sveltejs/kit` error import, no
 * service-role access) because the app shell reads it to decide which navigation to
 * render: a link that exists only because the role is spelled `super_admin` drifts
 * from the registry the server enforces. `$lib/server/capabilities.ts` re-exports it
 * and adds the deny-by-default `requireCapability` guard.
 *
 * A capability is licensed by role here; cross-center reach is a scope argument on
 * the call site, not a second permission set.
 *
 * UI gating is not enforcement. Every route checks the same capability (and the role)
 * server-side; hiding a link only keeps a wrong door out of sight.
 */
export type Capability =
  // Entries and ledger
  | 'entry.create'
  | 'entry.read_own'
  | 'entry.read_center'
  | 'entry.request_void'
  | 'entry.void'
  | 'entry.supersede'
  // Reports
  | 'report.read'
  // Settlements
  | 'settlement.read'
  | 'settlement.record_payment'
  | 'settlement.approve_overpayment'
  // Reconciliation and month close
  | 'reconcile.read'
  | 'reconcile.manage'
  | 'reconcile.review_exception'
  | 'month.close'
  | 'month.reopen'
  // Configuration
  | 'rates.read'
  | 'rates.publish'
  | 'method.manage'
  | 'payable.manage'
  | 'settings.manage'
  // People and devices
  | 'user.read'
  | 'user.invite_staff'
  | 'user.invite_admin'
  | 'user.manage'
  | 'ownership.transfer'
  | 'device.read'
  | 'device.revoke'
  // Review and audit
  | 'stale_review.manage'
  | 'audit.read_center'
  // Platform tier (Super Admin only)
  | 'center.create'
  | 'center.edit'
  | 'center.read_all'
  | 'center.suspend'
  | 'center.archive'
  | 'ledger.read_all'
  | 'ledger.write_any_center'
  | 'audit.read_all'
  | 'export.center'
  | 'user.read_all'
  | 'device.read_all'
  | 'backup.read'
  | 'security.manage';

const STAFF_CAPABILITIES: readonly Capability[] = [
  'entry.create',
  'entry.read_own',
  'entry.request_void',
];

const ADMIN_EXTRA_CAPABILITIES: readonly Capability[] = [
  'entry.read_center',
  'entry.void',
  'entry.supersede',
  'report.read',
  'settlement.read',
  'settlement.record_payment',
  'reconcile.read',
  'reconcile.manage',
  'reconcile.review_exception',
  'rates.read',
  'rates.publish',
  'method.manage',
  'payable.manage',
  'settings.manage',
  'user.read',
  'user.invite_staff',
  'user.manage',
  'device.read',
  'device.revoke',
  'stale_review.manage',
  'audit.read_center',
];

const OWNER_EXTRA_CAPABILITIES: readonly Capability[] = [
  'settlement.approve_overpayment',
  'month.close',
  'month.reopen',
  'user.invite_admin',
  'ownership.transfer',
];

const SUPER_ADMIN_EXTRA_CAPABILITIES: readonly Capability[] = [
  'center.create',
  'center.edit',
  'center.read_all',
  'center.suspend',
  'center.archive',
  'ledger.read_all',
  'ledger.write_any_center',
  'audit.read_all',
  'export.center',
  'user.read_all',
  'device.read_all',
  'backup.read',
  'security.manage',
];

function union(...groups: readonly (readonly Capability[])[]): ReadonlySet<Capability> {
  return new Set(groups.flat());
}

/**
 * Built up the same way in both places: the Super Admin set is generated from the
 * other three plus its platform-only capabilities, so a new Owner permission cannot
 * silently fall outside the seat's set.
 */
const ADMIN_CAPABILITIES = union(STAFF_CAPABILITIES, ADMIN_EXTRA_CAPABILITIES);
const OWNER_CAPABILITIES = union(
  STAFF_CAPABILITIES,
  ADMIN_EXTRA_CAPABILITIES,
  OWNER_EXTRA_CAPABILITIES,
);

export const PERMISSIONS: Record<UserRole, ReadonlySet<Capability>> = {
  staff: union(STAFF_CAPABILITIES),
  admin: ADMIN_CAPABILITIES,
  owner: OWNER_CAPABILITIES,
  super_admin: union(
    STAFF_CAPABILITIES,
    ADMIN_EXTRA_CAPABILITIES,
    OWNER_EXTRA_CAPABILITIES,
    SUPER_ADMIN_EXTRA_CAPABILITIES,
  ),
};

/** Capabilities no center-scoped role holds. Used by the Owner ⊆ SuperAdmin test. */
export const SUPER_ADMIN_ONLY_CAPABILITIES: readonly Capability[] = SUPER_ADMIN_EXTRA_CAPABILITIES;

/** Every capability the registry knows about. */
export const ALL_CAPABILITIES: readonly Capability[] = [
  ...new Set(Object.values(PERMISSIONS).flatMap((capabilities) => [...capabilities])),
];

export function hasCapability(role: UserRole, capability: Capability): boolean {
  return PERMISSIONS[role].has(capability);
}

/** Center-scoped roles: every role except the platform seat, which holds no center. */
export function isCenterScoped(role: UserRole): boolean {
  return role !== 'super_admin';
}

/**
 * The gate for a franchise screen or link: the role holds the capability AND belongs
 * to a center. The seat holds many of the same capabilities but is cross-center by
 * design, so its surface is `/admin/super/*`, not the franchise screens.
 */
export function hasCenterCapability(role: UserRole, capability: Capability): boolean {
  return isCenterScoped(role) && PERMISSIONS[role].has(capability);
}

/**
 * Whether `callerRole` may manage `targetRole` on the users screen. A sole Owner
 * manages everyone but another Owner; an Admin manages Staff only; the seat manages
 * nobody from inside a center (its user tools are `/api/v1/admin/super/users`).
 * Mirrors the server rule rather than restating the role names in the markup.
 */
export function canManageUser(callerRole: UserRole, targetRole: string): boolean {
  if (targetRole === 'owner' || targetRole === 'super_admin') return false;
  if (!PERMISSIONS[callerRole].has('user.manage')) return false;
  if (callerRole === 'owner') return true;
  return callerRole === 'admin' && targetRole === 'staff';
}
