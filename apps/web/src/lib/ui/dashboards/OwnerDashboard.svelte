<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { db, type LocalEntry } from '$lib/db';
  import { computeMonthlyAggregates } from '$lib/reports/aggregates';
  import {
    getAsiaDhakaDateString,
    getPriorMonthPrefix,
    computeExecutiveDeltas,
    type ExecutiveDeltas
  } from '$lib/dashboards/metrics';
  import { computeSettlementReminder } from '$lib/settlements/reminders';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';

  interface Props {
    ownerName: string;
  }

  interface SettlementItem {
    id: string;
    month: string;
    payableName: string;
    dueDayOfMonth: number;
    expectedPoisha: string;
    paidPoisha: string;
    status: string;
    overpaymentReviewStatus?: 'none' | 'approved' | undefined;
    overpaymentApprovedAmount?: string | undefined;
    dueDate: string;
    isOverdue: boolean;
    isDueSoon: boolean;
    formattedDueDay: string;
  }

  interface UnclosedMonthItem {
    month: string;
    status: string;
  }

  interface VarianceAlertItem {
    id: string;
    kind: string;
    month: string;
    variancePoisha: string;
  }

  interface DailyBar {
    dayStr: string;
    grossPoisha: bigint;
    heightPct: number;
  }

  // 5-state settlement status badge map (CLT-D-017 pattern)
  const SETTLEMENT_BADGE_CLASSES: Record<string, string> = {
    paid: 'bg-emerald-500/10 text-emerald-700',
    overpaid: 'bg-purple-500/10 text-purple-700',
    partly_paid: 'bg-blue-500/10 text-blue-700',
    due: 'bg-amber-500/10 text-amber-700',
    not_applicable: 'bg-slate-500/10 text-slate-700',
  };

  let { ownerName }: Props = $props();
  const todayStr = getAsiaDhakaDateString();
  const currentMonth = todayStr.substring(0, 7);
  const priorMonth = getPriorMonthPrefix(currentMonth);

  let windowedEntries = $state<LocalEntry[]>([]);
  let settlements = $state<SettlementItem[]>([]);
  let unclosedMonths = $state<UnclosedMonthItem[]>([]);
  let varianceAlerts = $state<VarianceAlertItem[]>([]);
  let highValueStaleCount = $state(0);

  // Live queries to local Dexie tables with date windowing (PRD §8.5)
  $effect(() => {
    const windowStart = `${priorMonth}-01`;
    const windowEnd = `${currentMonth}-31`;

    // 1. Windowed entries for financial aggregations and daily trend
    const subEntries = liveQuery(() =>
      db.entries
        .where('entry_date')
        .between(windowStart, windowEnd, true, true)
        .toArray()
    ).subscribe((rows) => {
      windowedEntries = rows;
    });

    // 2. Settlements for priorMonth (currently due) and currentMonth with payables join
    const subSettlements = liveQuery(async () => {
      const priorMonthDate = `${priorMonth}-01`;
      const currentMonthDate = `${currentMonth}-01`;
      const setts = await db.settlements
        .where('month')
        .anyOf([priorMonthDate, currentMonthDate])
        .toArray();
      const payables = await db.payables.toArray();
      const pMap = new Map(payables.map((p) => [p.id, p]));

      return setts.map((s) => {
        const payable = pMap.get(s.payable_id);
        const name = payable?.name ?? payable?.recipient_name ?? 'Payable';
        const dueDay = payable?.due_day ?? 15;
        const remindDays = payable?.remind_days_before ?? 3;
        const reminder = computeSettlementReminder(s.month, dueDay, remindDays, todayStr);

        return {
          id: s.id,
          month: s.month,
          payableName: name,
          dueDayOfMonth: dueDay,
          expectedPoisha: s.expected_poisha,
          paidPoisha: s.paid_poisha,
          status: s.status,
          overpaymentReviewStatus: s.overpayment_review_status,
          overpaymentApprovedAmount: s.overpayment_approved_amount_poisha,
          dueDate: reminder.dueDate,
          isOverdue: reminder.isOverdue && (s.status === 'due' || s.status === 'partly_paid'),
          isDueSoon: reminder.inReminderWindow && (s.status === 'due' || s.status === 'partly_paid'),
          formattedDueDay: reminder.formattedDueDay,
        };
      });
    }).subscribe((items) => {
      settlements = items;
    });

    // 3. Unclosed historical months reminder (PRD §8.5)
    // Pure reactive Dexie query: generates months from earliest entry up to currentMonth
    const subMonths = liveQuery(async () => {
      const closes = await db.monthCloses.toArray();
      const closedSet = new Set(
        closes.filter((c) => c.status === 'closed').map((c) => c.month.substring(0, 7))
      );

      const firstEntry = await db.entries.orderBy('entry_date').first();
      if (!firstEntry) return [];

      const startMonth = firstEntry.entry_date.substring(0, 7);
      const unclosed: UnclosedMonthItem[] = [];

      let cur = startMonth;
      while (cur < currentMonth) {
        if (!closedSet.has(cur)) {
          unclosed.push({ month: cur, status: 'open' });
        }
        // Advance cur by 1 calendar month
        const [y, m] = cur.split('-').map(Number);
        const nextDate = new Date(Date.UTC(y, m, 1));
        cur = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      return unclosed;
    }).subscribe((items) => {
      unclosedMonths = items;
    });

    // 4. Statement reconciliation variance alerts (PRD §8.5, §11.2)
    // CachedStatement fields are typed (CLT-D-019): statement_total_poisha, total_gross_poisha,
    // expected_poisha, variance_poisha — no `any` casts needed.
    const subStatements = liveQuery(() =>
      db.statements.toArray()
    ).subscribe((rows) => {
      varianceAlerts = rows
        .filter((st) => {
          if (st.status !== 'open') return false;
          const variance = computeStatementVariance(st);
          return variance !== 0n;
        })
        .map((st) => ({
          id: st.id,
          kind: st.kind,
          month: st.month,
          variancePoisha: computeStatementVariance(st).toString(),
        }));
    });

    // 5. Stale reviews pending owner sign-off
    const subStale = liveQuery(() =>
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

    return () => {
      subEntries.unsubscribe();
      subSettlements.unsubscribe();
      subMonths.unsubscribe();
      subStatements.unsubscribe();
      subStale.unsubscribe();
    };
  });

  function computeStatementVariance(st: { statement_total_poisha?: string | undefined; total_gross_poisha?: string | undefined; expected_poisha?: string | undefined; variance_poisha?: string | undefined }): bigint {
    const total = BigInt(st.statement_total_poisha || st.total_gross_poisha || '0');
    const expected = BigInt(st.expected_poisha || '0');
    return st.variance_poisha !== undefined && st.variance_poisha !== '' ? BigInt(st.variance_poisha) : total - expected;
  }

  // Financial aggregates with prior month comparisons (PRD §8.5)
  const currentAgg = $derived(computeMonthlyAggregates(windowedEntries, currentMonth));
  const priorAgg = $derived(computeMonthlyAggregates(windowedEntries, priorMonth));

  const deltas: ExecutiveDeltas = $derived(
    computeExecutiveDeltas(
      currentAgg.totalGrossPoisha,
      currentAgg.totalCommissionPoisha,
      currentAgg.totalNetPoisha,
      priorAgg.totalGrossPoisha,
      priorAgg.totalCommissionPoisha,
      priorAgg.totalNetPoisha
    )
  );

  const pendingOverpayments = $derived(
    settlements.filter((s) => {
      if (s.status !== 'overpaid') return false;
      const expected = BigInt(s.expectedPoisha || '0');
      const paid = BigInt(s.paidPoisha || '0');
      const surplus = paid - expected;
      return s.overpaymentReviewStatus !== 'approved' || s.overpaymentApprovedAmount !== surplus.toString();
    })
  );

  // Daily collections trend data for current month (PRD §8.5)
  const dailyTrendBars = $derived.by(() => {
    const daysInMonth = new Date(
      parseInt(currentMonth.substring(0, 4), 10),
      parseInt(currentMonth.substring(5, 7), 10),
      0
    ).getDate();

    const daySums = new Map<number, bigint>();
    for (let d = 1; d <= daysInMonth; d++) {
      daySums.set(d, 0n);
    }

    for (const e of windowedEntries) {
      if (e.status === 'active' && e.sync_status !== 'rejected' && e.entry_date.startsWith(currentMonth)) {
        const d = parseInt(e.entry_date.substring(8, 10), 10);
        const current = daySums.get(d) ?? 0n;
        daySums.set(d, current + BigInt(e.gross_poisha));
      }
    }

    let maxVal = 0n;
    for (const val of daySums.values()) {
      if (val > maxVal) maxVal = val;
    }

    const bars: DailyBar[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const val = daySums.get(d) ?? 0n;
      const pct = maxVal > 0n ? Number((val * 100n) / maxVal) : 0;
      bars.push({
        dayStr: String(d),
        grossPoisha: val,
        heightPct: Math.max(pct, val > 0n ? 4 : 1),
      });
    }

    return bars;
  });
</script>

<div class="owner-dashboard flex flex-col gap-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Executive Summary — {ownerName}</h1>
      <p class="text-sm text-[var(--c-muted,#6b7280)]">
        Financial governance, month close gates, and liability settlements ({currentMonth} vs {priorMonth}).
      </p>
    </div>

    <div class="flex gap-2">
      <a href="/months/close">
        <Button variant="commission" class="min-h-[44px]">Month Close Controls</Button>
      </a>
    </div>
  </div>

  {#if unclosedMonths.length > 0}
    <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-900 text-xs flex items-center justify-between">
      <div>
        <span class="font-bold">⚠ Unclosed Calendar Months:</span>
        Historical months ({unclosedMonths.map((m) => m.month).join(', ')}) remain unclosed. Lock periods to freeze liabilities.
      </div>
      <a href="/months/close"><Button variant="default" class="text-xs py-2 px-3 min-h-[44px]">Close Months</Button></a>
    </div>
  {/if}

  {#if varianceAlerts.length > 0}
    <div class="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-900 text-xs flex items-center justify-between">
      <div>
        <span class="font-bold">ℹ Statement Variance Alert:</span>
        {varianceAlerts.length} open statement(s) exhibit variance between internal ledgers and bank statements.
      </div>
      <a href="/reconcile"><Button variant="default" class="text-xs py-2 px-3 min-h-[44px]">Review Reconciliation</Button></a>
    </div>
  {/if}

  <!-- Executive Financial Summary Cards (vs Prior Month) (PRD §8.5) -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Shop Gross (MTD)</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-ink,#111827)]">{formatPoishaToBdt(currentAgg.totalGrossPoisha)}</div>
      <div class="text-xs mt-2 flex items-center gap-1.5">
        <span class="font-bold {deltas.grossDeltaPoisha >= 0n ? 'text-emerald-600' : 'text-red-600'}">
          {deltas.grossDeltaPoisha >= 0n ? '↑ +' : '↓ '}{formatPoishaToBdt(deltas.grossDeltaPoisha < 0n ? -deltas.grossDeltaPoisha : deltas.grossDeltaPoisha)}
          ({deltas.grossDeltaPercent})
        </span>
        <span class="text-[var(--c-muted,#6b7280)]">vs {priorMonth}</span>
      </div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Commission Earned</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(currentAgg.totalCommissionPoisha)}</div>
      <div class="text-xs mt-2 flex items-center gap-1.5">
        <span class="font-bold {deltas.commissionDeltaPoisha >= 0n ? 'text-emerald-600' : 'text-red-600'}">
          {deltas.commissionDeltaPoisha >= 0n ? '↑ +' : '↓ '}{formatPoishaToBdt(deltas.commissionDeltaPoisha < 0n ? -deltas.commissionDeltaPoisha : deltas.commissionDeltaPoisha)}
          ({deltas.commissionDeltaPercent})
        </span>
        <span class="text-[var(--c-muted,#6b7280)]">vs {priorMonth}</span>
      </div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Net Retained Income</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--accent,#3b82f6)]">{formatPoishaToBdt(currentAgg.totalNetPoisha)}</div>
      <div class="text-xs mt-2 flex items-center gap-1.5">
        <span class="font-bold {deltas.netDeltaPoisha >= 0n ? 'text-emerald-600' : 'text-red-600'}">
          {deltas.netDeltaPoisha >= 0n ? '↑ +' : '↓ '}{formatPoishaToBdt(deltas.netDeltaPoisha < 0n ? -deltas.netDeltaPoisha : deltas.netDeltaPoisha)}
          ({deltas.netDeltaPercent})
        </span>
        <span class="text-[var(--c-muted,#6b7280)]">vs {priorMonth}</span>
      </div>
    </Card>
  </div>

  <!-- Responsive Pure SVG Daily Collections Trend Chart (PRD §8.5, §13) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Daily Collections Trend ({currentMonth})</h2>
        <p class="text-xs text-[var(--c-muted,#6b7280)]">Daily gross revenue progression across Asia/Dhaka calendar days</p>
      </div>
      <span class="text-xs font-semibold tabular-nums text-[var(--c-commission,#10b981)]">
        MTD Total: {formatPoishaToBdt(currentAgg.totalGrossPoisha)}
      </span>
    </div>

    <div class="h-48 w-full border-b border-black/10 pt-2 pb-1 relative">
      <svg
        viewBox="0 0 1000 160"
        preserveAspectRatio="none"
        class="w-full h-full overflow-visible"
        role="img"
        aria-label="Daily collections trend chart for {currentMonth}"
      >
        <!-- Horizontal Guide Lines -->
        <line x1="0" y1="40" x2="1000" y2="40" stroke="currentColor" stroke-dasharray="4 4" class="text-black/5" />
        <line x1="0" y1="80" x2="1000" y2="80" stroke="currentColor" stroke-dasharray="4 4" class="text-black/5" />
        <line x1="0" y1="120" x2="1000" y2="120" stroke="currentColor" stroke-dasharray="4 4" class="text-black/5" />

        <!-- Daily Bars -->
        {#each dailyTrendBars as bar, idx (bar.dayStr)}
          {@const barWidth = 1000 / dailyTrendBars.length}
          {@const x = idx * barWidth + 2}
          {@const width = Math.max(2, barWidth - 4)}
          {@const height = (bar.heightPct / 100) * 150}
          {@const y = 160 - height}
          <g class="cursor-pointer group">
            <rect
              {x}
              {y}
              {width}
              {height}
              rx="3"
              class="transition-colors duration-200 {bar.grossPoisha > 0n ? 'fill-emerald-500/80 hover:fill-emerald-600' : 'fill-slate-200'}"
            />
            <title>Day {bar.dayStr}: {formatPoishaToBdt(bar.grossPoisha)}</title>
          </g>
        {/each}
      </svg>
    </div>
    <div class="flex justify-between text-[10px] text-[var(--c-muted,#6b7280)] mt-1 px-1">
      <span>Day 1</span>
      <span>Day 15</span>
      <span>Day {dailyTrendBars.length}</span>
    </div>
  </Card>

  <!-- Payables Due Checklist (with Due Dates and 5-State Statuses) (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Payables Due & Settlement Status ({priorMonth} Liabilities Due in {currentMonth})</h2>
      <a href="/settlements" class="text-xs text-[var(--c-muted,#6b7280)] hover:underline">Manage All Settlements</a>
    </div>

    {#if settlements.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No payable liabilities accrued for {priorMonth} or {currentMonth}.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-black/10 text-xs text-[var(--c-muted,#6b7280)]">
              <th class="py-2">Payable Name</th>
              <th class="py-2">Liability Month</th>
              <th class="py-2">Due Date</th>
              <th class="py-2 text-right">Expected</th>
              <th class="py-2 text-right">Paid</th>
              <th class="py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5">
            {#each settlements as s (s.id)}
              <tr>
                <td class="py-2.5 font-medium">{s.payableName}</td>
                <td class="py-2.5 text-xs text-[var(--c-muted,#6b7280)] font-mono">{s.month.substring(0, 7)}</td>
                <td class="py-2.5 text-xs text-[var(--c-muted,#6b7280)]">
                  {s.dueDate} ({s.formattedDueDay})
                  {#if s.isOverdue}
                    <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Overdue</span>
                  {:else if s.isDueSoon}
                    <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Due Soon</span>
                  {/if}
                </td>
                <td class="py-2.5 text-right font-bold tabular-nums">{formatPoishaToBdt(BigInt(s.expectedPoisha || '0'))}</td>
                <td class="py-2.5 text-right font-medium tabular-nums text-slate-600">{formatPoishaToBdt(BigInt(s.paidPoisha || '0'))}</td>
                <td class="py-2.5 text-center">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase {SETTLEMENT_BADGE_CLASSES[s.status] ?? 'bg-slate-500/10 text-slate-700'}">
                    {s.status}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>

  <!-- Governance Decisions Bento Grid (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Pending Governance Decisions</h2>
      <span class="text-xs text-[var(--c-muted,#6b7280)]">Owner authorization required</span>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="p-4 rounded-xl bg-white/40 border border-black/5 flex flex-col justify-between gap-3">
        <div>
          <div class="font-bold text-sm">Overpayment Approvals</div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
            {#if pendingOverpayments.length > 0}
              <span class="text-purple-700 font-bold">{pendingOverpayments.length} Surplus Approval(s) Pending</span>
            {:else}
              No pending overpayment surplus
            {/if}
          </div>
        </div>
        <a href="/settlements">
          <Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={pendingOverpayments.length === 0}>
            Approve Overpayments
          </Button>
        </a>
      </div>

      <div class="p-4 rounded-xl bg-white/40 border border-black/5 flex flex-col justify-between gap-3">
        <div>
          <div class="font-bold text-sm">High-Value Stale Reviews</div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
            {#if highValueStaleCount > 0}
              <span class="text-amber-700 font-bold">{highValueStaleCount} Entries (>৳50k) Pending</span>
            {:else}
              No flagged high-value reviews
            {/if}
          </div>
        </div>
        <a href="/admin/stale-reviews">
          <Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={highValueStaleCount === 0}>
            Review Stale Entries
          </Button>
        </a>
      </div>

      <div class="p-4 rounded-xl bg-white/40 border border-black/5 flex flex-col justify-between gap-3">
        <div>
          <div class="font-bold text-sm">Month Close Readiness</div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
            {unclosedMonths.length > 0 ? `${unclosedMonths.length} historical month(s) open` : 'All past months locked'}
          </div>
        </div>
        <a href="/months/close">
          <Button variant="commission" class="w-full text-xs py-2 px-3 min-h-[44px]">
            Check Readiness
          </Button>
        </a>
      </div>
    </div>
  </Card>
</div>
