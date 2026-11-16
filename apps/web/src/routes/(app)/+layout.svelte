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
  import { hasCapability } from '$lib/capabilities';

  let { children } = $props();

  const userRole = $derived(session.user?.role ?? 'staff');
  const userEmail = $derived(session.user?.email ?? '');
  // Platform surface is a capability, not the role string (Plan 023 §6.1).
  const isPlatform = $derived(hasCapability(userRole, 'center.read_all'));
  const centerBadge = $derived(
    isPlatform
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
    if (hasCapability(session.user?.role ?? 'staff', 'center.read_all')) void loadSwitcherCenters();
    return () => syncRunner.stop();
  });

  async function loadSwitcherCenters(): Promise<void> {
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
  }

  // Plan 023 steps 6-7: the security screen that proves aal2 lives inside this layout,
  // so the mount-time fetch above runs on an aal1 token and the route refuses it with
  // `403 assurance_required`. Retry once this session has proven its second factor,
  // or the switcher stays empty until the user reloads.
  let centersLoadedForAal2 = $state(false);
  $effect(() => {
    if (!isPlatform || session.aal !== 'aal2' || centersLoadedForAal2) return;
    centersLoadedForAal2 = true;
    void loadSwitcherCenters();
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
      {#if isPlatform}
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
