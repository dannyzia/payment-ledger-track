<script lang="ts">
  /* eslint-disable svelte/valid-compile -- rest-props attribute forwarding is a plan P2.1 requirement; the
  custom_element_props_identifier note only arises when the file is compiled as a custom element, which this
  app never does (svelte-check single-compile gate stays clean). See DECISIONS.md CLT-D-010. */
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    variant?: 'solid' | 'glass' | 'subtle';
    subtle?: boolean; // Backward-compatible alias for variant="subtle"
    class?: string;
    children?: Snippet;
  }

  let { variant = 'solid', subtle = false, class: className = '', children, ...restProps }: Props = $props();

  const variantClass = $derived.by(() => {
    if (subtle) return 'glass-subtle';
    if (variant === 'glass') return 'glass';
    if (variant === 'subtle') return 'glass-subtle';
    return 'bg-[var(--surface)] border border-[var(--pearl-border)]';
  });
</script>

<div class="{variantClass} rounded-[18px] p-5 shadow-sm {className}" {...restProps}>
  {#if children}
    {@render children()}
  {/if}
</div>
