import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext, requireRole } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/admin/super/search
 * Global cross-center entry search for the Head Office.
 * Params: q (entry number, customer name, transaction ref, or gross amount in poisha),
 * centerId (optional center filter), limit (default 50, max 100).
 */
export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  requireRole(caller, ['super_admin']);

  const q = (event.url.searchParams.get('q') ?? '').trim();
  const centerIdParam = event.url.searchParams.get('centerId');
  const limit = Math.min(
    100,
    Math.max(1, parseInt(event.url.searchParams.get('limit') || '50', 10)),
  );

  if (centerIdParam && !UUID_RE.test(centerIdParam)) {
    return new Response(JSON.stringify({ error: 'invalid_center_id' }), { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Escape LIKE metacharacters so the query text is treated literally.
  const escaped = q.replace(/[%_\\]/g, (ch) => `\\${ch}`);
  const conditions: string[] = [];
  if (q) {
    conditions.push(`customer_name.ilike.%${escaped}%`);
    conditions.push(`txn_ref.ilike.%${escaped}%`);
    if (/^\d+$/.test(q)) {
      conditions.push(`entry_number.eq.${q}`);
      conditions.push(`gross_poisha.eq.${q}`);
    }
  }

  let query = supabase
    .from('entries')
    .select('*')
    .order('entry_date', { ascending: false })
    .limit(limit);
  if (centerIdParam) query = query.eq('center_id', centerIdParam);
  if (conditions.length > 0) query = query.or(conditions.join(','));

  const { data: entries, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Merge in center code/name and the payment method label for display.
  const centerIds = Array.from(new Set((entries ?? []).map((e) => e.center_id)));
  const methodIds = Array.from(new Set((entries ?? []).map((e) => e.method_id)));
  const [centersRes, methodsRes] = await Promise.all([
    centerIds.length > 0
      ? supabase.from('centers').select('id, code, name').in('id', centerIds)
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    methodIds.length > 0
      ? supabase.from('payment_methods').select('id, code, name').in('id', methodIds)
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
  ]);
  const centerMap = new Map((centersRes.data ?? []).map((c) => [c.id, c]));
  const methodMap = new Map((methodsRes.data ?? []).map((m) => [m.id, m]));

  const results = (entries ?? []).map((e) => {
    const center = centerMap.get(e.center_id);
    const method = methodMap.get(e.method_id);
    const entryNumber = e.entry_number;
    const ym = e.entry_date ? e.entry_date.replace(/-/g, '').slice(0, 6) : '';
    return {
      ...e,
      centerCode: center?.code ?? null,
      centerName: center?.name ?? null,
      methodCode: method?.code ?? null,
      methodName: method?.name ?? null,
      entryId:
        center && entryNumber != null
          ? `E-${center.code}-${ym}-${String(entryNumber).padStart(6, '0')}`
          : null,
    };
  });

  return new Response(JSON.stringify({ entries: results }), { status: 200 });
};
