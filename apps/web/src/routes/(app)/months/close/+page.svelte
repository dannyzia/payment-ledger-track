<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db } from '$lib/db';
  import { evaluateMonthCloseGates, currentDhakaMonth, type MonthCloseGatesResult } from '$lib/reconcile/tolerance';

  // ?month=YYYY-MM lets the statement workspace return here on the month it came from.
  const monthParam = page.url.searchParams.get('month');
  let selectedMonth = $state(
    monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : currentDhakaMonth()
  );
  let monthStatus = $state<'open' | 'closed'>('open');

  // Dynamic gate conditions evaluated from Dexie
  let allPayablesReconciled = $state(false);
  let overpaymentsApproved = $state(false);
  let zeroPendingStaleReviews = $state(false);

  // Open statements that are holding Gate 1 back, so they can be resumed from here
  // instead of hunting for their month on the reconciliation overview (CLT-R-022).
  let blockingStatements = $state<Array<{ id: string; label: string; source: 'manual_total' | 'file' }>>([]);

  let gatesResult = $derived<MonthCloseGatesResult>(
    evaluateMonthCloseGates({
      callerRole: session.user?.role ?? 'staff',
      allPayablesReconciled,
      overpaymentsApproved,
      zeroPendingStaleReviews,
      monthStatus,
    })
  );

  let showReopenModal = $state(false);
  let reopenReason = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  async function evaluateGatesFromDatabase() {
    if (!selectedMonth) return;
    const monthDate = `${selectedMonth}-01`;

    // 1. Check month close status from Dexie
    const closeRecord = await db.monthCloses.get(monthDate);
    monthStatus = closeRecord?.status === 'closed' ? 'closed' : 'open';

    // 2. Gate 3: Check pending stale rate review entries on ACTIVE entries (>৳50,000 flagged entries)
    // Strictly ignores voided or superseded entries conforming to PRD §7.3 close_month RPC
    const flaggedEntriesCount = await db.entries
      .filter(e => e.entry_date.startsWith(selectedMonth) && e.status === 'active' && e.stale_review_status === 'flagged')
      .count();
    zeroPendingStaleReviews = flaggedEntriesCount === 0;

    // 3. Gate 1: Check all payables are reconciled or not_applicable
    const settlements = await db.settlements.where('month').equals(monthDate).toArray();
    const statements = await db.statements.where('month').equals(monthDate).toArray();
    const payables = await db.payables.toArray();
    // DDL payables.kind is ('vat' | 'method_charge'); the 'card' kind literal from the pure helper
    // contract is compared via string cast because it can never occur in cached DDL rows (CLT-D-019).
    const cardPayableIds = payables
      .filter(p => (p.kind as string) === 'card' || (p.code ?? '').toLowerCase().includes('visa') || (p.code ?? '').toLowerCase().includes('mastercard'))
      .map(p => p.id);

    const payableName = (id?: string) => payables.find(p => p.id === id)?.name ?? 'Unknown payable';

    const reconciledStatementPayableIds = new Set<string>();
    for (const st of statements) {
      if (st.status === 'reconciled') {
        if (st.kind === 'combined_card') {
          for (const cid of cardPayableIds) reconciledStatementPayableIds.add(cid);
        }
        if (st.payable_ids) {
          for (const pid of st.payable_ids) reconciledStatementPayableIds.add(pid);
        }
        if (st.payable_id) {
          reconciledStatementPayableIds.add(st.payable_id);
        }
      }
    }

    const activeEntriesCount = await db.entries
      .filter(e => e.entry_date.startsWith(selectedMonth) && e.status === 'active')
      .count();

    if (settlements.length === 0) {
      // Empty month with 0 entries auto-passes Gate 1; month with un-settled entries must wait for sync
      allPayablesReconciled = activeEntriesCount === 0;
    } else {
      const liableSettlements = settlements.filter(s => s.status !== 'not_applicable');
      allPayablesReconciled = liableSettlements.every(s => reconciledStatementPayableIds.has(s.payable_id));
    }

    // Open statements still blocking Gate 1, each reachable from this checklist.
    const unreconciledPayableIds = new Set(
      settlements
        .filter(s => s.status !== 'not_applicable' && !reconciledStatementPayableIds.has(s.payable_id))
        .map(s => s.payable_id)
    );
    blockingStatements = allPayablesReconciled
      ? []
      : statements
          .filter(st => st.status === 'open')
          .filter(st => {
            if (st.kind === 'combined_card') return cardPayableIds.some(cid => unreconciledPayableIds.has(cid));
            const ids = st.payable_ids?.length ? st.payable_ids : st.payable_id ? [st.payable_id] : [];
            return ids.some(id => unreconciledPayableIds.has(id));
          })
          .map(st => ({
            id: st.id,
            source: st.source,
            label: st.kind === 'combined_card'
              ? 'Combined card statement'
              : (st.payable_ids?.length ? st.payable_ids.map(payableName).join(', ') : payableName(st.payable_id)),
          }));

    // 4. Gate 2: Check active Owner approvals for overpaid settlements matching exact surplus
    const overpaidSettlements = settlements.filter(s => s.status === 'overpaid');
    const unapprovedOverpayment = overpaidSettlements.some(s => {
      const surplus = BigInt(s.paid_poisha || '0') - BigInt(s.expected_poisha || '0');
      const approvedAmount = BigInt(s.overpayment_approved_amount_poisha || '0');
      return s.overpayment_review_status !== 'approved' || approvedAmount !== surplus;
    });
    overpaymentsApproved = !unapprovedOverpayment;
  }

  onMount(() => {
    evaluateGatesFromDatabase();
  });

  $effect(() => {
    if (selectedMonth) {
      evaluateGatesFromDatabase();
    }
  });

  async function handleCloseMonth() {
    if (!gatesResult.canClose || session.user?.role !== 'owner') return;
    isSubmitting = true;
    errorMessage = '';

    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');

      const res = await fetch('/api/v1/months/close', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ month: `${selectedMonth}-01` }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err.message || err.error) ?? 'Failed to close month');
      }

      await db.monthCloses.put({
        month: `${selectedMonth}-01`,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: session.user?.id,
      });

      monthStatus = 'closed';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Month close failed.';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleReopenMonth(e: SubmitEvent) {
    e.preventDefault();
    if (session.user?.role !== 'owner' || !reopenReason.trim()) return;
    isSubmitting = true;
    errorMessage = '';

    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');

      const res = await fetch('/api/v1/months/reopen', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          month: `${selectedMonth}-01`,
          reason: reopenReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err.message || err.error) ?? 'Failed to reopen month');
      }

      // 1. Update monthCloses in Dexie
      await db.monthCloses.put({
        month: `${selectedMonth}-01`,
        status: 'open',
      });

      // 2. Cascade all reconciled statements for this month back to 'open' matching server behavior
      const monthStmts = await db.statements.where('month').equals(`${selectedMonth}-01`).toArray();
      for (const st of monthStmts) {
        if (st.status === 'reconciled') {
          await db.statements.update(st.id, { status: 'open' });
        }
      }

      monthStatus = 'open';
      showReopenModal = false;
      reopenReason = '';
      await evaluateGatesFromDatabase();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Month reopen failed.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if session.user?.role !== 'owner'}
  <div class="p-8 max-w-lg mx-auto text-center">
    <Card class="p-6">
      <h2 class="text-lg font-bold text-red-600 mb-2">Access Denied (Owner Role Required)</h2>
      <p class="text-sm text-[var(--c-muted,#6b7280)] mb-4">Month Close and Reopen controls are restricted exclusively to the Owner (Hard Rule 7, PRD §8.4).</p>
      <Button variant="default" onclick={() => goto('/dashboard')}>Return to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="month-close-page p-6 max-w-4xl mx-auto w-full">
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Month Close Controls</h1>
        <p class="text-sm text-[var(--c-muted,#6b7280)]">Owner-only execution permanently locking financial transactions (PRD §8.4).</p>
      </div>

      <input
        type="month"
        bind:value={selectedMonth}
        class="px-3 py-2 rounded-xl border border-black/10 text-sm font-semibold min-h-[44px]"
      />
    </div>

    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <Card class="p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Implementation Readiness Checklist for {selectedMonth}</h2>
        <div>
          {#if monthStatus === 'closed'}
            <span class="px-3 py-1 rounded-full text-xs font-bold bg-slate-500/10 text-slate-700">Closed & Locked</span>
          {:else}
            <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-700">Open for Entries</span>
          {/if}
        </div>
      </div>

      <div class="flex flex-col gap-3 text-sm">
        <div class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5">
          <span>1. All payables reconciled or marked not_applicable</span>
          <span class="font-bold {allPayablesReconciled ? 'text-green-600' : 'text-red-600'}">
            {allPayablesReconciled ? 'Passed' : 'Pending Reconciliation'}
          </span>
        </div>

        {#if !allPayablesReconciled && monthStatus === 'open'}
          <div class="p-3 rounded-xl bg-white/40 border border-black/5 -mt-1" data-testid="blocking-statements">
            {#if blockingStatements.length === 0}
              <p class="text-xs text-[var(--c-muted,#6b7280)]">
                No open statement covers the outstanding payables for {selectedMonth}.
                <a href="/reconcile" class="font-semibold text-[var(--brand,#3b82f6)] underline">Create one in Reconciliation</a>.
              </p>
            {:else}
              <p class="text-xs font-semibold text-[var(--c-ink,#111827)] mb-2">
                Open statements waiting on matching for {selectedMonth}:
              </p>
              <ul class="flex flex-col gap-2">
                {#each blockingStatements as st (st.id)}
                  <li class="flex items-center justify-between gap-3">
                    <span class="text-xs text-[var(--c-muted,#6b7280)]">
                      {st.label} &middot; {st.source === 'file' ? 'Mode B' : 'Mode A'}
                    </span>
                    {#if st.source === 'file'}
                      <Button
                        variant="commission"
                        class="text-xs py-1 min-h-[36px]"
                        id="btn-blocking-resume-{st.id}"
                        onclick={() => goto(`/reconcile/upload?statement=${st.id}&return=close&month=${selectedMonth}`)}
                      >
                        Resume Matching
                      </Button>
                    {:else}
                      <Button
                        variant="default"
                        class="text-xs py-1 min-h-[36px]"
                        id="btn-blocking-reconcile-{st.id}"
                        onclick={() => goto(`/reconcile?month=${selectedMonth}`)}
                      >
                        Finalize
                      </Button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        <div class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5">
          <span>2. Active Owner approvals for any overpaid settlements (exact surplus)</span>
          <span class="font-bold {overpaymentsApproved ? 'text-green-600' : 'text-red-600'}">
            {overpaymentsApproved ? 'Passed' : 'Pending Owner Approval'}
          </span>
        </div>

        <div class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5">
          <span>3. Zero unreviewed stale entries (>৳50,000 flagged active entries)</span>
          <span class="font-bold {zeroPendingStaleReviews ? 'text-green-600' : 'text-red-600'}">
            {zeroPendingStaleReviews ? 'Passed' : 'Pending Review'}
          </span>
        </div>
      </div>

      <div class="mt-4 p-3 rounded-xl bg-blue-500/10 text-xs text-blue-800">
        Notice: Client evaluation is advisory. Final closure is verified and locked atomically by PostgreSQL under Month Advisory Lock 1001.
      </div>

      {#if !gatesResult.canClose && monthStatus === 'open'}
        <div class="mt-4 p-3 rounded-xl bg-amber-500/10 text-xs text-amber-800">
          <div class="font-bold mb-1">Cannot Close Month:</div>
          <ul class="list-disc pl-4 flex flex-col gap-0.5">
            {#each gatesResult.blockingReasons as reason}
              <li>{reason}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="mt-6 pt-4 border-t border-black/10 flex justify-end gap-3">
        {#if monthStatus === 'open'}
          <Button
            id="btn-save"
            variant="commission"
            class="min-h-[44px]"
            disabled={!gatesResult.canClose}
            loading={isSubmitting}
            onclick={handleCloseMonth}
          >
            Close Month Permanently
          </Button>
        {:else}
          <Button
            id="btn-reopen-modal"
            variant="mastercard"
            class="min-h-[44px]"
            onclick={() => { showReopenModal = true; }}
          >
            Reopen Month (Owner Only)
          </Button>
        {/if}
      </div>
    </Card>

    <Modal bind:open={showReopenModal} title="Reopen Closed Calendar Month" onclose={() => { showReopenModal = false; }}>
      <form onsubmit={handleReopenMonth} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-amber-500/10 text-xs text-amber-800">
          Warning: Reopening month {selectedMonth} unfreezes financial transactions, un-reconciles all reconciled statements for that month (flipping them back to open), and permits offline entries to sync into this historical period (PRD §8.4).
        </div>

        <div>
          <label for="modal-reopen-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">
            Mandatory Month Reopen Reason
          </label>
          <textarea
            id="modal-reopen-reason"
            required
            rows="3"
            bind:value={reopenReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Detailed audit explanation for reopening this closed month..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { showReopenModal = false; }}>Cancel</Button>
          <!-- Distinct id: this page already has a #btn-save for the close action,
               and duplicate ids broke element lookups (E2E, 2026-11-07). -->
          <Button id="btn-confirm-reopen" variant="mastercard" type="submit" loading={isSubmitting} disabled={!reopenReason.trim()}>
            Confirm Reopen Month
          </Button>
        </div>
      </form>
    </Modal>
  </div>
{/if}
