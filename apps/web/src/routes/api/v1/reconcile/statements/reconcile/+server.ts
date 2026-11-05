import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const reconcileSchema = z.object({
  statementId: z.string().uuid(),
  note: z.string().optional(),
});

/**
 * POST /api/v1/reconcile/statements/reconcile
 * Reconciles a statement via reconcile_statement under service_role.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized', reason: 'Admin or Owner required' }), { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }), { status: 400 });
  }

  const parsed = reconcileSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const rpcArgs = {
    p_statement_id: parsed.data.statementId,
    p_note: parsed.data.note ?? '',
    p_actor_id: caller.userId,
  };
  const { error: rpcError } = await supabase.rpc('reconcile_statement', rpcArgs as unknown as Database['public']['Functions']['reconcile_statement']['Args']);

  if (rpcError) {
    let message = rpcError.message;
    if (rpcError.message.includes('variance_exceeds_tolerance')) {
      message = 'Statement variance exceeds tolerance; a justification note is required.';
    } else if (rpcError.message.includes('expected_poisha_mismatch')) {
      message = 'Expected liability has shifted; statement must be reviewed.';
    }
    return new Response(JSON.stringify({ error: rpcError.message, message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
