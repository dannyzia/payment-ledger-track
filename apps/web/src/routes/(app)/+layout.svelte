<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from '$lib/ui/Sidebar.svelte';
  import FloatingMenu from '$lib/ui/FloatingMenu.svelte';
  import CommandPalette from '$lib/ui/CommandPalette.svelte';
  import SyncIndicator from '$lib/ui/SyncIndicator.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { syncRunner } from '$lib/sync/runner.svelte';

  let { children } = $props();

  const userRole = $derived(session.user?.role ?? 'staff');
  const userEmail = $derived(session.user?.email ?? '');
  let isCommandPaletteOpen = $state(false);

  onMount(() => {
    syncRunner.start();
    return () => syncRunner.stop();
  });

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
  <div class="hidden md:flex flex-col justify-between w-64 border-r border-[var(--pearl-border)] glass">
    <div class="flex-1 overflow-y-auto">
      <Sidebar role={userRole} />
    </div>

    <!-- User Profile & Sign Out Action (PRD §9.3) -->
    <div class="p-4 border-t border-[var(--pearl-border)] flex flex-col gap-2 bg-black/5 dark:bg-white/5">
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
