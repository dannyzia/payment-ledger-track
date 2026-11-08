import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const reopenSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  reason: z.string().min(1),
});

/**
 * POST /api/v1/months/reopen
 * Reopens a closed calendar month via reopen_month under service_role. Owner-only.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Owner required to reopen month' }),
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

  const parsed = reopenSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const supabase = getServiceSupabase();
  const rpcArgs = {
    p_month: parsed.data.month,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  };
  const { error: rpcError } = await supabase.rpc(
    'reopen_month',
    rpcArgs as unknown as Database['public']['Functions']['reopen_month']['Args'],
  );

  if (rpcError) {
    let message = rpcError.message;
    if (rpcError.message.includes('month_not_closed')) {
      message = 'Cannot reopen month: this month is not currently closed.';
    } else if (rpcError.message.includes('reason_required')) {
      message = 'A mandatory audit reason is required to reopen a closed month.';
    }
    return new Response(JSON.stringify({ error: rpcError.message, message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
