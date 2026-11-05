<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import type { MethodChargeSummary } from '$lib/reports/aggregates';
  import type { CachedPayable, CachedPaymentMethod, CachedSettlement } from '$lib/db';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    selectedMonth: string; // YYYY-MM
    payables: CachedPayable[];
    methodsMap: Record<string, CachedPaymentMethod>;
    settlements: CachedSettlement[];
    monthlyVatPoisha: bigint;
    monthlyVatEntryCount: number;
    methodCharges: MethodChargeSummary[];
    ondrilldown?: (methodId?: string) => void;
  }

  let {
    selectedMonth,
    payables,
    methodsMap,
    settlements,
    monthlyVatPoisha,
    monthlyVatEntryCount,
    methodCharges,
    ondrilldown,
  }: Props = $props();

  const monthFirstDay = $derived(`${selectedMonth}-01`);

  interface PayableDisplayRow {
    id: string;
    name: string;
    kind: 'vat' | 'method_charge';
    methodCode?: string | undefined;
    entryCount: number;
    expectedPoisha: bigint;
    status: 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';
    statusSubtext?: string | undefined;
    drillDownMethodId?: string | undefined;
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

  const tableRows = $derived.by<PayableDisplayRow[]>(() => {
    const rows: PayableDisplayRow[] = [];

    // 1. VAT Payable Stream (PRD §8.3, §10)
    const vatPayable = payables.find((p) => p.kind === 'vat');
    const vatSettlement = settlements.find(
      (s) => s.month === monthFirstDay && s.payable_id === (vatPayable?.id ?? 'vat')
    );
    let vatStatus = vatSettlement?.status ?? (monthlyVatPoisha === 0n ? 'not_applicable' : 'due');
    let vatSubtext: string | undefined;
    if (vatSettlement?.status === 'paid' && monthlyVatPoisha > BigInt(vatSettlement.expected_poisha)) {
      vatStatus = 'partly_paid';
      const diff = monthlyVatPoisha - BigInt(vatSettlement.expected_poisha);
      vatSubtext = `+${formatPoishaToBdt(diff)} unsynced`;
    }

    rows.push({
      id: vatPayable?.id ?? 'vat-system-stream',
      name: vatPayable?.name ?? 'Government VAT Challan',
      kind: 'vat',
      entryCount: monthlyVatEntryCount,
      expectedPoisha: monthlyVatPoisha,
      status: vatStatus,
      statusSubtext: vatSubtext,
      drillDownMethodId: undefined,
    });

    // 2. Method Charge Payables (PRD §8.3, §10)
    // Iterate over all active method payables first to guarantee complete coverage
    const coveredMethodIds = new Set<string>();

    for (const p of payables.filter((pay) => pay.kind === 'method_charge')) {
      if (!p.method_id) continue;
      coveredMethodIds.add(p.method_id);

      const mc = methodCharges.find((m) => m.methodId === p.method_id);
      const method = methodsMap[p.method_id];
      const sett = settlements.find((s) => s.month === monthFirstDay && s.payable_id === p.id);

      const expectedPoisha = mc?.totalBusinessChargePoisha ?? 0n;
      const entryCount = mc?.entryCount ?? 0;

      let status = sett?.status ?? (expectedPoisha === 0n ? 'not_applicable' : 'due');
      let statusSubtext: string | undefined;
      if (sett?.status === 'paid' && expectedPoisha > BigInt(sett.expected_poisha)) {
        status = 'partly_paid';
        const diff = expectedPoisha - BigInt(sett.expected_poisha);
        statusSubtext = `+${formatPoishaToBdt(diff)} unsynced`;
      }

      rows.push({
        id: p.id,
        name: p.name,
        kind: 'method_charge',
        methodCode: method?.code ?? mc?.methodCode,
        entryCount,
        expectedPoisha,
        status,
        statusSubtext,
        drillDownMethodId: p.method_id,
      });
    }

    // Include unconfigured method streams from methodCharges so zero fee money is dropped
    for (const mc of methodCharges) {
      if (coveredMethodIds.has(mc.methodId)) continue;
      if (mc.totalBusinessChargePoisha === 0n && mc.entryCount === 0) continue;

      const method = methodsMap[mc.methodId];
      rows.push({
        id: `unconfigured-payable-${mc.methodId}`,
        name: method?.name
          ? `${method.name} Merchant Fee (Unassigned)`
          : 'Payment Provider Fee (Unassigned)',
        kind: 'method_charge',
        methodCode: method?.code ?? mc.methodCode,
        entryCount: mc.entryCount,
        expectedPoisha: mc.totalBusinessChargePoisha,
        status: mc.totalBusinessChargePoisha === 0n ? 'not_applicable' : 'due',
        statusSubtext: undefined,
        drillDownMethodId: mc.methodId,
      });
    }

    return rows;
  });

  type SettlementStatus = 'not_applicable' | 'due' | 'partly_paid' | 'paid' | 'overpaid';

  const statusBadges: Record<SettlementStatus, { label: string; cls: string }> = {
    not_applicable: { label: 'N/A', cls: 'bg-black/5 dark:bg-white/5 text-[var(--muted)]' },
    due: { label: 'Due', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold' },
    partly_paid: { label: 'Partly Paid', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold' },
    paid: { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold' },
    overpaid: { label: 'Overpaid', cls: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 font-semibold' },
  };

  function getStatusBadge(status: SettlementStatus) {
    return statusBadges[status];
  }
</script>

<div class="payables-table">
  <Card class="p-6">
    <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
      <div>
        <h2 class="text-base font-bold text-[var(--ink)]">Payables &amp; Liabilities Summary</h2>
        <p class="text-xs text-[var(--muted)]">Derived from active entries and monthly settlement records.</p>
      </div>
      <span class="text-xs text-[var(--muted)] font-mono">{monthFirstDay}</span>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="text-xs text-[var(--muted)] border-b border-black/5 dark:border-white/5 uppercase tracking-wider">
            <th class="pb-2">Payable Stream</th>
            <th class="pb-2 text-center">Txn Count</th>
            <th class="pb-2 text-right">Amount (Poisha)</th>
            <th class="pb-2 text-right">Amount (BDT)</th>
            <th class="pb-2 text-center">Status</th>
            <th class="pb-2 text-right no-print">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/5 dark:divide-white/5">
          {#each tableRows as row (row.id)}
            {@const badge = getStatusBadge(row.status)}
            <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
              <td class="py-3 font-semibold text-[var(--ink)]">
                <div class="flex items-center gap-2">
                  {#if row.kind === 'vat'}
                    <Chip variant="vat">VAT</Chip>
                  {:else if row.methodCode}
                    <Chip variant={getChipVariant(row.methodCode)}>
                      {row.methodCode}
                    </Chip>
                  {/if}
                  <span>{row.name}</span>
                </div>
              </td>
              <td class="py-3 text-center tabular-nums text-[var(--muted)]">
                {row.entryCount}
              </td>
              <td class="py-3 text-right font-mono tabular-nums text-xs text-[var(--muted)]">
                {row.expectedPoisha.toString()}
              </td>
              <td class="py-3 text-right font-bold tabular-nums text-[var(--ink)]">
                {formatPoishaToBdt(row.expectedPoisha)}
              </td>
              <td class="py-3 text-center">
                <span class="text-xs px-2.5 py-0.5 rounded-full {badge.cls}">
                  {badge.label}
                </span>
                {#if row.statusSubtext}
                  <div class="text-[10px] text-amber-600 dark:text-amber-400 font-mono mt-0.5">
                    {row.statusSubtext}
                  </div>
                {/if}
              </td>
              <td class="py-3 text-right no-print">
                <button
                  type="button"
                  onclick={() => ondrilldown?.(row.drillDownMethodId)}
                  class="text-xs text-[var(--accent)] hover:underline font-medium cursor-pointer"
                >
                  View Entries ↗
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>
</div>
