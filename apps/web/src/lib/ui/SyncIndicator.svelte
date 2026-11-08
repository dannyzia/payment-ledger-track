<script lang="ts">
  import { syncRunner } from '$lib/sync/runner.svelte';
  import { db } from '$lib/db';
  import { liveQuery } from 'dexie';

  let pendingCount = $state(0);

  $effect(() => {
    const sub = liveQuery(() => db.outbox.where('status').equals('pending').count()).subscribe(
      (c) => {
        pendingCount = c;
      },
    );
    return () => sub.unsubscribe();
  });
</script>

<div
  class="sync-indicator inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border border-black/10 dark:border-white/10 glass shadow-xs"
>
  {#if syncRunner.status === 'syncing'}
    <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
    <span class="text-blue-600 dark:text-blue-400">Syncing...</span>
  {:else if syncRunner.status === 'error'}
    <button
      type="button"
      onclick={() => syncRunner.triggerCycle()}
      class="flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:underline cursor-pointer focus:outline-hidden"
      title="Sync encountered an error. Click to retry."
    >
      <span class="w-2 h-2 rounded-full bg-red-500"></span>
      <span>Sync error (tap to retry)</span>
    </button>
  {:else if syncRunner.status === 'signed_out'}
    <!-- CLT-R-015: a missing session is not a sync failure; say so and offer the way back in. -->
    <a
      href="/login"
      class="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 hover:underline"
    >
      <span class="w-2 h-2 rounded-full bg-amber-500"></span>
      <span>Signed out — sign in</span>
    </a>
  {:else if syncRunner.status === 'offline'}
    <span class="w-2 h-2 rounded-full bg-amber-500"></span>
    <span class="text-amber-700 dark:text-amber-300"
      >Offline{pendingCount > 0 ? ` (${pendingCount} pending)` : ''}</span
    >
  {:else if pendingCount > 0}
    <span class="w-2 h-2 rounded-full bg-amber-500"></span>
    <span class="text-amber-700 dark:text-amber-300">{pendingCount} pending</span>
  {:else}
    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
    <span class="text-emerald-700 dark:text-emerald-300">Synced</span>
  {/if}
</div>
