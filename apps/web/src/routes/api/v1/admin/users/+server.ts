import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const userManageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_role'),
    userId: z.string().uuid(),
    role: z.enum(['staff', 'admin']),
  }),
  z.object({
    action: z.literal('deactivate'),
    userId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('reactivate'),
    userId: z.string().uuid(),
  }),
]);

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();

  // Query profiles (columns per PRD §7.1: id, role, full_name, active, created_at, updated_at)
  const { data: profileList, error: pErr } = await supabase
    .from('profiles')
    .select('id, role, full_name, active, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  }

  // Merge auth emails via Supabase Admin API
  const { data: authData, error: aErr } = await supabase.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  if (!aErr && authData?.users) {
    for (const u of authData.users) {
      if (u.email) emailMap.set(u.id, u.email);
    }
  }

  const userRoster = (profileList || []).map((p) => ({
    id: p.id,
    display_name: p.full_name,
    email: emailMap.get(p.id) || '',
    role: p.role,
    active: p.active,
    created_at: p.created_at,
  }));

  return new Response(JSON.stringify({ users: userRoster, callerRole: caller.role }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = userManageSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const supabase = getServiceSupabase();

  let targetRole = 'staff';
  let targetActive = true;

  if (parsed.data.action === 'update_role') {
    targetRole = parsed.data.role;
    targetActive = true;
  } else if (parsed.data.action === 'deactivate') {
    targetActive = false;
  } else if (parsed.data.action === 'reactivate') {
    targetActive = true;
  }

  const { error } = await supabase.rpc('admin_manage_user', {
    p_action: parsed.data.action,
    p_user_id: parsed.data.userId,
    p_role: targetRole,
    p_active: targetActive,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  // Synchronize GoTrue app_metadata claims so Supabase RLS reflects role immediately upon token refresh
  if (parsed.data.action === 'update_role') {
    await supabase.auth.admin.updateUserById(parsed.data.userId, {
      app_metadata: { role: targetRole },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
