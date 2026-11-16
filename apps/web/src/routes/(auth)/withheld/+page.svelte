<script lang="ts">
  import { goto } from '$app/navigation';
  import { session } from '$lib/auth/session.svelte';
  import { withheldNoticeText } from '$lib/ui/withheld-notice';

  /**
   * Plan 023 step 3 — the withheld-account screen.
   *
   * Reached when the server answers `center_suspended` or `center_archived`, on
   * login or on any sync call. The user is already signed out; queued entries are
   * still on the device and are not deleted. Nothing here retries: the center has
   * to be reactivated.
   */
  function backToLogin(): void {
    session.withheldReason = null;
    goto('/login');
  }
</script>

<div class="min-h-screen flex items-center justify-center p-6 bg-[var(--bg)]">
  <div class="max-w-md w-full glass p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl">
    <div class="text-center mb-6">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Account withheld</h1>
      <p class="text-xs text-[var(--muted)] mt-1">This device cannot record or sync payments.</p>
    </div>

    <div
      role="alert"
      class="p-3 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-medium"
    >
      {#if session.withheldReason}
        {withheldNoticeText(session.withheldReason)}
      {:else}
        This account is not available. Contact your head office.
      {/if}
    </div>

    <ul class="text-xs text-[var(--muted)] space-y-2 mb-6">
      <li>
        Payments already entered on this device are kept and will sync once the center is active
        again.
      </li>
      <li>You have been signed out. No data has been deleted.</li>
    </ul>

    <button
      type="button"
      onclick={backToLogin}
      class="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 transition-opacity"
    >
      Sign in with another account
    </button>
  </div>
</div>
