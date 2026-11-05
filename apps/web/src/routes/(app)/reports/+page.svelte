<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import PayablesSummaryTable from '$lib/ui/PayablesSummaryTable.svelte';
  import {
    db,
    type LocalEntry,
    type CachedPayable,
    type CachedPaymentMethod,
    type CachedSettlement,
    type CachedAppSettings,
  } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { computeMonthlyAggregates, computeMonthOverMonthDelta, MonthSchema } from '$lib/reports/aggregates';
  import { exportMonthlyReportCsv } from '$lib/reports/export-csv';
  import { exportMonthlyReportXlsx } from '$lib/reports/export-xlsx';
  import { triggerPrintStatement } from '$lib/reports/export-pdf';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';
  import { goto } from '$app/navigation';

  // Default to current month in Asia/Dhaka timezone (PRD §8.3)
  const currentDhakaMonth = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
      .format(new Date())
      .slice(0, 7);

  // Helper to compute previous month (YYYY-MM) safely handling year boundaries
  function getPriorMonthString(monthStr: string): string {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  // Helper to compute next month (YYYY-MM) safely handling year boundaries
  function getNextMonthString(monthStr: string): string {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function getChipVariant(
    code?: string
  ): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (
      lower === 'bkash' ||
      lower === 'visa' ||
      lower === 'mastercard' ||
      lower === 'vat' ||
      lower === 'commission'
    ) {
      return lower;
    }
    return 'default';
  }

  let selectedMonth = $state(currentDhakaMonth());
  let monthEntries = $state<LocalEntry[]>([]);
  let priorMonthEntries = $state<LocalEntry[]>([]);
  let payables = $state<CachedPayable[]>([]);
  let paymentMethods = $state<CachedPaymentMethod[]>([]);
  let settlements = $state<CachedSettlement[]>([]);
  let appSettings = $state<CachedAppSettings | null>(null);

  // Validate and sanitize selected month input (PRD §8.3, Hard Rule 11)
  const validMonth = $derived.by(() => {
    try {
      return MonthSchema.parse(selectedMonth);
    } catch {
      return currentDhakaMonth();
    }
  });

  const priorMonth = $derived(getPriorMonthString(validMonth));

  // Role Guard: Reports screen restricted strictly to Admin and Owner (PRD §3, §8.5)
  const isAuthorized = $derived(session.user?.role === 'admin' || session.user?.role === 'owner');

  // Static configuration caches (runs once while authorized)
  $effect(() => {
    if (!isAuthorized) return;

    const subPayables = liveQuery(() => db.payables.toArray()).subscribe((rows) => {
      payables = rows;
    });
    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      paymentMethods = rows;
    });
    const subSettings = liveQuery(() => db.appSettings.toArray()).subscribe((rows) => {
      appSettings = rows[0] ?? null;
    });

    return () => {
      subPayables.unsubscribe();
      subMethods.unsubscribe();
      subSettings.unsubscribe();
    };
  });

  // Month-scoped reactive queries on Dexie (Performance optimization avoiding whole-table scans)
  $effect(() => {
    if (!isAuthorized) return;

    const startCurrent = `${validMonth}-01`;
    const endCurrent = `${validMonth}-31`;
    const startPrior = `${priorMonth}-01`;
    const endPrior = `${priorMonth}-31`;

    const subCurrent = liveQuery(() =>
      db.entries.where('entry_date').between(startCurrent, endCurrent, true, true).toArray()
    ).subscribe((rows) => {
      monthEntries = rows;
    });

    const subPrior = liveQuery(() =>
      db.entries.where('entry_date').between(startPrior, endPrior, true, true).toArray()
    ).subscribe((rows) => {
      priorMonthEntries = rows;
    });

    const subSettlements = liveQuery(() =>
      db.settlements.where('month').equals(`${validMonth}-01`).toArray()
    ).subscribe((rows) => {
      settlements = rows;
    });

    return () => {
      subCurrent.unsubscribe();
      subPrior.unsubscribe();
      subSettlements.unsubscribe();
    };
  });

  const methodsMap = $derived.by(() => {
    const map: Record<string, CachedPaymentMethod> = {};
    for (const m of paymentMethods) {
      map[m.id] = m;
    }
    return map;
  });

  // Dynamic net label with strict fallback to DDL default 'Net after deductions' (PRD §8.3, §8.6, Table 18)
  const netLabel = $derived(appSettings?.net_label || 'Net after deductions');

  const aggregates = $derived(computeMonthlyAggregates(monthEntries, validMonth, methodsMap));

  const priorAggregates = $derived(
    computeMonthlyAggregates(priorMonthEntries, priorMonth, methodsMap)
  );

  const momDelta = $derived(computeMonthOverMonthDelta(aggregates, priorAggregates));

  // Active entries for table list and export
  const activeMonthEntries = $derived(
    monthEntries.filter((e) => e.status === 'active' && e.sync_status !== 'rejected')
  );

  function handlePrevMonth() {
    selectedMonth = getPriorMonthString(validMonth);
  }

  function handleNextMonth() {
    selectedMonth = getNextMonthString(validMonth);
  }

  function handleDrillDown(methodId?: string) {
    const base = `/ledger?month=${encodeURIComponent(validMonth)}&status=active`;
    if (methodId) {
      goto(`${base}&method=${encodeURIComponent(methodId)}`);
    } else {
      goto(base);
    }
  }

  function handleCsvExport() {
    exportMonthlyReportCsv(activeMonthEntries, validMonth, methodsMap);
  }

  function handleXlsxExport() {
    exportMonthlyReportXlsx(activeMonthEntries, validMonth, methodsMap);
  }

  // Max daily gross for the trend chart bar scaling (PRD §8.3)
  const maxDailyGross = $derived(
    aggregates.dailyBreakdowns.reduce((max, d) => (d.grossPoisha > max ? d.grossPoisha : max), 1n)
  );

  // Generation timestamp for print statement header
  const generationTimestamp = $derived(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date())
  );
