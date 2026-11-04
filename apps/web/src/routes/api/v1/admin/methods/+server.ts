import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const manageMethodSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  active: z.boolean(),
  requires_txn_ref: z.boolean(),
  sort_order: z.number().int().min(0).default(0),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ methods: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = manageMethodSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const action = parsed.data.id ? 'update' : 'create';
  const supabase = getServiceSupabase();
  // p_id defaults to NULL; the CLI-generated types omit the null union (CLT-D-012).
  const NULL_TEXT = null as unknown as string;
  const { data, error } = await supabase.rpc('admin_manage_payment_method', {
    p_action: action,
    p_id: parsed.data.id ?? NULL_TEXT,
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_sort_order: parsed.data.sort_order,
    p_active: parsed.data.active,
    p_requires_txn_ref: parsed.data.requires_txn_ref,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, methodId: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
