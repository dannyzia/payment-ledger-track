<script lang="ts">
  /* The world's page head: a carrier-navy band carrying the notched tab-cap,
     the page title and an optional right slot for text/chips/stamps.
     Interactive form controls stay out of the band: .on-navy re-points --surface
     to transparent, so a stub button or input inside it would lose its fill. */
  import SyncIndicator from './SyncIndicator.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    tab: string;
    title: string;
    subtitle?: string;
    class?: string;
    children?: Snippet;
  }

  let { tab, title, subtitle, class: className = '', children }: Props = $props();
</script>

<div class="on-navy relative -mx-6 px-6 pt-2.5 pb-3.5 mb-6 {className}">
  <div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-3 min-w-0">
      <span class="coupon-tab shrink-0">{tab}</span>
      <div class="min-w-0">
        <h1 class="text-xl font-bold tracking-tight text-[var(--ink)]">{title}</h1>
        {#if subtitle}
          <p class="hidden sm:block text-xs text-[var(--muted)]">{subtitle}</p>
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <!-- The sync dock: one indicator per screen, inside the band (entries/new
           pattern), so the shell's floating pill never rides the band edge. It is
           visible at every width — an offline-first ledger must always show
           online/offline/pending state, and SyncIndicator shortens its own label
           below the sm breakpoint to keep the headline its room. -->
      <span class="flex items-center"><SyncIndicator /></span>
      {#if children}<div class="flex items-center gap-2">{@render children()}</div>{/if}
    </div>
  </div>
</div>
