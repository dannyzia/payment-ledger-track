<script lang="ts">
  import { supabase } from '$lib/supabase/client';
  import Button from '$lib/ui/Button.svelte';
  import { messages } from '$lib/i18n/messages';
  import { goto } from '$app/navigation';

  let password = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let showConfirmPassword = $state(false);
  let loading = $state(false);
  let errorMessage = $state('');

  async function handleSetPassword(e: SubmitEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      errorMessage = messages.setPassword.mismatch;
      return;
    }

    if (password.length < 8) {
      errorMessage = messages.setPassword.tooShort;
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
      errorMessage =
        err instanceof Error
          ? err.message || messages.setPassword.failed
          : messages.setPassword.failed;
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-4 sm:p-6 app-bg">
  <div
    class="max-w-md w-full glass p-6 sm:p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl"
  >
    <!-- Coupon head: navy band with the SET PASSWORD tab-cap (login pattern) -->
    <div class="on-navy -mx-6 sm:-mx-8 px-6 sm:px-8 py-3 mb-5">
      <div class="flex items-center gap-3">
        <span class="coupon-tab shrink-0">{messages.setPassword.tab}</span>
        <div class="min-w-0">
          <h1 class="text-base font-semibold text-[var(--ink)]">{messages.setPassword.heading}</h1>
          <p class="text-xs text-[var(--muted)] mt-0.5">{messages.setPassword.subheading}</p>
        </div>
      </div>
    </div>

    {#if errorMessage}
      <div
        role="alert"
        class="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs font-medium"
      >
        {errorMessage}
      </div>
    {/if}

    <form onsubmit={handleSetPassword} class="flex flex-col gap-4">
      <div>
        <label for="new-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          {messages.setPassword.passwordLabel}
        </label>
        <div class="relative flex items-center">
          <input
            id="new-password"
            type={showPassword ? 'text' : 'password'}
            required
            autocomplete="new-password"
            bind:value={password}
            class="w-full pl-4 pr-14 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={messages.setPassword.passwordPlaceholder}
          />
          <button
            type="button"
            class="absolute right-0 w-11 h-11 flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword
              ? messages.setPassword.hidePassword
              : messages.setPassword.showPassword}
            title={showPassword
              ? messages.setPassword.hidePassword
              : messages.setPassword.showPassword}
          >
            {#if showPassword}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                />
              </svg>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            {/if}
          </button>
        </div>
        <p class="text-[11px] text-[var(--muted)] mt-1">{messages.setPassword.rule}</p>
      </div>

      <div>
        <label for="confirm-password" class="block text-xs font-semibold text-[var(--muted)] mb-1">
          {messages.setPassword.confirmLabel}
        </label>
        <div class="relative flex items-center">
          <input
            id="confirm-password"
            type={showConfirmPassword ? 'text' : 'password'}
            required
            autocomplete="new-password"
            bind:value={confirmPassword}
            class="w-full pl-4 pr-14 py-2.5 min-h-[44px] rounded-xl border border-[var(--pearl-border)] bg-white/50 dark:bg-black/20 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder={messages.setPassword.confirmPlaceholder}
          />
          <button
            type="button"
            class="absolute right-0 w-11 h-11 flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            onclick={() => (showConfirmPassword = !showConfirmPassword)}
            aria-label={showConfirmPassword
              ? messages.setPassword.hidePassword
              : messages.setPassword.showPassword}
            title={showConfirmPassword
              ? messages.setPassword.hidePassword
              : messages.setPassword.showPassword}
          >
            {#if showConfirmPassword}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                />
              </svg>
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <div class="mt-2">
        <Button type="submit" class="btn-stamp w-full min-h-[44px]" {loading}>
          {messages.setPassword.submit}
        </Button>
      </div>
    </form>
  </div>
</div>