</script>

<div class="reports-page p-6 max-w-6xl mx-auto w-full">
  {#if session.loading}
    <div class="flex items-center justify-center p-12">
      <div
        class="inline-block w-8 h-8 border-4 border-current border-t-transparent rounded-full animate-spin text-[var(--accent)]"
        aria-label="Loading reports..."
      ></div>
    </div>
  {:else if !isAuthorized}
    <div class="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl max-w-md mx-auto mt-12">
      <span class="text-3xl mb-2 block">🔒</span>
      <h2 class="text-base font-bold text-amber-900 dark:text-amber-200">Access Restricted</h2>
      <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
        Monthly Reports and Settlement Statements are restricted to Admin and Owner roles. Staff access
        personal metrics from the Staff Dashboard.
      </p>
      <Button variant="default" class="mt-4" onclick={() => goto('/dashboard')}>
        Back to Dashboard
      </Button>
    </div>
  {:else}
    <!-- Printable Statement Header (Visible only in print mode) -->
    <div class="print-only mb-6 pb-4 border-b border-black">
      <div class="flex justify-between items-start">
        <div>
          <h1 class="text-2xl font-bold text-black uppercase tracking-tight">
            {appSettings?.organization_name || 'Cosmo Ledger Track'}
          </h1>
          <p class="text-xs text-black/70">
            {appSettings?.business_address || 'Dhaka, Bangladesh'}
            {#if appSettings?.vat_registration_no}
              &bull; BIN / VAT Reg: {appSettings.vat_registration_no}
            {/if}
          </p>
        </div>
        <div class="text-right">
          <div class="text-lg font-bold text-black">MONTHLY FINANCIAL STATEMENT</div>
          <div class="text-xs font-mono text-black/70">Statement Month: {validMonth}</div>
          <div class="text-[10px] text-black/50">Printed: {generationTimestamp} (Asia/Dhaka)</div>
        </div>
      </div>
    </div>

    <!-- Header & Interactive Toolbar (Hidden in print) -->
    <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Monthly Reports</h1>
        <p class="text-sm text-[var(--muted)]">
          Aggregated financial statements, daily breakdown, and settlement payables.
        </p>
      </div>

      <div class="flex items-center flex-wrap gap-2">
        <Button variant="default" onclick={handlePrevMonth} aria-label="Previous month">◀</Button>
        <input
          type="month"
          aria-label="Select report month"
          bind:value={selectedMonth}
          class="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-bold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <Button variant="default" onclick={handleNextMonth} aria-label="Next month">▶</Button>
        <Button variant="default" onclick={handleCsvExport}>Export CSV</Button>
        <Button variant="default" onclick={handleXlsxExport}>Export Excel</Button>
        <Button variant="commission" onclick={triggerPrintStatement}>Print PDF</Button>
      </div>
    </div>

    <!-- Unsynced Pending Transactions Notice -->
    {#if aggregates.pendingEntriesCount > 0}
      <div
        class="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between no-print"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm">⏳</span>
          <span class="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Includes {aggregates.pendingEntriesCount} unsynced pending {aggregates.pendingEntriesCount === 1
              ? 'transaction'
              : 'transactions'}.
          </span>
        </div>
        <span class="text-[10px] text-amber-700/80 dark:text-amber-400/80">Totals include local offline entries</span>
      </div>
    {/if}

    <!-- Summary Cards with MoM Deltas & Drill-Down (PRD §8.3) -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">Total Collected (Gross)</div>
          <div class="text-xl font-bold tabular-nums text-[var(--ink)]">
            {formatPoishaToBdt(aggregates.totalGrossPoisha)}
          </div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">{aggregates.totalEntries} txns ↗</span>
            {#if momDelta.grossDeltaPercent !== null}
              <span
                class="text-[10px] font-bold tabular-nums {momDelta.grossDeltaPercent >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'}"
              >
                {momDelta.grossDeltaPercent >= 0 ? '↑' : '↓'} {Math.abs(momDelta.grossDeltaPercent)}% MoM
              </span>
            {/if}
          </div>
        </Card>
      </button>

      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">Total Units / Qty</div>
          <div class="text-xl font-bold tabular-nums text-[var(--ink)]">{aggregates.totalSubQty}</div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">Sum of sub_qty units ↗</span>
            <span class="text-[10px] font-mono text-[var(--muted)]">
              Avg
              {(aggregates.totalEntries > 0
                ? (aggregates.totalSubQty / aggregates.totalEntries).toFixed(1)
                : 0)}
              / txn
            </span>
          </div>
        </Card>
      </button>

      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">Commission Earned</div>
          <div class="text-xl font-bold tabular-nums text-[var(--c-commission)]">
            {formatPoishaToBdt(aggregates.totalCommissionPoisha)}
          </div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">From rate profile ↗</span>
            {#if momDelta.commissionDeltaPercent !== null}
              <span
                class="text-[10px] font-bold tabular-nums {momDelta.commissionDeltaPercent >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'}"
              >
                {momDelta.commissionDeltaPercent >= 0 ? '↑' : '↓'} {Math.abs(momDelta.commissionDeltaPercent)}% MoM
              </span>
            {/if}
          </div>
        </Card>
      </button>

      <button
        type="button"
        onclick={() => handleDrillDown()}
        class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      >
        <Card class="p-5 hover:border-[var(--accent)] transition-colors h-full">
          <div class="text-xs font-semibold text-[var(--muted)] mb-1">{netLabel}</div>
          <div class="text-xl font-bold tabular-nums text-[var(--accent)]">
            {formatPoishaToBdt(aggregates.totalNetPoisha)}
          </div>
          <div class="flex items-center justify-between mt-2 pt-2 border-t border-black/5 dark:border-white/5">
            <span class="text-[10px] text-[var(--muted)]">Net revenue ↗</span>
            {#if momDelta.netDeltaPercent !== null}
              <span
                class="text-[10px] font-bold tabular-nums {momDelta.netDeltaPercent >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'}"
              >
                {momDelta.netDeltaPercent >= 0 ? '↑' : '↓'} {Math.abs(momDelta.netDeltaPercent)}% MoM
              </span>
            {/if}
          </div>
        </Card>
      </button>
    </div>

    <!-- Daily Trend Visual Chart (PRD §8.3) -->
    {#if aggregates.dailyBreakdowns.length > 0}
      <div class="mb-6 no-print">
        <Card class="p-6">
          <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
            <div>
              <h2 class="text-base font-bold text-[var(--ink)]">Daily Collections Trend</h2>
              <p class="text-xs text-[var(--muted)]">Daily gross collections across {validMonth}.</p>
            </div>
            <span class="text-xs text-[var(--muted)]">{aggregates.dailyBreakdowns.length} active days</span>
          </div>

          <div class="h-28 flex items-end gap-1.5 pt-4 overflow-x-auto">
            {#each aggregates.dailyBreakdowns as day (day.date)}
              {@const heightPercent = Number((day.grossPoisha * 100n) / maxDailyGross)}
              <div class="flex-1 min-w-[20px] flex flex-col items-center gap-1 group relative">
                <!-- Tooltip -->
                <div
                  class="absolute bottom-full mb-1 hidden group-hover:block z-10 p-2 rounded bg-black/90 text-white text-[10px] whitespace-nowrap shadow-lg"
                >
                  <div class="font-bold">{day.date}</div>
                  <div>Gross: {formatPoishaToBdt(day.grossPoisha)}</div>
                  <div>Net: {formatPoishaToBdt(day.netPoisha)}</div>
                  <div>Txns: {day.entryCount}</div>
                </div>
                <!-- Bar -->
                <div
                  style="height: {Math.max(heightPercent, 4)}%"
                  class="w-full rounded-t bg-[var(--accent)]/70 group-hover:bg-[var(--accent)] transition-all"
                ></div>
                <!-- Day Label -->
                <span class="text-[9px] font-mono text-[var(--muted)]">{day.date.slice(8)}</span>
              </div>
            {/each}
          </div>
        </Card>
      </div>
    {/if}

    <!-- Payables Summary Table with Canonical Payables & 5-State Badges -->
    <div class="mb-6">
      <PayablesSummaryTable
        selectedMonth={validMonth}
        {payables}
        {methodsMap}
        {settlements}
        monthlyVatPoisha={aggregates.totalVatPoisha}
        monthlyVatEntryCount={aggregates.vatEntriesCount}
        methodCharges={aggregates.methodCharges}
        ondrilldown={handleDrillDown}
      />
    </div>

    <!-- Payment Method Volumes & Charges Breakdown (PRD §8.3) -->
    <div class="mb-6">
      <Card class="p-6">
        <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
          <div>
            <h2 class="text-base font-bold text-[var(--ink)]">Payment Method Volumes &amp; Merchant Charges</h2>
            <p class="text-xs text-[var(--muted)]">Turnover and deductions partitioned by provider.</p>
          </div>
          <span class="text-xs text-[var(--muted)]">Month: {validMonth}</span>
        </div>

        {#if aggregates.methodCharges.length === 0}
          <div class="p-8 text-center text-sm text-[var(--muted)]">
            No transactions recorded for {validMonth}.
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            {#each aggregates.methodCharges as mc (mc.methodId)}
              {@const m = methodsMap[mc.methodId]}
              <button
                type="button"
                onclick={() => handleDrillDown(mc.methodId)}
                class="text-left w-full cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
              >
                <div
                  class="p-4 rounded-xl border border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 hover:border-[var(--accent)] transition-colors h-full"
                >
                  <div class="flex items-center justify-between mb-3">
                    <div class="font-bold text-sm text-[var(--ink)] flex items-center gap-2">
                      <Chip variant={getChipVariant(m?.code)}>
                        {m?.code ?? mc.methodCode}
                      </Chip>
                      <span>{m?.name ?? mc.methodId}</span>
                    </div>
                    <span class="text-xs text-[var(--muted)] tabular-nums">{mc.entryCount} txns</span>
                  </div>

                  <div class="space-y-1.5 text-xs">
                    <div class="flex justify-between">
                      <span class="text-[var(--muted)]">Turnover Volume:</span>
                      <span class="font-bold tabular-nums text-[var(--ink)]">
                        {formatPoishaToBdt(mc.totalGrossPoisha)}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-[var(--muted)]">Business Fee Borne:</span>
                      <span class="font-bold tabular-nums text-red-600 dark:text-red-400">
                        {formatPoishaToBdt(mc.totalBusinessChargePoisha)}
                      </span>
                    </div>
                    {#if mc.totalCustomerChargePoisha > 0n}
                      <div class="flex justify-between text-[11px] text-blue-600 dark:text-blue-400">
                        <span>Customer Paid:</span>
                        <span class="tabular-nums font-semibold">
                          {formatPoishaToBdt(mc.totalCustomerChargePoisha)}
                        </span>
                      </div>
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </Card>
    </div>

    <!-- Customer-Borne Provider Fees Informational Section (PRD §8.3) -->
    {#if aggregates.totalCustomerChargesPoisha > 0n}
      <div class="mb-6">
        <Card class="p-5 border-blue-500/20 bg-blue-500/5">
          <div class="flex items-start gap-3">
            <span class="text-lg">ℹ️</span>
            <div>
              <div class="text-sm font-bold text-blue-900 dark:text-blue-300">
                Customer-Paid Provider Fees: {formatPoishaToBdt(aggregates.totalCustomerChargesPoisha)}
              </div>
              <p class="text-xs text-blue-700/80 dark:text-blue-400/80 mt-1">
                These provider charges were borne directly by customers at the point of sale. They create zero
                merchant payable liability and are excluded from business settlement balances.
              </p>
            </div>
          </div>
        </Card>
      </div>
    {/if}

    <!-- Daily Cash Reconciliation Breakdown Table (PRD §8.3) -->
    <div class="mb-6">
      <Card class="p-6">
        <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
          <div>
            <h2 class="text-base font-bold text-[var(--ink)]">Daily Cash Reconciliation Breakdown</h2>
            <p class="text-xs text-[var(--muted)]">Daily component totals for cash drawer reconciliation.</p>
          </div>
          <span class="text-xs text-[var(--muted)] font-mono">{validMonth}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="text-[var(--muted)] border-b border-black/5 dark:border-white/5 uppercase tracking-wider">
                <th class="pb-2">Date</th>
                <th class="pb-2 text-center">Txns</th>
                <th class="pb-2 text-center">Units</th>
                <th class="pb-2 text-right">Gross</th>
                <th class="pb-2 text-right">VAT</th>
                <th class="pb-2 text-right">Commission</th>
                <th class="pb-2 text-right">Business Fee</th>
                <th class="pb-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono">
              {#each aggregates.dailyBreakdowns as day (day.date)}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-2 font-bold text-[var(--ink)]">{day.date}</td>
                  <td class="py-2 text-center tabular-nums">{day.entryCount}</td>
                  <td class="py-2 text-center tabular-nums">{day.subQty}</td>
                  <td class="py-2 text-right tabular-nums text-[var(--ink)]">
                    {formatPoishaToBdt(day.grossPoisha)}
                  </td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-vat)]">
                    {formatPoishaToBdt(day.vatPoisha)}
                  </td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-commission)]">
                    {formatPoishaToBdt(day.commissionPoisha)}
                  </td>
                  <td class="py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                    {formatPoishaToBdt(day.businessChargePoisha)}
                  </td>
                  <td class="py-2 text-right tabular-nums font-bold text-[var(--accent)]">
                    {formatPoishaToBdt(day.netPoisha)}
                  </td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t-2 border-black/10 dark:border-white/10 font-bold text-[var(--ink)] font-mono">
              <tr>
                <td class="py-2 uppercase">TOTALS</td>
                <td class="py-2 text-center tabular-nums">{aggregates.totalEntries}</td>
                <td class="py-2 text-center tabular-nums">{aggregates.totalSubQty}</td>
                <td class="py-2 text-right tabular-nums">{formatPoishaToBdt(aggregates.totalGrossPoisha)}</td>
                <td class="py-2 text-right tabular-nums text-[var(--c-vat)]">
                  {formatPoishaToBdt(aggregates.totalVatPoisha)}
                </td>
                <td class="py-2 text-right tabular-nums text-[var(--c-commission)]">
                  {formatPoishaToBdt(aggregates.totalCommissionPoisha)}
                </td>
                <td class="py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                  {formatPoishaToBdt(aggregates.totalBusinessChargesPoisha)}
                </td>
                <td class="py-2 text-right tabular-nums text-[var(--accent)]">
                  {formatPoishaToBdt(aggregates.totalNetPoisha)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>

    <!-- Detailed Monthly Entry List with Fixed Totals Row (PRD §8.3, §16.3 #2) -->
    <div class="mb-6">
      <Card class="p-6">
        <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
          <div>
            <h2 class="text-base font-bold text-[var(--ink)]">Detailed Monthly Transactions</h2>
            <p class="text-xs text-[var(--muted)]">Full entry ledger asserting exact parity with summary cards.</p>
          </div>
          <span class="text-xs text-[var(--muted)]">{activeMonthEntries.length} entries</span>
        </div>

        <div class="overflow-x-auto max-h-[500px]">
          <table class="w-full text-left text-xs">
            <thead
              class="sticky top-0 bg-white dark:bg-[var(--pearl-c)] z-10 border-b border-black/10 dark:border-white/10"
            >
              <tr class="text-[var(--muted)] uppercase tracking-wider">
                <th class="py-2">Entry #</th>
                <th class="py-2">Date</th>
                <th class="py-2">Customer</th>
                <th class="py-2 text-center">Qty</th>
                <th class="py-2">Method</th>
                <th class="py-2 text-right">Gross</th>
                <th class="py-2 text-right">VAT</th>
                <th class="py-2 text-right">Commission</th>
                <th class="py-2 text-right">Fee</th>
                <th class="py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono">
              {#each activeMonthEntries as entry (entry.id)}
                {@const m = methodsMap[entry.method_id]}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-2 font-bold text-[var(--ink)]">{entry.entry_number ?? entry.local_id}</td>
                  <td class="py-2 text-[var(--muted)]">{entry.entry_date}</td>
                  <td class="py-2 font-sans font-medium text-[var(--ink)]">{entry.customer_name}</td>
                  <td class="py-2 text-center tabular-nums">{entry.sub_qty}</td>
                  <td class="py-2 font-sans">
                    <Chip variant={getChipVariant(m?.code)}>
                      {m?.code ?? entry.method_id}
                    </Chip>
                  </td>
                  <td class="py-2 text-right tabular-nums text-[var(--ink)]">
                    {formatPoishaToBdt(BigInt(entry.gross_poisha))}
                  </td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-vat)]">
                    {formatPoishaToBdt(BigInt(entry.vat_poisha))}
                  </td>
                  <td class="py-2 text-right tabular-nums text-[var(--c-commission)]">
                    {formatPoishaToBdt(BigInt(entry.commission_poisha))}
                  </td>
                  <td class="py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                    {formatPoishaToBdt(BigInt(entry.business_charge_poisha))}
                  </td>
                  <td class="py-2 text-right tabular-nums font-bold text-[var(--accent)]">
                    {formatPoishaToBdt(BigInt(entry.net_poisha))}
                  </td>
                </tr>
              {/each}
            </tbody>
            <!-- Sticky Totals Row Asserting Parity (PRD §8.3, §16.3 #2) -->
            <tfoot
              class="sticky bottom-0 bg-white dark:bg-[var(--pearl-c)] border-t-2 border-black/20 dark:border-white/20 font-mono font-bold text-[var(--ink)]"
            >
              <tr>
                <td class="py-3 uppercase">TOTALS</td>
                <td class="py-3"></td>
                <td class="py-3"></td>
                <td class="py-3 text-center tabular-nums">{aggregates.totalSubQty}</td>
                <td class="py-3"></td>
                <td class="py-3 text-right tabular-nums">{formatPoishaToBdt(aggregates.totalGrossPoisha)}</td>
                <td class="py-3 text-right tabular-nums text-[var(--c-vat)]">
                  {formatPoishaToBdt(aggregates.totalVatPoisha)}
                </td>
                <td class="py-3 text-right tabular-nums text-[var(--c-commission)]">
                  {formatPoishaToBdt(aggregates.totalCommissionPoisha)}
                </td>
                <td class="py-3 text-right tabular-nums text-red-600 dark:text-red-400">
                  {formatPoishaToBdt(aggregates.totalBusinessChargesPoisha)}
                </td>
                <td class="py-3 text-right tabular-nums text-[var(--accent)]">
                  {formatPoishaToBdt(aggregates.totalNetPoisha)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  {/if}
</div>

<style>
  /* Header visible only during paper print */
  .print-only {
    display: none;
  }

  /* Clean Print Media Stylesheet (PRD §8.3) */
  @media print {
    :global(aside),
    :global(nav),
    :global(#floating-action-menu),
    :global(.no-print) {
      display: none !important;
    }

    .print-only {
      display: block !important;
    }

    :global(.overflow-x-auto) {
      overflow: visible !important;
      max-height: none !important;
    }

    :global(.reports-page) {
      padding: 0 !important;
      max-width: 100% !important;
    }

    /* Universal Print Reset: Prevent dark-theme near-white text on white paper */
    :global(*) {
      color: #000000 !important;
      background-color: transparent !important;
      text-shadow: none !important;
      box-shadow: none !important;
    }

    :global(body),
    .reports-page,
    :global(.glass) {
      background: #ffffff !important;
      color: #000000 !important;
      box-shadow: none !important;
      border-color: #000000 !important;
      backdrop-filter: none !important;
    }

    :global(thead) {
      display: table-header-group;
    }

    :global(tr) {
      page-break-inside: avoid;
    }

    :global(tfoot) {
      display: table-footer-group;
    }
  }
</style>
