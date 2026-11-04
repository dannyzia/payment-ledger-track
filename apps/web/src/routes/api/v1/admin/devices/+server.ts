import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const deviceSchema = z.object({
  deviceId: z.string().uuid().transform((s) => s.toLowerCase()),
  action: z.enum(['revoke', 'unrevoke']),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['admin', 'owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = deviceSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_manage_device', {
    p_device_id: parsed.data.deviceId,
    p_action: parsed.data.action,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
