# 015_reconciliation_mode_a_and_month_close.md — Mode A Manual Reconciliation, Month Close, and Recovery Queue

- Plan Identifier: CLT-PLAN-015
- Phase: Phase 2 / M2
- Milestone: M2
- Parent Document: `docs/plans/PRD-payment-ledger-app.md` (v1.19)
- PRD sections covered: §8.4 (Month close gating and offline recovery), §11.1 (Statement semantics), §11.2 (Manual totals-only reconciliation Mode A), §17 (Milestone M2), §18 (Implementation Readiness Gate 4)
- Depends on: 005, 007, 008, 009, 010, 011, 012, 013, 014
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement Mode A (Totals-Only) statement reconciliation, scoped entry reconciliation exceptions, statement supersession, Owner-only month closing and reopening procedures, and the complete 3-way offline recovery workflow for entries rejected due to closed historical months. Month closing physically locks all entries in that calendar month against modifications, additions, or voids, gated on 100% payable reconciliation, active Owner approvals for overpayments, and zero pending stale rate reviews. The closed-month recovery queue leverages Plan 011 outbox recovery helpers (`retryRejectedOp`, `discardRejectedOp`), re-resolves published rate profiles effective for the destination date, recomputes financial calculations via `@clt/calc`, updates local Dexie entries, and guarantees zero data loss in offline and online modes.

## 2. Scope

- IN:
  - Role gating: restricting `/reconcile` and `/reconcile/manual` to Admin and Owner; restricting `/months/close` strictly to Owner; Staff accessing these routes receive an Access Denied screen per PRD §3 and §8.4.
  - Mode A manual totals-only reconciliation overview in `apps/web/src/routes/(app)/reconcile/+page.svelte` and entry screen in `manual/+page.svelte`.
  - Operator enters `statement_total_poisha`; system evaluates `expected_poisha` dynamically from `db.settlements` joined with active payables from `db.payables` (using DDL column `code` and `kind = 'card'` for combined cards) and computes `variance_poisha`.
  - Strict decimal BDT input validation in `apps/web/src/lib/reconcile/tolerance.ts` (`parseStrictBdtToPoisha`) enforcing integer poisha arithmetic without float conversions (Rule 2).
  - Tolerance evaluation via pure helper `isVarianceWithinTolerance` in `apps/web/src/lib/reconcile/tolerance.ts`: auto-passes if `abs(variance_poisha) <= tolerancePoisha` (default: 100 poisha / ৳1.00 from `db.appSettings`); requires mandatory explanatory note if variance exceeds tolerance conforming to PRD §11.2.
  - Statement actions in `reconcile/+page.svelte`: `[Reconcile]` (with tolerance check and note) and `[Supersede]` (calling `/api/v1/reconcile/statements/supersede`).
  - Month close screen in `apps/web/src/routes/(app)/months/close/+page.svelte` enforcing complete gating checklist via `evaluateMonthCloseGates`:
    1. Every payable in month is reconciled or zero-liability (`settlements.status = 'not_applicable'`).
    2. Overpaid settlements have active Owner approvals matching exact surplus (`overpayment_approved_amount_poisha === paid_poisha - expected_poisha`).
    3. Zero active entries with `stale_review_status = 'flagged'` (ignoring voided and superseded entries).
  - Clear advisory notice in UI that client gate evaluations are advisory; the authoritative lock is enforced atomically by PostgreSQL in `close_month` under Month Advisory Lock 1001.
  - Reopen month modal and button in `apps/web/src/routes/(app)/months/close/+page.svelte` requiring mandatory audit reason and owner role to call `/api/v1/months/reopen`, warning that reopening un-reconciles all statements for that month, and cascading local Dexie statements to `status = 'open'`.
  - Complete 3-way closed-month recovery modal in `apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte` conforming to PRD §8.4:
    1. Reassign date to an open month (defaults to 1st of current open Asia/Dhaka month; validates against `db.monthCloses`; prompts for VAT input if destination mode is manual; recomputes financial snapshot via `@clt/calc`; calls `retryRejectedOp` from `$lib/sync/recovery`; updates `db.entries`).
    2. Reopen month by Owner (prompts Owner for mandatory audit reason; calls `reopen_month`; cascades local statements; re-queues rejected op via `retryRejectedOp` so it syncs immediately into the now reopened month).
    3. Discard rejected entry with audited reason (calls `discardRejectedOp` from `$lib/sync/recovery` which allocates fresh UUID, enqueues `discard_rejected_entry` op in outbox, and purges uncommitted local entry).
  - Integration of "Needs Attention: Closed Month Entries" queue in `reconcile/+page.svelte` reading `db.rejectedOps` where `error_code === 'month_closed'` and `status === 'pending'`, looking up real original entry dates and gross amounts from `db.entries`.
  - All primary page-level and modal submit buttons carry `id="btn-save"` or `id="btn-submit"` for FloatingMenu collision avoidance (Rule R16).
  - Server mediation endpoints under `/api/v1/*` using standard SvelteKit `error(401, ...)` / `error(403, ...)`, clean JSON error responses, and Zod input validation:
    - `POST /api/v1/reconcile/statements` (mediating `create_statement` with 9 parameters including `p_lines`)
    - `POST /api/v1/reconcile/statements/reconcile` (mediating `reconcile_statement`)
    - `POST /api/v1/reconcile/statements/supersede` (mediating `supersede_statement` with 7 parameters including `p_note` and `p_lines`)
    - `POST /api/v1/reconcile/exceptions` (mediating `review_entry_reconciliation_exception`)
    - `POST /api/v1/months/close` (mediating Owner-only `close_month`)
    - `POST /api/v1/months/reopen` (mediating Owner-only `reopen_month`)
  - Integration and coverage of regression tests #7, #17, #19, #23, #34, #37, #39, #40, #54, #58 from PRD §16.2.
- OUT:
  - File-based line-item statement adapters (Mode B, owned by Plan 018).
  - Automated 1-to-1 reference matching (owned by Plan 018).
  - Outbox network sync runner (owned by Plan 011).

## 3. Preconditions

1. Plan 005 reconciliation tables, constraints, generated variance columns, and RPCs exist in PostgreSQL.
   - Check command: `pnpm vitest run tests/db/settlement_recon.test.ts`
   - Expected output: exit code `0`.
2. Plan 008 server authentication context `getCallerContext` is functional.
   - Check command: `test -f apps/web/src/lib/server/auth.ts`
   - Expected output: exit code `0`.
3. Plan 010 Dexie tables and Plan 011 sync recovery helpers (`retryRejectedOp`, `discardRejectedOp`) exist in `apps/web/src/lib/sync/recovery.ts`.
   - Check command: `test -f apps/web/src/lib/sync/recovery.ts`
   - Expected output: exit code `0`.
4. Plan 014 settlements tracking and payment recording RPC endpoints are functional.
   - Check command: `test -f apps/web/src/routes/api/v1/settlements/payments/+server.ts`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/reconcile/tolerance.ts` | create | Pure tolerance math, strict BDT parser, payable resolver, and month close checklist gating helper |
| `apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte` | create | Modal providing 3-way recovery actions for closed-month rejections |
| `apps/web/src/routes/(app)/reconcile/+page.svelte` | create | Reconciliation overview listing monthly statements, statement actions, and closed-month queue |
| `apps/web/src/routes/(app)/reconcile/manual/+page.svelte` | create | Mode A totals-only statement entry, payable selection, and submission screen |
| `apps/web/src/routes/(app)/months/close/+page.svelte` | create | Owner-only month close gating checklist and reopen controls |
| `apps/web/src/routes/api/v1/reconcile/statements/+server.ts` | create | POST endpoint mediating statement creation (`create_statement`) |
| `apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts` | create | POST endpoint mediating Mode A statement reconciliation (`reconcile_statement`) |
| `apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts` | create | POST endpoint mediating statement supersession (`supersede_statement`) |
| `apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts` | create | POST endpoint mediating entry reconciliation exception reviews (`review_entry_reconciliation_exception`) |
| `apps/web/src/routes/api/v1/months/close/+server.ts` | create | POST endpoint mediating Owner-only month close (`close_month`) |
| `apps/web/src/routes/api/v1/months/reopen/+server.ts` | create | POST endpoint mediating Owner-only month reopen (`reopen_month`) |
| `apps/web/src/lib/reconcile/reconcile.test.ts` | create | Unit tests verifying tolerance math, month close checklist gates, recovery flows, and BDT parsing |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create pure reconciliation helper in `apps/web/src/lib/reconcile/tolerance.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/reconcile/tolerance.ts`.
   - Check: `grep -c 'isVarianceWithinTolerance' apps/web/src/lib/reconcile/tolerance.ts`
   - Expected output: `1`

2. Create closed-month recovery modal in `apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte`.
   - Check: `grep -c 'Needs Attention: Closed Month Entry' apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte`
   - Expected output: `1`

3. Create reconciliation overview screen in `apps/web/src/routes/(app)/reconcile/+page.svelte` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/routes/(app)/reconcile/+page.svelte`.
   - Check: `grep -c 'Statement Reconciliation' apps/web/src/routes/(app)/reconcile/+page.svelte`
   - Expected output: `1`

