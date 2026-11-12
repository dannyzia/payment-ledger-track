<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';
  import { session } from '$lib/auth/session.svelte';
  import { formatPoishaToBdt } from '@clt/shared';

  interface CenterOption {
    id: string;
    code: string;
    name: string;
  }

  interface SearchEntry {
    id: string;
    entryId: string | null;
    entry_date: string;
    entry_number: number | null;
    customer_name: string;
    txn_ref: string | null;
    gross_poisha: number;
    net_poisha: number;
    centerCode: string | null;
    centerName: string | null;
    methodCode: string | null;
    methodName: string | null;
  }

  const isSuperAdmin = $derived(session.user?.role === 'super_admin');

  let query = $state('');
  let centerFilter = $state('all');
  let loading = $state(false);
  let searched = $state(false);
  let errorMessage = $state('');
  let results = $state<SearchEntry[]>([]);
  let centers = $state<CenterOption[]>([]);

  async function loadCenters() {
    try {
      const res = await authFetch('/api/v1/admin/super/centers?status=active');
      if (res.ok) {
        const data = await res.json();
        centers = (data.centers ?? []).map((c: CenterOption) => ({
          id: c.id,
          code: c.code,
          name: c.name,
        }));
        const saved = sessionStorage.getItem('clt_super_center');
        if (saved && saved !== 'all') centerFilter = saved;
      }
    } catch {
      // Filter stays on All Centers when the center list cannot be loaded.
    }
  }

  async function search() {
    loading = true;
    errorMessage = '';
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (centerFilter !== 'all') params.set('centerId', centerFilter);
      params.set('limit', '50');
      const res = await authFetch(`/api/v1/admin/super/search?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        results = data.entries ?? [];
        searched = true;
      } else {
        const err = await res.json().catch(() => ({}));
        errorMessage = err.message || err.error || 'Search failed';
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadCenters);
</script>

{#if !isSuperAdmin}
  <div class="p-6 max-w-3xl mx-auto w-full">
    <Card class="p-6">
      <h1 class="text-xl font-bold text-[var(--ink)]">Access Denied</h1>
      <p class="text-sm text-[var(--muted)] mt-2">
        Global search is restricted to the Platform Super-Admin.
      </p>
      <Button class="mt-4" onclick={() => goto('/dashboard')}>Go to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="p-6 max-w-6xl mx-auto w-full">
    <div class="mb-6">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Global Search</h1>
      <p class="text-sm text-[var(--muted)]">
        Search ledger entries across all franchise learning centers by entry number, customer,
        transaction reference, or gross amount.
      </p>
    </div>

    <form
      class="flex flex-col sm:flex-row gap-2 mb-6"
      onsubmit={(e) => {
        e.preventDefault();
        search();
      }}
    >
      <input
        type="search"
        class="min-h-[44px] flex-1 rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
        placeholder="Entry #, customer, reference, or amount…"
        bind:value={query}
      />
      <select
        class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
        value={centerFilter}
        onchange={(e) => (centerFilter = e.currentTarget.value)}
        aria-label="Filter by center"
      >
        <option value="all">All Centers</option>
        {#each centers as c (c.id)}
          <option value={c.id}>{c.code} - {c.name}</option>
        {/each}
      </select>
      <Button type="submit" variant="commission" {loading}>Search</Button>
    </form>

    {#if errorMessage}
      <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
        {errorMessage}
      </div>
    {/if}

    {#if searched && !loading && results.length === 0}
      <Card class="p-6 text-sm text-[var(--muted)]">No matching entries found.</Card>
    {:else if results.length > 0}
      <Card class="p-0 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm min-w-[820px]">
            <thead
              class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs"
            >
              <tr>
                <th class="py-3 px-4 font-semibold">Center</th>
                <th class="py-3 px-4 font-semibold">Entry ID</th>
                <th class="py-3 px-4 font-semibold">Date</th>
                <th class="py-3 px-4 font-semibold text-right">Gross</th>
                <th class="py-3 px-4 font-semibold text-right">Net</th>
                <th class="py-3 px-4 font-semibold">Method</th>
                <th class="py-3 px-4 font-semibold">Customer</th>
                <th class="py-3 px-4 font-semibold">Reference</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/5 dark:divide-white/5">
              {#each results as e (e.id)}
                <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td class="py-3 px-4">
                    <div class="font-semibold text-[var(--ink)]">{e.centerCode ?? '—'}</div>
                    <div class="text-xs text-[var(--muted)]">{e.centerName ?? ''}</div>
                  </td>
                  <td class="py-3 px-4 font-mono text-xs text-[var(--ink)]">
                    {e.entryId ?? e.id.slice(0, 8)}
                  </td>
                  <td class="py-3 px-4 font-mono text-xs text-[var(--ink)]">{e.entry_date}</td>
                  <td class="py-3 px-4 text-right text-[var(--ink)]">
                    {formatPoishaToBdt(BigInt(e.gross_poisha))}
                  </td>
                  <td class="py-3 px-4 text-right text-[var(--ink)]">
                    {formatPoishaToBdt(BigInt(e.net_poisha))}
                  </td>
                  <td class="py-3 px-4 text-[var(--ink)]">
                    {e.methodName ?? e.methodCode ?? '—'}
                  </td>
                  <td class="py-3 px-4 text-[var(--ink)]">{e.customer_name}</td>
                  <td class="py-3 px-4 font-mono text-xs text-[var(--ink)]">{e.txn_ref ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Card>
    {/if}
  </div>
{/if}
