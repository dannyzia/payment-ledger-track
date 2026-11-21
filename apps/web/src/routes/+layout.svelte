<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { handleClientGuard } from '$lib/auth/guard';
  import { session } from '$lib/auth/session.svelte';
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

  // Initial page load guard check (Plan 008). Run after the load settles: a goto issued
  // while hydration is still committing the first navigation is dropped, which left a
  // refused deep link showing the Access Denied screen while the address bar still said
  // the refused path.
  afterNavigate(() => {
    handleClientGuard(new URL(window.location.href), () => {});
  });

  // Re-evaluate client guard once asynchronous session resolution settles (Plan 008, CLT-R-015)
  $effect(() => {
    if (!session.loading && typeof window !== 'undefined') {
      handleClientGuard(new URL(window.location.href), () => {});
    }
  });

  onMount(() => {
    // Request persistent storage on initialization (PRD §12)
    initStoragePersistence().catch(console.error);

    // Restore persistent device UUID from @capacitor/preferences across app
    // storage wipes (Plan 019, PRD §9.1); no-op on non-native platforms
    initPersistentDeviceId().catch(console.error);

    // Service worker registration with prompt lifecycle (PRD §9.2, §13; vite-pwa
    // SvelteKit docs: the virtual module must be imported dynamically in onMount)
    void (async () => {
      try {
        if (import.meta.env.DEV) {
          // Dev has no workbox precache (vite.config.ts devOfflineShell serves this
          // worker): network-first with a cached shell, so an offline reload can be
          // exercised locally. Production registration below is untouched.
          await navigator.serviceWorker?.register('/dev-offline-sw.js', { scope: '/' });
          return;
        }
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
