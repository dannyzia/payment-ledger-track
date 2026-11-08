<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/ui/Button.svelte';
  import { messages } from '$lib/i18n/messages';

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let deferredPrompt: BeforeInstallPromptEvent | null = $state(null);
  let visible = $state(false);

  const DISMISS_KEY = 'clt_install_dismissed';
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  function isDismissedRecently(): boolean {
    if (typeof window === 'undefined') return true;
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (!dismissedAt) return false;
    return Date.now() - parseInt(dismissedAt, 10) < SEVEN_DAYS_MS;
  }

  onMount(() => {
    if (isDismissedRecently()) return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      visible = true;
    };

    const handleAppInstalled = () => {
      visible = false;
      deferredPrompt = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  });

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      visible = false;
    }
    deferredPrompt = null;
  }

  function handleDismiss() {
    visible = false;
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }
</script>

{#if visible}
  <!-- Positioned safely above mobile floating menu / navigation respecting safe-area-insets (Rule R16, PRD §14.5) -->
  <aside
    class="install-banner glass fixed left-4 right-4 md:bottom-4 md:left-auto md:right-4 md:w-96 z-40 p-4 rounded-xl shadow-xl flex items-center justify-between gap-3 border border-[var(--pearl-border)]"
    style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));"
    aria-label={messages.pwa.installBannerAria}
  >
    <div class="flex items-center gap-3">
      <img
        src="/icons/icon-192.png"
        alt="Kumon Ledger Track"
        class="w-10 h-10 rounded-lg shadow-sm"
      />
      <div>
        <p class="text-sm font-semibold text-[var(--ink)]">{messages.pwa.installBannerTitle}</p>
        <p class="text-xs text-[var(--muted)]">{messages.pwa.installBannerSubtitle}</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="default" onclick={handleDismiss}>
        {messages.pwa.dismissButton}
      </Button>
      <Button variant="commission" onclick={handleInstall}>
        {messages.pwa.installButton}
      </Button>
    </div>
  </aside>
{/if}
