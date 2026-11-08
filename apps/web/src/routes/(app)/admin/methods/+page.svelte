<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';

  interface PaymentMethod {
    id: string;
    code: string;
    name: string;
    active: boolean;
    requires_txn_ref: boolean;
    sort_order: number;
    created_at: string;
  }

  let methods = $state<PaymentMethod[]>([]);
  let loading = $state(true);
  let showModal = $state(false);
  let isEditing = $state(false);
  let saving = $state(false);
  let errorMessage = $state('');

  // Form state
  let currentId = $state<string | null>(null);
  let methodCode = $state('');
  let methodName = $state('');
  let methodActive = $state(true);
  let methodRequiresTxnRef = $state(false);
  let methodSortOrder = $state(0);

  async function loadMethods() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/methods');
      if (res.ok) {
        const data = await res.json();
        methods = data.methods ?? [];
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load methods';
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
    methodCode = '';
    methodName = '';
    methodActive = true;
    methodRequiresTxnRef = false;
    methodSortOrder = methods.length + 1;
    showModal = true;
  }

  function openEditModal(m: PaymentMethod) {
    isEditing = true;
    currentId = m.id;
    methodCode = m.code; // Read-only in edit mode per PRD §7.3
    methodName = m.name;
    methodActive = m.active;
    methodRequiresTxnRef = m.requires_txn_ref;
    methodSortOrder = m.sort_order;
    showModal = true;
  }

  async function saveMethod() {
    saving = true;
    errorMessage = '';
    try {
      const payload = {
        id: currentId,
        code: methodCode.toLowerCase().trim(),
        name: methodName.trim(),
        active: methodActive,
        requires_txn_ref: methodRequiresTxnRef,
        display_order: methodSortOrder,
      };

      const res = await authFetch('/api/v1/admin/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to save payment method');
      }

      showModal = false;
      await loadMethods();
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadMethods);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Payment Methods</h1>
      <p class="text-sm text-[var(--muted)]">
        Configure active payment channels, transaction reference requirements, and display ordering.
      </p>
    </div>
    <Button variant="default" onclick={openCreateModal}>Add Payment Method</Button>
  </div>

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead
        class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs"
      >
        <tr>
          <th class="py-3 px-4 font-semibold">Order</th>
          <th class="py-3 px-4 font-semibold">Channel Name</th>
          <th class="py-3 px-4 font-semibold">Identifier Code</th>
          <th class="py-3 px-4 font-semibold">Reference Required</th>
          <th class="py-3 px-4 font-semibold">Status</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each methods as m (m.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">{m.sort_order}</td>
            <td class="py-3 px-4 font-medium text-[var(--ink)]">{m.name}</td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">{m.code}</td>
            <td class="py-3 px-4">
              {#if m.requires_txn_ref}
                <Chip variant="default">Txn Ref Required</Chip>
              {:else}
                <span class="text-xs text-[var(--muted)]">Optional</span>
              {/if}
            </td>
            <td class="py-3 px-4">
              <Chip variant={m.active ? 'commission' : 'default'}>
                {m.active ? 'Active' : 'Inactive'}
              </Chip>
            </td>
            <td class="py-3 px-4 text-right">
              <Button variant="default" class="text-xs py-1 px-3" onclick={() => openEditModal(m)}>
                Edit
              </Button>
            </td>
          </tr>
        {/each}
        {#if methods.length === 0 && !loading && !errorMessage}
          <tr>
            <td colspan="6" class="py-8 text-center text-sm text-[var(--muted)]">
              No payment methods configured.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Create / Edit Modal -->
<Modal
  bind:open={showModal}
  title={isEditing ? 'Edit Payment Method' : 'Add Payment Method'}
  onclose={() => (showModal = false)}
>
  <div class="space-y-4">
    <div>
      <label
        for="method-name"
        class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
        >Display Name</label
      >
      <input
        id="method-name"
        type="text"
        placeholder="e.g. bKash Merchant"
        bind:value={methodName}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      />
    </div>

    <div>
      <label
        for="method-code"
        class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
        >Code (Immutable after creation)</label
      >
      <input
        id="method-code"
        type="text"
        placeholder="e.g. bkash"
        bind:value={methodCode}
        disabled={isEditing}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono disabled:opacity-50"
      />
      {#if isEditing}
        <p class="text-[11px] text-[var(--muted)] mt-1">
          Method codes are permanently bound to financial records and cannot be altered.
        </p>
      {/if}
    </div>

    <div>
      <label
        for="method-order"
        class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1"
        >Sort Order</label
      >
      <input
        id="method-order"
        type="number"
        min="0"
        bind:value={methodSortOrder}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
      />
    </div>

    <div class="pt-2 space-y-2">
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={methodRequiresTxnRef}
          class="rounded border-black/20 text-black"
        />
        <span class="text-sm font-medium text-[var(--ink)]"
          >Require Transaction Reference on Entry</span
        >
      </label>
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={methodActive}
          class="rounded border-black/20 text-black"
        />
        <span class="text-sm font-medium text-[var(--ink)]">Active for Payment Entry</span>
      </label>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showModal = false)}>Cancel</Button>
      <Button
        variant="default"
        onclick={saveMethod}
        disabled={saving || !methodName || !methodCode}
      >
        {saving ? 'Saving...' : 'Save Method'}
      </Button>
    </div>
  </div>
</Modal>
