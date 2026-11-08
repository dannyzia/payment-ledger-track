import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);

  const supabase = getServiceSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', caller.userId)
    .single();

  const defaultRoute = caller.role === 'staff' ? '/entries/new' : '/dashboard';

  return new Response(
    JSON.stringify({
      userId: caller.userId,
      role: caller.role,
      active: caller.active,
      fullName: profile?.full_name,
      defaultRoute,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
