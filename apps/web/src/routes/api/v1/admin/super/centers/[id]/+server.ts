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

  const { data: updated, error: updateError } = await supabase
    .from('centers')
    .update(patch)
    .eq('id', centerId)
    .select('*')
    .single();
  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), { status: 422 });
  }

  await supabase.from('audit_log').insert({
    center_id: centerId,
    actor: caller.userId,
    action: 'center.update',
    target_table: 'centers',
    target_id: centerId,
    before: before as unknown as Json,
    after: updated as unknown as Json,
  });

  return new Response(JSON.stringify({ success: true, center: updated }), { status: 200 });
};
