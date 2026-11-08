<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    errorMessage = '';

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.session) {
        await session.syncFromSupabaseSession(data.session);
        goto('/dashboard');
      }
    } catch (err: unknown) {
      errorMessage =
        err instanceof Error
          ? err.message || 'Invalid email or password.'
          : 'Invalid email or password.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Kumon Ledger Track</h1>
      <p class="text-xs text-[var(--muted)] mt-1">
        Invitation-only payment ledger. Sign in to continue.
      </p>
    </div>

    {#if errorMessage}
      <div
        role="alert"
        class="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-medium"
      >
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleLogin} class="flex flex-col gap-4">
      <div>
        <label for="login-email" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Email Address
        </label>
        <input
          id="login-email"
          type="email"
          required
          autocomplete="email"
          bind:value={email}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="name@company.com"
        />
      </div>

      <div>
        <label for="login-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          required
          autocomplete="current-password"
          bind:value={password}
          class="w-full px-4 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          placeholder="••••••••"
        />
      </div>

      <div class="mt-2">
        <Button variant="commission" type="submit" class="w-full min-h-[44px]" {loading}>
          Sign In
        </Button>
      </div>
    </form>
  </div>
</div>
