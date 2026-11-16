import { error } from '@sveltejs/kit';
import type { UserRole } from '@clt/shared';
import { PERMISSIONS, type Capability } from '$lib/capabilities';

/**
 * Server side of the capability registry (Plan 023 §6.1).
 *
 * The registry itself lives in `$lib/capabilities.ts` so the app shell can gate
 * navigation on the same sets the server enforces. This module re-exports it and
 * adds the deny-by-default guard, which is the only authority.
 */
export * from '$lib/capabilities';

/** The caller shape `requireCapability` needs; `CallerContext` satisfies it structurally. */
export interface CapabilityHolder {
  role: UserRole;
  active: boolean;
}

/**
 * Deny-by-default guard. Throws `403 capability_denied` unless the caller's role is
 * licensed for the capability. Cross-center scope is checked by the call site; this
 * function answers only "may this role do this at all".
 */
export function requireCapability(caller: CapabilityHolder, capability: Capability): void {
  if (!caller.active) {
    throw error(403, 'user_deactivated');
  }
  if (!PERMISSIONS[caller.role].has(capability)) {
    throw error(403, 'capability_denied');
  }
}
