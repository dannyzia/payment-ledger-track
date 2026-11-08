<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';
  import { goto } from '$app/navigation';

  let statusMessage = $state('Verifying invitation link...');
  let errorMessage = $state('');

  onMount(async () => {
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (data.session) {
          await session.syncFromSupabaseSession(data.session);
          goto('/set-password');
          return;
        }
      }

      // Check for active or hash-parsed session
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      if (data.session) {
        await session.syncFromSupabaseSession(data.session);
        goto('/set-password');
      } else {
        const timeout = setTimeout(() => {
          goto('/login');
        }, 1500);

        supabase.auth.onAuthStateChange(async (event, sbSession) => {
          if (sbSession) {
            clearTimeout(timeout);
            await session.syncFromSupabaseSession(sbSession);
            goto('/set-password');
          }
        });
      }
    } catch (err: unknown) {
      errorMessage =
        err instanceof Error
          ? err.message || 'Invitation verification failed or link expired.'
          : 'Invitation verification failed or link expired.';
    }
  });
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div
    class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] text-center"
  >
    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
      <a href="/login" class="text-xs text-[var(--accent)] underline">Return to Sign In</a>
    {:else}
      <div class="text-sm font-semibold text-[var(--ink)]">{statusMessage}</div>
    {/if}
  </div>
</div>
