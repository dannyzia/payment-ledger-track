<script lang="ts">
  import { onMount } from 'svelte';
  import { hasCapability } from '$lib/capabilities';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';
  import { session } from '$lib/auth/session.svelte';

  interface FleetDevice {
    deviceId: string;
    deviceName: string | null;
    lastSeenAt: string;
    lastRateVersion: number;
    revoked: boolean;
    userId: string;
    userName: string | null;
    userActive: boolean | null;
    centerId: string;
    centerCode: string;
    centerName: string;
  }

  interface CenterOption {
    id: string;
    code: string;
    name: string;
  }

  const canRead = $derived(hasCapability(session.user?.role ?? 'staff', 'device.read_all'));

  let devices = $state<FleetDevice[]>([]);
  let centers = $state<CenterOption[]>([]);
  let centerFilter = $state('all');
  let staleOnly = $state(false);
  let staleAfterDays = $state(14);
  let loading = $state(false);
  let errorMessage = $state('');
  let actionMessage = $state('');
  let pending = $state<{ deviceId: string; action: 'revoke' | 'unrevoke' } | null>(null);

  async function loadCenters() {
    const res = await authFetch('/api/v1/admin/super/centers');
    if (!res.ok) return;
    const body = (await res.json()) as { centers?: CenterOption[] };
    centers = body.centers ?? [];
  }

  async function load() {
    loading = true;
    errorMessage = '';
    try {
      const params = new URLSearchParams();
      if (centerFilter !== 'all') params.set('centerId', centerFilter);
      if (staleOnly) params.set('staleOnly', 'true');
      const res = await authFetch(`/api/v1/admin/super/devices?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { devices: FleetDevice[]; staleAfterDays: number };
      devices = body.devices;
      staleAfterDays = body.staleAfterDays;
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  async function act(device: FleetDevice, action: 'revoke' | 'unrevoke') {
    if (pending?.deviceId !== device.deviceId || pending.action !== action) {
      pending = { deviceId: device.deviceId, action };
      actionMessage = `Click again to confirm “${action}” for ${
        device.deviceName ?? device.deviceId.slice(0, 8)
      } (${device.centerCode}).`;
      return;
    }

    pending = null;
    actionMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/super/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centerId: device.centerId,
          deviceId: device.deviceId,
          action,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      actionMessage = `${device.deviceName ?? device.deviceId.slice(0, 8)} ${action}d.`;
      await load();
    } catch (e) {
      actionMessage = adminFetchError(e);
    }
  }

  onMount(() => {
    if (!canRead) return;
    void loadCenters();
    void load();
  });
</script>

<div class="p-4 sm:p-6 max-w-5xl mx-auto w-full flex flex-col gap-4">
  <div>
    <h1 class="text-xl font-bold text-[var(--ink)]">Fleet Devices</h1>
    <p class="text-sm text-[var(--muted)]">
      Every registered device, across every center. Revoking is killswitch state: it stops the
      device syncing without deleting its row, so the action is reversible.
    </p>
  </div>

  {#if !canRead}
    <Card class="p-6">
      <h2 class="text-lg font-bold text-[var(--ink)]">Access Denied</h2>
      <p class="text-sm text-[var(--muted)] mt-2">
        Cross-center device management belongs to the Platform Super-Admin.
      </p>
    </Card>
  {:else}
    <Card class="p-4">
      <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
        <select
          class="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
          bind:value={centerFilter}
          onchange={() => void load()}
        >
          <option value="all">Every center</option>
          {#each centers as center (center.id)}
            <option value={center.id}>{center.code} — {center.name}</option>
          {/each}
        </select>
        <label class="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            bind:checked={staleOnly}
            onchange={() => void load()}
            class="h-4 w-4"
          />
          Quiet for more than {staleAfterDays} days
        </label>
        <Button variant="default" onclick={() => void load()} disabled={loading}>Refresh</Button>
      </div>
    </Card>

    {#if errorMessage}
      <Card class="p-4"><p class="text-sm text-red-600">{errorMessage}</p></Card>
    {/if}
    {#if actionMessage}
      <Card class="p-4"><p class="text-sm text-[var(--ink)]">{actionMessage}</p></Card>
    {/if}

    <Card class="p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs uppercase tracking-wider text-[var(--muted)]">
            <th class="px-4 py-3">Device</th>
            <th class="px-4 py-3">Center</th>
            <th class="px-4 py-3">User</th>
            <th class="px-4 py-3">Last seen</th>
            <th class="px-4 py-3">State</th>
            <th class="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each devices as device (device.deviceId + device.centerId + device.userId)}
            <tr class="border-t border-black/10 dark:border-white/10">
              <td class="px-4 py-3">
                <p class="font-semibold text-[var(--ink)]">
                  {device.deviceName ?? 'Unnamed device'}
                </p>
                <p class="text-xs text-[var(--muted)]">
                  {device.deviceId.slice(0, 8)}… · rate v{device.lastRateVersion}
                </p>
              </td>
              <td class="px-4 py-3">{device.centerCode}</td>
              <td class="px-4 py-3">
                {device.userName ?? 'unknown user'}
                {#if device.userActive === false}
                  <Chip variant="vat">disabled</Chip>
                {/if}
              </td>
              <td class="px-4 py-3 text-xs text-[var(--muted)]">
                {new Date(device.lastSeenAt).toLocaleString()}
              </td>
              <td class="px-4 py-3">
                <Chip variant={device.revoked ? 'vat' : 'commission'}>
                  {device.revoked ? 'revoked' : 'live'}
                </Chip>
              </td>
              <td class="px-4 py-3 text-right">
                <Button
                  variant="default"
                  onclick={() => void act(device, device.revoked ? 'unrevoke' : 'revoke')}
                >
                  {device.revoked ? 'Unrevoke' : 'Revoke'}
                </Button>
              </td>
            </tr>
          {/each}
          {#if devices.length === 0}
            <tr>
              <td colspan="6" class="px-4 py-6 text-center text-sm text-[var(--muted)]">
                No devices match this filter.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </Card>
  {/if}
</div>
