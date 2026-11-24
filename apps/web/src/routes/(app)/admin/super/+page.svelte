<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { hasCapability } from '$lib/capabilities';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import CouponHead from '$lib/ui/CouponHead.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';
  import { session } from '$lib/auth/session.svelte';
  import { formatPoishaToBdt } from '@clt/shared';

  interface FleetRow {
    centerId: string;
    code: string;
    name: string;
    status: 'active' | 'suspended' | 'archived';
    entries: { today: number; last7Days: number; last30Days: number };
    grossPoisha: { today: string; last7Days: string; last30Days: string };
    lastEntryAt: string | null;
  }

  interface Dashboard {
    generatedAt: string;
    centers: { total: number; byStatus: Record<string, number> };
    fleet: FleetRow[];
    devices: {
      staleAfterDays: number;
      total: number;
      revoked: number;
      stale: number;
      lastSeenAt: string | null;
    };
    rejectedOperations: { pending: number; oldestCreatedAt: string | null };
    staleRates: { flaggedEntries: number; pendingReview: number };
    backup: { recorded: boolean; lastSuccessAt: string | null; source: string };
  }

  const canUsePanel = $derived(hasCapability(session.user?.role ?? 'staff', 'center.read_all'));

  let data = $state<Dashboard | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');

  async function load() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/super/dashboard');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      data = (await res.json()) as Dashboard;
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (canUsePanel) void load();
  });

  function money(value: string): string {
    return formatPoishaToBdt(BigInt(value));
  }

  function when(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—';
  }
</script>

<div class="p-6 max-w-6xl mx-auto w-full flex flex-col gap-5">
  <CouponHead
    tab="Fleet"
    title="Fleet Dashboard"
    subtitle="Every franchise center at a glance. Figures count active entries only."
  />

  <div class="flex flex-wrap items-center justify-end gap-3">
    {#if canUsePanel}
      <Button variant="default" onclick={() => void load()} disabled={loading}>Refresh</Button>
    {/if}
  </div>

  {#if !canUsePanel}
    <Card class="p-6">
      <h2 class="text-lg font-bold text-[var(--ink)]">Access Denied</h2>
      <p class="text-sm text-[var(--muted)] mt-2">
        The fleet dashboard belongs to the Platform Super-Admin.
      </p>
    </Card>
  {:else if errorMessage}
    <Card class="p-6">
      <p class="text-sm text-red-600">{errorMessage}</p>
    </Card>
  {:else if loading && !data}
    <Card class="p-6">
      <p class="text-sm text-[var(--muted)]">Loading the fleet…</p>
    </Card>
  {:else if data}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card class="p-4">
        <p class="text-xs uppercase tracking-wider text-[var(--muted)]">Centers</p>
        <p class="text-2xl font-bold text-[var(--ink)]">{data.centers.total}</p>
        <p class="text-xs text-[var(--muted)] mt-1">
          {data.centers.byStatus.active ?? 0} active ·
          {data.centers.byStatus.suspended ?? 0} suspended ·
          {data.centers.byStatus.archived ?? 0} archived
        </p>
      </Card>
      <Card class="p-4">
        <p class="text-xs uppercase tracking-wider text-[var(--muted)]">
          Devices quiet &gt; {data.devices.staleAfterDays}d
        </p>
        <p class="text-2xl font-bold text-[var(--ink)]">{data.devices.stale}</p>
        <p class="text-xs text-[var(--muted)] mt-1">
          {data.devices.total} registered · {data.devices.revoked} revoked
        </p>
      </Card>
      <Card class="p-4">
        <p class="text-xs uppercase tracking-wider text-[var(--muted)]">Rejected operations</p>
        <p class="text-2xl font-bold text-[var(--ink)]">{data.rejectedOperations.pending}</p>
        <p class="text-xs text-[var(--muted)] mt-1">
          awaiting resolution{data.rejectedOperations.oldestCreatedAt
            ? ` · oldest ${when(data.rejectedOperations.oldestCreatedAt)}`
            : ''}
        </p>
      </Card>
      <Card class="p-4">
        <p class="text-xs uppercase tracking-wider text-[var(--muted)]">Stale rates</p>
        <p class="text-2xl font-bold text-[var(--ink)]">
          {data.staleRates.flaggedEntries}
        </p>
        <p class="text-xs text-[var(--muted)] mt-1">
          flagged entries · {data.staleRates.pendingReview} awaiting review
        </p>
      </Card>
    </div>

    <Card class="p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm font-semibold text-[var(--ink)]">Backup</p>
        {#if data.backup.recorded}
          <p class="text-sm text-[var(--muted)]">Last success {when(data.backup.lastSuccessAt)}</p>
        {:else}
          <p class="text-sm text-[var(--muted)]">
            Not recorded in the database — the daily export writes files off-database (<code
              >{data.backup.source}</code
            >).
          </p>
        {/if}
      </div>
    </Card>

    <Card class="p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">Center</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3 text-right">Today</th>
            <th class="px-4 py-3 text-right">7 days</th>
            <th class="px-4 py-3 text-right">30 days</th>
            <th class="px-4 py-3">Last entry</th>
          </tr>
        </thead>
        <tbody>
          {#each data.fleet as row (row.centerId)}
            <tr class="border-t border-black/10 dark:border-white/10">
              <td class="px-4 py-3">
                <a
                  class="font-semibold text-[var(--ink)] underline-offset-2 hover:underline"
                  href={`/admin/super/ledger?centerId=${row.centerId}`}>{row.code} — {row.name}</a
                >
              </td>
              <td class="px-4 py-3">
                <Chip
                  variant={row.status === 'active'
                    ? 'commission'
                    : row.status === 'suspended'
                      ? 'vat'
                      : 'default'}>{row.status}</Chip
                >
              </td>
              <td class="px-4 py-3 text-right">
                {row.entries.today}
                <span class="block text-xs text-[var(--muted)]">{money(row.grossPoisha.today)}</span
                >
              </td>
              <td class="px-4 py-3 text-right">
                {row.entries.last7Days}
                <span class="block text-xs text-[var(--muted)]"
                  >{money(row.grossPoisha.last7Days)}</span
                >
              </td>
              <td class="px-4 py-3 text-right">
                {row.entries.last30Days}
                <span class="block text-xs text-[var(--muted)]"
                  >{money(row.grossPoisha.last30Days)}</span
                >
              </td>
              <td class="px-4 py-3 text-xs text-[var(--muted)]">{when(row.lastEntryAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </Card>

    <div class="flex flex-wrap gap-2">
      <Button variant="default" onclick={() => goto('/admin/super/users')}>Fleet Users</Button>
      <Button variant="default" onclick={() => goto('/admin/super/devices')}>Fleet Devices</Button>
      <Button variant="default" onclick={() => goto('/admin/super/centers')}>
        Franchise Centers
      </Button>
    </div>
  {/if}
</div>
