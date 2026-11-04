<script lang="ts">
  interface Props {
    visible: boolean;
  }

  let { visible }: Props = $props();
</script>

{#if visible}
  <div
    role="status"
    class="duplicate-warning p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2"
  >
    <span class="text-base">⚠</span>
    <span>A transaction with this reference or customer name already exists today. Verify details before saving.</span>
  </div>
{/if}
