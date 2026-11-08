<script lang="ts">
  /* eslint-disable svelte/valid-compile -- rest-props attribute forwarding is a plan P2.1 requirement; the
  custom_element_props_identifier note only arises when the file is compiled as a custom element, which this
  app never does (svelte-check single-compile gate stays clean). See DECISIONS.md CLT-D-010. */
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard';
    loading?: boolean;
    children?: Snippet;
  }

  let {
    variant = 'default',
    type = 'button',
    disabled = false,
    loading = false,
    class: className = '',
    children,
    ...restProps
  }: Props = $props();

  const variantClass = $derived(variant === 'default' ? '' : `btn--${variant}`);
</script>

<button
  {type}
  disabled={disabled || loading}
  aria-busy={loading ? 'true' : undefined}
  class="glass btn-glass {variantClass} {disabled
    ? 'opacity-50 cursor-not-allowed'
    : ''} {className}"
  {...restProps}
>
  {#if loading}
    <span
      class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"
      aria-hidden="true"
    ></span>
  {/if}
  {#if children}
    {@render children()}
  {/if}
</button>
