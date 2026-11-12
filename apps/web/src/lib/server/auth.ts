import { error, type RequestEvent } from '@sveltejs/kit';
import { getServiceSupabase } from '$lib/server/supabase';
import type { UserRole } from '@clt/shared';

export interface CallerContext {
  userId: string;
  role: UserRole;
  centerId: string | null; // null strictly for super_admin
  active: boolean;
}

/**
 * Extracts and verifies the caller's JWT from the Authorization: Bearer header.
 * Throws standard SvelteKit error(401, ...) on auth failures (Hard Rule 7 & 9).
 */
export async function getCallerContext(event: RequestEvent): Promise<CallerContext> {
  const authHeader = event.request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw error(401, 'unauthorized: missing or malformed Authorization header');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw error(401, 'unauthorized: empty Bearer token');
  }

  const supabase = getServiceSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    throw error(401, 'unauthorized: invalid or expired token');
  }

  const { data: profile, error: profError } = await supabase
    .from('profiles')
    .select('role, active, center_id')
    .eq('id', user.id)
    .single();

  if (profError || !profile) {
    throw error(401, 'unauthorized: profile not found');
  }

  if (profile.active === false) {
    throw error(403, 'user_deactivated');
  }

  // app_metadata wins (GoTrue claims are set by admin flows and re-derived into the
  // profile by fn_auth_users_sync_profile_role); fall back to the profile column.
  const appMetaCenterId = (user.app_metadata as { center_id?: string | undefined } | undefined)
    ?.center_id;
  const centerId: string | null = appMetaCenterId ?? profile.center_id ?? null;

  const role = profile.role as UserRole;
  if (role !== 'super_admin' && !centerId) {
    throw error(403, 'unauthorized: profile has no center assigned');
  }

  return {
    userId: user.id,
    role,
    centerId,
    active: profile.active,
  };
}

/**
 * Validates that caller has one of the required roles and is active.
 * Throws standard SvelteKit error(403, ...) if unauthorized.
 */
export function requireRole(caller: CallerContext, allowedRoles: UserRole[]) {
  if (!caller.active) {
    throw error(403, 'user_deactivated');
  }
  if (!allowedRoles.includes(caller.role)) {
    throw error(403, 'unauthorized: insufficient permissions');
  }
}

/**
 * Enforces that a caller belongs to the given center; super_admin passes for any center.
 */
export function assertCallerInCenter(caller: CallerContext, targetCenterId: string) {
  if (caller.role === 'super_admin') {
    return;
  }
  if (caller.centerId !== targetCenterId) {
    throw error(403, 'forbidden_tenant_mismatch');
  }
}

export function isSuperAdmin(caller: CallerContext): boolean {
  return caller.role === 'super_admin';
}
