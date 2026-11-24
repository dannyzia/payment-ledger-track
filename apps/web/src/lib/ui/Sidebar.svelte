<script lang="ts">
  import { messages } from '../i18n/messages';
  import { hasCapability } from '$lib/capabilities';
  import { visibleNav } from './nav';
  import type { UserRole } from '@clt/shared';

  interface Props {
    role?: UserRole;
  }

  let { role = 'staff' }: Props = $props();
</script>

<aside
  aria-label={messages.ui.desktopSidebar}
  class="hidden md:flex flex-col w-64 glass min-h-screen p-5 border-r border-[var(--pearl-border)]"
>
  <div class="mb-8">
    <h1 class="text-xl font-bold tracking-tight text-[var(--ink)]">{messages.app.title}</h1>
    <p class="text-xs text-[var(--muted)]">{messages.app.subtitle}</p>
  </div>

  <nav aria-label={messages.ui.mainNav} class="flex flex-col gap-1.5 flex-1">
    <!--
      Same list, same capabilities as the command palette (`./nav.ts`). Reports and
      everything past it is Admin/Owner only; staff must not see those links (CLT-R-031).
    -->
    {#each visibleNav(role) as item (item.id)}
      {#if item.emphasis === 'primary'}
        <a
          href={item.route}
          class="btn-glass btn-stamp rounded-xl py-3 px-4 mb-3 flex items-center justify-center font-bold"
        >
          <span class="btn-label text-white">{item.label}</span>
        </a>
      {:else}
        <a
          href={item.route}
          class="px-4 py-2.5 rounded-xl hover:bg-white/10 text-sm text-[var(--ink)] min-h-[44px] flex items-center {item.emphasis ===
          'section'
            ? 'border-t border-black/10 dark:border-white/10 mt-2'
            : ''}"
        >
          {item.label}
        </a>
      {/if}
    {/each}
    <!--
      Platform navigation is gated on the capability registry, not on the role
      string: a link appears only when the same capability the route enforces is
      licensed to this role (Plan 023 §6.1).
    -->
    {#if hasCapability(role, 'center.read_all')}
      <a
        href="/admin/super"
        class="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-semibold text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Fleet Dashboard
      </a>
      <a
        href="/admin/super/users"
        class="px-4 py-2.5 rounded-xl hover:bg-white/10 text-sm text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Fleet Users
      </a>
      <a
        href="/admin/super/devices"
        class="px-4 py-2.5 rounded-xl hover:bg-white/10 text-sm text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Fleet Devices
      </a>
      <a
        href="/admin/super/centers"
        class="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-semibold text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Franchise Centers
      </a>
    {/if}
    {#if hasCapability(role, 'ledger.read_all')}
      <a
        href="/admin/super/ledger"
        class="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-semibold text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Cross-Center Ledger
      </a>
      <a
        href="/admin/super/search"
        class="px-4 py-2.5 rounded-xl bg-white/10 text-sm font-semibold text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Global Search
      </a>
    {/if}
    {#if hasCapability(role, 'audit.read_all')}
      <a
        href="/admin/audit"
        class="px-4 py-2.5 rounded-xl hover:bg-white/10 text-sm text-[var(--ink)] min-h-[44px] flex items-center"
      >
        Audit Trail
      </a>
    {/if}
  </nav>

  <div class="pt-4 border-t border-black/10 dark:border-white/10 text-xs text-[var(--muted)]">
    <p>{messages.ui.footerBrand}</p>
  </div>
</aside>
