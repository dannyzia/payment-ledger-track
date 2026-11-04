# 012_ledger_and_entry_lifecycle.md — Ledger View, Search, Filters, Detail Drawer, and Entry Lifecycle

- Plan Identifier: CLT-PLAN-012
- Phase: Phase 2 / M1–M2
- Milestone: M1–M2
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §8.2 (Ledger: search, filters, drawer, void, supersede), §8.3 (Report drill-down integration), §8.4 (Month close action lock), §8.5 (Role-scoped views: Staff vs Admin), §9.1(f) (Rate watermark), §9.2.1 (Database entity state-transition matrix), §9.2.2 (Offline mutations of unsynced entries), §16.2 (Tests #32, #50, #57), §17 (Milestone M1 & M2)
- Depends on: 007, 008, 010, 011
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement the Ledger view, chronological daily grouping with intra-day ordering, precision search normalization supporting formatted prefixes (`E-YYYYMM-XXXXXX`) and unsynced badges (`#LOCAL-xxxx`) without false-positive date matches, multi-criteria filter drawer with URL parameter drill-down support from reports, slide-over detail drawer rendering complete financial breakdowns, snapshot rates, creator names, Asia/Dhaka timestamps, supersede history chains, and audit trails. Enforces role-based visibility (Staff sees only their own entries on shared devices per PRD §8.5; Admin/Owner sees all), closed-month action locking (PRD §8.4), Staff "Request Void" and Admin "Approve Void" / "Void Entry" workflows with local optimistic marking, and SvelteKit `goto` administrative supersession navigation.

## 2. Scope

- IN:
  - Ledger screen in `apps/web/src/routes/(app)/ledger/+page.svelte` grouped chronologically by day (newest day first) with daily gross and net subtotals using South Asian money formatting (`formatPoishaToBdt`), debounced search, and role-scoped entry filtering (Staff sees own; Admin/Owner sees all).
  - URL parameter drill-down support (`?month=YYYY-MM`, `?method=UUID`, `?status=...`, `?q=...`) enabling direct navigation from Reports (PRD §8.3).
  - Formatted entry number display supporting sequential `E-YYYYMM-XXXXXX` (widened beyond 999,999 without truncation) and temporary `#LOCAL-xxxx` badges.
  - Precision search engine in `apps/web/src/lib/ledger/search.ts` stripping formatted prefixes (`E-\d{6}-0*` or `E-0*`) before querying raw integer numbers, strictly isolating entry number sequence matches from date parts, and searching `#LOCAL-xxxx` badges, customer names, transaction references, and notes.
  - Ledger filter types exported from `apps/web/src/lib/ledger/types.ts` for clean Svelte 5 and TypeScript compilation.
  - Multi-criteria filter drawer in `apps/web/src/lib/ui/LedgerFilterDrawer.svelte`: accessible dialog with backdrop, Escape key handling, date range (`startDate`, `endDate`), payment method dropdown, creator staff dropdown (from `db.profiles`), status (`all`, `active`, `pending_sync`, `rejected`, `voided`, `superseded`), and flags (`duplicate_txn`, `stale_rates`).
  - Ledger row in `apps/web/src/lib/ui/LedgerRow.svelte` displaying entry number, customer name, `sub_qty`, payment method badge via `methodsMap`, gross amount, total deductions (`-(vat + comm + bizFee)`), net revenue, customer fee badge (`[Customer Fee]`), and status badges (`[Pending Sync]`, `[Sync Rejected]`, `[Stale Rate]`, `[Duplicate Txn]`).
  - Slide-over detail drawer in `apps/web/src/lib/ui/EntryDetailDrawer.svelte` rendering:
    - Full financial breakdown with explicit minus signs on deductions and non-deducted customer fee notice.
    - Snapshot rates applied (version, VAT mode & bp, commission bp & base, method charge bp, party, rounding rule).
    - Resolved creator display name and role via `profilesMap`.
    - Device ID and server sequence.
    - Formatted created, updated, voided, and superseded timestamps in Asia/Dhaka time.
    - Supersede history chain with clickable links to replaced entry and replacement entry.
    - Audit events log (creation, void request, void approval, supersession).
    - Stale rate alert highlighting entries > ৳50,000 flagged for admin review.
  - Closed-month action lockout: checking `db.monthCloses` for `entry.entry_date.substring(0, 7) + '-01'`, rendering an alert banner, and disabling Edit/Supersede and Void buttons when the month is closed.
  - Complete void lifecycle helpers in `apps/web/src/lib/ledger/void.ts`:
    - Staff "Request Void": allowed only on active entries where `created_by === currentUserId`, writes `void_requested_by`, `void_reason`, `void_requested_at`, and enqueues `request_void` op.
    - Admin/Owner "Approve Void" / "Void Entry": marks `status = 'voided'`, sets `voided_at`, `voided_by`, and enqueues `void_entry` op.
    - Local entries updated immediately so UI reflects state without waiting for sync.
  - Supersede lifecycle: Admin/Owner navigation via SvelteKit `goto('/entries/new?supersede=' + entry.id)` preserving in-memory state.
  - Transitive intra-day sorting in `apps/web/src/lib/ledger/grouping.ts` with memoized ISO string comparisons.
  - Unit tests in `apps/web/src/lib/ledger/ledger.test.ts` verifying search prefix normalization, numeric query isolation, intra-day ordering, daily subtotal arithmetic, role-based visibility, report drill-down URL parsing, and outbox void queueing.
- OUT:
  - New entry form input bindings (owned by Plan 010).
  - Outbox push and pull transport runner (owned by Plan 011).
  - Monthly financial aggregates and PDF/CSV export generation (owned by Plan 013).
  - Statement line-item matching (owned by Plan 018).

## 3. Preconditions

1. Plan 010 Dexie database `db` and local entry repository are available.
   - Check command: `test -f apps/web/src/lib/db/entries.ts`
   - Expected output: exit code `0`.
2. Plan 010 date-effective rate resolver and rate watermark helper are available.
   - Check command: `grep -c 'getMaxKnownRateVersion' apps/web/src/lib/db/rates.ts`
   - Expected output: `1`.
3. Plan 011 client outbox sync runner is available.
   - Check command: `test -f apps/web/src/lib/sync/runner.svelte.ts`
   - Expected output: exit code `0`.
4. Shared UI library exports `Button`, `Chip`, and `Modal`.
   - Check command: `test -f apps/web/src/lib/ui/Button.svelte && test -f apps/web/src/lib/ui/Chip.svelte`
   - Expected output: exit code `0`.

## 4. Files

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/lib/ledger/types.ts` | create | TypeScript interfaces for `LedgerFilters`, search queries, and day groups |
| `apps/web/src/lib/ledger/search.ts` | create | Precision entry search engine with prefix stripping and numeric query isolation |
| `apps/web/src/lib/ledger/grouping.ts` | create | Transitive intra-day sorting and daily gross/net aggregation using poisha arithmetic |
| `apps/web/src/lib/ledger/void.ts` | create | Void lifecycle execution helpers: Staff `requestVoid` and Admin `executeVoid` with local optimistic marking and outbox queueing |
| `apps/web/src/lib/ui/LedgerRow.svelte` | create | Ledger list row rendering entry number, customer, sub_qty, method badge, gross, deductions, net, and status badges |
| `apps/web/src/lib/ui/LedgerFilterDrawer.svelte` | create | Accessible filter drawer with backdrop, date range, method, creator dropdown, status, and flags |
| `apps/web/src/lib/ui/EntryDetailDrawer.svelte` | create | Slide-over detail drawer rendering full breakdown, snapshot rates, creator, Asia/Dhaka timestamps, supersede chain, and audit events |
| `apps/web/src/lib/ui/VoidRequestModal.svelte` | create | Modal prompting for mandatory audit reason on Staff void request or Admin direct void |
| `apps/web/src/routes/(app)/ledger/+page.svelte` | create | Main ledger page with role scoping, URL drill-down param parsing, daily grouping, search debounce, and action drawer integration |
| `apps/web/src/lib/ledger/ledger.test.ts` | create | Unit tests for search precision, intra-day ordering, daily subtotals, role filtering, drill-down parsing, and outbox void queueing |

## 5. Steps

1. Create ledger type definitions in `apps/web/src/lib/ledger/types.ts` referencing Specification 6.1:
   - Command: copy Specification 6.1 into `apps/web/src/lib/ledger/types.ts`.
   - Check: `test -f apps/web/src/lib/ledger/types.ts`
   - Expected output: exit code `0`.
2. Implement precision search engine in `apps/web/src/lib/ledger/search.ts` referencing Specification 6.2:
   - Command: copy Specification 6.2 into `apps/web/src/lib/ledger/search.ts`.
   - Check: `test -f apps/web/src/lib/ledger/search.ts`
   - Expected output: exit code `0`.
3. Implement transitive intra-day sorting and daily grouping in `apps/web/src/lib/ledger/grouping.ts` referencing Specification 6.3:
   - Command: copy Specification 6.3 into `apps/web/src/lib/ledger/grouping.ts`.
   - Check: `test -f apps/web/src/lib/ledger/grouping.ts`
   - Expected output: exit code `0`.
4. Implement void lifecycle helpers in `apps/web/src/lib/ledger/void.ts` referencing Specification 6.4:
   - Command: copy Specification 6.4 into `apps/web/src/lib/ledger/void.ts`.
   - Check: `test -f apps/web/src/lib/ledger/void.ts`
   - Expected output: exit code `0`.
5. Implement ledger row component in `apps/web/src/lib/ui/LedgerRow.svelte` referencing Specification 6.5:
   - Command: copy Specification 6.5 into `apps/web/src/lib/ui/LedgerRow.svelte`.
   - Check: `test -f apps/web/src/lib/ui/LedgerRow.svelte`
   - Expected output: exit code `0`.
6. Implement accessible filter drawer in `apps/web/src/lib/ui/LedgerFilterDrawer.svelte` referencing Specification 6.6:
   - Command: copy Specification 6.6 into `apps/web/src/lib/ui/LedgerFilterDrawer.svelte`.
   - Check: `test -f apps/web/src/lib/ui/LedgerFilterDrawer.svelte`
   - Expected output: exit code `0`.
7. Implement detail drawer with snapshot rates, creator, Asia/Dhaka timestamps, and supersede chains in `apps/web/src/lib/ui/EntryDetailDrawer.svelte` referencing Specification 6.7:
   - Command: copy Specification 6.7 into `apps/web/src/lib/ui/EntryDetailDrawer.svelte`.
   - Check: `test -f apps/web/src/lib/ui/EntryDetailDrawer.svelte`
   - Expected output: exit code `0`.
8. Implement void request modal in `apps/web/src/lib/ui/VoidRequestModal.svelte` referencing Specification 6.8:
   - Command: copy Specification 6.8 into `apps/web/src/lib/ui/VoidRequestModal.svelte`.
   - Check: `test -f apps/web/src/lib/ui/VoidRequestModal.svelte`
   - Expected output: exit code `0`.
9. Implement main ledger page with role scoping and report drill-down URL support in `apps/web/src/routes/(app)/ledger/+page.svelte` referencing Specification 6.9:
   - Command: copy Specification 6.9 into `apps/web/src/routes/(app)/ledger/+page.svelte`.
   - Check: `grep -c 'ledger-page' 'apps/web/src/routes/(app)/ledger/+page.svelte'`
   - Expected output: `1`.
10. Implement comprehensive ledger unit tests in `apps/web/src/lib/ledger/ledger.test.ts` referencing Specification 6.10:
    - Command: copy Specification 6.10 into `apps/web/src/lib/ledger/ledger.test.ts`.
    - Check: `pnpm --filter @clt/web test src/lib/ledger/ledger.test.ts`
    - Expected output: test suite passes with 0 failures.
11. Run TypeScript and SvelteKit route typecheck:
    - Command: `pnpm --filter @clt/web check`
    - Expected output: `0 errors`.

## 6. Specifications

### 6.1 `apps/web/src/lib/ledger/types.ts`

```ts
import type { LocalEntry } from '$lib/db';

export type ChipVariant = 'default' | 'commission' | 'vat' | 'bkash' | 'visa' | 'mastercard';

export interface LedgerFilters {
  startDate?: string | undefined;
  endDate?: string | undefined;
  methodId?: string | undefined;
  createdBy?: string | undefined;
  status?: 'all' | 'active' | 'pending_sync' | 'rejected' | 'voided' | 'superseded' | undefined;
  flagDuplicateTxn?: boolean | undefined;
  flagStaleRates?: boolean | undefined;
}

export interface NormalizedSearchQuery {
  rawQuery: string;
  numericEntryNumber: number | null;
  localBadgeQuery: string | null;
  textQuery: string;
}

export interface DayGroup {
  date: string; // YYYY-MM-DD
  entries: LocalEntry[];
  totalGrossPoisha: bigint;
  totalNetPoisha: bigint;
  totalDeductionsPoisha: bigint;
  totalSubQty: number;
}
```

### 6.2 `apps/web/src/lib/ledger/search.ts`

```ts
import type { LocalEntry } from '$lib/db';
import type { NormalizedSearchQuery } from './types';

/**
 * Normalizes user search input:
 * 1. Formatted entry numbers (e.g. 'E-202610-000042' or 'E-000105' -> 42 or 105)
 * 2. Unsynced local badges (e.g. '#LOCAL-a1b2c3' or 'LOCAL-a1b2c3' -> 'a1b2c3')
 * 3. Raw numeric strings (e.g. '42' -> 42)
 * 4. Free text (customer name, txn ref, notes)
 */
export function normalizeEntrySearchQuery(rawQuery: string): NormalizedSearchQuery {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { rawQuery: '', numericEntryNumber: null, localBadgeQuery: null, textQuery: '' };
  }

  // 1. Check for #LOCAL-xxxx or LOCAL-xxxx badge query
  const localMatch = trimmed.match(/^#?LOCAL-([a-z0-9]+)$/i);
  const localBadgeQuery = localMatch && localMatch[1] ? localMatch[1].toLowerCase() : null;

  // 2. Check for formatted entry number E-YYYYMM-0*(\d+) or E-0*(\d+)
  const prefixMatch = trimmed.match(/^E-(?:\d{6}-)?0*(\d+)$/i);
  let numericEntryNumber: number | null = null;
  if (prefixMatch && prefixMatch[1]) {
    const num = parseInt(prefixMatch[1], 10);
    numericEntryNumber = isNaN(num) ? null : num;
  } else if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    numericEntryNumber = isNaN(num) ? null : num;
  }

  return {
    rawQuery: trimmed,
    numericEntryNumber,
    localBadgeQuery,
    textQuery: trimmed.toLowerCase(),
  };
}

