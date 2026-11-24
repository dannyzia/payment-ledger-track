<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import CouponHead from '$lib/ui/CouponHead.svelte';
  import Stamp from '$lib/ui/Stamp.svelte';
  import { db, type LocalEntry } from '$lib/db';
  import { computeStaffPersonalMetrics } from '$lib/dashboards/metrics';
  import { discardRejectedOp } from '$lib/sync/recovery';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';

  interface Props {
    userId: string;
    userName: string;
  }

  interface RejectedItem {
    id: string;
    reason: string;
    customerName: string;
    grossPoisha: string;
  }

  let { userId, userName }: Props = $props();
  let userEntries = $state<LocalEntry[]>([]);
  let pendingSyncCount = $state(0);
  let rejectedOps = $state<RejectedItem[]>([]);

  // Typed payload field reader (no `any`; op payloads are Record<string, unknown>)
  function payloadString(payload: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string' && value !== '') return value;
    }
    return '';
  }

  $effect(() => {
    // 1. Live query for user's own entries
    const subEntries = liveQuery(() =>
      db.entries.where('created_by').equals(userId).toArray(),
    ).subscribe((rows) => {
      userEntries = rows;
    });

    // 2. Live query for user's own pending outbox ops (PRD §8.5, Test #62)
    const subOutbox = liveQuery(() =>
      db.outbox
        .filter(
          (op) => (op.status === 'pending' || op.status === 'in_flight') && op.userId === userId,
        )
        .count(),
    ).subscribe((c) => {
      pendingSyncCount = c;
    });

    // 3. Live query for rejected ops requiring staff attention (PRD §8.5)
    const subRejected = liveQuery(async () => {
      const outboxRejected = await db.outbox.filter((op) => op.status === 'rejected').toArray();
      const serverRejected = await db.rejectedOps.filter((op) => op.status === 'pending').toArray();

      const items: RejectedItem[] = [];

      for (const op of outboxRejected) {
        const createdBy = payloadString(op.payload ?? {}, 'createdBy', 'created_by');
        if (createdBy === userId) {
          items.push({
            id: op.opId,
            reason: op.rejectionReason || op.errorMessage || 'Operation rejected',
            customerName:
              payloadString(op.payload ?? {}, 'customerName', 'customer_name') ||
              'Counter Transaction',
            grossPoisha: payloadString(op.payload ?? {}, 'grossPoisha', 'gross_poisha') || '0',
          });
        }
      }

      for (const op of serverRejected) {
        const createdBy = payloadString(op.payload ?? {}, 'createdBy', 'created_by');
        if (createdBy === userId) {
          // Avoid duplicates if also in outbox
          if (!items.some((i) => i.id === op.opId)) {
            items.push({
              id: op.opId,
              reason: op.error_message || op.error_code || 'Server rejected',
              customerName:
                payloadString(op.payload ?? {}, 'customerName', 'customer_name') ||
                'Counter Transaction',
              grossPoisha: payloadString(op.payload ?? {}, 'grossPoisha', 'gross_poisha') || '0',
            });
          }
        }
      }

      return items;
    }).subscribe((list) => {
      rejectedOps = list;
    });

    return () => {
      subEntries.unsubscribe();
      subOutbox.unsubscribe();
      subRejected.unsubscribe();
    };
  });

  const metrics = $derived(computeStaffPersonalMetrics(userEntries, userId));

  // Sorted recent entries: created_at descending (PRD §8.5)
  const recentEntries = $derived.by(() => {
    return [...userEntries]
      .sort((a, b) => {
        const timeA = new Date(a.created_at || a.entry_date).getTime();
        const timeB = new Date(b.created_at || b.entry_date).getTime();
        return timeB - timeA;
      })
      .slice(0, 5);
  });

  async function handleDiscard(opId: string) {
    // Discards are audited with a mandatory reason (PRD §8.5, §9.1, Test #18);
    // reuses the canonical recovery helper instead of a bare outbox delete
    const reason = window.prompt(
      'Discard this rejected transaction? Enter the audit reason (mandatory):',
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed === '') {
      window.alert('A non-empty discard reason is required.');
      return;
    }
    try {
      await discardRejectedOp(opId, userId, trimmed);
    } catch (err) {
      console.error('Failed to discard rejected operation:', err);
      window.alert(err instanceof Error ? err.message : 'Failed to discard rejected operation.');
    }
  }
</script>

