<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { formatPoishaToBdt } from '@clt/shared';
  import { hasCapability } from '$lib/capabilities';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';
  import { session } from '$lib/auth/session.svelte';

  /**
   * Plan 023 step 9 — the Head Office ledger across every center.
   *
   * The screen is a view over `/api/v1/admin/super/ledger`: it never reads Dexie (the
   * device ledger belongs to one center) and never decides scope on its own — the
   * Center select sends either one center's id or `all`, and the route refuses an
   * absent scope. Money is rendered from integer poisha with the shared formatter.
   */
  const PAGE_SIZE = 50;

  interface LedgerEntry {
    id: string;
    centerId: string;
    centerCode: string;
    centerName: string;
    serverSeq: string;
    entryId: string | null;
    entryDate: string;
    customerName: string;
    methodName: string | null;
    grossPoisha: string;
    netPoisha: string;
    status: 'active' | 'voided' | 'superseded';
    createdByName: string | null;
    createdByRole: string | null;
  }

  interface CenterTotal {
    centerId: string;
    code: string;
    name: string;
    count: number;
    grossPoisha: string;
  }

  interface Facet {
    id: string;
    code?: string;
    name?: string;
    fullName?: string;
    role?: string;
  }

  const canRead = $derived(hasCapability(session.user?.role ?? 'staff', 'ledger.read_all'));

  let centers = $state<Array<{ id: string; code: string; name: string }>>([]);
  let entries = $state<LedgerEntry[]>([]);
  let byCenter = $state<CenterTotal[]>([]);
  let methods = $state<Facet[]>([]);
  let creators = $state<Facet[]>([]);
  let totals = $state({ count: 0, grossPoisha: '0' });
  let nextCursor = $state<string | null>(null);

  let centerId = $state('all');
  let from = $state('');
  let to = $state('');
  let status = $state('');
  let methodId = $state('');
  let createdBy = $state('');

  let loading = $state(true);
  let loadingMore = $state(false);
  let errorMessage = $state('');

  function query(cursor?: string): string {
    const params = new URLSearchParams({ centerId, limit: String(PAGE_SIZE) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    if (methodId) params.set('methodId', methodId);
    if (createdBy) params.set('createdBy', createdBy);
    if (cursor) params.set('cursor', cursor);
    return params.toString();
  }

  async function load(cursor?: string): Promise<void> {
    if (cursor) loadingMore = true;
    else loading = true;
    errorMessage = '';
    try {
      const res = await authFetch(`/api/v1/admin/super/ledger?${query(cursor)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Could not read the ledger');
      }
      const data = await res.json();
      entries = cursor ? [...entries, ...(data.entries ?? [])] : (data.entries ?? []);
      byCenter = data.totals?.byCenter ?? [];
      totals = { count: data.totals?.count ?? 0, grossPoisha: data.totals?.grossPoisha ?? '0' };
      nextCursor = data.nextCursor ?? null;
      if (!cursor) {
        methods = data.facets?.methods ?? [];
        creators = data.facets?.creators ?? [];
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  async function loadCenters(): Promise<void> {
    try {
      const res = await authFetch('/api/v1/admin/super/centers');
      if (res.ok) {
        const data = await res.json();
        centers = (data.centers ?? []).map((c: { id: string; code: string; name: string }) => ({
          id: c.id,
          code: c.code,
          name: c.name,
        }));
      }
    } catch {
      // The ledger still works with the fixed "All centers" option if this fails.
    }
  }

  function apply(): void {
    void load();
  }

  function reset(): void {
    centerId = 'all';
    from = '';
    to = '';
    status = '';
    methodId = '';
    createdBy = '';
    void load();
  }

  onMount(async () => {
    if (!canRead) {
      loading = false;
      return;
    }
    await loadCenters();
    await load();
  });
</script>

{#if !canRead}
  <div class="p-6 max-w-3xl mx-auto w-full">
    <Card class="p-6">
      <h1 class="text-xl font-bold text-[var(--ink)]">Access Denied</h1>
      <p class="text-sm text-[var(--muted)] mt-2">
        The cross-center ledger is restricted to the Platform Super-Admin.
      </p>
      <Button class="mt-4" onclick={() => goto('/dashboard')}>Go to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="p-6 max-w-6xl mx-auto w-full">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Cross-Center Ledger</h1>
        <p class="text-sm text-[var(--muted)]">
          Every entry across the fleet, newest first. Totals follow the filters, not the page.
        </p>
      </div>
    </div>

    <Card class="p-4 mb-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Center</span>
          <select
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={centerId}
            onchange={apply}
            aria-label="Center scope"
          >
            <option value="all">All Centers (Global)</option>
            {#each centers as center (center.id)}
              <option value={center.id}>{center.code} — {center.name}</option>
            {/each}
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">From</span>
          <input
            type="date"
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={from}
            onchange={apply}
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">To</span>
          <input
            type="date"
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={to}
            onchange={apply}
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Status</span>
          <select
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={status}
            onchange={apply}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="voided">Voided</option>
            <option value="superseded">Superseded</option>
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Payment method</span>
          <select
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={methodId}
            onchange={apply}
          >
            <option value="">All methods</option>
            {#each methods as method (method.id)}
              <option value={method.id}>{method.name}</option>
            {/each}
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Creator</span>
          <select
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={createdBy}
            onchange={apply}
          >
            <option value="">Any creator</option>
            {#each creators as creator (creator.id)}
              <option value={creator.id}>{creator.fullName} ({creator.role})</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="flex justify-end mt-3">
        <Button variant="default" onclick={reset}>Reset filters</Button>
      </div>
    </Card>

    {#if errorMessage}
      <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
        {errorMessage}
      </div>
    {/if}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
      <Card class="p-4">
        <p class="text-xs text-[var(--muted)]">Entries in scope</p>
        <p class="text-xl font-bold text-[var(--ink)]">{totals.count}</p>
      </Card>
      <Card class="p-4">
        <p class="text-xs text-[var(--muted)]">Gross in scope</p>
        <p class="text-xl font-bold text-[var(--ink)]">
          {formatPoishaToBdt(BigInt(totals.grossPoisha))}
        </p>
      </Card>
    </div>

    {#if byCenter.length > 0}
      <Card class="p-0 overflow-hidden mb-6">
        <table class="w-full text-left text-sm">
          <thead
            class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs"
          >
            <tr>
              <th class="py-3 px-4 font-semibold">Center</th>
              <th class="py-3 px-4 font-semibold text-right">Entries</th>
              <th class="py-3 px-4 font-semibold text-right">Gross</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5 dark:divide-white/5">
            {#each byCenter as center (center.centerId)}
              <tr>
                <td class="py-3 px-4 text-[var(--ink)]">
                  <span class="font-semibold">{center.code}</span>
                  <span class="text-[var(--muted)]"> · {center.name}</span>
                </td>
                <td class="py-3 px-4 text-right text-[var(--ink)]">{center.count}</td>
                <td class="py-3 px-4 text-right font-mono text-[var(--ink)]">
                  {formatPoishaToBdt(BigInt(center.grossPoisha))}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Card>
    {/if}

    {#if loading}
      <p class="text-sm text-[var(--muted)]">Loading ledger…</p>
    {:else if entries.length === 0}
      <Card class="p-6 text-sm text-[var(--muted)]">No entries match these filters.</Card>
    {:else}
      <Card class="p-0 overflow-x-auto">
        <table class="w-full text-left text-sm min-w-[720px]">
          <thead
            class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs"
          >
            <tr>
              <th class="py-3 px-4 font-semibold">Entry</th>
              <th class="py-3 px-4 font-semibold">Date</th>
              <th class="py-3 px-4 font-semibold">Center</th>
              <th class="py-3 px-4 font-semibold">Customer</th>
              <th class="py-3 px-4 font-semibold">Method</th>
              <th class="py-3 px-4 font-semibold text-right">Gross</th>
              <th class="py-3 px-4 font-semibold">Status</th>
              <th class="py-3 px-4 font-semibold">Creator</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5 dark:divide-white/5">
            {#each entries as entry (entry.id)}
              <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <td class="py-3 px-4 font-mono text-xs text-[var(--ink)]">
                  {entry.entryId ?? '—'}
                </td>
                <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">{entry.entryDate}</td>
                <td class="py-3 px-4 text-[var(--ink)]">{entry.centerCode}</td>
                <td class="py-3 px-4 text-[var(--ink)]">{entry.customerName}</td>
                <td class="py-3 px-4 text-[var(--muted)]">{entry.methodName ?? '—'}</td>
                <td class="py-3 px-4 text-right font-mono text-[var(--ink)]">
                  {formatPoishaToBdt(BigInt(entry.grossPoisha))}
                </td>
                <td class="py-3 px-4">
                  <Chip variant={entry.status === 'active' ? 'commission' : 'default'}>
                    {entry.status}
                  </Chip>
                </td>
                <td class="py-3 px-4 text-xs text-[var(--muted)]">
                  {entry.createdByName ?? '—'}
                  {#if entry.createdByRole}
                    · {entry.createdByRole}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Card>

      {#if nextCursor}
        <div class="flex justify-center mt-4">
          <Button
            variant="default"
            loading={loadingMore}
            onclick={() => load(nextCursor ?? undefined)}
          >
            Load more
          </Button>
        </div>
      {/if}
    {/if}
  </div>
{/if}
