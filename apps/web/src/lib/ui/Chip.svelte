<script lang="ts">
  /* eslint-disable svelte/valid-compile -- rest-props attribute forwarding is a plan P2.1 requirement; the
  custom_element_props_identifier note only arises when the file is compiled as a custom element, which this
  app never does (svelte-check single-compile gate stays clean). See DECISIONS.md CLT-D-010. */
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    variant?: 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard';
    class?: string;
    children?: Snippet;
  }

  let { variant = 'default', class: className = '', children, ...restProps }: Props = $props();

  const styleMap: Record<string, string> = {
    default: 'background-color: var(--surface); color: var(--ink); border: 1px solid var(--muted);',
    commission:
      'background-color: var(--pearl-b); color: var(--c-commission); border: 1px solid var(--c-commission);',
    vat: 'background-color: var(--c-vat-bg); color: var(--c-vat); border: 1px solid var(--c-vat);',
    bkash:
      'background-color: var(--c-bkash-bg); color: var(--c-bkash); border: 1px solid var(--c-bkash);',
    visa: 'background-color: var(--c-visa-bg); color: var(--c-visa); border: 1px solid var(--c-visa);',
    mastercard:
      'background-color: var(--c-mastercard-bg); color: var(--c-mastercard); border: 1px solid var(--c-mastercard);',
  };
</script>

<span
  class="chip inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {className}"
  style={styleMap[variant]}
  {...restProps}
>
  {#if children}
    {@render children()}
  {/if}
</span>
