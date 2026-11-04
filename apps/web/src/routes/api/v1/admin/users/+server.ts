import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const manageUserSchema = z.object({
  targetUserId: z.string().uuid(),
  action: z.enum(['update_role', 'deactivate', 'reactivate']),
  newRole: z.enum(['staff', 'admin']).optional(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['admin', 'owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = manageUserSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { targetUserId, action, newRole } = parsed.data;
  const supabase = getServiceSupabase();

  if (caller.role === 'admin') {
    const { data: targetProf } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', targetUserId)
      .single();

    if (targetProf && targetProf.role !== 'staff') {
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'Admins may only manage Staff members.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update_role' && newRole !== 'staff') {
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'Admins cannot promote users to Admin.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const pActive = action === 'deactivate' ? false : (action === 'reactivate' ? true : null);

  // Postgres signatures: p_role/p_active default to NULL. The CLI-generated
  // types omit the null union, so carry the runtime-identical null through
  // typed locals instead of weakening the call (CLT-D-012).
  const NULL_TEXT = null as unknown as string;
  const NULL_BOOL = null as unknown as boolean;

  const { error: rpcErr } = await supabase.rpc('admin_manage_user', {
    p_action: action,
    p_user_id: targetUserId,
    p_role: action === 'update_role' ? newRole ?? NULL_TEXT : NULL_TEXT,
    p_active: pActive ?? NULL_BOOL,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (action === 'update_role' && newRole) {
    await supabase.auth.admin.updateUserById(targetUserId, {
      app_metadata: { role: newRole },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