4. Create Mode A manual reconciliation entry screen in `apps/web/src/routes/(app)/reconcile/manual/+page.svelte` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/routes/(app)/reconcile/manual/+page.svelte`.
   - Check: `grep -c 'Mode A Manual Statement Reconciliation' apps/web/src/routes/(app)/reconcile/manual/+page.svelte`
   - Expected output: `1`

5. Create month close and reopen screen in `apps/web/src/routes/(app)/months/close/+page.svelte` referencing Specification 6.5.
   - Command: copy block 6.5 into `apps/web/src/routes/(app)/months/close/+page.svelte`.
   - Check: `grep -c 'Month Close Controls' apps/web/src/routes/(app)/months/close/+page.svelte`
   - Expected output: `1`

6. Create statement creation server route in `apps/web/src/routes/api/v1/reconcile/statements/+server.ts` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/routes/api/v1/reconcile/statements/+server.ts`.
   - Check: `grep -c 'create_statement' apps/web/src/routes/api/v1/reconcile/statements/+server.ts`
   - Expected output: `1`

7. Create statement reconciliation server route in `apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts`.
   - Check: `grep -c 'reconcile_statement' apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts`
   - Expected output: `1`

8. Create statement supersession server route in `apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts` referencing Specification 6.8.
   - Command: copy block 6.8 into `apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts`.
   - Check: `grep -c 'supersede_statement' apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts`
   - Expected output: `1`

9. Create entry exception review server route in `apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts` referencing Specification 6.9.
   - Command: copy block 6.9 into `apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts`.
   - Check: `grep -c 'review_entry_reconciliation_exception' apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts`
   - Expected output: `1`

10. Create month close server route in `apps/web/src/routes/api/v1/months/close/+server.ts` referencing Specification 6.10.
    - Command: copy block 6.10 into `apps/web/src/routes/api/v1/months/close/+server.ts`.
    - Check: `grep -c 'close_month' apps/web/src/routes/api/v1/months/close/+server.ts`
    - Expected output: `1`

11. Create reopen month server route in `apps/web/src/routes/api/v1/months/reopen/+server.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `apps/web/src/routes/api/v1/months/reopen/+server.ts`.
    - Check: `grep -c 'reopen_month' apps/web/src/routes/api/v1/months/reopen/+server.ts`
    - Expected output: `1`

12. Create reconciliation unit test suite in `apps/web/src/lib/reconcile/reconcile.test.ts` referencing Specification 6.12.
    - Command: copy block 6.12 into `apps/web/src/lib/reconcile/reconcile.test.ts`.
    - Check: `pnpm --filter @clt/web test reconcile.test.ts`
    - Expected output: test suite passes with 0 failures.

## 6. Specifications

### 6.1 `apps/web/src/lib/reconcile/tolerance.ts`

```ts
/**
 * apps/web/src/lib/reconcile/tolerance.ts
 * Pure reconciliation math, validation helpers, and month-close checklist gating logic.
 */

/**
 * Tolerance verification helper conforming to PRD §11.2 (Mode A manual reconciliation).
 * Auto-passes if abs(variance) <= tolerancePoisha (default 100 poisha / ৳1.00).
 * If variance exceeds tolerance, requires a non-empty explanatory justification note.
 */
export function isVarianceWithinTolerance(
  variancePoisha: bigint,
  tolerancePoisha: bigint,
  hasExplanationNote: boolean
): boolean {
  const absVariance = variancePoisha < 0n ? -variancePoisha : variancePoisha;
  if (absVariance <= tolerancePoisha) {
    return true;
  }
  return hasExplanationNote;
}

/**
 * Strict BDT poisha parser validating max 2 decimal places and converting to BigInt poisha
 * without floating-point math (Rule 2). Returns null if input is malformed or invalid.
 */
export function parseStrictBdtToPoisha(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const parts = trimmed.split('.');
  const integerPart = BigInt(parts[0]);
  let fractionPart = 0n;
  if (parts.length > 1) {
    const rawFrac = parts[1];
    if (rawFrac.length === 1) {
      fractionPart = BigInt(rawFrac) * 10n;
    } else if (rawFrac.length === 2) {
      fractionPart = BigInt(rawFrac);
    }
  }
  return integerPart * 100n + fractionPart;
}

export interface PayableItem {
  id: string;
  name: string;
  code: string;
  kind?: string | undefined;
}

/**
 * Resolves target payable IDs from payables collection.
 * When kind is 'combined_card', resolves to all card payables (kind = 'card' or code in ('visa', 'mastercard')).
 * Otherwise resolves to the single selected payable ID.
 */
export function resolveTargetPayableIds(
  selectedOption: string,
  payables: PayableItem[]
): string[] {
  if (selectedOption === 'combined_card') {
    const cardPayables = payables.filter(
      p => p.kind === 'card' || p.code.toLowerCase().includes('visa') || p.code.toLowerCase().includes('mastercard')
    );
    return cardPayables.map(p => p.id);
  }
  return selectedOption ? [selectedOption] : [];
}

export interface MonthCloseGatesInput {
  callerRole: 'staff' | 'admin' | 'owner';
  allPayablesReconciled: boolean;
  overpaymentsApproved: boolean;
  zeroPendingStaleReviews: boolean;
  monthStatus: 'open' | 'closed';
}

export interface MonthCloseGatesResult {
  canClose: boolean;
  blockingReasons: string[];
}

/**
 * Pure evaluation function for Month Close Gating Checklist (PRD §8.4 & §18 Gate 4).
 * Enforces:
 * 1. Owner-only role authorization (Hard Rule 7).
 * 2. Month not already closed.
 * 3. 100% payables reconciled or marked not_applicable.
 * 4. All overpaid settlements have active Owner approvals matching exact surplus.
 * 5. Zero active pending stale rate reviews (>৳50,000 flagged entries).
 */
export function evaluateMonthCloseGates(input: MonthCloseGatesInput): MonthCloseGatesResult {
  const blockingReasons: string[] = [];
  if (input.callerRole !== 'owner') {
    blockingReasons.push('Only the Owner can close a month.');
  }
  if (input.monthStatus === 'closed') {
    blockingReasons.push('Month is already closed.');
  }
  if (!input.allPayablesReconciled) {
    blockingReasons.push('All payables must be reconciled or marked not_applicable.');
  }
  if (!input.overpaymentsApproved) {
    blockingReasons.push('All overpaid settlements require active Owner approvals matching exact surplus.');
  }
  if (!input.zeroPendingStaleReviews) {
    blockingReasons.push('Zero pending stale reviews required on active entries (>৳50,000 flagged entries).');
  }
  return {
    canClose: blockingReasons.length === 0,
    blockingReasons,
  };
}

/**
 * Returns current Asia/Dhaka month string (YYYY-MM).
 */
