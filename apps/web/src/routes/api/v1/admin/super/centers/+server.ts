import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const createCenterSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{2,8}$/, 'Code must be 2-8 uppercase alphanumeric characters'),
  name: z.string().min(1, 'Center name is required'),
  legalEntityName: z.string().min(1, 'Legal entity name is required'),
  binNumber: z.string().max(16).optional().nullable(),
  tradeLicense: z.string().max(32).optional().nullable(),
  address: z.string().min(1, 'Address is required'),
  phone: z.string().min(1, 'Phone number is required'),
  ownerEmail: z.string().email('Valid owner email is required'),
  ownerName: z.string().min(1, 'Owner name is required'),
});

/**
 * GET /api/v1/admin/super/centers
 * Lists all franchise learning centers for the Head Office.
 */
export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);

  const status = event.url.searchParams.get('status');
  const supabase = getServiceSupabase();
  let query = supabase.from('centers').select('*').order('center_number', { ascending: true });
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ centers: data ?? [] }), { status: 200 });
};

/**
 * POST /api/v1/admin/super/centers
 * Provisions a new center atomically via rpc_create_center and syncs the owner's
 * GoTrue metadata (role 'owner', center_id) so RLS and the auth triggers agree.
 */
export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_json', message: 'Malformed JSON payload' }),
      { status: 400 },
    );
  }

  const parsed = createCenterSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  // p_bin_number / p_trade_license accept SQL NULL; the generated types omit the null
  // union (CLT-D-012).
  const NULL_TEXT = null as unknown as string;
  const supabase = getServiceSupabase();
  const { data: result, error: rpcError } = await supabase.rpc('rpc_create_center', {
    p_actor_id: caller.userId,
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_legal_entity_name: parsed.data.legalEntityName,
    p_bin_number: parsed.data.binNumber ?? NULL_TEXT,
    p_trade_license: parsed.data.tradeLicense ?? NULL_TEXT,
    p_address: parsed.data.address,
    p_phone: parsed.data.phone,
    p_owner_email: parsed.data.ownerEmail,
    p_owner_name: parsed.data.ownerName,
  });

  if (rpcError) {
    if (rpcError.message.includes('center_code_taken')) {
      return new Response(
        JSON.stringify({
          error: 'center_code_taken',
          message: 'A center with this code already exists.',
        }),
        { status: 409 },
      );
    }
    return new Response(JSON.stringify({ error: rpcError.message }), { status: 422 });
  }

  const centerId = (result as { center_id?: string } | null)?.center_id ?? null;
  let ownerProvisioned = false;
  let ownerError: string | null = null;

  const ownerEmail = parsed.data.ownerEmail.toLowerCase();
  try {
    if (!centerId) {
      ownerError = 'Center ID was not returned by rpc_create_center';
    } else {
      // GoTrue does not apply app_metadata from an invite payload, so invite first
      // (user_metadata only) and then set the role/center claims explicitly.
      let existingUser: { id: string } | null = null;
      let page = 1;
      for (;;) {
        const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
          page,
          perPage: 50,
        });
        if (listError) throw listError;
        const match = (listed?.users ?? []).find((u) => u.email?.toLowerCase() === ownerEmail);
        if (match) {
          existingUser = { id: match.id };
          break;
        }
        if ((listed?.users?.length ?? 0) < 50) break;
        page += 1;
      }

      if (!existingUser) {
        const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
          ownerEmail,
          { data: { full_name: parsed.data.ownerName } },
        );
        if (inviteError || !invited?.user) {
          throw new Error(inviteError?.message ?? 'Owner invite failed');
        }
        existingUser = { id: invited.user.id };
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(existingUser.id, {
        app_metadata: { role: 'owner', center_id: centerId },
      });
      if (updateError) throw updateError;
      ownerProvisioned = true;
    }
  } catch (e) {
    ownerError = e instanceof Error ? e.message : 'Owner provisioning failed';
  }

  return new Response(
    JSON.stringify({ success: true, center: result, ownerProvisioned, ownerError }),
    { status: 201 },
  );
};
