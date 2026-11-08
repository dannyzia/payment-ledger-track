import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 403 });
  }

  const supabase = getServiceSupabase();

  // Query entries table (PRD §7.1: columns gross_poisha, vat_poisha, net_poisha; version is derived from snapshot)
  const { data, error } = await supabase
    .from('entries')
    .select(
      'id, entry_number, entry_date, gross_poisha, vat_poisha, net_poisha, device_id, snapshot, created_at',
    )
    .eq('stale_rates', true)
    .eq('stale_review_status', 'flagged')
    .order('created_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const entries = (data || []).map((row) => {
    // snapshot is Json-typed; hoist the version field (PRD §7.3: snapshot JSONB stores gw version)
    const snap = row.snapshot as unknown as { version?: string | number } | null;
    return {
      id: row.id,
      entry_number: row.entry_number,
      entry_date: row.entry_date,
      gross_amount: String(row.gross_poisha),
      vat_amount: String(row.vat_poisha),
      net_amount: String(row.net_poisha),
      device_id: row.device_id,
      rate_profile_version: snap?.version ?? 1,
      created_at: row.created_at,
    };
  });

  return new Response(JSON.stringify({ entries }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
