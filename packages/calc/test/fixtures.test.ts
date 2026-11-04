import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateEntry } from '../src/calculate.js';
import { mulBp, roundHalfUp } from '../src/rounding.js';
import { DeductionsExceedGrossError } from '../src/errors.js';
import type { RateSnapshot } from '../src/types.js';

// Portable URL-based ESM JSON loader (TS 5.3+ compatible without NodeNext assert deprecation)
const fixtures = JSON.parse(
  readFileSync(new URL('../fixtures/test_fixtures.json', import.meta.url), 'utf8'),
);

describe('PRD §6.6 Paper Ledger Fixtures', () => {
  it('executes all 10 individual rows with exact integer poisha matches', () => {
    let sumGross = 0n;
    let sumVat = 0n;
    let sumCommission = 0n;
    let sumBkashCharge = 0n;
    let sumCardCharge = 0n;
    let sumNet = 0n;

    for (const row of fixtures.paperLedgerRows) {
      const snapshot: RateSnapshot = {
        rateProfileId: fixtures.paperLedgerProfile.rateProfileId,
        version: fixtures.paperLedgerProfile.version,
        engineVersion: fixtures.paperLedgerProfile.engineVersion,
        vat: { mode: 'manual', bp: 0 },
        commission: { bp: 4200, base: 'gross_minus_vat' },
        chargeBp: row.chargeBp,
        chargesBorneBy: 'business',
        rounding: 'half_up',
      };

      const result = calculateEntry({
        grossPoisha: BigInt(row.grossPoisha),
        snapshot,
        vatInputPoisha: BigInt(row.vatInputPoisha),
      });

      expect(result.commissionPoisha).toBe(BigInt(row.expectedCommissionPoisha));
      expect(result.chargePoisha).toBe(BigInt(row.expectedChargePoisha));
      expect(result.netAfterDeductionsPoisha).toBe(BigInt(row.expectedNetPoisha));

      sumGross += result.grossPoisha;
      sumVat += result.vatPoisha;
      sumCommission += result.commissionPoisha;
      if (row.method === 'bkash') {
        sumBkashCharge += result.chargePoisha;
      } else if (row.method === 'card') {
        sumCardCharge += result.chargePoisha;
      }
      sumNet += result.netAfterDeductionsPoisha;
    }

    const asserted = fixtures.paperLedgerAssertedTotals;
    expect(sumGross).toBe(BigInt(asserted.totalGrossPoisha));
    expect(sumVat).toBe(BigInt(asserted.totalVatPoisha));
    expect(sumCommission).toBe(BigInt(asserted.totalCommissionPoisha));
    expect(sumBkashCharge).toBe(BigInt(asserted.totalBkashChargePoisha));
    expect(sumCardCharge).toBe(BigInt(asserted.totalCardChargePoisha));
    expect(sumNet).toBe(BigInt(asserted.totalNetPoisha));
  });

  it('validates the two rounding traps from PRD §6.6', () => {
    // Card charge row 5: 590900 * 150 bp
    expect(mulBp(590900n, 150)).toBe(8864n);
    // bKash charge row 1: 590900 * 115 bp
    expect(mulBp(590900n, 115)).toBe(6795n);
  });

  it('validates mulBp half-up rounding boundary vectors at exact .5', () => {
    for (const vec of fixtures.roundingBoundaryVectors) {
      expect(mulBp(BigInt(vec.amountPoisha), vec.bp)).toBe(BigInt(vec.expectedPoisha));
    }
  });
});

