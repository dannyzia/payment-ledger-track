<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';

  let password = $state('');
  let confirmPassword = $state('');
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleSetPassword(e: SubmitEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      errorMessage = 'Passwords do not match.';
      return;
    }

    if (password.length < 8) {
      errorMessage = 'Password must be at least 8 characters long.';
      return;
    }

    loading = true;
    errorMessage = '';

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      goto('/dashboard');
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message || 'Failed to set password.' : 'Failed to set password.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Set Your Password</h1>
      <p class="text-xs text-[var(--muted)] mt-1">Complete your account setup to access Cosmo Ledger Track.</p>
    </div>

    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleSetPassword} class="flex flex-col gap-4">
      <div>
        <label for="new-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          New Password
        </label>
        <input
          id="new-password"
          type="password"
          required
          autocomplete="new-password"
          bind:value={password}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label for="confirm-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Confirm Password
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          autocomplete="new-password"
          bind:value={confirmPassword}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="Repeat password"
        />
      </div>

      <div class="mt-2">
        <Button variant="commission" type="submit" class="w-full min-h-[44px]" {loading}>
          Set Password & Continue
        </Button>
      </div>
    </form>
  </div>
</div>
