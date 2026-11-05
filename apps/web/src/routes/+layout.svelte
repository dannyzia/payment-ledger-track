<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { handleClientGuard } from '$lib/auth/guard';
  import InstallBanner from '$lib/ui/InstallBanner.svelte';
  import UpgradePromptModal from '$lib/ui/UpgradePromptModal.svelte';
  import { initStoragePersistence } from '$lib/pwa/storage';
  import { initPersistentDeviceId } from '$lib/auth/device';
  import '../app.css';

  let { children } = $props();
  let showUpgradeModal = $state(false);

  // Synchronous client navigation guard (Plan 008, PRD §9.3)
  beforeNavigate(({ to, cancel }) => {
    if (to?.url) {
      handleClientGuard(to.url, cancel);
    }
  });

  onMount(() => {
    // Initial page load guard check (Plan 008)
    handleClientGuard(new URL(window.location.href), () => {});

    // Request persistent storage on initialization (PRD §12)
    initStoragePersistence().catch(console.error);

    // Restore persistent device UUID from @capacitor/preferences across app
    // storage wipes (Plan 019, PRD §9.1); no-op on non-native platforms
    initPersistentDeviceId().catch(console.error);

    // Service worker registration with prompt lifecycle (PRD §9.2, §13; vite-pwa
    // SvelteKit docs: the virtual module must be imported dynamically in onMount)
    void (async () => {
      try {
        const { registerSW } = await import('virtual:pwa-register');
        registerSW({
          immediate: true,
          onNeedRefresh() {
            // Waiting service worker present: prompt the user (non-disruptive)
            showUpgradeModal = true;
          },
          onRegisterError(error) {
            console.warn('Service worker registration error:', error);
          },
        });
      } catch (error) {
        console.warn('PWA register module unavailable:', error);
      }
    })();

    // Engine version mismatch listener from sync rejection recovery (PRD §6.5, Test #56)
    const handleUpgrade = () => {
      showUpgradeModal = true;
    };
    window.addEventListener('clt:upgrade-required', handleUpgrade);

    return () => {
      window.removeEventListener('clt:upgrade-required', handleUpgrade);
    };
  });
</script>

<div class="min-h-screen bg-[var(--bg)] text-[var(--ink)] antialiased font-sans">
  <InstallBanner />
  <UpgradePromptModal bind:open={showUpgradeModal} />
  {@render children()}
</div>
