<script lang="ts">
  import { messages } from '../i18n/messages';

  interface Props {
    role?: 'staff' | 'admin' | 'owner';
  }

  let { role = 'staff' }: Props = $props();
</script>

<aside aria-label={messages.ui.desktopSidebar} class="hidden md:flex flex-col w-64 glass min-h-screen p-5 border-r border-[var(--pearl-border)]">
  <div class="mb-8">
    <h1 class="text-xl font-bold tracking-tight text-[var(--ink)]">{messages.app.title}</h1>
    <p class="text-xs text-[var(--muted)]">{messages.app.subtitle}</p>
  </div>

  <nav aria-label={messages.ui.mainNav} class="flex flex-col gap-1.5 flex-1">
    <a href="/entries/new" class="btn-glass btn--commission rounded-xl py-3 px-4 mb-3 flex items-center justify-center font-bold">
      <span class="btn-label">{messages.menu.newEntry}</span>
    </a>
    <a href="/dashboard" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
      {messages.menu.dashboard}
    </a>
    <a href="/ledger" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
      {messages.menu.ledger}
    </a>
    {#if role === 'admin' || role === 'owner'}
      <!-- Reports is an admin/owner capability (PRD capability table); staff must not see the link (CLT-R-031). -->
      <a href="/reports" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.reports}
      </a>
      <a href="/settlements" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.settlements}
      </a>
      <a href="/reconcile" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.reconcile}
      </a>
      <a href="/admin" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.admin}
      </a>
      <a href="/admin/settings" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center border-t border-black/10 dark:border-white/10 mt-2">
        {messages.menu.settings}
      </a>
    {/if}
  </nav>

  <div class="pt-4 border-t border-black/10 dark:border-white/10 text-xs text-[var(--muted)]">
    <p>{messages.ui.footerBrand}</p>
  </div>
</aside>
