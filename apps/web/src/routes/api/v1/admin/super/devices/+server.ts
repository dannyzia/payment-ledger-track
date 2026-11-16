import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { requireAssurance } from '$lib/server/assurance';
import { requireCapability } from '$lib/server/capabilities';
import { getDbPool } from '$lib/server/db';
import { getServiceSupabase } from '$lib/server/supabase';

/**
 * GET|POST /api/v1/admin/super/devices — Plan 023 step 15.
 *
 * GET lists every registered device with the center and user it belongs to, optionally
 * narrowed to one center or to devices the fleet has not heard from. POST revokes or
 * unrevokes one physical device through `admin_manage_device`, which since migration 0008
 * accepts an active platform `super_admin`. Revocation is killswitch state, so the route
 * never deletes a row.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STALE_DEVICE_DAYS = 14;

const manageSchema = z.object({
  centerId: z.string().uuid('centerId must be a uuid'),
  deviceId: z.string().regex(DEVICE_ID_RE, 'deviceId must be a uuid'),
  action: z.enum(['revoke', 'unrevoke']),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'device.read_all');

  const centerId = event.url.searchParams.get('centerId');
  const staleOnly = event.url.searchParams.get('staleOnly') === 'true';
  const limitRaw = Number.parseInt(event.url.searchParams.get('limit') ?? '100', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 100;

  if (centerId !== null && !UUID_RE.test(centerId)) {
    return new Response(JSON.stringify({ error: 'invalid_center_id' }), {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const params: unknown[] = [];
  const clauses: string[] = [];
  if (centerId !== null) {
    params.push(centerId);
    clauses.push(`d.center_id = $${params.length}`);
  }
  if (staleOnly) {
    params.push(STALE_DEVICE_DAYS);
    clauses.push(
      `NOT d.revoked AND d.last_seen_at < now() - make_interval(days => $${params.length})`,
    );
  }
  params.push(limit);

  const result = await getDbPool().query(
    `SELECT d.device_id,
            d.device_name,
            d.last_seen_at,
            d.last_rate_version,
            d.revoked,
            d.user_id,
            p.full_name,
            p.active AS user_active,
            c.id        AS center_id,
            c.code      AS center_code,
            c.name      AS center_name
       FROM devices d
       JOIN centers c  ON c.id = d.center_id
       LEFT JOIN profiles p ON p.id = d.user_id
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY d.revoked, d.last_seen_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return new Response(
    JSON.stringify({
      staleAfterDays: STALE_DEVICE_DAYS,
      devices: result.rows.map((row) => ({
        deviceId: String(row.device_id),
        deviceName: row.device_name === null ? null : String(row.device_name),
        lastSeenAt: String(row.last_seen_at),
        lastRateVersion: Number(row.last_rate_version),
        revoked: Boolean(row.revoked),
        userId: String(row.user_id),
        userName: row.full_name === null ? null : String(row.full_name),
        userActive: row.user_active === null ? null : Boolean(row.user_active),
        centerId: String(row.center_id),
        centerCode: String(row.center_code),
        centerName: String(row.center_name),
      })),
    }),
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);
  requireAssurance(caller, 'aal2');
  requireCapability(caller, 'device.revoke');

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

  const { error } = await getServiceSupabase().rpc('admin_manage_device', {
    p_center_id: parsed.data.centerId,
    p_device_id: parsed.data.deviceId,
    p_action: parsed.data.action,
    p_actor_id: caller.userId,
  });

  if (error) {
    const status = /\b403\b/.test(error.message) ? 403 : /\b404\b/.test(error.message) ? 404 : 422;
    return new Response(JSON.stringify({ error: error.message }), {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return new Response(JSON.stringify({ success: true, action: parsed.data.action }), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
};
