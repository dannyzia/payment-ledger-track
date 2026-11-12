import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const transferSchema = z.object({
  newOwnerId: z.string().uuid(),
  confirmationPhrase: z.literal('TRANSFER OWNERSHIP'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'owner_only_operation' }), { status: 403 });
  }

  const centerId = caller.centerId;
  if (!centerId) {
    return new Response(JSON.stringify({ error: 'missing_center_id' }), { status: 400 });
  }

  const body = await event.request.json();
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_confirmation' }), { status: 400 });
  }

  // Prevent self-transfer deadlock
  if (parsed.data.newOwnerId === caller.userId) {
    return new Response(JSON.stringify({ error: 'cannot_transfer_to_self' }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('transfer_ownership', {
    p_center_id: centerId,
    p_new_owner_id: parsed.data.newOwnerId,
    p_caller_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  // Synchronize GoTrue app_metadata claims for both demoted and promoted owners
  await supabase.auth.admin.updateUserById(caller.userId, {
    app_metadata: { role: 'admin' },
  });
  await supabase.auth.admin.updateUserById(parsed.data.newOwnerId, {
    app_metadata: { role: 'owner' },
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
