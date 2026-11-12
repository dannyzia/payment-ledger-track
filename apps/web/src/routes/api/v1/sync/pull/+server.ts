import type { RequestHandler } from '@sveltejs/kit';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import { getDbPool } from '$lib/server/db';
import { checkRateLimit, getSafeClientIp } from '$lib/server/ratelimit';

export const GET: RequestHandler = async (event) => {
  const clientIp = getSafeClientIp(event);

  // 1. Caller Authentication and Active Profile Check (PRD §9.1)
  const caller = await getCallerContext(event);
  if (!caller.active) {
    return new Response(JSON.stringify({ error: 'user_deactivated' }), { status: 403 });
  }

  const url = event.url;
  const sinceStr = url.searchParams.get('since');
  const includeMeta = url.searchParams.get('includeMeta') === 'true';
  const deviceId = url.searchParams.get('deviceId');

  // Tenant context (Hard Rule 9): the caller's verified center, falling back to the
  // requested center only for super_admin. Every query below is scoped by it.
  const effectiveCenterId = caller.centerId ?? url.searchParams.get('centerId');
  if (!effectiveCenterId && caller.role !== 'super_admin') {
    return new Response(JSON.stringify({ error: 'missing_center_id' }), { status: 400 });
  }
  if (
    effectiveCenterId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(effectiveCenterId)
  ) {
    return new Response(JSON.stringify({ error: 'invalid_center_id' }), { status: 400 });
  }

  // 2. Strict Query Parameters Validation
  if (!sinceStr) {
    return new Response(JSON.stringify({ error: 'missing_cursor' }), { status: 400 });
  }

  if (!/^\d+$/.test(sinceStr)) {
    return new Response(
      JSON.stringify({ error: 'invalid_cursor', message: 'since must be a non-negative integer' }),
      { status: 400 },
    );
  }

  if (!deviceId || deviceId === '00000000-0000-0000-0000-000000000000') {
    return new Response(
      JSON.stringify({
        error: 'missing_device_id',
        message: 'Valid non-nil deviceId UUID required',
      }),
      { status: 400 },
    );
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return new Response(JSON.stringify({ error: 'invalid_device_id' }), { status: 400 });
  }

  // 3. Rate Limiting Check (PRD §9.1: max 60 requests/minute per device/IP)
  const rateLimitKey = `${deviceId}:${clientIp}`;
  const rateLimit = checkRateLimit(rateLimitKey, 60, 60000);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'too_many_requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': rateLimit.retryAfter.toString(),
      },
    });
  }

  const supabase = getServiceSupabase();

  // 4. Device Revocation Check across multi-user shared devices (PRD §9.1, H3, M4, H5)
  let deviceQuery = supabase.from('devices').select('revoked').eq('device_id', deviceId);
  if (effectiveCenterId) deviceQuery = deviceQuery.eq('center_id', effectiveCenterId);
  const { data: deviceRows } = await deviceQuery;

  if (deviceRows && deviceRows.some((d) => d.revoked)) {
    return new Response(JSON.stringify({ error: 'device_revoked' }), { status: 403 });
  }

  // 5. Monotonic Watermark Calculation and Filtered Entries Extraction via SQL CTE
  const pool = getDbPool();

  // Check current server sequence to detect cursor ahead of server (HTTP 409).
  // A null center (super_admin requesting no tenant) means no tenant filter (design §4.4).
  const { rows: seqRows } = await pool.query(
    'select coalesce(max(server_seq), 0) as current_seq from entries where ($1::uuid is null or center_id = $1)',
    [effectiveCenterId],
  );
  const currentSeq = BigInt(seqRows[0]?.current_seq || '0');
  const sinceBigInt = BigInt(sinceStr);

  if (sinceBigInt > currentSeq) {
    return new Response(
      JSON.stringify({ error: 'cursor_past_watermark', currentSequence: currentSeq.toString() }),
      { status: 409 },
    );
  }

  const pullQuery = `
    with scanned as (
      select * from entries
      where ($4::uuid is null or center_id = $4) and server_seq > $1
      order by server_seq asc limit 200
    ),
    batch_meta as (
      select coalesce(max(server_seq), $1) as watermark,
             count(*) as scanned_count
      from scanned
    )
    select s.*, m.watermark, m.scanned_count
    from batch_meta m
    left join scanned s on ($2 in ('admin','owner','super_admin') or s.created_by = $3)
    order by s.server_seq asc nulls last;
  `;

  const { rows } = await pool.query(pullQuery, [
    sinceBigInt,
    caller.role,
    caller.userId,
    effectiveCenterId,
  ]);

  const watermark =
    rows.length > 0 && rows[0].watermark !== null ? rows[0].watermark.toString() : sinceStr;
  const scannedCount = rows.length > 0 ? Number(rows[0].scanned_count) : 0;
  const entries = rows.filter((r) => r.id !== null);
  const hasMore = scannedCount === 200;
  const nextCursor = watermark;

  let maxDeliveredRateVersion: number | null = null;
  const responsePayload: Record<string, unknown> = {
    entries,
    hasMore,
    nextCursor,
  };

  // 6. Metadata and Relational Configurations (Delivered when includeMeta === true or since === '0')
  // Every metadata query is scoped to the caller's center; the filter is omitted
  // only for a super_admin who has not selected a center (design §4.4).
  if (includeMeta || sinceStr === '0') {
    let rateProfilesQuery = supabase
      .from('rate_profiles')
      .select('*, method_rates(*)')
      .eq('status', 'published');
    if (effectiveCenterId) rateProfilesQuery = rateProfilesQuery.eq('center_id', effectiveCenterId);
    const { data: rawRateProfiles, error: rpErr } = await rateProfilesQuery;
    if (rpErr) throw rpErr;

    // Ordered by sort_order (PRD §7.1 DDL column)
    let methodsQuery = supabase.from('payment_methods').select('*').order('sort_order');
    if (effectiveCenterId) methodsQuery = methodsQuery.eq('center_id', effectiveCenterId);
    const { data: methods, error: mErr } = await methodsQuery;
    if (mErr) throw mErr;

    let payablesQuery = supabase.from('payables').select('*');
    if (effectiveCenterId) payablesQuery = payablesQuery.eq('center_id', effectiveCenterId);
    const { data: payables, error: pErr } = await payablesQuery;
    if (pErr) throw pErr;

    let monthClosesQuery = supabase.from('month_closes').select('*');
    if (effectiveCenterId) monthClosesQuery = monthClosesQuery.eq('center_id', effectiveCenterId);
    const { data: monthCloses, error: mcErr } = await monthClosesQuery;
    if (mcErr) throw mcErr;

    let settingsQuery = supabase.from('app_settings').select('*');
    if (effectiveCenterId) {
      settingsQuery = settingsQuery.eq('center_id', effectiveCenterId);
    } else {
      settingsQuery = settingsQuery.limit(1);
    }
    const { data: settingsRow, error: sErr } = await settingsQuery.maybeSingle();
    if (sErr) throw sErr;
    const settings = settingsRow ?? null;

    type RawRateProfile = {
      id: string;
      version: number;
      status: 'draft' | 'published';
      effective_from: string;
      vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
      vat_bp: number;
      commission_bp: number;
      commission_base: 'gross_minus_vat' | 'gross';
      charges_borne_by?: string | null;
      note?: string | null;
      method_rates?: Array<{ method_id: string; charge_bp: number }> | null;
    };
    type MappedRateProfile = {
      id: string;
      version: number;
      status: 'draft' | 'published';
      effective_from: string;
      vat_mode: string;
      vat_bp: number;
      commission_bp: number;
      commission_base: string;
      charges_borne_by: 'business' | 'customer';
      note?: string | null;
      method_rates: Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }>;
    };
    let rateProfiles: MappedRateProfile[] = [];
    if (rawRateProfiles && rawRateProfiles.length > 0) {
      maxDeliveredRateVersion = Math.max(
        ...(rawRateProfiles as RawRateProfile[]).map((p) => p.version),
      );

      // Transform method_rates array into dictionary map keyed by method_id
      rateProfiles = (rawRateProfiles as RawRateProfile[]).map((p) => {
        const methodRatesMap: Record<
          string,
          { fee_bp: number; charges_borne_by: 'business' | 'customer' }
        > = {};
        const profileChargesBorneBy: 'business' | 'customer' =
          p.charges_borne_by === 'customer' ? 'customer' : 'business';
        if (Array.isArray(p.method_rates)) {
          for (const mr of p.method_rates) {
            methodRatesMap[mr.method_id] = {
              fee_bp: mr.charge_bp, // Map Postgres charge_bp to fee_bp basis points
              charges_borne_by: profileChargesBorneBy,
            };
          }
        }
        return {
          id: p.id,
          version: p.version,
          status: p.status,
          effective_from: p.effective_from,
          vat_mode: p.vat_mode,
          vat_bp: p.vat_bp,
          commission_bp: p.commission_bp,
          commission_base: p.commission_base,
          charges_borne_by: profileChargesBorneBy,
          note: p.note,
          method_rates: methodRatesMap,
        };
      });
    }

    responsePayload.settings = settings;
    responsePayload.rateProfiles = rateProfiles;
    responsePayload.methods = methods;
    responsePayload.payables = payables;
    responsePayload.monthCloses = monthCloses;

    if (caller.role === 'admin' || caller.role === 'owner' || caller.role === 'super_admin') {
      let profilesQuery = supabase.from('profiles').select('id, full_name, role, active');
      if (effectiveCenterId) profilesQuery = profilesQuery.eq('center_id', effectiveCenterId);
      const { data: profiles, error: prErr } = await profilesQuery;
      if (prErr) throw prErr;
      let settlementsQuery = supabase.from('settlements').select('*');
      if (effectiveCenterId) settlementsQuery = settlementsQuery.eq('center_id', effectiveCenterId);
      const { data: settlements, error: setErr } = await settlementsQuery;
      if (setErr) throw setErr;
      let statementsQuery = supabase.from('statements').select('*');
      if (effectiveCenterId) statementsQuery = statementsQuery.eq('center_id', effectiveCenterId);
      const { data: statements, error: stErr } = await statementsQuery;
      if (stErr) throw stErr;
      // Which payables a statement covers lives in this join table; the client
      // needs it to decide whether a month is fully reconciled (E2E, 2026-11-07).
      let statementPayablesQuery = supabase
        .from('statement_payables')
        .select('statement_id, payable_id');
      if (effectiveCenterId) {
        statementPayablesQuery = statementPayablesQuery.eq('center_id', effectiveCenterId);
      }
      const { data: statementPayables, error: spErr } = await statementPayablesQuery;
      if (spErr) throw spErr;
      let rejectedOpsQuery = supabase
        .from('sync_ops')
        .select('*')
        .eq('resolution_status', 'pending');
      if (effectiveCenterId) rejectedOpsQuery = rejectedOpsQuery.eq('center_id', effectiveCenterId);
      const { data: rejectedOps, error: roErr } = await rejectedOpsQuery;
      if (roErr) throw roErr;

      responsePayload.profiles = profiles;
      responsePayload.settlements = settlements;
      responsePayload.statements = statements;
      responsePayload.statementPayables = statementPayables ?? [];
      responsePayload.rejectedOps = rejectedOps ?? [];
    } else {
      let rejectedOpsQuery = supabase
        .from('sync_ops')
        .select('*')
        .eq('actor_id', caller.userId)
        .eq('resolution_status', 'pending');
      if (effectiveCenterId) rejectedOpsQuery = rejectedOpsQuery.eq('center_id', effectiveCenterId);
      const { data: rejectedOps, error: roErr } = await rejectedOpsQuery;
      if (roErr) throw roErr;

      responsePayload.rejectedOps = rejectedOps ?? [];
    }
  }

  // 7. Update Device Sync State and Watermark Presence (PRD §7.3, H3, M4, H4).
  // Skipped when no center is selected (super_admin without a centerId), because the
  // device registry is keyed by (center_id, device_id, user_id).
  if (effectiveCenterId) {
    await supabase.rpc('upsert_device_sync_state', {
      p_center_id: effectiveCenterId,
      p_device_id: deviceId,
      p_user_id: caller.userId,
      p_rate_version: maxDeliveredRateVersion ?? undefined,
    });
  }

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
