<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';

  interface AppSettings {
    timezone: string;
    currency: string;
    locale: string;
    net_label: string;
    reconcile_tolerance_poisha: number;
    sync_retention_days: number;
  }

  let settings = $state<AppSettings>({
    timezone: 'Asia/Dhaka',
    currency: 'BDT',
    locale: 'en-BD',
    net_label: 'Net after deductions',
    reconcile_tolerance_poisha: 100,
    sync_retention_days: 90,
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- read in template via svelte compile (CLT-D-013)
  let loading = $state(true);
  let saving = $state(false);
  let successMessage = $state('');
  let errorMessage = $state('');

  async function loadSettings() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          settings = {
            timezone: data.settings.timezone ?? 'Asia/Dhaka',
            currency: data.settings.currency ?? 'BDT',
            locale: data.settings.locale ?? 'en-BD',
            net_label: data.settings.net_label ?? 'Net after deductions',
            reconcile_tolerance_poisha: Number(data.settings.reconcile_tolerance_poisha ?? 100),
            sync_retention_days: 90,
          };
        }
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load settings';
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    saving = true;
    errorMessage = '';
    successMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          net_label: settings.net_label.trim(),
          reconcile_tolerance_poisha: settings.reconcile_tolerance_poisha,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save settings');
      }

      successMessage = 'Application settings updated successfully.';
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadSettings);
</script>

<div class="p-6 max-w-4xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Application Settings</h1>
      <p class="text-sm text-[var(--muted)]">
        Configure operational parameters, net terminology, and reconciliation tolerances.
      </p>
    </div>
    <Button variant="default" onclick={saveSettings} disabled={saving || !settings.net_label}>
      {saving ? 'Saving...' : 'Save Settings'}
    </Button>
  </div>

  {#if successMessage}
    <div
      class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-700 text-sm"
    >
      {successMessage}
    </div>
  {/if}

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-6 space-y-6">
    <div class="border-b border-black/10 dark:border-white/10 pb-4">
      <h2 class="text-base font-semibold text-[var(--ink)]">Financial Terminology & Tolerances</h2>
      <p class="text-xs text-[var(--muted)]">
        Operational settings editable by Administrators and Owners (PRD §4 Q2, §7.1).
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label
          for="net-label"
          class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
          >Net Earnings Display Label</label
        >
        <input
          id="net-label"
          type="text"
          placeholder="e.g. Net after deductions, Final Net"
          bind:value={settings.net_label}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">
          Configurable terminology for merchant payout amount displayed on dashboards and reports.
        </p>
      </div>

      <div>
        <label
          for="tolerance-poisha"
          class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
          >Reconciliation Tolerance (Poisha)</label
        >
        <div class="flex items-center gap-2">
          <input
            id="tolerance-poisha"
            type="number"
            min="0"
            bind:value={settings.reconcile_tolerance_poisha}
            class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
          />
          <span class="text-xs font-mono text-[var(--muted)] whitespace-nowrap">
            ৳{(settings.reconcile_tolerance_poisha / 100).toFixed(2)}
          </span>
        </div>
        <p class="text-[11px] text-[var(--muted)] mt-1">
          Default 100 poisha (৳1.00) tolerance for automated Mode A statement matches.
        </p>
      </div>
    </div>

    <div class="border-t border-black/10 dark:border-white/10 pt-6">
      <h2 class="text-base font-semibold text-[var(--ink)] mb-1">System Environment Parameters</h2>
      <p class="text-xs text-[var(--muted)] mb-4">
        Read-only operational constants enforced by database constraints (PRD §7.1).
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <span
            class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
            >Timezone</span
          >
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm text-[var(--ink)]">{settings.timezone}</span>
            <Chip variant="default">Fixed</Chip>
          </div>
          <p class="text-[11px] text-[var(--muted)] mt-1">
            All business dates evaluate at Asia/Dhaka midnight.
          </p>
        </div>

        <div>
          <span
            class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
            >Currency & Locale</span
          >
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm text-[var(--ink)]"
              >{settings.currency} ({settings.locale})</span
            >
            <Chip variant="default">BDT</Chip>
          </div>
          <p class="text-[11px] text-[var(--muted)] mt-1">
            Financial calculations evaluate in integer poisha.
          </p>
        </div>

        <div>
          <span
            class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
            >Sync Log Retention</span
          >
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm text-[var(--ink)]"
              >{settings.sync_retention_days} Days</span
            >
            <Chip variant="default">PRD §9.1</Chip>
          </div>
          <p class="text-[11px] text-[var(--muted)] mt-1">
            Resolved sync operations purged after 90 days via pg_cron.
          </p>
        </div>
      </div>
    </div>
  </Card>
</div>
