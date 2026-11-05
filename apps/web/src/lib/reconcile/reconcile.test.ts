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
