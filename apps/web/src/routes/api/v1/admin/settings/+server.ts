import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const updateSettingsSchema = z.object({
  net_label: z.string().min(1).max(100),
  reconcile_tolerance_poisha: z.number().int().min(0),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  // app_settings primary key is boolean true check (id) per PRD §7.1
  const { data, error } = await supabase
    .from('app_settings')
    .select('id, timezone, currency, locale, net_label, reconcile_tolerance_poisha, updated_at')
    .eq('id', true)
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ settings: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc('admin_update_settings', {
    p_settings: {
      net_label: parsed.data.net_label,
      reconcile_tolerance_poisha: parsed.data.reconcile_tolerance_poisha,
    },
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
