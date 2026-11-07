<script lang="ts">
  import { page } from '$app/state';
  import { db, type LocalEntry, type CachedPaymentMethod, type CachedMonthClose, type CachedProfile } from '$lib/db';
  import { groupEntriesByDay } from '$lib/ledger/grouping';
  import { normalizeEntrySearchQuery, matchesEntrySearch } from '$lib/ledger/search';
  import { requestEntryVoid, executeEntryVoid } from '$lib/ledger/void';
  import type { LedgerFilters } from '$lib/ledger/types';
  import { session } from '$lib/auth/session.svelte';
  import LedgerRow from '$lib/ui/LedgerRow.svelte';
  import LedgerFilterDrawer from '$lib/ui/LedgerFilterDrawer.svelte';
  import EntryDetailDrawer from '$lib/ui/EntryDetailDrawer.svelte';
  import VoidRequestModal from '$lib/ui/VoidRequestModal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { liveQuery } from 'dexie';
  import { formatPoishaToBdt } from '@clt/shared';

  let rawSearch = $state('');
  let debouncedSearch = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  let selectedEntryId = $state<string | null>(null);
  let voidModalOpen = $state(false);
  let filterDrawerOpen = $state(false);

  let filters = $state<LedgerFilters>({
    status: 'all',
    flagDuplicateTxn: false,
    flagStaleRates: false,
  });

  let allEntries = $state<LocalEntry[]>([]);
  let paymentMethods = $state<CachedPaymentMethod[]>([]);
  let monthCloses = $state<CachedMonthClose[]>([]);
  let profiles = $state<CachedProfile[]>([]);

  // Securely derive auth state from session.user
  const currentRole = $derived(session.user?.role ?? 'staff');
  const currentUserId = $derived(session.user?.id ?? '');
  const isPrivileged = $derived(currentRole === 'admin' || currentRole === 'owner');

  // Parse URL query parameters for report drill-down (PRD §8.3)
  $effect(() => {
    const searchParams = page.url.searchParams;
    const monthParam = searchParams.get('month'); // YYYY-MM
    const methodParam = searchParams.get('method');
    const statusParam = searchParams.get('status');
    const queryParam = searchParams.get('q');

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const year = parseInt(monthParam.substring(0, 4), 10);
      const month = parseInt(monthParam.substring(5, 7), 10);
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      filters.startDate = `${monthParam}-01`;
      filters.endDate = `${monthParam}-${lastDay.toString().padStart(2, '0')}`;
    }

    if (methodParam) {
      filters.methodId = methodParam;
    }

    if (statusParam) {
      filters.status = statusParam as LedgerFilters['status'];
    }

    if (queryParam) {
      rawSearch = queryParam;
      debouncedSearch = queryParam;
    }
  });

  // Debounce search input by 150ms
  $effect(() => {
    // Read the input synchronously: Svelte 5 tracks dependencies read during the
    // effect body, so reading rawSearch inside the timeout left the effect with
    // no dependency and the search never filtered anything (E2E, 2026-11-07).
    const value = rawSearch;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      debouncedSearch = value;
    }, 150);
    return () => clearTimeout(searchTimer);
  });

  // Reactive Dexie queries
  $effect(() => {
    const subEntries = liveQuery(() => db.entries.toArray()).subscribe((rows) => {
      allEntries = rows;
    });
    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      paymentMethods = rows;
    });
    const subCloses = liveQuery(() => db.monthCloses.toArray()).subscribe((rows) => {
      monthCloses = rows;
    });
    const subProfiles = liveQuery(() => db.profiles.toArray()).subscribe((rows) => {
      profiles = rows;
    });

    return () => {
      subEntries.unsubscribe();
      subMethods.unsubscribe();
      subCloses.unsubscribe();
      subProfiles.unsubscribe();
    };
  });

  const methodsMap = $derived.by(() => {
    const map: Record<string, CachedPaymentMethod> = {};
    for (const m of paymentMethods) {
      map[m.id] = m;
    }
    return map;
  });

  const profilesMap = $derived.by(() => {
    const map: Record<string, CachedProfile> = {};
    for (const p of profiles) {
      map[p.id] = p;
    }
    return map;
  });

  // Selected entry re-derived dynamically from allEntries
  const selectedEntry = $derived(
    selectedEntryId ? allEntries.find((e) => e.id === selectedEntryId) ?? null : null
  );

  const isSelectedEntryMonthClosed = $derived.by(() => {
    if (!selectedEntry) return false;
    const monthKey = selectedEntry.entry_date.substring(0, 7) + '-01';
    return monthCloses.some((c) => c.month === monthKey && c.status === 'closed');
  });

  // Filter application with role-scoping (PRD §8.5)
  function passesFilters(entry: LocalEntry, f: LedgerFilters): boolean {
    // PRD §8.5: Staff sees strictly their own entries on shared devices
    if (currentRole === 'staff' && entry.created_by !== currentUserId) {
      return false;
    }

    if (f.startDate && entry.entry_date < f.startDate) return false;
    if (f.endDate && entry.entry_date > f.endDate) return false;
    if (f.methodId && entry.method_id !== f.methodId) return false;
    if (f.createdBy && entry.created_by !== f.createdBy) return false;

    if (f.status && f.status !== 'all') {
      if (f.status === 'pending_sync' && entry.sync_status !== 'pending') return false;
      if (f.status === 'rejected' && entry.sync_status !== 'rejected') return false;
      if (f.status === 'active' && entry.status !== 'active') return false;
      if (f.status === 'voided' && entry.status !== 'voided') return false;
      if (f.status === 'superseded' && entry.status !== 'superseded') return false;
    }

    if (f.flagDuplicateTxn && !entry.dup_txn_flag) return false;
    if (f.flagStaleRates && !entry.stale_rates) return false;

    return true;
  }

  const normalizedQuery = $derived(normalizeEntrySearchQuery(debouncedSearch));

  const filteredEntries = $derived.by(() => {
    return allEntries.filter((entry) => {
      if (!passesFilters(entry, filters)) return false;
      return matchesEntrySearch(entry, normalizedQuery);
    });
  });

  const dayGroups = $derived(groupEntriesByDay(filteredEntries));

  const activeFilterCount = $derived.by(() => {
    let count = 0;
    if (filters.startDate) count++;
    if (filters.endDate) count++;
    if (filters.methodId) count++;
    if (filters.createdBy) count++;
    if (filters.status && filters.status !== 'all') count++;
    if (filters.flagDuplicateTxn) count++;
    if (filters.flagStaleRates) count++;
    return count;
  });

  async function handleConfirmVoid(reason: string) {
    if (!selectedEntry || !currentUserId) return;

    if (isPrivileged) {
      await executeEntryVoid(selectedEntry, currentUserId, reason);
    } else {
      await requestEntryVoid(selectedEntry, currentUserId, reason);
    }
  }
