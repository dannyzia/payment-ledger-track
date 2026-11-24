<script lang="ts">
  import { goto } from '$app/navigation';
  import { session } from '$lib/auth/session.svelte';
  import { withheldNoticeText } from '$lib/ui/withheld-notice';
  import { messages } from '$lib/i18n/messages';

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

<div class="min-h-screen flex items-center justify-center p-4 sm:p-6 app-bg">
  <div class="max-w-md w-full glass p-6 sm:p-8 rounded-2xl border border-[var(--pearl-border)] shadow-xl">
    <!-- Coupon head: navy band with the ACCOUNT tab-cap (login pattern) -->
    <div class="on-navy -mx-6 sm:-mx-8 px-6 sm:px-8 py-3 mb-5">
      <div class="flex items-center gap-3">
        <span class="coupon-tab shrink-0">{messages.withheld.tab}</span>
        <div class="min-w-0">
          <h1 class="text-base font-semibold text-[var(--ink)]">{messages.withheld.heading}</h1>
          <p class="text-xs text-[var(--muted)] mt-0.5">{messages.withheld.subheading}</p>
        </div>
      </div>
    </div>

    <div
      role="alert"
      class="p-3 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-medium"
    >
      {#if session.withheldReason}
        {withheldNoticeText(session.withheldReason)}
      {:else}
        {messages.withheld.fallback}
      {/if}
    </div>

    <ul class="text-xs text-[var(--muted)] space-y-2 mb-6">
      <li>{messages.withheld.keptNotice}</li>
      <li>{messages.withheld.signedOutNotice}</li>
    </ul>

    <button
      type="button"
      onclick={backToLogin}
      class="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {messages.withheld.signInOther}
    </button>
  </div>
</div>