describe('PRD §6.7 Forward-Looking Automated Test Fixtures', () => {
  it('validates §6.7.1 percent_inclusive fixtures (P1, P2, P3)', () => {
    for (const fixture of fixtures.forwardLookingFixtures.percentInclusive) {
      const gross = BigInt(fixture.grossPoisha);
      const vatBp = BigInt(fixture.vatBp);
      const base = roundHalfUp(gross * 10000n, 10000n + vatBp);
      const vat = gross - base;

      expect(base).toBe(BigInt(fixture.expectedBasePoisha));
      expect(vat).toBe(BigInt(fixture.expectedVatPoisha));

      const snapshot: RateSnapshot = {
        rateProfileId: '00000000-0000-0000-0000-000000000001',
        version: 1,
        engineVersion: 1,
        vat: { mode: 'percent_inclusive', bp: fixture.vatBp },
        commission: { bp: 4200, base: 'gross_minus_vat' },
        chargeBp: 150,
        chargesBorneBy: 'business',
        rounding: 'half_up',
      };

      const result = calculateEntry({ grossPoisha: gross, snapshot });
      expect(result.vatPoisha).toBe(BigInt(fixture.expectedVatPoisha));
    }
  });

  it('validates §6.7.2 percent_of_gross fixture (P4)', () => {
    const p4 = fixtures.forwardLookingFixtures.percentOfGross;
    const snapshot: RateSnapshot = {
      rateProfileId: '00000000-0000-0000-0000-000000000001',
      version: 1,
      engineVersion: 1,
      vat: { mode: 'percent_of_gross', bp: p4.vatBp },
      commission: { bp: p4.commissionBp, base: 'gross_minus_vat' },
      chargeBp: p4.chargeBp,
      chargesBorneBy: 'business',
      rounding: 'half_up',
    };

    const result = calculateEntry({ grossPoisha: BigInt(p4.grossPoisha), snapshot });
    expect(result.vatPoisha).toBe(BigInt(p4.expectedVatPoisha));
    expect(result.commissionPoisha).toBe(BigInt(p4.expectedCommissionPoisha));
    expect(result.chargePoisha).toBe(BigInt(p4.expectedChargePoisha));
    expect(result.businessChargePoisha).toBe(BigInt(p4.expectedBusinessChargePoisha));
    expect(result.customerChargePoisha).toBe(BigInt(p4.expectedCustomerChargePoisha));
    expect(result.netAfterDeductionsPoisha).toBe(BigInt(p4.expectedNetPoisha));
  });

  it('validates §6.7.3 customer-borne charge fixture (P5)', () => {
    const p5 = fixtures.forwardLookingFixtures.customerBorneCharge;
    const snapshot: RateSnapshot = {
      rateProfileId: '00000000-0000-0000-0000-000000000001',
      version: 1,
      engineVersion: 1,
      vat: { mode: 'manual', bp: 0 },
      commission: { bp: p5.commissionBp, base: 'gross_minus_vat' },
      chargeBp: p5.chargeBp,
      chargesBorneBy: 'customer',
      rounding: 'half_up',
    };

    const result = calculateEntry({
      grossPoisha: BigInt(p5.grossPoisha),
      snapshot,
      vatInputPoisha: BigInt(p5.vatInputPoisha),
    });

    expect(result.businessChargePoisha).toBe(0n);
    expect(result.customerChargePoisha).toBe(BigInt(p5.expectedCustomerChargePoisha));
    expect(result.netAfterDeductionsPoisha).toBe(BigInt(p5.expectedNetPoisha));
    expect(
      result.vatPoisha +
        result.commissionPoisha +
        result.businessChargePoisha +
        result.netAfterDeductionsPoisha,
    ).toBe(result.grossPoisha);
  });

  it('validates §6.7.4 explicit overrides fixture (P6)', () => {
    const p6 = fixtures.forwardLookingFixtures.explicitOverrides;
    const snapshot: RateSnapshot = {
      rateProfileId: '00000000-0000-0000-0000-000000000001',
      version: 1,
      engineVersion: 1,
      vat: { mode: 'percent_inclusive', bp: p6.vatBp },
      commission: { bp: p6.commissionBp, base: 'gross' },
      chargeBp: p6.chargeBp,
      chargesBorneBy: 'business',
      rounding: 'half_up',
    };

    const result = calculateEntry({
      grossPoisha: BigInt(p6.grossPoisha),
      snapshot,
      vatOverridePoisha: BigInt(p6.vatOverridePoisha),
      vatOverrideReason: p6.vatOverrideReason,
      commissionOverridePoisha: BigInt(p6.commissionOverridePoisha),
      commissionOverrideReason: p6.commissionOverrideReason,
    });

    expect(result.vatPoisha).toBe(BigInt(p6.expectedVatPoisha));
    expect(result.commissionPoisha).toBe(BigInt(p6.expectedCommissionPoisha));
    expect(result.chargePoisha).toBe(BigInt(p6.expectedChargePoisha));
    expect(result.businessChargePoisha).toBe(BigInt(p6.expectedBusinessChargePoisha));
    expect(result.netAfterDeductionsPoisha).toBe(BigInt(p6.expectedNetPoisha));
  });

  it('proves guard precedence: DeductionsExceedGrossError runs before non-negativity checks', () => {
    const snapshot: RateSnapshot = {
      rateProfileId: '00000000-0000-0000-0000-000000000001',
      version: 1,
      engineVersion: 1,
      vat: { mode: 'manual', bp: 0 },
      commission: { bp: 9000, base: 'gross' },
      chargeBp: 2000, // 90% comm + 20% charge = 110% deductions
      chargesBorneBy: 'business',
      rounding: 'half_up',
    };

    // Gross 10,000, deductions 11,000 => must throw DeductionsExceedGrossError
    expect(() =>
      calculateEntry({
        grossPoisha: 10000n,
        snapshot,
        vatInputPoisha: 0n,
      }),
    ).toThrow(DeductionsExceedGrossError);
  });
});
