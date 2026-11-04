import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const transferSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { newOwnerUserId } = parsed.data;

  if (newOwnerUserId === caller.userId) {
    return new Response(JSON.stringify({ error: 'cannot_transfer_to_self', message: 'Cannot transfer ownership to yourself.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = getServiceSupabase();

  const { error } = await supabase.rpc('transfer_ownership', {
    p_new_owner_id: newOwnerUserId,
    p_caller_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Synchronize app_metadata for both parties
  await supabase.auth.admin.updateUserById(caller.userId, {
    app_metadata: { role: 'admin' },
  });
  await supabase.auth.admin.updateUserById(newOwnerUserId, {
    app_metadata: { role: 'owner' },
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
