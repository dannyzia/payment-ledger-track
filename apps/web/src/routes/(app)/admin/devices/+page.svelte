<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';

  interface DeviceEntry {
    device_id: string;
    label: string | null;
    platform: string | null;
    last_seen_at: string;
    revoked: boolean;
    active_users: { user_id: string; full_name: string; email: string }[];
  }

  let devices = $state<DeviceEntry[]>([]);
  let loading = $state(true);
  let showRevokeModal = $state(false);
  let revoking = $state(false);
  let selectedDevice = $state<DeviceEntry | null>(null);
  let errorMessage = $state('');

  async function loadDevices() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/devices');
      if (res.ok) {
        const data = await res.json();
        devices = data.devices ?? [];
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load device registry';
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function confirmRevocation(d: DeviceEntry) {
    selectedDevice = d;
    showRevokeModal = true;
  }

  async function executeRevocation() {
    if (!selectedDevice) return;
    revoking = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: selectedDevice.device_id,
          action: 'revoke',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to revoke device');
      }

      showRevokeModal = false;
      selectedDevice = null;
      await loadDevices();
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      revoking = false;
    }
  }

  onMount(loadDevices);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Hardware Device Registry</h1>
      <p class="text-sm text-[var(--muted)]">Track paired POS counter terminals, associated staff sessions, and hardware killswitches.</p>
    </div>
    <Button variant="default" onclick={loadDevices}>Refresh</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Device UUID & Label</th>
          <th class="py-3 px-4 font-semibold">Platform</th>
          <th class="py-3 px-4 font-semibold">Paired Staff Users</th>
          <th class="py-3 px-4 font-semibold">Last Synced</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold text-right">Killswitch</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each devices as d (d.device_id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4">
              <div class="font-medium text-[var(--ink)]">{d.label || 'Counter Terminal'}</div>
              <div class="font-mono text-xs text-[var(--muted)]">{d.device_id}</div>
            </td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)] capitalize">
              {d.platform || 'web-pwa'}
            </td>
            <td class="py-3 px-4">
              {#if d.active_users.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each d.active_users as u}
                    <span class="inline-block px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 text-xs text-[var(--ink)]">
                      {u.full_name}
                    </span>
                  {/each}
                </div>
              {:else}
                <span class="text-xs text-[var(--muted)] italic">None</span>
              {/if}
            </td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">
              {new Date(d.last_seen_at).toLocaleString()}
            </td>
            <td class="py-3 px-4">
              <Chip variant={d.revoked ? 'bkash' : 'commission'}>
                {d.revoked ? 'Revoked' : 'Active'}
              </Chip>
            </td>
            <td class="py-3 px-4 text-right">
              {#if !d.revoked}
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-red-700 hover:bg-red-500/10 border-red-500/20"
                  onclick={() => confirmRevocation(d)}
                >
                  Revoke Device
                </Button>
              {:else}
                <Button
                  variant="default"
                  class="text-xs py-1 px-3 text-green-700 hover:bg-green-500/10 border-green-500/20"
                  onclick={async () => {
                    await authFetch('/api/v1/admin/devices', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ deviceId: d.device_id, action: 'unrevoke' }),
                    });
                    await loadDevices();
                  }}
                >
                  Restore Access
                </Button>
              {/if}
            </td>
          </tr>
        {/each}
        {#if devices.length === 0 && !loading}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No devices registered.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Revoke Confirmation Modal -->
<Modal bind:open={showRevokeModal} title="Confirm Hardware Device Killswitch" onclose={() => (showRevokeModal = false)}>
  <div class="space-y-4">
    <p class="text-sm text-[var(--ink)]">
      Are you sure you want to revoke terminal <strong class="font-mono">{selectedDevice?.device_id}</strong>?
    </p>
    <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-800 space-y-1">
      <p class="font-semibold">Killswitch Enforcement (PRD §7.3, §15.1):</p>
      <p>• All ongoing sync push and pull operations from this physical device will immediately fail with HTTP 403 device_revoked.</p>
      <p>• All active staff sessions sharing this device will be blocked from remote sync.</p>
      <p>• This action is logged permanently to the append-only audit trail.</p>
    </div>
    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showRevokeModal = false)}>Cancel</Button>
      <Button
        variant="default"
        class="bg-red-700 hover:bg-red-800 text-white"
        onclick={executeRevocation}
        disabled={revoking}
      >
        {revoking ? 'Revoking...' : 'Terminate Device'}
      </Button>
    </div>
  </div>
</Modal>
