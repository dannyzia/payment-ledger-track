<script lang="ts">
  import type { LocalEntry, CachedPaymentMethod } from '$lib/db';
  import Chip from '$lib/ui/Chip.svelte';
  import type { ChipVariant } from '$lib/ledger/types';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    entry: LocalEntry;
    methodsMap: Record<string, CachedPaymentMethod>;
    onselect: (entry: LocalEntry) => void;
  }

  let { entry, methodsMap, onselect }: Props = $props();

  const isVoided = $derived(entry.status === 'voided');
  const isSuperseded = $derived(entry.status === 'superseded');

  const method = $derived(methodsMap[entry.method_id]);
  const methodName = $derived(
    method?.name ?? (entry.method_id ? entry.method_id.substring(0, 8) : 'Method'),
  );
  const chipVariant = $derived<ChipVariant>(
    method && ['bkash', 'visa', 'mastercard'].includes(method.code.toLowerCase())
      ? (method.code.toLowerCase() as 'bkash' | 'visa' | 'mastercard')
      : 'default',
  );

  const deductionsPoisha = $derived(BigInt(entry.gross_poisha) - BigInt(entry.net_poisha));
</script>

<div
  role="button"
  tabindex="0"
  onclick={() => onselect(entry)}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') onselect(entry);
  }}
  class="ledger-row p-4 rounded-xl glass border border-black/5 dark:border-white/5 flex items-center justify-between gap-4 cursor-pointer hover:border-[var(--accent)] transition-colors {isVoided
    ? 'opacity-40 line-through'
    : ''} {isSuperseded ? 'opacity-50' : ''}"
>
  <div class="flex items-center gap-3 min-w-0">
    <div class="font-mono text-xs font-bold text-[var(--muted)] shrink-0">
      {entry.entry_number ?? entry.local_id}
    </div>
    <div class="min-w-0">
      <div class="font-bold text-sm text-[var(--ink)] truncate flex items-center gap-2">
        <span>{entry.customer_name}</span>
        {#if isVoided}
          <span
            class="text-[10px] px-1.5 py-0.2 rounded bg-slate-500/15 text-slate-600 dark:text-slate-300 font-medium shrink-0"
          >
            Voided
          </span>
        {:else if isSuperseded}
          <span
            class="text-[10px] px-1.5 py-0.2 rounded bg-slate-500/15 text-slate-600 dark:text-slate-300 font-medium shrink-0"
          >
            Superseded
          </span>
        {/if}
        {#if entry.sync_status === 'pending'}
          <span
            class="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium shrink-0"
          >
            Pending Sync
          </span>
        {:else if entry.sync_status === 'rejected'}
          <span
            class="text-[10px] px-1.5 py-0.2 rounded bg-red-500/10 text-red-700 dark:text-red-400 font-medium shrink-0"
          >
            Sync Rejected
          </span>
        {/if}
        {#if entry.stale_rates}
          <span
            class="text-[10px] px-1.5 py-0.2 rounded bg-orange-500/10 text-orange-700 dark:text-orange-400 font-medium shrink-0"
          >
            Stale Rate
          </span>
        {/if}
        {#if entry.dup_txn_flag}
          <span
            class="text-[10px] px-1.5 py-0.2 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium shrink-0"
          >
            Dup Txn
          </span>
        {/if}
      </div>
      <div class="text-xs text-[var(--muted)] flex items-center gap-2">
        <span>Units: {entry.sub_qty}</span>
        {#if entry.txn_ref}
          <span class="font-mono truncate">Ref: {entry.txn_ref}</span>
        {/if}
        {#if entry.void_requested_by && !isVoided}
          <span class="text-amber-600 font-medium text-[11px]">(Void Requested)</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex items-center gap-4 shrink-0">
    <Chip variant={chipVariant}>{methodName}</Chip>

    {#if entry.customer_charge_poisha && entry.customer_charge_poisha !== '0'}
      <span
        class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
      >
        [Customer Fee]
      </span>
    {/if}

    <div class="text-right">
      <div class="font-bold text-sm tabular-nums text-[var(--ink)]">
        {formatPoishaToBdt(BigInt(entry.gross_poisha))}
      </div>
      <div class="text-xs tabular-nums text-red-600 dark:text-red-400">
        Deductions: -{formatPoishaToBdt(deductionsPoisha)}
      </div>
      <div class="text-xs tabular-nums text-[var(--accent)] font-semibold">
        Net: {formatPoishaToBdt(BigInt(entry.net_poisha))}
      </div>
    </div>
  </div>
</div>
