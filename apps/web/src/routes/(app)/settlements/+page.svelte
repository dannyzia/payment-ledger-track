<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import {
    db,
    type CachedSettlement,
    type CachedPayable,
    type CachedPaymentMethod,
    type LocalEntry,
  } from '$lib/db';
  import { session } from '$lib/auth/session.svelte';
  import { computeSettlementReminder, type SettlementStatus } from '$lib/settlements/reminders';
  import { requestNotificationPermissions, scheduleSettlementReminders } from '$lib/native/reminders';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';
  import { goto } from '$app/navigation';

  const currentDhakaMonth = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
      .format(new Date())
      .slice(0, 7);

  let selectedMonth = $state(currentDhakaMonth());
  let settlements = $state<CachedSettlement[]>([]);
  let payables = $state<CachedPayable[]>([]);
  let methods = $state<CachedPaymentMethod[]>([]);
  let monthEntries = $state<LocalEntry[]>([]);

  // Role Guard: Settlements screen restricted strictly to Admin and Owner (PRD §3, §8.4)
  const isAuthorized = $derived(session.user?.role === 'admin' || session.user?.role === 'owner');

  const monthFirstDay = $derived(`${selectedMonth}-01`);

  function getChipVariant(
    code?: string
  ): 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard' {
    if (!code) return 'default';
    const lower = code.toLowerCase();
    if (
      lower === 'bkash' ||
      lower === 'visa' ||
      lower === 'mastercard' ||
      lower === 'vat' ||
      lower === 'commission'
    ) {
      return lower;
    }
    return 'default';
  }

  $effect(() => {
    if (!isAuthorized) return;

    const subSettlements = liveQuery(() =>
      db.settlements.where('month').equals(monthFirstDay).toArray()
    ).subscribe((rows) => {
      settlements = rows;
    });

    const subPayables = liveQuery(() => db.payables.toArray()).subscribe((rows) => {
      payables = rows;
    });

    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      methods = rows;
    });

    const subEntries = liveQuery(() =>
      db.entries.where('entry_date').between(`${selectedMonth}-01`, `${selectedMonth}-31`, true, true).toArray()
    ).subscribe((rows) => {
      monthEntries = rows.filter((e) => e.status === 'active' && e.sync_status !== 'rejected');
    });

    return () => {
      subSettlements.unsubscribe();
      subPayables.unsubscribe();
      subMethods.unsubscribe();
      subEntries.unsubscribe();
    };
  });

  const methodsMap = $derived.by(() => {
    const map: Record<string, CachedPaymentMethod> = {};
    for (const m of methods) {
      map[m.id] = m;
    }
    return map;
  });

  interface SettlementListItem {
    id: string;
    payable: CachedPayable;
    method?: CachedPaymentMethod;
    settlement?: CachedSettlement;
    expectedPoisha: bigint;
    paidPoisha: bigint;
    variancePoisha: bigint;
    status: SettlementStatus;
    reminder: ReturnType<typeof computeSettlementReminder>;
  }

  const items = $derived.by<SettlementListItem[]>(() => {
    const list: SettlementListItem[] = [];

    for (const p of payables) {
      if (!p.active) continue;

      const sett = settlements.find((s) => s.payable_id === p.id);
      const method = p.method_id ? methodsMap[p.method_id] : undefined;

      // Dynamic liability computation: if settlement row exists, use it;
      // otherwise, compute from active entries so liabilities show before initial sync (Plan 013 parity)
      let expected = 0n;
      let paid = 0n;
      let status: SettlementStatus = 'not_applicable';

      if (sett) {
        expected = BigInt(sett.expected_poisha);
        paid = BigInt(sett.paid_poisha);
        status = sett.status;
      } else {
        if (p.kind === 'vat') {
          expected = monthEntries.reduce((acc, e) => acc + BigInt(e.vat_poisha), 0n);
        } else if (p.method_id) {
          expected = monthEntries
            .filter((e) => e.method_id === p.method_id)
            .reduce((acc, e) => acc + BigInt(e.business_charge_poisha), 0n);
        }
        status = expected === 0n ? 'not_applicable' : 'due';
      }

      const variance = paid - expected;
      const reminder = computeSettlementReminder(selectedMonth, p.due_day, p.remind_days_before ?? 3);

      list.push({
        id: p.id,
        payable: p,
        method,
        settlement: sett,
        expectedPoisha: expected,
        paidPoisha: paid,
        variancePoisha: variance,
        status,
        reminder,
      });
    }

    return list;
  });

  // Native push reminders: reschedule whenever the visible month's settlement
  // data changes (PRD §17 M5). scheduleSettlementReminders no-ops on non-native
  // platforms, and reminders cancel themselves once expected === paid.
  $effect(() => {
    if (!isAuthorized) return;
    void requestNotificationPermissions().then(() =>
      scheduleSettlementReminders(
        items.map((it) => ({
          id: it.id,
          payableName: it.payable.name,
          dueDay: it.payable.due_day,
          remindDaysBefore: it.payable.remind_days_before ?? 3,
          expectedPoisha: it.expectedPoisha,
          paidPoisha: it.paidPoisha,
          month: selectedMonth,
        }))
      )
    );
  });

  const statusBadges: Record<SettlementStatus, { label: string; cls: string }> = {
    not_applicable: { label: 'N/A', cls: 'bg-black/5 dark:bg-white/5 text-[var(--muted)]' },
    due: { label: 'Due', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold' },
    partly_paid: { label: 'Partly Paid', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold' },
    paid: { label: 'Paid', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold' },
    overpaid: { label: 'Overpaid', cls: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 font-semibold' },
  };

  function getStatusBadge(status: SettlementStatus) {
    return statusBadges[status];
  }

  function handlePrevMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    selectedMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function handleNextMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    selectedMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
</script>

<div class="settlements-page p-6 max-w-5xl mx-auto w-full">
  {#if !isAuthorized}
    <div class="p-8 text-center bg-amber-500/10 border border-amber-500/20 rounded-2xl max-w-md mx-auto mt-12">
      <span class="text-3xl mb-2 block">🔒</span>
      <h2 class="text-base font-bold text-amber-900 dark:text-amber-200">Access Restricted</h2>
      <p class="text-xs text-amber-700 dark:text-amber-300 mt-1">
        Settlement and Liability Tracking is restricted to Admin and Owner roles. Staff access personal
        collections on the Staff Dashboard.
      </p>
      <Button variant="default" class="mt-4" onclick={() => goto('/dashboard')}>
        Back to Dashboard
      </Button>
    </div>
  {:else}
    <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--ink)]">Monthly Settlements</h1>
        <p class="text-sm text-[var(--muted)]">Track liabilities, payment records, and provider due dates.</p>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="default" onclick={handlePrevMonth} aria-label="Previous month">◀</Button>
        <input
          type="month"
          bind:value={selectedMonth}
          class="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-sm font-bold text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <Button variant="default" onclick={handleNextMonth} aria-label="Next month">▶</Button>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      {#if items.length === 0}
        <div class="p-12 text-center rounded-2xl glass border border-black/5 text-[var(--muted)]">
          No active settlement payables found.
        </div>
      {:else}
        {#each items as item (item.id)}
          <a href={item.settlement ? `/settlements/${item.settlement.id}` : '#'} class="block">
            <Card class="p-5 hover:border-[var(--accent)] transition-colors">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div class="flex items-center gap-2">
                    {#if item.payable.kind === 'vat'}
                      <span class="px-1.5 py-0.5 rounded text-[10px] bg-[var(--c-vat)]/10 text-[var(--c-vat)] font-bold">VAT</span>
                    {:else if item.method}
                      <Chip variant={getChipVariant(item.method.code)}>
                        {item.method.code}
                      </Chip>
                    {/if}
                    <div class="font-bold text-base text-[var(--ink)]">
                      {item.payable.name}
                    </div>
                  </div>

                  <div class="text-xs text-[var(--muted)] mt-1 flex items-center gap-2">
                    <span>Due by {item.reminder.formattedDueDay} ({item.reminder.dueDate})</span>
                    {#if item.status !== 'paid' && item.status !== 'not_applicable'}
                      {#if item.reminder.isOverdue}
                        <span class="px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-bold text-[10px]">
                          Overdue ({Math.abs(item.reminder.daysRemaining)} days late)
                        </span>
                      {:else if item.reminder.inReminderWindow}
                        <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 font-bold text-[10px]">
                          Due in {item.reminder.daysRemaining} days
                        </span>
                      {/if}
                    {/if}
                  </div>
                </div>

                <div class="flex items-center gap-6">
                  <div class="text-right">
                    <div class="text-xs text-[var(--muted)]">Expected Liability</div>
                    <div class="text-base font-bold tabular-nums text-[var(--ink)]">
                      {formatPoishaToBdt(item.expectedPoisha)}
                    </div>
                  </div>

                  <div class="text-right">
                    <div class="text-xs text-[var(--muted)]">Paid to Date</div>
                    <div class="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatPoishaToBdt(item.paidPoisha)}
                    </div>
                  </div>

                  {#if item.status === 'overpaid'}
                    <div class="text-right">
                      <div class="text-xs text-purple-600">Surplus</div>
                      <div class="text-base font-bold tabular-nums text-purple-600">
                        +{formatPoishaToBdt(item.variancePoisha)}
                      </div>
                    </div>
                  {/if}

                  <div>
                    <span class="px-3 py-1 rounded-full text-xs font-semibold {getStatusBadge(item.status).cls}">
                      {getStatusBadge(item.status).label}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </a>
        {/each}
      {/if}
    </div>
  {/if}
</div>
