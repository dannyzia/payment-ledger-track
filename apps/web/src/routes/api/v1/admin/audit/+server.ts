import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const table = event.url.searchParams.get('table');
  const action = event.url.searchParams.get('action');
  const actor = event.url.searchParams.get('actor');
  const startDate = event.url.searchParams.get('startDate');
  const endDate = event.url.searchParams.get('endDate');
  const limit = Math.min(
    100,
    Math.max(1, parseInt(event.url.searchParams.get('limit') || '50', 10)),
  );

  const supabase = getServiceSupabase();
  let query = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(limit);

  if (table) query = query.eq('target_table', table);
  if (action) query = query.ilike('action', `%${action}%`);
  if (actor) query = query.eq('actor', actor);
  if (startDate) query = query.gte('at', startDate);
  if (endDate) query = query.lte('at', endDate + 'T23:59:59.999Z');

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ events: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
