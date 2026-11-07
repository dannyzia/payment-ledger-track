<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LocalEntry, CachedPaymentMethod, CachedProfile } from '$lib/db';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import type { ChipVariant } from '$lib/ledger/types';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    entry: LocalEntry | null;
    allEntries: LocalEntry[];
    role: 'staff' | 'admin' | 'owner';
    currentUserId: string;
    methodsMap: Record<string, CachedPaymentMethod>;
    profilesMap: Record<string, CachedProfile>;
    isMonthClosed: boolean;
    onclose: () => void;
    onselectentry?: ((entry: LocalEntry) => void) | undefined;
    onrequestvoid: (entry: LocalEntry) => void;
    onvoid: (entry: LocalEntry) => void;
  }

  let {
    entry,
    allEntries,
    role,
    currentUserId,
    methodsMap,
    profilesMap,
    isMonthClosed,
    onclose,
    onselectentry,
    onrequestvoid,
    onvoid,
  }: Props = $props();

  const isPrivileged = $derived(role === 'admin' || role === 'owner');
  const method = $derived(entry ? methodsMap[entry.method_id] : undefined);
  const methodName = $derived(method?.name ?? (entry?.method_id ? entry.method_id.substring(0, 8) : ''));
  const chipVariant = $derived<ChipVariant>(
    method && ['bkash', 'visa', 'mastercard'].includes(method.code.toLowerCase())
      ? (method.code.toLowerCase() as 'bkash' | 'visa' | 'mastercard')
      : 'default'
  );

  const creatorName = $derived(
    entry ? (profilesMap[entry.created_by]?.display_name || entry.created_by) : ''
  );

  // Chains
  const predecessorEntry = $derived(
    entry?.supersedes_id ? allEntries.find((e) => e.id === entry.supersedes_id) : null
  );
  const successorEntry = $derived(
    entry ? allEntries.find((e) => e.supersedes_id === entry.id) : null
  );

  function formatDhakaTimestamp(isoDate?: string): string {
    if (!isoDate) return 'N/A';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(isoDate)) + ' (Asia/Dhaka)';
    } catch {
      return isoDate;
    }
  }

  function handleSupersedeClick() {
    if (!entry) return;
    // Read the id before closing: onclose() clears the parent's selection, which
    // makes `entry` null here and would throw before the navigation ran.
    const entryId = entry.id;
    onclose();
    goto(`/entries/new?supersede=${encodeURIComponent(entryId)}`);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && entry) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if entry}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
    onclick={onclose}
    role="presentation"
  ></div>

  <div
    role="dialog"
    aria-modal="true"
    aria-label="Transaction detail slide-over"
    class="detail-drawer fixed inset-y-0 right-0 z-50 max-w-md w-full glass bg-white/95 dark:bg-stone-900/95 p-6 shadow-2xl flex flex-col justify-between border-l border-black/10 dark:border-white/10 overflow-y-auto"
  >
    <div class="flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
        <div>
          <h2 class="text-lg font-bold text-[var(--ink)]">{entry.entry_number ?? entry.local_id}</h2>
          <span class="text-xs font-mono text-[var(--muted)]">UUID: {entry.id}</span>
        </div>
        <button
          type="button"
          aria-label="Close detail drawer"
          onclick={onclose}
          class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 text-[var(--muted)]"
        >
          ✕
        </button>
      </div>

      <!-- Closed Month Lock Banner (PRD §8.4) -->
      {#if isMonthClosed}
        <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
          <span>🔒</span>
          <span>Month {entry.entry_date.substring(0, 7)} is closed. Voids and supersessions are locked.</span>
        </div>
      {/if}

      <!-- Duplicate Txn Ref Warning -->
      {#if entry.dup_txn_flag}
        <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs flex items-center gap-2">
          <span>⚠️</span>
          <span><strong>Duplicate Txn Ref:</strong> This transaction reference was previously recorded.</span>
        </div>
      {/if}

      <!-- Stale Rates Alert (Threshold > 50,000 poisha per PRD) -->
      {#if entry.stale_rates}
        <div class="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-400 text-xs flex items-center gap-2">
          <span>⚡</span>
          <span>
            <strong>Stale Rate Profile:</strong> Recorded offline under older rates.
            {#if entry.stale_review_status === 'approved'}
              Approved by Admin without recalculation.
            {:else if entry.stale_review_status === 'rejected'}
              Rejected by Admin during stale rate review.
            {:else if BigInt(entry.gross_poisha) > 5000000n}
              Flagged for Admin review (&gt; ৳50,000).
            {:else}
              Preserved without recalculation.
            {/if}
          </span>
        </div>
      {/if}

      <!-- Core Details -->
      <div class="flex flex-col gap-2.5 text-sm">
        <div class="flex justify-between">
          <span class="text-[var(--muted)]">Customer:</span>
          <span class="font-bold text-[var(--ink)]">{entry.customer_name}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[var(--muted)]">Date:</span>
          <span>{entry.entry_date}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[var(--muted)]">Units / Quantity:</span>
          <span>{entry.sub_qty}</span>
        </div>
        {#if entry.sub_description}
          <div class="flex justify-between">
            <span class="text-[var(--muted)]">Description:</span>
            <span>{entry.sub_description}</span>
          </div>
        {/if}
        <div class="flex justify-between items-center">
          <span class="text-[var(--muted)]">Payment Method:</span>
          <Chip variant={chipVariant}>{methodName}</Chip>
        </div>
        {#if entry.txn_ref}
          <div class="flex justify-between font-mono">
            <span class="text-[var(--muted)]">Txn Reference:</span>
            <span>{entry.txn_ref}</span>
          </div>
        {/if}
        {#if entry.notes}
          <div class="flex justify-between text-xs">
            <span class="text-[var(--muted)]">Notes:</span>
            <span class="italic">{entry.notes}</span>
          </div>
        {/if}
        <div class="flex justify-between">
          <span class="text-[var(--muted)]">Status:</span>
          <span class="capitalize font-semibold {entry.status === 'voided' ? 'text-red-500 line-through' : entry.status === 'superseded' ? 'text-amber-600' : 'text-emerald-600'}">
            {entry.status} ({entry.sync_status})
          </span>
        </div>

        <!-- Financial Breakdown (Rule 2, Rule 3) -->
        <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1.5">
          <div class="flex justify-between">
            <span class="text-[var(--muted)]">Gross:</span>
            <span class="font-bold tabular-nums text-[var(--ink)]">{formatPoishaToBdt(BigInt(entry.gross_poisha))}</span>
          </div>
          <div class="flex justify-between text-[var(--c-vat)]">
            <span>VAT Deduction:</span>
            <span class="tabular-nums">-{formatPoishaToBdt(BigInt(entry.vat_poisha))}</span>
          </div>
          <div class="flex justify-between text-[var(--c-commission)]">
            <span>Commission Deduction:</span>
            <span class="tabular-nums">-{formatPoishaToBdt(BigInt(entry.commission_poisha))}</span>
          </div>
          <div class="flex justify-between text-red-600">
            <span>Merchant Fee:</span>
            <span class="tabular-nums">-{formatPoishaToBdt(BigInt(entry.business_charge_poisha))}</span>
          </div>
          {#if entry.customer_charge_poisha && entry.customer_charge_poisha !== '0'}
            <div class="flex justify-between text-blue-600 text-xs">
              <span>Customer Fee (Customer-paid — not deducted):</span>
              <span class="tabular-nums">{formatPoishaToBdt(BigInt(entry.customer_charge_poisha))}</span>
            </div>
          {/if}
          <div class="flex justify-between font-bold text-base pt-2 border-t border-black/5">
            <span>Net Revenue:</span>
            <span class="tabular-nums text-[var(--accent)]">{formatPoishaToBdt(BigInt(entry.net_poisha))}</span>
          </div>
        </div>

        <!-- Snapshot Rates Applied (PRD §8.2) -->
        {#if entry.snapshot}
          <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1 text-xs">
            <span class="font-bold text-[var(--ink)] uppercase tracking-wider">Snapshot Rates Applied</span>
            <div class="grid grid-cols-2 gap-1 text-[var(--muted)]">
              <div>Version: <span class="font-mono text-[var(--ink)]">v{entry.snapshot.version}</span></div>
              <div>VAT: <span class="text-[var(--ink)]">{entry.snapshot.vat.mode} ({entry.snapshot.vat.bp / 100}%)</span></div>
              <div>Commission: <span class="text-[var(--ink)]">{entry.snapshot.commission.bp / 100}% ({entry.snapshot.commission.base})</span></div>
              <div>Method Fee: <span class="text-[var(--ink)]">{entry.snapshot.chargeBp / 100}%</span></div>
              <div>Borne By: <span class="text-[var(--ink)] capitalize">{entry.snapshot.chargesBorneBy}</span></div>
              <div>Rounding: <span class="text-[var(--ink)]">{entry.snapshot.rounding}</span></div>
            </div>
          </div>
        {/if}

        <!-- Metadata & Timestamps -->
        <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1 text-xs text-[var(--muted)]">
          <div class="flex justify-between">
            <span>Creator:</span>
            <span class="font-medium text-[var(--ink)]">{creatorName}</span>
          </div>
          <div class="flex justify-between">
            <span>Created At:</span>
            <span>{formatDhakaTimestamp(entry.created_at)}</span>
          </div>
          <div class="flex justify-between">
            <span>Server Sequence:</span>
            <span class="font-mono">{entry.server_seq ?? 'Local (Unassigned)'}</span>
          </div>
          <div class="flex justify-between">
            <span>Device ID:</span>
            <span class="font-mono">{entry.device_id ?? 'Unknown / Web'}</span>
          </div>
        </div>

        <!-- Supersede History Chain -->
        {#if predecessorEntry || successorEntry}
          <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1.5 text-xs">
            <span class="font-bold text-[var(--ink)] uppercase tracking-wider">Supersede History Chain</span>
            {#if predecessorEntry}
              <div class="flex items-center justify-between text-amber-700 dark:text-amber-400">
                <span>Supersedes Original:</span>
                {#if onselectentry}
                  <button
                    type="button"
                    class="font-mono font-bold underline hover:text-[var(--accent)] cursor-pointer text-left"
                    onclick={() => onselectentry?.(predecessorEntry)}
                  >
                    {predecessorEntry.entry_number ?? predecessorEntry.local_id}
                  </button>
                {:else}
                  <span class="font-mono font-bold">{predecessorEntry.entry_number ?? predecessorEntry.local_id}</span>
                {/if}
              </div>
            {/if}
            {#if successorEntry}
              <div class="flex items-center justify-between text-blue-700 dark:text-blue-400">
                <span>Replaced by Successor:</span>
                {#if onselectentry}
                  <button
                    type="button"
                    class="font-mono font-bold underline hover:text-[var(--accent)] cursor-pointer text-left"
                    onclick={() => onselectentry?.(successorEntry)}
                  >
                    {successorEntry.entry_number ?? successorEntry.local_id}
                  </button>
                {:else}
                  <span class="font-mono font-bold">{successorEntry.entry_number ?? successorEntry.local_id}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Audit Events Log -->
        <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1 text-xs text-[var(--muted)]">
          <span class="font-bold text-[var(--ink)] uppercase tracking-wider mb-1">Audit Events</span>
          <div class="flex items-start gap-2">
            <span>•</span>
            <span>Created by {creatorName} on {formatDhakaTimestamp(entry.created_at)}</span>
          </div>
          {#if entry.void_requested_by}
            <div class="flex items-start gap-2 text-amber-600">
              <span>•</span>
              <span>
                Void requested by {profilesMap[entry.void_requested_by]?.display_name || entry.void_requested_by}:
                "{entry.void_reason}"
              </span>
            </div>
          {/if}
          {#if entry.status === 'voided'}
            <div class="flex items-start gap-2 text-red-600">
              <span>•</span>
              <span>Entry voided (Reason: "{entry.void_reason}")</span>
            </div>
          {/if}
          {#if entry.status === 'superseded'}
            <div class="flex items-start gap-2 text-amber-600">
              <span>•</span>
              <span>Entry superseded by replacement</span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Actions (Void / Supersede) -->
    <div class="pt-4 border-t border-black/10 dark:border-white/10 flex flex-col gap-2">
      {#if entry.status === 'active' && !isMonthClosed}
        {#if isPrivileged}
          <!-- Admin or Owner Actions -->
          <div class="flex gap-2">
            {#if entry.void_requested_by}
              <Button variant="default" class="flex-1 bg-red-600 hover:bg-red-700 text-white" onclick={() => onvoid(entry)}>
                Approve Void
              </Button>
            {:else}
              <Button variant="default" class="flex-1 text-red-600 border border-red-300" onclick={() => onvoid(entry)}>
                Void Entry
              </Button>
            {/if}
            <Button variant="default" class="flex-1" onclick={handleSupersedeClick}>
              Edit / Supersede
            </Button>
          </div>
        {:else if entry.created_by === currentUserId && !entry.void_requested_by}
          <!-- Staff Action: Can only request void on own entries per PRD §8.2 / §8.5 -->
          <Button variant="default" class="w-full text-amber-600 border border-amber-300" onclick={() => onrequestvoid(entry)}>
            Request Void
          </Button>
        {:else if entry.void_requested_by}
          <div class="text-xs text-center text-amber-600 font-medium py-1">
            Void request pending Admin approval.
          </div>
        {/if}
      {:else if isMonthClosed}
        <div class="text-xs text-center text-amber-700 font-semibold py-1">
          Month closed. Modifications locked.
        </div>
      {:else}
        <div class="text-xs text-center text-[var(--muted)] py-1">
          This entry is {entry.status} and cannot be modified.
        </div>
      {/if}
    </div>
  </div>
{/if}
