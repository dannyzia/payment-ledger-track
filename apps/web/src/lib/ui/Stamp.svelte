<script lang="ts">
  /* The world's stamp imprint: narrow caps inside a ruled border. Used for the
     states that must read as struck (VOID), settled (PAID) or sealed (CLOSED).
     Colours come from the palette; dark theme lifts the red so large marks keep
     their contrast on the coupon-navy surface. */
  interface Props {
    label: string;
    tone?: 'red' | 'navy' | 'amber';
    seal?: boolean;
    class?: string;
  }

  let { label, tone = 'red', seal = false, class: className = '' }: Props = $props();

  const toneClass = $derived(
    tone === 'navy'
      ? 'text-[var(--accent-2)] dark:text-[var(--navy-muted)]'
      : tone === 'amber'
        ? 'text-[var(--c-vat)]'
        : 'text-[var(--accent)] dark:text-[#ff8a8f]',
  );
</script>

<span
  class="inline-flex items-center justify-center tab-caps border-current rounded-[2px] leading-none {toneClass} {seal
    ? 'border-[3px] px-6 py-3 text-2xl tracking-[0.2em] outline outline-2 outline-offset-[5px]'
    : 'border-2 px-2 py-0.5 text-[10px] tracking-[0.14em]'} {className}">{label}</span
>