</script>

<div class="ledger-page p-6 max-w-5xl mx-auto w-full">
  <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Ledger</h1>
      <p class="text-sm text-[var(--muted)]">
        {#if currentRole === 'staff'}
          My transaction entries record with search and subtotals.
        {:else}
          All shop transactions with search, filters, and daily subtotals.
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-3 max-w-md w-full">
      <div class="flex-1">
        <input
          type="search"
          placeholder="Search ID, customer, ref, #LOCAL..."
          bind:value={rawSearch}
          class="w-full px-4 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/50 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>
      <Button
        variant="default"
        onclick={() => { filterDrawerOpen = true; }}
        class="relative min-w-[44px]"
      >
        Filters
        {#if activeFilterCount > 0}
          <span class="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold">
            {activeFilterCount}
          </span>
        {/if}
      </Button>
    </div>
  </div>

  <!-- Day Groups -->
  <div class="flex flex-col gap-6">
    {#if dayGroups.length === 0}
      <div class="p-12 text-center text-sm text-[var(--muted)] glass rounded-2xl border border-black/5">
        No transactions found matching criteria.
      </div>
    {:else}
      {#each dayGroups as day (day.date)}
        <section aria-labelledby={`day-${day.date}`} class="day-group flex flex-col gap-3">
          <div class="flex items-center justify-between px-2 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
            <h2 id={`day-${day.date}`}>{day.date}</h2>
            <div class="flex items-center gap-3 tabular-nums">
              <span>Units: {day.totalSubQty}</span>
              <span>Gross: {formatPoishaToBdt(day.totalGrossPoisha)}</span>
              <span class="text-red-600 dark:text-red-400">Deductions: -{formatPoishaToBdt(day.totalDeductionsPoisha)}</span>
              <span class="text-[var(--accent)] font-semibold">Net: {formatPoishaToBdt(day.totalNetPoisha)}</span>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            {#each day.entries as entry (entry.id)}
              <LedgerRow
                {entry}
                {methodsMap}
                onselect={(e) => { selectedEntryId = e.id; }}
              />
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>

  <!-- Drawers and Modals -->
  <LedgerFilterDrawer
    bind:open={filterDrawerOpen}
    {filters}
    methods={paymentMethods}
    {profiles}
    isAdmin={isPrivileged}
    onclose={() => { filterDrawerOpen = false; }}
    onapply={(f) => { filters = f; }}
    onreset={() => {
      filters = { status: 'all', flagDuplicateTxn: false, flagStaleRates: false };
    }}
  />

  <EntryDetailDrawer
    entry={selectedEntry}
    {allEntries}
    role={currentRole}
    {currentUserId}
    {methodsMap}
    {profilesMap}
    isMonthClosed={isSelectedEntryMonthClosed}
    onclose={() => { selectedEntryId = null; }}
    onselectentry={(e) => { selectedEntryId = e.id; }}
    onrequestvoid={() => { voidModalOpen = true; }}
    onvoid={() => { voidModalOpen = true; }}
  />

  <VoidRequestModal
    bind:open={voidModalOpen}
    isAdmin={isPrivileged}
    isApproval={Boolean(selectedEntry?.void_requested_by)}
    existingReason={selectedEntry?.void_reason}
    onclose={() => { voidModalOpen = false; }}
    onsubmit={handleConfirmVoid}
  />
</div>
