import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';
import type { Json } from '$lib/database.types';
import { checkRateLimit, getSafeClientIp } from '$lib/server/ratelimit';
import { computeJcsSha256 } from '$lib/sync/canonical';
import { calculateEntry, type RateSnapshot } from '@clt/calc';

const pushOpSchema = z.object({
  opId: z.string().uuid(),
  type: z.enum([
    'create_entry',
    'request_void',
    'void_entry',
    'supersede_entry',
    'discard_rejected_entry',
  ]),
  payload: z.record(z.string(), z.unknown()),
  clientCreatedAt: z.string(),
  payloadHash: z.string().optional(),
  supersedesRejectedOpId: z.string().uuid().optional(),
  maxKnownRateVersion: z.number().int().min(1).optional(),
});

const pushRequestSchema = z.object({
  deviceId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    .refine((id) => id !== '00000000-0000-0000-0000-000000000000', {
      message: 'Nil UUID not allowed',
    }),
  ops: z.array(pushOpSchema),
});

export const POST: RequestHandler = async (event) => {
  const clientIp = getSafeClientIp(event);

  // 1. Caller Authentication and Active Account Verification (PRD §9.1 Step 1 & 2)
  const caller = await getCallerContext(event);
  if (!caller.active) {
    return new Response(JSON.stringify({ error: 'user_deactivated' }), { status: 403 });
  }

  const rawBody = await event.request.json().catch(() => null);
  if (!rawBody) {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
  }

  // Tenant context (Hard Rule 9): the caller's verified center, falling back to the
  // body-declared center only for callers without one (super_admin). The resolved
  // center is used for every query and the p_center_id RPC argument below.
  const effectiveCenterId: string | null =
    caller.centerId ?? ((rawBody as { centerId?: unknown }).centerId as string | undefined) ?? null;
  if (!effectiveCenterId) {
    return new Response(JSON.stringify({ error: 'missing_tenant_context' }), { status: 400 });
  }

  // Tenant IDOR protection: an op payload that names a different center is rejected.
  for (const op of (rawBody.ops as Array<{ payload?: Record<string, unknown> }> | undefined) ??
    []) {
    const candidates: unknown[] = [op.payload?.centerId];
    const replacement = op.payload?.replacement;
    if (replacement && typeof replacement === 'object') {
      candidates.push((replacement as Record<string, unknown>).centerId);
    }
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate !== effectiveCenterId) {
        return new Response(JSON.stringify({ error: 'forbidden_tenant_mismatch' }), {
          status: 403,
        });
      }
    }
  }

  // 2. Batch Size Limit Check (PRD §9.1: max 50 ops per request; HTTP 413)
  if (Array.isArray(rawBody.ops) && rawBody.ops.length > 50) {
    return new Response(
      JSON.stringify({
        error: 'payload_too_large',
        message: 'Batch exceeds maximum 50 operations limit',
      }),
      {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const parsed = pushRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const isDeviceIdError = parsed.error.issues.some((i) => i.path.includes('deviceId'));
    const errorCode = isDeviceIdError ? 'missing_device_id' : 'invalid_payload';
    return new Response(JSON.stringify({ error: errorCode, issues: parsed.error.issues }), {
      status: 400,
    });
  }

  // 3. Rate Limiting Check (PRD §9.1: max 60 requests/minute per device/IP)
  const rateLimitKey = `${parsed.data.deviceId}:${clientIp}`;
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

  // 4. Check Hardware Killswitch across shared counter devices (PRD §9.1 Step 3, H3, M4)
  const { data: deviceRows } = await supabase
    .from('devices')
    .select('revoked')
    .eq('device_id', parsed.data.deviceId)
    .eq('center_id', effectiveCenterId);

  if (deviceRows && deviceRows.some((d) => d.revoked)) {
    return new Response(JSON.stringify({ error: 'device_revoked' }), { status: 403 });
  }

  // 5. Authoritative Snapshot Verification & SvelteKit Recomputation (PRD Hard Rule 3, Rule 9, §6.5, §9.1 Step 4)
  type PushResultRow = {
    opId: string;
    status: 'ok' | 'duplicate' | 'rejected';
    reason?: string;
    server_seq?: string | number;
    entry_number?: string | number;
  };
  const results: PushResultRow[] = [];
  const validOpsForRpc: Array<
    z.infer<typeof pushOpSchema> & { serverHash: string; stale_rates?: boolean }
  > = [];

  for (const op of parsed.data.ops) {
    // Watermark check per-op with fault isolation (Test #60)
    if (!op.maxKnownRateVersion) {
      await supabase.from('sync_ops').insert({
        op_id: op.opId,
        center_id: effectiveCenterId,
        actor_id: caller.userId,
        device_id: parsed.data.deviceId,
        op_type: op.type,
        entry_id: (op.payload.entryId as string) || null,
        payload: op.payload as unknown as Json,
        payload_hash: '',
        client_created_at: op.clientCreatedAt,
        supersedes_rejected_op_id: op.supersedesRejectedOpId || null,
        result: 'rejected',
        resolution_status: 'pending',
        reason: 'missing_rate_watermark',
      });

      results.push({
        opId: op.opId,
        status: 'rejected',
        reason: 'missing_rate_watermark',
      });
      continue;
    }

    const canonical = {
      type: op.type,
      payload: op.payload as unknown as Json,
      supersedesRejectedOpId: op.supersedesRejectedOpId ?? null,
      clientCreatedAt: op.clientCreatedAt,
      maxKnownRateVersion: op.maxKnownRateVersion,
    };
    const serverHash = await computeJcsSha256(canonical);

    // Validate calculations for create_entry and supersede_entry operations
    if (op.type === 'create_entry' || op.type === 'supersede_entry') {
      const payload =
        op.type === 'create_entry'
          ? (op.payload as Record<string, unknown>)
          : ((op.payload.replacement as Record<string, unknown>) ?? {});

      const entryDate = payload.entryDate as string | undefined;
      const grossStr = payload.grossPoisha as string | undefined;
      const methodId = payload.methodId as string | undefined;
      const clientSnapshot = payload.snapshot as RateSnapshot | undefined;

      if (!entryDate || !grossStr || !methodId || !clientSnapshot) {
        results.push({ opId: op.opId, status: 'rejected', reason: 'invalid_payload' });
        continue;
      }

      // Query published rate profile effective on entryDate (PRD §7.1: latest published with effective_from <= entryDate)
      const { data: profileRows } = await supabase
        .from('rate_profiles')
        .select('*, method_rates(*)')
        .eq('center_id', effectiveCenterId)
        .eq('status', 'published')
        .lte('effective_from', entryDate)
        .order('effective_from', { ascending: false })
        .order('version', { ascending: false })
        .limit(1);

      const effectiveProfile = profileRows && profileRows.length > 0 ? profileRows[0] : null;
      if (!effectiveProfile) {
        results.push({ opId: op.opId, status: 'rejected', reason: 'no_rate_profile_for_date' });
        continue;
      }

      // Find applicable method rate
      const methodRateRow = (
        effectiveProfile.method_rates as
          Array<{ method_id: string; charge_bp: number }> | null | undefined
      )?.find((mr) => mr.method_id === methodId);
      const effectiveChargeBp = methodRateRow ? methodRateRow.charge_bp : 0;
      const effectiveChargesBorneBy = effectiveProfile.charges_borne_by || 'business';

      // Compare client snapshot rates against published profile
      const rateMismatch =
        clientSnapshot.vat?.mode !== effectiveProfile.vat_mode ||
        clientSnapshot.vat?.bp !== effectiveProfile.vat_bp ||
        clientSnapshot.commission?.bp !== effectiveProfile.commission_bp ||
        clientSnapshot.commission?.base !== effectiveProfile.commission_base ||
        clientSnapshot.chargeBp !== effectiveChargeBp ||
        clientSnapshot.chargesBorneBy !== effectiveChargesBorneBy;

      let isStaleRate = false;
      if (rateMismatch) {
        if (op.maxKnownRateVersion >= (effectiveProfile.version ?? 0)) {
          // Client cherry-picked an old profile: reject (PRD §9.1(e))
          results.push({ opId: op.opId, status: 'rejected', reason: 'rate_profile_date_mismatch' });
          continue;
        } else {
          // Legitimate offline stale rate: accept arithmetic, flag stale_rates = true (Hard Rule 4)
          isStaleRate = true;
        }
      }

      try {
        const grossPoisha = BigInt(grossStr);
        const vatInputPoisha = payload.vatInputPoisha
          ? BigInt(payload.vatInputPoisha as string)
          : undefined;
        const vatOverridePoisha = payload.vatOverridePoisha
          ? BigInt(payload.vatOverridePoisha as string)
          : undefined;
        const vatOverrideReason =
          (payload.vatOverrideReason as string) ||
          (vatOverridePoisha !== undefined ? 'Admin override' : undefined);
        const commissionOverridePoisha = payload.commissionOverridePoisha
          ? BigInt(payload.commissionOverridePoisha as string)
          : undefined;
        const commissionOverrideReason =
          (payload.commissionOverrideReason as string) ||
          (commissionOverridePoisha !== undefined ? 'Admin override' : undefined);

        // Authoritative re-computation using @clt/calc
        const calcResult = calculateEntry({
          grossPoisha,
          snapshot: clientSnapshot,
          vatInputPoisha,
          vatOverridePoisha,
          vatOverrideReason,
          commissionOverridePoisha,
          commissionOverrideReason,
        });

        // Verify calculated components
        const vatMismatch =
          payload.vatPoisha !== undefined && payload.vatPoisha !== calcResult.vatPoisha.toString();
        const commMismatch =
          payload.commissionPoisha !== undefined &&
          payload.commissionPoisha !== calcResult.commissionPoisha.toString();
        const busMismatch =
          payload.businessChargePoisha !== undefined &&
          payload.businessChargePoisha !== calcResult.businessChargePoisha.toString();
        const custMismatch =
          payload.customerChargePoisha !== undefined &&
          payload.customerChargePoisha !== calcResult.customerChargePoisha.toString();
        const clientNet = (payload.netPoisha ?? payload.netAfterDeductionsPoisha) as
          string | undefined;
        const netMismatch =
          clientNet !== undefined && clientNet !== calcResult.netAfterDeductionsPoisha.toString();

        if (vatMismatch || commMismatch || busMismatch || custMismatch || netMismatch) {
          throw new Error('Component mismatch');
        }
      } catch {
        await supabase.from('sync_ops').insert({
          op_id: op.opId,
          center_id: effectiveCenterId,
          actor_id: caller.userId,
          device_id: parsed.data.deviceId,
          op_type: op.type,
          entry_id: (payload.entryId as string) || null,
          payload: op.payload as unknown as Json,
          payload_hash: serverHash,
          client_created_at: op.clientCreatedAt,
          supersedes_rejected_op_id: op.supersedesRejectedOpId || null,
          result: 'rejected',
          resolution_status: 'pending',
          reason: 'calc_mismatch',
        });

        await supabase.from('audit_log').insert({
          center_id: effectiveCenterId,
          actor: caller.userId,
          action: 'sync.calc_mismatch',
          target_table: 'sync_ops',
          target_id: op.opId,
          before: null,
          after: { reason: 'calc_mismatch', payload: op.payload as unknown as Json },
        });

        results.push({ opId: op.opId, status: 'rejected', reason: 'calc_mismatch' });
        continue;
      }

      validOpsForRpc.push({
        ...op,
        serverHash,
        stale_rates: isStaleRate,
      });
      continue;
    }

    validOpsForRpc.push({
      ...op,
      serverHash,
    });
  }

  // 6. Execute Database RPC for Valid Operations (PRD §9.1 Step 5 & 6)
  if (validOpsForRpc.length > 0) {
    const { data: rpcResults, error } = await supabase.rpc('rpc_push_sync_op', {
      p_center_id: effectiveCenterId,
      p_device_id: parsed.data.deviceId,
      p_caller_id: caller.userId,
      p_caller_role: caller.role,
      p_ops: validOpsForRpc as unknown as Json,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const rawResults = Array.isArray(rpcResults)
      ? rpcResults
      : ((rpcResults as unknown as { results?: PushResultRow[] } | null)?.results ?? []);
    if (Array.isArray(rawResults)) {
      results.push(...(rawResults as PushResultRow[]));
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
