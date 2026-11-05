import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const approvalSchema = z.object({
  settlementId: z.string().uuid(),
  reason: z.string().min(1, 'Approval reason is mandatory'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Owner role required to authorize overpayments' }), { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }), { status: 400 });
  }

  const parsed = approvalSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('approve_settlement_overpayment', {
    p_settlement_id: parsed.data.settlementId,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
