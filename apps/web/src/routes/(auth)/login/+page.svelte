<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import { session } from '$lib/auth/session.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
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
        <div class="relative flex items-center">
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            required
            autocomplete="current-password"
            bind:value={password}
            class="w-full pl-4 pr-12 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="••••••••"
          />
          <button
            type="button"
            class="absolute right-1 w-10 h-10 flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)] focus:outline-none"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {#if showPassword}
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
              </svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <div class="mt-2">
        <Button variant="commission" type="submit" class="w-full min-h-[44px]" {loading}>
          Sign In
        </Button>
      </div>
    </form>
  </div>
</div>
