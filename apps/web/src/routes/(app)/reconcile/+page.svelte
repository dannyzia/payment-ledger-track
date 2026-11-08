<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import ClosedMonthRecoveryModal from '$lib/ui/ClosedMonthRecoveryModal.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db, type CachedStatement, type CachedPayable, type CachedAppSettings } from '$lib/db';
  import { retryRejectedOp, discardRejectedOp } from '$lib/sync/recovery';
  import { syncRunner } from '$lib/sync/runner.svelte';
  import { resolveEffectiveRateProfile } from '$lib/db/rates';
  import { calculateEntry, type RateSnapshot } from '@clt/calc';
  import { formatPoishaToBdt } from '@clt/shared';
  import {
    currentDhakaMonth,
    isVarianceWithinTolerance,
    parseStrictBdtToPoisha,
  } from '$lib/reconcile/tolerance';

  interface StatementRow {
    id: string;
    kind: string;
    month: string;
    source: string;
    sourceKind: 'manual_total' | 'file';
    statement_total_poisha: string;
    expected_poisha: string;
    variance_poisha: string;
    status: 'open' | 'reconciled' | 'superseded';
    payableNames: string;
    note?: string | undefined;
  }

  interface RecoveryItem {
    opId: string;
    entryId: string;
    entryDate: string;
    grossPoisha: string;
    error_code: string;
    payload?: Record<string, unknown> | undefined;
  }

  // ?month=YYYY-MM lets other screens (the month-close checklist) deep-link to the
  // month that actually needs attention instead of the current one.
  const monthParam = page.url.searchParams.get('month');
  let selectedMonth = $state(
    monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : currentDhakaMonth(),
  );

  // ?return=close means this overview was opened from the month-close checklist,
  // so anything it opens must carry that origin through to the workspace's Back
  // button. Without it the workspace would return to this overview instead.
  const returnToClose = page.url.searchParams.get('return') === 'close';
  function workspaceHref(statementId?: string): string {
    const q = new URLSearchParams();
    if (statementId) q.set('statement', statementId);
    if (returnToClose) {
      q.set('return', 'close');
      q.set('month', selectedMonth);
    }
    const qs = q.toString();
    return `/reconcile/upload${qs ? `?${qs}` : ''}`;
  }
  let statements = $state<StatementRow[]>([]);
  let closedMonthRejectedOps = $state<RecoveryItem[]>([]);
  let activeRecoveryItem = $state<RecoveryItem | null>(null);
  let showRecoveryModal = $state(false);

  // Statement action modals (Reconcile & Supersede)
  let activeStatement = $state<StatementRow | null>(null);
  let showReconcileModal = $state(false);
  let reconcileNote = $state('');
  let showSupersedeModal = $state(false);
  let supersedeTotalBdt = $state('');
  let supersedeReason = $state('');
  let isActionSubmitting = $state(false);
  let actionErrorMessage = $state('');

  let tolerancePoisha = $state(100n);

  async function loadReconciliationData() {
    if (!selectedMonth) return;
    const monthDate = `${selectedMonth}-01`;

    // 1. Load tolerance setting
    const settings: CachedAppSettings | undefined = await db.appSettings.toCollection().first();
    if (settings?.reconcile_tolerance_poisha) {
      tolerancePoisha = BigInt(settings.reconcile_tolerance_poisha);
    }

    // 2. Load payables to resolve names
    const payables: CachedPayable[] = await db.payables.toArray();
    const payableMap = new Map(payables.map((p) => [p.id, p.name]));

    // 3. Query statements for month
    const stList: CachedStatement[] = await db.statements
      .where('month')
      .equals(monthDate)
      .toArray();

    statements = stList.map((st) => {
      const total = BigInt(st.statement_total_poisha || st.total_gross_poisha || '0');
      const expected = BigInt(st.expected_poisha || '0');
      const variance = st.variance_poisha ? BigInt(st.variance_poisha) : total - expected;

      let payableNames = 'Multiple Payables';
      if (st.kind === 'combined_card') {
        payableNames = 'Visa Fee & Mastercard Fee (Combined)';
      } else if (st.payable_ids && st.payable_ids.length > 0) {
        payableNames = st.payable_ids.map((id) => payableMap.get(id) || id).join(', ');
      } else if (st.payable_id) {
        payableNames = payableMap.get(st.payable_id) || 'Payable Fee';
      }

      return {
        id: st.id,
        kind: st.kind === 'combined_card' ? 'Combined Card' : 'Single Payable',
        month: st.month,
        source: st.source === 'manual_total' ? 'Mode A (Manual)' : 'Mode B (File)',
        sourceKind: st.source === 'manual_total' ? 'manual_total' : 'file',
        statement_total_poisha: total.toString(),
        expected_poisha: expected.toString(),
        variance_poisha: variance.toString(),
        status: st.status,
        payableNames,
        note: st.note,
      };
    });

    // 4. Query pending closed-month rejected ops from Dexie (using indexed 'status' key)
    const rejected = await db.rejectedOps
      .where('status')
      .equals('pending')
      .and((op) => op.error_code === 'month_closed')
      .toArray();

    const items: RecoveryItem[] = [];
    for (const r of rejected) {
      const localEntry = r.entry_id ? await db.entries.get(r.entry_id) : undefined;
      const entryDate =
        (r.payload?.entryDate as string) ||
        (r.payload?.entry_date as string) ||
        localEntry?.entry_date ||
        (r.rejected_at ? r.rejected_at.substring(0, 10) : `${selectedMonth}-01`);

      const grossPoisha =
        (r.payload?.grossPoisha as string) ||
        (r.payload?.gross_poisha as string) ||
        localEntry?.gross_poisha ||
        '0';

      items.push({
        opId: r.opId,
        entryId: r.entry_id || '',
        entryDate,
        grossPoisha,
        error_code: r.error_code,
        payload: r.payload,
      });
    }

    closedMonthRejectedOps = items;
  }

  onMount(() => {
    loadReconciliationData();
  });

  $effect(() => {
    if (selectedMonth) {
      loadReconciliationData();
    }
  });

  // Action 1: Reassign to open month
  async function handleReassignRecovery(newDate: string, reason: string, manualVatPoisha?: bigint) {
    if (!activeRecoveryItem) return;
    const { opId, entryId } = activeRecoveryItem;

    // PRD §8.4: Verify destination month is not closed
    const destMonth = `${newDate.substring(0, 7)}-01`;
    const closedRecord = await db.monthCloses.get(destMonth);
    if (closedRecord?.status === 'closed') {
      throw new Error(
        `Destination month (${newDate.substring(0, 7)}) is closed. Please select an open month.`,
      );
    }

    const localEntry = await db.entries.get(entryId);
    if (!localEntry) throw new Error('Local transaction entry not found in database.');

    // 1. Resolve date-effective published rate profile for new date (canonical resolver: effective_from DESC, version DESC)
    const profile = await resolveEffectiveRateProfile(newDate);

    if (!profile) {
      throw new Error(`No published rate profile found effective for date ${newDate}`);
    }

    // 2. Build canonical RateSnapshot (@clt/calc schema) and re-calculate entry amounts
    const methodRate = profile.method_rates?.[localEntry.method_id];
    const snapshot: RateSnapshot = {
      rateProfileId: profile.id,
      version: profile.version,
      engineVersion: 1,
      vat: {
        mode: profile.vat_mode,
        bp: profile.vat_bp,
      },
      commission: {
        bp: profile.commission_bp,
        base: profile.commission_base ?? 'gross_minus_vat',
      },
      chargeBp: methodRate?.fee_bp ?? 0,
      chargesBorneBy: methodRate?.charges_borne_by ?? profile.charges_borne_by ?? 'business',
      rounding: 'half_up',
    };

    const calcResult = calculateEntry({
      grossPoisha: BigInt(localEntry.gross_poisha),
      snapshot,
      vatInputPoisha: manualVatPoisha,
    });

    // 3. Update local entry in Dexie (full financial partition incl. charge_poisha and vat input)
    await db.entries.update(entryId, {
      entry_date: newDate,
      gross_poisha: calcResult.grossPoisha.toString(),
      vat_poisha: calcResult.vatPoisha.toString(),
      commission_poisha: calcResult.commissionPoisha.toString(),
      business_charge_poisha: calcResult.businessChargePoisha.toString(),
      customer_charge_poisha: calcResult.customerChargePoisha.toString(),
      charge_poisha: calcResult.chargePoisha.toString(),
      net_poisha: calcResult.netAfterDeductionsPoisha.toString(),
      vat_input_poisha: manualVatPoisha !== undefined ? manualVatPoisha.toString() : undefined,
      rate_profile_id: profile.id,
      snapshot,
      sync_status: 'pending',
    });

    // 4. Enqueue fresh outbox op via Plan 011 recovery helper
    const patchedPayload = {
      entryId,
      entryDate: newDate,
      grossPoisha: calcResult.grossPoisha.toString(),
      vatPoisha: calcResult.vatPoisha.toString(),
      commissionPoisha: calcResult.commissionPoisha.toString(),
      businessChargePoisha: calcResult.businessChargePoisha.toString(),
      customerChargePoisha: calcResult.customerChargePoisha.toString(),
      netPoisha: calcResult.netAfterDeductionsPoisha.toString(),
      rateProfileId: profile.id,
      snapshot,
      reassignReason: reason,
      vatInputPoisha: manualVatPoisha ? manualVatPoisha.toString() : undefined,
    };

    await retryRejectedOp(opId, patchedPayload);
    await db.rejectedOps.update(opId, { status: 'resolved' });

    showRecoveryModal = false;
    activeRecoveryItem = null;
    await loadReconciliationData();
    syncRunner.triggerCycle();
  }

  // Action 2: Reopen month by Owner
  async function handleReopenRecovery(targetMonth: string, reason: string) {
    if (!activeRecoveryItem) return;
    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token;
    if (!token) throw new Error('Not authenticated.');

    const res = await fetch('/api/v1/months/reopen', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        month: `${targetMonth}-01`,
        reason,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Failed to reopen month.');
    }

    // Cascade local month close and statements to open
    await db.monthCloses.put({
      month: `${targetMonth}-01`,
      status: 'open',
    });

    const monthStmts = await db.statements.where('month').equals(`${targetMonth}-01`).toArray();
    for (const st of monthStmts) {
      if (st.status === 'reconciled') {
        await db.statements.update(st.id, { status: 'open' });
      }
    }

    // Re-queue the rejected op so it syncs immediately into the now-open month
    await retryRejectedOp(activeRecoveryItem.opId);
    await db.rejectedOps.update(activeRecoveryItem.opId, { status: 'resolved' });

    showRecoveryModal = false;
    activeRecoveryItem = null;
    await loadReconciliationData();
    syncRunner.triggerCycle();
  }

  // Action 3: Discard rejected entry
  async function handleDiscardRecovery(reason: string) {
    if (!activeRecoveryItem) return;
    const callerId = session.user?.id || '00000000-0000-0000-0000-000000000000';
    await discardRejectedOp(activeRecoveryItem.opId, callerId, reason);

    showRecoveryModal = false;
    activeRecoveryItem = null;
    await loadReconciliationData();
    syncRunner.triggerCycle();
  }

  // Statement Actions: Reconcile Open Statement
  async function handleReconcileStatementSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!activeStatement) return;
    isActionSubmitting = true;
    actionErrorMessage = '';

    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');

      const res = await fetch('/api/v1/reconcile/statements/reconcile', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          statementId: activeStatement.id,
          note: reconcileNote.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Statement reconciliation failed.');
      }

      await db.statements.update(activeStatement.id, {
        status: 'reconciled',
        note: reconcileNote.trim() || undefined,
      });

      showReconcileModal = false;
      activeStatement = null;
      reconcileNote = '';
      await loadReconciliationData();
    } catch (err) {
      actionErrorMessage = err instanceof Error ? err.message : 'Reconciliation failed.';
    } finally {
      isActionSubmitting = false;
    }
  }

  // Statement Actions: Supersede Statement
  async function handleSupersedeStatementSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!activeStatement || !supersedeReason.trim()) return;
    isActionSubmitting = true;
    actionErrorMessage = '';

    try {
      const parsedPoisha = parseStrictBdtToPoisha(supersedeTotalBdt);
      if (parsedPoisha === null) {
        throw new Error('Please enter a valid statement total in BDT (maximum 2 decimal places).');
      }
      const totalPoisha = parsedPoisha;

      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');

      const res = await fetch('/api/v1/reconcile/statements/supersede', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalStatementId: activeStatement.id,
          statementTotalPoisha: totalPoisha.toString(),
          reason: supersedeReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Failed to supersede statement.');
      }

      const { newStatementId } = await res.json();
      const origStmt = await db.statements.get(activeStatement.id);

      await db.statements.update(activeStatement.id, { status: 'superseded' });

      // Insert replacement statement into Dexie cache so reactive UI displays it immediately (P0.4)
      if (origStmt && newStatementId) {
        await db.statements.put({
          ...origStmt,
          id: newStatementId,
          statement_total_poisha: totalPoisha.toString(),
          total_gross_poisha: totalPoisha.toString(),
          status: 'open',
          note: supersedeReason.trim(),
          // Replacement statement is unreconciled: clear inherited reconciliation metadata
          expected_poisha: undefined,
          variance_poisha: undefined,
          reconciled_at: undefined,
          reconciled_by: undefined,
        });
      }

      showSupersedeModal = false;
      activeStatement = null;
      supersedeTotalBdt = '';
      supersedeReason = '';
      await loadReconciliationData();
    } catch (err) {
      actionErrorMessage = err instanceof Error ? err.message : 'Supersede failed.';
    } finally {
      isActionSubmitting = false;
    }
  }