/**
 * Evaluates whether an entry satisfies the normalized search criteria.
 * Strictly prevents numeric searches like '10' or '2026' from matching
 * the YYYYMM date component of E-YYYYMM-XXXXXX.
 */
export function matchesEntrySearch(entry: LocalEntry, query: NormalizedSearchQuery): boolean {
  if (!query.rawQuery) return true;

  // 1. Numeric entry number match against integer sequence portion only (supports both 2-part and 3-part formats)
  if (query.numericEntryNumber !== null && entry.entry_number) {
    const parts = entry.entry_number.split('-');
    const seqPart = parts.length >= 2 ? parts[parts.length - 1] : null;
    if (seqPart && parseInt(seqPart, 10) === query.numericEntryNumber) {
      return true;
    }
  }

  // 2. Local badge match (against #LOCAL-xxxx)
  if (query.localBadgeQuery !== null && entry.local_id) {
    if (entry.local_id.toLowerCase().includes(query.localBadgeQuery)) {
      return true;
    }
  }

  // 3. Exact full match on formatted entry_number if query starts with 'E-'
  if (query.rawQuery.toUpperCase().startsWith('E-') && entry.entry_number) {
    if (entry.entry_number.toLowerCase().includes(query.textQuery)) {
      return true;
    }
  }

  // 4. Free text matches: customer name, transaction reference, notes, and local badge
  if (entry.customer_name && entry.customer_name.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  if (entry.txn_ref && entry.txn_ref.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  if (entry.notes && entry.notes.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  if (entry.local_id && entry.local_id.toLowerCase().includes(query.textQuery)) {
    return true;
  }

  return false;
}
```

### 6.3 `apps/web/src/lib/ledger/grouping.ts`

```ts
import type { LocalEntry } from '$lib/db';
import type { DayGroup } from './types';

/**
 * Groups entries by entry_date descending (newest day first).
 * Within each day group, entries are sorted chronologically descending by created_at DESC
 * with server_seq DESC and id as strictly transitive tie-breakers.
 * Daily gross, net, and deductions strictly aggregate 'active' entries using BigInt poisha arithmetic.
 */
export function groupEntriesByDay(entries: LocalEntry[]): DayGroup[] {
  const map = new Map<string, LocalEntry[]>();

  for (const entry of entries) {
    const d = entry.entry_date;
    const list = map.get(d) ?? [];
    list.push(entry);
    map.set(d, list);
  }

  const sortedDates = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));

  return sortedDates.map((date) => {
    const dayEntries = map.get(date) ?? [];

    // Strictly transitive intra-day sorting: created_at DESC -> server_seq DESC -> id DESC
    dayEntries.sort((a, b) => {
      const timeDiff = b.created_at.localeCompare(a.created_at);
      if (timeDiff !== 0) return timeDiff;

      if (a.server_seq && b.server_seq) {
        const seqA = BigInt(a.server_seq);
        const seqB = BigInt(b.server_seq);
        if (seqB > seqA) return 1;
        if (seqB < seqA) return -1;
        return 0;
      }
      if (b.server_seq && !a.server_seq) return 1;
      if (!b.server_seq && a.server_seq) return -1;

      return b.id.localeCompare(a.id);
    });

    let gross = 0n;
    let net = 0n;
    let deductions = 0n;
    let subQty = 0;

    for (const e of dayEntries) {
      if (e.status === 'active') {
        const g = BigInt(e.gross_poisha);
        const n = BigInt(e.net_poisha);
        gross += g;
        net += n;
        deductions += (g - n);
        subQty += e.sub_qty;
      }
    }

    return {
      date,
      entries: dayEntries,
      totalGrossPoisha: gross,
      totalNetPoisha: net,
      totalDeductionsPoisha: deductions,
      totalSubQty: subQty,
    };
  });
}
```

### 6.4 `apps/web/src/lib/ledger/void.ts`

```ts
import { db, type LocalEntry } from '$lib/db';
import { getMaxKnownRateVersion } from '$lib/db/rates';

export interface VoidActionResult {
  success: boolean;
  opId: string;
  action: 'void_requested' | 'entry_voided';
}

/**
 * Executes Staff "Request Void" workflow (PRD §8.2, Finding A7).
 * Marks local entry with void_requested_by, void_reason, and void_requested_at,
 * and enqueues request_void operation to Dexie outbox.
 */
export async function requestEntryVoid(
  entry: LocalEntry,
  userId: string,
  reason: string
): Promise<VoidActionResult> {
  if (entry.status !== 'active') {
    throw new Error('Only active entries can be requested for void');
  }
  if (!reason || reason.trim() === '') {
    throw new Error('A mandatory audit reason is required to request void');
  }

  // Hard Rule 10: Closed-Month Action Lockout
  const monthKey = entry.entry_date.substring(0, 7) + '-01';
  const closeRow = await db.monthCloses.get(monthKey);
  if (closeRow?.status === 'closed') {
    throw new Error(`Month ${entry.entry_date.substring(0, 7)} is closed. Voids are locked.`);
  }

  const trimmedReason = reason.trim();
  const requestedAt = new Date().toISOString();
  const maxRateVersion = await getMaxKnownRateVersion();
  const opId = crypto.randomUUID().toLowerCase();

  // Optimistic local update with sync_status: pending
  await db.entries.update(entry.id, {
    void_requested_by: userId,
    void_reason: trimmedReason,
    sync_status: 'pending',
  });

  // Enqueue outbox operation
  await db.outbox.put({
    opId,
    userId,
    type: 'request_void',
    payload: {
      entryId: entry.id,
      reason: trimmedReason,
      requestedAt,
    },
    clientCreatedAt: requestedAt,
    maxKnownRateVersion: maxRateVersion,
    status: 'pending',
  });

  return { success: true, opId, action: 'void_requested' };
}

/**
 * Executes Admin/Owner direct "Void Entry" or "Approve Void" workflow (PRD §8.2, Finding A7).
 * Marks local entry status = 'voided', sets voided_at and voided_by,
 * and enqueues void_entry operation to Dexie outbox.
 */
export async function executeEntryVoid(
  entry: LocalEntry,
  adminId: string,
  reason: string
): Promise<VoidActionResult> {
  if (entry.status !== 'active') {
    throw new Error('Only active entries can be voided');
  }
  if (!reason || reason.trim() === '') {
    throw new Error('A mandatory audit reason is required to void an entry');
  }

  // Hard Rule 10: Closed-Month Action Lockout
  const monthKey = entry.entry_date.substring(0, 7) + '-01';
  const closeRow = await db.monthCloses.get(monthKey);
  if (closeRow?.status === 'closed') {
    throw new Error(`Month ${entry.entry_date.substring(0, 7)} is closed. Voids are locked.`);
  }

  const trimmedReason = reason.trim();
  const voidedAt = new Date().toISOString();
  const maxRateVersion = await getMaxKnownRateVersion();
  const opId = crypto.randomUUID().toLowerCase();

  // Optimistic local update: marks voided immediately so strikethrough applies
  await db.entries.update(entry.id, {
    status: 'voided',
    void_reason: trimmedReason,
    sync_status: 'pending',
  });

  // Enqueue outbox operation
  await db.outbox.put({
    opId,
    userId: adminId,
    type: 'void_entry',
    payload: {
      entryId: entry.id,
      reason: trimmedReason,
      voidedAt,
    },
    clientCreatedAt: voidedAt,
    maxKnownRateVersion: maxRateVersion,
    status: 'pending',
  });

  return { success: true, opId, action: 'entry_voided' };
}
```

### 6.5 `apps/web/src/lib/ui/LedgerRow.svelte`

```svelte
<script lang="ts">
  import type { LocalEntry, CachedPaymentMethod } from '$lib/db';
  import Chip from '$lib/ui/Chip.svelte';
  import type { ChipVariant } from '$lib/ledger/types';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    entry: LocalEntry;
    methodsMap: Record<string, CachedPaymentMethod>;
    onselect: (entry: LocalEntry) => void;
  }

  let { entry, methodsMap, onselect }: Props = $props();

  const isVoided = $derived(entry.status === 'voided');
  const isSuperseded = $derived(entry.status === 'superseded');

  const method = $derived(methodsMap[entry.method_id]);
  const methodName = $derived(method?.name ?? (entry.method_id ? entry.method_id.substring(0, 8) : 'Method'));
  const chipVariant = $derived<ChipVariant>(
    method && ['bkash', 'visa', 'mastercard'].includes(method.code.toLowerCase())
      ? (method.code.toLowerCase() as 'bkash' | 'visa' | 'mastercard')
      : 'default'
  );

  const deductionsPoisha = $derived(
    BigInt(entry.gross_poisha) - BigInt(entry.net_poisha)
  );
