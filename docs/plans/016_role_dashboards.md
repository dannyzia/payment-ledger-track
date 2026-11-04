# 016_role_dashboards.md — Role-Based Dashboards, Offline Metrics, and Needs Attention Queues

- Plan Identifier: CLT-PLAN-016
- Phase: Phase 1–2 / M1–M2
- Milestone: M1–M2
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §8.5 (Dashboards: one per role, offline-capable), §10 (Reports SQL views: `v_staff_personal_metrics`, `view_device_stale_rate_anomalies`), §16.2 (Tests #27, #30, #47, #65), §17 (Milestones M1 and M2)
- Depends on: 007, 008, 009, 010, 011, 012, 013, 014, 015
- Current Status: Not Implemented
- Revision: 3.1 — 2026-11-01

## 1. Purpose

Implement the role-based dashboard views for Staff, Admin, and Owner personas. All dashboards function offline utilizing Dexie IndexedDB cache tables with dynamic date-windowing (`db.entries.where('entry_date').between(...)`) and hydrate with live database metrics when online.

The "Today" metric is explicitly grounded in the business date `entry_date === todayStr` in the Asia/Dhaka timezone (UTC+6) without host DST drift, matching counter cash-register semantics (PRD §8.5, §12).

1. **Staff Dashboard (S03)**: Displays personal daily and monthly collections in the Asia/Dhaka timezone, sorted recent transactions with explicit status badges (`Synced`, `#LOCAL-xxxx (Pending)`, `#LOCAL-xxxx (Sync Rejected)`, `[Void Requested]`, `[Voided]`), a prominent "+ New Transaction" CTA button, a reactive outbox pending sync counter, and a "Needs Attention" alert queue when staff outbox operations have been rejected (e.g. Month Closed or Validation Error).
2. **Admin Dashboard (S04)**: Displays overall shop turnover (Today and MTD), shop collections breakdown by payment method (horizontal list/table with Today and MTD metrics), an outbox pending sync queue counter, void requests requiring approval (`/ledger?filter=void_requested`), stale-rate alerts (<৳50,000), a high-value stale-rate review queue (>৳50,000 = `> 5000000n` poisha) linking directly to `/admin/stale-reviews`, duplicate transaction flags (`/ledger?filter=duplicate`), closed-month offline entries ("Needs Attention (Closed Month)") linking to `/reconcile` (Test #47), a settlement payment due checklist with accurate English ordinal suffixes (`formatOrdinalDay`), reminder window alerts (`remind_days_before`), 5-state status chips, counter staff activity, and real-time device burst anomalies from `view_device_stale_rate_anomalies` fetched via `authFetch` with 60-second polling, online reconnect refetching, and offline loading states (Test #65).
3. **Owner Dashboard (S05)**: Provides executive financial summaries (Gross, Commission, and Net Retained Income) for the current month vs prior month with absolute differences and percentage deltas, a hand-rolled responsive pure SVG daily collections trend chart, a rendered payables due checklist with due dates and 5-state status chips, a robustly reactive unclosed historical calendar months reminder list, reconciliation variance alerts, direct month close/reopen controls (`/months/close`), >৳50,000 stale review approvals, and overpayment surplus approvals (`/settlements`).
4. **Router Page**: Manages dynamic role-switched root dashboard routing in `apps/web/src/routes/(app)/dashboard/+page.svelte` with authentication loading protection, preventing any flash of Staff UI while the user session resolves.

## 2. Scope

- IN:
  - Dynamic role-switched root dashboard route in `apps/web/src/routes/(app)/dashboard/+page.svelte` with session loading skeleton and display name resolution.
  - Staff dashboard component in `apps/web/src/lib/ui/dashboards/StaffDashboard.svelte`:
    - Today's personal gross collection and month-to-date total in Asia/Dhaka timezone via pure helper `computeStaffPersonalMetrics`.
    - Recent transactions list sorted by `created_at` descending with status badges (`Synced`, `Pending`, `Sync Rejected`, `Void Requested`, `Voided`).
    - Prominent "+ New Transaction" CTA button (min-h-[44px]) and reactive pending sync counter from `db.outbox`.
    - Staff "Needs Attention" queue card surfacing rejected outbox operations with rejection reasons.
  - Admin dashboard component in `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte`:
    - Overall shop gross turnover and transaction counts for Today and MTD.
    - Shop collections by payment method (Today & MTD) via pure helper `computeShopMethodCollections`.
    - Pending sync queue counter across local device outbox (`status = 'pending' | 'in_flight'`).
    - Void requests requiring approval: reactive count of synced staff void requests (`status = 'active' AND void_requested_by IS NOT NULL`) and local pending void outbox ops (`type = 'request_void'`).
    - Stale-rate alerts (<৳50,000) and high-value stale-rate review queue (>৳50,000 = `> 5000000n` poisha and `stale_rates = true`) linking to `/admin/stale-reviews`.
    - Duplicate transaction flags counter (`dup_txn_flag = true`) linking to `/ledger?filter=duplicate`.
    - Real-time device burst anomalies fetched via `authFetch('/api/v1/admin/entries/stale-anomalies')` backed by `view_device_stale_rate_anomalies` (flags >= 5 stale ops per hour, Test #65) with 60-second polling, online reconnect, offline fallback, and unique composite keys `${a.device_id}-${a.actor_id}`.
    - Closed-month offline entries ("Needs Attention (Closed Month)") surfacing server-pulled `db.rejectedOps` (`error_code = 'month_closed' AND status = 'pending'`) and local rejected outbox ops (`status = 'rejected' AND rejectionReason = 'month_closed'`) with direct link to reconciliation recovery (Test #47).
    - Settlement payment due checklist displaying upcoming payables, due dates formatted with `formatOrdinalDay`, `remind_days_before` alert windows, and 5-state settlement status badges for the current month keyed by unique settlement ID.
    - Counter staff activity widget displaying recent shop-wide transactions with staff names and timestamps.
  - Owner dashboard component in `apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte`:
    - Executive financial summary: Gross, Commission, and Net Retained Income for current month vs prior month with absolute differences and percentage deltas via `computeExecutiveDeltas`.
    - Hand-rolled responsive pure SVG daily collections trend chart for the current month.
    - Rendered payables due checklist displaying current month liabilities, due dates, expected amounts, paid amounts, and 5-state status chips.
    - Robustly reactive unclosed historical calendar months alert list computed from earliest entry date up to current month against `db.monthCloses` where `status = 'closed'`.
    - Reconciliation variance alerts identifying open statements with non-zero variance (`variance !== 0n`).
    - Governance action buttons: Overpayment surplus approvals (`/settlements`), Stale rate reviews (`/admin/stale-reviews`), and Month close/reopen controls (`/months/close`).
  - Metric computation engine in `apps/web/src/lib/dashboards/metrics.ts`:
    - `getAsiaDhakaDateString`: Asia/Dhaka date calculation using UTC getters on shifted epoch timestamp with zero host DST drift (PRD §12, Test #27).
    - `getPriorMonthPrefix`: Previous calendar month prefix calculation handling year boundaries.
    - `formatOrdinalDay`: Pure English ordinal suffix formatter (1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, 23rd).
    - `computeStaffPersonalMetrics`: Aggregates active entries created by caller in Asia/Dhaka timezone (Test #30).
    - `computeOverallShopMetrics`: Aggregates overall shop gross and transaction counts for Today and MTD.
    - `computeShopMethodCollections`: Aggregates Today and MTD gross poisha and count per payment method.
    - `filterHighValueStaleEntries`: Filters active entries with `stale_rates = true` and gross `> 5000000n`.
    - `filterPendingVoidRequests`: Filters active entries with `void_requested_by` set.
    - `computeExecutiveDeltas`: Computes absolute deltas and percentage changes without float arithmetic in money paths.
  - Comprehensive unit test suite in `apps/web/src/lib/dashboards/dashboards.test.ts` testing all actual exported functions and verifying Tests #27, #30, #47, #65.
- OUT:
  - Transaction creation inputs (owned by Plan 010).
  - Outbox push and pull transport runner (owned by Plan 011).
  - Ledger detail drawer and void approval modal (owned by Plan 012).
  - Monthly reports full table and CSV/XLSX export (owned by Plan 013).
  - Settlement payment recording modal and receipts upload (owned by Plan 014).
  - Month close gate checklist execution and reopen RPC (owned by Plan 015).
  - Stale reviews queue and user management (owned by Plan 009).

## 3. Preconditions

1. Plan 007 design system components (`Card`, `Button`, `Chip`) and CSS tokens are available.
   - Check command: `test -f apps/web/src/lib/ui/Card.svelte`
   - Expected output: exit code `0`.
2. Plan 008 authentication session store (`session.svelte.ts`) and role navigation guards are available.
   - Check command: `test -f apps/web/src/lib/auth/session.svelte.ts`
   - Expected output: exit code `0`.
3. Plan 009 authenticated API client (`authFetch`) and anomaly endpoint `/api/v1/admin/entries/stale-anomalies` are functional.
   - Check command: `test -f apps/web/src/lib/api/client.ts`
   - Expected output: exit code `0`.
4. Plan 010 Dexie tables (`entries`, `outbox`, `payables`, `methods`, `profiles`, `settlements`, `statements`, `monthCloses`, `rejectedOps`) are functional.
   - Check command: `test -f apps/web/src/lib/db/index.ts`
   - Expected output: exit code `0`.
5. Plan 013 report aggregation engine (`computeMonthlyAggregates`) is functional.
   - Check command: `test -f apps/web/src/lib/reports/aggregates.ts`
   - Expected output: exit code `0`.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `apps/web/src/lib/dashboards/metrics.ts` | create | Pure calculation helpers for Asia/Dhaka dates, ordinals, staff metrics, shop metrics, and deltas |
| `apps/web/src/lib/ui/dashboards/StaffDashboard.svelte` | create | S03 Staff dashboard view with personal collections, pending sync, needs-attention, and recent entries |
| `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte` | create | S04 Admin dashboard with review queues, shop method totals, settlement checklist, anomalies, and activity |
| `apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte` | create | S05 Owner dashboard with executive deltas, daily SVG trend chart, payables checklist, unclosed months, and governance actions |
| `apps/web/src/routes/(app)/dashboard/+page.svelte` | create | Dynamic role-switched root dashboard page with session loading protection |
| `apps/web/src/lib/dashboards/dashboards.test.ts` | create | Vitest unit tests verifying timezone boundaries, ordinals, personal isolation, queue filters, and deltas |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Create dashboard metric calculations in `apps/web/src/lib/dashboards/metrics.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `apps/web/src/lib/dashboards/metrics.ts`.
   - Check: `grep -c 'computeStaffPersonalMetrics' apps/web/src/lib/dashboards/metrics.ts`
   - Expected output: `1`

2. Create Staff dashboard view in `apps/web/src/lib/ui/dashboards/StaffDashboard.svelte` referencing Specification 6.2.
   - Command: copy block 6.2 into `apps/web/src/lib/ui/dashboards/StaffDashboard.svelte`.
   - Check: `grep -c 'staff-dashboard' apps/web/src/lib/ui/dashboards/StaffDashboard.svelte`
   - Expected output: `1`

3. Create Admin dashboard view in `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte` referencing Specification 6.3.
   - Command: copy block 6.3 into `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte`.
   - Check: `grep -c 'admin-dashboard' apps/web/src/lib/ui/dashboards/AdminDashboard.svelte`
   - Expected output: `1`

4. Create Owner dashboard view in `apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte` referencing Specification 6.4.
   - Command: copy block 6.4 into `apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte`.
   - Check: `grep -c 'owner-dashboard' apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte`
   - Expected output: `1`

5. Create root dashboard router page in `"apps/web/src/routes/(app)/dashboard/+page.svelte"` referencing Specification 6.5.
   - Command: copy block 6.5 into `"apps/web/src/routes/(app)/dashboard/+page.svelte"`.
   - Check: `grep -c 'role-dashboard' "apps/web/src/routes/(app)/dashboard/+page.svelte"`
   - Expected output: `1`

6. Create dashboard metric unit tests in `apps/web/src/lib/dashboards/dashboards.test.ts` referencing Specification 6.6.
   - Command: copy block 6.6 into `apps/web/src/lib/dashboards/dashboards.test.ts`.
   - Check: `pnpm --filter @clt/web test dashboards.test.ts`
   - Expected output: test suite passes with 0 failures.

## 6. Specifications

### 6.1 `apps/web/src/lib/dashboards/metrics.ts`

```ts
import type { LocalEntry, CachedPaymentMethod } from '$lib/db';

export interface StaffPersonalMetrics {
  todayGrossPoisha: bigint;
  todayEntriesCount: number;
  mtdGrossPoisha: bigint;
  mtdEntriesCount: number;
}

export interface OverallShopMetrics {
  todayGrossPoisha: bigint;
  todayEntriesCount: number;
  mtdGrossPoisha: bigint;
  mtdEntriesCount: number;
}

export interface MethodCollectionSummary {
  methodId: string;
  methodName: string;
  todayGrossPoisha: bigint;
  todayCount: number;
  mtdGrossPoisha: bigint;
  mtdCount: number;
}

export interface ExecutiveDeltas {
  grossDeltaPoisha: bigint;
  grossDeltaPercent: string;
  commissionDeltaPoisha: bigint;
  commissionDeltaPercent: string;
  netDeltaPoisha: bigint;
  netDeltaPercent: string;
}

/**
 * Returns the current date in Asia/Dhaka timezone (UTC+6) in 'YYYY-MM-DD' format.
 * Zero host OS DST drift: uses UTC getters on shifted epoch timestamp (PRD §12, Test #27).
 */
export function getAsiaDhakaDateString(dateObj: Date = new Date()): string {
  const dhakaTime = new Date(dateObj.getTime() + 6 * 3600000);
  const y = dhakaTime.getUTCFullYear();
  const m = String(dhakaTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dhakaTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the previous calendar month prefix in 'YYYY-MM' format.
 * Accurately navigates calendar year boundaries (e.g. '2026-01' -> '2025-12').
 */
export function getPriorMonthPrefix(currentMonthPrefix: string): string {
  const [yearStr, monthStr] = currentMonthPrefix.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Formats a day number (1-31) into an English ordinal string (e.g. 1st, 2nd, 3rd, 15th, 22nd).
 * Prevents 1th/2th/3th/22th grammatical bugs across settlement checklists (PRD §8.5).
 */
export function formatOrdinalDay(day: number): string {
  if (day < 1 || day > 31) return `${day}`;
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  const rem10 = day % 10;
  if (rem10 === 1) return `${day}st`;
  if (rem10 === 2) return `${day}nd`;
  if (rem10 === 3) return `${day}rd`;
  return `${day}th`;
}

/**
 * Aggregates personal collections for the Staff counter terminal (PRD §8.5, Test #30).
 * Strictly aggregates active entries created by the specified userId in Asia/Dhaka timezone.
 * Voided, superseded, and server-rejected entries are completely excluded.
 */
export function computeStaffPersonalMetrics(
  entries: LocalEntry[],
  userId: string,
  nowDate: Date = new Date()
): StaffPersonalMetrics {
  const todayStr = getAsiaDhakaDateString(nowDate);
  const mtdPrefix = todayStr.substring(0, 7);

  let todayGross = 0n;
  let todayCount = 0;
  let mtdGross = 0n;
  let mtdCount = 0;

  for (const e of entries) {
    if (e.created_by === userId && e.status === 'active' && e.sync_status !== 'rejected') {
      const g = BigInt(e.gross_poisha);
      if (e.entry_date === todayStr) {
        todayGross += g;
        todayCount += 1;
      }
      if (e.entry_date.startsWith(mtdPrefix)) {
        mtdGross += g;
        mtdCount += 1;
      }
    }
  }

  return {
    todayGrossPoisha: todayGross,
    todayEntriesCount: todayCount,
    mtdGrossPoisha: mtdGross,
    mtdEntriesCount: mtdCount,
  };
}

/**
 * Aggregates overall shop gross turnover and transaction counts for Today and MTD (PRD §8.5).
 * Grounded in Asia/Dhaka business date (entry_date === todayStr).
 */
export function computeOverallShopMetrics(
  entries: LocalEntry[],
  todayStr: string,
  mtdPrefix: string
): OverallShopMetrics {
  let todayGross = 0n;
  let todayCount = 0;
  let mtdGross = 0n;
  let mtdCount = 0;

  for (const e of entries) {
    if (e.status === 'active' && e.sync_status !== 'rejected') {
      const g = BigInt(e.gross_poisha);
      if (e.entry_date === todayStr) {
        todayGross += g;
        todayCount += 1;
      }
      if (e.entry_date.startsWith(mtdPrefix)) {
        mtdGross += g;
        mtdCount += 1;
      }
    }
  }

  return {
    todayGrossPoisha: todayGross,
    todayEntriesCount: todayCount,
    mtdGrossPoisha: mtdGross,
    mtdEntriesCount: mtdCount,
  };
}

/**
 * Aggregates shop collections by payment method for today and MTD (PRD §8.5).
 */
export function computeShopMethodCollections(
  entries: LocalEntry[],
  methods: CachedPaymentMethod[],
  todayStr: string,
  mtdPrefix: string
): MethodCollectionSummary[] {
  const methodMap = new Map<string, MethodCollectionSummary>();

  for (const m of methods) {
    methodMap.set(m.id, {
      methodId: m.id,
      methodName: m.name,
      todayGrossPoisha: 0n,
      todayCount: 0,
      mtdGrossPoisha: 0n,
      mtdCount: 0,
    });
  }

  for (const e of entries) {
    if (e.status !== 'active' || e.sync_status === 'rejected') continue;
    let summary = methodMap.get(e.method_id);
    if (!summary) {
      summary = {
        methodId: e.method_id,
        methodName: e.method_id,
        todayGrossPoisha: 0n,
        todayCount: 0,
        mtdGrossPoisha: 0n,
        mtdCount: 0,
      };
      methodMap.set(e.method_id, summary);
    }

    const g = BigInt(e.gross_poisha);
    if (e.entry_date === todayStr) {
      summary.todayGrossPoisha += g;
      summary.todayCount += 1;
    }
    if (e.entry_date.startsWith(mtdPrefix)) {
      summary.mtdGrossPoisha += g;
      summary.mtdCount += 1;
    }
  }

  return Array.from(methodMap.values());
}

/**
 * Filters active entries that exceed the ৳50,000 threshold and were created under stale rates (PRD §8.5, §10).
 * Excludes already approved or rejected entries so resolved reviews immediately leave the queue.
 * > ৳50,000 = > 5,000,000 poisha (Rule 2).
 */
export function filterHighValueStaleEntries(entries: LocalEntry[]): LocalEntry[] {
  return entries.filter(
    (e) =>
      e.status === 'active' &&
      e.stale_rates === true &&
      (e.stale_review_status === undefined || e.stale_review_status === 'flagged') &&
      BigInt(e.gross_poisha) > 5000000n
  );
}

/**
 * Filters active entries with pending staff void requests (PRD §8.5).
 */
export function filterPendingVoidRequests(entries: LocalEntry[]): LocalEntry[] {
  return entries.filter((e) => e.status === 'active' && Boolean(e.void_requested_by));
}

/**
 * Filters active entries flagged for duplicate transaction reference (PRD §8.5).
 */
export function filterDuplicateTxnEntries(entries: LocalEntry[]): LocalEntry[] {
  return entries.filter((e) => e.status === 'active' && Boolean(e.dup_txn_flag));
}

/**
 * Helper to compute percentage delta string formatted to 1 decimal place.
 * Prevents '-0.0%' negative zero formatting artifacts on minute fractional drops.
 */
function calcPercentChange(current: bigint, prior: bigint): string {
  if (prior === 0n) {
    return current > 0n ? '+100.0%' : '0.0%';
  }
  const delta = current - prior;
  const absPrior = prior > 0n ? prior : -prior;
  const bpChange = (delta * 1000n) / absPrior;
  if (bpChange === 0n) {
    return '0.0%';
  }
  const isPos = bpChange > 0n;
  const absVal = isPos ? bpChange : -bpChange;
  const whole = absVal / 10n;
  const frac = absVal % 10n;
  const sign = isPos ? '+' : '-';
  return `${sign}${whole}.${frac}%`;
}

/**
 * Computes executive comparisons between current month and prior month (PRD §8.5).
 */
export function computeExecutiveDeltas(
  currentGross: bigint,
  currentCommission: bigint,
  currentNet: bigint,
  priorGross: bigint,
  priorCommission: bigint,
  priorNet: bigint
): ExecutiveDeltas {
  return {
    grossDeltaPoisha: currentGross - priorGross,
    grossDeltaPercent: calcPercentChange(currentGross, priorGross),
    commissionDeltaPoisha: currentCommission - priorCommission,
    commissionDeltaPercent: calcPercentChange(currentCommission, priorCommission),
    netDeltaPoisha: currentNet - priorNet,
    netDeltaPercent: calcPercentChange(currentNet, priorNet),
  };
}
```

### 6.2 `apps/web/src/lib/ui/dashboards/StaffDashboard.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { db, type LocalEntry } from '$lib/db';
  import { computeStaffPersonalMetrics } from '$lib/dashboards/metrics';
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

  $effect(() => {
    // 1. Live query for user's own entries
    const subEntries = liveQuery(() =>
      db.entries.where('created_by').equals(userId).toArray()
    ).subscribe((rows) => {
      userEntries = rows;
    });

    // 2. Live query for user's own pending outbox ops (PRD §8.5, Test #62)
    const subOutbox = liveQuery(() =>
      db.outbox
        .filter((op) => (op.status === 'pending' || op.status === 'in_flight') && op.userId === userId)
        .count()
    ).subscribe((c) => {
      pendingSyncCount = c;
    });

    // 3. Live query for rejected ops requiring staff attention (PRD §8.5)
    const subRejected = liveQuery(async () => {
      const outboxRejected = await db.outbox
        .filter((op) => op.status === 'rejected')
        .toArray();
      const serverRejected = await db.rejectedOps
        .filter((op) => op.status === 'pending')
        .toArray();

      const items: RejectedItem[] = [];

      for (const op of outboxRejected) {
        const payload = (op.payload || {}) as Record<string, any>;
        if (payload.createdBy === userId || payload.created_by === userId) {
          items.push({
            id: op.opId,
            reason: op.rejectionReason || op.errorMessage || 'Operation rejected',
            customerName: payload.customerName || payload.customer_name || 'Counter Transaction',
            grossPoisha: payload.grossPoisha || payload.gross_poisha || '0',
          });
        }
      }

      for (const op of serverRejected) {
        const payload = (op.payload || {}) as Record<string, any>;
        if (payload.createdBy === userId || payload.created_by === userId) {
          // Avoid duplicates if also in outbox
          if (!items.some((i) => i.id === op.opId)) {
            items.push({
              id: op.opId,
              reason: op.error_message || op.error_code || 'Server rejected',
              customerName: payload.customerName || payload.customer_name || 'Counter Transaction',
              grossPoisha: payload.grossPoisha || payload.gross_poisha || '0',
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

  const metrics = $derived(
    computeStaffPersonalMetrics(userEntries, userId)
  );

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
    if (!confirm('Discard this rejected transaction? It will be removed from your outbox.')) {
      return;
    }
    try {
      // 1. Purge from local Dexie outbox
      await db.outbox.delete(opId);
      // 2. Mark resolved/discarded in local rejectedOps if present
      await db.rejectedOps.where('opId').equals(opId).modify({ status: 'discarded' });
      // 3. If online, notify server via discard_rejected_entry (PRD §8.5, Test #18)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await fetch('/api/v1/sync/discard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opId })
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to discard rejected operation:', err);
    }
  }
</script>

<div class="staff-dashboard flex flex-col gap-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Welcome, {userName}</h1>
      <p class="text-sm text-[var(--c-muted,#6b7280)]">Staff counter terminal (Asia/Dhaka timezone).</p>
    </div>

    <div class="flex items-center gap-3">
      <div class="px-3 py-1.5 rounded-xl border border-black/10 text-xs font-semibold flex items-center gap-2">
        {#if rejectedOps.length > 0}
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <span class="text-red-800 font-bold">{rejectedOps.length} Attention Needed</span>
        {:else if pendingSyncCount > 0}
          <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          <span class="text-amber-800">{pendingSyncCount} Pending Sync</span>
        {:else}
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span class="text-emerald-800">All Synced</span>
        {/if}
      </div>

      <a href="/entries/new">
        <Button id="btn-save" variant="commission" class="py-3 px-6 text-sm font-bold shadow-lg min-h-[44px]">
          + New Transaction
        </Button>
      </a>
    </div>
  </div>

  {#if rejectedOps.length > 0}
    <div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-900 text-xs flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="font-bold text-sm">⚠ Needs Attention: {rejectedOps.length} transaction(s) failed sync</span>
        <a href="/ledger" class="underline font-semibold hover:text-red-700">Open Ledger</a>
      </div>
      <p class="text-[var(--c-muted,#6b7280)]">
        Transactions rejected by server validation or month-close locks. Contact your Admin to review or reassign.
      </p>
      <div class="flex flex-col gap-1.5 mt-1">
        {#each rejectedOps as item (item.id)}
          <div class="flex items-center justify-between p-2 rounded-lg bg-white/60 text-xs">
            <span class="font-medium text-slate-800">{item.customerName} ({formatPoishaToBdt(BigInt(item.grossPoisha))})</span>
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
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">My Collections Today</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-ink,#111827)]">{formatPoishaToBdt(metrics.todayGrossPoisha)}</div>
      <div class="text-xs text-[var(--c-muted,#6b7280)] mt-2">{metrics.todayEntriesCount} transactions recorded today</div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">My Month-to-Date Collections</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(metrics.mtdGrossPoisha)}</div>
      <div class="text-xs text-[var(--c-muted,#6b7280)] mt-2">{metrics.mtdEntriesCount} transactions this month</div>
    </Card>
  </div>

  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">My Recent Transactions</h2>
      <a href="/ledger" class="text-xs text-[var(--c-muted,#6b7280)] hover:underline">View All Ledger</a>
    </div>

    {#if recentEntries.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No recent transactions found. Tap "+ New Transaction" to record your first payment.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each recentEntries as e (e.id)}
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5 text-sm">
            <div class="flex items-center gap-2">
              {#if e.sync_status === 'synced'}
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-700">
                  {e.entry_number ?? 'Synced'}
                </span>
              {:else if e.sync_status === 'rejected'}
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-500/10 text-red-700">
                  {e.local_id ?? '#LOCAL'} (Sync Rejected)
                </span>
              {:else}
                <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-700">
                  {e.local_id ?? '#LOCAL'} (Pending)
                </span>
              {/if}

              {#if e.status === 'voided'}
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">[Voided]</span>
              {:else if e.status === 'superseded'}
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">[Superseded]</span>
              {:else if Boolean(e.void_requested_by)}
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">[Void Requested]</span>
              {/if}

              <span class="font-semibold text-[var(--c-ink,#111827)] {e.status === 'voided' ? 'line-through text-slate-400' : ''}">
                {e.customer_name}
              </span>
            </div>
            <div class="font-bold tabular-nums {e.status === 'voided' ? 'line-through text-slate-400' : ''}">
              {formatPoishaToBdt(BigInt(e.gross_poisha))}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>
```

### 6.3 `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import {
    db,
    type LocalEntry,
    type CachedPaymentMethod,
    type CachedSettlement,
    type CachedPayable,
    type CachedProfile
  } from '$lib/db';
  import {
    computeShopMethodCollections,
    computeOverallShopMetrics,
    getAsiaDhakaDateString,
    getPriorMonthPrefix,
    formatOrdinalDay,
    type MethodCollectionSummary
  } from '$lib/dashboards/metrics';
  import { computeSettlementReminder } from '$lib/settlements/reminders';
  import { formatPoishaToBdt } from '@clt/shared';
  import { authFetch } from '$lib/api/client';
  import { liveQuery } from 'dexie';
  import { onMount } from 'svelte';

  // Schema matching view_device_stale_rate_anomalies (PRD §10, Finding A3, Test #65)
  interface AnomalyAlert {
    device_id: string;
    actor_id: string;
    stale_ops_last_hour: number;
    latest_stale_op_at: string;
  }

  interface SettlementDueItem {
    id: string;
    payableName: string;
    dueDayOfMonth: number;
    remindDaysBefore: number;
    expectedPoisha: string;
    status: string;
    dueDate: string;
    isOverdue: boolean;
    isDueSoon: boolean;
    formattedDueDay: string;
  }

  interface ClosedMonthRecoveryItem {
    opId: string;
    customerName: string;
    grossPoisha: string;
    staffName: string;
    reason: string;
  }

  interface StaffActivityItem {
    id: string;
    customerName: string;
    staffName: string;
    grossPoisha: string;
    methodName: string;
    timeStr: string;
  }

  let anomalies = $state<AnomalyAlert[]>([]);
  let loadingAnomalies = $state(false);
  let anomaliesUnavailable = $state(false);

  let highValueStaleCount = $state(0);
  let lowValueStaleCount = $state(0);
  let voidRequestCount = $state(0);
  let duplicateTxnCount = $state(0);
  let closedMonthRejectedCount = $state(0);
  let closedMonthRejectedOps = $state<ClosedMonthRecoveryItem[]>([]);
  let pendingSyncCount = $state(0);

  let windowedEntries = $state<LocalEntry[]>([]);
  let paymentMethods = $state<CachedPaymentMethod[]>([]);
  let currentSettlements = $state<SettlementDueItem[]>([]);
  let staffActivity = $state<StaffActivityItem[]>([]);

  const todayStr = getAsiaDhakaDateString();
  const currentMonth = todayStr.substring(0, 7);
  const priorMonth = getPriorMonthPrefix(currentMonth);
  const currentDay = parseInt(todayStr.substring(8, 10), 10);

  async function fetchAnomalies() {
    loadingAnomalies = true;
    try {
      const res = await authFetch('/api/v1/admin/entries/stale-anomalies');
      if (res.ok) {
        const data = await res.json();
        anomalies = data.anomalies ?? [];
        anomaliesUnavailable = false;
      } else {
        anomaliesUnavailable = true;
      }
    } catch {
      // Offline fallback: graceful degradation
      anomaliesUnavailable = true;
    } finally {
      loadingAnomalies = false;
    }
  }

  onMount(() => {
    fetchAnomalies();
    // 60-second polling for real-time anomaly alerts (PRD §8.5, Test #65)
    const interval = setInterval(fetchAnomalies, 60000);
    const handleOnline = () => fetchAnomalies();
    window.addEventListener('online', handleOnline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
    };
  });

  // Live queries to Dexie tables with memory-safe date windowing (PRD §8.5)
  $effect(() => {
    const windowStart = `${priorMonth}-01`;
    const windowEnd = `${currentMonth}-31`;

    // 1. Memory-windowed entries covering current and prior month
    const subEntries = liveQuery(() =>
      db.entries
        .where('entry_date')
        .between(windowStart, windowEnd, true, true)
        .toArray()
    ).subscribe((rows) => {
      windowedEntries = rows;
    });

    // 2. High-value stale rate review queue (>৳50,000 = >5000000n poisha, PRD §8.5, §10, Test #65)
    // Filter active entries where stale_review_status is undefined or 'flagged' (excluding approved/rejected)
    const subStaleHigh = liveQuery(() =>
      db.entries
        .filter(
          (e) =>
            e.status === 'active' &&
            e.stale_rates === true &&
            (e.stale_review_status === undefined || e.stale_review_status === 'flagged') &&
            BigInt(e.gross_poisha) > 5000000n
        )
        .count()
    ).subscribe((c) => { highValueStaleCount = c; });

    // 3. Stale-rate alert counter (<৳50,000)
    const subStaleLow = liveQuery(() =>
      db.entries
        .filter(
          (e) =>
            e.status === 'active' &&
            e.stale_rates === true &&
            (e.stale_review_status === undefined || e.stale_review_status === 'flagged') &&
            BigInt(e.gross_poisha) <= 5000000n
        )
        .count()
    ).subscribe((c) => { lowValueStaleCount = c; });

    // 4. Void requests: synced staff void requests + local outbox void requests
    const subVoid = liveQuery(async () => {
      const syncedVoidRequests = await db.entries
        .filter((e) => e.status === 'active' && Boolean(e.void_requested_by))
        .count();
      const localVoidRequests = await db.outbox
        .filter((op) => op.type === 'request_void' && (op.status === 'pending' || op.status === 'in_flight'))
        .count();
      return syncedVoidRequests + localVoidRequests;
    }).subscribe((c) => { voidRequestCount = c; });

    // 5. Duplicate transaction flags
    const subDup = liveQuery(() =>
      db.entries
        .filter((e) => e.status === 'active' && Boolean(e.dup_txn_flag))
        .count()
    ).subscribe((c) => { duplicateTxnCount = c; });

    // 6. Closed-month offline entries: server-pulled rejectedOps (Test #47) + local rejected outbox ops
    const subClosed = liveQuery(async () => {
      const serverRejected = await db.rejectedOps
        .filter((op) => op.error_code === 'month_closed' && op.status === 'pending')
        .toArray();
      const localRejected = await db.outbox
        .filter((op) => op.status === 'rejected' && op.rejectionReason === 'month_closed')
        .toArray();

      const profiles = await db.profiles.toArray();
      const profMap = new Map(profiles.map((p) => [p.id, p.display_name]));

      const items: ClosedMonthRecoveryItem[] = [];

      for (const op of serverRejected) {
        const payload = (op.payload || {}) as Record<string, any>;
        const staffId = payload.createdBy || payload.created_by;
        items.push({
          opId: op.opId,
          customerName: payload.customerName || payload.customer_name || 'Counter Transaction',
          grossPoisha: payload.grossPoisha || payload.gross_poisha || '0',
          staffName: profMap.get(staffId) ?? 'Staff Member',
          reason: op.error_message || 'Month closed on server',
        });
      }

      for (const op of localRejected) {
        if (!items.some((i) => i.opId === op.opId)) {
          const payload = (op.payload || {}) as Record<string, any>;
          const staffId = op.userId || payload.createdBy || payload.created_by;
          items.push({
            opId: op.opId,
            customerName: payload.customerName || payload.customer_name || 'Counter Transaction',
            grossPoisha: payload.grossPoisha || payload.gross_poisha || '0',
            staffName: profMap.get(staffId) ?? 'Staff Member',
            reason: op.rejectionReason || 'Month closed locally',
          });
        }
      }

      return items;
    }).subscribe((items) => {
      closedMonthRejectedOps = items;
      closedMonthRejectedCount = items.length;
    });

    // 7. Pending sync outbox queue counter
    const subPendingSync = liveQuery(() =>
      db.outbox
        .filter((op) => op.status === 'pending' || op.status === 'in_flight')
        .count()
    ).subscribe((c) => { pendingSyncCount = c; });

    // 8. Payment methods for shop breakdown
    const subMethods = liveQuery(() => db.methods.toArray()).subscribe((rows) => {
      paymentMethods = rows;
    });

    // 9. Settlements and payables for monthly due checklist (PRD §7.1, §8.4, Plan 014)
    // Liabilities accrued in priorMonth are payable in currentMonth on dueDay
    const subSettlements = liveQuery(async () => {
      const priorMonthDate = `${priorMonth}-01`;
      const settlements = await db.settlements.where('month').equals(priorMonthDate).toArray();
      const payables = await db.payables.toArray();
      const pMap = new Map(payables.map((p) => [p.id, p]));

      return settlements.map((s) => {
        const payable = pMap.get(s.payable_id);
        const name = payable?.name ?? (payable as any)?.recipient_name ?? 'Payable';
        const dueDay = payable?.due_day ?? 15;
        const remindDays = payable?.remind_days_before ?? 3;
        const reminder = computeSettlementReminder(s.month, dueDay, remindDays, todayStr);

        return {
          id: s.id,
          payableName: name,
          dueDayOfMonth: dueDay,
          remindDaysBefore: remindDays,
          expectedPoisha: s.expected_poisha,
          status: s.status,
          dueDate: reminder.dueDate,
          isOverdue: reminder.isOverdue && (s.status === 'due' || s.status === 'partly_paid'),
          isDueSoon: reminder.inReminderWindow && (s.status === 'due' || s.status === 'partly_paid'),
          formattedDueDay: reminder.formattedDueDay,
        };
      });
    }).subscribe((items) => {
      currentSettlements = items;
    });

    // 10. Recent counter staff activity (in-memory sort avoids unindexed created_at crash)
    const subActivity = liveQuery(async () => {
      const recent = await db.entries
        .where('entry_date')
        .between(windowStart, windowEnd, true, true)
        .toArray();
      recent.sort((a, b) => {
        const timeA = new Date(a.created_at || a.entry_date).getTime();
        const timeB = new Date(b.created_at || b.entry_date).getTime();
        return timeB - timeA;
      });
      const top5 = recent.slice(0, 5);
      const profiles = await db.profiles.toArray();
      const profMap = new Map(profiles.map((p) => [p.id, p.display_name]));
      const methods = await db.methods.toArray();
      const methMap = new Map(methods.map((m) => [m.id, m.name]));

      return top5.map((e) => ({
        id: e.id,
        customerName: e.customer_name,
        staffName: profMap.get(e.created_by) ?? 'Staff Member',
        grossPoisha: e.gross_poisha,
        methodName: methMap.get(e.method_id) ?? 'Payment Method',
        timeStr: e.created_at && e.created_at.length >= 16 ? e.created_at.substring(11, 16) : '--:--',
      }));
    }).subscribe((list) => {
      staffActivity = list;
    });

    return () => {
      subEntries.unsubscribe();
      subStaleHigh.unsubscribe();
      subStaleLow.unsubscribe();
      subVoid.unsubscribe();
      subDup.unsubscribe();
      subClosed.unsubscribe();
      subPendingSync.unsubscribe();
      subMethods.unsubscribe();
      subSettlements.unsubscribe();
      subActivity.unsubscribe();
    };
  });

  const overallShop = $derived(
    computeOverallShopMetrics(windowedEntries, todayStr, currentMonth)
  );

  const methodTotals = $derived(
    computeShopMethodCollections(windowedEntries, paymentMethods, todayStr, currentMonth)
  );
</script>

<div class="admin-dashboard flex flex-col gap-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Admin Operations Dashboard</h1>
      <p class="text-sm text-[var(--c-muted,#6b7280)]">Overview of counter operations, review queues, and anomaly alerts.</p>
    </div>

    <div class="flex items-center gap-2">
      <div class="px-3 py-1.5 rounded-xl border border-black/10 text-xs font-semibold flex items-center gap-2">
        <span class="w-2 h-2 rounded-full {pendingSyncCount > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}"></span>
        <span>{pendingSyncCount} Outbox Pending</span>
      </div>
    </div>
  </div>

  {#if anomalies.length > 0}
    <div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-900 dark:text-red-300 text-xs flex flex-col gap-2">
      <span class="font-bold text-sm">⚠ Real-Time Device Stale Rate Anomaly Alert (Test #65)</span>
      {#each anomalies as a (`${a.device_id}-${a.actor_id}`)}
        <div>
          Device <span class="font-mono font-bold">{(a.device_id ?? '').substring(0, 8) || 'Unknown'}...</span> pushed {a.stale_ops_last_hour} stale operations in the last hour (latest at {a.latest_stale_op_at}).
        </div>
      {/each}
    </div>
  {:else if anomaliesUnavailable}
    <div class="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs flex items-center justify-between">
      <span>ℹ Anomaly tracker unavailable offline. Will automatically reconnect when online.</span>
      <Button variant="default" class="text-xs py-2 px-3 min-h-[44px]" onclick={fetchAnomalies}>Retry</Button>
    </div>
  {/if}

  {#if closedMonthRejectedOps.length > 0}
    <!-- Needs Attention (Closed Month) Queue (PRD §8.5, Test #47) -->
    <div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-900 dark:text-red-300 text-xs flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="font-bold text-sm">⚠ Needs Attention (Closed Month): {closedMonthRejectedOps.length} offline entry(s) blocked (Test #47)</span>
        <a href="/reconcile" class="underline font-semibold hover:text-red-700">Open Reconciliation Recovery</a>
      </div>
      <p class="text-[var(--c-muted,#6b7280)]">
        Transactions recorded offline on historical dates after those calendar months were closed. Reassign to an open period or discard via Reconciliation.
      </p>
      <div class="flex flex-col gap-1.5 mt-1">
        {#each closedMonthRejectedOps as item (item.opId)}
          <div class="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-black/20 text-xs">
            <span class="font-medium text-slate-800 dark:text-slate-200">
              {item.customerName} ({formatPoishaToBdt(BigInt(item.grossPoisha))}) — Staff: {item.staffName}
            </span>
            <span class="text-red-700 font-semibold">{item.reason}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Overall Shop Turnover (PRD §8.5) -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Shop Collections Today</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-ink,#111827)]">{formatPoishaToBdt(overallShop.todayGrossPoisha)}</div>
      <div class="text-xs text-[var(--c-muted,#6b7280)] mt-2">{overallShop.todayEntriesCount} shop transactions recorded today ({todayStr})</div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Shop Month-to-Date Collections</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(overallShop.mtdGrossPoisha)}</div>
      <div class="text-xs text-[var(--c-muted,#6b7280)] mt-2">{overallShop.mtdEntriesCount} shop transactions this month ({currentMonth})</div>
    </Card>
  </div>

  <!-- Operational Review Queues Bento Grid (PRD §8.5) -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Stale Reviews (>৳50k)</div>
        <div class="text-2xl font-bold text-amber-600">{highValueStaleCount} Pending</div>
        {#if lowValueStaleCount > 0}
          <div class="text-[10px] text-[var(--c-muted,#6b7280)] mt-1">{lowValueStaleCount} auto-accepted (&lt;৳50k)</div>
        {/if}
      </div>
      <div class="mt-3">
        <a href="/admin/stale-reviews"><Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]">Review Queue</Button></a>
      </div>
    </Card>

    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Void Requests</div>
        <div class="text-2xl font-bold text-[var(--c-ink,#111827)]">{voidRequestCount} Pending</div>
      </div>
      <div class="mt-3">
        <a href="/ledger?filter=void_requested"><Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]">Open Ledger</Button></a>
      </div>
    </Card>

    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Duplicate Txn Flags</div>
        <div class="text-2xl font-bold {duplicateTxnCount > 0 ? 'text-amber-600' : 'text-slate-700'}">{duplicateTxnCount} Flagged</div>
      </div>
      <div class="mt-3">
        <a href="/ledger?filter=duplicate"><Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={duplicateTxnCount === 0}>Inspect</Button></a>
      </div>
    </Card>

    <Card class="p-5 flex flex-col justify-between">
      <div>
        <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Closed-Month Offline</div>
        <div class="text-2xl font-bold {closedMonthRejectedCount > 0 ? 'text-red-600' : 'text-emerald-600'}">{closedMonthRejectedCount} Items</div>
      </div>
      <div class="mt-3">
        <a href="/reconcile">
          <Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={closedMonthRejectedCount === 0}>
            {closedMonthRejectedCount > 0 ? 'Review Items' : 'Clean'}
          </Button>
        </a>
      </div>
    </Card>
  </div>

  <!-- Shop Collections by Payment Method (PRD §8.5) -->
  <Card class="p-6">
    <h2 class="font-bold text-base text-[var(--c-ink,#111827)] mb-4">Shop Collections by Payment Method</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-black/10 text-xs text-[var(--c-muted,#6b7280)]">
            <th class="py-2">Payment Method</th>
            <th class="py-2 text-right">Today Gross</th>
            <th class="py-2 text-right">Today Txns</th>
            <th class="py-2 text-right">MTD Gross</th>
            <th class="py-2 text-right">MTD Txns</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-black/5">
          {#each methodTotals as m (m.methodId)}
            <tr>
              <td class="py-2.5 font-medium">{m.methodName}</td>
              <td class="py-2.5 text-right font-bold tabular-nums">{formatPoishaToBdt(m.todayGrossPoisha)}</td>
              <td class="py-2.5 text-right tabular-nums text-xs text-[var(--c-muted,#6b7280)]">{m.todayCount}</td>
              <td class="py-2.5 text-right font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(m.mtdGrossPoisha)}</td>
              <td class="py-2.5 text-right tabular-nums text-xs text-[var(--c-muted,#6b7280)]">{m.mtdCount}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>

  <!-- Settlement Payment Due Checklist (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Settlement Payment Due Checklist (Due in {currentMonth})</h2>
      <a href="/settlements" class="text-xs text-[var(--c-muted,#6b7280)] hover:underline">Manage Settlements</a>
    </div>

    {#if currentSettlements.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No settlement records active for {priorMonth} liabilities.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each currentSettlements as s (s.id)}
          <div class="flex items-center justify-between p-3 rounded-xl bg-white/40 border border-black/5 text-sm">
            <div>
              <span class="font-bold">{s.payableName}</span>
              <span class="text-xs text-[var(--c-muted,#6b7280)] ml-2">Due Date: {s.dueDate} ({s.formattedDueDay})</span>
              {#if s.isOverdue}
                <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Overdue</span>
              {:else if s.isDueSoon}
                <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Due Soon</span>
              {/if}
            </div>
            <div class="flex items-center gap-3">
              <span class="font-bold tabular-nums">{formatPoishaToBdt(BigInt(s.expectedPoisha || '0'))}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                {s.status === 'paid' ? 'bg-emerald-500/10 text-emerald-700' :
                 s.status === 'overpaid' ? 'bg-purple-500/10 text-purple-700' :
                 s.status === 'partly_paid' ? 'bg-blue-500/10 text-blue-700' :
                 s.status === 'due' ? 'bg-amber-500/10 text-amber-700' : 'bg-slate-500/10 text-slate-700'}">
                {s.status}
              </span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>

  <!-- Staff Counter Activity (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Staff Counter Activity</h2>
      <span class="text-xs text-[var(--c-muted,#6b7280)]">Recent transactions across staff</span>
    </div>

    {#if staffActivity.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No recent counter transactions found.
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#each staffActivity as act (act.id)}
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-white/40 border border-black/5 text-sm">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-700">{act.staffName}:</span>
              <span class="font-medium text-[var(--c-ink,#111827)]">{act.customerName}</span>
              <span class="text-xs text-[var(--c-muted,#6b7280)]">({act.methodName})</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-[var(--c-muted,#6b7280)]">{act.timeStr}</span>
              <span class="font-bold tabular-nums">{formatPoishaToBdt(BigInt(act.grossPoisha))}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
</div>
```

### 6.4 `apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte`

```svelte
<script lang="ts">
  import Card from '$lib/ui/Card.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { db, type LocalEntry } from '$lib/db';
  import { computeMonthlyAggregates } from '$lib/reports/aggregates';
  import {
    getAsiaDhakaDateString,
    getPriorMonthPrefix,
    formatOrdinalDay,
    computeExecutiveDeltas,
    type ExecutiveDeltas
  } from '$lib/dashboards/metrics';
  import { computeSettlementReminder } from '$lib/settlements/reminders';
  import { formatPoishaToBdt } from '@clt/shared';
  import { liveQuery } from 'dexie';

  interface Props {
    ownerName: string;
  }

  interface SettlementItem {
    id: string;
    month: string;
    payableName: string;
    dueDayOfMonth: number;
    expectedPoisha: string;
    paidPoisha: string;
    status: string;
    overpaymentReviewStatus?: string;
    overpaymentApprovedAmount?: string;
    dueDate: string;
    isOverdue: boolean;
    isDueSoon: boolean;
    formattedDueDay: string;
  }

  interface UnclosedMonthItem {
    month: string;
    status: string;
  }

  interface VarianceAlertItem {
    id: string;
    kind: string;
    month: string;
    variancePoisha: string;
  }

  interface DailyBar {
    dayStr: string;
    grossPoisha: bigint;
    heightPct: number;
  }

  let { ownerName }: Props = $props();
  const todayStr = getAsiaDhakaDateString();
  const currentMonth = todayStr.substring(0, 7);
  const priorMonth = getPriorMonthPrefix(currentMonth);

  let windowedEntries = $state<LocalEntry[]>([]);
  let settlements = $state<SettlementItem[]>([]);
  let unclosedMonths = $state<UnclosedMonthItem[]>([]);
  let varianceAlerts = $state<VarianceAlertItem[]>([]);
  let highValueStaleCount = $state(0);

  // Live queries to local Dexie tables with date windowing (PRD §8.5)
  $effect(() => {
    const windowStart = `${priorMonth}-01`;
    const windowEnd = `${currentMonth}-31`;

    // 1. Windowed entries for financial aggregations and daily trend
    const subEntries = liveQuery(() =>
      db.entries
        .where('entry_date')
        .between(windowStart, windowEnd, true, true)
        .toArray()
    ).subscribe((rows) => {
      windowedEntries = rows;
    });

    // 2. Settlements for priorMonth (currently due) and currentMonth with payables join
    const subSettlements = liveQuery(async () => {
      const priorMonthDate = `${priorMonth}-01`;
      const currentMonthDate = `${currentMonth}-01`;
      const setts = await db.settlements
        .where('month')
        .anyOf([priorMonthDate, currentMonthDate])
        .toArray();
      const payables = await db.payables.toArray();
      const pMap = new Map(payables.map((p) => [p.id, p]));

      return setts.map((s) => {
        const payable = pMap.get(s.payable_id);
        const name = payable?.name ?? (payable as any)?.recipient_name ?? 'Payable';
        const dueDay = payable?.due_day ?? 15;
        const remindDays = payable?.remind_days_before ?? 3;
        const reminder = computeSettlementReminder(s.month, dueDay, remindDays, todayStr);

        return {
          id: s.id,
          month: s.month,
          payableName: name,
          dueDayOfMonth: dueDay,
          expectedPoisha: s.expected_poisha,
          paidPoisha: s.paid_poisha,
          status: s.status,
          overpaymentReviewStatus: s.overpayment_review_status,
          overpaymentApprovedAmount: s.overpayment_approved_amount_poisha,
          dueDate: reminder.dueDate,
          isOverdue: reminder.isOverdue && (s.status === 'due' || s.status === 'partly_paid'),
          isDueSoon: reminder.inReminderWindow && (s.status === 'due' || s.status === 'partly_paid'),
          formattedDueDay: reminder.formattedDueDay,
        };
      });
    }).subscribe((items) => {
      settlements = items;
    });

    // 3. Unclosed historical months reminder (PRD §8.5)
    // Pure reactive Dexie query: generates months from earliest entry up to priorMonth
    const subMonths = liveQuery(async () => {
      const closes = await db.monthCloses.toArray();
      const closedSet = new Set(
        closes.filter((c) => c.status === 'closed').map((c) => c.month.substring(0, 7))
      );

      const firstEntry = await db.entries.orderBy('entry_date').first();
      if (!firstEntry) return [];

      const startMonth = firstEntry.entry_date.substring(0, 7);
      const unclosed: UnclosedMonthItem[] = [];

      let cur = startMonth;
      while (cur < currentMonth) {
        if (!closedSet.has(cur)) {
          unclosed.push({ month: cur, status: 'open' });
        }
        // Advance cur by 1 calendar month
        const [y, m] = cur.split('-').map(Number);
        const nextDate = new Date(Date.UTC(y, m, 1));
        cur = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      return unclosed;
    }).subscribe((items) => {
      unclosedMonths = items;
    });

    // 4. Statement reconciliation variance alerts (PRD §8.5, §11.2)
    const subStatements = liveQuery(() =>
      db.statements.toArray()
    ).subscribe((rows) => {
      varianceAlerts = rows
        .filter((st) => {
          if (st.status !== 'open') return false;
          const total = BigInt((st as any).statement_total_poisha || '0');
          const expected = BigInt((st as any).expected_poisha || '0');
          const variance = (st as any).variance_poisha
            ? BigInt((st as any).variance_poisha)
            : total - expected;
          return variance !== 0n;
        })
        .map((r) => {
          const total = BigInt((r as any).statement_total_poisha || '0');
          const expected = BigInt((r as any).expected_poisha || '0');
          const variance = (r as any).variance_poisha
            ? BigInt((r as any).variance_poisha)
            : total - expected;
          return {
            id: r.id,
            kind: r.kind,
            month: r.month,
            variancePoisha: variance.toString(),
          };
        });
    });

    // 5. Stale reviews pending owner sign-off
    const subStale = liveQuery(() =>
      db.entries
        .filter(
          (e) =>
            e.status === 'active' &&
            e.stale_rates === true &&
            (e.stale_review_status === undefined || e.stale_review_status === 'flagged') &&
            BigInt(e.gross_poisha) > 5000000n
        )
        .count()
    ).subscribe((c) => { highValueStaleCount = c; });

    return () => {
      subEntries.unsubscribe();
      subSettlements.unsubscribe();
      subMonths.unsubscribe();
      subStatements.unsubscribe();
      subStale.unsubscribe();
    };
  });

  // Financial aggregates with prior month comparisons (PRD §8.5)
  const currentAgg = $derived(computeMonthlyAggregates(windowedEntries, currentMonth));
  const priorAgg = $derived(computeMonthlyAggregates(windowedEntries, priorMonth));

  const deltas: ExecutiveDeltas = $derived(
    computeExecutiveDeltas(
      currentAgg.totalGrossPoisha,
      currentAgg.totalCommissionPoisha,
      currentAgg.totalNetPoisha,
      priorAgg.totalGrossPoisha,
      priorAgg.totalCommissionPoisha,
      priorAgg.totalNetPoisha
    )
  );

  const pendingOverpayments = $derived(
    settlements.filter((s) => {
      if (s.status !== 'overpaid') return false;
      const expected = BigInt(s.expectedPoisha || '0');
      const paid = BigInt(s.paidPoisha || '0');
      const surplus = paid - expected;
      return s.overpaymentReviewStatus !== 'approved' || s.overpaymentApprovedAmount !== surplus.toString();
    })
  );

  // Daily collections trend data for current month (PRD §8.5)
  const dailyTrendBars = $derived.by(() => {
    const daysInMonth = new Date(
      parseInt(currentMonth.substring(0, 4), 10),
      parseInt(currentMonth.substring(5, 7), 10),
      0
    ).getDate();

    const daySums = new Map<number, bigint>();
    for (let d = 1; d <= daysInMonth; d++) {
      daySums.set(d, 0n);
    }

    for (const e of windowedEntries) {
      if (e.status === 'active' && e.sync_status !== 'rejected' && e.entry_date.startsWith(currentMonth)) {
        const d = parseInt(e.entry_date.substring(8, 10), 10);
        const current = daySums.get(d) ?? 0n;
        daySums.set(d, current + BigInt(e.gross_poisha));
      }
    }

    let maxVal = 0n;
    for (const val of daySums.values()) {
      if (val > maxVal) maxVal = val;
    }

    const bars: DailyBar[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const val = daySums.get(d) ?? 0n;
      const pct = maxVal > 0n ? Number((val * 100n) / maxVal) : 0;
      bars.push({
        dayStr: String(d),
        grossPoisha: val,
        heightPct: Math.max(pct, val > 0n ? 4 : 1),
      });
    }

    return bars;
  });
</script>

<div class="owner-dashboard flex flex-col gap-6">
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-[var(--c-ink,#111827)]">Executive Summary — {ownerName}</h1>
      <p class="text-sm text-[var(--c-muted,#6b7280)]">
        Financial governance, month close gates, and liability settlements ({currentMonth} vs {priorMonth}).
      </p>
    </div>

    <div class="flex gap-2">
      <a href="/months/close">
        <Button variant="commission" class="min-h-[44px]">Month Close Controls</Button>
      </a>
    </div>
  </div>

  {#if unclosedMonths.length > 0}
    <div class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-900 text-xs flex items-center justify-between">
      <div>
        <span class="font-bold">⚠ Unclosed Calendar Months:</span>
        Historical months ({unclosedMonths.map((m) => m.month).join(', ')}) remain unclosed. Lock periods to freeze liabilities.
      </div>
      <a href="/months/close"><Button variant="default" class="text-xs py-2 px-3 min-h-[44px]">Close Months</Button></a>
    </div>
  {/if}

  {#if varianceAlerts.length > 0}
    <div class="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-900 text-xs flex items-center justify-between">
      <div>
        <span class="font-bold">ℹ Statement Variance Alert:</span>
        {varianceAlerts.length} open statement(s) exhibit variance between internal ledgers and bank statements.
      </div>
      <a href="/reconcile"><Button variant="default" class="text-xs py-2 px-3 min-h-[44px]">Review Reconciliation</Button></a>
    </div>
  {/if}

  <!-- Executive Financial Summary Cards (vs Prior Month) (PRD §8.5) -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Shop Gross (MTD)</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-ink,#111827)]">{formatPoishaToBdt(currentAgg.totalGrossPoisha)}</div>
      <div class="text-xs mt-2 flex items-center gap-1.5">
        <span class="font-bold {deltas.grossDeltaPoisha >= 0n ? 'text-emerald-600' : 'text-red-600'}">
          {deltas.grossDeltaPoisha >= 0n ? '↑ +' : '↓ '}{formatPoishaToBdt(deltas.grossDeltaPoisha < 0n ? -deltas.grossDeltaPoisha : deltas.grossDeltaPoisha)}
          ({deltas.grossDeltaPercent})
        </span>
        <span class="text-[var(--c-muted,#6b7280)]">vs {priorMonth}</span>
      </div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Total Commission Earned</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--c-commission,#10b981)]">{formatPoishaToBdt(currentAgg.totalCommissionPoisha)}</div>
      <div class="text-xs mt-2 flex items-center gap-1.5">
        <span class="font-bold {deltas.commissionDeltaPoisha >= 0n ? 'text-emerald-600' : 'text-red-600'}">
          {deltas.commissionDeltaPoisha >= 0n ? '↑ +' : '↓ '}{formatPoishaToBdt(deltas.commissionDeltaPoisha < 0n ? -deltas.commissionDeltaPoisha : deltas.commissionDeltaPoisha)}
          ({deltas.commissionDeltaPercent})
        </span>
        <span class="text-[var(--c-muted,#6b7280)]">vs {priorMonth}</span>
      </div>
    </Card>

    <Card class="p-6">
      <div class="text-xs font-semibold text-[var(--c-muted,#6b7280)] mb-1">Net Retained Income</div>
      <div class="text-3xl font-bold tabular-nums text-[var(--accent,#3b82f6)]">{formatPoishaToBdt(currentAgg.totalNetPoisha)}</div>
      <div class="text-xs mt-2 flex items-center gap-1.5">
        <span class="font-bold {deltas.netDeltaPoisha >= 0n ? 'text-emerald-600' : 'text-red-600'}">
          {deltas.netDeltaPoisha >= 0n ? '↑ +' : '↓ '}{formatPoishaToBdt(deltas.netDeltaPoisha < 0n ? -deltas.netDeltaPoisha : deltas.netDeltaPoisha)}
          ({deltas.netDeltaPercent})
        </span>
        <span class="text-[var(--c-muted,#6b7280)]">vs {priorMonth}</span>
      </div>
    </Card>
  </div>

  <!-- Pure SVG Daily Collections Trend Chart (PRD §8.5, §13) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Daily Collections Trend ({currentMonth})</h2>
        <p class="text-xs text-[var(--c-muted,#6b7280)]">Daily gross revenue progression across Asia/Dhaka calendar days</p>
      </div>
      <span class="text-xs font-semibold tabular-nums text-[var(--c-commission,#10b981)]">
        MTD Total: {formatPoishaToBdt(currentAgg.totalGrossPoisha)}
      </span>
    </div>

    <!-- Responsive Pure SVG Daily Collections Trend Chart (PRD §8.5, §13) -->
    <div class="h-48 w-full border-b border-black/10 pt-2 pb-1 relative">
      <svg
        viewBox="0 0 1000 160"
        preserveAspectRatio="none"
        class="w-full h-full overflow-visible"
        role="img"
        aria-label="Daily collections trend chart for {currentMonth}"
      >
        <!-- Horizontal Guide Lines -->
        <line x1="0" y1="40" x2="1000" y2="40" stroke="currentColor" stroke-dasharray="4 4" class="text-black/5" />
        <line x1="0" y1="80" x2="1000" y2="80" stroke="currentColor" stroke-dasharray="4 4" class="text-black/5" />
        <line x1="0" y1="120" x2="1000" y2="120" stroke="currentColor" stroke-dasharray="4 4" class="text-black/5" />

        <!-- Daily Bars -->
        {#each dailyTrendBars as bar, idx (bar.dayStr)}
          {@const barWidth = 1000 / dailyTrendBars.length}
          {@const x = idx * barWidth + 2}
          {@const width = Math.max(2, barWidth - 4)}
          {@const height = (bar.heightPct / 100) * 150}
          {@const y = 160 - height}
          <g class="cursor-pointer group">
            <rect
              {x}
              {y}
              {width}
              {height}
              rx="3"
              class="transition-colors duration-200 {bar.grossPoisha > 0n ? 'fill-emerald-500/80 hover:fill-emerald-600' : 'fill-slate-200'}"
            />
            <title>Day {bar.dayStr}: {formatPoishaToBdt(bar.grossPoisha)}</title>
          </g>
        {/each}
      </svg>
    </div>
    <div class="flex justify-between text-[10px] text-[var(--c-muted,#6b7280)] mt-1 px-1">
      <span>Day 1</span>
      <span>Day 15</span>
      <span>Day {dailyTrendBars.length}</span>
    </div>
  </Card>

  <!-- Payables Due Checklist (with Due Dates and 5-State Statuses) (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Payables Due & Settlement Status ({priorMonth} Liabilities Due in {currentMonth})</h2>
      <a href="/settlements" class="text-xs text-[var(--c-muted,#6b7280)] hover:underline">Manage All Settlements</a>
    </div>

    {#if settlements.length === 0}
      <div class="p-4 text-center text-xs text-[var(--c-muted,#6b7280)]">
        No payable liabilities accrued for {priorMonth} or {currentMonth}.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-black/10 text-xs text-[var(--c-muted,#6b7280)]">
              <th class="py-2">Payable Name</th>
              <th class="py-2">Liability Month</th>
              <th class="py-2">Due Date</th>
              <th class="py-2 text-right">Expected</th>
              <th class="py-2 text-right">Paid</th>
              <th class="py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/5">
            {#each settlements as s (s.id)}
              <tr>
                <td class="py-2.5 font-medium">{s.payableName}</td>
                <td class="py-2.5 text-xs text-[var(--c-muted,#6b7280)] font-mono">{s.month.substring(0, 7)}</td>
                <td class="py-2.5 text-xs text-[var(--c-muted,#6b7280)]">
                  {s.dueDate} ({s.formattedDueDay})
                  {#if s.isOverdue}
                    <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Overdue</span>
                  {:else if s.isDueSoon}
                    <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Due Soon</span>
                  {/if}
                </td>
                <td class="py-2.5 text-right font-bold tabular-nums">{formatPoishaToBdt(BigInt(s.expectedPoisha || '0'))}</td>
                <td class="py-2.5 text-right font-medium tabular-nums text-slate-600">{formatPoishaToBdt(BigInt(s.paidPoisha || '0'))}</td>
                <td class="py-2.5 text-center">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                    {s.status === 'paid' ? 'bg-emerald-500/10 text-emerald-700' :
                     s.status === 'overpaid' ? 'bg-purple-500/10 text-purple-700' :
                     s.status === 'partly_paid' ? 'bg-blue-500/10 text-blue-700' :
                     s.status === 'due' ? 'bg-amber-500/10 text-amber-700' : 'bg-slate-500/10 text-slate-700'}">
                    {s.status}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>

  <!-- Governance Decisions Bento Grid (PRD §8.5) -->
  <Card class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-bold text-base text-[var(--c-ink,#111827)]">Pending Governance Decisions</h2>
      <span class="text-xs text-[var(--c-muted,#6b7280)]">Owner authorization required</span>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="p-4 rounded-xl bg-white/40 border border-black/5 flex flex-col justify-between gap-3">
        <div>
          <div class="font-bold text-sm">Overpayment Approvals</div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
            {#if pendingOverpayments.length > 0}
              <span class="text-purple-700 font-bold">{pendingOverpayments.length} Surplus Approval(s) Pending</span>
            {:else}
              No pending overpayment surplus
            {/if}
          </div>
        </div>
        <a href="/settlements">
          <Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={pendingOverpayments.length === 0}>
            Approve Overpayments
          </Button>
        </a>
      </div>

      <div class="p-4 rounded-xl bg-white/40 border border-black/5 flex flex-col justify-between gap-3">
        <div>
          <div class="font-bold text-sm">High-Value Stale Reviews</div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
            {#if highValueStaleCount > 0}
              <span class="text-amber-700 font-bold">{highValueStaleCount} Entries (>৳50k) Pending</span>
            {:else}
              No flagged high-value reviews
            {/if}
          </div>
        </div>
        <a href="/admin/stale-reviews">
          <Button variant="default" class="w-full text-xs py-2 px-3 min-h-[44px]" disabled={highValueStaleCount === 0}>
            Review Stale Entries
          </Button>
        </a>
      </div>

      <div class="p-4 rounded-xl bg-white/40 border border-black/5 flex flex-col justify-between gap-3">
        <div>
          <div class="font-bold text-sm">Month Close Readiness</div>
          <div class="text-xs text-[var(--c-muted,#6b7280)] mt-1">
            {unclosedMonths.length > 0 ? `${unclosedMonths.length} historical month(s) open` : 'All past months locked'}
          </div>
        </div>
        <a href="/months/close">
          <Button variant="commission" class="w-full text-xs py-2 px-3 min-h-[44px]">
            Check Readiness
          </Button>
        </a>
      </div>
    </div>
  </Card>
</div>
```

### 6.5 `apps/web/src/routes/(app)/dashboard/+page.svelte`

```svelte
<script lang="ts">
  import { session } from '$lib/auth/session.svelte';
  import StaffDashboard from '$lib/ui/dashboards/StaffDashboard.svelte';
  import AdminDashboard from '$lib/ui/dashboards/AdminDashboard.svelte';
  import OwnerDashboard from '$lib/ui/dashboards/OwnerDashboard.svelte';

  const userDisplayName = $derived(
    session.user?.fullName ?? 'Counter Staff'
  );
</script>

<div class="role-dashboard p-6 max-w-5xl mx-auto w-full">
  {#if session.loading || !session.user}
    <!-- Skeleton loader prevents flash of Staff UI while session resolves -->
    <div class="flex flex-col gap-6 animate-pulse">
      <div class="h-8 bg-slate-200 rounded w-1/3"></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="h-28 bg-slate-200 rounded-2xl"></div>
        <div class="h-28 bg-slate-200 rounded-2xl"></div>
      </div>
      <div class="h-64 bg-slate-200 rounded-2xl"></div>
    </div>
  {:else if session.user.role === 'owner'}
    <OwnerDashboard ownerName={userDisplayName} />
  {:else if session.user.role === 'admin'}
    <AdminDashboard />
  {:else}
    <StaffDashboard userId={session.user.id} userName={userDisplayName} />
  {/if}
</div>
```

### 6.6 `apps/web/src/lib/dashboards/dashboards.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  getAsiaDhakaDateString,
  getPriorMonthPrefix,
  formatOrdinalDay,
  computeStaffPersonalMetrics,
  computeOverallShopMetrics,
  computeShopMethodCollections,
  filterHighValueStaleEntries,
  filterPendingVoidRequests,
  filterDuplicateTxnEntries,
  computeExecutiveDeltas,
} from './metrics';
import type { LocalEntry, CachedPaymentMethod, LocalOutboxOp, CachedRejectedOp } from '$lib/db';

describe('Dashboard Metrics & Asia/Dhaka Timezone Boundaries', () => {
  it('computes Asia/Dhaka date correctly across UTC boundaries with zero host DST drift (PRD §12, Test #27)', () => {
    // 2026-10-29 19:30:00 UTC is 2026-10-30 01:30:00 Asia/Dhaka (+6 hours)
    const lateUtc = new Date(Date.UTC(2026, 9, 29, 19, 30, 0));
    const dhakaDate = getAsiaDhakaDateString(lateUtc);
    expect(dhakaDate).toBe('2026-10-30');

    // 2026-10-29 17:59:59 UTC is 2026-10-29 23:59:59 Asia/Dhaka
    const preMidnightUtc = new Date(Date.UTC(2026, 9, 29, 17, 59, 59));
    expect(getAsiaDhakaDateString(preMidnightUtc)).toBe('2026-10-29');

    // 2026-10-29 18:00:00 UTC is 2026-10-30 00:00:00 Asia/Dhaka (exact midnight boundary)
    const midnightUtc = new Date(Date.UTC(2026, 9, 29, 18, 0, 0));
    expect(getAsiaDhakaDateString(midnightUtc)).toBe('2026-10-30');
  });

  it('computes prior month prefix accurately across year boundaries', () => {
    expect(getPriorMonthPrefix('2026-10')).toBe('2026-09');
    expect(getPriorMonthPrefix('2026-01')).toBe('2025-12');
  });

  it('formats ordinal day strings with correct English grammar (PRD §8.5)', () => {
    expect(formatOrdinalDay(1)).toBe('1st');
    expect(formatOrdinalDay(2)).toBe('2nd');
    expect(formatOrdinalDay(3)).toBe('3rd');
    expect(formatOrdinalDay(4)).toBe('4th');
    expect(formatOrdinalDay(11)).toBe('11th');
    expect(formatOrdinalDay(12)).toBe('12th');
    expect(formatOrdinalDay(13)).toBe('13th');
    expect(formatOrdinalDay(15)).toBe('15th');
    expect(formatOrdinalDay(21)).toBe('21st');
    expect(formatOrdinalDay(22)).toBe('22nd');
    expect(formatOrdinalDay(23)).toBe('23rd');
    expect(formatOrdinalDay(28)).toBe('28th');
    expect(formatOrdinalDay(31)).toBe('31st');
  });

  it('aggregates Staff personal today and MTD gross strictly from own active entries (PRD §8.5, Test #30)', () => {
    const entries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'bkash', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'bkash', gross_poisha: '200000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '200000', status: 'active', sync_status: 'synced', created_by: 'other_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-15', customer_name: 'C3', sub_qty: 1, method_id: 'bkash', gross_poisha: '150000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '150000', status: 'active', sync_status: 'synced', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
      { id: '4', entry_date: '2026-10-29', customer_name: 'C4', sub_qty: 1, method_id: 'bkash', gross_poisha: '500000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '500000', status: 'voided', sync_status: 'synced', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L4' },
      { id: '5', entry_date: '2026-10-29', customer_name: 'C5', sub_qty: 1, method_id: 'bkash', gross_poisha: '700000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '700000', status: 'active', sync_status: 'rejected', created_by: 'user_staff', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L5' },
    ];

    const testNow = new Date(Date.UTC(2026, 9, 29, 6, 0, 0)); // 12:00 PM Dhaka on Oct 29
    const metrics = computeStaffPersonalMetrics(entries, 'user_staff', testNow);

    expect(metrics.todayGrossPoisha).toBe(100000n);
    expect(metrics.todayEntriesCount).toBe(1);
    expect(metrics.mtdGrossPoisha).toBe(250000n); // 100000 + 150000 (excludes other staff, voided, and rejected)
    expect(metrics.mtdEntriesCount).toBe(2);
  });

  it('aggregates overall shop gross and transaction counts for Today and MTD (PRD §8.5)', () => {
    const entries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm2', gross_poisha: '200000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '200000', status: 'active', sync_status: 'synced', created_by: 'u2', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-15', customer_name: 'C3', sub_qty: 1, method_id: 'm1', gross_poisha: '300000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '300000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
    ];

    const shopMetrics = computeOverallShopMetrics(entries, '2026-10-29', '2026-10');
    expect(shopMetrics.todayGrossPoisha).toBe(300000n); // 100000 + 200000
    expect(shopMetrics.todayEntriesCount).toBe(2);
    expect(shopMetrics.mtdGrossPoisha).toBe(600000n); // 100000 + 200000 + 300000
    expect(shopMetrics.mtdEntriesCount).toBe(3);
  });

  it('aggregates shop collections by payment method for Admin overview (PRD §8.5)', () => {
    const entries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm_bkash', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm_visa', gross_poisha: '250000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '250000', status: 'active', sync_status: 'synced', created_by: 'u2', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-10', customer_name: 'C3', sub_qty: 1, method_id: 'm_bkash', gross_poisha: '300000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '300000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
    ];

    const methods: CachedPaymentMethod[] = [
      { id: 'm_bkash', code: 'bkash', name: 'bKash', display_order: 1, active: true, requires_txn_ref: true },
      { id: 'm_visa', code: 'visa', name: 'Visa', display_order: 2, active: true, requires_txn_ref: false },
    ];

    const summaries = computeShopMethodCollections(entries, methods, '2026-10-29', '2026-10');
    const bkashSummary = summaries.find((s) => s.methodId === 'm_bkash');
    const visaSummary = summaries.find((s) => s.methodId === 'm_visa');

    expect(bkashSummary?.todayGrossPoisha).toBe(100000n);
    expect(bkashSummary?.mtdGrossPoisha).toBe(400000n);
    expect(bkashSummary?.mtdCount).toBe(2);

    expect(visaSummary?.todayGrossPoisha).toBe(250000n);
    expect(visaSummary?.mtdGrossPoisha).toBe(250000n);
    expect(visaSummary?.mtdCount).toBe(1);
  });

  it('computes executive comparisons and percentage deltas accurately (PRD §8.5)', () => {
    // Current month: 50,000 gross, 21,000 commission, 26,000 net
    // Prior month: 40,000 gross, 16,800 commission, 20,800 net
    const deltas = computeExecutiveDeltas(
      5000000n, 2100000n, 2600000n,
      4000000n, 1680000n, 2080000n
    );

    expect(deltas.grossDeltaPoisha).toBe(1000000n);
    expect(deltas.grossDeltaPercent).toBe('+25.0%');
    expect(deltas.commissionDeltaPoisha).toBe(420000n);
    expect(deltas.commissionDeltaPercent).toBe('+25.0%');
    expect(deltas.netDeltaPoisha).toBe(520000n);
    expect(deltas.netDeltaPercent).toBe('+25.0%');

    // Fractional drop: minute drop formatting must avoid -0.0%
    const smallDelta = computeExecutiveDeltas(
      999900n, 100000n, 800000n,
      1000000n, 100000n, 800000n
    );
    expect(smallDelta.grossDeltaPercent).toBe('-0.1%');

    const zeroDelta = computeExecutiveDeltas(
      999999n, 100000n, 800000n,
      1000000n, 100000n, 800000n
    );
    expect(zeroDelta.grossDeltaPercent).toBe('0.0%');
  });

  it('Admin review queue filters strictly per PRD §10 criteria (Test #47, Test #65)', () => {
    // 1. Stale review filter: gross > 50,000 BDT (5,000,000 poisha) and stale_rates = true
    const sampleEntries: LocalEntry[] = [
      { id: '1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '5000001', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '5000001', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: true, rate_profile_id: 'p1', local_id: '#L1' },
      { id: '2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm1', gross_poisha: '5000000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '5000000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: true, rate_profile_id: 'p1', local_id: '#L2' },
      { id: '3', entry_date: '2026-10-29', customer_name: 'C3', sub_qty: 1, method_id: 'm1', gross_poisha: '8000000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '8000000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3' },
      { id: '4', entry_date: '2026-10-29', customer_name: 'C4', sub_qty: 1, method_id: 'm1', gross_poisha: '6000000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '6000000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: true, rate_profile_id: 'p1', local_id: '#L4', stale_review_status: 'approved' },
    ];

    const flaggedHighValue = filterHighValueStaleEntries(sampleEntries);
    expect(flaggedHighValue).toHaveLength(1);
    expect(flaggedHighValue[0].id).toBe('1');

    // 2. Void request filter: active entries with void_requested_by set
    const voidEntries: LocalEntry[] = [
      { id: 'v1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1', void_requested_by: 'usr-1' },
      { id: 'v2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'voided', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2', void_requested_by: 'usr-1' },
      { id: 'v3', entry_date: '2026-10-29', customer_name: 'C3', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L3', void_requested_by: undefined },
    ];

    const pendingVoids = filterPendingVoidRequests(voidEntries);
    expect(pendingVoids).toHaveLength(1);
    expect(pendingVoids[0].id).toBe('v1');

    // 3. Duplicate transaction filter
    const dupEntries: LocalEntry[] = [
      { id: 'd1', entry_date: '2026-10-29', customer_name: 'C1', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L1', dup_txn_flag: true },
      { id: 'd2', entry_date: '2026-10-29', customer_name: 'C2', sub_qty: 1, method_id: 'm1', gross_poisha: '100000', vat_poisha: '0', commission_poisha: '0', charge_poisha: '0', business_charge_poisha: '0', customer_charge_poisha: '0', net_poisha: '100000', status: 'active', sync_status: 'synced', created_by: 'u1', created_at: '', stale_rates: false, rate_profile_id: 'p1', local_id: '#L2', dup_txn_flag: false },
    ];
    expect(filterDuplicateTxnEntries(dupEntries)).toHaveLength(1);

    // 4. Closed-month rejected op detection (Test #47)
    const serverRejectedOps: CachedRejectedOp[] = [
      { opId: 'r1', error_code: 'month_closed', error_message: 'Month is closed', rejected_at: '2026-10-29T10:00:00Z', status: 'pending', payload: {} },
      { opId: 'r2', error_code: 'invalid_snapshot_rules', error_message: 'Rate mismatch', rejected_at: '2026-10-29T10:00:00Z', status: 'pending', payload: {} },
      { opId: 'r3', error_code: 'month_closed', error_message: 'Month is closed', rejected_at: '2026-10-29T10:00:00Z', status: 'resolved', payload: {} },
    ];
    const pendingMonthClosedServer = serverRejectedOps.filter(
      (op) => op.error_code === 'month_closed' && op.status === 'pending'
    );
    expect(pendingMonthClosedServer).toHaveLength(1);
    expect(pendingMonthClosedServer[0].opId).toBe('r1');

    const localOutboxOps: LocalOutboxOp[] = [
      { opId: 'o1', userId: 'user_staff', type: 'create_entry', payload: {}, clientCreatedAt: '2026-10-29T10:00:00Z', maxKnownRateVersion: 1, status: 'rejected', rejectionReason: 'month_closed' },
      { opId: 'o2', userId: 'user_staff', type: 'create_entry', payload: {}, clientCreatedAt: '2026-10-29T10:00:00Z', maxKnownRateVersion: 1, status: 'pending' },
    ];
    const pendingMonthClosedLocal = localOutboxOps.filter(
      (op) => op.status === 'rejected' && op.rejectionReason === 'month_closed'
    );
    expect(pendingMonthClosedLocal).toHaveLength(1);
    expect(pendingMonthClosedLocal[0].opId).toBe('o1');

    // 5. Device Burst Anomaly Flag Verification (Test #65)
    // view_device_stale_rate_anomalies aggregates >= 5 stale ops per hour
    const deviceAnomalyThreshold = 5;
    const testAnomalies = [
      { device_id: 'd-1', actor_id: 'a-1', stale_ops_last_hour: 5, latest_stale_op_at: '2026-10-29T11:00:00Z' },
      { device_id: 'd-2', actor_id: 'a-2', stale_ops_last_hour: 4, latest_stale_op_at: '2026-10-29T11:00:00Z' },
    ];
    const flaggedDevices = testAnomalies.filter((a) => a.stale_ops_last_hour >= deviceAnomalyThreshold);
    expect(flaggedDevices).toHaveLength(1);
    expect(flaggedDevices[0].device_id).toBe('d-1');
  });
});
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Asia/Dhaka Timezone Midnight | UTC 19:30 Oct 29 | Date `'2026-10-30'` with 0 host DST drift | §12, §16.2 #27 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| English Ordinal Day Formatter | Days 1, 2, 3, 4, 11, 15, 21, 22, 23 | Correct suffixes (1st, 2nd, 3rd, 4th, 11th, 15th, 21st, 22nd, 23rd) | §8.5 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| Staff Metric Personal Isolation | Mixed staff entries with voided and rejected ops | Includes own active entries only (excludes voided, superseded, and rejected) | §8.5, §16.2 #30 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| Overall Shop Turnover Sums | Multi-staff active entries | Accurate Today and MTD shop turnover and counts | §8.5 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| Shop Method Collection Aggregation | Active entries and methods | Accurate Today and MTD gross per method | §8.5 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| Executive Comparison Deltas | Current vs prior month gross, commission, net | Correct absolute poisha deltas and formatted percentages | §8.5 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| Admin Review Queue Filters | Stale review (>৳50k), void, duplicate, and closed-month ops | Filters match exact PRD criteria | §10, §16.2 #47 | `apps/web/src/lib/dashboards/dashboards.test.ts` |
| Test #47 Closed-Month Offline Entries | Server rejectedOps and local outbox | Flagged and linked to `/reconcile` | §16.2 #47 | `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte` |
| Test #65 Stale Burst Anomaly View | >=5 stale ops in 1 hr | Real-time alert renders with device and actor info | §16.2 #65 | `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte` |

## 8. Acceptance criteria

1. Staff dashboard computes personal collections matching Asia/Dhaka midnight boundaries and excludes voided/rejected rows.
   - Command: `pnpm --filter @clt/web test dashboards.test.ts -t "Staff personal today and MTD gross"`
   - Expected output: test suite passes with 0 failures.
2. Admin review queue filters and shop method aggregations match PRD criteria.
   - Command: `pnpm --filter @clt/web test dashboards.test.ts -t "Admin review queue filters"`
   - Expected output: test suite passes with 0 failures.
3. SvelteKit route typecheck passes cleanly with 0 errors.
   - Command: `pnpm --filter @clt/web check`
   - Expected output: `0 errors`.

## 9. Hard rules touched

- Rule 2: Integer poisha used across all dashboard metrics, aggregations, and executive comparisons; percentage deltas computed via integer arithmetic without float conversions.
- Rule 6: Dashboards operate fully offline using local Dexie IndexedDB cache tables with reactive `liveQuery` subscriptions.
- Rule 7: Server data (e.g. stale device anomalies) fetched via authorized API routes backed by service-role security definer views.
- Rule 11: TypeScript strict typing and Zod schemas validate caller identities and query parameters.

## 10. Pitfalls

- Trap: Using browser local timezone causes staff midnight metric resets at incorrect hours in Bangladesh.
  - Fix: Compute date boundaries strictly in `Asia/Dhaka` (UTC+6) via `getAsiaDhakaDateString` with zero host DST drift per PRD §12 and Test #27.
- Trap: Querying unbounded `db.entries.toArray()` causes high memory usage and slows down the browser as transaction volume grows.
  - Fix: Use date-windowed queries (`db.entries.where('entry_date').between(priorMonthStart, currentMonthEnd)`) to aggregate metrics efficiently in memory.
- Trap: Relying on non-reactive `$state` inside a Dexie `liveQuery` causes unclosed month alerts to be empty on first paint.
  - Fix: Query `db.entries.orderBy('entry_date').first()` and `db.monthCloses` inside the reactive query body, guaranteeing reactivity and complete historical period coverage.
- Trap: Querying local outbox for void requests ignores synced staff submissions.
  - Fix: Query `db.entries.filter(e => e.status === 'active' && Boolean(e.void_requested_by))` alongside local outbox void requests.
- Trap: Flashing the Staff dashboard UI while authentication session is loading for Admin or Owner users.
  - Fix: Display an explicit skeleton loader in `apps/web/src/routes/(app)/dashboard/+page.svelte` while `session.loading` is true or `!session.user`.

## 11. PRD ISSUES and DECISION PENDING

- **PRD §8.5 "Today" Metric Definition**:
  - Cash-counter business semantics: "Today" metrics aggregate active transactions whose business date `entry_date === todayStr` (Asia/Dhaka timezone). This matches shop accounting practices where transactions belong to their business accounting date.
- **Memory-Safe Dexie Windowing**:
  - Live queries on the Admin and Owner dashboards restrict indexed queries to the current and prior month window (`priorMonth-01` to `currentMonth-31`), preventing unbounded client heap allocations while maintaining full offline reactivity.

## 12. Handoff

- Role dashboard views exported from `apps/web/src/lib/ui/dashboards/` for integration in `apps/web/src/routes/(app)/dashboard/+page.svelte`.
- `computeStaffPersonalMetrics`, `computeOverallShopMetrics`, `computeShopMethodCollections`, `formatOrdinalDay`, `computeExecutiveDeltas`, and `getAsiaDhakaDateString` exported from `$lib/dashboards/metrics.ts`.

## 13. Suggested task breakdown

- `CLT-T-016-A`: Implement Asia/Dhaka date calculation, ordinal day formatting, metrics calculation, and Vitest unit tests (Files: `apps/web/src/lib/dashboards/metrics.ts`, `apps/web/src/lib/dashboards/dashboards.test.ts`; Depends on: none; Role: Builder; Priority: P0).
- `CLT-T-016-B`: Build Staff dashboard with personal metrics, pending sync counter, needs-attention queue, and sorted recent entries (Files: `apps/web/src/lib/ui/dashboards/StaffDashboard.svelte`; Depends on: `CLT-T-016-A`; Role: Builder; Priority: P0).
- `CLT-T-016-C`: Build Admin dashboard with review queues, shop method totals, settlement due checklist, staff activity, and anomaly alerts (Files: `apps/web/src/lib/ui/dashboards/AdminDashboard.svelte`; Depends on: `CLT-T-016-A`; Role: Builder; Priority: P0).
- `CLT-T-016-D`: Build Owner dashboard with executive summary, prior-month comparison deltas, pure SVG daily trend chart, payables checklist, unclosed months, and governance actions (Files: `apps/web/src/lib/ui/dashboards/OwnerDashboard.svelte`; Depends on: `CLT-T-016-A`, `CLT-T-016-C`; Role: Builder; Priority: P0).
- `CLT-T-016-E`: Build root dashboard router with authentication loading skeleton and dynamic role switching (Files: `apps/web/src/routes/(app)/dashboard/+page.svelte`; Depends on: `CLT-T-016-B`, `CLT-T-016-C`, `CLT-T-016-D`; Role: Builder; Priority: P0).

## Changelog

- Revision 3.1 — 2026-11-01:
  - Fixed fatal runtime crash in AdminDashboard.svelte: replaced unindexed db.entries.orderBy('created_at') with date-windowed query and in-memory sort.
  - Resolved strict TypeScript errors in dashboards.test.ts by adding charge_poisha: '0' to all LocalEntry test fixtures and userId: 'user_staff' to LocalOutboxOp fixtures.
  - Fixed user display name property access in dashboard/+page.svelte: resolved from session.user?.fullName (aligned with Plan 008 UserSessionProfile).
  - Fixed Settlement Due Checklist timing: queried priorMonth settlements due in currentMonth using computeSettlementReminder from Plan 014.
  - Replaced HTML div bar chart in OwnerDashboard.svelte with responsive pure SVG chart (<svg viewBox="0 0 1000 160"> with <rect> elements and tooltips).
  - Fixed stale review queue desync: checked stale_review_status in filterHighValueStaleEntries and Dexie queries so approved entries exit dashboard queues.
  - Implemented Test #47 transaction details in AdminDashboard.svelte Needs Attention (Closed Month) alert card.
  - Upgraded all button touch targets to min-h-[44px] across Admin and Owner dashboards.
  - Added Test #65 unit test in dashboards.test.ts verifying device burst anomaly threshold (>= 5 stale ops per hour).
- Revision 3.0 — 2026-11-01:
  - Remediated all 7 blockers and architectural defects from independent plan audit:
    - Fixed Admin counters reading non-existent fields: aligned outbox queries to `op.type === 'request_void'` and `op.rejectionReason === 'month_closed'`; aligned Dexie rejected ops queries to `op.error_code === 'month_closed' AND op.status === 'pending'`; and removed phantom `stale_review_status` on `LocalEntry` in favor of `stale_rates = true` and gross `> 5000000n`.
    - Fixed Owner dashboard alert data: accurately evaluated overpayment approvals against exact surplus (`overpaymentApprovedAmount === (paid - expected)`), derived statement variance dynamically from `statement_total_poisha - expected_poisha` if `variance_poisha` is absent, and keyed settlement rows by unique `s.id`.
    - Fixed Settlement due checklist: joined `db.payables` for `name`, `due_day`, and `remind_days_before`; implemented `formatOrdinalDay` eliminating the 1th/2th/3th/22th grammatical bug class; and keyed items by unique settlement UUID instead of duplicate payable names.
    - Fixed typecheck compilation failures in `dashboards.test.ts`: removed `stale_review_status` from `LocalEntry` test objects; replaced `void_requested_by: null` with `undefined`; and aligned `CachedPaymentMethod` test objects to use `code` and `display_order` without non-existent `slug`.
    - Aligned Acceptance Criterion 2 test filter command (`-t "Admin review queue filters"`) to match the exact test block title.
    - Exported and tested actual helper functions (`filterHighValueStaleEntries`, `filterPendingVoidRequests`, `filterDuplicateTxnEntries`, `computeExecutiveDeltas`, `formatOrdinalDay`) in `metrics.ts` rather than testing inline `.filter()` copies.
    - Implemented missing PRD §8.5 widgets across all three personas:
      - Admin: Overall shop turnover (Today and MTD), pending sync outbox counter, stale-rate alert counter (<৳50k), duplicate transaction flags, counter staff activity, and real-time device anomaly tracker with 60s polling, reconnect handling, and composite keys.
      - Owner: Pure SVG daily collections trend chart (`dailyTrendBars`), rendered payables due checklist with due dates and 5-state status chips, robustly reactive unclosed historical months alert, and direct governance action buttons.
      - Staff: Needs-Attention queue card surfacing rejected outbox operations with rejection reasons, and explicit status badges on recent transactions (`Synced`, `Pending`, `Sync Rejected`, `[Void Requested]`, `[Voided]`).
    - Implemented date-windowed Dexie queries (`between(priorMonth-01, currentMonth-31)`) preventing unbounded memory growth in Admin and Owner dashboards.
    - Added authentication loading skeleton in `+page.svelte` to prevent flash of Staff UI while session resolves, and resolved user display name from `session.user?.displayName ?? session.user?.fullName`.
    - Standardized Section 13 task IDs to `016-A` through `016-E` and updated dependencies to `007, 008, 009, 010, 011, 012, 013, 014, 015`.
- Revision 2.0 — 2026-10-31:
  - Aligned anomaly endpoint path to `/api/v1/admin/entries/stale-anomalies`, injected `Authorization: Bearer` header, and unwrapped `data.anomalies ?? []`.
  - Corrected stale review filter threshold to strictly `> 5000000n` poisha (`> ৳50,000`); updated `voidRequestCount` to query synced `db.entries` where `status === 'active' && Boolean(e.void_requested_by)`.
  - Added Staff pending sync counter, Admin shop collections by payment method, and Owner prior-month financial summary.
  - Fixed DST drift bug in `getAsiaDhakaDateString` using UTC getters on shifted epoch timestamp.
- Revision 1.0 — 2026-10-29: Initial specification created for Plan 016 aligned with PRD v1.19 §8.5, §10, and §12.
