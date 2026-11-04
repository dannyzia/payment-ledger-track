<script lang="ts">
  import { goto } from '$app/navigation';

  interface Props {
    role: 'owner' | 'admin' | 'staff';
    open: boolean;
    onclose: () => void;
  }

  let { role, open = false, onclose }: Props = $props();
  let query = $state('');
  let selectedIndex = $state(0);
  let queryInput = $state<HTMLInputElement | null>(null);

  interface CommandItem {
    id: string;
    title: string;
    route: string;
    roles: ('owner' | 'admin' | 'staff')[];
    shortcut?: string;
  }

  const allCommands: CommandItem[] = [
    { id: 'new-entry', title: 'New Payment Entry', route: '/entries/new', roles: ['owner', 'admin', 'staff'], shortcut: 'N' },
    { id: 'dashboard', title: 'Dashboard', route: '/dashboard', roles: ['owner', 'admin', 'staff'] },
    { id: 'ledger', title: 'Ledger', route: '/ledger', roles: ['owner', 'admin', 'staff'], shortcut: 'L' },
    { id: 'reports', title: 'Monthly Reports', route: '/reports', roles: ['owner', 'admin'], shortcut: 'R' },
    { id: 'settlements', title: 'Settlements & Payables', route: '/settlements', roles: ['owner', 'admin'], shortcut: 'S' },
    { id: 'reconcile', title: 'Reconciliation', route: '/reconcile', roles: ['owner', 'admin'] },
    { id: 'admin-settings', title: 'Admin Settings', route: '/admin/settings', roles: ['owner', 'admin'] },
  ];

  const filteredCommands = $derived(
    allCommands
      .filter((cmd) => cmd.roles.includes(role))
      .filter((cmd) => cmd.title.toLowerCase().includes(query.trim().toLowerCase()))
  );

  // Programmatic focus replaces the `autofocus` attribute (a11y: Avoid using
  // autofocus warning; behavior identical to spec block 6.12b).
  $effect(() => {
    if (open) {
      queryInput?.focus();
    }
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % (filteredCommands.length || 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + (filteredCommands.length || 1)) % (filteredCommands.length || 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filteredCommands[selectedIndex];
      if (target) {
        onclose();
        goto(target.route);
      }
    }
  }

  function handleSelect(route: string) {
    onclose();
    goto(route);
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm"
    role="presentation"
    onclick={onclose}
  >
    <div
      class="w-full max-w-lg rounded-2xl glass p-4 shadow-2xl border border-[var(--pearl-border)] flex flex-col gap-3"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeyDown}
    >
      <div class="relative">
        <input
          type="text"
          bind:value={query}
          placeholder="Search commands or jump to screen... (Esc to close)"
          class="w-full px-4 py-3 rounded-xl border border-[var(--pearl-border)] bg-white/70 dark:bg-black/40 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] min-h-[44px]"
          bind:this={queryInput}
        />
      </div>

      <div class="max-h-64 overflow-y-auto flex flex-col gap-1">
        {#if filteredCommands.length === 0}
          <div class="p-3 text-center text-xs text-[var(--muted)]">No matching screens found</div>
        {:else}
          {#each filteredCommands as cmd, i (cmd.id)}
            <button
              type="button"
              class="w-full px-4 py-2.5 rounded-xl text-left text-sm flex items-center justify-between min-h-[44px] transition-colors {i === selectedIndex ? 'bg-[var(--accent)] text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--ink)]'}"
              onclick={() => handleSelect(cmd.route)}
            >
              <span>{cmd.title}</span>
              {#if cmd.shortcut}
                <kbd class="px-2 py-0.5 rounded text-xs {i === selectedIndex ? 'bg-white/20 text-white' : 'bg-black/10 dark:bg-white/10 text-[var(--muted)]'}">{cmd.shortcut}</kbd>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
