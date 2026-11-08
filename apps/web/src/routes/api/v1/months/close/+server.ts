import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const closeSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
});

/**
 * POST /api/v1/months/close
 * Closes a calendar month via close_month under service_role. Owner-only.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', reason: 'Owner required to close month' }),
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

  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const supabase = getServiceSupabase();
  const rpcArgs = {
    p_month: parsed.data.month,
    p_actor_id: caller.userId,
  };
  const { error: rpcError } = await supabase.rpc(
    'close_month',
    rpcArgs as unknown as Database['public']['Functions']['close_month']['Args'],
  );

  if (rpcError) {
    let message = rpcError.message;
    if (rpcError.message.includes('stale_review_pending')) {
      message =
        'Cannot close month: one or more active entries have pending stale rate reviews (>৳50,000).';
    } else if (rpcError.message.includes('unreconciled_payables_exist')) {
      message =
        'Cannot close month: all monthly payables must be reconciled or marked zero-liability.';
    } else if (rpcError.message.includes('unapproved_overpaid_settlement')) {
      message =
        'Cannot close month: overpaid settlements require active Owner approval matching the exact surplus.';
    } else if (rpcError.message.includes('month_open')) {
      message = rpcError.message;
    }
    return new Response(JSON.stringify({ error: rpcError.message, message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
