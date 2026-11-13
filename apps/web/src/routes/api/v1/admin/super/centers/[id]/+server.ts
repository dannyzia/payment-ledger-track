import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Database, Json } from '$lib/database.types';

const updateCenterSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'archived']).optional(),
    name: z.string().min(1).optional(),
    legalEntityName: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    binNumber: z.string().max(16).nullable().optional(),
    tradeLicense: z.string().max(32).nullable().optional(),
    ownerEmail: z.string().email().optional(),
    ownerName: z.string().min(1).optional(),
    ownerPassword: z.string().min(8, 'Password must be at least 8 characters').optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/v1/admin/super/centers/[id]
 * Updates a center's status or profile fields. `code` is immutable
 * (trg_centers_immutable_code), so it is not accepted here.
 */
export const PATCH: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);

  const centerId = event.params.id ?? '';
  if (!UUID_RE.test(centerId)) {
    return new Response(JSON.stringify({ error: 'invalid_center_id' }), { status: 400 });
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

  const parsed = updateCenterSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  const supabase = getServiceSupabase();
  const { data: before, error: fetchError } = await supabase
    .from('centers')
    .select('*')
    .eq('id', centerId)
    .single();
  if (fetchError || !before) {
    return new Response(JSON.stringify({ error: 'center_not_found' }), { status: 404 });
  }

  type CenterUpdate = Database['public']['Tables']['centers']['Update'];
  const patch: CenterUpdate = {};
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.legalEntityName !== undefined)
    patch.legal_entity_name = parsed.data.legalEntityName;
  if (parsed.data.address !== undefined) patch.address = parsed.data.address;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;
  if (parsed.data.binNumber !== undefined) patch.bin_number = parsed.data.binNumber;
  if (parsed.data.tradeLicense !== undefined) patch.trade_license_number = parsed.data.tradeLicense;

  let updatedCenter = before;
  if (Object.keys(patch).length > 0) {
    const { data: updated, error: updateError } = await supabase
      .from('centers')
      .update(patch)
      .eq('id', centerId)
      .select('*')
      .single();
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), { status: 422 });
    }
    updatedCenter = updated;

    await supabase.from('audit_log').insert({
      center_id: centerId,
      actor: caller.userId,
      action: 'center.update',
      target_table: 'centers',
      target_id: centerId,
      before: before as unknown as Json,
      after: updated as unknown as Json,
    });
  }

  // Update center owner (email and/or name) if requested
  let ownerUpdated = false;
  let ownerError: string | null = null;
  const newOwnerEmail = parsed.data.ownerEmail?.toLowerCase();
  const newOwnerName = parsed.data.ownerName?.trim();

  if (newOwnerEmail || newOwnerName) {
    try {
      const { data: currentOwnerProf } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('center_id', centerId)
        .eq('role', 'owner')
        .eq('active', true)
        .maybeSingle();

      if (currentOwnerProf) {
        const { data: authUserData } = await supabase.auth.admin.getUserById(currentOwnerProf.id);
        const currentEmail = authUserData?.user?.email?.toLowerCase();

        if (newOwnerEmail && newOwnerEmail !== currentEmail) {
          let matchedExistingUser: { id: string; user_metadata?: Record<string, unknown> } | null = null;
          let page = 1;
          for (;;) {
            const { data: listed } = await supabase.auth.admin.listUsers({ page, perPage: 50 });
            const match = (listed?.users ?? []).find((u) => u.email?.toLowerCase() === newOwnerEmail);
            if (match) {
              matchedExistingUser = match;
              break;
            }
            if ((listed?.users?.length ?? 0) < 50) break;
            page += 1;
          }

          if (!matchedExistingUser) {
            const { error: emailErr } = await supabase.auth.admin.updateUserById(currentOwnerProf.id, {
              email: newOwnerEmail,
              email_confirm: true,
              user_metadata: newOwnerName ? { full_name: newOwnerName } : undefined,
            });
            if (emailErr) throw emailErr;
          } else {
            // Reassign center ownership to existing user
            await supabase.from('profiles').update({ role: 'admin' }).eq('id', currentOwnerProf.id);
            await supabase.auth.admin.updateUserById(currentOwnerProf.id, {
              app_metadata: { role: 'admin', center_id: centerId },
            });
            await supabase.from('profiles').upsert({
              id: matchedExistingUser.id,
              center_id: centerId,
              role: 'owner',
              full_name: newOwnerName || (matchedExistingUser.user_metadata?.full_name as string) || 'Center Owner',
              active: true,
            });
            await supabase.auth.admin.updateUserById(matchedExistingUser.id, {
              app_metadata: { role: 'owner', center_id: centerId },
            });
          }

          await supabase.from('audit_log').insert({
            center_id: centerId,
            actor: caller.userId,
            action: 'center.owner_update',
            target_table: 'profiles',
            target_id: currentOwnerProf.id,
            before: { email: currentEmail, full_name: currentOwnerProf.full_name } as unknown as Json,
            after: { email: newOwnerEmail, full_name: newOwnerName || currentOwnerProf.full_name } as unknown as Json,
          });
          ownerUpdated = true;
        }

        if (newOwnerName && newOwnerName !== currentOwnerProf.full_name) {
          await supabase.from('profiles').update({ full_name: newOwnerName }).eq('id', currentOwnerProf.id);
          await supabase.auth.admin.updateUserById(currentOwnerProf.id, {
            user_metadata: { full_name: newOwnerName },
          });
          ownerUpdated = true;
        }
      } else if (newOwnerEmail) {
        // Center had no existing active owner
        const redirectTo = `${event.url.origin}/callback`;
        const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
          newOwnerEmail,
          {
            data: { full_name: newOwnerName || 'Center Owner' },
            redirectTo,
          },
        );
        if (inviteErr) throw inviteErr;
        if (invited?.user) {
          await supabase.auth.admin.updateUserById(invited.user.id, {
            app_metadata: { role: 'owner', center_id: centerId },
          });
          await supabase.from('profiles').upsert({
            id: invited.user.id,
            center_id: centerId,
            role: 'owner',
            full_name: newOwnerName || 'Center Owner',
            active: true,
          });
          ownerUpdated = true;
        }
      }
    } catch (e) {
      ownerError = e instanceof Error ? e.message : 'Owner update failed';
      if (!patch || Object.keys(patch).length === 0) {
        return new Response(JSON.stringify({ error: ownerError }), { status: 422 });
      }
    }
  }

  // Update center owner password if requested
  if (parsed.data.ownerPassword) {
    try {
      const { data: currentOwnerProf } = await supabase
        .from('profiles')
        .select('id')
        .eq('center_id', centerId)
        .eq('role', 'owner')
        .eq('active', true)
        .maybeSingle();

      if (currentOwnerProf) {
        const { error: passErr } = await supabase.auth.admin.updateUserById(currentOwnerProf.id, {
          password: parsed.data.ownerPassword,
        });
        if (passErr) throw passErr;

        await supabase.from('audit_log').insert({
          center_id: centerId,
          actor: caller.userId,
          action: 'center.owner_password_reset',
          target_table: 'profiles',
          target_id: currentOwnerProf.id,
          before: null,
          after: { reset_by: caller.userId, timestamp: new Date().toISOString() } as unknown as Json,
        });
        ownerUpdated = true;
      } else {
        throw new Error('No active owner profile found for this center to set password');
      }
    } catch (e) {
      ownerError = e instanceof Error ? e.message : 'Password update failed';
      if (!patch || Object.keys(patch).length === 0) {
        return new Response(JSON.stringify({ error: ownerError }), { status: 422 });
      }
    }
  }

  return new Response(
    JSON.stringify({ success: true, center: updatedCenter, ownerUpdated, ownerError }),
    { status: 200 },
  );
};
