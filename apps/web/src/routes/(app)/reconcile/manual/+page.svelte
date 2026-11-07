<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import {
    isVarianceWithinTolerance,
    parseStrictBdtToPoisha,
    resolveTargetPayableIds,
    currentDhakaMonth,
    type PayableItem,
  } from '$lib/reconcile/tolerance';
  import { formatPoishaToBdt } from '@clt/shared';
  import { db, type CachedAppSettings } from '$lib/db';
  import { supabase } from '$lib/supabase/client';

  let selectedMonth = $state(currentDhakaMonth());
  let payables = $state<PayableItem[]>([]);
  let selectedOption = $state<string>('');
  let statementTotalBdt = $state('');
  let note = $state('');
  let expectedPoisha = $state(0n);
  let tolerancePoisha = $state(100n);
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  // Derived, never written: Svelte 5 forbids state mutation inside a `$derived`,
  // and doing so threw state_unsafe_mutation and blanked the entire page (found
  // by the E2E route sweep, 2026-11-07).

  // Target payable IDs: resolved via pure helper conforming to DDL columns (code, kind)
  let targetPayableIds = $derived.by(() => {
    return resolveTargetPayableIds(selectedOption, payables);
  });

  // Strict BDT input parsing without floating-point math (Rule 2)
  let parsedStatementTotal = $derived.by(() => {
    if (!statementTotalBdt.trim()) return { poisha: 0n as bigint | null, error: '' };
    const parsed = parseStrictBdtToPoisha(statementTotalBdt);
    if (parsed === null) {
      return {
        poisha: null as bigint | null,
        error: 'Please enter a valid amount in BDT (maximum 2 decimal places).',
      };
    }
    return { poisha: parsed as bigint | null, error: '' };
  });
  let statementTotalPoisha = $derived(parsedStatementTotal.poisha);
  let amountValidationError = $derived(parsedStatementTotal.error);

  let variancePoisha = $derived(statementTotalPoisha !== null ? statementTotalPoisha - expectedPoisha : 0n);

  let meetsTolerance = $derived(
    statementTotalPoisha !== null &&
    isVarianceWithinTolerance(variancePoisha, tolerancePoisha, note.trim().length > 0)
  );

  async function loadInitialData() {
    const activePayables = await db.payables.toArray();
    payables = activePayables.map(p => ({
      id: p.id,
      name: p.name,
      code: p.code ?? '',
      kind: p.kind,
    }));

    if (payables.length > 0 && !selectedOption) {
      selectedOption = 'combined_card';
    }

    const settings: CachedAppSettings | undefined = await db.appSettings.toCollection().first();
    if (settings?.reconcile_tolerance_poisha) {
      tolerancePoisha = BigInt(settings.reconcile_tolerance_poisha);
    }

    await updateExpectedLiability();
  }

  async function updateExpectedLiability() {
    if (targetPayableIds.length === 0 || statementTotalPoisha === null) {
      expectedPoisha = 0n;
      return;
    }

    const monthDate = `${selectedMonth}-01`;
    const settlements = await db.settlements
      .where('month')
      .equals(monthDate)
      .toArray();

    const sum = settlements
      .filter(s => targetPayableIds.includes(s.payable_id))
      .reduce((acc, s) => acc + BigInt(s.expected_poisha || '0'), 0n);

    expectedPoisha = sum;
  }

  onMount(() => {
    loadInitialData();
  });

  $effect(() => {
    if (selectedMonth && selectedOption) {
      updateExpectedLiability();
    }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (statementTotalPoisha === null || targetPayableIds.length === 0 || !meetsTolerance) return;
    isSubmitting = true;
    errorMessage = '';

    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      if (!token) throw new Error('Not authenticated. Please log in.');

      const kind = selectedOption === 'combined_card' ? 'combined_card' : 'single_payable';
      const month = `${selectedMonth}-01`;

      // 1. Create statement
      const createRes = await fetch('/api/v1/reconcile/statements', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          month,
          kind,
          source: 'manual_total',
          statementTotalPoisha: statementTotalPoisha.toString(),
          payableIds: targetPayableIds,
          lines: [],
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Failed to create statement.');
      }

      const { statementId } = await createRes.json();

      // Cache open statement immediately to prevent orphan statement traps if reconciliation fails (P1.2)
      await db.statements.put({
        id: statementId,
        month,
        kind,
        source: 'manual_total',
        statement_total_poisha: statementTotalPoisha.toString(),
        total_gross_poisha: statementTotalPoisha.toString(),
        expected_poisha: expectedPoisha.toString(),
        variance_poisha: variancePoisha.toString(),
        status: 'open',
        note: note.trim() || undefined,
        payable_ids: targetPayableIds,
      });

      // 2. Reconcile statement
      const reconcileRes = await fetch('/api/v1/reconcile/statements/reconcile', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          statementId,
          note: note.trim(),
        }),
      });

      if (!reconcileRes.ok) {
        const err = await reconcileRes.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Statement created but reconciliation failed. Review under Statement Overview.');
      }

      // Mark statement reconciled in Dexie cache
      await db.statements.update(statementId, { status: 'reconciled' });

      goto('/reconcile');
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Mode A submission failed.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if session.user?.role !== 'admin' && session.user?.role !== 'owner'}
  <div class="p-8 max-w-lg mx-auto text-center">
    <Card class="p-6">
      <h2 class="text-lg font-bold text-red-600 mb-2">Access Denied</h2>
      <p class="text-sm text-[var(--c-muted,#6b7280)] mb-4">Reconciliation is restricted strictly to Administrators and Owners.</p>
      <Button variant="default" onclick={() => goto('/dashboard')}>Return to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="max-w-2xl mx-auto p-6 w-full">
    <div class="mb-6">
      <Button variant="default" class="text-xs mb-3 min-h-[36px]" onclick={() => goto('/reconcile')}>‹ Back to Overview</Button>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Mode A Manual Statement Reconciliation</h1>
      <p class="text-sm text-[var(--c-muted,#6b7280)]">Totals-only reconciliation comparing total vendor invoice to internal liabilities (PRD §11.2).</p>
    </div>

    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    <Card class="p-6">
      <form onsubmit={handleSubmit} class="flex flex-col gap-4">
        <div>
          <label for="recon-month" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Reconciliation Month</label>
          <input
            id="recon-month"
            type="month"
            required
            bind:value={selectedMonth}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm font-semibold min-h-[44px]"
          />
        </div>

        <div>
          <label for="recon-payable" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Target Payable Scope</label>
          <select
            id="recon-payable"
            bind:value={selectedOption}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm min-h-[44px]"
          >
            <option value="combined_card">Combined Card Fees (Visa & Mastercard)</option>
            {#each payables as p (p.id)}
              <option value={p.id}>{p.name} ({p.code})</option>
            {/each}
          </select>
        </div>

        <div>
          <label for="recon-total-bdt" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Statement Total Amount (BDT)</label>
          <input
            id="recon-total-bdt"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            required
            bind:value={statementTotalBdt}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm tabular-nums min-h-[44px]"
          />
          {#if amountValidationError}
            <p class="text-xs text-red-600 mt-1 font-medium">{amountValidationError}</p>
          {/if}
        </div>

        <div class="p-4 rounded-xl glass border border-black/5 flex justify-between text-sm">
          <div>
            <div class="text-xs text-[var(--c-muted,#6b7280)]">Expected Liability</div>
            <div class="font-bold tabular-nums">{formatPoishaToBdt(expectedPoisha)}</div>
          </div>
          <div>
            <div class="text-xs text-[var(--c-muted,#6b7280)]">Net Variance</div>
            <div class="font-bold tabular-nums {variancePoisha !== 0n ? 'text-blue-600' : ''}">
              {formatPoishaToBdt(variancePoisha)}
            </div>
          </div>
          <div>
            <div class="text-xs text-[var(--c-muted,#6b7280)]">Tolerance</div>
            <div class="font-bold">±{formatPoishaToBdt(tolerancePoisha)} ({tolerancePoisha.toString()} poisha)</div>
          </div>
        </div>

        {#if statementTotalPoisha !== null && !meetsTolerance}
          <div class="p-3 rounded-xl bg-amber-500/10 text-amber-800 text-xs font-medium">
            Net variance exceeds ±{tolerancePoisha.toString()} poisha tolerance. An explanatory justification note is required to complete reconciliation.
          </div>
        {/if}

        <div>
          <label for="rec-note" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">
            Explanatory Note {!meetsTolerance ? '(Mandatory for variance > tolerance)' : '(Optional)'}
          </label>
          <textarea
            id="rec-note"
            rows="3"
            bind:value={note}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Reason for discrepancy between internal ledger and statement total..."
          ></textarea>
        </div>

        <div class="mt-2 flex justify-end gap-3">
          <Button variant="default" class="min-h-[44px]" onclick={() => goto('/reconcile')}>Cancel</Button>
          <Button
            id="btn-save"
            variant="commission"
            type="submit"
            class="min-h-[44px]"
            disabled={!meetsTolerance || statementTotalPoisha === null || targetPayableIds.length === 0}
            loading={isSubmitting}
          >
            Reconcile Statement
          </Button>
        </div>
      </form>
    </Card>
  </div>
{/if}
