<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { db, type LocalEntry, type CachedPaymentMethod } from '$lib/db';
  import {
    computeShopMethodCollections,
    computeOverallShopMetrics,
    getAsiaDhakaDateString,
    getPriorMonthPrefix
  } from '$lib/dashboards/metrics';
  import { computeSettlementReminder } from '$lib/settlements/reminders';
  import { formatPoishaToBdt } from '@clt/shared';
  import { authFetch } from '$lib/api/client';
  import { liveQuery } from 'dexie';
  import { onMount } from 'svelte';

  // Schema matching view_device_stale_rate_anomalies (PRD §10, Finding A3, Test #65)
  interface AnomalyAlert {
    device_id: string;
    actor_id: string;
    stale_ops_last_hour: number;
    latest_stale_op_at: string;
  }

  interface SettlementDueItem {
    id: string;
    payableName: string;
    dueDayOfMonth: number;
    remindDaysBefore: number;
    expectedPoisha: string;
    status: string;
    dueDate: string;
    isOverdue: boolean;
    isDueSoon: boolean;
    formattedDueDay: string;
  }

  interface ClosedMonthRecoveryItem {
    opId: string;
    customerName: string;
    grossPoisha: string;
    staffName: string;
    reason: string;
  }

  interface StaffActivityItem {
    id: string;
    customerName: string;
    staffName: string;
    grossPoisha: string;
    methodName: string;
    timeStr: string;
  }

  // 5-state settlement status badge map (CLT-D-017 pattern)
  const SETTLEMENT_BADGE_CLASSES: Record<string, string> = {
    paid: 'bg-emerald-500/10 text-emerald-700',
    overpaid: 'bg-purple-500/10 text-purple-700',
    partly_paid: 'bg-blue-500/10 text-blue-700',
    due: 'bg-amber-500/10 text-amber-700',
    not_applicable: 'bg-slate-500/10 text-slate-700',
  };

  let anomalies = $state<AnomalyAlert[]>([]);
  let loadingAnomalies = $state(false);
  let anomaliesUnavailable = $state(false);

  let highValueStaleCount = $state(0);
  let lowValueStaleCount = $state(0);
  let voidRequestCount = $state(0);
  let duplicateTxnCount = $state(0);
  let closedMonthRejectedCount = $state(0);
  let closedMonthRejectedOps = $state<ClosedMonthRecoveryItem[]>([]);
  let pendingSyncCount = $state(0);

  let windowedEntries = $state<LocalEntry[]>([]);
  let paymentMethods = $state<CachedPaymentMethod[]>([]);
  let currentSettlements = $state<SettlementDueItem[]>([]);
  let staffActivity = $state<StaffActivityItem[]>([]);

  const todayStr = getAsiaDhakaDateString();
  const currentMonth = todayStr.substring(0, 7);
  const priorMonth = getPriorMonthPrefix(currentMonth);

  // Typed payload field reader (no `any`; op payloads are Record<string, unknown>)
  function payloadString(payload: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    return '';
  }

  async function fetchAnomalies() {
    loadingAnomalies = true;
    try {
      const res = await authFetch('/api/v1/admin/entries/stale-anomalies');
      if (res.ok) {
        const data = await res.json();
        anomalies = data.anomalies ?? [];
        anomaliesUnavailable = false;
      } else {
        anomaliesUnavailable = true;
      }
    } catch {
      // Offline fallback: graceful degradation
      anomaliesUnavailable = true;
    } finally {
      loadingAnomalies = false;
    }
  }

  onMount(() => {
    fetchAnomalies();
    // 60-second polling for real-time anomaly alerts (PRD §8.5, Test #65)
    const interval = setInterval(fetchAnomalies, 60000);
    const handleOnline = () => fetchAnomalies();
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  });

  // Live queries to Dexie tables with memory-safe date windowing (PRD §8.5)
  $effect(() => {
    const windowStart = `${priorMonth}-01`;
    const windowEnd = `${currentMonth}-31`;

    // 1. Memory-windowed entries covering current and prior month
    const subEntries = liveQuery(() =>
      db.entries
        .where('entry_date')
        .between(windowStart, windowEnd, true, true)
        .toArray()
    ).subscribe((rows) => {
      windowedEntries = rows;
    });

    // 2. High-value stale rate review queue (>৳50,000 = >5000000n poisha, PRD §8.5, §10, Test #65)
    // Filter active entries where stale_review_status is undefined or 'flagged' (excluding approved/rejected)
    const subStaleHigh = liveQuery(() =>
      db.entries
        .filter(
          (e) =>
            e.status === 'active' &&
            e.stale_rates === true &&
            (e.stale_review_status === undefined || e.stale_review_status === 'flagged') &&
            BigInt(e.gross_poisha) > 5000000n
        )
        .count()
    ).subscribe((c) => { highValueStaleCount = c; });

    // 3. Stale-rate alert counter (<৳50,000)
    const subStaleLow = liveQuery(() =>
      db.entries
        .filter(
          (e) =>
            e.status === 'active' &&
            e.stale_rates === true &&
            (e.stale_review_status === undefined || e.stale_review_status === 'flagged') &&
            BigInt(e.gross_poisha) <= 5000000n
        )
        .count()
    ).subscribe((c) => { lowValueStaleCount = c; });

    // 4. Void requests: synced staff void requests + local outbox void requests
    const subVoid = liveQuery(async () => {
      const syncedVoidRequests = await db.entries
        .filter((e) => e.status === 'active' && Boolean(e.void_requested_by))
        .count();
      const localVoidRequests = await db.outbox
        .filter((op) => op.type === 'request_void' && (op.status === 'pending' || op.status === 'in_flight'))
        .count();
      return syncedVoidRequests + localVoidRequests;
    }).subscribe((c) => { voidRequestCount = c; });

    // 5. Duplicate transaction flags
    const subDup = liveQuery(() =>
      db.entries
        .filter((e) => e.status === 'active' && Boolean(e.dup_txn_flag))
        .count()
    ).subscribe((c) => { duplicateTxnCount = c; });

    // 6. Closed-month offline entries: server-pulled rejectedOps (Test #47) + local rejected outbox ops
    const subClosed = liveQuery(async () => {
      const serverRejected = await db.rejectedOps
        .filter((op) => op.error_code === 'month_closed' && op.status === 'pending')
        .toArray();
      const localRejected = await db.outbox
        .filter((op) => op.status === 'rejected' && op.rejectionReason === 'month_closed')
        .toArray();

      const profiles = await db.profiles.toArray();
      const profMap = new Map(profiles.map((p) => [p.id, p.display_name]));

      const items: ClosedMonthRecoveryItem[] = [];

      for (const op of serverRejected) {
        const staffId = payloadString(op.payload ?? {}, 'createdBy', 'created_by');
        items.push({
          opId: op.opId,
          customerName: payloadString(op.payload ?? {}, 'customerName', 'customer_name') || 'Counter Transaction',
          grossPoisha: payloadString(op.payload ?? {}, 'grossPoisha', 'gross_poisha') || '0',
          staffName: staffId !== '' ? profMap.get(staffId) ?? 'Staff Member' : 'Staff Member',
          reason: op.error_message || 'Month closed on server',
        });
      }

      for (const op of localRejected) {
        if (!items.some((i) => i.opId === op.opId)) {
          const staffId = op.userId || payloadString(op.payload ?? {}, 'createdBy', 'created_by');
          items.push({
            opId: op.opId,
            customerName: payloadString(op.payload ?? {}, 'customerName', 'customer_name') || 'Counter Transaction',
            grossPoisha: payloadString(op.payload ?? {}, 'grossPoisha', 'gross_poisha') || '0',
            staffName: staffId !== '' ? profMap.get(staffId) ?? 'Staff Member' : 'Staff Member',
            reason: op.rejectionReason || 'Month closed locally',
          });
        }
      }

      return items;
    }).subscribe((items) => {
      closedMonthRejectedOps = items;
      closedMonthRejectedCount = items.length;
    });

    // 7. Pending sync outbox queue counter
    const subPendingSync = liveQuery(() =>
      db.outbox
        .filter((op) => op.status === 'pending' || op.status === 'in_flight')
        .count()
    ).subscribe((c) => { pendingSyncCount = c; });

    // 8. Payment methods for shop breakdown
    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      paymentMethods = rows;
    });

    // 9. Settlements and payables for monthly due checklist (PRD §7.1, §8.4, Plan 014)
    // Liabilities accrued in priorMonth are payable in currentMonth on dueDay
    const subSettlements = liveQuery(async () => {
      const priorMonthDate = `${priorMonth}-01`;
      const settlements = await db.settlements.where('month').equals(priorMonthDate).toArray();
      const payables = await db.payables.toArray();
      const pMap = new Map(payables.map((p) => [p.id, p]));

      return settlements.map((s) => {
        const payable = pMap.get(s.payable_id);
        const name = payable?.name ?? payable?.recipient_name ?? 'Payable';
        const dueDay = payable?.due_day ?? 15;
        const remindDays = payable?.remind_days_before ?? 3;
        const reminder = computeSettlementReminder(s.month, dueDay, remindDays, todayStr);

        return {
          id: s.id,
          payableName: name,
          dueDayOfMonth: dueDay,
          remindDaysBefore: remindDays,
          expectedPoisha: s.expected_poisha,
          status: s.status,
          dueDate: reminder.dueDate,
          isOverdue: reminder.isOverdue && (s.status === 'due' || s.status === 'partly_paid'),
          isDueSoon: reminder.inReminderWindow && (s.status === 'due' || s.status === 'partly_paid'),
          formattedDueDay: reminder.formattedDueDay,
        };
      });
    }).subscribe((items) => {
      currentSettlements = items;
    });

    // 10. Recent counter staff activity (in-memory sort avoids unindexed created_at crash)
    const subActivity = liveQuery(async () => {
      const recent = await db.entries
        .where('entry_date')
        .between(windowStart, windowEnd, true, true)
        .toArray();
      recent.sort((a, b) => {
        const timeA = new Date(a.created_at || a.entry_date).getTime();
        const timeB = new Date(b.created_at || b.entry_date).getTime();
        return timeB - timeA;
      });
      const top5 = recent.slice(0, 5);
      const profiles = await db.profiles.toArray();
      const profMap = new Map(profiles.map((p) => [p.id, p.display_name]));
      const methods = await db.methods.toArray();
      const methMap = new Map(methods.map((m) => [m.id, m.name]));

      return top5.map((e) => ({
        id: e.id,
        customerName: e.customer_name,
        staffName: profMap.get(e.created_by) ?? 'Staff Member',
        grossPoisha: e.gross_poisha,
        methodName: methMap.get(e.method_id) ?? 'Payment Method',
        timeStr: e.created_at && e.created_at.length >= 16 ? e.created_at.substring(11, 16) : '--:--',
      }));
    }).subscribe((list) => {
      staffActivity = list;
    });

    return () => {
      subEntries.unsubscribe();
      subStaleHigh.unsubscribe();
      subStaleLow.unsubscribe();
      subVoid.unsubscribe();
      subDup.unsubscribe();
      subClosed.unsubscribe();
      subPendingSync.unsubscribe();
      subMethods.unsubscribe();
      subSettlements.unsubscribe();
      subActivity.unsubscribe();
    };
  });

  const overallShop = $derived(
    computeOverallShopMetrics(windowedEntries, todayStr, currentMonth)
  );

  const methodTotals = $derived(
    computeShopMethodCollections(windowedEntries, paymentMethods, todayStr, currentMonth)
  );