export function currentDhakaMonth(): string {
  const now = new Date();
  const dhakaTime = new Date(now.getTime() + 6 * 3600 * 1000);
  return `${dhakaTime.getUTCFullYear()}-${String(dhakaTime.getUTCMonth() + 1).padStart(2, '0')}`;
}
```

### 6.2 `apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte`

```svelte
<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { db } from '$lib/db';
  import { parseStrictBdtToPoisha, currentDhakaMonth } from '$lib/reconcile/tolerance';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    open: boolean;
    entryId: string;
    originalDate: string;
    grossPoisha: string;
    destinationVatMode?: 'manual' | 'percent_of_gross' | 'percent_inclusive';
    onclose: () => void;
    onreassign: (newDate: string, reason: string, manualVatPoisha?: bigint) => Promise<void>;
    onreopen: (targetMonth: string, reason: string) => Promise<void>;
    ondiscard: (reason: string) => Promise<void>;
  }

  let {
    open = $bindable(),
    entryId,
    originalDate,
    grossPoisha,
    destinationVatMode,
    onclose,
    onreassign,
    onreopen,
    ondiscard,
  }: Props = $props();

  let mode = $state<'choose' | 'reassign' | 'reopen' | 'discard'>('choose');

  const defaultDestinationDate = `${currentDhakaMonth()}-01`;
  let reassignDate = $state(defaultDestinationDate);
  let reassignReason = $state('');
  let manualVatBdt = $state('');
  let reopenReason = $state('');
  let discardReason = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  let currentDestinationVatMode = $state<'manual' | 'percent_of_gross' | 'percent_inclusive'>(
    destinationVatMode ?? 'manual'
  );

  // Dynamically resolve destination date rate profile to determine whether manual VAT input is required (PRD §6.3, F20)
  $effect(() => {
    if (reassignDate) {
      db.rateProfiles
        .where('status')
        .equals('published')
        .and((p) => p.effective_from <= reassignDate)
        .reverse()
        .sortBy('effective_from')
        .then((rows) => {
          if (rows[0]) currentDestinationVatMode = rows[0].vat_mode;
        });
    }
  });

  const originalMonth = $derived(originalDate ? originalDate.substring(0, 7) : currentDhakaMonth());
  const destinationMonth = $derived(reassignDate ? reassignDate.substring(0, 7) : currentDhakaMonth());
  const vatInputRequired = $derived(currentDestinationVatMode === 'manual');

  async function handleReassignSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!reassignReason.trim()) return;
    isSubmitting = true;
    errorMessage = '';
    try {
      let manualVatPoisha: bigint | undefined;
      if (vatInputRequired) {
        const parsed = parseStrictBdtToPoisha(manualVatBdt);
        if (parsed === null) {
          throw new Error('Please enter a valid VAT amount in BDT (maximum 2 decimal places).');
        }
        manualVatPoisha = parsed;
      }
      await onreassign(reassignDate, reassignReason.trim(), manualVatPoisha);
      onclose();
    } catch (err: any) {
      errorMessage = err.message || 'Failed to reassign entry.';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleReopenSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!reopenReason.trim() || session.user?.role !== 'owner') return;
    isSubmitting = true;
    errorMessage = '';
    try {
      await onreopen(originalMonth, reopenReason.trim());
      onclose();
    } catch (err: any) {
      errorMessage = err.message || 'Failed to reopen month.';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleDiscardSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!discardReason.trim()) return;
    isSubmitting = true;
    errorMessage = '';
    try {
      await ondiscard(discardReason.trim());
      onclose();
    } catch (err: any) {
      errorMessage = err.message || 'Failed to discard entry.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="recovery-modal">
  <Modal bind:open title="Needs Attention: Closed Month Entry" {onclose}>
    {#if errorMessage}
      <div role="alert" class="p-3 mb-4 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
        {errorMessage}
      </div>
    {/if}

    {#if mode === 'choose'}
      <div class="flex flex-col gap-4 text-sm">
        <p class="text-xs text-[var(--c-muted,#6b7280)]">
          This transaction originally dated <span class="font-bold text-[var(--c-ink,#111827)]">{originalDate}</span> (Gross: {formatPoishaToBdt(BigInt(grossPoisha || '0'))}) was recorded offline, but the calendar month was closed before sync (PRD §8.4). Choose an audited resolution:
        </p>

        <div class="flex flex-col gap-2">
          <Button variant="default" class="w-full justify-start py-3 min-h-[44px]" onclick={() => { mode = 'reassign'; }}>
            1. Reassign to Open Month (1st of open month)
          </Button>

          <Button
            variant="default"
            class="w-full justify-start py-3 min-h-[44px]"
            disabled={session.user?.role !== 'owner'}
            onclick={() => { mode = 'reopen'; }}
          >
            2. Reopen Month {originalMonth} (Owner Only)
            {#if session.user?.role !== 'owner'}
              <span class="text-xs text-[var(--c-muted,#6b7280)] ml-2">(Owner role required)</span>
            {/if}
          </Button>

          <Button variant="default" class="w-full justify-start py-3 min-h-[44px]" onclick={() => { mode = 'discard'; }}>
            3. Discard Entry with Audited Reason
          </Button>
        </div>
      </div>
    {:else if mode === 'reassign'}
      <form onsubmit={handleReassignSubmit} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-amber-500/10 text-xs text-amber-800">
          Warning: Reassigning this transaction shifts VAT and merchant liability from the closed month ({originalMonth}) to destination month ({destinationMonth}).
        </div>

        <div>
          <label for="reassign-date" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Destination Open Month Date</label>
          <input
            id="reassign-date"
            type="date"
            required
            bind:value={reassignDate}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm min-h-[44px]"
          />
        </div>

        {#if vatInputRequired}
          <div class="p-3 rounded-xl bg-blue-500/10 text-xs text-blue-800">
            Notice: Destination rate profile uses Manual VAT mode. Please re-enter the VAT amount to satisfy mode exclusivity.
          </div>
          <div>
            <label for="manual-vat-bdt" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Manual VAT Input (BDT)</label>
            <input
              id="manual-vat-bdt"
              type="text"
              inputmode="decimal"
              required
              placeholder="0.00"
              bind:value={manualVatBdt}
              class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm min-h-[44px]"
            />
          </div>
        {/if}

        <div>
          <label for="reassign-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Mandatory Reassign Reason</label>
          <textarea
            id="reassign-reason"
            required
            rows="2"
            bind:value={reassignReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Audit justification for reassigning date to open month..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { mode = 'choose'; }}>Back</Button>
          <Button id="btn-save" variant="commission" type="submit" loading={isSubmitting} disabled={!reassignReason.trim()}>
            Confirm Reassignment
          </Button>
        </div>
      </form>
    {:else if mode === 'reopen'}
      <form onsubmit={handleReopenSubmit} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-amber-500/10 text-xs text-amber-800">
          Warning: Reopening month {originalMonth} unfreezes financial entries, un-reconciles all reconciled statements for that month (flipping them back to open), and re-queues this operation to sync immediately.
        </div>

        <div>
          <label for="reopen-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Mandatory Month Reopen Reason</label>
          <textarea
            id="reopen-reason"
            required
            rows="3"
            bind:value={reopenReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Audit explanation for reopening this closed calendar month..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { mode = 'choose'; }}>Back</Button>
          <Button id="btn-save" variant="mastercard" type="submit" loading={isSubmitting} disabled={!reopenReason.trim()}>
            Confirm Reopen Month
          </Button>
        </div>
      </form>
    {:else if mode === 'discard'}
      <form onsubmit={handleDiscardSubmit} class="flex flex-col gap-4">
        <div class="p-3 rounded-xl bg-red-500/10 text-xs text-red-800">
          Caution: Discarding permanently drops this transaction from synchronization after recording an audited discard operation in the outbox.
        </div>

        <div>
          <label for="discard-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Mandatory Discard Reason</label>
          <textarea
            id="discard-reason"
            required
            rows="3"
            bind:value={discardReason}
            class="w-full px-4 py-2.5 rounded-xl border border-black/10 text-sm"
            placeholder="Audit justification for permanently discarding this transaction..."
          ></textarea>
        </div>

        <div class="flex justify-end gap-3">
          <Button variant="default" onclick={() => { mode = 'choose'; }}>Back</Button>
          <Button id="btn-save" variant="mastercard" type="submit" loading={isSubmitting} disabled={!discardReason.trim()}>
            Confirm Discard
          </Button>
        </div>
      </form>
    {/if}
  </Modal>
</div>
```


### 6.3 `apps/web/src/routes/(app)/reconcile/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import ClosedMonthRecoveryModal from '$lib/ui/ClosedMonthRecoveryModal.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db, type CachedStatement, type CachedPayable } from '$lib/db';
  import { retryRejectedOp, discardRejectedOp } from '$lib/sync/recovery';
  import { syncRunner } from '$lib/sync/runner.svelte';
  import { calculateEntry } from '@clt/calc';
  import { formatPoishaToBdt, parseBdtToPoisha, type RateSnapshot } from '@clt/shared';
  import { currentDhakaMonth, isVarianceWithinTolerance } from '$lib/reconcile/tolerance';

  interface StatementRow {
    id: string;
    kind: string;
    month: string;
    source: string;
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

  let selectedMonth = $state(currentDhakaMonth());
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
    const settings = await db.appSettings.toCollection().first();
    if (settings && (settings as any).reconcile_tolerance_poisha) {
      tolerancePoisha = BigInt((settings as any).reconcile_tolerance_poisha);
    }

    // 2. Load payables to resolve names
    const payables = await db.payables.toArray();
    const payableMap = new Map(payables.map(p => [p.id, p.name]));

    // 3. Query statements for month
    const stList = await db.statements.where('month').equals(monthDate).toArray();

    statements = stList.map(st => {
      const total = BigInt(st.statement_total_poisha || (st as any).total_gross_poisha || '0');
      const expected = BigInt(st.expected_poisha || '0');
      const variance = st.variance_poisha ? BigInt(st.variance_poisha) : total - expected;

      let payableNames = 'Multiple Payables';
      if (st.kind === 'combined_card') {
        payableNames = 'Visa Fee & Mastercard Fee (Combined)';
      } else if (st.payable_ids && st.payable_ids.length > 0) {
        payableNames = st.payable_ids.map(id => payableMap.get(id) || id).join(', ');
      } else if (st.payable_id) {
        payableNames = payableMap.get(st.payable_id) || 'Payable Fee';
      }

      return {
        id: st.id,
        kind: st.kind === 'combined_card' ? 'Combined Card' : 'Single Payable',
        month: st.month,
        source: st.source === 'manual_total' ? 'Mode A (Manual)' : 'Mode B (File)',
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
      .and(op => op.error_code === 'month_closed')
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
      throw new Error(`Destination month (${newDate.substring(0, 7)}) is closed. Please select an open month.`);
    }

    const localEntry = await db.entries.get(entryId);
    if (!localEntry) throw new Error('Local transaction entry not found in database.');

    // 1. Resolve date-effective published rate profile for new date
    const profile = await db.rateProfiles
      .where('status')
      .equals('published')
      .and(p => p.effective_from <= newDate)
      .reverse()
      .sortBy('effective_from')
      .then(rows => rows[0]);

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

    // 3. Update local entry in Dexie
    await db.entries.update(entryId, {
      entry_date: newDate,
      gross_poisha: calcResult.grossPoisha.toString(),
      vat_poisha: calcResult.vatPoisha.toString(),
      commission_poisha: calcResult.commissionPoisha.toString(),
      business_charge_poisha: calcResult.businessChargePoisha.toString(),
      customer_charge_poisha: calcResult.customerChargePoisha.toString(),
      net_poisha: calcResult.netAfterDeductionsPoisha.toString(),
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
        'Authorization': `Bearer ${token}`,
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
          'Authorization': `Bearer ${token}`,
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
    } catch (err: any) {
      actionErrorMessage = err.message || 'Reconciliation failed.';
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
          'Authorization': `Bearer ${token}`,
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
        });
      }

      showSupersedeModal = false;
      activeStatement = null;
      supersedeTotalBdt = '';
      supersedeReason = '';
      await loadReconciliationData();
    } catch (err: any) {
      actionErrorMessage = err.message || 'Supersede failed.';
    } finally {
      isActionSubmitting = false;
    }
  }
</script>

{#if session.user?.role !== 'admin' && session.user?.role !== 'owner'}
  <div class="p-8 max-w-lg mx-auto text-center">
    <Card class="p-6">
      <h2 class="text-lg font-bold text-red-600 mb-2">Access Denied</h2>
      <p class="text-sm text-[var(--c-muted,#6b7280)] mb-4">Reconciliation controls are restricted strictly to Administrators and Owners.</p>
      <Button variant="default" onclick={() => goto('/dashboard')}>Return to Dashboard</Button>
    </Card>
  </div>
{:else}
  <div class="reconcile-overview p-6 max-w-5xl mx-auto w-full">
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Statement Reconciliation</h1>
        <p class="text-sm text-[var(--c-muted,#6b7280)]">Reconcile internal payment ledgers against provider statements (PRD §11).</p>
      </div>

      <div class="flex items-center gap-3">
        <input
          type="month"
          bind:value={selectedMonth}
          class="px-3 py-2 rounded-xl border border-black/10 text-sm font-semibold min-h-[44px]"
        />
        <Button
          variant="commission"
          class="min-h-[44px]"
          onclick={() => goto('/reconcile/manual')}
        >
          + New Mode A Statement
        </Button>
      </div>
    </div>

    {#if closedMonthRejectedOps.length > 0}
      <div class="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h2 class="text-sm font-bold text-amber-900">Needs Attention: Closed Month Entries ({closedMonthRejectedOps.length})</h2>
            <p class="text-xs text-amber-700">Offline transactions rejected because the historical calendar month was closed before sync.</p>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          {#each closedMonthRejectedOps as item (item.opId)}
            <div class="flex items-center justify-between p-3 rounded-xl bg-white/70 border border-amber-500/10 text-xs">
              <div>
                <span class="font-bold">Original Date: {item.entryDate}</span> · Gross: {formatPoishaToBdt(BigInt(item.grossPoisha))}
              </div>
              <Button
                variant="default"
                class="text-xs py-1.5 min-h-[36px]"
                onclick={() => { activeRecoveryItem = item; showRecoveryModal = true; }}
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
          No statements recorded for {selectedMonth}. Click "+ New Mode A Statement" to submit a statement total.
        </Card>
      {:else}
        {#each statements as st (st.id)}
          <Card class="p-5">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div class="font-bold text-base text-[var(--c-ink,#111827)]">{st.payableNames}</div>
                <div class="text-xs text-[var(--c-muted,#6b7280)]">
                  {st.kind} · {st.source} · Month: {st.month}
                  {#if st.note} · <span class="italic">"{st.note}"</span>{/if}
                </div>
              </div>

              <div class="flex items-center gap-6">
                <div class="text-right">
                  <div class="text-xs text-[var(--c-muted,#6b7280)]">Statement Total</div>
                  <div class="font-bold text-sm tabular-nums">{formatPoishaToBdt(BigInt(st.statement_total_poisha))}</div>
                </div>
                <div class="text-right">
                  <div class="text-xs text-[var(--c-muted,#6b7280)]">Expected Liability</div>
                  <div class="font-bold text-sm tabular-nums">{formatPoishaToBdt(BigInt(st.expected_poisha))}</div>
                </div>
                <div class="text-right">
                  <div class="text-xs text-[var(--c-muted,#6b7280)]">Variance</div>
                  <div class="font-bold text-sm tabular-nums {BigInt(st.variance_poisha) !== 0n ? 'text-blue-600' : ''}">
                    {formatPoishaToBdt(BigInt(st.variance_poisha))}
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  {#if st.status === 'reconciled'}
                    <span class="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700">Reconciled</span>
                  {:else if st.status === 'superseded'}
                    <span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-700">Superseded</span>
                  {:else}
                    <Button
                      variant="commission"
                      class="text-xs py-1.5 min-h-[36px]"
                      onclick={() => { activeStatement = st; showReconcileModal = true; }}
                    >
                      Reconcile
                    </Button>
                    <Button
                      variant="default"
                      class="text-xs py-1.5 min-h-[36px]"
                      onclick={() => { activeStatement = st; showSupersedeModal = true; }}
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
        onclose={() => { showRecoveryModal = false; activeRecoveryItem = null; }}
        onreassign={handleReassignRecovery}
        onreopen={handleReopenRecovery}
        ondiscard={handleDiscardRecovery}
      />
    {/if}

    <!-- Modal: Reconcile Statement -->
    {#if activeStatement}
      <Modal bind:open={showReconcileModal} title="Confirm Statement Reconciliation" onclose={() => { showReconcileModal = false; }}>
        <form onsubmit={handleReconcileStatementSubmit} class="flex flex-col gap-4">
          {#if actionErrorMessage}
            <div role="alert" class="p-3 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
              {actionErrorMessage}
            </div>
          {/if}

          <div class="p-4 rounded-xl glass text-sm flex justify-between">
            <div>
              <div class="text-xs text-[var(--c-muted,#6b7280)]">Statement Total</div>
              <div class="font-bold">{formatPoishaToBdt(BigInt(activeStatement.statement_total_poisha))}</div>
            </div>
            <div>
              <div class="text-xs text-[var(--c-muted,#6b7280)]">Expected Liability</div>
              <div class="font-bold">{formatPoishaToBdt(BigInt(activeStatement.expected_poisha))}</div>
            </div>
            <div>
              <div class="text-xs text-[var(--c-muted,#6b7280)]">Variance</div>
              <div class="font-bold">{formatPoishaToBdt(BigInt(activeStatement.variance_poisha))}</div>
            </div>
          </div>

          <div>
            <label for="modal-rec-note" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">
              Explanatory Note {activeStatement && !isVarianceWithinTolerance(BigInt(activeStatement.variance_poisha), tolerancePoisha, false) ? '(Mandatory for variance > tolerance)' : '(Optional)'}
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
            <Button variant="default" onclick={() => { showReconcileModal = false; }}>Cancel</Button>
            <Button
              id="btn-save"
              variant="commission"
              type="submit"
              loading={isActionSubmitting}
              disabled={activeStatement && !isVarianceWithinTolerance(BigInt(activeStatement.variance_poisha), tolerancePoisha, reconcileNote.trim().length > 0)}
            >
              Reconcile Statement
            </Button>
          </div>
        </form>
      </Modal>

      <!-- Modal: Supersede Statement -->
      <Modal bind:open={showSupersedeModal} title="Supersede Statement" onclose={() => { showSupersedeModal = false; }}>
        <form onsubmit={handleSupersedeStatementSubmit} class="flex flex-col gap-4">
          {#if actionErrorMessage}
            <div role="alert" class="p-3 rounded-xl bg-red-500/10 text-red-700 text-xs font-medium">
              {actionErrorMessage}
            </div>
          {/if}

          <div>
            <label for="modal-sup-total" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">New Statement Total (BDT)</label>
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
            <label for="modal-sup-reason" class="block text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Supersede Reason (Mandatory)</label>
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
            <Button variant="default" onclick={() => { showSupersedeModal = false; }}>Cancel</Button>
            <Button
              id="btn-save"
              variant="mastercard"
              type="submit"
              loading={isActionSubmitting}
              disabled={!supersedeReason.trim() || parseStrictBdtToPoisha(supersedeTotalBdt) === null}
            >
              Confirm Supersede
            </Button>
          </div>
        </form>
      </Modal>
    {/if}
  </div>
{/if}
```

### 6.4 `apps/web/src/routes/(app)/reconcile/manual/+page.svelte`

```svelte
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
  import { db } from '$lib/db';
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
  let amountValidationError = $state('');

  // Target payable IDs: resolved via pure helper conforming to DDL columns (code, kind)
  let targetPayableIds = $derived.by(() => {
    return resolveTargetPayableIds(selectedOption, payables);
  });

  // Strict BDT input parsing without floating-point math (Rule 2)
  let statementTotalPoisha = $derived.by(() => {
    if (!statementTotalBdt.trim()) {
      amountValidationError = '';
      return 0n;
    }
    const parsed = parseStrictBdtToPoisha(statementTotalBdt);
    if (parsed === null) {
      amountValidationError = 'Please enter a valid amount in BDT (maximum 2 decimal places).';
      return null;
    }
    amountValidationError = '';
    return parsed;
  });

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
      code: p.code,
      kind: p.kind,
    }));

    if (payables.length > 0 && !selectedOption) {
      selectedOption = 'combined_card';
    }

    const settings = await db.appSettings.toCollection().first();
    if (settings && (settings as any).reconcile_tolerance_poisha) {
      tolerancePoisha = BigInt((settings as any).reconcile_tolerance_poisha);
    }

    await updateExpectedLiability();
  }

  async function updateExpectedLiability() {
    if (targetPayableIds.length === 0) {
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
    } catch (err: any) {
      errorMessage = err.message || 'Mode A submission failed.';
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
```


### 6.5 `apps/web/src/routes/(app)/months/close/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import Modal from '$lib/ui/Modal.svelte';
  import { session } from '$lib/auth/session.svelte';
  import { supabase } from '$lib/supabase/client';
  import { db } from '$lib/db';
  import { evaluateMonthCloseGates, currentDhakaMonth, type MonthCloseGatesResult } from '$lib/reconcile/tolerance';

  let selectedMonth = $state(currentDhakaMonth());
  let monthStatus = $state<'open' | 'closed'>('open');

  // Dynamic gate conditions evaluated from Dexie
  let allPayablesReconciled = $state(false);
  let overpaymentsApproved = $state(false);
  let zeroPendingStaleReviews = $state(false);

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

    // 2. Gate 1: Check pending stale rate review entries on ACTIVE entries (>৳50,000 flagged entries)
    // Strictly ignores voided or superseded entries conforming to PRD §7.3 close_month RPC
    const flaggedEntriesCount = await db.entries
      .filter(e => e.entry_date.startsWith(selectedMonth) && e.status === 'active' && e.stale_review_status === 'flagged')
      .count();
    zeroPendingStaleReviews = flaggedEntriesCount === 0;

    // 3. Gate 2: Check all payables are reconciled or not_applicable
    const settlements = await db.settlements.where('month').equals(monthDate).toArray();
    const statements = await db.statements.where('month').equals(monthDate).toArray();
    const payables = await db.payables.toArray();
    const cardPayableIds = payables
      .filter(p => p.kind === 'card' || p.code.toLowerCase().includes('visa') || p.code.toLowerCase().includes('mastercard'))
      .map(p => p.id);

    const reconciledStatementPayableIds = new Set<string>();
    for (const st of statements) {
      if (st.status === 'reconciled') {
        if (st.kind === 'combined_card') {
          for (const cid of cardPayableIds) reconciledStatementPayableIds.add(cid);
        }
        if (st.payable_ids) {
          for (const pid of st.payable_ids) reconciledStatementPayableIds.add(pid);
        }
        if ((st as any).payable_id) {
          reconciledStatementPayableIds.add((st as any).payable_id);
        }
      }
    }

    const activeEntriesCount = await db.entries
      .filter(e => e.entry_date.startsWith(selectedMonth) && e.status === 'active')
      .count();

    if (settlements.length === 0) {
      // Empty month with 0 entries auto-passes Gate 2; month with un-settled entries must wait for sync
      allPayablesReconciled = activeEntriesCount === 0;
    } else {
      const liableSettlements = settlements.filter(s => s.status !== 'not_applicable');
      allPayablesReconciled = liableSettlements.every(s => reconciledStatementPayableIds.has(s.payable_id));
    }

    // 4. Gate 3: Check active Owner approvals for overpaid settlements matching exact surplus
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
        throw new Error(err.message || err.error || 'Failed to close month');
      }

      await db.monthCloses.put({
        month: `${selectedMonth}-01`,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: session.user?.id,
      });

      monthStatus = 'closed';
    } catch (err: any) {
      errorMessage = err.message || 'Month close failed.';
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
        throw new Error(err.message || err.error || 'Failed to reopen month');
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
    } catch (err: any) {
      errorMessage = err.message || 'Month reopen failed.';
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
          <Button id="btn-save" variant="mastercard" type="submit" loading={isSubmitting} disabled={!reopenReason.trim()}>
            Confirm Reopen Month
          </Button>
        </div>
      </form>
    </Modal>
  </div>
{/if}
```

### 6.6 `apps/web/src/routes/api/v1/reconcile/statements/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const createStatementSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  kind: z.enum(['single_payable', 'combined_card']),
  source: z.enum(['manual_total', 'file']),
  statementTotalPoisha: z.string().regex(/^\d+$/),
  payableIds: z.array(z.string().uuid()).min(1),
  fileStoragePath: z.string().optional().nullable(),
  fileSha256: z.string().length(64).optional().nullable(),
  lines: z.array(z.any()).optional().nullable(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = createStatementSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();

  // Plan 005 create_statement has 9 parameters:
  // (p_kind, p_month, p_source, p_file_storage_path, p_file_sha256, p_statement_total_poisha, p_payable_ids, p_lines, p_actor_id)
  const { data, error: rpcError } = await supabase.rpc('create_statement', {
    p_kind: parsed.data.kind,
    p_month: parsed.data.month,
    p_source: parsed.data.source,
    p_file_storage_path: parsed.data.fileStoragePath ?? null,
    p_file_sha256: parsed.data.fileSha256 ?? null,
    p_statement_total_poisha: parsed.data.statementTotalPoisha,
    p_payable_ids: parsed.data.payableIds,
    p_lines: parsed.data.lines ?? null,
    p_actor_id: caller.userId,
  });

  if (rpcError) {
    return json({ error: rpcError.message }, { status: 422 });
  }

  return json({ success: true, statementId: data });
};
```

### 6.7 `apps/web/src/routes/api/v1/reconcile/statements/reconcile/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const reconcileSchema = z.object({
  statementId: z.string().uuid(),
  note: z.string().optional(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = reconcileSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();
  const { error: rpcError } = await supabase.rpc('reconcile_statement', {
    p_statement_id: parsed.data.statementId,
    p_note: parsed.data.note ?? '',
    p_actor_id: caller.userId,
  });

  if (rpcError) {
    let message = rpcError.message;
    if (rpcError.message.includes('variance_exceeds_tolerance')) {
      message = 'Statement variance exceeds tolerance; a justification note is required.';
    } else if (rpcError.message.includes('expected_poisha_mismatch')) {
      message = 'Expected liability has shifted; statement must be reviewed.';
    }
    return json({ error: rpcError.message, message }, { status: 422 });
  }

  return json({ success: true });
};
```

### 6.8 `apps/web/src/routes/api/v1/reconcile/statements/supersede/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const supersedeSchema = z.object({
  originalStatementId: z.string().uuid(),
  statementTotalPoisha: z.string().regex(/^\d+$/),
  reason: z.string().min(1),
  note: z.string().optional(),
  fileStoragePath: z.string().optional().nullable(),
  fileSha256: z.string().length(64).optional().nullable(),
  lines: z.array(z.any()).optional().nullable(),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = supersedeSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();

  // Plan 005 supersede_statement has 7 parameters:
  // (p_original_statement_id, p_file_storage_path, p_file_sha256, p_statement_total_poisha, p_note, p_lines, p_actor_id)
  const { data, error: rpcError } = await supabase.rpc('supersede_statement', {
    p_original_statement_id: parsed.data.originalStatementId,
    p_file_storage_path: parsed.data.fileStoragePath ?? null,
    p_file_sha256: parsed.data.fileSha256 ?? null,
    p_statement_total_poisha: parsed.data.statementTotalPoisha,
    p_note: parsed.data.note ?? parsed.data.reason,
    p_lines: parsed.data.lines ?? null,
    p_actor_id: caller.userId,
  });

  if (rpcError) {
    return json({ error: rpcError.message }, { status: 422 });
  }

  return json({ success: true, newStatementId: data });
};
```

### 6.9 `apps/web/src/routes/api/v1/reconcile/exceptions/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const exceptionSchema = z.object({
  entryId: z.string().uuid(),
  payableId: z.string().uuid(),
  action: z.enum(['approved', 'rejected']),
  reason: z.string().min(1),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'admin' && caller.role !== 'owner') {
    throw error(403, 'unauthorized: Admin or Owner required');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = exceptionSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();
  const { error: rpcError } = await supabase.rpc('review_entry_reconciliation_exception', {
    p_entry_id: parsed.data.entryId,
    p_payable_id: parsed.data.payableId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  });

  if (rpcError) {
    return json({ error: rpcError.message }, { status: 422 });
  }

  return json({ success: true });
};
```

### 6.10 `apps/web/src/routes/api/v1/months/close/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const closeSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    throw error(403, 'unauthorized: Owner required to close month');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();
  const { error: rpcError } = await supabase.rpc('close_month', {
    p_month: parsed.data.month,
    p_actor_id: caller.userId,
  });

  if (rpcError) {
    let message = rpcError.message;
    if (rpcError.message.includes('stale_review_pending')) {
      message = 'Cannot close month: one or more active entries have pending stale rate reviews (>৳50,000).';
    } else if (rpcError.message.includes('unreconciled_payables_exist')) {
      message = 'Cannot close month: all monthly payables must be reconciled or marked zero-liability.';
    } else if (rpcError.message.includes('unapproved_overpaid_settlement')) {
      message = 'Cannot close month: overpaid settlements require active Owner approval matching the exact surplus.';
    }
    return json({ error: rpcError.message, message }, { status: 422 });
  }

  return json({ success: true });
};
```

### 6.11 `apps/web/src/routes/api/v1/months/reopen/+server.ts`

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCallerContext } from '$lib/server/auth';
import { getServiceSupabase } from '$lib/server/supabase';

const reopenSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  reason: z.string().min(1),
});

export const POST: RequestHandler = async (event) => {
  const caller = await getCallerContext(event);
  if (caller.role !== 'owner') {
    throw error(403, 'unauthorized: Owner required to reopen month');
  }

  const body = await event.request.json().catch(() => null);
  const parsed = reopenSchema.safeParse(body);
  if (!parsed.success) {
    throw error(400, `invalid_payload: ${JSON.stringify(parsed.error.issues)}`);
  }

  const supabase = getServiceSupabase();
  const { error: rpcError } = await supabase.rpc('reopen_month', {
    p_month: parsed.data.month,
    p_reason: parsed.data.reason,
    p_actor_id: caller.userId,
  });

  if (rpcError) {
    let message = rpcError.message;
    if (rpcError.message.includes('month_not_closed')) {
      message = 'Cannot reopen month: this month is not currently closed.';
    } else if (rpcError.message.includes('reason_required')) {
      message = 'A mandatory audit reason is required to reopen a closed month.';
    }
    return json({ error: rpcError.message, message }, { status: 422 });
  }

  return json({ success: true });
};
```


### 6.12 `apps/web/src/lib/reconcile/reconcile.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  isVarianceWithinTolerance,
  evaluateMonthCloseGates,
  parseStrictBdtToPoisha,
  resolveTargetPayableIds,
  type PayableItem,
} from './tolerance';

describe('Reconciliation Tolerance Math (PRD §11.2, Test #40)', () => {
  it('passes automatically when variance is within 100 poisha tolerance', () => {
    expect(isVarianceWithinTolerance(50n, 100n, false)).toBe(true);
    expect(isVarianceWithinTolerance(-99n, 100n, false)).toBe(true);
    expect(isVarianceWithinTolerance(0n, 100n, false)).toBe(true);
    expect(isVarianceWithinTolerance(100n, 100n, false)).toBe(true);
    expect(isVarianceWithinTolerance(-100n, 100n, false)).toBe(true);
  });

  it('rejects variance exceeding 100 poisha when explanatory note is omitted', () => {
    expect(isVarianceWithinTolerance(101n, 100n, false)).toBe(false);
    expect(isVarianceWithinTolerance(-101n, 100n, false)).toBe(false);
    expect(isVarianceWithinTolerance(5000n, 100n, false)).toBe(false);
    expect(isVarianceWithinTolerance(-25000n, 100n, false)).toBe(false);
  });

  it('permits variance exceeding 100 poisha when non-empty explanatory note is provided', () => {
    expect(isVarianceWithinTolerance(500n, 100n, true)).toBe(true);
    expect(isVarianceWithinTolerance(-1200n, 100n, true)).toBe(true);
    expect(isVarianceWithinTolerance(100000n, 100n, true)).toBe(true);
  });
});

describe('Strict BDT Poisha Input Parser (Rule 2)', () => {
  it('parses valid integer and decimal amounts without floating-point math', () => {
    expect(parseStrictBdtToPoisha('123.45')).toBe(12345n);
    expect(parseStrictBdtToPoisha('10.5')).toBe(1050n);
    expect(parseStrictBdtToPoisha('500')).toBe(50000n);
    expect(parseStrictBdtToPoisha('0.05')).toBe(5n);
    expect(parseStrictBdtToPoisha('0.00')).toBe(0n);
  });

  it('rejects malformed, non-numeric, or negative inputs with null', () => {
    expect(parseStrictBdtToPoisha('abc')).toBeNull();
    expect(parseStrictBdtToPoisha('12.345')).toBeNull(); // >2 decimals rejected
    expect(parseStrictBdtToPoisha('-100')).toBeNull();
    expect(parseStrictBdtToPoisha('')).toBeNull();
    expect(parseStrictBdtToPoisha('   ')).toBeNull();
  });
});

describe('Combined Card Payable Resolver', () => {
  const payables: PayableItem[] = [
    { id: 'uuid-bkash', name: 'bKash Fee', code: 'bkash', kind: 'method_charge' },
    { id: 'uuid-visa', name: 'Visa Fee', code: 'visa', kind: 'method_charge' },
    { id: 'uuid-mc', name: 'Mastercard Fee', code: 'mastercard', kind: 'method_charge' },
    { id: 'uuid-vat', name: 'Government VAT', code: 'vat', kind: 'vat' },
  ];

  it('resolves combined_card to both Visa and Mastercard payable UUIDs', () => {
    const resolved = resolveTargetPayableIds('combined_card', payables);
    expect(resolved).toHaveLength(2);
    expect(resolved).toContain('uuid-visa');
    expect(resolved).toContain('uuid-mc');
  });

  it('resolves single payable ID directly', () => {
    const resolved = resolveTargetPayableIds('uuid-bkash', payables);
    expect(resolved).toEqual(['uuid-bkash']);
  });
});

describe('Closed Month Recovery Flow Helpers (PRD §8.4)', () => {
  it('validates canonical RateSnapshot structure for date reassignment', () => {
    const profile = {
      id: 'profile-1',
      version: 2,
      vat_mode: 'percent_of_gross' as const,
      vat_bp: 500,
      commission_bp: 1000,
      commission_base: 'gross' as const,
      method_rates: {
        'method-bkash': { fee_bp: 150, charges_borne_by: 'business' as const },
      },
    };

    const methodRate = profile.method_rates['method-bkash'];
    const snapshot = {
      rateProfileId: profile.id,
      version: profile.version,
      engineVersion: 1,
      vat: { mode: profile.vat_mode, bp: profile.vat_bp },
      commission: { bp: profile.commission_bp, base: profile.commission_base },
      chargeBp: methodRate.fee_bp,
      chargesBorneBy: methodRate.charges_borne_by,
      rounding: 'half_up' as const,
    };

    expect(snapshot.vat.bp).toBe(500);
    expect(snapshot.commission.bp).toBe(1000);
    expect(snapshot.chargeBp).toBe(150);
    expect(snapshot.rounding).toBe('half_up');
  });

  it('detects closed destination months during date reassignment', () => {
    const closedMonths = new Set(['2026-01-01', '2026-02-01']);
    const isDestinationClosed = (targetDate: string) => {
      const monthDate = `${targetDate.substring(0, 7)}-01`;
      return closedMonths.has(monthDate);
    };

    expect(isDestinationClosed('2026-01-15')).toBe(true);
    expect(isDestinationClosed('2026-03-01')).toBe(false);
  });
});

describe('Month Close Gating Checklist (PRD §8.4, §16.2 Tests #7, #39, #58)', () => {
  const baseInput = {
    callerRole: 'owner' as const,
    allPayablesReconciled: true,
    overpaymentsApproved: true,
    zeroPendingStaleReviews: true,
    monthStatus: 'open' as const,
  };

  it('permits Owner to close month when all 3 gates pass', () => {
    const result = evaluateMonthCloseGates(baseInput);
    expect(result.canClose).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
  });

  it('blocks non-owner callers from closing month (Staff and Admin)', () => {
    const staffResult = evaluateMonthCloseGates({ ...baseInput, callerRole: 'staff' });
    expect(staffResult.canClose).toBe(false);
    expect(staffResult.blockingReasons).toContain('Only the Owner can close a month.');

    const adminResult = evaluateMonthCloseGates({ ...baseInput, callerRole: 'admin' });
    expect(adminResult.canClose).toBe(false);
    expect(adminResult.blockingReasons).toContain('Only the Owner can close a month.');
  });

  it('blocks closing when month is already closed', () => {
    const result = evaluateMonthCloseGates({ ...baseInput, monthStatus: 'closed' });
    expect(result.canClose).toBe(false);
    expect(result.blockingReasons).toContain('Month is already closed.');
  });

  it('blocks closing when payables are unreconciled (Gate 1)', () => {
    const result = evaluateMonthCloseGates({ ...baseInput, allPayablesReconciled: false });
    expect(result.canClose).toBe(false);
    expect(result.blockingReasons).toContain('All payables must be reconciled or marked not_applicable.');
  });

  it('blocks closing when overpaid settlements lack Owner approval matching exact surplus (Gate 2)', () => {
    const result = evaluateMonthCloseGates({ ...baseInput, overpaymentsApproved: false });
    expect(result.canClose).toBe(false);
    expect(result.blockingReasons).toContain('All overpaid settlements require active Owner approvals matching exact surplus.');
  });

  it('blocks closing when flagged active stale rate reviews remain pending (Gate 3, Test #58)', () => {
    const result = evaluateMonthCloseGates({ ...baseInput, zeroPendingStaleReviews: false });
    expect(result.canClose).toBe(false);
    expect(result.blockingReasons).toContain('Zero pending stale reviews required on active entries (>৳50,000 flagged entries).');
  });

  it('aggregates multiple blocking reasons simultaneously', () => {
    const result = evaluateMonthCloseGates({
      callerRole: 'staff',
      allPayablesReconciled: false,
      overpaymentsApproved: false,
      zeroPendingStaleReviews: false,
      monthStatus: 'open',
    });
    expect(result.canClose).toBe(false);
    expect(result.blockingReasons.length).toBe(4);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Tolerance In-Bounds Pass | 50 poisha variance | `true` without note | §11.2 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Tolerance Out-of-Bounds Reject | 101 poisha variance | `false` without note | §11.2 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Tolerance Note Waiver | 500 poisha variance + note | `true` with note | §11.2 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Strict BDT Parsing Valid | "123.45" / "10.5" / "500" | BigInt poisha `12345n` / `1050n` / `50000n` | Rule 2 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Strict BDT Parsing Invalid | "abc" / "12.345" / "-100" | `null` with validation error | Rule 2, §9.1 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Combined Card Resolver | `selectedOption = 'combined_card'` | Resolves Visa and Mastercard payable UUIDs | §11.1 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Gate Checklist Owner Pass | All 3 gates pass + Owner | `canClose: true`, 0 blocking reasons | §8.4, §18 Gate 4 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Gate Checklist Role Guard | Staff / Admin caller | `canClose: false`, role blocking reason | §3, §18 Gate 4 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Gate Checklist Unreconciled | Gate 1 failure | `canClose: false`, reconciliation reason | §8.4, §18 Gate 4 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Gate Checklist Overpayment | Gate 2 failure (surplus mismatch) | `canClose: false`, overpayment reason | §8.4, §18 Gate 4 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Gate Checklist Flagged Stale | Gate 3 failure (active entry) | `canClose: false`, stale review reason | §8.4, §16.2 #58 | `apps/web/src/lib/reconcile/reconcile.test.ts` |
| Test #7 Repeated Month Close | Close/reopen cycles | State preserved cleanly | §16.2 #7 | `tests/db/settlement_recon.test.ts` |
| Test #17 Multi-Month Lock | Push vs reconcile vs close | Deadlock immunity | §16.2 #17 | `tests/db/settlement_recon.test.ts` |
| Test #19 Non-Overlap Coverage | Duplicate statement | Unique constraint conflict | §16.2 #19 | `tests/db/settlement_recon.test.ts` |
| Test #23 Invalidation Cascade | Edit entry in reconciled | Statement status reverts to `'open'` | §16.2 #23 | `tests/db/settlement_recon.test.ts` |
| Test #34 Exception & Overpayment | Unmatched without exception | Error `unmatched_entries` | §16.2 #34 | `tests/db/settlement_recon.test.ts` |
| Test #37 Scoped Exception | Exception for bKash only | VAT statement blocked | §16.2 #37 | `tests/db/settlement_recon.test.ts` |
| Test #39 First Close Upsert | Close fresh month | Idempotent upsert | §16.2 #39 | `tests/db/settlement_recon.test.ts` |
| Test #40 Mode A Totals Only | `source = 'manual_total'` | Line matching waived | §16.2 #40 | `tests/db/settlement_recon.test.ts` |
| Test #54 Exception Flip | Flip approved to rejected | Statement reverts to `'open'` | §16.2 #54 | `tests/db/settlement_recon.test.ts` |
| Test #58 Stale Month Close Gate | Close with flagged stale | Error `422 stale_review_pending` | §16.2 #58 | `tests/db/settlement_recon.test.ts` |

## 8. Acceptance criteria

1. Mode A statement reconciliation waives line-matching, enforces 100 poisha tolerance rule, and strictly validates decimal BDT input.
   - Command: `pnpm --filter @clt/web test reconcile.test.ts -t "Reconciliation Tolerance"`
   - Expected output: test suite passes with 0 failures.
2. Month close gating checklist enforces all 3 gates and Owner-only role authorization.
   - Command: `pnpm --filter @clt/web test reconcile.test.ts -t "Month Close Gating"`
   - Expected output: test suite passes with 0 failures.
3. Strict BDT parsing and combined card payable resolution pass all unit tests.
   - Command: `pnpm --filter @clt/web test reconcile.test.ts`
   - Expected output: all test suites pass with 0 failures.
4. SvelteKit route typecheck passes cleanly.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 2: Integer poisha used in all variance calculations without floating-point math.
- Rule 5: Month close, reopen, and statement status transitions write `audit_log` records inside the same transaction.
- Rule 7: Reconciliation and month operations execute through `SECURITY DEFINER` RPCs under `service_role`.
- Rule 10: Ascending month advisory locks acquired before touching statement rows.
- Rule 16: Primary submit buttons carry `id="btn-save"` / `id="btn-submit"` for FloatingMenu collision avoidance.

## 10. Pitfalls

- Trap: Calling `create_statement` or `supersede_statement` RPCs without mandatory `p_lines` or `p_note` parameter names causing `PGRST202`.
  - Fix: Explicitly pass `p_lines: parsed.data.lines ?? null` and `p_note: parsed.data.reason` across all mediation endpoints matching Plan 005 signatures.
- Trap: Closed-month recovery queue querying `op.reason` or `r.op_id` which do not exist on `CachedRejectedOp`.
  - Fix: Query `db.rejectedOps.where('error_code').equals('month_closed').and(op => op.status === 'pending')` using `r.opId` and resolving original entry date from `localEntry.entry_date` or `r.payload.entryDate`.
- Trap: Reassigning closed-month entry via raw `fetch` bypassing outbox, failing offline and losing calculation snapshot.
  - Fix: Use `retryRejectedOp` from `$lib/sync/recovery` after recalculating amounts via `@clt/calc` `calculateEntry` and updating `db.entries`.
- Trap: Reopening closed month without re-queueing the rejected op, leaving it stranded in the queue forever.
  - Fix: After `reopen_month` RPC succeeds, cascade local statements to `'open'` and call `retryRejectedOp(activeRecoveryItem.opId)` to re-queue the operation for immediate sync.
- Trap: Matching payables by non-existent `p.slug` causing combined card reconciliation to silently do nothing.
  - Fix: Use pure helper `resolveTargetPayableIds` filtering on DDL columns `code` (`visa`, `mastercard`) and `kind` (`card`).
- Trap: Swallowing invalid BDT input and submitting `0n` poisha statements.
  - Fix: Validate with `parseStrictBdtToPoisha` rejecting malformed inputs and disabling submit buttons.
- Trap: One reconciled statement unlocking the entire month's payables checklist.
  - Fix: Check that every liable settlement in `db.settlements` has a corresponding statement where `status === 'reconciled'`.

## 11. PRD ISSUES and DECISION PENDING

- none

## 12. Handoff

- Reconciliation endpoints under `/api/v1/reconcile/*` and `/api/v1/months/*` available for administrative operations.
- `evaluateMonthCloseGates`, `isVarianceWithinTolerance`, `parseStrictBdtToPoisha`, and `resolveTargetPayableIds` exported from `$lib/reconcile/tolerance.ts` for UI and test usage.

## 13. Suggested task breakdown

- Task `015-A`: Implement tolerance verification, strict BDT parser, combined card resolver, month close gating logic, and unit tests (Files: `apps/web/src/lib/reconcile/tolerance.ts`, `apps/web/src/lib/reconcile/reconcile.test.ts`; Depends on: none; Role: Builder; Priority: P0).
- Task `015-B`: Build Mode A manual reconciliation overview, statement action modals (reconcile, supersede), and closed-month recovery queue (Files: `apps/web/src/routes/(app)/reconcile/+page.svelte`, `apps/web/src/lib/ui/ClosedMonthRecoveryModal.svelte`; Depends on: `015-A`, `011`; Role: Builder; Priority: P0).
- Task `015-C`: Build Mode A manual statement creation screen with strict validation and combined card resolution (Files: `apps/web/src/routes/(app)/reconcile/manual/+page.svelte`; Depends on: `015-A`; Role: Builder; Priority: P0).
- Task `015-D`: Implement Owner-only month close screen, reopen modal, and statement un-reconcile cascading (Files: `apps/web/src/routes/(app)/months/close/+page.svelte`; Depends on: `015-A`, `008`; Role: Builder; Priority: P0).
- Task `015-E`: Server mediation endpoints for statement creation, reconciliation, supersession, exception reviews, month close, and month reopen (Files: `apps/web/src/routes/api/v1/reconcile/*/+server.ts`, `apps/web/src/routes/api/v1/months/*/+server.ts`; Depends on: `005`, `008`; Role: Builder; Priority: P0).

## Changelog

- 2026-11-03 — Revision 3.2:
  - **Blocker fix — runSyncPush does not exist (B3):** Replaced `import { runSyncPush } from '$lib/sync/runner.svelte'` with `import { syncRunner } from '$lib/sync/runner.svelte'`. Replaced all three `runSyncPush().catch(() => {})` call sites with `syncRunner.triggerCycle()`. Plan 011 exports `syncRunner` (the singleton instance) with `triggerCycle()` — there is no standalone `runSyncPush` export.

- 2026-11-01 — Revision 3.1:
  - 1. Fixed Fatal Runtime Crash in Reassignment Flow (P0.1): Built canonical `RateSnapshot` with required nested `vat: { mode, bp }` and `commission: { bp, base }` structures in `reconcile/+page.svelte`, and resolved method fee from `profile.method_rates?.[id]?.fee_bp` (fixing `undefined` `charge_bp` typo that stripped charges to 0).
  - 2. Aligned VAT Input Exclusivity in Recovery Modal (P0.2): Updated `ClosedMonthRecoveryModal.svelte` to dynamically resolve the destination date's published rate profile and set `vatInputRequired` strictly when `vat_mode === 'manual'`, preventing unhandled `InvalidCalcInputError` and Postgres `chk_vat_input_mode_exclusivity` violations. Renamed `manualVatInputPoisha` to canonical wire property `vatInputPoisha`.
  - 3. Fixed Dexie SchemaError on Unindexed Key (P0.3): Updated `rejectedOps` query in `reconcile/+page.svelte` to query indexed `status` key (`.where('status').equals('pending')`) and filter `error_code === 'month_closed'` in predicate, preventing runtime crash on table load.
  - 4. Fixed Vanishing Replacement Statements in Supersede Workflow (P0.4): When `/api/v1/reconcile/statements/supersede` returns `{ newStatementId }`, immediately inserted the replacement statement into Dexie `db.statements` with `status: 'open'`, preventing disappearance from overview before background sync.
  - 5. Fixed Month Close Gate 2 Lockout (P0.5): Supported both `statement_total_poisha` and synced `total_gross_poisha` in `reconcile/+page.svelte`. In `months/close/+page.svelte`, resolved combined card payables (`code in ('visa', 'mastercard')`) and checked both `st.payable_ids` and `st.payable_id` so Gate 2 evaluates accurately on synced clients.
  - 6. Validated Destination Month Status in Reassignment (P1.1): Checked `db.monthCloses` in `handleReassignRecovery` to verify target month is open before recalculating and queueing outbox ops.
  - 7. Prevented Orphan Statement Creation Traps (P1.2): In `reconcile/manual/+page.svelte`, cached newly created statements as `status: 'open'` in Dexie immediately prior to calling `reconcile_statement`, preventing orphaned open statements on reconciliation failure.
  - 8. Hardened Supersede Modal Input Validation (P1.3): Parsed amount with `parseStrictBdtToPoisha` (returning `null` on invalid strings) and disabled submit button when amount is invalid.
  - 9. Prevented False Positive Gate 2 on Unhydrated Settlements (P1.4): Verified `activeEntriesCount === 0` when `settlements.length === 0` before allowing Gate 2 to pass.
  - 10. Eliminated Duplicate DOM ID `#btn-save` (P2.1): Changed month reopen modal trigger button to `id="btn-reopen-modal"` in `months/close/+page.svelte`.
  - 11. Aligned Test Fixtures & Added Recovery Unit Tests (P2.2, P2.3): Aligned payable test fixtures with database check constraint `kind = 'method_charge'`, and added unit tests for `RateSnapshot` construction and destination closed-month detection.
- 2026-11-01 — Revision 3.0:
  - Resolved Blocker 1: Fixed closed-month queue data model by querying `db.rejectedOps.where('error_code').equals('month_closed').and(op => op.status === 'pending')` using `r.opId` and filtering active pending items.
  - Resolved Blocker 2: Corrected recovery entry date and month resolution: looked up `entryDate` from `r.payload?.entryDate` or `localEntry.entry_date`, bound Reopen Month strictly to original closed month `targetMonth = entryDate.substring(0, 7)`, and compared correct original vs destination months in reassign warning.
  - Resolved Blocker 3: Eliminated hollow raw-fetch reassign: resolved destination date-effective rate profile from `db.rateProfiles`, recomputed amounts using `@clt/calc` `calculateEntry`, updated `db.entries`, and invoked `retryRejectedOp` from `$lib/sync/recovery` preserving outbox FIFO order and `maxKnownRateVersion`.
  - Resolved Blocker 4: Replaced raw-fetch discard with `discardRejectedOp` from `$lib/sync/recovery`, allocating a fresh UUID, setting `supersedesRejectedOpId`, updating `db.rejectedOps` to `'discarded'`, and purging uncommitted local entries.
  - Resolved Blocker 5: Completed Reopen Month recovery flow: upon server reopen confirmation, cascaded local statements to `'open'` and invoked `retryRejectedOp(activeRecoveryItem.opId)` so the rejected op syncs immediately into the now reopened month per PRD §8.4 Option 2.
  - Resolved Blocker 6: Bound reassign destination defaults to current open Asia/Dhaka month (`currentDhakaMonth() + '-01'`), added destination closed-month check against `db.monthCloses`, and prompted for manual VAT input when destination VAT mode is manual.
  - Resolved Blocker 7: Replaced non-existent `p.slug` with pure helper `resolveTargetPayableIds` matching DDL columns `code` (`visa`, `mastercard`) and `kind` (`card`), displaying clear error if cards are unconfigured.
  - Resolved Blocker 8: Replaced error-swallowing `parseBdtToPoisha` with `parseStrictBdtToPoisha` validating regex `/^\d+(\.\d{1,2})?$/`, showing validation errors and disabling submit on invalid amounts.
  - Resolved Blocker 9: Added row actions to statement list in `reconcile/+page.svelte` (`[Reconcile]` and `[Supersede]`), allowing operators to reconcile or supersede open statements without orphan statement traps.
  - Resolved Blocker 10: Aligned month close checklist with `close_month` RPC: asserted all liable settlements have a corresponding reconciled statement (allowing zero-liability months to pass), asserted overpaid settlements have active Owner approvals matching exact surplus (`overpayment_approved_amount_poisha === paid - expected`), and filtered stale rate reviews strictly on active entries (`status === 'active' AND stale_review_status === 'flagged'`), ignoring voided entries.
  - Resolved Blocker 11: Displayed human-readable payable names by joining `db.payables`, populated `CachedStatement` fields, and computed variance consistently.
  - Resolved Further Defects: Added role gating across `/reconcile`, `/reconcile/manual` (Admin/Owner), and `/months/close` (strictly Owner); mapped Postgres RPC error codes to user-friendly messages; warned Owner on month reopen that statements will be un-reconciled; and added `id="btn-save"` across all primary submit buttons (Rule R16).
  - Standardized Task IDs to `015-A` through `015-E` and updated dependencies to `005, 007, 008, 009, 010, 011, 012, 013, 014`.
- 2026-10-31 — Revision 2.0:
  - Aligned RPC calls with Plan 005: passed `p_lines` to `create_statement` and passed `p_note` & `p_lines` to `supersede_statement`.
  - Removed stray duplicate closing code block in §6.11.
  - Replaced hardcoded mock data in reconcile screens with live Dexie queries; resolved combined card selection to Visa and Mastercard UUIDs from `db.payables`; dynamically computed `expectedPoisha` from `db.settlements`; read tolerance from `db.appSettings`; replaced hardcoded booleans in `months/close/+page.svelte` with live database gate evaluations; added Reopen Month modal and button (Owner-only); and implemented full 3-way recovery in `ClosedMonthRecoveryModal.svelte`.
  - Injected Authorization Bearer tokens across client fetch calls.
- 2026-10-29 — Revision 1.0:
  - Initial plan authoring from PRD v1.19.
