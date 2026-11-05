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
