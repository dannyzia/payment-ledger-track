<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';

  interface UserProfile {
    id: string;
    email: string;
    display_name: string;
    role: 'owner' | 'admin' | 'staff';
    active: boolean;
    created_at: string;
  }

  let users = $state<UserProfile[]>([]);
  let callerRole = $state<string>('staff');
  let loading = $state(true);
  let showInviteModal = $state(false);
  let showTransferModal = $state(false);
  let inviting = $state(false);
  let transferring = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');

  // Invite state
  let inviteEmail = $state('');
  let inviteFullName = $state('');
  let inviteRole = $state<'staff' | 'admin'>('staff');

  // Ownership transfer state
  let targetAdminId = $state('');
  let transferConfirmText = $state('');

  async function loadUsers() {
    loading = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/users');
      if (res.ok) {
        const data = await res.json();
        users = data.users ?? [];
        callerRole = data.callerRole ?? 'staff';
      } else {
        const err = await res.json();
        errorMessage = err.message || 'Failed to load user roster';
      }
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  async function inviteUser() {
    inviting = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          fullName: inviteFullName.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to invite user');
      }

      showInviteModal = false;
      inviteEmail = '';
      inviteFullName = '';
      inviteRole = 'staff';
      successMessage = 'Invitation sent successfully.';
      await loadUsers();
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      inviting = false;
    }
  }

  async function updateUserRole(userId: string, newRole: 'staff' | 'admin') {
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_role',
          userId,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to update user role');
      }

      await loadUsers();
    } catch (e) {
      errorMessage = adminFetchError(e);
    }
  }

  async function toggleUserActive(u: UserProfile) {
    errorMessage = '';
    try {
      const nextAction = u.active ? 'deactivate' : 'reactivate';
      const res = await authFetch('/api/v1/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: nextAction,
          userId: u.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to update user status');
      }

      await loadUsers();
    } catch (e) {
      errorMessage = adminFetchError(e);
    }
  }

  async function executeTransferOwnership() {
    if (transferConfirmText !== 'TRANSFER OWNERSHIP') {
      errorMessage = 'Please type TRANSFER OWNERSHIP in capital letters to confirm.';
      return;
    }

    transferring = true;
    errorMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/transfer-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newOwnerId: targetAdminId,
          confirmationPhrase: transferConfirmText,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to transfer ownership');
      }

      showTransferModal = false;
      targetAdminId = '';
      transferConfirmText = '';
      successMessage = 'Ownership transferred successfully. Your account has been demoted to Admin.';
      await loadUsers();
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      transferring = false;
    }
  }

  onMount(loadUsers);
</script>

