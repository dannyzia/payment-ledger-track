<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface AuditEvent {
    id: number;
    at: string;
    actor: string | null;
    action: string;
    target_table: string;
    target_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }

  let events = $state<AuditEvent[]>([]);
  let loading = $state(true);
  let errorMessage = $state('');
  let filterTable = $state('');
  let filterAction = $state('');
  let filterActor = $state('');
  let filterStartDate = $state('');
  let filterEndDate = $state('');

  async function loadAuditLog() {
    loading = true;
    errorMessage = '';
    try {
      const q = new URLSearchParams();
      if (filterTable) q.set('table', filterTable);
      if (filterAction) q.set('action', filterAction);
      if (filterActor) q.set('actor', filterActor);
      if (filterStartDate) q.set('startDate', filterStartDate);
      if (filterEndDate) q.set('endDate', filterEndDate);

      const res = await authFetch(`/api/v1/admin/audit?${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        events = data.events ?? [];
      } else {
        errorMessage = `Could not load the audit log (${res.status}).`;
      }
    } catch (e) {
      events = [];
      errorMessage = navigator.onLine
        ? e instanceof Error ? e.message : String(e)
        : 'The audit log is server-side only and needs a connection. Nothing is lost: queued changes sync when you are back online.';
    } finally {
      loading = false;
    }
  }

  function resetFilters() {
    filterTable = '';
    filterAction = '';
    filterActor = '';
    filterStartDate = '';
    filterEndDate = '';
    loadAuditLog();
  }

  onMount(loadAuditLog);
</script>

<div class="p-6 max-w-6xl mx-auto w-full">
  <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Audit Log Viewer</h1>
      <p class="text-sm text-[var(--muted)]">Chronological, append-only record of all financial mutations and administrative actions.</p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="default" onclick={resetFilters}>Reset</Button>
      <Button variant="default" onclick={loadAuditLog}>Apply Filters</Button>
    </div>
  </div>

  <!-- Multi-parameter Filtering Controls -->
  <Card class="p-4 mb-6">
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
      <div>
        <label for="audit-filter-table" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Table</label>
        <input
          id="audit-filter-table"
          type="text"
          placeholder="e.g. rate_profiles"
          bind:value={filterTable}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
        />
      </div>

      <div>
        <label for="audit-filter-action" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Action</label>
        <input
          id="audit-filter-action"
          type="text"
          placeholder="e.g. publish"
          bind:value={filterAction}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
        />
      </div>

      <div>
        <label for="audit-filter-actor" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Actor UUID</label>
        <input
          id="audit-filter-actor"
          type="text"
          placeholder="Actor ID..."
          bind:value={filterActor}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs font-mono"
        />
      </div>

      <div>
        <label for="audit-filter-start" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">Start Date</label>
        <input
          id="audit-filter-start"
          type="date"
          bind:value={filterStartDate}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        />
      </div>

      <div>
        <label for="audit-filter-end" class="block text-[11px] font-semibold text-[var(--muted)] mb-1">End Date</label>
        <input
          id="audit-filter-end"
          type="date"
          bind:value={filterEndDate}
          class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        />
      </div>
    </div>
  </Card>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-4">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs">
        <thead class="border-b border-black/10 dark:border-white/10 text-[var(--muted)]">
          <tr>
            <th class="py-2 px-3 font-semibold">Timestamp</th>
            <th class="py-2 px-3 font-semibold">Action</th>
            <th class="py-2 px-3 font-semibold">Target</th>
            <th class="py-2 px-3 font-semibold">Actor</th>
            <th class="py-2 px-3 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/5 dark:divide-white/5 font-mono">
          {#each events as ev (ev.id)}
            <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
              <td class="py-2.5 px-3 text-[var(--muted)] whitespace-nowrap">{new Date(ev.at).toLocaleString()}</td>
              <td class="py-2.5 px-3">
                <Chip variant="default">{ev.action}</Chip>
              </td>
              <td class="py-2.5 px-3 text-[var(--muted)]">{ev.target_table}:{ev.target_id?.slice(0, 8)}...</td>
              <td class="py-2.5 px-3 text-[var(--muted)]">{ev.actor ? ev.actor.slice(0, 8) + '...' : 'system'}</td>
              <td class="py-2.5 px-3 text-[var(--muted)] truncate max-w-xs">
                {ev.after ? JSON.stringify(ev.after) : ev.before ? JSON.stringify(ev.before) : '-'}
              </td>
            </tr>
          {/each}
          {#if events.length === 0 && !loading}
            <tr>
              <td colspan="5" class="py-8 text-center text-[var(--muted)] font-sans">No audit events match filters.</td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
  </Card>
</div>
