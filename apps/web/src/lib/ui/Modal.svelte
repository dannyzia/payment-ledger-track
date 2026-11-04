<script lang="ts">
  import type { Snippet } from 'svelte';
  import { messages } from '../i18n/messages';

  interface Props {
    open: boolean;
    title: string;
    onclose: () => void;
    children?: Snippet;
  }

  let { open = $bindable(false), title, onclose, children }: Props = $props();

  let dialogEl: HTMLDialogElement | null = $state(null);

  $effect(() => {
    if (!dialogEl) return;
    if (open && !dialogEl.open) {
      dialogEl.showModal();
    } else if (!open && dialogEl.open) {
      dialogEl.close();
    }
  });

  function handleCancel(e: Event) {
    e.preventDefault();
    onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) {
      onclose();
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
  aria-labelledby="modal-title"
  class="glass rounded-[20px] max-w-lg w-full p-6 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm m-auto border border-[var(--pearl-border)]"
>
  <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
    <h2 id="modal-title" class="text-lg font-bold text-[var(--ink)]">{title}</h2>
    <button
      type="button"
      aria-label={messages.ui.closeModal}
      onclick={onclose}
      class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[var(--muted)]"
    >
      ✕
    </button>
  </div>
  <div class="mt-4">
    {#if children}
      {@render children()}
    {/if}
  </div>
</dialog>
