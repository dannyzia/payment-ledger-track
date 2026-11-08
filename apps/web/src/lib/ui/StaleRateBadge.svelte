<script lang="ts">
  import { messages } from '$lib/i18n/messages';

  interface Props {
    stale: boolean;
    size?: 'sm' | 'md';
  }

  let { stale, size = 'sm' }: Props = $props();
</script>

{#if stale}
  <span
    class="stale-rate-badge inline-flex items-center gap-1 font-medium rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800"
    class:px-2={size === 'sm'}
    class:py-0.5={size === 'sm'}
    class:text-xs={size === 'sm'}
    class:px-2.5={size === 'md'}
    class:py-1={size === 'md'}
    class:text-sm={size === 'md'}
    title={messages.pwa.staleRateTooltip}
  >
    <svg
      class="w-3.5 h-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
    <span>{messages.pwa.staleRateBadge}</span>
  </span>
{/if}
