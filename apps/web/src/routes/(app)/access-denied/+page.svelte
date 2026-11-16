<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';

  /**
   * Where the client guard sends a role refused for a screen (Plan 023 §6.1 follow-up).
   *
   * Before this page, the guard cancelled the navigation and pushed the user to
   * /dashboard without a word, so a link that vanished from the menu looked like a
   * glitch. The per-screen notices still exist as defence in depth; this is the one
   * the guard actually shows.
   */
  const attemptedPath = $derived(page.url.searchParams.get('from') ?? 'that screen');
  const roleLabel = $derived(
    (session.user?.role ?? 'staff').replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase()),
  );
</script>

<div class="p-8 max-w-lg mx-auto text-center">
  <Card class="p-6">
    <h2 class="text-lg font-bold text-red-600 mb-2">Access Denied</h2>
    <p class="text-sm text-[var(--muted)] mb-2">
      {attemptedPath} is not part of the {roleLabel} role.
    </p>
    <p class="text-xs text-[var(--muted)] mb-6">
      Nothing was changed and nothing was deleted. Ask the Owner if you need access to this screen;
      role changes are made from Admin → Users.
    </p>
    <div class="flex flex-col sm:flex-row gap-2 justify-center">
      <Button variant="default" onclick={() => history.back()}>Go Back</Button>
      <Button variant="commission" onclick={() => goto('/dashboard')}>Return to Dashboard</Button>
    </div>
  </Card>
</div>