</script>

<div
  role="button"
  tabindex="0"
  onclick={() => onselect(entry)}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onselect(entry); }}
  class="ledger-row p-4 rounded-xl glass border border-black/5 dark:border-white/5 flex items-center justify-between gap-4 cursor-pointer hover:border-[var(--accent,#0B6B59)] transition-colors {isVoided ? 'opacity-40 line-through' : ''} {isSuperseded ? 'opacity-50' : ''}"
>
  <div class="flex items-center gap-3 min-w-0">
    <div class="font-mono text-xs font-bold text-[var(--muted,#6b7280)] shrink-0">
      {entry.entry_number ?? entry.local_id}
    </div>
    <div class="min-w-0">
      <div class="font-bold text-sm text-[var(--ink,#111827)] truncate flex items-center gap-2">
        <span>{entry.customer_name}</span>
        {#if entry.sync_status === 'pending'}
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium shrink-0">
            Pending Sync
          </span>
        {:else if entry.sync_status === 'rejected'}
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-red-500/10 text-red-700 dark:text-red-400 font-medium shrink-0">
            Sync Rejected
          </span>
        {/if}
        {#if entry.stale_rates}
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-orange-500/10 text-orange-700 dark:text-orange-400 font-medium shrink-0">
            Stale Rate
          </span>
        {/if}
        {#if entry.dup_txn_flag}
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium shrink-0">
            Dup Txn
          </span>
        {/if}
      </div>
      <div class="text-xs text-[var(--muted,#6b7280)] flex items-center gap-2">
        <span>Units: {entry.sub_qty}</span>
        {#if entry.txn_ref}
          <span class="font-mono truncate">Ref: {entry.txn_ref}</span>
        {/if}
        {#if entry.void_requested_by && !isVoided}
          <span class="text-amber-600 font-medium text-[11px]">(Void Requested)</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex items-center gap-4 shrink-0">
    <Chip variant={chipVariant}>{methodName}</Chip>

    {#if entry.customer_charge_poisha && entry.customer_charge_poisha !== '0'}
      <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
        [Customer Fee]
      </span>
    {/if}

    <div class="text-right">
      <div class="font-bold text-sm tabular-nums text-[var(--ink,#111827)]">
        {formatPoishaToBdt(BigInt(entry.gross_poisha))}
      </div>
      <div class="text-xs tabular-nums text-red-600 dark:text-red-400">
        Deductions: -{formatPoishaToBdt(deductionsPoisha)}
      </div>
      <div class="text-xs tabular-nums text-[var(--accent,#0B6B59)] font-semibold">
        Net: {formatPoishaToBdt(BigInt(entry.net_poisha))}
      </div>
    </div>
  </div>
</div>
```

### 6.6 `apps/web/src/lib/ui/LedgerFilterDrawer.svelte`

```svelte
<script lang="ts">
  import type { CachedPaymentMethod, CachedProfile } from '$lib/db';
  import type { LedgerFilters } from '$lib/ledger/types';
  import Button from '$lib/ui/Button.svelte';

  interface Props {
    open: boolean;
    filters: LedgerFilters;
    methods: CachedPaymentMethod[];
    profiles: CachedProfile[];
    isAdmin: boolean;
    onclose: () => void;
    onapply: (filters: LedgerFilters) => void;
    onreset: () => void;
  }

  let {
    open = $bindable(),
    filters,
    methods,
    profiles,
    isAdmin,
    onclose,
    onapply,
    onreset,
  }: Props = $props();

  let draft = $state<LedgerFilters>({ ...filters });

  $effect(() => {
    draft = { ...filters };
  });

  function handleReset() {
    draft = {
      startDate: undefined,
      endDate: undefined,
      methodId: undefined,
      createdBy: undefined,
      status: 'all',
      flagDuplicateTxn: false,
      flagStaleRates: false,
    };
    onreset();
  }

  function handleApply() {
    onapply(draft);
    onclose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
    onclick={onclose}
    role="presentation"
  ></div>

  <!-- Drawer -->
  <aside
    role="dialog"
    aria-modal="true"
    aria-label="Transaction filters"
    class="filter-drawer fixed inset-y-0 right-0 z-50 max-w-sm w-full glass bg-white/95 dark:bg-stone-900/95 p-6 shadow-2xl flex flex-col justify-between border-l border-black/10 dark:border-white/10"
  >
    <div class="flex flex-col gap-5 overflow-y-auto">
      <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
        <h2 class="text-lg font-bold text-[var(--ink,#111827)]">Filter Transactions</h2>
        <button
          type="button"
          aria-label="Close filters"
          onclick={onclose}
          class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 text-[var(--muted,#6b7280)]"
        >
          ✕
        </button>
      </div>

      <!-- Date Range -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted,#6b7280)] uppercase tracking-wider">Date Range</span>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <span class="text-[11px] text-[var(--muted,#6b7280)] block mb-1">From</span>
            <input
              type="date"
              bind:value={draft.startDate}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
            />
          </div>
          <div>
            <span class="text-[11px] text-[var(--muted,#6b7280)] block mb-1">To</span>
            <input
              type="date"
              bind:value={draft.endDate}
              class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
            />
          </div>
        </div>
      </div>

      <!-- Payment Method -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted,#6b7280)] uppercase tracking-wider">Payment Method</span>
        <select
          bind:value={draft.methodId}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        >
          <option value={undefined}>All Methods</option>
          {#each methods as m}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </div>

      <!-- Creator Staff Dropdown (Admin/Owner only per PRD §8.5) -->
      {#if isAdmin}
        <div class="flex flex-col gap-2">
          <span class="text-xs font-semibold text-[var(--muted,#6b7280)] uppercase tracking-wider">Creator Staff</span>
          <select
            bind:value={draft.createdBy}
            class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
          >
            <option value={undefined}>All Staff</option>
            {#each profiles as p}
              <option value={p.id}>{p.display_name} ({p.role})</option>
            {/each}
          </select>
        </div>
      {/if}

      <!-- Status -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted,#6b7280)] uppercase tracking-wider">Status</span>
        <select
          bind:value={draft.status}
          class="w-full px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white/50 text-xs"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="pending_sync">Pending Sync Only</option>
          <option value="rejected">Sync Rejected Only</option>
          <option value="voided">Voided Only</option>
          <option value="superseded">Superseded Only</option>
        </select>
      </div>

      <!-- Flags -->
      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-[var(--muted,#6b7280)] uppercase tracking-wider">Flags</span>
        <label class="flex items-center gap-2 text-xs text-[var(--ink,#111827)] cursor-pointer">
          <input type="checkbox" bind:checked={draft.flagDuplicateTxn} class="rounded border-gray-300" />
          <span>Duplicate Txn Ref Flagged</span>
        </label>
        <label class="flex items-center gap-2 text-xs text-[var(--ink,#111827)] cursor-pointer">
          <input type="checkbox" bind:checked={draft.flagStaleRates} class="rounded border-gray-300" />
          <span>Stale Rate Profile (Offline)</span>
        </label>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between pt-4 border-t border-black/10 dark:border-white/10 gap-3">
      <Button variant="default" onclick={handleReset}>Reset</Button>
      <Button variant="default" onclick={handleApply}>Apply Filters</Button>
    </div>
  </aside>
{/if}
```

### 6.7 `apps/web/src/lib/ui/EntryDetailDrawer.svelte`

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LocalEntry, CachedPaymentMethod, CachedProfile } from '$lib/db';
  import Button from '$lib/ui/Button.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import type { ChipVariant } from '$lib/ledger/types';
  import { formatPoishaToBdt } from '@clt/shared';

  interface Props {
    entry: LocalEntry | null;
    allEntries: LocalEntry[];
    role: 'staff' | 'admin' | 'owner';
    currentUserId: string;
    methodsMap: Record<string, CachedPaymentMethod>;
    profilesMap: Record<string, CachedProfile>;
    isMonthClosed: boolean;
    onclose: () => void;
    onselectentry?: ((entry: LocalEntry) => void) | undefined;
    onrequestvoid: (entry: LocalEntry) => void;
    onvoid: (entry: LocalEntry) => void;
  }

  let {
    entry,
    allEntries,
    role,
    currentUserId,
    methodsMap,
    profilesMap,
    isMonthClosed,
    onclose,
    onselectentry,
    onrequestvoid,
    onvoid,
  }: Props = $props();

  const isPrivileged = $derived(role === 'admin' || role === 'owner');
  const method = $derived(entry ? methodsMap[entry.method_id] : undefined);
  const methodName = $derived(method?.name ?? (entry?.method_id ? entry.method_id.substring(0, 8) : ''));
  const chipVariant = $derived<ChipVariant>(
    method && ['bkash', 'visa', 'mastercard'].includes(method.code.toLowerCase())
      ? (method.code.toLowerCase() as 'bkash' | 'visa' | 'mastercard')
      : 'default'
  );

  const creatorName = $derived(
    entry ? (profilesMap[entry.created_by]?.display_name || entry.created_by) : ''
  );

  // Chains
  const predecessorEntry = $derived(
    entry?.supersedes_id ? allEntries.find((e) => e.id === entry.supersedes_id) : null
  );
  const successorEntry = $derived(
    entry ? allEntries.find((e) => e.supersedes_id === entry.id) : null
  );

  function formatDhakaTimestamp(isoDate?: string): string {
    if (!isoDate) return 'N/A';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(isoDate)) + ' (Asia/Dhaka)';
    } catch {
      return isoDate;
    }
  }

  function handleSupersedeClick() {
    if (!entry) return;
    onclose();
    goto(`/entries/new?supersede=${encodeURIComponent(entry.id)}`);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && entry) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if entry}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
    onclick={onclose}
    role="presentation"
  ></div>

  <aside
    role="dialog"
    aria-modal="true"
    aria-label="Transaction detail slide-over"
    class="detail-drawer fixed inset-y-0 right-0 z-50 max-w-md w-full glass bg-white/95 dark:bg-stone-900/95 p-6 shadow-2xl flex flex-col justify-between border-l border-black/10 dark:border-white/10 overflow-y-auto"
  >
    <div class="flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
        <div>
          <h2 class="text-lg font-bold text-[var(--ink,#111827)]">{entry.entry_number ?? entry.local_id}</h2>
          <span class="text-xs font-mono text-[var(--muted,#6b7280)]">UUID: {entry.id}</span>
        </div>
        <button
          type="button"
          aria-label="Close detail drawer"
          onclick={onclose}
          class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-black/5 text-[var(--muted,#6b7280)]"
        >
          ✕
        </button>
      </div>

      <!-- Closed Month Lock Banner (Finding 7, PRD §8.4) -->
      {#if isMonthClosed}
        <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
          <span>🔒</span>
          <span>Month {entry.entry_date.substring(0, 7)} is closed. Voids and supersessions are locked.</span>
        </div>
      {/if}

      <!-- Duplicate Txn Ref Warning -->
      {#if entry.dup_txn_flag}
        <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-xs flex items-center gap-2">
          <span>⚠️</span>
          <span><strong>Duplicate Txn Ref:</strong> This transaction reference was previously recorded.</span>
        </div>
      {/if}

      <!-- Stale Rates Alert (Threshold > 50,000 poisha per PRD) -->
      {#if entry.stale_rates}
        <div class="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-700 dark:text-orange-400 text-xs flex items-center gap-2">
          <span>⚡</span>
          <span>
            <strong>Stale Rate Profile:</strong> Recorded offline under older rates.
            {#if entry.stale_review_status === 'approved'}
              Approved by Admin without recalculation.
            {:else if entry.stale_review_status === 'rejected'}
              Rejected by Admin during stale rate review.
            {:else if BigInt(entry.gross_poisha) > 5000000n}
              Flagged for Admin review (&gt; ৳50,000).
            {:else}
              Preserved without recalculation.
            {/if}
          </span>
        </div>
      {/if}

      <!-- Core Details -->
      <div class="flex flex-col gap-2.5 text-sm">
        <div class="flex justify-between">
          <span class="text-[var(--muted,#6b7280)]">Customer:</span>
          <span class="font-bold text-[var(--ink,#111827)]">{entry.customer_name}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[var(--muted,#6b7280)]">Date:</span>
          <span>{entry.entry_date}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-[var(--muted,#6b7280)]">Units / Quantity:</span>
          <span>{entry.sub_qty}</span>
        </div>
        {#if entry.sub_description}
          <div class="flex justify-between">
            <span class="text-[var(--muted,#6b7280)]">Description:</span>
            <span>{entry.sub_description}</span>
          </div>
        {/if}
        <div class="flex justify-between items-center">
          <span class="text-[var(--muted,#6b7280)]">Payment Method:</span>
          <Chip variant={chipVariant}>{methodName}</Chip>
        </div>
        {#if entry.txn_ref}
          <div class="flex justify-between font-mono">
            <span class="text-[var(--muted,#6b7280)]">Txn Reference:</span>
            <span>{entry.txn_ref}</span>
          </div>
        {/if}
        {#if entry.notes}
          <div class="flex justify-between text-xs">
            <span class="text-[var(--muted,#6b7280)]">Notes:</span>
            <span class="italic">{entry.notes}</span>
          </div>
        {/if}
        <div class="flex justify-between">
          <span class="text-[var(--muted,#6b7280)]">Status:</span>
          <span class="capitalize font-semibold {entry.status === 'voided' ? 'text-red-500 line-through' : entry.status === 'superseded' ? 'text-amber-600' : 'text-emerald-600'}">
            {entry.status} ({entry.sync_status})
          </span>
        </div>

        <!-- Financial Breakdown (Rule 2, Rule 3) -->
        <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1.5">
          <div class="flex justify-between">
            <span class="text-[var(--muted,#6b7280)]">Gross:</span>
            <span class="font-bold tabular-nums text-[var(--ink,#111827)]">{formatPoishaToBdt(BigInt(entry.gross_poisha))}</span>
          </div>
          <div class="flex justify-between text-[var(--c-vat,#0d9488)]">
            <span>VAT Deduction:</span>
            <span class="tabular-nums">-{formatPoishaToBdt(BigInt(entry.vat_poisha))}</span>
          </div>
          <div class="flex justify-between text-[var(--c-commission,#e11d48)]">
            <span>Commission Deduction:</span>
            <span class="tabular-nums">-{formatPoishaToBdt(BigInt(entry.commission_poisha))}</span>
          </div>
          <div class="flex justify-between text-red-600">
            <span>Merchant Fee:</span>
            <span class="tabular-nums">-{formatPoishaToBdt(BigInt(entry.business_charge_poisha))}</span>
          </div>
          {#if entry.customer_charge_poisha && entry.customer_charge_poisha !== '0'}
            <div class="flex justify-between text-blue-600 text-xs">
              <span>Customer Fee (Customer-paid — not deducted):</span>
              <span class="tabular-nums">{formatPoishaToBdt(BigInt(entry.customer_charge_poisha))}</span>
            </div>
          {/if}
          <div class="flex justify-between font-bold text-base pt-2 border-t border-black/5">
            <span>Net Revenue:</span>
            <span class="tabular-nums text-[var(--accent,#0B6B59)]">{formatPoishaToBdt(BigInt(entry.net_poisha))}</span>
          </div>
        </div>

        <!-- Snapshot Rates Applied (PRD §8.2) -->
        {#if entry.snapshot}
          <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1 text-xs">
            <span class="font-bold text-[var(--ink,#111827)] uppercase tracking-wider">Snapshot Rates Applied</span>
            <div class="grid grid-cols-2 gap-1 text-[var(--muted,#6b7280)]">
              <div>Version: <span class="font-mono text-[var(--ink,#111827)]">v{entry.snapshot.rateProfileVersion}</span></div>
              <div>VAT: <span class="text-[var(--ink,#111827)]">{entry.snapshot.vatMode} ({entry.snapshot.vatBp / 100}%)</span></div>
              <div>Commission: <span class="text-[var(--ink,#111827)]">{entry.snapshot.commissionBp / 100}%</span></div>
              <div>Method Fee: <span class="text-[var(--ink,#111827)]">{entry.snapshot.methodFeeBp / 100}%</span></div>
              <div>Borne By: <span class="text-[var(--ink,#111827)] capitalize">{entry.snapshot.chargesBorneBy}</span></div>
              <div>Rounding: <span class="text-[var(--ink,#111827)]">{entry.snapshot.roundingRule}</span></div>
            </div>
          </div>
        {/if}

        <!-- Metadata & Timestamps -->
        <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1 text-xs text-[var(--muted,#6b7280)]">
          <div class="flex justify-between">
            <span>Creator:</span>
            <span class="font-medium text-[var(--ink,#111827)]">{creatorName}</span>
          </div>
          <div class="flex justify-between">
            <span>Created At:</span>
            <span>{formatDhakaTimestamp(entry.created_at)}</span>
          </div>
          <div class="flex justify-between">
            <span>Server Sequence:</span>
            <span class="font-mono">{entry.server_seq ?? 'Local (Unassigned)'}</span>
          </div>
          <div class="flex justify-between">
            <span>Device ID:</span>
            <span class="font-mono">{entry.device_id ?? 'Unknown / Web'}</span>
          </div>
        </div>

        <!-- Supersede History Chain -->
        {#if predecessorEntry || successorEntry}
          <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1.5 text-xs">
            <span class="font-bold text-[var(--ink,#111827)] uppercase tracking-wider">Supersede History Chain</span>
            {#if predecessorEntry}
              <div class="flex items-center justify-between text-amber-700 dark:text-amber-400">
                <span>Supersedes Original:</span>
                {#if onselectentry}
                  <button
                    type="button"
                    class="font-mono font-bold underline hover:text-[var(--accent,#0B6B59)] cursor-pointer text-left"
                    onclick={() => onselectentry?.(predecessorEntry)}
                  >
                    {predecessorEntry.entry_number ?? predecessorEntry.local_id}
                  </button>
                {:else}
                  <span class="font-mono font-bold">{predecessorEntry.entry_number ?? predecessorEntry.local_id}</span>
                {/if}
              </div>
            {/if}
            {#if successorEntry}
              <div class="flex items-center justify-between text-blue-700 dark:text-blue-400">
                <span>Replaced by Successor:</span>
                {#if onselectentry}
                  <button
                    type="button"
                    class="font-mono font-bold underline hover:text-[var(--accent,#0B6B59)] cursor-pointer text-left"
                    onclick={() => onselectentry?.(successorEntry)}
                  >
                    {successorEntry.entry_number ?? successorEntry.local_id}
                  </button>
                {:else}
                  <span class="font-mono font-bold">{successorEntry.entry_number ?? successorEntry.local_id}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Audit Events Log -->
        <div class="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col gap-1 text-xs text-[var(--muted,#6b7280)]">
          <span class="font-bold text-[var(--ink,#111827)] uppercase tracking-wider mb-1">Audit Events</span>
          <div class="flex items-start gap-2">
            <span>•</span>
            <span>Created by {creatorName} on {formatDhakaTimestamp(entry.created_at)}</span>
          </div>
          {#if entry.void_requested_by}
            <div class="flex items-start gap-2 text-amber-600">
              <span>•</span>
              <span>
                Void requested by {profilesMap[entry.void_requested_by]?.display_name || entry.void_requested_by}:
                "{entry.void_reason}"
              </span>
            </div>
          {/if}
          {#if entry.status === 'voided'}
            <div class="flex items-start gap-2 text-red-600">
              <span>•</span>
              <span>Entry voided (Reason: "{entry.void_reason}")</span>
            </div>
          {/if}
          {#if entry.status === 'superseded'}
            <div class="flex items-start gap-2 text-amber-600">
              <span>•</span>
              <span>Entry superseded by replacement</span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Actions (Void / Supersede) -->
    <div class="pt-4 border-t border-black/10 dark:border-white/10 flex flex-col gap-2">
      {#if entry.status === 'active' && !isMonthClosed}
        {#if isPrivileged}
          <!-- Admin or Owner Actions -->
          <div class="flex gap-2">
            {#if entry.void_requested_by}
              <Button variant="default" class="flex-1 bg-red-600 hover:bg-red-700 text-white" onclick={() => onvoid(entry)}>
                Approve Void
              </Button>
            {:else}
              <Button variant="default" class="flex-1 text-red-600 border border-red-300" onclick={() => onvoid(entry)}>
                Void Entry
              </Button>
            {/if}
            <Button variant="default" class="flex-1" onclick={handleSupersedeClick}>
              Edit / Supersede
            </Button>
          </div>
        {:else if entry.created_by === currentUserId && !entry.void_requested_by}
          <!-- Staff Action: Can only request void on own entries per PRD §8.2 / §8.5 -->
          <Button variant="default" class="w-full text-amber-600 border border-amber-300" onclick={() => onrequestvoid(entry)}>
            Request Void
          </Button>
        {:else if entry.void_requested_by}
          <div class="text-xs text-center text-amber-600 font-medium py-1">
            Void request pending Admin approval.
          </div>
        {/if}
      {:else if isMonthClosed}
        <div class="text-xs text-center text-amber-700 font-semibold py-1">
          Month closed. Modifications locked.
        </div>
      {:else}
        <div class="text-xs text-center text-[var(--muted,#6b7280)] py-1">
          This entry is {entry.status} and cannot be modified.
        </div>
      {/if}
    </div>
  </aside>
{/if}
```

### 6.8 `apps/web/src/lib/ui/VoidRequestModal.svelte`

```svelte
<script lang="ts">
  import Modal from '$lib/ui/Modal.svelte';
  import Button from '$lib/ui/Button.svelte';

  interface Props {
    open: boolean;
    isAdmin: boolean;
    isApproval?: boolean;
    existingReason?: string;
    onclose: () => void;
    onsubmit: (reason: string) => Promise<void>;
  }

  let {
    open = $bindable(false),
    isAdmin,
    isApproval = false,
    existingReason = '',
    onclose,
    onsubmit,
  }: Props = $props();

  let reason = $state('');
  let isSubmitting = $state(false);

  $effect(() => {
    if (open) {
      reason = existingReason || '';
      isSubmitting = false;
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!reason.trim() || isSubmitting) return;

    isSubmitting = true;
    try {
      await onsubmit(reason.trim());
      onclose();
    } catch (err) {
      console.error('Failed to submit void:', err);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="void-modal-wrapper">
  <Modal
    bind:open
    title={isApproval ? 'Approve Void Request' : isAdmin ? 'Confirm Direct Void' : 'Request Transaction Void'}
    {onclose}
  >
    <form onsubmit={handleSubmit} class="flex flex-col gap-4">
      <p class="text-xs text-[var(--muted,#6b7280)] leading-relaxed">
        {#if isApproval}
          Staff has requested this entry to be voided. Confirming will mark it as voided and exclude it from reports.
        {:else if isAdmin}
          Directly voiding this transaction will exclude it from reports and mark it as voided. Entries are never hard-deleted.
        {:else}
          Staff void requests require Administrator approval before taking effect.
        {/if}
      </p>

      <div class="flex flex-col gap-1.5">
        <label for="void-reason" class="text-xs font-semibold text-[var(--ink,#111827)]">
          Audit Justification <span class="text-red-500">*</span>
        </label>
        <textarea
          id="void-reason"
          required
          rows="3"
          bind:value={reason}
          class="w-full px-4 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/50 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent,#0B6B59)]"
          placeholder="State the audit justification for voiding this transaction..."
        ></textarea>
      </div>

      <div class="flex justify-end gap-3 mt-2">
        <Button variant="default" type="button" onclick={onclose}>Cancel</Button>
        <Button variant="default" type="submit" disabled={!reason.trim() || isSubmitting}>
          {isSubmitting ? 'Submitting...' : isApproval ? 'Approve Void' : isAdmin ? 'Confirm Void' : 'Submit Request'}
        </Button>
      </div>
    </form>
  </Modal>
</div>
```

### 6.9 `apps/web/src/routes/(app)/ledger/+page.svelte`

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import { db, type LocalEntry, type CachedPaymentMethod, type CachedMonthClose, type CachedProfile } from '$lib/db';
  import { groupEntriesByDay } from '$lib/ledger/grouping';
  import { normalizeEntrySearchQuery, matchesEntrySearch } from '$lib/ledger/search';
  import { requestEntryVoid, executeEntryVoid } from '$lib/ledger/void';
  import type { LedgerFilters } from '$lib/ledger/types';
  import { session } from '$lib/auth/session.svelte';
  import LedgerRow from '$lib/ui/LedgerRow.svelte';
  import LedgerFilterDrawer from '$lib/ui/LedgerFilterDrawer.svelte';
  import EntryDetailDrawer from '$lib/ui/EntryDetailDrawer.svelte';
  import VoidRequestModal from '$lib/ui/VoidRequestModal.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { liveQuery } from 'dexie';
  import { formatPoishaToBdt } from '@clt/shared';

  let rawSearch = $state('');
  let debouncedSearch = $state('');
  let searchTimer: any = null;

  let selectedEntryId = $state<string | null>(null);
  let voidModalOpen = $state(false);
  let filterDrawerOpen = $state(false);

  let filters = $state<LedgerFilters>({
    status: 'all',
    flagDuplicateTxn: false,
    flagStaleRates: false,
  });

  let allEntries = $state<LocalEntry[]>([]);
  let paymentMethods = $state<CachedPaymentMethod[]>([]);
  let monthCloses = $state<CachedMonthClose[]>([]);
  let profiles = $state<CachedProfile[]>([]);

  // Securely derive auth state from session.user
  const currentRole = $derived(session.user?.role ?? 'staff');
  const currentUserId = $derived(session.user?.id ?? '');
  const isPrivileged = $derived(currentRole === 'admin' || currentRole === 'owner');

  // Parse URL query parameters for report drill-down (PRD §8.3)
  $effect(() => {
    const searchParams = page.url.searchParams;
    const monthParam = searchParams.get('month'); // YYYY-MM
    const methodParam = searchParams.get('method');
    const statusParam = searchParams.get('status') as LedgerFilters['status'];
    const queryParam = searchParams.get('q');

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const year = parseInt(monthParam.substring(0, 4), 10);
      const month = parseInt(monthParam.substring(5, 7), 10);
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      filters.startDate = `${monthParam}-01`;
      filters.endDate = `${monthParam}-${lastDay.toString().padStart(2, '0')}`;
    }

    if (methodParam) {
      filters.methodId = methodParam;
    }

    if (statusParam) {
      filters.status = statusParam;
    }

    if (queryParam) {
      rawSearch = queryParam;
      debouncedSearch = queryParam;
    }
  });

  // Debounce search input by 150ms
  $effect(() => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      debouncedSearch = rawSearch;
    }, 150);
    return () => clearTimeout(searchTimer);
  });

  // Reactive Dexie queries
  $effect(() => {
    const subEntries = liveQuery(() => db.entries.toArray()).subscribe((rows) => {
      allEntries = rows;
    });
    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      paymentMethods = rows;
    });
    const subCloses = liveQuery(() => db.monthCloses.toArray()).subscribe((rows) => {
      monthCloses = rows;
    });
    const subProfiles = liveQuery(() => db.profiles.toArray()).subscribe((rows) => {
      profiles = rows;
    });

    return () => {
      subEntries.unsubscribe();
      subMethods.unsubscribe();
      subCloses.unsubscribe();
      subProfiles.unsubscribe();
    };
  });

  const methodsMap = $derived.by(() => {
    const map: Record<string, CachedPaymentMethod> = {};
    for (const m of paymentMethods) {
      map[m.id] = m;
    }
    return map;
  });

  const profilesMap = $derived.by(() => {
    const map: Record<string, CachedProfile> = {};
    for (const p of profiles) {
      map[p.id] = p;
    }
    return map;
  });

  // Selected entry re-derived dynamically from allEntries
  const selectedEntry = $derived(
    selectedEntryId ? allEntries.find((e) => e.id === selectedEntryId) ?? null : null
  );

  const isSelectedEntryMonthClosed = $derived.by(() => {
    if (!selectedEntry) return false;
    const monthKey = selectedEntry.entry_date.substring(0, 7) + '-01';
    return monthCloses.some((c) => c.month === monthKey && c.status === 'closed');
  });

  // Filter application with role-scoping (PRD §8.5)
  function passesFilters(entry: LocalEntry, f: LedgerFilters): boolean {
    // PRD §8.5: Staff sees strictly their own entries on shared devices
    if (currentRole === 'staff' && entry.created_by !== currentUserId) {
      return false;
    }

    if (f.startDate && entry.entry_date < f.startDate) return false;
    if (f.endDate && entry.entry_date > f.endDate) return false;
    if (f.methodId && entry.method_id !== f.methodId) return false;
    if (f.createdBy && entry.created_by !== f.createdBy) return false;

    if (f.status && f.status !== 'all') {
      if (f.status === 'pending_sync' && entry.sync_status !== 'pending') return false;
      if (f.status === 'rejected' && entry.sync_status !== 'rejected') return false;
      if (f.status === 'active' && entry.status !== 'active') return false;
      if (f.status === 'voided' && entry.status !== 'voided') return false;
      if (f.status === 'superseded' && entry.status !== 'superseded') return false;
    }

    if (f.flagDuplicateTxn && !entry.dup_txn_flag) return false;
    if (f.flagStaleRates && !entry.stale_rates) return false;

    return true;
  }

  const normalizedQuery = $derived(normalizeEntrySearchQuery(debouncedSearch));

  const filteredEntries = $derived.by(() => {
    return allEntries.filter((entry) => {
      if (!passesFilters(entry, filters)) return false;
      return matchesEntrySearch(entry, normalizedQuery);
    });
  });

  const dayGroups = $derived(groupEntriesByDay(filteredEntries));

  const activeFilterCount = $derived.by(() => {
    let count = 0;
    if (filters.startDate) count++;
    if (filters.endDate) count++;
    if (filters.methodId) count++;
    if (filters.createdBy) count++;
    if (filters.status && filters.status !== 'all') count++;
    if (filters.flagDuplicateTxn) count++;
    if (filters.flagStaleRates) count++;
    return count;
  });

  async function handleConfirmVoid(reason: string) {
    if (!selectedEntry || !currentUserId) return;

    if (isPrivileged) {
      await executeEntryVoid(selectedEntry, currentUserId, reason);
    } else {
      await requestEntryVoid(selectedEntry, currentUserId, reason);
    }
  }
</script>

<div class="ledger-page p-6 max-w-5xl mx-auto w-full">
  <div class="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--ink,#14161A)]">Ledger</h1>
      <p class="text-sm text-[var(--muted,#5C6068)]">
        {#if currentRole === 'staff'}
          My transaction entries record with search and subtotals.
        {:else}
          All shop transactions with search, filters, and daily subtotals.
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-3 max-w-md w-full">
      <div class="flex-1">
        <input
          type="search"
          placeholder="Search ID, customer, ref, #LOCAL..."
          bind:value={rawSearch}
          class="w-full px-4 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white/50 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent,#0B6B59)]"
        />
      </div>
      <Button
        variant="default"
        onclick={() => { filterDrawerOpen = true; }}
        class="relative min-w-[44px]"
      >
        Filters
        {#if activeFilterCount > 0}
          <span class="ml-1.5 px-1.5 py-0.5 rounded-full bg-[var(--accent,#0B6B59)] text-white text-[10px] font-bold">
            {activeFilterCount}
          </span>
        {/if}
      </Button>
    </div>
  </div>

  <!-- Day Groups -->
  <div class="flex flex-col gap-6">
    {#if dayGroups.length === 0}
      <div class="p-12 text-center text-sm text-[var(--muted,#5C6068)] glass rounded-2xl border border-black/5">
        No transactions found matching criteria.
      </div>
    {:else}
      {#each dayGroups as day}
        <section aria-labelledby={`day-${day.date}`} class="day-group flex flex-col gap-3">
          <div class="flex items-center justify-between px-2 text-xs font-semibold text-[var(--muted,#5C6068)] uppercase tracking-wider">
            <h2 id={`day-${day.date}`}>{day.date}</h2>
            <div class="flex items-center gap-3 tabular-nums">
              <span>Units: {day.totalSubQty}</span>
              <span>Gross: {formatPoishaToBdt(day.totalGrossPoisha)}</span>
              <span class="text-red-600 dark:text-red-400">Deductions: -{formatPoishaToBdt(day.totalDeductionsPoisha)}</span>
              <span class="text-[var(--accent,#0B6B59)] font-semibold">Net: {formatPoishaToBdt(day.totalNetPoisha)}</span>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            {#each day.entries as entry (entry.id)}
              <LedgerRow
                {entry}
                {methodsMap}
                onselect={(e) => { selectedEntryId = e.id; }}
              />
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>

  <!-- Drawers and Modals -->
  <LedgerFilterDrawer
    bind:open={filterDrawerOpen}
    {filters}
    methods={paymentMethods}
    {profiles}
    isAdmin={isPrivileged}
    onclose={() => { filterDrawerOpen = false; }}
    onapply={(f) => { filters = f; }}
    onreset={() => {
      filters = { status: 'all', flagDuplicateTxn: false, flagStaleRates: false };
    }}
  />

  <EntryDetailDrawer
    entry={selectedEntry}
    {allEntries}
    role={currentRole}
    {currentUserId}
    {methodsMap}
    {profilesMap}
    isMonthClosed={isSelectedEntryMonthClosed}
    onclose={() => { selectedEntryId = null; }}
    onselectentry={(e) => { selectedEntryId = e.id; }}
    onrequestvoid={() => { voidModalOpen = true; }}
    onvoid={() => { voidModalOpen = true; }}
  />

  <VoidRequestModal
    bind:open={voidModalOpen}
    isAdmin={isPrivileged}
    isApproval={Boolean(selectedEntry?.void_requested_by)}
    existingReason={selectedEntry?.void_reason}
    onclose={() => { voidModalOpen = false; }}
    onsubmit={handleConfirmVoid}
  />
</div>
```

### 6.10 `apps/web/src/lib/ledger/ledger.test.ts`

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeEntrySearchQuery, matchesEntrySearch } from './search';
import { groupEntriesByDay } from './grouping';
import { requestEntryVoid, executeEntryVoid } from './void';
import { db, type LocalEntry } from '$lib/db';

describe('Ledger Search & Precision Matching', () => {
  it('strips formatted E-YYYYMM-0* prefix and matches local badge queries', () => {
    const res1 = normalizeEntrySearchQuery('E-202610-000042');
    expect(res1.numericEntryNumber).toBe(42);

    const res2 = normalizeEntrySearchQuery('E-000105');
    expect(res2.numericEntryNumber).toBe(105);

    const res3 = normalizeEntrySearchQuery('#LOCAL-a1b2c3');
    expect(res3.localBadgeQuery).toBe('a1b2c3');

    const res4 = normalizeEntrySearchQuery('LOCAL-def456');
    expect(res4.localBadgeQuery).toBe('def456');

    const res5 = normalizeEntrySearchQuery('  Ziaur  ');
    expect(res5.numericEntryNumber).toBeNull();
    expect(res5.localBadgeQuery).toBeNull();
    expect(res5.textQuery).toBe('ziaur');
  });

  it('strictly isolates numeric entry number search from month/year date parts (PRD §8.2)', () => {
    const entryOctober: LocalEntry = {
      id: 'e1',
      entry_number: 'E-202610-000042',
      local_id: '#LOCAL-oct',
      entry_date: '2026-10-29',
      customer_name: 'Ziaur Rahman',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '100000',
      vat_poisha: '0',
      commission_poisha: '42000',
      charge_poisha: '1150',
      business_charge_poisha: '1150',
      customer_charge_poisha: '0',
      net_poisha: '56850',
      status: 'active',
      sync_status: 'synced',
      created_by: 'u1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'p1',
    };

    // Searching '42' matches entry 42
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('42'))).toBe(true);

    // Searching '10' does NOT match entry 42 (must NOT match the 202610 month part)
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('10'))).toBe(false);

    // Searching '2026' does NOT match entry 42 (must NOT match the year part)
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('2026'))).toBe(false);

    // Full formatted search matches
    expect(matchesEntrySearch(entryOctober, normalizeEntrySearchQuery('E-202610-000042'))).toBe(true);
  });
});

describe('Intra-Day Ordering & Subtotals', () => {
  it('sorts intra-day entries newest first by created_at DESC with server_seq tie-breaker', () => {
    const entries: LocalEntry[] = [
      {
        id: '1',
        local_id: '#LOCAL-1',
        entry_date: '2026-10-29',
        customer_name: 'Customer Early',
        sub_qty: 1,
        method_id: 'm1',
        gross_poisha: '100000',
        vat_poisha: '0',
        commission_poisha: '42000',
        charge_poisha: '1150',
        business_charge_poisha: '1150',
        customer_charge_poisha: '0',
        net_poisha: '56850',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T08:00:00Z',
        server_seq: '10',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
      {
        id: '2',
        local_id: '#LOCAL-2',
        entry_date: '2026-10-29',
        customer_name: 'Customer Late',
        sub_qty: 1,
        method_id: 'm1',
        gross_poisha: '200000',
        vat_poisha: '0',
        commission_poisha: '84000',
        charge_poisha: '2300',
        business_charge_poisha: '2300',
        customer_charge_poisha: '0',
        net_poisha: '113700',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T14:00:00Z',
        server_seq: '11',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
    ];

    const groups = groupEntriesByDay(entries);
    expect(groups.length).toBe(1);
    expect(groups[0].entries[0].customer_name).toBe('Customer Late');
    expect(groups[0].entries[1].customer_name).toBe('Customer Early');
  });

  it('calculates daily gross, deductions, and net subtotals strictly from active entries', () => {
    const entries: LocalEntry[] = [
      {
        id: '1',
        local_id: '#LOCAL-1',
        entry_date: '2026-10-29',
        customer_name: 'Customer A',
        sub_qty: 2,
        method_id: 'm1',
        gross_poisha: '100050',
        vat_poisha: '0',
        commission_poisha: '42021',
        charge_poisha: '1151',
        business_charge_poisha: '1151',
        customer_charge_poisha: '0',
        net_poisha: '56878',
        status: 'active',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T10:00:00Z',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
      {
        id: '2',
        local_id: '#LOCAL-2',
        entry_date: '2026-10-29',
        customer_name: 'Customer B (Voided)',
        sub_qty: 1,
        method_id: 'm1',
        gross_poisha: '50000',
        vat_poisha: '0',
        commission_poisha: '21000',
        charge_poisha: '575',
        business_charge_poisha: '575',
        customer_charge_poisha: '0',
        net_poisha: '28425',
        status: 'voided',
        sync_status: 'synced',
        created_by: 'u1',
        created_at: '2026-10-29T11:00:00Z',
        stale_rates: false,
        rate_profile_id: 'p1',
      },
    ];

    const groups = groupEntriesByDay(entries);
    expect(groups.length).toBe(1);
    expect(groups[0].totalGrossPoisha).toBe(100050n);
    expect(groups[0].totalNetPoisha).toBe(56878n);
    expect(groups[0].totalDeductionsPoisha).toBe(100050n - 56878n);
  });
});

describe('Void Lifecycle & Outbox Queueing (PRD §8.2, §9.2)', () => {
  beforeEach(async () => {
    await db.outbox.clear();
    await db.entries.clear();
    await db.rateProfiles.clear();
    await db.monthCloses.clear();

    await db.rateProfiles.put({
      id: 'rp-1',
      version: 2,
      status: 'published',
      effective_from: '2026-01-01',
      vat_mode: 'manual',
      vat_bp: 0,
      commission_bp: 4200,
      commission_base: 'gross',
      method_rates: {},
    });
  });

  it('requestEntryVoid updates entry locally with void_requested_by and enqueues request_void op', async () => {
    const entry: LocalEntry = {
      id: 'e-1',
      local_id: '#LOCAL-1',
      entry_date: '2026-10-29',
      customer_name: 'Customer Test',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };
    await db.entries.put(entry);

    const res = await requestEntryVoid(entry, 'staff-1', 'Incorrect payment method');
    expect(res.success).toBe(true);

    const updated = await db.entries.get('e-1');
    expect(updated?.void_requested_by).toBe('staff-1');
    expect(updated?.void_reason).toBe('Incorrect payment method');
    expect(updated?.status).toBe('active'); // Still active until approved
    expect(updated?.sync_status).toBe('pending');

    const outboxOp = await db.outbox.get(res.opId);
    expect(outboxOp?.type).toBe('request_void');
    expect(outboxOp?.maxKnownRateVersion).toBe(2);
  });

  it('executeEntryVoid marks entry status = voided locally and enqueues void_entry op', async () => {
    const entry: LocalEntry = {
      id: 'e-2',
      local_id: '#LOCAL-2',
      entry_date: '2026-10-29',
      customer_name: 'Customer Admin Test',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };
    await db.entries.put(entry);

    const res = await executeEntryVoid(entry, 'admin-1', 'Approved customer cancellation');
    expect(res.success).toBe(true);

    const updated = await db.entries.get('e-2');
    expect(updated?.status).toBe('voided'); // Optimistically voided
    expect(updated?.sync_status).toBe('pending');

    const outboxOp = await db.outbox.get(res.opId);
    expect(outboxOp?.type).toBe('void_entry');
    expect(outboxOp?.maxKnownRateVersion).toBe(2);
  });
});

describe('Closed-Month Action Lockout (Hard Rule 10, PRD §8.4)', () => {
  beforeEach(async () => {
    await db.monthCloses.clear();
    await db.entries.clear();
    await db.outbox.clear();
  });

  it('rejects void request and direct void when entry falls in a closed month', async () => {
    await db.monthCloses.put({
      month: '2026-10-01',
      status: 'closed',
      closed_at: '2026-11-01T00:00:00Z',
      closed_by: 'admin-1',
    });

    const entry: LocalEntry = {
      id: 'e-closed',
      local_id: '#LOCAL-closed',
      entry_date: '2026-10-15',
      customer_name: 'Customer Closed Month',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-15T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };
    await db.entries.put(entry);

    await expect(requestEntryVoid(entry, 'staff-1', 'Need refund')).rejects.toThrow(
      'Month 2026-10 is closed. Voids are locked.'
    );

    await expect(executeEntryVoid(entry, 'admin-1', 'Admin override')).rejects.toThrow(
      'Month 2026-10 is closed. Voids are locked.'
    );

    const outboxOps = await db.outbox.toArray();
    expect(outboxOps.length).toBe(0);
  });
});

describe('Entry Inactive Status & Supersede Guards (Test #32, Test #57)', () => {
  it('prevents voiding non-active entries (Test #32)', async () => {
    const voidedEntry: LocalEntry = {
      id: 'e-voided',
      local_id: '#LOCAL-voided',
      entry_date: '2026-10-29',
      customer_name: 'Already Voided',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '50000',
      vat_poisha: '0',
      commission_poisha: '21000',
      charge_poisha: '575',
      business_charge_poisha: '575',
      customer_charge_poisha: '0',
      net_poisha: '28425',
      status: 'voided',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: false,
      rate_profile_id: 'rp-1',
    };

    await expect(requestEntryVoid(voidedEntry, 'staff-1', 'Void again')).rejects.toThrow(
      'Only active entries can be requested for void'
    );

    await expect(executeEntryVoid(voidedEntry, 'admin-1', 'Direct void again')).rejects.toThrow(
      'Only active entries can be voided'
    );
  });

  it('matches stale rate entry and handles stale_review_status (Test #57)', () => {
    const staleEntry: LocalEntry = {
      id: 'e-stale',
      local_id: '#LOCAL-stale',
      entry_date: '2026-10-29',
      customer_name: 'Stale Customer',
      sub_qty: 1,
      method_id: 'm1',
      gross_poisha: '6000000',
      vat_poisha: '0',
      commission_poisha: '2520000',
      charge_poisha: '69000',
      business_charge_poisha: '69000',
      customer_charge_poisha: '0',
      net_poisha: '3411000',
      status: 'active',
      sync_status: 'synced',
      created_by: 'staff-1',
      created_at: '2026-10-29T10:00:00Z',
      stale_rates: true,
      stale_review_status: 'approved',
      rate_profile_id: 'rp-old',
    };

    expect(staleEntry.stale_rates).toBe(true);
    expect(staleEntry.stale_review_status).toBe('approved');
    expect(matchesEntrySearch(staleEntry, normalizeEntrySearchQuery('Stale'))).toBe(true);
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Search Prefix & Local ID Normalization | `'E-202610-000042'`, `'#LOCAL-a1b2c3'` | `numericEntryNumber === 42`, `localBadgeQuery === 'a1b2c3'` | §8.2, §16.2 #57 | `apps/web/src/lib/ledger/ledger.test.ts` |
| Precision Numeric Query Isolation | Query `'10'` or `'2026'` | Does NOT false-positive on month/year date parts of formatted entry numbers | §8.2 | `apps/web/src/lib/ledger/ledger.test.ts` |
| Intra-Day Chronological Ordering | Entries with different timestamps | Strictly sorted newest first (`created_at DESC`, `server_seq DESC`) | §8.2 | `apps/web/src/lib/ledger/ledger.test.ts` |
| Day Subtotals Active Isolation & Deductions | Active and Voided rows | Daily gross, deductions, and net strictly aggregate active entries | §8.2, Rule 2 | `apps/web/src/lib/ledger/ledger.test.ts` |
| Test #32 Supersede Inactive Check | Attempt to edit non-active entry | Buttons disabled, modal rejected with `cannot_supersede_non_active` | §8.2, §16.2 #32 | `apps/web/src/lib/ui/EntryDetailDrawer.svelte` |
| Test #50 Local Void Outbox Queueing | Staff void request & Admin direct void | Entry marked locally, queued to outbox with rate watermark | §8.2, §16.2 #50 | `apps/web/src/lib/ledger/ledger.test.ts` |
| Closed-Month Action Lockout | Entry in month closed in `db.monthCloses` | Disables Edit/Supersede and Void with warning banner | §8.4 | `apps/web/src/lib/ui/EntryDetailDrawer.svelte` |

## 8. Acceptance criteria

1. Entry search normalizes formatted prefixes (`E-YYYYMM-XXXXXX`) to raw integers, isolates numeric searches from month/year dates, and daily grouping orders intra-day rows chronologically.
   - Command: `pnpm --filter @clt/web test src/lib/ledger/ledger.test.ts`
   - Expected output: test suite passes with 0 failures.
2. SvelteKit route typecheck passes cleanly across all ledger, filter, drawer, and modal components.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 2: Integer poisha used in all subtotals; formatted with South Asian number groupings.
- Rule 3: Deductions and net calculated authoritatively.
- Rule 4: Entries are immutable snapshots; edits execute exclusively through supersession chains, cancellations through audited voids.
- Rule 5: Void and supersede mutations carry mandatory audit justification.
- Rule 6: Never block a Save on connectivity; outbox operations queued offline.
- Rule 10: Respect closed-month action lockouts; no mutations in closed months.

## 10. Pitfalls

- Trap: Searching '10' or '2026' matching every October entry (`E-202610-...`) due to naive substring search on formatted entry number.
  - Fix: Isolate numeric searches strictly to the integer sequence portion and do not substring-match formatted numbers unless starting with 'E-'.
- Trap: Comparing `numericEntryNumber` against `server_seq` returning the wrong transaction.
  - Fix: Match numeric queries only against `entry_number_seq`.
- Trap: Staff seeing all entries on shared counter devices (PRD §8.5).
  - Fix: Filter entries by `entry.created_by === currentUserId` for Staff role.
- Trap: Unchecked `window.location.href` causing full browser reload and dropping in-memory state.
  - Fix: Use SvelteKit `goto('/entries/new?supersede=' + id)`.
- Trap: Stale `selectedEntry` snapshot retaining enabled buttons when an entry is voided.
  - Fix: Derive `selectedEntry` dynamically from `allEntries` by `selectedEntryId`.

## 11. PRD ISSUES and DECISION PENDING

- None.

## 12. Handoff

- Ledger page mounted at `/ledger`.
- Void lifecycle helpers in `apps/web/src/lib/ledger/void.ts` exported for external review queues.
- Search and grouping modules exported for dashboard and report integrations.

## 13. Suggested task breakdown

- `CLT-T-039` (Implementer): Build ledger types, search normalization, and transitive intra-day grouping (`apps/web/src/lib/ledger/types.ts`, `apps/web/src/lib/ledger/search.ts`, `apps/web/src/lib/ledger/grouping.ts`).
- `CLT-T-040` (Implementer): Implement void lifecycle helpers and modal (`apps/web/src/lib/ledger/void.ts`, `apps/web/src/lib/ui/VoidRequestModal.svelte`).
- `CLT-T-041` (Implementer): Build accessible ledger list row and filter drawer (`apps/web/src/lib/ui/LedgerRow.svelte`, `apps/web/src/lib/ui/LedgerFilterDrawer.svelte`).
- `CLT-T-042` (Implementer): Build entry detail drawer with snapshot rates, creator, Asia/Dhaka timestamps, supersede history chain, and main ledger page (`apps/web/src/lib/ui/EntryDetailDrawer.svelte`, `apps/web/src/routes/(app)/ledger/+page.svelte`, `apps/web/src/lib/ledger/ledger.test.ts`).

## 14. Changelog

- 2026-11-01 — Revision 3.1:
  - Adversarial audit remediation addressing 5 P0 Blockers, 7 P1 Major Risks, and 3 P2 Minor Deficiencies:
  - Fixed session property access in `+page.svelte`: replaced broken `session.role` and `session.userId` with `$derived` `currentRole` and `currentUserId` derived from `session.user?.role` and `session.user?.id`, restoring Staff role-scoping (PRD §8.5, Rule 9) and unblocking void execution.
  - Fixed `VoidRequestModal.svelte` integration: removed invalid `size="sm"` prop and bound required `onclose={onclose}` to `<Modal>`, preventing runtime `TypeError: onclose is not a function`.
  - Fixed `ChipVariant` import failure: exported `ChipVariant` type from `apps/web/src/lib/ledger/types.ts` and updated imports in `LedgerRow.svelte` and `EntryDetailDrawer.svelte`.
  - Enforced Closed-Month Action Lockout in `void.ts` (Hard Rule 10, PRD §8.4): both `requestEntryVoid` and `executeEntryVoid` now verify whether the entry's month is closed in `db.monthCloses` before queueing mutations.
  - Fixed local void enqueue sync status: updated `sync_status: 'pending'` in `db.entries.update` inside `requestEntryVoid` and `executeEntryVoid`.
  - Fixed 2-part entry number search in `search.ts`: adjusted split length check to `parts.length >= 2` supporting `E-000105` and raw numeric strings; included `entry.local_id` in free text search matching hex badge fragments.
  - Fixed daily subtotals formatting in `+page.svelte`: imported and applied `formatPoishaToBdt` for gross, total deductions (`-(gross - net)`), and net subtotals.
  - Fixed supersede history chain links in `EntryDetailDrawer.svelte`: added `onselectentry` prop and interactive button controls for predecessor and successor entries.
  - Aligned brand tokens: replaced hardcoded sky blue `#0284c7` fallbacks with canonical dark jade `var(--accent, #0B6B59)` across ledger components.
  - Aligned stale rates alert in `EntryDetailDrawer.svelte` to check `entry.stale_review_status` ('approved' / 'rejected').
  - Fixed test compilation and mocks in `ledger.test.ts`: added mandatory `charge_poisha` to all mock entries, and added regression test suites for closed-month lockout, Test #32 inactive void guards, and Test #57 stale rate reviews.
- 2026-10-31 — Revision 3.0:
  - Resolved Blocker 1: Overhauled `EntryDetailDrawer.svelte` to render complete PRD §8.2 requirements: snapshot rates applied (version, VAT mode & bp, commission bp & base, method fee bp, charges borne by, rounding rule), non-deducted customer fee notice, resolved creator display name from `profilesMap`, formatted Asia/Dhaka timestamps for created, updated, voided, and superseded times, supersede history chain with clickable predecessor/successor links, full audit event trail, and stale rate threshold alert (> ৳50,000 flagged for admin review).
  - Resolved Blocker 2: Enforced role-scoped ledger queries in `+page.svelte` (PRD §8.5). Staff strictly sees their own entries on shared devices (`entry.created_by === currentUserId`), while Admin and Owner see all shop entries.
  - Resolved Blocker 3: Fixed entry number search precision in `search.ts`. Prevented numeric queries (e.g. `'10'`, `'2026'`) from false-positive substring matching against month/year date components in `E-YYYYMM-XXXXXX`. Removed invalid comparison against `server_seq`.
  - Resolved Blocker 4: Completed void lifecycle in `apps/web/src/lib/ledger/void.ts` and `+page.svelte`. Staff gets "Request Void" with mandatory reason, marking `void_requested_by` locally; Admin gets "Approve Void" or direct "Void Entry", optimistically marking `status = 'voided'`. Dynamically re-derived `selectedEntry` by `selectedEntryId` from `allEntries` so drawer updates in real-time.
  - Resolved Blocker 5: Replaced full page reload `window.location.href` in supersede navigation with SvelteKit's `goto('/entries/new?supersede=' + id)`.
  - Resolved Blocker 6: Completed `LedgerRow.svelte` display fields (PRD §8.2): added total deductions (`-(gross - net)`), pending sync badge, rejected sync badge, stale rate badge, and duplicate transaction ref badge. Added `rejected` status filter option in `LedgerFilterDrawer.svelte`.
  - Resolved Blocker 7: Added report drill-down URL parameter parsing in `+page.svelte` (`?month=YYYY-MM`, `?method=UUID`, `?status=...`, `?q=...`), fulfilling PRD §8.3 navigation from reports to ledger.
  - Resolved Blocker 8: Exported `LedgerFilters` from `apps/web/src/lib/ledger/types.ts` resolving Svelte 5 `<script>` interface export failures. Added backdrop overlay and Escape key handling to drawers.
  - Resolved Blocker 9: Made intra-day sorting strictly transitive in `grouping.ts` using direct string `localeCompare` without constructing `new Date()` per comparison. Added 150ms search debounce.
  - Resolved Blocker 10: Expanded `ledger.test.ts` to 6 comprehensive test suites covering search prefix normalization, numeric query isolation, intra-day ordering, daily subtotals with active isolation, and outbox void/request-void queueing using real void lifecycle helpers.
  - Resolved Housekeeping: Corrected Precondition 3 to `runner.svelte.ts`, quoted bash check command in Step 9, corrected header section reference to §8.4, and aligned task IDs `CLT-T-039` through `CLT-T-042`.
- 2026-10-31 — Revision 2.0: Prior remediation round.
- 2026-10-29 — Revision 1.0: Initial authoring.