<div class="staff-dashboard flex flex-col gap-6">
  <CouponHead
    tab="Counter"
    title={`Welcome, ${userName}`}
    subtitle="Staff counter terminal (Asia/Dhaka timezone)."
  />

  <!-- Action zone under the band: the band carries the headline only, so the
       stamp and the attention chip never crush it at phone width. -->
  <div class="flex flex-wrap items-center justify-end gap-3">
    <div
      class="px-3 py-1.5 rounded-xl border border-[var(--pearl-border)] text-xs font-semibold flex items-center gap-2"
    >
      <span
        class="w-2 h-2 rounded-full {pendingSyncCount > 0
          ? 'bg-amber-500 animate-pulse'
          : 'bg-emerald-500'}"
      ></span>
      <span class="carbon-nums text-[var(--carbon)]">{pendingSyncCount} Outbox Pending</span>
    </div>

    {#if rejectedOps.length > 0}
      <div
        class="px-3 py-1.5 rounded-xl border border-[var(--accent)]/30 bg-red-500/10 text-xs font-semibold flex items-center gap-2"
      >
        <span class="w-2 h-2 rounded-full bg-red-500"></span>
        <span class="text-red-700 dark:text-red-300 font-bold">
          {rejectedOps.length} Attention Needed
        </span>
      </div>
    {/if}

    <a href="/entries/new">
      <Button id="btn-save" class="btn-stamp py-3 px-6 text-sm">+ New Transaction</Button>
    </a>
  </div>

  {#if rejectedOps.length > 0}
    <div
      class="p-4 rounded-xl bg-red-500/10 border border-[var(--accent)]/30 text-red-800 dark:text-red-300 text-xs flex flex-col gap-2"
    >
      <div class="flex items-center justify-between">
        <span class="font-bold text-sm"
          >⚠ Needs Attention: {rejectedOps.length} transaction(s) failed sync</span
        >
        <a href="/ledger" class="underline font-semibold hover:text-red-700">Open Ledger</a>
      </div>
      <p class="text-[var(--muted)]">
        Transactions rejected by server validation or month-close locks. Contact your Admin to
        review or reassign.
      </p>
      <div class="flex flex-col gap-1.5 mt-1">
        {#each rejectedOps as item (item.id)}
          <div class="flex items-center justify-between p-2 rounded-lg bg-white/60 text-xs">
            <span class="font-medium text-[var(--ink)]">
              {item.customerName}
              <span class="carbon-nums text-[var(--carbon)]"
                >({formatPoishaToBdt(BigInt(item.grossPoisha))})</span
              >
            </span>
            <div class="flex items-center gap-2">
              <span class="text-red-700 font-semibold">{item.reason}</span>
              <button
                type="button"
                class="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-800 font-bold min-h-[36px] transition-colors"
                onclick={() => handleDiscard(item.id)}
              >
                Discard
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    <Card class="p-6">
      <div class="tab-caps text-[11px] text-[var(--muted)] mb-1">My Collections Today</div>
      <div class="text-3xl font-bold carbon-nums text-[var(--carbon)]">
        {formatPoishaToBdt(metrics.todayGrossPoisha)}
      </div>
      <div class="text-xs text-[var(--muted)] mt-2">
        {metrics.todayEntriesCount} transactions recorded today
      </div>
    </Card>

    <Card class="p-6">
      <div class="tab-caps text-[11px] text-[var(--muted)] mb-1">My Month-to-Date Collections</div>
      <div class="text-2xl font-bold carbon-nums text-[var(--carbon)]">
        {formatPoishaToBdt(metrics.mtdGrossPoisha)}
      </div>
      <div class="text-xs text-[var(--muted)] mt-2">
        {metrics.mtdEntriesCount} transactions this month
      </div>
    </Card>
  </div>

  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--ink)]">My Recent Transactions</h2>
      <a href="/ledger" class="text-xs text-[var(--muted)] hover:underline">View All Ledger</a>
    </div>

    {#if recentEntries.length === 0}
      <div class="p-4 text-center text-xs text-[var(--muted)]">
        No recent transactions found. Tap "+ New Transaction" to record your first payment.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each recentEntries as e (e.id)}
          <div
            class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5 text-sm"
          >
            <div class="flex items-center gap-2">
              {#if e.sync_status === 'synced'}
                <span
                  class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-700"
                >
                  {e.entry_number ?? 'Synced'}
                </span>
              {:else if e.sync_status === 'rejected'}
                <span
                  class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/10 text-red-700"
                >
                  {e.local_id ?? '#LOCAL'} (Sync Rejected)
                </span>
              {:else}
                <span
                  class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-700"
                >
                  {e.local_id ?? '#LOCAL'} (Pending)
                </span>
              {/if}

              {#if e.status === 'voided'}
                <Stamp label="VOID" class="shrink-0 -rotate-6" />
              {:else if e.status === 'superseded'}
                <Stamp label="Superseded" tone="navy" class="shrink-0" />
              {:else if Boolean(e.void_requested_by)}
                <span
                  class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700"
                  >[Void Requested]</span
                >
              {/if}

              <span
                class="font-semibold text-[var(--ink)] {e.status === 'voided'
                  ? 'line-through decoration-[var(--accent)]'
                  : ''}"
              >
                {e.customer_name}
              </span>
            </div>
            <div
              class="font-bold carbon-nums text-[var(--carbon)] {e.status === 'voided'
                ? 'line-through decoration-[var(--accent)] decoration-2'
                : ''}"
            >
              {formatPoishaToBdt(BigInt(e.gross_poisha))}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>
