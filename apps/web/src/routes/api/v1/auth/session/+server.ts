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

  let centerCode: string | null = null;
  let centerName: string | null = null;
  if (caller.centerId) {
    const { data: center } = await supabase
      .from('centers')
      .select('code, name')
      .eq('id', caller.centerId)
      .single();
    centerCode = center?.code ?? null;
    centerName = center?.name ?? null;
  }

  const defaultRoute =
    caller.role === 'super_admin'
      ? '/admin/super/centers'
      : caller.role === 'staff'
        ? '/entries/new'
        : '/dashboard';

  return new Response(
    JSON.stringify({
      userId: caller.userId,
      role: caller.role,
      active: caller.active,
      fullName: profile?.full_name,
      centerId: caller.centerId,
      centerCode,
      centerName,
      defaultRoute,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
