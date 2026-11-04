<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    grossPoisha: bigint;
    vatPoisha: bigint;
    commissionPoisha: bigint;
    chargePoisha: bigint;
    netPoisha: bigint;
    chargesBorneBy: 'business' | 'customer';
    methodName: string;
    vatMode?: string | undefined;
    vatBp?: number | undefined;
    commissionBp?: number | undefined;
    chargeBp?: number | undefined;
  }

  let {
    grossPoisha,
    vatPoisha,
    commissionPoisha,
    chargePoisha,
    netPoisha,
    chargesBorneBy,
    methodName,
    vatMode = 'manual',
    vatBp,
    commissionBp,
    chargeBp,
  }: Props = $props();
</script>

<div class="receipt-breakdown">
  <Card class="p-5 border-dashed border-2 border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/20">
    <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10 mb-4">
      <span class="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Live Calculation Breakdown</span>
      <span class="text-[11px] font-mono text-[var(--muted)]">Engine v1</span>
    </div>

    <div class="space-y-2.5 text-xs font-mono">
      <!-- Gross -->
      <div class="flex justify-between items-center">
        <span class="font-sans font-medium text-[var(--ink)]">Gross Collected</span>
        <span class="font-semibold text-sm text-[var(--ink)]">{formatPoishaToBdt(grossPoisha)}</span>
      </div>

      <!-- VAT Deduction (Safe decimal percentage format without BigInt division crash) -->
      <div class="flex justify-between items-center text-[var(--muted)]">
        <span class="font-sans">
          VAT ({vatMode === 'manual' ? 'manual' : `${((vatBp ?? 0) / 100).toFixed(2)}%`})
        </span>
        <span class="text-amber-800 dark:text-amber-400">
          {vatPoisha > 0n ? `-${formatPoishaToBdt(vatPoisha)}` : formatPoishaToBdt(0n)}
        </span>
      </div>

      <!-- Commission Deduction (minus sign per PRD §6.3 & §8.1) -->
      <div class="flex justify-between items-center text-[var(--muted)]">
        <span class="font-sans">Commission ({commissionBp !== undefined ? (commissionBp / 100).toFixed(2) : '0.00'}%)</span>
        <span class="text-emerald-800 dark:text-emerald-400">
          {commissionPoisha > 0n ? `-${formatPoishaToBdt(commissionPoisha)}` : formatPoishaToBdt(0n)}
        </span>
      </div>

      <!-- Provider Charge (deducted if business-borne, excluded if customer-borne) -->
      <div class="flex justify-between items-center text-[var(--muted)]">
        <span class="font-sans">
          {methodName} ({chargeBp !== undefined ? (chargeBp / 100).toFixed(2) : '0.00'}%)
        </span>
        {#if chargesBorneBy === 'customer'}
          <span class="text-blue-700 dark:text-blue-300">
            {formatPoishaToBdt(chargePoisha)} <span class="font-sans text-[10px]">(Customer-paid — not deducted)</span>
          </span>
        {:else}
          <span class="text-rose-700 dark:text-rose-400">
            {chargePoisha > 0n ? `-${formatPoishaToBdt(chargePoisha)}` : formatPoishaToBdt(0n)}
          </span>
        {/if}
      </div>

      <!-- Divider -->
      <div class="border-t border-dashed border-black/20 dark:border-white/20 pt-2.5 mt-2">
        <div class="flex justify-between items-center">
          <span class="font-sans font-bold text-xs uppercase tracking-wider text-[var(--ink)]">Net After Deductions</span>
          <span class="font-bold text-base text-[var(--ink)]">{formatPoishaToBdt(netPoisha)}</span>
        </div>
      </div>
    </div>
  </Card>
</div>
