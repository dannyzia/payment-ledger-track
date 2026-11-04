import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const manageDeviceSchema = z.object({
  deviceId: z.string().uuid().transform((s) => s.toLowerCase()),
  action: z.enum(['revoke', 'unrevoke']),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data: deviceRows, error: devErr } = await supabase
    .from('devices')
    .select('id, device_id, device_name, last_seen_at, last_rate_version, revoked, user_id, profiles(full_name)')
    .order('last_seen_at', { ascending: false });

  if (devErr) {
    return new Response(JSON.stringify({ error: devErr.message }), { status: 500 });
  }

  // Group active user sessions by physical device_id
  
  type DeviceGroup = {
    device_id: string;
    label: string | null;
    platform: string;
    last_seen_at: string | null;
    revoked: boolean;
    active_users: Array<{ user_id: string; full_name: string; email: string }>;
  };
  const deviceMap = new Map<string, DeviceGroup>();
  for (const row of deviceRows || []) {
    if (!deviceMap.has(row.device_id)) {
      deviceMap.set(row.device_id, {
        device_id: row.device_id,
        label: row.device_name,
        platform: 'web-pwa',
        last_seen_at: row.last_seen_at,
        revoked: row.revoked,
        active_users: [],
      });
    }
    if (row.user_id) {
      const group = deviceMap.get(row.device_id);
      if (!group) {
        continue;
      }
      group.active_users.push({
        user_id: row.user_id,
        full_name: (row.profiles as unknown as { full_name?: string | null } | null)?.full_name || 'Staff User',
        email: '',
      });
    }
  }

  return new Response(JSON.stringify({ devices: Array.from(deviceMap.values()) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = manageDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_manage_device', {
    p_device_id: parsed.data.deviceId,
    p_action: parsed.data.action,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
