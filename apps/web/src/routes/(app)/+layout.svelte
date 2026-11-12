<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from '$lib/ui/Sidebar.svelte';
  import FloatingMenu from '$lib/ui/FloatingMenu.svelte';
  import CommandPalette from '$lib/ui/CommandPalette.svelte';
  import SyncIndicator from '$lib/ui/SyncIndicator.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { syncRunner } from '$lib/sync/runner.svelte';
  import { invalidateInFlightPull, resetSuperCenterCache } from '$lib/sync/pull';
  import { authFetch } from '$lib/api/client';
  import Chip from '$lib/ui/Chip.svelte';

  let { children } = $props();

  const userRole = $derived(session.user?.role ?? 'staff');
  const userEmail = $derived(session.user?.email ?? '');
  const isSuperAdmin = $derived(userRole === 'super_admin');
  const centerBadge = $derived(
    isSuperAdmin
      ? 'PLATFORM SUPER-ADMIN'
      : session.user?.centerCode
        ? `${session.user.centerCode} - ${session.user.centerName ?? ''}`.trim()
        : null,
  );
  let isCommandPaletteOpen = $state(false);

  // Super-admin center switcher: 'all' means the global (cross-center) view.
  interface SwitchableCenter {
    id: string;
    code: string;
    name: string;
  }
  let switcherCenters = $state<SwitchableCenter[]>([]);
  let activeCenter = $state('all');

  onMount(() => {
    syncRunner.start();
    try {
      activeCenter = sessionStorage.getItem('clt_super_center') || 'all';
    } catch {
      // Private mode: switcher falls back to in-memory state only.
    }
    if (session.user?.role === 'super_admin') {
      void (async () => {
        try {
          const res = await authFetch('/api/v1/admin/super/centers');
          if (res.ok) {
            const data = await res.json();
            switcherCenters = (data.centers ?? []).map((c: SwitchableCenter) => ({
              id: c.id,
              code: c.code,
              name: c.name,
            }));
          }
        } catch {
          // Switcher stays empty on network failure; badge still shows.
        }
      })();
    }
    return () => syncRunner.stop();
  });

  async function handleCenterSwitch(value: string) {
    activeCenter = value;
    try {
      sessionStorage.setItem('clt_super_center', value);
    } catch {
      // Ignore storage errors
    }
    invalidateInFlightPull();
    await syncRunner.syncNow(() => resetSuperCenterCache());
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      isCommandPaletteOpen = !isCommandPaletteOpen;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen overflow-hidden bg-[var(--bg)]">
  <!-- Desktop Sidebar Navigation Rail -->
  <div
    class="hidden md:flex flex-col justify-between w-64 border-r border-[var(--pearl-border)] glass"
  >
    <div class="flex-1 overflow-y-auto">
      <Sidebar role={userRole} />
    </div>

    <!-- User Profile & Sign Out Action (PRD §9.3) -->
    <div
      class="p-4 border-t border-[var(--pearl-border)] flex flex-col gap-2 bg-black/5 dark:bg-white/5"
    >
      {#if centerBadge}
        <Chip>{centerBadge}</Chip>
      {/if}
      {#if isSuperAdmin}
        <label class="flex flex-col gap-1 text-xs text-[var(--muted)]">
          <span>Center Context</span>
          <select
            class="min-h-[44px] rounded-lg border border-[var(--pearl-border)] bg-[var(--surface)] px-2 text-[var(--ink)]"
            value={activeCenter}
            onchange={(e) => handleCenterSwitch(e.currentTarget.value)}
          >
            <option value="all">All Centers (Global)</option>
            {#each switcherCenters as c (c.id)}
              <option value={c.id}>{c.code} - {c.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      <div class="text-xs text-[var(--muted)] truncate font-mono" title={userEmail}>
        {userEmail}
      </div>
      <Button
        variant="default"
        class="w-full text-xs text-red-600 hover:bg-red-500/10 min-h-[44px]"
        onclick={() => session.signOut()}
      >
        Sign Out
      </Button>
    </div>
  </div>

  <!-- Mobile Floating Menu Navigation -->
  <div class="md:hidden">
    <FloatingMenu role={userRole} />
  </div>

  <!-- Sync Status Indicator — visible on every authenticated screen (Plan 011) -->
  <div class="fixed top-3 right-4 z-50">
    <SyncIndicator />
  </div>

  <!-- Desktop Command Palette Overlay (PRD §14.5) -->
  <CommandPalette
    role={userRole}
    open={isCommandPaletteOpen}
    onclose={() => (isCommandPaletteOpen = false)}
  />

  <!-- Primary Content Landmark -->
  <main id="main-content" class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
