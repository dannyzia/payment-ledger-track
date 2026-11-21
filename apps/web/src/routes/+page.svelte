<script lang="ts">
  import { goto } from '$app/navigation';
  import { session } from '$lib/auth/session.svelte';

  $effect(() => {
    if (session.loading) return;

    if (session.user && session.user.active && !session.authMissing) {
      if (session.user.role === 'super_admin' && session.aal !== 'aal2') {
        goto('/admin/super/security');
      } else {
        goto('/dashboard');
      }
    } else {
      goto('/login');
    }
  });
</script>

<main class="min-h-screen p-8 flex flex-col items-center justify-center app-bg">
  <div
    class="glass p-8 rounded-2xl border border-[var(--pearl-border)] flex flex-col items-center gap-4 shadow-xl"
  >
    <div
      class="w-12 h-12 rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center font-bold text-xl border border-[var(--accent)]/20 shadow-sm animate-pulse"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="w-7 h-7"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    </div>
    <div class="text-center">
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Kumon Ledger Track</h1>
      <p class="text-xs text-[var(--muted)] mt-1">Loading ledger workspace…</p>
    </div>
  </div>
</main>
