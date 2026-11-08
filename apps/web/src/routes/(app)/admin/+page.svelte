<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';

  interface HubStats {
    activeMethods: number;
    teamMembers: number;
    registeredDevices: number;
    pendingStaleReviews: number;
    publishedRateVersion: number;
    anomalyBursts: number;
  }

  let stats = $state<HubStats>({
    activeMethods: 0,
    teamMembers: 0,
    registeredDevices: 0,
    pendingStaleReviews: 0,
    publishedRateVersion: 1,
    anomalyBursts: 0,
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read in template via svelte compile (CLT-D-013)
  let loading = $state(true);
  let errorMessage = $state('');

  async function loadStats() {
    loading = true;
    try {
      const [methodsRes, usersRes, devicesRes, staleRes, ratesRes, anomaliesRes] =
        await Promise.all([
          authFetch('/api/v1/admin/methods'),
          authFetch('/api/v1/admin/users'),
          authFetch('/api/v1/admin/devices'),
          authFetch('/api/v1/admin/entries/stale-reviews'),
          authFetch('/api/v1/admin/rates/draft'),
          authFetch('/api/v1/admin/entries/stale-anomalies'),
        ]);

      if (methodsRes.ok) {
        const data = await methodsRes.json();
        stats.activeMethods =
          data.methods?.filter((m: { active: boolean }) => m.active).length ?? 0;
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        stats.teamMembers = data.users?.length ?? 0;
      }
      if (devicesRes.ok) {
        const data = await devicesRes.json();
        stats.registeredDevices = data.devices?.length ?? 0;
      }
      if (staleRes.ok) {
        const data = await staleRes.json();
        stats.pendingStaleReviews = data.entries?.length ?? 0;
      }
      if (ratesRes.ok) {
        const data = await ratesRes.json();
        stats.publishedRateVersion = data.published?.version ?? 1;
      }
      if (anomaliesRes.ok) {
        const data = await anomaliesRes.json();
        // Burst detection: count devices with >= 5 stale ops in last hour (PRD §7, Test #65)
        stats.anomalyBursts = (data.anomalies || []).filter(
          (a: { stale_ops_last_hour?: number }) => (a.stale_ops_last_hour ?? 0) >= 5,
        ).length;
      }
    } catch (e) {
      // Every figure below is server-only, so a failed load must say so rather than
      // leave the cards reading zero, which looks like a real empty business.
      errorMessage = adminFetchError(e);
      console.error('Failed to load admin hub statistics', e);
    } finally {
      loading = false;
    }
  }

  onMount(loadStats);
</script>

<div class="p-6 max-w-6xl mx-auto w-full">
  <div class="mb-8">
    <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Admin Hub</h1>
    <p class="text-sm text-[var(--muted)]">
      Manage business configuration, rates, devices, and operational parameters.
    </p>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  {#if stats.anomalyBursts > 0}
    <div
      class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <span class="font-bold">Security Alert (Test #65):</span>
        <span
          >{stats.anomalyBursts} device(s) exhibiting abnormal stale-rate submission bursts (&ge; 5 in
          1 hour). Inspect device registry.</span
        >
      </div>
      <a href="/admin/devices">
        <Button
          variant="default"
          class="text-xs py-1 px-3 border-red-500/30 text-red-700 hover:bg-red-500/10"
          >Inspect Devices</Button
        >
      </a>
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    <!-- Rates & Rules -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Rates & Rules</h2>
          <Chip variant="commission">v{stats.publishedRateVersion} Active</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Configure VAT calculation mode, default rates, commission percentages, and payment method
          charges.
        </p>
      </div>
      <a href="/admin/rates" class="w-full">
        <Button variant="default" class="w-full">Manage Rates</Button>
      </a>
    </Card>

    <!-- Payment Methods -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Payment Methods</h2>
          <Chip variant="default">{stats.activeMethods} active</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Enable or disable payment channels (bKash, Nagad, Visa, Mastercard) and enforce reference
          requirements.
        </p>
      </div>
      <a href="/admin/methods" class="w-full">
        <Button variant="default" class="w-full">Configure Methods</Button>
      </a>
    </Card>

    <!-- Payables & Schedule -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Payables & Schedule</h2>
          <Chip variant="vat">Day 1–28</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Define recipient settlement accounts, account numbers, and recurring monthly due days.
        </p>
      </div>
      <a href="/admin/payables" class="w-full">
        <Button variant="default" class="w-full">Manage Payables</Button>
      </a>
    </Card>

    <!-- Team & Roles -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Team & Roles</h2>
          <Chip variant="default">{stats.teamMembers} members</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Invite staff and finance administrators, update roles, manage permissions, and transfer
          store ownership.
        </p>
      </div>
      <a href="/admin/users" class="w-full">
        <Button variant="default" class="w-full">Manage Users</Button>
      </a>
    </Card>

    <!-- Device Registry -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Device Registry</h2>
          <Chip variant="default">{stats.registeredDevices} devices</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Monitor physical counter devices, view last sync timestamps, and execute instant
          revocation killswitches.
        </p>
      </div>
      <a href="/admin/devices" class="w-full">
        <Button variant="default" class="w-full">View Devices</Button>
      </a>
    </Card>

    <!-- Stale Rate Reviews -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Stale Rate Reviews</h2>
          <Chip
            variant="default"
            class={stats.pendingStaleReviews > 0
              ? 'bg-amber-500/10 text-amber-800 border border-amber-500/20'
              : ''}
          >
            {stats.pendingStaleReviews} pending
          </Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Audit and approve high-value offline entries (&gt;৳50,000) created under superseded rate
          profiles.
        </p>
      </div>
      <a href="/admin/stale-reviews" class="w-full">
        <Button variant="default" class="w-full">Review Queue</Button>
      </a>
    </Card>

    <!-- Application Settings -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Settings</h2>
          <Chip variant="default">Store Info</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Configure business net label, reconciliation tolerance poisha, and operational thresholds.
        </p>
      </div>
      <a href="/admin/settings" class="w-full">
        <Button variant="default" class="w-full">Store Settings</Button>
      </a>
    </Card>

    <!-- Audit Log Viewer -->
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold text-base text-[var(--ink)]">Audit Log</h2>
          <Chip variant="default">Append-Only</Chip>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">
          Inspect chronological audit trails for all mutations, settlements, rate adjustments, and
          admin logins.
        </p>
      </div>
      <a href="/admin/audit" class="w-full">
        <Button variant="default" class="w-full">View Audit Log</Button>
      </a>
    </Card>
  </div>
</div>
