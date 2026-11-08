import { error, type RequestEvent } from '@sveltejs/kit';
import { getServiceSupabase } from '$lib/server/supabase';

export interface CallerContext {
  userId: string;
  role: 'staff' | 'admin' | 'owner';
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
    .select('role, active')
    .eq('id', user.id)
    .single();

  if (profError || !profile) {
    throw error(401, 'unauthorized: profile not found');
  }

  if (profile.active === false) {
    throw error(403, 'user_deactivated');
  }

  return {
    userId: user.id,
    role: profile.role,
    active: profile.active,
  };
}

/**
 * Validates that caller has one of the required roles and is active.
 * Throws standard SvelteKit error(403, ...) if unauthorized.
 */
export function requireRole(caller: CallerContext, allowedRoles: ('staff' | 'admin' | 'owner')[]) {
  if (!caller.active) {
    throw error(403, 'user_deactivated');
  }
  if (!allowedRoles.includes(caller.role)) {
    throw error(403, 'unauthorized: insufficient permissions');
  }
}
