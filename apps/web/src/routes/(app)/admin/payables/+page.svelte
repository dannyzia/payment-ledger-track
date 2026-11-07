<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';

  interface Payable {
    id: string;
    code: string;
    name: string;
    kind: 'vat' | 'method_charge';
    method_id: string | null;
    method_name?: string;
    due_day: number;
    remind_days_before: number;
    active: boolean;
  }

  let payables = $state<Payable[]>([]);
  let methods = $state<{ id: string; name: string }[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let isEditing = $state(false);
  let saving = $state(false);
  let errorMessage = $state('');

  // Form state
  let currentId = $state<string | null>(null);
  let payableCode = $state('');
  let payableName = $state('');
  let payableKind = $state<'vat' | 'method_charge'>('vat');
  let payableMethodId = $state<string | null>(null);
  let dueDay = $state(15);
  let remindDaysBefore = $state(3);
  let payableActive = $state(true);

  let invalidDueDay = $derived(dueDay < 1 || dueDay > 28);
  let invalidRemindDays = $derived(remindDaysBefore < 0 || remindDaysBefore > 14);

  async function loadData() {
    loading = true;
    errorMessage = '';
    try {
      const [payablesRes, methodsRes] = await Promise.all([
        authFetch('/api/v1/admin/payables'),
        authFetch('/api/v1/admin/methods'),
      ]);

      if (methodsRes.ok) {
        const mData = await methodsRes.json();
        methods = mData.methods ?? [];
      }

      if (payablesRes.ok) {
        const pData = await payablesRes.json();
        payables = pData.payables ?? [];
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  function openCreateModal() {
    isEditing = false;
    currentId = null;
    payableCode = '';
    payableName = '';
    payableKind = 'vat';
    payableMethodId = null;
    dueDay = 15;
    remindDaysBefore = 3;
    payableActive = true;
    showModal = true;
  }

  function openEditModal(p: Payable) {
    isEditing = true;
    currentId = p.id;
    payableCode = p.code;
    payableName = p.name;
    payableKind = p.kind;
    payableMethodId = p.method_id;
    dueDay = p.due_day;
    remindDaysBefore = p.remind_days_before;
    payableActive = p.active;
    showModal = true;
  }

  async function savePayable() {
    if (invalidDueDay) {
      errorMessage = 'Due day must be between 1 and 28 to avoid calendar inconsistencies across February.';
      return;
    }
    if (invalidRemindDays) {
      errorMessage = 'Remind days before must be between 0 and 14.';
      return;
    }

    saving = true;
    errorMessage = '';
    try {
      const payload = {
        id: currentId,
        code: payableCode.toLowerCase().trim(),
        name: payableName.trim(),
        kind: payableKind,
        method_id: payableKind === 'vat' ? null : payableMethodId,
        due_day: dueDay,
        remind_days_before: remindDaysBefore,
        active: payableActive,
      };

      const res = await authFetch('/api/v1/admin/payables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save payable');
      }

      showModal = false;
      await loadData();
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadData);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Payables & Settlement Schedule</h1>
      <p class="text-sm text-[var(--muted)]">Configure recipient settlement accounts, authorities, and recurring due dates (1–28).</p>
    </div>
    <Button variant="default" onclick={openCreateModal}>Add Payable</Button>
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
          <th class="py-3 px-4 font-semibold">Category</th>
          <th class="py-3 px-4 font-semibold">Payable Code</th>
          <th class="py-3 px-4 font-semibold">Account / Description</th>
          <th class="py-3 px-4 font-semibold">Monthly Due Day</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each payables as p (p.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4">
              <Chip variant={p.kind === 'vat' ? 'vat' : 'default'}>
                {p.kind === 'vat' ? 'VAT Authority' : (p.method_name ?? 'Method Charge')}
              </Chip>
            </td>
            <td class="py-3 px-4 font-mono text-xs font-medium text-[var(--ink)]">{p.code}</td>
            <td class="py-3 px-4 text-xs text-[var(--muted)]">{p.name}</td>
            <td class="py-3 px-4 font-mono text-xs">Day {p.due_day} of month (Remind: {p.remind_days_before}d)</td>
            <td class="py-3 px-4">
              <Chip variant={p.active ? 'commission' : 'default'}>
                {p.active ? 'Active' : 'Inactive'}
              </Chip>
            </td>
            <td class="py-3 px-4 text-right">
              <Button variant="default" class="text-xs py-1 px-3" onclick={() => openEditModal(p)}>
                Edit
              </Button>
            </td>
          </tr>
        {/each}
        {#if payables.length === 0 && !loading && !errorMessage}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No payables configured.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Modal -->
<Modal bind:open={showModal} title={isEditing ? 'Edit Payable' : 'Add Monthly Payable'} onclose={() => (showModal = false)}>
  <div class="space-y-4">
    <div>
      <label for="payable-kind-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Payable Type</label>
      <select
        id="payable-kind-select"
        bind:value={payableKind}
        disabled={isEditing}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm disabled:opacity-50"
      >
        <option value="vat">VAT (National Board of Revenue / Authority)</option>
        <option value="method_charge">Payment Method Charge (Bank / Merchant Gateway)</option>
      </select>
    </div>

    {#if payableKind === 'method_charge'}
      <div>
        <label for="payable-method-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Associated Channel</label>
        <select
          id="payable-method-select"
          bind:value={payableMethodId}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
        >
          <option value={null}>Select Payment Channel...</option>
          {#each methods as m}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <div>
      <label for="payable-code" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Payable Code (Immutable)</label>
      <input
        id="payable-code"
        type="text"
        placeholder="e.g. vat_nbr or fee_bkash"
        bind:value={payableCode}
        disabled={isEditing}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono disabled:opacity-50"
      />
    </div>

    <div>
      <label for="payable-name" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Payable Description / Account Name</label>
      <input
        id="payable-name"
        type="text"
        placeholder="e.g. National Board of Revenue VAT Account"
        bind:value={payableName}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="due-day" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Monthly Due Day (1–28)</label>
        <input
          id="due-day"
          type="number"
          min="1"
          max="28"
          bind:value={dueDay}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">1–28 per PRD §8.6.</p>
      </div>
      <div>
        <label for="remind-days" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Remind Days (0–14)</label>
        <input
          id="remind-days"
          type="number"
          min="0"
          max="14"
          bind:value={remindDaysBefore}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
        />
        <p class="text-[11px] text-[var(--muted)] mt-1">Days before due day.</p>
      </div>
    </div>

    <div class="pt-2">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={payableActive} class="rounded border-black/20 text-black" />
        <span class="text-sm font-medium text-[var(--ink)]">Active Payable</span>
      </label>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showModal = false)}>Cancel</Button>
      <Button variant="default" onclick={savePayable} disabled={saving || invalidDueDay || invalidRemindDays || !payableName || !payableCode}>
        {saving ? 'Saving...' : 'Save Payable'}
      </Button>
    </div>
  </div>
</Modal>
