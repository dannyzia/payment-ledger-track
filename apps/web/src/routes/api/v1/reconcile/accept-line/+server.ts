import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database } from '$lib/database.types';

const acceptSchema = z.object({
  lineId: z.string().uuid(),
  reviewNote: z.string().min(1, 'Review note is mandatory to accept statement line into audit log'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner role required');
  }

  const centerId = caller.centerId;
  if (!centerId) {
    return json({ error: 'missing_center_id' }, { status: 400 });
  }

  const body = await event.request.json().catch(() => null);
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();

  const { error: rpcErr } = await supabase.rpc('accept_statement_line', {
    p_center_id: centerId,
    p_line_id: parsed.data.lineId,
    p_review_note: parsed.data.reviewNote,
    p_actor_id: caller.userId,
  } as unknown as Database['public']['Functions']['accept_statement_line']['Args']);

  if (rpcErr) {
    return json({ error: rpcErr.message }, { status: 422 });
  }

  return json({ success: true });
};
