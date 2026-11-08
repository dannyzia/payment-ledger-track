<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { messages } from '$lib/i18n/messages';

  interface Props {
    open: boolean;
  }

  let { open = $bindable(false) }: Props = $props();
  let updating = $state(false);

  async function handleReload() {
    if (typeof window === 'undefined') return;
    updating = true;

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          // reg.waiting narrows to never under this lib setup; annotate explicitly
          // (CLT-D-021 mechanical fix)
          const waiting: ServiceWorker | null = reg.waiting;
          if (waiting) {
            waiting.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            return;
          }
          await reg.update();
          const waitingAfterUpdate: ServiceWorker | null = reg.waiting;
          if (waitingAfterUpdate) {
            waitingAfterUpdate.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            });
            return;
          }
        }
      } catch (err) {
        console.warn('Service worker skipWaiting update failed:', err);
      }
    }

    window.location.reload();
  }
</script>

{#if open}
  <!-- Non-dismissible modal: onclose is a no-op to ensure upgrade cannot be bypassed (PRD §9.2.2, Test #56) -->
  <Modal bind:open title={messages.pwa.upgradeModalTitle} onclose={() => {}}>
    <div class="space-y-4">
      <div class="flex items-center gap-3 text-amber-600 dark:text-amber-400">
        <svg
          class="w-6 h-6 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <p class="text-sm font-medium">
          {messages.pwa.upgradeModalHeadline}
        </p>
      </div>
      <p class="text-xs text-[var(--muted)] leading-relaxed">
        {messages.pwa.upgradeModalBody}
      </p>
      <div class="flex justify-end pt-2">
        <Button
          id="btn-upgrade-reload"
          variant="commission"
          loading={updating}
          onclick={handleReload}
        >
          {messages.pwa.upgradeModalButton}
        </Button>
      </div>
    </div>
  </Modal>
{/if}
