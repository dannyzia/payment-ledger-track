import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const managePayableSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  kind: z.enum(['vat', 'method_charge']),
  method_id: z.string().uuid().nullable().optional(),
  due_day: z.number().int().min(1).max(28),
  remind_days_before: z.number().int().min(0).max(14).default(3),
  active: z.boolean(),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('payables')
    .select('*, payment_methods(name)')
    .order('created_at', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const payables = (data || []).map(
    (row: { payment_methods?: { name: string | null } | null }) => ({
      ...row,
      method_name: row.payment_methods?.name ?? null,
    }),
  );

  return new Response(JSON.stringify({ payables }), {
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
  const parsed = managePayableSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const action = parsed.data.id ? 'update' : 'create';
  const supabase = getServiceSupabase();
  // p_id/p_method_id default to NULL; CLI-generated types omit the null union (CLT-D-012).
  const NULL_TEXT = null as unknown as string;
  const { data, error } = await supabase.rpc('admin_manage_payable', {
    p_action: action,
    p_id: parsed.data.id ?? NULL_TEXT,
    p_kind: parsed.data.kind,
    p_method_id: parsed.data.kind === 'vat' ? NULL_TEXT : (parsed.data.method_id ?? NULL_TEXT),
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_due_day: parsed.data.due_day,
    p_remind_days_before: parsed.data.remind_days_before,
    p_active: parsed.data.active,
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, payableId: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