</script>

<div class="admin-dashboard flex flex-col gap-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Admin Operations Dashboard</h1>
      <p class="text-sm text-[var(--c-muted,#6b7280)]">Overview of counter operations, review queues, and anomaly alerts.</p>
    </div>

    <div class="flex items-center gap-2">
      <div class="px-3 py-1.5 rounded-xl border border-black/10 text-xs font-semibold flex items-center gap-2">
        <span class="w-2 h-2 rounded-full {pendingSyncCount > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}"></span>
        <span>{pendingSyncCount} Outbox Pending</span>
      </div>
    </div>
  </div>

  {#if anomalies.length > 0}
    <div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-900 dark:text-red-300 text-xs flex flex-col gap-2">
      <span class="font-bold text-sm">⚠ Real-Time Device Stale Rate Anomaly Alert (Test #65)</span>
      {#each anomalies as a (`${a.device_id}-${a.actor_id}`)}
        <div>
          Device <span class="font-mono font-bold">{(a.device_id ?? '').substring(0, 8) || 'Unknown'}...</span> pushed {a.stale_ops_last_hour} stale operations in the last hour (latest at {a.latest_stale_op_at}).
        </div>
      {/each}
    </div>
  {:else if anomaliesUnavailable}
    <div class="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs flex items-center justify-between">
      <span>ℹ Anomaly tracker unavailable offline. Will automatically reconnect when online.</span>
      <Button variant="default" class="text-xs py-2 px-3 min-h-[44px]" loading={loadingAnomalies} onclick={fetchAnomalies}>Retry</Button>
    </div>
  {/if}

  {#if closedMonthRejectedOps.length > 0}
    <!-- Needs Attention (Closed Month) Queue (PRD §8.5, Test #47) -->
    <div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-900 dark:text-red-300 text-xs flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="font-bold text-sm">⚠ Needs Attention (Closed Month): {closedMonthRejectedOps.length} offline entry(s) blocked (Test #47)</span>
        <a href="/reconcile" class="underline font-semibold hover:text-red-700">Open Reconciliation Recovery</a>
      </div>
      <p class="text-[var(--c-muted,#6b7280)]">
        Transactions recorded offline on historical dates after those calendar months were closed. Reassign to an open period or discard via Reconciliation.
      </p>
      <div class="flex flex-col gap-1.5 mt-1">
        {#each closedMonthRejectedOps as item (item.opId)}
          <div class="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-black/20 text-xs">
            <span class="font-medium text-slate-800 dark:text-slate-200">
              {item.customerName} ({formatPoishaToBdt(BigInt(item.grossPoisha))}) — Staff: {item.staffName}
            </span>
            <span class="text-red-700 font-semibold">{item.reason}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Overall Shop Turnover (PRD §8.5) -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Shop Collections Today</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-ink,#111827)]">{formatPoishaToBdt(overallShop.todayGrossPoisha)}</div>
      <div class="text-xs text-[var(--c-muted,#6b7280)] mt-2">{overallShop.todayEntriesCount} shop transactions recorded today ({todayStr})</div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Shop Month-to-Date Collections</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(overallShop.mtdGrossPoisha)}</div>
      <div class="text-xs text-[var(--c-muted,#6b7280)] mt-2">{overallShop.mtdEntriesCount} shop transactions this month ({currentMonth})</div>
    </Card>
  </div>

  <!-- Operational Review Queues Bento Grid (PRD §8.5) -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Stale Reviews (>৳50k)</div>
        <div class="text-2xl font-bold text-amber-600">{highValueStaleCount} Pending</div>
        {#if lowValueStaleCount > 0}
          <div class="text-[10px] text-[var(--c-muted,#6b7280)] mt-1">{lowValueStaleCount} auto-accepted (&lt;৳50k)</div>
        {/if}
      </div>
      <div class="mt-3">
        <a href="/admin/stale-reviews"><Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]">Review Queue</Button></a>
      </div>
    </Card>

    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Void Requests</div>
        <div class="text-2xl font-bold text-[var(--c-ink,#111827)]">{voidRequestCount} Pending</div>
      </div>
      <div class="mt-3">
        <a href="/ledger?filter=void_requested"><Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]">Open Ledger</Button></a>
      </div>
    </Card>

    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Duplicate Txn Flags</div>
        <div class="text-2xl font-bold {duplicateTxnCount > 0 ? 'text-amber-600' : 'text-slate-700'}">{duplicateTxnCount} Flagged</div>
      </div>
      <div class="mt-3">
        <a href="/ledger?filter=duplicate"><Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={duplicateTxnCount === 0}>Inspect</Button></a>
      </div>
    </Card>

    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Closed-Month Offline</div>
        <div class="text-2xl font-bold {closedMonthRejectedCount > 0 ? 'text-red-600' : 'text-emerald-600'}">{closedMonthRejectedCount} Items</div>
      </div>
      <div class="mt-3">
        <a href="/reconcile">
          <Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={closedMonthRejectedCount === 0}>
            {closedMonthRejectedCount > 0 ? 'Review Items' : 'Clean'}
          </Button>
        </a>
      </div>
    </Card>
  </div>

  <!-- Shop Collections by Payment Method (PRD §8.5) -->
  <Card class="p-6">
    <h2 class="font-bold text-base text-[var(--c-ink,#111827)] mb-4">Shop Collections by Payment Method</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-black/10 text-xs text-[var(--c-muted,#6b7280)]">
            <th class="py-2">Payment Method</th>
            <th class="py-2 text-right">Today Gross</th>
            <th class="py-2 text-right">Today Txns</th>
            <th class="py-2 text-right">MTD Gross</th>
            <th class="py-2 text-right">MTD Txns</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/5">
          {#each methodTotals as m (m.methodId)}
            <tr>
              <td class="py-2.5 font-medium">{m.methodName}</td>
              <td class="py-2.5 text-right font-bold tabular-nums">{formatPoishaToBdt(m.todayGrossPoisha)}</td>
              <td class="py-2.5 text-right tabular-nums text-xs text-[var(--c-muted,#6b7280)]">{m.todayCount}</td>
              <td class="py-2.5 text-right font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(m.mtdGrossPoisha)}</td>
              <td class="py-2.5 text-right tabular-nums text-xs text-[var(--c-muted,#6b7280)]">{m.mtdCount}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>

  <!-- Settlement Payment Due Checklist (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Settlement Payment Due Checklist (Due in {currentMonth})</h2>
      <a href="/settlements" class="text-xs text-[var(--c-muted,#6b7280)] hover:underline">Manage Settlements</a>
    </div>

    {#if currentSettlements.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No settlement records active for {priorMonth} liabilities.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each currentSettlements as s (s.id)}
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5 text-sm">
            <div>
              <span class="font-bold">{s.payableName}</span>
              <span class="text-xs text-[var(--c-muted,#6b7280)] ml-2">Due Date: {s.dueDate} ({s.formattedDueDay})</span>
              {#if s.isOverdue}
                <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Overdue</span>
              {:else if s.isDueSoon}
                <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Due Soon</span>
              {/if}
            </div>
            <div class="flex items-center gap-3">
              <span class="font-bold tabular-nums">{formatPoishaToBdt(BigInt(s.expectedPoisha || '0'))}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase {SETTLEMENT_BADGE_CLASSES[s.status] ?? 'bg-slate-500/10 text-slate-700'}">
                {s.status}
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>

  <!-- Staff Counter Activity (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Staff Counter Activity</h2>
      <span class="text-xs text-[var(--c-muted,#6b7280)]">Recent transactions across staff</span>
    </div>

    {#if staffActivity.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No recent counter transactions found.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each staffActivity as act (act.id)}
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/40 border border-black/5 text-sm">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-700">{act.staffName}:</span>
              <span class="font-medium text-[var(--c-ink,#111827)]">{act.customerName}</span>
              <span class="text-xs text-[var(--c-muted,#6b7280)]">({act.methodName})</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-[var(--c-muted,#6b7280)]">{act.timeStr}</span>
              <span class="font-bold tabular-nums">{formatPoishaToBdt(BigInt(act.grossPoisha))}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>
