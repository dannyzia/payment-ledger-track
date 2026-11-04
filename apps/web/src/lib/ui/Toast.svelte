<script lang="ts">
  import { messages } from '../i18n/messages';

  export interface ToastMessage {
    id: string;
    text: string;
    type: 'info' | 'success' | 'warning' | 'error';
  }

  interface Props {
    toasts: ToastMessage[];
    ondismiss: (id: string) => void;
  }

  let { toasts, ondismiss }: Props = $props();

  const typeBorderMap = {
    info: 'border-[var(--pearl-border)]',
    success: 'border-l-4 border-l-[var(--c-commission)]',
    warning: 'border-l-4 border-l-[var(--c-vat)]',
    error: 'border-l-4 border-l-[var(--c-bkash)]',
  };
</script>

<aside aria-label={messages.ui.notifications} class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
  {#each toasts as toast (toast.id)}
    <div
      class="glass rounded-xl p-4 shadow-lg pointer-events-auto flex items-center justify-between text-sm {typeBorderMap[toast.type]}"
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <span class="text-[var(--ink)]">{toast.text}</span>
      <button
        type="button"
        onclick={() => ondismiss(toast.id)}
        class="ml-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--ink)]"
        aria-label={messages.ui.dismissNotification}
      >
        ✕
      </button>
    </div>
  {/each}
</aside>
