<script lang="ts">
  import { onMount } from 'svelte';
  import { hasCapability } from '$lib/capabilities';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import CouponHead from '$lib/ui/CouponHead.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import { authFetch } from '$lib/api/client';
  import { adminFetchError } from '$lib/api/offline';
  import { session } from '$lib/auth/session.svelte';

  interface FleetUser {
    id: string;
    fullName: string;
    email: string | null;
    role: 'staff' | 'admin' | 'owner' | 'super_admin';
    active: boolean;
    centerId: string | null;
    centerCode: string | null;
    centerName: string | null;
    createdAt: string;
  }

  interface CenterOption {
    id: string;
    code: string;
    name: string;
  }

  const canRead = $derived(hasCapability(session.user?.role ?? 'staff', 'user.read_all'));

  let users = $state<FleetUser[]>([]);
  let centers = $state<CenterOption[]>([]);
  let query = $state('');
  let centerFilter = $state('all');
  let loading = $state(false);
  let errorMessage = $state('');
  let actionMessage = $state('');
  let pending = $state<{ id: string; action: 'disable' | 'enable' | 'force_signout' } | null>(null);

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
      if (query.trim()) params.set('q', query.trim());
      if (centerFilter !== 'all') params.set('centerId', centerFilter);
      const res = await authFetch(`/api/v1/admin/super/users?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      users = ((await res.json()) as { users: FleetUser[] }).users;
    } catch (e) {
      errorMessage = adminFetchError(e);
    } finally {
      loading = false;
    }
  }

  async function act(user: FleetUser, action: 'disable' | 'enable' | 'force_signout') {
    if (!user.centerId) {
      actionMessage = 'A platform account has no center to act on here.';
      return;
    }
    // Two-step: the first click arms, the second applies. A killswitch action is not
    // something to fire from a stray tap.
    if (pending?.id !== user.id || pending.action !== action) {
      pending = { id: user.id, action };
      actionMessage = `Click again to confirm “${action.replace('_', ' ')}” for ${user.fullName}.`;
      return;
    }

    pending = null;
    actionMessage = '';
    try {
      const res = await authFetch('/api/v1/admin/super/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centerId: user.centerId, userId: user.id, action }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessionsRevoked?: number;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      actionMessage =
        action === 'force_signout'
          ? `${user.fullName} signed out: ${body.sessionsRevoked ?? 0} refresh session(s) revoked. An access token already issued stays valid until it expires.`
          : `${user.fullName} ${action === 'disable' ? 'disabled' : 'enabled'}.`;
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

<div class="p-6 max-w-5xl mx-auto w-full flex flex-col gap-4">
  <CouponHead
    tab="Fleet"
    title="Fleet Users"
    subtitle="Every center's people, searched across the fleet."
  />

  {#if !canRead}
    <Card class="p-6">
      <h2 class="text-lg font-bold text-[var(--ink)]">Access Denied</h2>
      <p class="text-sm text-[var(--muted)] mt-2">
        Cross-center user management belongs to the Platform Super-Admin.
      </p>
    </Card>
  {:else}
    <Card class="p-4">
      <form
        class="flex flex-col sm:flex-row gap-2"
        onsubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          class="flex-1 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
          placeholder="Name or email"
          bind:value={query}
        />
        <select
          class="px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm"
          bind:value={centerFilter}
        >
          <option value="all">Every center</option>
          {#each centers as center (center.id)}
            <option value={center.id}>{center.code} — {center.name}</option>
          {/each}
        </select>
        <Button variant="commission" type="submit" disabled={loading}>Search</Button>
      </form>
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
            <th class="px-4 py-3">User</th>
            <th class="px-4 py-3">Role</th>
            <th class="px-4 py-3">Center</th>
            <th class="px-4 py-3">State</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each users as user (user.id)}
            <tr class="border-t border-black/10 dark:border-white/10">
              <td class="px-4 py-3">
                <p class="font-semibold text-[var(--ink)]">{user.fullName}</p>
                <p class="text-xs text-[var(--muted)]">{user.email ?? 'no email on record'}</p>
              </td>
              <td class="px-4 py-3">{user.role}</td>
              <td class="px-4 py-3">{user.centerCode ?? 'platform'}</td>
              <td class="px-4 py-3">
                <Chip variant={user.active ? 'commission' : 'vat'}>
                  {user.active ? 'active' : 'disabled'}
                </Chip>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="default"
                    onclick={() => void act(user, user.active ? 'disable' : 'enable')}
                  >
                    {user.active ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="default" onclick={() => void act(user, 'force_signout')}>
                    Force sign-out
                  </Button>
                </div>
              </td>
            </tr>
          {/each}
          {#if users.length === 0}
            <tr>
              <td colspan="5" class="px-4 py-6 text-center text-sm text-[var(--muted)]">
                No users match this search.
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </Card>
  {/if}
</div>
