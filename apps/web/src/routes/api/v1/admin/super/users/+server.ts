import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/supabase';

/**
 * GET|POST /api/v1/admin/super/users — Plan 023 step 15.
 *
 * GET searches every center's users by name or email, optionally narrowed to one center.
 * POST disables, enables or force-signs-out one user through `admin_manage_user`, which
 * since migration 0008 accepts an active platform `super_admin` as well as a center
 * admin/owner. The route derives the tenant from the named `centerId` and never from the
 * caller, who has no center.
 *
 * Force sign-out revokes the target's refresh tokens through the privileged pool: GoTrue
 * sessions are not reachable from an RPC. The audit row is written by the RPC before the
 * revoke, so the order is recorded even if the revoke fails. An access token already
 * issued stays valid until it expires (at most an hour), which is the honest limit of
 * this action.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const manageSchema = z.object({
  centerId: z.string().uuid('centerId must be a uuid'),
  userId: z.string().uuid('userId must be a uuid'),
  action: z.enum(['disable', 'enable', 'force_signout']),
});

const ACTION_MAP = {
  disable: 'deactivate',
  enable: 'reactivate',
  force_signout: 'force_signout',
} as const;

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'user.read_all');

  const q = (event.url.searchParams.get('q') ?? '').trim();
  const centerId = event.url.searchParams.get('centerId');
  const limitRaw = Number.parseInt(event.url.searchParams.get('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 50;

  if (centerId !== null && !UUID_RE.test(centerId)) {
    return new Response(JSON.stringify({ error: 'invalid_center_id' }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // LIKE metacharacters in the search text are escaped so they match literally.
  const escaped = q.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (centerId !== null) {
    params.push(centerId);
    clauses.push(`p.center_id = $${params.length}`);
  }
  if (q !== '') {
    params.push(`%${escaped}%`);
    clauses.push(`(p.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  params.push(limit);

  const pool = getDbPool();
  const result = await pool.query(
    `SELECT p.id,
            p.full_name,
            u.email,
            p.role::text AS role,
            p.active,
            p.center_id,
            c.code       AS center_code,
            c.name       AS center_name,
            p.created_at
       FROM profiles p
       LEFT JOIN auth.users u ON u.id = p.id
       LEFT JOIN centers c    ON c.id = p.center_id
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY p.active DESC, c.code NULLS FIRST, p.full_name
      LIMIT $${params.length}`,
    params,
  );

  return new Response(
    JSON.stringify({
      users: result.rows.map((row) => ({
        id: String(row.id),
        fullName: String(row.full_name),
        email: row.email === null ? null : String(row.email),
        role: String(row.role),
        active: Boolean(row.active),
        centerId: row.center_id === null ? null : String(row.center_id),
        centerCode: row.center_code === null ? null : String(row.center_code),
        centerName: row.center_name === null ? null : String(row.center_name),
        createdAt: String(row.created_at),
      })),
    }),
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'user.manage');

  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const parsed = manageSchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_body', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const { centerId, userId, action } = parsed.data;
  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_manage_user', {
    p_center_id: centerId,
    p_action: ACTION_MAP[action],
    p_user_id: userId,
    // Unused by these actions; the RPC reads them only for `update_role`, which the seat
    // route does not expose (ownership changes stay with transfer_ownership).
    p_role: '',
    p_active: false,
    p_actor_id: caller.userId,
  });

  if (error) {
    // The RPC's own refusals are already coded (`403 unauthorized`, `404 user_not_found`).
    const status = /\b403\b/.test(error.message) ? 403 : /\b404\b/.test(error.message) ? 404 : 422;
    return new Response(JSON.stringify({ error: error.message }), {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let sessionsRevoked = 0;
  if (action === 'force_signout') {
    try {
      const revoked = await getDbPool().query(
        `UPDATE auth.refresh_tokens
            SET revoked = true
          WHERE user_id = $1 AND revoked = false
          RETURNING id`,
        [userId],
      );
      sessionsRevoked = revoked.rowCount ?? 0;
    } catch (cause) {
      // The audit row from the RPC already records the order, so the failure is traceable.
      return new Response(
        JSON.stringify({
          error: 'session_revoke_failed',
          message: cause instanceof Error ? cause.message : String(cause),
        }),
        { status: 500, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  return new Response(JSON.stringify({ success: true, action, sessionsRevoked }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
};
