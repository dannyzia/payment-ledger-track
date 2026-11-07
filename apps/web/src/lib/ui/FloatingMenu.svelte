<script lang="ts">
  import { draggable } from './actions/draggable';
  import { messages } from '../i18n/messages';
  import { triggerHapticTick } from '$lib/native/haptics';

  interface Props {
    role?: 'staff' | 'admin' | 'owner';
    positionMode?: 'free' | 'bottom' | 'left' | 'right';
  }

  let { role = 'staff', positionMode = 'free' }: Props = $props();

  let expanded = $state(false);
  let isLowerHalf = $state(true);

  function toggleMenu() {
    expanded = !expanded;
  }

  async function handleSnap(pos: { x: number; y: number; isLowerHalf: boolean; source?: string }) {
    isLowerHalf = pos.isLowerHalf;
    // PRD §14.5: buzz only on a physical drag-release snap, never on
    // keyboard navigation (no source) or double-tap resets (Plan 019 §10.4)
    if (pos.source === 'drag') {
      await triggerHapticTick();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && expanded) {
      expanded = false;
      return;
    }
    // CLT-T-050: only the region itself owns Enter/Space. Keys that bubble from
    // the New Entry link or the ☰ button must keep their native activation —
    // preventDefault() here cancelled the anchor's navigation and the button's
    // onclick. Both children are already keyboard-operable on their own.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleMenu();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- Justification: the region is a draggable, keyboard-operable floating menu; Svelte's static rule cannot model tabindex on role="region" (see DECISIONS.md CLT-D-010) -->
<div
  use:draggable={{ storageKey: 'clt-floating-menu-pos', positionMode, onSnap: handleSnap }}
  class="fixed top-0 left-0 z-40 touch-none select-none md:hidden outline-none flex {isLowerHalf ? 'flex-col-reverse' : 'flex-col'}"
  id="floating-action-menu"
  tabindex="0"
  role="region"
  aria-label={messages.ui.mobileRegion}
  onkeydown={handleKeydown}
>
  <div class="glass rounded-full p-2 flex items-center gap-2 shadow-xl border border-[var(--pearl-border)]">
    <!-- PRD §14.5: the collapsed pill shows "the primary action plus a handle".
         The grip is a 44x44 touch target that is deliberately *not* a control,
         so a press on it is never retargeted to the link beside it (CLT-R-013).
         Purely an affordance: dragging works from any part of the pill. -->
    <span
      class="flex items-center justify-center gap-[3px] min-w-[44px] min-h-[44px] touch-none cursor-grab active:cursor-grabbing"
      data-drag-handle
      aria-hidden="true"
    >
      <span class="w-[2px] h-[14px] rounded-full bg-[var(--ink)] opacity-40"></span>
      <span class="w-[2px] h-[14px] rounded-full bg-[var(--ink)] opacity-40"></span>
    </span>

    <a
      href="/entries/new"
      class="btn-glass btn--commission rounded-full px-4 py-2 flex items-center gap-1.5 text-sm font-semibold"
      aria-label={messages.menu.newEntry}
    >
      <span aria-hidden="true">+</span>
      <span class="btn-label">{messages.menu.newEntry}</span>
    </a>

    <button
      type="button"
      onclick={toggleMenu}
      class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
      aria-expanded={expanded}
      aria-controls="mobile-nav-panel"
      aria-label={messages.ui.toggleMenu}
    >
      <span class="text-xs" aria-hidden="true">☰</span>
    </button>
  </div>

  {#if expanded}
    <nav
      id="mobile-nav-panel"
      aria-label={messages.ui.mainNav}
      class="glass rounded-2xl p-3 {isLowerHalf ? 'mb-2' : 'mt-2'} flex flex-col gap-1 shadow-2xl max-h-[70vh] overflow-y-auto"
    >
      <a href="/dashboard" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.dashboard}
      </a>
      <a href="/ledger" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.ledger}
      </a>
      <a href="/reports" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
        {messages.menu.reports}
      </a>
      {#if role === 'admin' || role === 'owner'}
        <a href="/settlements" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.settlements}
        </a>
        <a href="/reconcile" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.reconcile}
        </a>
        <a href="/admin" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center">
          {messages.menu.admin}
        </a>
        <!-- /admin/settings is the only settings screen the app ships (PRD §13);
             the old /settings href led to a 404 (found by the E2E link sweep). -->
        <a href="/admin/settings" class="px-4 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-sm text-[var(--ink)] min-h-[44px] flex items-center border-t border-black/10 dark:border-white/10 mt-1">
          {messages.menu.settings}
        </a>
      {/if}
    </nav>
  {/if}
</div>
