import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const methodRateItemSchema = z.object({
  payment_method_id: z.string().uuid(),
  fee_bp: z.number().int().min(0).max(10000),
  charges_borne_by: z.enum(['business', 'customer']).default('business'),
});

const draftRateSchema = z.object({
  draftId: z.string().uuid().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vat: z.object({
    mode: z.enum(['manual', 'percent_of_gross', 'percent_inclusive']),
    rateBp: z.number().int().min(0).max(10000).optional(),
  }),
  commission: z.object({
    rateBp: z.number().int().min(0).max(10000),
    base: z.enum(['gross_minus_vat', 'gross']),
  }),
  methodRates: z.array(methodRateItemSchema).min(1),
  note: z.string().optional(),
});

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();

  // Load published profile with joined method details
  const { data: publishedRows } = await supabase
    .from('rate_profiles')
    .select('*, method_rates(*, payment_methods(id, code, name))')
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1);

  // Load latest draft profile if any
  const { data: draftRows } = await supabase
    .from('rate_profiles')
    .select('*, method_rates(*, payment_methods(id, code, name))')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  type ProfileRow = {
    id: string;
    version: number | null;
    effective_from: string;
    vat_mode: string;
    vat_bp: number;
    commission_base: string;
    commission_bp: number;
    note?: string | null;
    method_rates?: Array<{
      method_id: string;
      charge_bp: number;
      payment_methods?: { code: string; name: string } | null;
    }>;
    charges_borne_by?: string;
  };
  const formatProfile = (p: ProfileRow | null | undefined) => {
    if (!p) return null;
    return {
      id: p.id,
      version: p.version,
      effective_from: p.effective_from,
      vat_mode: p.vat_mode,
      vat_bp: p.vat_bp,
      commission_base: p.commission_base,
      commission_bp: p.commission_bp,
      note: p.note ?? null,
      method_rates: (p.method_rates || []).map((mr) => ({
        payment_method_id: mr.method_id,
        code: mr.payment_methods?.code ?? '',
        name: mr.payment_methods?.name ?? '',
        fee_bp: mr.charge_bp,
        charges_borne_by: p.charges_borne_by ?? 'business',
      })),
    };
  };

  return new Response(
    JSON.stringify({
      published: formatProfile(publishedRows?.[0]),
      draft: formatProfile(draftRows?.[0]),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const body = await event.request.json();
  const parsed = draftRateSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_payload', issues: parsed.error.issues }), {
      status: 400,
    });
  }

  // 100% deduction upper-bound check
  const vatBp = parsed.data.vat.mode === 'manual' ? 0 : (parsed.data.vat.rateBp ?? 0);
  const maxCharge =
    parsed.data.methodRates.length > 0
      ? Math.max(0, ...parsed.data.methodRates.map((m) => m.fee_bp))
      : 0;

  if (vatBp + parsed.data.commission.rateBp + maxCharge > 10000) {
    return new Response(
      JSON.stringify({
        error: 'deductions_exceed_100_percent',
        message:
          'Sum of VAT, commission, and maximum method charge exceeds 10,000 basis points (100%).',
      }),
      { status: 422 },
    );
  }

  const supabase = getServiceSupabase();
  // p_profile_id defaults to NULL (create); CLI-generated types omit the null union (CLT-D-012).
  const NULL_TEXT = null as unknown as string;
  const { data, error } = await supabase.rpc('create_or_update_draft_rate_profile', {
    p_profile_id: parsed.data.draftId ?? NULL_TEXT,
    p_effective_from: parsed.data.effectiveFrom,
    p_vat_mode: parsed.data.vat.mode,
    p_vat_bp: parsed.data.vat.rateBp ?? 0,
    p_commission_base: parsed.data.commission.base,
    p_commission_bp: parsed.data.commission.rateBp,
    p_method_rates: parsed.data.methodRates.map((mr) => ({
      method_id: mr.payment_method_id,
      charge_bp: mr.fee_bp,
    })),
    p_actor_id: caller.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 422 });
  }

  return new Response(JSON.stringify({ success: true, profileId: data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
