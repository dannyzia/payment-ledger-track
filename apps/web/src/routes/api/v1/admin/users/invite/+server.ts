import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['staff', 'admin', 'owner']),
  fullName: z.string().trim().min(1, 'Full name is required'),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['admin', 'owner']);

  const body = await event.request.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email, role, fullName } = parsed.data;

  // PRD §16.2 Test #59: Owner role cannot be invited; single owner enforced via ownership transfer
  if (role === 'owner') {
    return new Response(
      JSON.stringify({ error: 'cannot_invite_owner', message: 'Owner cannot be invited. Use ownership transfer.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // PRD §3: Admins may only invite Staff members
  if (caller.role === 'admin' && role !== 'staff') {
    return new Response(
      JSON.stringify({ error: 'unauthorized', message: 'Admins may only invite Staff members.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = getServiceSupabase();

  // Execute database procedure handling role authorization, deactivated account checks, and audit logging
  const { error: rpcErr } = await supabase.rpc('admin_invite_user', {
    p_email: email.toLowerCase(),
    p_role: role,
    p_full_name: fullName,
    p_actor_id: caller.userId,
  });

  if (rpcErr) {
    if (rpcErr.message.includes('409') || rpcErr.message.includes('user_already_exists')) {
      return new Response(
        JSON.stringify({ error: 'user_already_exists', message: 'User is already active.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (rpcErr.message.includes('403')) {
      return new Response(
        JSON.stringify({ error: 'unauthorized', message: rpcErr.message }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Provision Supabase Auth User with raw_app_meta_data (PRD §3, §7.3, Hard Rule 7)
  const redirectTo = `${event.url.origin}/callback`;
  const { data: authData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email.toLowerCase(), {
    data: { full_name: fullName },
    redirectTo,
  });

  if (inviteErr) {
    // If user already exists in auth.users (reactivation flow), synchronize metadata directly
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const matched = existingUser?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (matched) {
      await supabase.auth.admin.updateUserById(matched.id, {
        app_metadata: { role, full_name: fullName },
      });
      return new Response(
        JSON.stringify({ success: true, userId: matched.id, reactivated: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: inviteErr.message }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (authData.user) {
    await supabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { role, full_name: fullName },
    });
  }

  return new Response(
    JSON.stringify({ success: true, userId: authData.user?.id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
