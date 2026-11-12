import {
  db,
  type LocalEntry,
  type CachedRateProfile,
  type CachedPaymentMethod,
  type CachedPayable,
  type CachedProfile,
  type CachedSettlement,
  type CachedStatement,
} from '$lib/db';
import { getOrGenerateDeviceId } from '$lib/auth/device';
import { supabase } from '$lib/supabase/client';
import { session } from '$lib/auth/session.svelte';
import { syncRunner } from './runner.svelte';
import {
  clearSuperCenterCache,
  clearSyncedEntries,
  pruneReplacedMethods,
  pruneReplacedMonthCloses,
  pruneReplacedPayables,
  pruneReplacedProfiles,
  pruneReplacedRateProfiles,
  pruneReplacedSettlements,
  pruneReplacedStatements,
} from '$lib/db/prune';

let pullEpoch = 0;
let activePullAbort: AbortController | null = null;

/**
 * Invalidates any in-flight incremental pull (such as when a super_admin switches
 * active center context mid-pull) so stale responses cannot overwrite Dexie or `server_cursor`.
 */
export function invalidateInFlightPull(): void {
  pullEpoch++;
  if (activePullAbort) {
    activePullAbort.abort();
    activePullAbort = null;
  }
}

/**
 * Clears center-scoped cache tables and resets `server_cursor` to `'0'` when switching centers.
 */
export async function resetSuperCenterCache(): Promise<void> {
  invalidateInFlightPull();
  await clearSuperCenterCache(db);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('clt_server_cursor', '0');
  }
}

export interface PullResponseDto {
  entries: Array<{
    id: string;
    server_seq: string | number;
    entry_number?: string | number | null;
    entry_date: string;
    customer_name: string;
    sub_qty: number;
    sub_description?: string | null;
    method_id: string;
    gross_poisha: string | number;
    vat_poisha: string | number;
    commission_poisha: string | number;
    charge_poisha: string | number;
    business_charge_poisha: string | number;
    customer_charge_poisha: string | number;
    net_poisha: string | number;
    txn_ref?: string | null;
    notes?: string | null;
    status: 'active' | 'voided' | 'superseded';
    created_by: string;
    created_at: string;
    stale_rates: boolean;
    rate_profile_id: string;
    supersedes_id?: string | null;
    device_id?: string | null;
    snapshot?: Record<string, unknown> | null;
  }>;
  hasMore: boolean;
  nextCursor: string;
  settings?: Record<string, unknown>;
  rateProfiles?: Array<{
    id: string;
    version: number;
    status: 'draft' | 'published';
    effective_from: string;
    vat_mode: 'manual' | 'percent_of_gross' | 'percent_inclusive';
    vat_bp: number;
    commission_bp: number;
    commission_base: 'gross_minus_vat' | 'gross';
    charges_borne_by: 'business' | 'customer';
    note?: string | null;
    method_rates: Record<string, { fee_bp: number; charges_borne_by: 'business' | 'customer' }>;
  }>;
  methods?: Array<{
    id: string;
    code: string;
    name: string;
    requires_txn_ref: boolean;
    sort_order: number;
    active: boolean;
  }>;
  payables?: Array<{
    id: string;
    kind: 'vat' | 'method_charge';
    code?: string | null;
    method_id?: string | null;
    name: string;
    due_day: number;
    remind_days_before: number;
    active: boolean;
  }>;
  monthCloses?: Array<{
    month: string;
    status: 'open' | 'closed';
  }>;
  profiles?: Array<{
    id: string;
    full_name: string;
    role: 'staff' | 'admin' | 'owner';
    active: boolean;
  }>;
  settlements?: Array<{
    id: string;
    month: string;
    payable_id: string;
    expected_poisha?: string | number | null;
    paid_poisha?: string | number | null;
    variance_poisha?: string | number | null;
    status: CachedSettlement['status'];
    note?: string | null;
    overpayment_review_status?: string | null;
    overpayment_approved_amount_poisha?: string | number | null;
    overpayment_reason?: string | null;
    overpayment_approved_by?: string | null;
    overpayment_approved_at?: string | null;
  }>;
  statements?: Array<{
    id: string;
    month: string;
    kind: CachedStatement['kind'];
    source: CachedStatement['source'];
    status: CachedStatement['status'];
    statement_total_poisha?: string | number | null;
    expected_poisha?: string | number | null;
    variance_poisha?: string | number | null;
    // Payable linkage decides whether a month is fully reconciled, so it has to
    // survive the pull (E2E, 2026-11-07); it lives in statement_payables.
    payable_id?: string | null;
    note?: string | null;
    reconciled_at?: string | null;
    reconciled_by?: string | null;
  }>;
  statementPayables?: Array<{ statement_id: string; payable_id: string }>;
  rejectedOps?: Array<{
    op_id: string;
    actor_id: string;
    device_id: string;
    op_type: string;
    entry_id?: string | null;
    payload: Record<string, unknown>;
    reason: string;
    resolution_status: 'pending' | 'resolved' | 'discarded';
    created_at: string;
  }>;
}

