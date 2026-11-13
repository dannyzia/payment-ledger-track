<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';
  import { session } from '$lib/auth/session.svelte';

  interface Center {
    id: string;
    center_number: number;
    code: string;
    name: string;
    legal_entity_name: string;
    bin_number: string | null;
    trade_license_number: string | null;
    vat_circle: string | null;
    address: string;
    phone: string;
    status: 'active' | 'suspended' | 'archived';
    created_at: string;
    owner_id?: string | null;
    owner_name?: string | null;
    owner_email?: string | null;
  }

  const isSuperAdmin = $derived(session.user?.role === 'super_admin');

  let centers = $state<Center[]>([]);
  let loading = $state(true);
  let errorMessage = $state('');
  let statusFilter = $state('');

  let showModal = $state(false);
  let submitting = $state(false);
  let formError = $state('');
  let code = $state('');
  let name = $state('');
  let legalEntityName = $state('');
  let binNumber = $state('');
  let tradeLicense = $state('');
  let address = $state('');
  let phone = $state('');
  let ownerName = $state('');
  let ownerEmail = $state('');

  // Edit Center state
  let showEditModal = $state(false);
  let editingCenter = $state<Center | null>(null);
  let editSubmitting = $state(false);
  let editError = $state('');
  let editName = $state('');
  let editLegalEntityName = $state('');
  let editAddress = $state('');
  let editPhone = $state('');
  let editBinNumber = $state('');
  let editTradeLicense = $state('');
  let editOwnerEmail = $state('');
  let editOwnerName = $state('');
  let editStatus = $state<'active' | 'suspended' | 'archived'>('active');

  function openEdit(c: Center) {
    editingCenter = c;
    editName = c.name;
    editLegalEntityName = c.legal_entity_name;
    editAddress = c.address;
    editPhone = c.phone;
    editBinNumber = c.bin_number ?? '';
    editTradeLicense = c.trade_license_number ?? '';
    editOwnerEmail = c.owner_email ?? '';
    editOwnerName = c.owner_name ?? '';
    editStatus = c.status;
    editError = '';
    showEditModal = true;
  }

  async function saveCenterEdit() {
    if (!editingCenter) return;
    editSubmitting = true;
    editError = '';
    try {
      const res = await authFetch(`/api/v1/admin/super/centers/${editingCenter.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          legalEntityName: editLegalEntityName.trim(),
          address: editAddress.trim(),
          phone: editPhone.trim(),
          binNumber: editBinNumber.trim() || null,
          tradeLicense: editTradeLicense.trim() || null,
          ownerEmail: editOwnerEmail.trim() || undefined,
          ownerName: editOwnerName.trim() || undefined,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Failed to update center details');
      }
      showEditModal = false;
      editingCenter = null;
      await loadCenters();
    } catch (e) {
      editError = adminFetchError(e);
    } finally {
      editSubmitting = false;
    }
  }

  async function loadCenters() {
    loading = true;
    errorMessage = '';
    try {
      const q = statusFilter ? `?status=${statusFilter}` : '';
      const res = await authFetch(`/api/v1/admin/super/centers${q}`);
      if (res.ok) {
        const data = await res.json();
        centers = data.centers ?? [];
      } else {
        const err = await res.json().catch(() => ({}));
        errorMessage = err.message || err.error || 'Failed to load centers';
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  async function provisionCenter() {
    submitting = true;
    formError = '';
    try {
      const res = await authFetch('/api/v1/admin/super/centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          legalEntityName: legalEntityName.trim(),
          binNumber: binNumber.trim() || null,
          tradeLicense: tradeLicense.trim() || null,
          address: address.trim(),
          phone: phone.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerName: ownerName.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error('A center with this code already exists.');
        }
        throw new Error(err.message || err.error || 'Provisioning failed');
      }
      showModal = false;
      code =
        name =
        legalEntityName =
        binNumber =
        tradeLicense =
        address =
        phone =
        ownerName =
        ownerEmail =
          '';
      await loadCenters();
    } catch (e) {
      formError = adminFetchError(e);
    } finally {
      submitting = false;
    }
  }

  async function setStatus(center: Center, status: Center['status']) {
    errorMessage = '';
    try {
      const res = await authFetch(`/api/v1/admin/super/centers/${center.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Status update failed');
      }
      await loadCenters();
    } catch (e) {
      errorMessage = adminFetchError(e);
    }
  }

  onMount(loadCenters);
</script>

{#if !isSuperAdmin}
  <div class="p-6 max-w-3xl mx-auto w-full">
    <Card class="p-6">
      <h1 class="text-xl font-bold text-[var(--ink)]">Access Denied</h1>
      <p class="text-sm text-[var(--muted)] mt-2">
        Franchise center management is restricted to the Platform Super-Admin.
      </p>
      <Button class="mt-4" onclick={() => goto('/dashboard')}>Go to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="p-6 max-w-5xl mx-auto w-full">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Franchise Centers</h1>
        <p class="text-sm text-[var(--muted)]">
          Provision and monitor independent franchise learning centers (Head Office).
        </p>
      </div>
      <div class="flex items-center gap-2">
        <select
          class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
          value={statusFilter}
          onchange={(e) => {
            statusFilter = e.currentTarget.value;
            loadCenters();
          }}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="archived">Archived</option>
        </select>
        <Button variant="commission" onclick={() => (showModal = true)}>Provision New Center</Button
        >
      </div>
    </div>

    {#if errorMessage}
      <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
        {errorMessage}
      </div>
    {/if}

    {#if loading}
      <p class="text-sm text-[var(--muted)]">Loading centers…</p>
    {:else if centers.length === 0}
      <Card class="p-6 text-sm text-[var(--muted)]">
        No centers yet. Provision the first franchise center to get started.
      </Card>
    {:else}
      <Card class="p-0 overflow-hidden">
        <table class="w-full text-left text-sm">
          <thead
            class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs"
          >
            <tr>
              <th class="py-3 px-4 font-semibold">Code / Name</th>
              <th class="py-3 px-4 font-semibold">Phone</th>
              <th class="py-3 px-4 font-semibold">Address</th>
              <th class="py-3 px-4 font-semibold">Created</th>
              <th class="py-3 px-4 font-semibold">Status</th>
              <th class="py-3 px-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5 dark:divide-white/5">
            {#each centers as c (c.id)}
              <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                <td class="py-3 px-4">
                  <button
                    type="button"
                    class="text-left font-semibold text-[var(--ink)] hover:underline focus:outline-none flex flex-col items-start cursor-pointer group"
                    onclick={() => openEdit(c)}
                    title="Click to edit center details"
                  >
                    <div class="flex items-center gap-1.5">
                      <span class="group-hover:text-[var(--accent)] transition-colors">{c.code}</span>
                      <span class="text-xs text-[var(--muted)] group-hover:text-[var(--accent)] font-normal transition-colors">✎ Edit</span>
                    </div>
                    <div class="font-normal text-[var(--ink)]">{c.name}</div>
                    <div class="text-xs text-[var(--muted)]">{c.legal_entity_name}</div>
                    {#if c.owner_email}
                      <div class="text-xs text-[var(--accent)] mt-0.5 font-normal">
                        Owner: {c.owner_name ? `${c.owner_name} · ` : ''}{c.owner_email}
                      </div>
                    {/if}
                  </button>
                </td>
                <td class="py-3 px-4 text-[var(--ink)]">{c.phone}</td>
                <td class="py-3 px-4 text-[var(--ink)]">{c.address}</td>
                <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">
                  {c.created_at.slice(0, 10)}
                </td>
                <td class="py-3 px-4">
                  <Chip
                    variant={c.status === 'active'
                      ? 'commission'
                      : c.status === 'suspended'
                        ? 'vat'
                        : 'default'}
                  >
                    {c.status}
                  </Chip>
                </td>
                <td class="py-3 px-4">
                  <div class="flex justify-end gap-1">
                    <Button
                      variant="default"
                      class="text-xs min-h-[44px]"
                      onclick={() => openEdit(c)}
                    >
                      Edit
                    </Button>
                    {#if c.status !== 'active'}
                      <Button class="text-xs min-h-[44px]" onclick={() => setStatus(c, 'active')}>
                        Activate
                      </Button>
                    {/if}
                    {#if c.status !== 'suspended'}
                      <Button
                        class="text-xs min-h-[44px]"
                        onclick={() => setStatus(c, 'suspended')}
                      >
                        Suspend
                      </Button>
                    {/if}
                    {#if c.status !== 'archived'}
                      <Button class="text-xs min-h-[44px]" onclick={() => setStatus(c, 'archived')}>
                        Archive
                      </Button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </Card>
    {/if}

    <Modal open={showModal} title="Provision New Center" onclose={() => (showModal = false)}>
      <form
        class="flex flex-col gap-3"
        onsubmit={(e) => {
          e.preventDefault();
          provisionCenter();
        }}
      >
        {#if formError}
          <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
            {formError}
          </div>
        {/if}
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Code (2–8 uppercase)</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={code}
            maxlength={8}
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Center Name</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={name}
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Legal Entity Name</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={legalEntityName}
            required
          />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-[var(--muted)]">BIN (optional)</span>
            <input
              class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
              bind:value={binNumber}
              maxlength={16}
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-[var(--muted)]">Trade License (optional)</span>
            <input
              class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
              bind:value={tradeLicense}
              maxlength={32}
            />
          </label>
        </div>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Address</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={address}
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Phone</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={phone}
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Initial Owner Name</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={ownerName}
            required
          />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Initial Owner Email</span>
          <input
            type="email"
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={ownerEmail}
            required
          />
        </label>
        <div class="flex justify-end gap-2 mt-2">
          <Button type="button" onclick={() => (showModal = false)}>Cancel</Button>
          <Button type="submit" variant="commission" loading={submitting}>Provision Center</Button>
        </div>
      </form>
    </Modal>

    <Modal
      open={showEditModal}
      title="Edit Center: {editingCenter?.code ?? ''}"
      onclose={() => (showEditModal = false)}
    >
      <form
        class="flex flex-col gap-3"
        onsubmit={(e) => {
          e.preventDefault();
          saveCenterEdit();
        }}
      >
        {#if editError}
          <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
            {editError}
          </div>
        {/if}

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Center Code (Immutable)</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-black/5 dark:bg-white/5 px-3 text-[var(--muted)] cursor-not-allowed font-mono font-semibold"
            value={editingCenter?.code ?? ''}
            disabled
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Center Name</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editName}
            required
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Legal Entity Name</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editLegalEntityName}
            required
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-[var(--muted)]">BIN (optional)</span>
            <input
              class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
              bind:value={editBinNumber}
              maxlength={16}
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-[var(--muted)]">Trade License (optional)</span>
            <input
              class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
              bind:value={editTradeLicense}
              maxlength={32}
            />
          </label>
        </div>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Address</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editAddress}
            required
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Phone</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editPhone}
            required
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Center Owner Email</span>
          <input
            type="email"
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editOwnerEmail}
            placeholder="owner@example.com"
            required
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Center Owner Name</span>
          <input
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editOwnerName}
            placeholder="Owner Full Name"
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-[var(--muted)]">Status</span>
          <select
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-3 text-[var(--ink)]"
            bind:value={editStatus}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </label>

        <div class="flex justify-end gap-2 mt-2">
          <Button type="button" onclick={() => (showEditModal = false)}>Cancel</Button>
          <Button type="submit" variant="commission" loading={editSubmitting}>Save Changes</Button>
        </div>
      </form>
    </Modal>
  </div>
{/if}
