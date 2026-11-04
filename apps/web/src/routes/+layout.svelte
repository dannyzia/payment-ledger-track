<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { handleClientGuard } from '$lib/auth/guard';
  import '../app.css';

  let { children } = $props();

  beforeNavigate(({ to, cancel }) => {
    if (to?.url) {
      handleClientGuard(to.url, cancel);
    }
  });

  onMount(() => {
    // Initial page load guard check
    handleClientGuard(new URL(window.location.href), () => {});
  });
</script>

<div class="min-h-screen bg-[var(--bg)] text-[var(--ink)] antialiased font-sans">
  {@render children()}
</div>
