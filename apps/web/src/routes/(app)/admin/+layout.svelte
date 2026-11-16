<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { isCenterScoped } from '$lib/capabilities';
  import type { UserRole } from '@clt/shared';

  /**
   * Everything under `/admin` except the platform branch is center administration:
   * the hub, rates, settings, devices, methods, payables, audit and stale reviews. All
   * of it is served by routes that check `caller.role` for admin or owner and refuse a
   * super-admin caller with 403, because these screens read and write one center.
   *
   * The seat holds every capability but no center, so it used to open these pages and
   * get empty tables over refused requests — the panel offering actions the API
   * refuses. One gate here covers the whole group; `/admin/super/*` is exempt because
   * that is the seat's own surface.
   *
   * The menus already hide these links from the seat (`hasCenterCapability`), so this
   * only fires on a typed URL or a stale bookmark.
   */
  let { children } = $props();

  const platformPath = $derived(page.url.pathname.startsWith('/admin/super'));
  const role = $derived((session.user?.role ?? 'staff') as UserRole);
  const allowed = $derived(platformPath || isCenterScoped(role));
</script>

{#if allowed}
  {@render children()}
{:else}
  <div class="p-6 max-w-3xl mx-auto w-full">
    <Card class="p-6">
      <h1 class="text-xl font-bold text-[var(--ink)]">Access Denied</h1>
      <p class="text-sm text-[var(--muted)] mt-2">
        Center administration — the team roster, rates, settings, devices, payment methods, payables
        and the audit trail — belongs to a franchise center and is managed by that center's Admin or
        Owner.
      </p>
      <p class="text-sm text-[var(--muted)] mt-2">
        The Platform Super-Admin has no center, so this area is not part of the seat.
      </p>
      <div class="flex flex-col sm:flex-row gap-2 mt-4">
        <Button variant="commission" onclick={() => goto('/admin/super/centers')}>
          Open the platform panel
        </Button>
        <Button variant="default" onclick={() => goto('/dashboard')}>Go to Dashboard</Button>
      </div>
    </Card>
  </div>
{/if}