<div class="p-6 max-w-5xl mx-auto w-full">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Team Roster & Roles</h1>
      <p class="text-sm text-[var(--muted)]">Manage authorized staff, administrators, and store ownership privileges.</p>
    </div>
    <div class="flex gap-3">
      {#if callerRole === 'owner'}
        <Button variant="default" onclick={() => (showTransferModal = true)}>
          Transfer Ownership
        </Button>
      {/if}
      <Button variant="default" onclick={() => (showInviteModal = true)}>
        Invite Team Member
      </Button>
    </div>
  </div>

  {#if successMessage}
    <div class="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-700 text-sm">
      {successMessage}
    </div>
  {/if}

  {#if errorMessage}
    <div class="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
      {errorMessage}
    </div>
  {/if}

  <Card class="p-0 overflow-hidden">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] text-xs">
        <tr>
          <th class="py-3 px-4 font-semibold">Name & Email</th>
          <th class="py-3 px-4 font-semibold">Role</th>
          <th class="py-3 px-4 font-semibold">Account Status</th>
          <th class="py-3 px-4 font-semibold">Joined</th>
          <th class="py-3 px-4 font-semibold text-right">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-black/5 dark:divide-white/5">
        {#each users as u (u.id)}
          <tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
            <td class="py-3 px-4">
              <div class="font-medium text-[var(--ink)]">{u.display_name}</div>
              <div class="font-mono text-xs text-[var(--muted)]">{u.email}</div>
            </td>
            <td class="py-3 px-4">
              <Chip variant={u.role === 'owner' ? 'commission' : u.role === 'admin' ? 'default' : 'vat'}>
                {u.role.toUpperCase()}
              </Chip>
            </td>
            <td class="py-3 px-4">
              <Chip variant={u.active ? 'commission' : 'default'}>
                {u.active ? 'Active' : 'Deactivated'}
              </Chip>
            </td>
            <td class="py-3 px-4 font-mono text-xs text-[var(--muted)]">
              {new Date(u.created_at).toLocaleDateString()}
            </td>
            <td class="py-3 px-4 text-right">
              <div class="flex items-center justify-end gap-2">
                {#if (callerRole === 'owner' && u.role !== 'owner') || (callerRole === 'admin' && u.role === 'staff')}
                  {#if callerRole === 'owner'}
                    <select
                      value={u.role}
                      onchange={(e) => updateUserRole(u.id, (e.target as HTMLSelectElement).value as 'staff' | 'admin')}
                      class="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 bg-white/50"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  {/if}

                  <Button
                    variant="default"
                    class="text-xs py-1 px-2.5"
                    onclick={() => toggleUserActive(u)}
                  >
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                {:else if u.role === 'owner'}
                  <span class="text-xs text-[var(--muted)] italic">Sole Owner</span>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
        {#if users.length === 0 && !loading && !errorMessage}
          <tr>
            <td colspan="5" class="py-8 text-center text-sm text-[var(--muted)]">
              No team members found.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </Card>
</div>

<!-- Invite Modal -->
<Modal bind:open={showInviteModal} title="Invite New Team Member" onclose={() => (showInviteModal = false)}>
  <div class="space-y-4">
    <div>
      <label for="invite-fullname" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Full Name</label>
      <input
        id="invite-fullname"
        type="text"
        placeholder="e.g. Rahim Ahmed"
        bind:value={inviteFullName}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      />
    </div>

    <div>
      <label for="invite-email" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Email Address</label>
      <input
        id="invite-email"
        type="email"
        placeholder="rahim@cosmoledger.local"
        bind:value={inviteEmail}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
      />
    </div>

    <div>
      <label for="invite-role-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Assigned Role</label>
      <select
        id="invite-role-select"
        bind:value={inviteRole}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      >
        <option value="staff">Staff (Daily entry creation & local offline sync)</option>
        {#if callerRole === 'owner'}
          <option value="admin">Administrator (Rate rules, payables & user management)</option>
        {/if}
      </select>
      <p class="text-[11px] text-[var(--muted)] mt-1">
        Only the active store Owner can provision Administrator accounts. Owner accounts cannot be provisioned via invite.
      </p>
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showInviteModal = false)}>Cancel</Button>
      <Button variant="default" onclick={inviteUser} disabled={inviting || !inviteEmail || !inviteFullName}>
        {inviting ? 'Inviting...' : 'Send Invitation'}
      </Button>
    </div>
  </div>
</Modal>

<!-- Ownership Transfer Modal -->
<Modal bind:open={showTransferModal} title="Two-Step Atomic Ownership Transfer" onclose={() => (showTransferModal = false)}>
  <div class="space-y-4">
    <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-800 space-y-1">
      <p class="font-semibold">Irreversible Owner Transfer Warning:</p>
      <p>• You are surrendering sole ownership of this organization.</p>
      <p>• The selected Admin will be elevated to Owner.</p>
      <p>• Your account will be demoted to Administrator atomically in a single transaction.</p>
      <p>• This action is immediately committed and logged in the append-only audit trail.</p>
    </div>

    <div>
      <label for="transfer-admin-select" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">Select Successor Administrator</label>
      <select
        id="transfer-admin-select"
        bind:value={targetAdminId}
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
      >
        <option value="">Select active Admin...</option>
        {#each users.filter((u) => u.role === 'admin' && u.active) as a}
          <option value={a.id}>{a.display_name} ({a.email})</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="transfer-confirm-input" class="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-1">
        Type <strong class="text-red-700">TRANSFER OWNERSHIP</strong> to confirm:
      </label>
      <input
        id="transfer-confirm-input"
        type="text"
        bind:value={transferConfirmText}
        placeholder="TRANSFER OWNERSHIP"
        class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-mono"
      />
    </div>

    <div class="flex justify-end gap-3 pt-4">
      <Button variant="default" onclick={() => (showTransferModal = false)}>Cancel</Button>
      <Button
        variant="default"
        class="bg-red-700 hover:bg-red-800 text-white"
        onclick={executeTransferOwnership}
        disabled={transferring || !targetAdminId || transferConfirmText !== 'TRANSFER OWNERSHIP'}
      >
        {transferring ? 'Transferring...' : 'Execute Ownership Transfer'}
      </Button>
    </div>
  </div>
</Modal>
