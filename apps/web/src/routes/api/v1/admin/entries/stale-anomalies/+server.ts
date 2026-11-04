import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('view_device_stale_rate_anomalies')
    .select('*')
    .order('stale_ops_last_hour', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ anomalies: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
