import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const exceptionSchema = z.object({
  entryId: z.string().uuid(),
  payableId: z.string().uuid(),
  action: z.enum(['approved', 'rejected']),
  reason: z.string().min(1),
});

/**
 * POST /api/v1/reconcile/exceptions
 * Reviews an entry reconciliation exception via review_entry_reconciliation_exception under service_role.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }),
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }),
      { status: 400 },
    );
  }

  const parsed = exceptionSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const supabase = getServiceSupabase();
  const rpcArgs = {
    p_entry_id: parsed.data.entryId,
    p_payable_id: parsed.data.payableId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  };
  const { error: rpcError } = await supabase.rpc(
    'review_entry_reconciliation_exception',
    rpcArgs as unknown as Database['public']['Functions']['review_entry_reconciliation_exception']['Args'],
  );

  if (rpcError) {
    return new Response(JSON.stringify({ error: rpcError.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