/**
 * Executes incremental cursor pull with metadata pagination bloat protection.
 * Handles HTTP error codes (401, 403, 409, 410, 429), normalizes schema columns,
 * transforms method rates into dictionary maps, and stores cursor with updated_at in db.meta.
 */
export async function executeIncrementalPull(): Promise<void> {
  const myEpoch = pullEpoch;
  const deviceId = getOrGenerateDeviceId();

  const metaCursorRow = await db.meta.get('server_cursor');
  const localCursor =
    typeof localStorage !== 'undefined' ? localStorage.getItem('clt_server_cursor') : null;
  let cursor = (metaCursorRow?.value as string) || localCursor || '0';

  let hasMore = true;
  let isFirstBatch = true;
  let watermarkResets = 0;

  const {
    data: { session: sbSession },
  } = await supabase.auth.getSession();
  let token = sbSession?.access_token;

  if (myEpoch !== pullEpoch) {
    return;
  }

  // Super-admin center switcher (CLT-T-074): pull only the selected center when
  // the Head Office narrowed its context. Franchise users always pull their own.
  let centerIdParam = '';
  if (session.user?.role === 'super_admin' && typeof sessionStorage !== 'undefined') {
    try {
      const activeCenter = sessionStorage.getItem('clt_super_center');
      if (activeCenter && activeCenter !== 'all') {
        centerIdParam = `&centerId=${activeCenter}`;
      }
    } catch {
      // Ignore storage errors
    }
  }

  while (hasMore) {
    if (myEpoch !== pullEpoch) {
      return;
    }

    const includeMeta = isFirstBatch;
    const url = `/api/v1/sync/pull?since=${cursor}&includeMeta=${includeMeta}&deviceId=${deviceId}${centerIdParam}`;

    const controller = new AbortController();
    activePullAbort = controller;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (
        controller.signal.aborted ||
        myEpoch !== pullEpoch ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
      // Network drop: throw to let caller update status to offline
      throw new Error('network_offline');
    } finally {
      if (activePullAbort === controller) {
        activePullAbort = null;
      }
    }

    if (myEpoch !== pullEpoch) {
      return;
    }

    if (!res.ok) {
      if (res.status === 401) {
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.data.session) {
          token = refreshed.data.session.access_token;
          continue;
        }
        throw new Error('auth_session_expired');
      }

      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        if (err.error === 'device_revoked') {
          syncRunner.stop();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('clt:device-revoked'));
          }
          throw new Error('device_revoked');
        }
        throw new Error('user_forbidden');
      }

      if (res.status === 409 || res.status === 410) {
        if (watermarkResets >= 2) {
          throw new Error(`pull_failed_http_${res.status}`);
        }
        watermarkResets++;
        // Cursor past watermark (e.g., DB reset) or sync gap exceeded (>90d ops purged):
        // clear stale synced rows, reset cursor to '0', force metadata re-fetch, and retry.
        await clearSyncedEntries(db);
        cursor = '0';
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('clt_server_cursor', '0');
        }
        await db.meta.put({
          key: 'server_cursor',
          value: '0',
          updated_at: new Date().toISOString(),
        });
        isFirstBatch = true;
        continue;
      }

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After') || '60';
        throw new Error(`rate_limit_exceeded:${retryAfter}`);
      }

      throw new Error(`pull_failed_http_${res.status}`);
    }

    const data: PullResponseDto = await res.json();
    if (myEpoch !== pullEpoch) {
      return;
    }

    // Ingest relational configuration and metadata on first batch only
    if (includeMeta) {
      if (Array.isArray(data.rateProfiles)) {
        const cachedProfiles: CachedRateProfile[] = data.rateProfiles.map((p) => ({
          id: p.id,
          version: p.version,
          status: p.status,
          effective_from: p.effective_from,
          vat_mode: p.vat_mode,
          vat_bp: p.vat_bp,
          commission_bp: p.commission_bp,
          commission_base: p.commission_base,
          charges_borne_by: p.charges_borne_by,
          note: p.note ?? undefined,
          method_rates: p.method_rates,
        }));
        if (cachedProfiles.length > 0) {
          await db.rateProfiles.bulkPut(cachedProfiles);
        }
        // CLT-R-026: drop published profiles the server replaced, so a stale
        // one whose method_rates point at dead ids cannot win resolution.
        await pruneReplacedRateProfiles(
          cachedProfiles.map((p) => p.id),
          db,
        );
      }

      if (Array.isArray(data.methods)) {
        const mappedMethods: CachedPaymentMethod[] = data.methods.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          requires_txn_ref: m.requires_txn_ref,
          display_order: m.sort_order, // Map Postgres sort_order to Dexie display_order
          active: m.active,
        }));
        if (mappedMethods.length > 0) {
          await db.methods.bulkPut(mappedMethods);
        }
        // CLT-R-026: drop methods the server no longer returns, so replaced ids
        // cannot become the entry form's default and block Save.
        await pruneReplacedMethods(
          mappedMethods.map((m) => m.id),
          db,
        );
      }

      if (Array.isArray(data.payables)) {
        const mappedPayables: CachedPayable[] = data.payables.map((p) => ({
          id: p.id,
          name: p.name, // Required DDL column name
          kind: p.kind,
          // Required by the combined-card reconcile scope: without it every
          // cached payable reported an empty code and "Combined Card Fees"
          // resolved to no payables, leaving the save permanently disabled
          // (found by the E2E reconciliation pass, 2026-11-07).
          code: p.code ?? undefined,
          method_id: p.method_id ?? undefined,
          recipient_name: p.name,
          recipient_account: '',
          due_day: p.due_day,
          active: p.active,
        }));
        if (mappedPayables.length > 0) {
          await db.payables.bulkPut(mappedPayables);
        }
        await pruneReplacedPayables(
          mappedPayables.map((p) => p.id),
          db,
        );
      }

      if (Array.isArray(data.monthCloses)) {
        if (data.monthCloses.length > 0) {
          await db.monthCloses.bulkPut(data.monthCloses);
        }
        await pruneReplacedMonthCloses(
          data.monthCloses.map((c) => c.month),
          db,
        );
      }

      if (data.settings) {
        // String key 'true' conforms strictly to W3C IndexedDB spec key requirements
        await db.appSettings.put({
          id: 'true',
          net_label: (data.settings.net_label as string) ?? 'Net after deductions',
          reconcile_tolerance_poisha: (data.settings.reconcile_tolerance_poisha as string) ?? '100',
          updated_at: (data.settings.updated_at as string) ?? new Date().toISOString(),
        });
      }

      if (Array.isArray(data.profiles)) {
        const mappedProfiles: CachedProfile[] = data.profiles.map((p) => ({
          id: p.id,
          role: p.role,
          display_name: p.full_name, // Map Postgres full_name to Dexie display_name
          active: p.active,
          default_route: p.role === 'staff' ? '/entries/new' : '/dashboard',
          created_at: new Date().toISOString(),
        }));
        if (mappedProfiles.length > 0) {
          await db.profiles.bulkPut(mappedProfiles);
        }
        await pruneReplacedProfiles(
          mappedProfiles.map((p) => p.id),
          db,
        );
      }

      if (Array.isArray(data.settlements)) {
        const mappedSettlements: CachedSettlement[] = data.settlements.map((s) => ({
          id: s.id,
          month: s.month,
          payable_id: s.payable_id,
          expected_poisha: s.expected_poisha?.toString() ?? '0',
          paid_poisha: s.paid_poisha?.toString() ?? '0',
          variance_poisha: s.variance_poisha?.toString() ?? '0',
          status: s.status,
          overpayment_review_status:
            s.overpayment_review_status === 'approved'
              ? 'approved'
              : s.overpayment_review_status === 'none'
                ? 'none'
                : undefined,
          note: s.note ?? undefined,
          overpayment_approved_amount_poisha:
            s.overpayment_approved_amount_poisha?.toString() ?? undefined,
          overpayment_reason: s.overpayment_reason ?? undefined,
          overpayment_approved_by: s.overpayment_approved_by ?? undefined,
          overpayment_approved_at: s.overpayment_approved_at ?? undefined,
        }));
        if (mappedSettlements.length > 0) {
          await db.settlements.bulkPut(mappedSettlements);
        }
        await pruneReplacedSettlements(
          mappedSettlements.map((s) => s.id),
          db,
        );
      }

      if (Array.isArray(data.statements)) {
        const payableIdsByStatement = new Map<string, string[]>();
        for (const link of data.statementPayables ?? []) {
          const list = payableIdsByStatement.get(link.statement_id) ?? [];
          list.push(link.payable_id);
          payableIdsByStatement.set(link.statement_id, list);
        }
        const mappedStatements: CachedStatement[] = data.statements.map((st) => ({
          id: st.id,
          month: st.month,
          kind: st.kind,
          source: st.source,
          status: st.status,
          total_gross_poisha: st.statement_total_poisha?.toString() ?? undefined,
          expected_poisha: st.expected_poisha?.toString() ?? undefined,
          variance_poisha: st.variance_poisha?.toString() ?? undefined,
          payable_id: st.payable_id ?? undefined,
          payable_ids: payableIdsByStatement.get(st.id) ?? undefined,
          note: st.note ?? undefined,
          reconciled_at: st.reconciled_at ?? undefined,
          reconciled_by: st.reconciled_by ?? undefined,
        }));
        if (mappedStatements.length > 0) {
          await db.statements.bulkPut(mappedStatements);
        }
        await pruneReplacedStatements(
          mappedStatements.map((s) => s.id),
          db,
        );
      }

      if (data.rejectedOps && Array.isArray(data.rejectedOps)) {
        const serverPendingOpIds = new Set(data.rejectedOps.map((op) => op.op_id));

        // Prune local pending ops that were resolved or discarded on the server
        const localPending = await db.rejectedOps.where('status').equals('pending').toArray();
        for (const localOp of localPending) {
          if (!serverPendingOpIds.has(localOp.opId)) {
            await db.rejectedOps.delete(localOp.opId);
          }
        }

        for (const op of data.rejectedOps) {
          await db.rejectedOps.put({
            opId: op.op_id,
            entry_id: op.entry_id ?? undefined,
            error_code: op.reason,
            error_message: op.reason,
            rejected_at: op.created_at,
            status: op.resolution_status,
            payload: op.payload,
          });
        }
      }
    }

    // Ingest visible entries returned from monotonic SQL query
    if (myEpoch !== pullEpoch) {
      return;
    }
    if (data.entries && data.entries.length > 0) {
      for (const entry of data.entries) {
        if (myEpoch !== pullEpoch) {
          return;
        }
        const localEntry: LocalEntry = {
          id: entry.id,
          entry_number: entry.entry_number
            ? `E-${entry.entry_date.replace(/-/g, '').substring(0, 6)}-${entry.entry_number.toString().padStart(6, '0')}`
            : undefined,
          local_id: `#LOCAL-${entry.id.substring(0, 6)}`,
          entry_date: entry.entry_date,
          customer_name: entry.customer_name,
          sub_qty: entry.sub_qty,
          sub_description: entry.sub_description ?? undefined,
          method_id: entry.method_id,
          gross_poisha: entry.gross_poisha.toString(),
          vat_poisha: entry.vat_poisha.toString(),
          commission_poisha: entry.commission_poisha.toString(),
          charge_poisha:
            entry.charge_poisha !== undefined && entry.charge_poisha !== null
              ? entry.charge_poisha.toString()
              : (
                  BigInt(entry.business_charge_poisha) + BigInt(entry.customer_charge_poisha)
                ).toString(),
          business_charge_poisha: entry.business_charge_poisha.toString(),
          customer_charge_poisha: entry.customer_charge_poisha.toString(),
          net_poisha: entry.net_poisha.toString(),
          txn_ref: entry.txn_ref ?? undefined,
          notes: entry.notes ?? undefined,
          status: entry.status,
          sync_status: 'synced',
          created_by: entry.created_by,
          created_at: entry.created_at,
          server_seq: entry.server_seq.toString(),
          stale_rates: entry.stale_rates,
          rate_profile_id: entry.rate_profile_id,
          supersedes_id: entry.supersedes_id ?? undefined,
          device_id: entry.device_id ?? undefined,
          snapshot: (entry.snapshot as unknown as LocalEntry['snapshot']) ?? undefined,
        };

        await db.entries.put(localEntry);
      }
    }

    if (myEpoch !== pullEpoch) {
      return;
    }
    cursor = data.nextCursor;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('clt_server_cursor', cursor);
    }
    await db.meta.put({
      key: 'server_cursor',
      value: cursor,
      updated_at: new Date().toISOString(),
    });

    hasMore = data.hasMore;
    isFirstBatch = false;
  }
}
