/**
 * apps/web/src/lib/reconcile/tolerance.ts
 * Pure reconciliation math, validation helpers, and month-close checklist gating logic.
 */
import type { UserRole } from '@clt/shared';

/**
 * Tolerance verification helper conforming to PRD §11.2 (Mode A manual reconciliation).
 * Auto-passes if abs(variance) <= tolerancePoisha (default 100 poisha / ৳1.00).
 * If variance exceeds tolerance, requires a non-empty explanatory justification note.
 */
export function isVarianceWithinTolerance(
  variancePoisha: bigint,
  tolerancePoisha: bigint,
  hasExplanationNote: boolean,
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
export function resolveTargetPayableIds(selectedOption: string, payables: PayableItem[]): string[] {
  if (selectedOption === 'combined_card') {
    const cardPayables = payables.filter(
      (p) =>
        p.kind === 'card' ||
        p.code.toLowerCase().includes('visa') ||
        p.code.toLowerCase().includes('mastercard'),
    );
    return cardPayables.map((p) => p.id);
  }
  return selectedOption ? [selectedOption] : [];
}

export interface MonthCloseGatesInput {
  callerRole: UserRole;
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
    blockingReasons.push(
      'All overpaid settlements require active Owner approvals matching exact surplus.',
    );
  }
  if (!input.zeroPendingStaleReviews) {
    blockingReasons.push(
      'Zero pending stale reviews required on active entries (>৳50,000 flagged entries).',
    );
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
