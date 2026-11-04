import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateEntry } from '../src/calculate.js';
import { InvalidCalcInputError, DeductionsExceedGrossError } from '../src/errors.js';
import type { RateSnapshot, VatMode, CommissionBase, ChargesBorneBy } from '../src/types.js';

describe('PRD §16.1 Fast-Check Property Tests', () => {
  it('Property 1: Conservation of Gross (gross = vat + commission + businessCharge + net) across all VAT modes', () => {
    // 1. Percentage modes (percent_of_gross and percent_inclusive)
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10000000000n }), // 1 poisha boundary up to 100,000,000 BDT
        fc.integer({ min: 0, max: 2500 }), // VAT bp: 0% to 25%
        fc.integer({ min: 0, max: 5000 }), // Commission bp: 0% to 50%
        fc.integer({ min: 0, max: 500 }), // Charge bp: 0% to 5%
        fc.constantFrom<VatMode>('percent_of_gross', 'percent_inclusive'),
        fc.constantFrom<CommissionBase>('gross', 'gross_minus_vat'),
        fc.constantFrom<ChargesBorneBy>('business', 'customer'),
        (grossPoisha, vatBp, commBp, chargeBp, vatMode, commBase, chargesBorneBy) => {
          const snapshot: RateSnapshot = {
            rateProfileId: '00000000-0000-0000-0000-000000000001',
            version: 1,
            engineVersion: 1,
            vat: { mode: vatMode, bp: vatBp },
            commission: { bp: commBp, base: commBase },
            chargeBp,
            chargesBorneBy,
            rounding: 'half_up',
          };

          const result = calculateEntry({ grossPoisha, snapshot });

          // Conservation identity
          const sumDeductionsAndNet =
            result.vatPoisha +
            result.commissionPoisha +
            result.businessChargePoisha +
            result.netAfterDeductionsPoisha;

          expect(sumDeductionsAndNet).toBe(result.grossPoisha);
          expect(result.businessChargePoisha + result.customerChargePoisha).toBe(
            result.chargePoisha,
          );
          expect(result.vatPoisha >= 0n).toBe(true);
          expect(result.commissionPoisha >= 0n).toBe(true);
          expect(result.businessChargePoisha >= 0n).toBe(true);
          expect(result.customerChargePoisha >= 0n).toBe(true);
          expect(result.netAfterDeductionsPoisha >= 0n).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );

    // 2. Manual VAT mode conservation
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10000000000n }), // 1 poisha boundary
        fc.integer({ min: 0, max: 4000 }), // Manual VAT ratio bp: 0% to 40%
        fc.integer({ min: 0, max: 5000 }), // Commission bp: 0% to 50%
        fc.integer({ min: 0, max: 500 }), // Charge bp: 0% to 5%
        fc.constantFrom<CommissionBase>('gross', 'gross_minus_vat'),
        fc.constantFrom<ChargesBorneBy>('business', 'customer'),
        (grossPoisha, vatRatioBp, commBp, chargeBp, commBase, chargesBorneBy) => {
          const vatInputPoisha = (grossPoisha * BigInt(vatRatioBp)) / 10000n;
          const snapshot: RateSnapshot = {
            rateProfileId: '00000000-0000-0000-0000-000000000001',
            version: 1,
            engineVersion: 1,
            vat: { mode: 'manual', bp: 0 },
            commission: { bp: commBp, base: commBase },
            chargeBp,
            chargesBorneBy,
            rounding: 'half_up',
          };

          const result = calculateEntry({ grossPoisha, snapshot, vatInputPoisha });

          expect(
            result.vatPoisha +
              result.commissionPoisha +
              result.businessChargePoisha +
              result.netAfterDeductionsPoisha,
          ).toBe(result.grossPoisha);
          expect(result.businessChargePoisha + result.customerChargePoisha).toBe(
            result.chargePoisha,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('Property 2: Idempotence of calculateEntry (identical inputs yield identical results)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10000000000n }),
        fc.integer({ min: 0, max: 2500 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.constantFrom<VatMode>('percent_of_gross', 'percent_inclusive'),
        fc.constantFrom<CommissionBase>('gross', 'gross_minus_vat'),
        fc.constantFrom<ChargesBorneBy>('business', 'customer'),
        (grossPoisha, vatBp, commBp, chargeBp, vatMode, commBase, chargesBorneBy) => {
          const input = {
            grossPoisha,
            snapshot: {
              rateProfileId: '00000000-0000-0000-0000-000000000001',
              version: 1,
              engineVersion: 1,
              vat: { mode: vatMode, bp: vatBp },
              commission: { bp: commBp, base: commBase },
              chargeBp,
              chargesBorneBy,
              rounding: 'half_up' as const,
            },
          };

          const result1 = calculateEntry(input);
          const result2 = calculateEntry(input);

          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('Property 3: Mode Input Mutual Exclusivity (F20) strictly rejects invalid input combinations', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 100n, max: 10000000000n }),
        fc.bigInt({ min: 1n, max: 10000000000n }),
        fc.integer({ min: 0, max: 2500 }),
        fc.constantFrom<VatMode>('percent_of_gross', 'percent_inclusive'),
        (grossPoisha, manualVatPoisha, vatBp, percentMode) => {
          const percentSnapshot: RateSnapshot = {
            rateProfileId: '00000000-0000-0000-0000-000000000001',
            version: 1,
            engineVersion: 1,
            vat: { mode: percentMode, bp: vatBp },
            commission: { bp: 4200, base: 'gross' },
            chargeBp: 150,
            chargesBorneBy: 'business',
            rounding: 'half_up',
          };

          expect(() =>
            calculateEntry({
              grossPoisha,
              snapshot: percentSnapshot,
              vatInputPoisha: manualVatPoisha,
            }),
          ).toThrow(InvalidCalcInputError);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('Property 4: Deduction Guard rejection property throws DeductionsExceedGrossError when sum exceeds gross', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1000n, max: 1000000n }),
        fc.integer({ min: 6000, max: 9000 }), // Comm 60-90%
        fc.integer({ min: 5000, max: 8000 }), // Charge 50-80% (sum > 100%)
        (grossPoisha, commBp, chargeBp) => {
          const snapshot: RateSnapshot = {
            rateProfileId: '00000000-0000-0000-0000-000000000001',
            version: 1,
            engineVersion: 1,
            vat: { mode: 'percent_of_gross', bp: 0 },
            commission: { bp: commBp, base: 'gross' },
            chargeBp,
            chargesBorneBy: 'business',
            rounding: 'half_up',
          };

          expect(() => calculateEntry({ grossPoisha, snapshot })).toThrow(
            DeductionsExceedGrossError,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
