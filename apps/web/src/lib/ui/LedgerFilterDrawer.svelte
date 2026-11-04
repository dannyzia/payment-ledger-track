<script lang="ts">
  import type { CachedPaymentMethod, CachedProfile } from '$lib/db';
  import type { LedgerFilters } from '$lib/ledger/types';
  import Button from '$lib/ui/Button.svelte';

  interface Props {
    open: boolean;
    filters: LedgerFilters;
    methods: CachedPaymentMethod[];
    profiles: CachedProfile[];
    isAdmin: boolean;
    onclose: () => void;
    onapply: (filters: LedgerFilters) => void;
    onreset: () => void;
  }

  let {
    open = $bindable(false),
    filters,
    methods,
    profiles,
    isAdmin,
    onclose,
    onapply,
    onreset,
  }: Props = $props();

  let draft = $state<LedgerFilters>({});

  $effect(() => {
    draft = { ...filters };
  });

  function handleReset() {
    draft = {
      startDate: undefined,
      endDate: undefined,
      methodId: undefined,
      createdBy: undefined,
      status: 'all',
      flagDuplicateTxn: false,
      flagStaleRates: false,
    };
    onreset();
  }

  function handleApply() {
    onapply(draft);
    onclose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
    onclick={onclose}
    role="presentation"
  ></div>

  <!-- Drawer -->
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Transaction filters"
    class="filter-drawer fixed inset-y-0 right-0 z-50 max-w-sm w-full glass bg-white/95 dark:bg-stone-900/95 p-6 shadow-2xl flex flex-col justify-between border-l border-black/10 dark:border-white/10"
  >
    <div class="flex flex-col gap-5 overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
        <h2 class="text-lg font-bold text-[var(--ink)]">Filter Transactions</h2>
        <button
          type="button"
          aria-label="Close filters"
          onclick={onclose}
          class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 text-[var(--muted)]"
        >
          ✕
        </button>
      </div>

      <!-- Date Range -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Date Range</span>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <span class="text-[11px] text-[var(--muted)] block mb-1">From</span>
            <input
              type="date"
              bind:value={draft.startDate}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
            />
          </div>
          <div>
            <span class="text-[11px] text-[var(--muted)] block mb-1">To</span>
            <input
              type="date"
              bind:value={draft.endDate}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
            />
          </div>
        </div>
      </div>

      <!-- Payment Method -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Payment Method</span>
        <select
          bind:value={draft.methodId}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        >
          <option value={undefined}>All Methods</option>
          {#each methods as m (m.id)}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </div>

      <!-- Creator Staff Dropdown (Admin/Owner only per PRD §8.5) -->
      {#if isAdmin}
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Creator Staff</span>
          <select
            bind:value={draft.createdBy}
            class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
          >
            <option value={undefined}>All Staff</option>
            {#each profiles as p (p.id)}
              <option value={p.id}>{p.display_name} ({p.role})</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- Status -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Status</span>
        <select
          bind:value={draft.status}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="pending_sync">Pending Sync Only</option>
          <option value="rejected">Sync Rejected Only</option>
          <option value="voided">Voided Only</option>
          <option value="superseded">Superseded Only</option>
        </select>
      </div>

      <!-- Flags -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Flags</span>
        <label class="flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer">
          <input type="checkbox" bind:checked={draft.flagDuplicateTxn} class="rounded border-gray-300" />
          <span>Duplicate Txn Ref Flagged</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer">
          <input type="checkbox" bind:checked={draft.flagStaleRates} class="rounded border-gray-300" />
          <span>Stale Rate Profile (Offline)</span>
        </label>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between pt-4 border-t border-black/10 dark:border-white/10 gap-3">
      <Button variant="default" onclick={handleReset}>Reset</Button>
      <Button variant="default" onclick={handleApply}>Apply Filters</Button>
    </div>
  </div>
{/if}