</script>

{#if session.user?.role !== 'admin' && session.user?.role !== 'owner'}
  <div class="p-8 max-w-lg mx-auto text-center">
    <Card class="p-6">
      <h2 class="text-lg font-bold text-red-600 mb-2">Access Denied</h2>
      <p class="text-sm text-[var(--c-muted,#6b7280)] mb-4">
        Reconciliation controls are restricted strictly to Administrators and Owners.
      </p>
      <Button variant="default" onclick={() => goto('/dashboard')}>Return to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="reconcile-overview p-6 max-w-5xl mx-auto w-full">
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">
          Statement Reconciliation
        </h1>
        <p class="text-sm text-[var(--c-muted,#6b7280)]">
          Reconcile internal payment ledgers against provider statements (PRD §11).
        </p>
      </div>

      <div class="flex items-center gap-3">
        <input
          type="month"
          bind:value={selectedMonth}
          class="px-3 py-2 rounded-xl border border-black/10 text-sm font-semibold min-h-[44px]"
        />
        <Button variant="commission" class="min-h-[44px]" onclick={() => goto('/reconcile/manual')}>
          + New Mode A Statement
        </Button>
        <Button
          variant="default"
          class="min-h-[44px]"
          id="btn-mode-b-upload"
          onclick={() => goto(workspaceHref())}
        >
          + Upload Statement File (Mode B)
        </Button>
      </div>
    </div>

    {#if closedMonthRejectedOps.length > 0}
      <div class="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-sm font-bold text-amber-900">
              Needs Attention: Closed Month Entries ({closedMonthRejectedOps.length})
            </h2>
            <p class="text-xs text-amber-700">
              Offline transactions rejected because the historical calendar month was closed before
              sync.
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          {#each closedMonthRejectedOps as item (item.opId)}
            <div
              class="flex items-center justify-between p-3 rounded-xl bg-white/70 border border-amber-500/10 text-xs"
            >
              <div>
                <span class="font-bold">Original Date: {item.entryDate}</span> · Gross: {formatPoishaToBdt(
                  BigInt(item.grossPoisha),
                )}
              </div>
              <Button
                variant="default"
                class="text-xs py-1.5 min-h-[36px]"
                onclick={() => {
                  activeRecoveryItem = item;
                  showRecoveryModal = true;
                }}
              >
                Resolve Entry
              </Button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="flex flex-col gap-4">
      {#if statements.length === 0}
        <Card class="p-8 text-center text-[var(--c-muted,#6b7280)] text-sm">
          No statements recorded for {selectedMonth}. Click "+ New Mode A Statement" to submit a
          statement total.
        </Card>
      {:else}
        {#each statements as st (st.id)}
          <Card class="p-5">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div class="font-bold text-base text-[var(--c-ink,#111827)]">{st.payableNames}</div>
                <div class="text-xs text-[var(--c-muted,#6b7280)]">
                  {st.kind} · {st.source} · Month: {st.month}
                  {#if st.note}
                    · <span class="italic">"{st.note}"</span>{/if}
                </div>
              </div>

              <div class="flex items-center gap-6">
                <div class="text-right">
                  <div class="text-xs text-[var(--c-muted,#6b7280)]">Statement Total</div>
                  <div class="font-bold text-sm tabular-nums">
                    {formatPoishaToBdt(BigInt(st.statement_total_poisha))}
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-xs text-[var(--c-muted,#6b7280)]">Expected Liability</div>
                  <div class="font-bold text-sm tabular-nums">
                    {formatPoishaToBdt(BigInt(st.expected_poisha))}
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-xs text-[var(--c-muted,#6b7280)]">Variance</div>
                  <div
                    class="font-bold text-sm tabular-nums {BigInt(st.variance_poisha) !== 0n
                      ? 'text-blue-600'
                      : ''}"
                  >
                    {formatPoishaToBdt(BigInt(st.variance_poisha))}
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  {#if st.status === 'reconciled'}
                    <span
                      class="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700"
                      >Reconciled</span
                    >
                  {:else if st.status === 'superseded'}
                    <span
                      class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-700"
                      >Superseded</span
                    >
                  {:else}
                    {#if st.sourceKind === 'file'}
                      <Button
                        variant="commission"
                        class="text-xs py-1.5 min-h-[36px]"
                        id="btn-resume-{st.id}"
                        onclick={() => goto(workspaceHref(st.id))}
                      >
                        Resume Matching
                      </Button>
                    {:else}
                      <Button
                        variant="commission"
                        class="text-xs py-1.5 min-h-[36px]"
                        onclick={() => {
                          activeStatement = st;
                          showReconcileModal = true;
                        }}
                      >
                        Reconcile
                      </Button>
                    {/if}
                    <Button
                      variant="default"
                      class="text-xs py-1.5 min-h-[36px]"
                      onclick={() => {
                        activeStatement = st;
                        showSupersedeModal = true;
                      }}
                    >
                      Supersede
                    </Button>
                  {/if}
                </div>
              </div>
            </div>
          </Card>
        {/each}
      {/if}
    </div>

    {#if activeRecoveryItem}
      <ClosedMonthRecoveryModal
        bind:open={showRecoveryModal}
        entryId={activeRecoveryItem.entryId}
        originalDate={activeRecoveryItem.entryDate}
        grossPoisha={activeRecoveryItem.grossPoisha}
        onclose={() => {
          showRecoveryModal = false;
          activeRecoveryItem = null;
        }}
        onreassign={handleReassignRecovery}
        onreopen={handleReopenRecovery}
        ondiscard={handleDiscardRecovery}
      />
    {/if}

    <!-- Modal: Reconcile Statement -->
    {#if activeStatement}
      <Modal
        bind:open={showReconcileModal}
        title="Confirm Statement Reconciliation"
        onclose={() => {
          showReconcileModal = false;
        }}
      >
        <form onsubmit={handleReconcileStatementSubmit} class="flex flex-col gap-4">
          {#if actionErrorMessage}
            <div role="alert" class="p-3 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
              {actionErrorMessage}
            </div>
          {/if}

          <div class="p-4 rounded-xl glass text-sm flex justify-between">
            <div>
              <div class="text-xs text-[var(--c-muted,#6b7280)]">Statement Total</div>
              <div class="font-bold">
                {formatPoishaToBdt(BigInt(activeStatement.statement_total_poisha))}
              </div>
            </div>
            <div>
              <div class="text-xs text-[var(--c-muted,#6b7280)]">Expected Liability</div>
              <div class="font-bold">
                {formatPoishaToBdt(BigInt(activeStatement.expected_poisha))}
              </div>
            </div>
            <div>
              <div class="text-xs text-[var(--c-muted,#6b7280)]">Variance</div>
              <div class="font-bold">
                {formatPoishaToBdt(BigInt(activeStatement.variance_poisha))}
              </div>
            </div>
          </div>

          <div>
            <label
              for="modal-rec-note"
              class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1"
            >
              Explanatory Note {activeStatement &&
              !isVarianceWithinTolerance(
                BigInt(activeStatement.variance_poisha),
                tolerancePoisha,
                false,
              )
                ? '(Mandatory for variance > tolerance)'
                : '(Optional)'}
            </label>
            <textarea
              id="modal-rec-note"
              rows="3"
              bind:value={reconcileNote}
              class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
              placeholder="Justification note for discrepancy..."
            ></textarea>
          </div>

          <div class="flex justify-end gap-3">
            <Button
              variant="default"
              onclick={() => {
                showReconcileModal = false;
              }}>Cancel</Button
            >
            <!-- Unique ids: two modals shared #btn-save, which is invalid HTML and
                 broke element lookups (E2E, 2026-11-07). -->
            <Button
              id="btn-reconcile-statement"
              variant="commission"
              type="submit"
              loading={isActionSubmitting}
              disabled={activeStatement &&
                !isVarianceWithinTolerance(
                  BigInt(activeStatement.variance_poisha),
                  tolerancePoisha,
                  reconcileNote.trim().length > 0,
                )}
            >
              Reconcile Statement
            </Button>
          </div>
        </form>
      </Modal>

      <!-- Modal: Supersede Statement -->
      <Modal
        bind:open={showSupersedeModal}
        title="Supersede Statement"
        onclose={() => {
          showSupersedeModal = false;
        }}
      >
        <form onsubmit={handleSupersedeStatementSubmit} class="flex flex-col gap-4">
          {#if actionErrorMessage}
            <div role="alert" class="p-3 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
              {actionErrorMessage}
            </div>
          {/if}

          <div>
            <label
              for="modal-sup-total"
              class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1"
              >New Statement Total (BDT)</label
            >
            <input
              id="modal-sup-total"
              type="text"
              inputmode="decimal"
              required
              placeholder="0.00"
              bind:value={supersedeTotalBdt}
              class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm min-h-[44px]"
            />
          </div>

          <div>
            <label
              for="modal-sup-reason"
              class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1"
              >Supersede Reason (Mandatory)</label
            >
            <textarea
              id="modal-sup-reason"
              required
              rows="3"
              bind:value={supersedeReason}
              class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
              placeholder="Why is this statement being replaced?..."
            ></textarea>
          </div>

          <div class="flex justify-end gap-3">
            <Button
              variant="default"
              onclick={() => {
                showSupersedeModal = false;
              }}>Cancel</Button
            >
            <Button
              id="btn-confirm-supersede"
              variant="mastercard"
              type="submit"
              loading={isActionSubmitting}
              disabled={!supersedeReason.trim() ||
                parseStrictBdtToPoisha(supersedeTotalBdt) === null}
            >
              Confirm Supersede
            </Button>
          </div>
        </form>
      </Modal>
    {/if}
  </div>
{/if}
