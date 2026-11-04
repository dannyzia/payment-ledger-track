import type { CalcInput, CalcResult, Poisha } from './types.js';
import { InvalidCalcInputError, DeductionsExceedGrossError } from './errors.js';
import { mulBp, roundHalfUp } from './rounding.js';

/**
 * calculateEntry(input): Authoritative calculation engine (PRD §6.3).
 * PLAN-DERIVED name for the central entry calculation function.
 */
export function calculateEntry(input: CalcInput): CalcResult {
  const { grossPoisha, snapshot } = input;

  // 1. Basis-Point Range Validation (Finding #5)
  if (!Number.isInteger(snapshot.vat.bp) || snapshot.vat.bp < 0 || snapshot.vat.bp > 10000) {
    throw new InvalidCalcInputError('VAT basis points must be an integer between 0 and 10000');
  }
  if (
    !Number.isInteger(snapshot.commission.bp) ||
    snapshot.commission.bp < 0 ||
    snapshot.commission.bp > 10000
  ) {
    throw new InvalidCalcInputError(
      'Commission basis points must be an integer between 0 and 10000',
    );
  }
  if (!Number.isInteger(snapshot.chargeBp) || snapshot.chargeBp < 0 || snapshot.chargeBp > 10000) {
    throw new InvalidCalcInputError('Charge basis points must be an integer between 0 and 10000');
  }

  // 2. Gross Guard (Finding #23)
  if (grossPoisha <= 0n) {
    throw new InvalidCalcInputError('Gross amount must be positive');
  }

  // 3. Mode Input Validation & Mutual Exclusivity (F20, Finding #23)
  if (snapshot.vat.mode === 'manual') {
    if (input.vatInputPoisha === undefined || input.vatInputPoisha === null) {
      throw new InvalidCalcInputError('VAT input is required in manual VAT mode');
    }
    if (input.vatInputPoisha < 0n) {
      throw new InvalidCalcInputError('VAT input cannot be negative');
    }
    if (input.vatInputPoisha > grossPoisha) {
      throw new InvalidCalcInputError('VAT input cannot exceed gross amount');
    }
    if (input.vatOverridePoisha !== undefined && input.vatOverridePoisha !== null) {
      throw new InvalidCalcInputError('VAT override is forbidden in manual VAT mode');
    }
  } else {
    // Mode is 'percent_of_gross' or 'percent_inclusive'
    if (input.vatInputPoisha !== undefined && input.vatInputPoisha !== null) {
      throw new InvalidCalcInputError('Manual VAT input is forbidden in percentage VAT modes');
    }
    if (input.vatOverridePoisha !== undefined && input.vatOverridePoisha !== null) {
      if (input.vatOverridePoisha < 0n) {
        throw new InvalidCalcInputError('VAT override cannot be negative');
      }
      if (input.vatOverridePoisha > grossPoisha) {
        throw new InvalidCalcInputError('VAT override cannot exceed gross amount');
      }
      if (!input.vatOverrideReason || input.vatOverrideReason.trim().length === 0) {
        throw new InvalidCalcInputError('VAT override requires a non-empty reason');
      }
    }
  }

  // 4. Commission Override Validation
  if (input.commissionOverridePoisha !== undefined && input.commissionOverridePoisha !== null) {
    if (input.commissionOverridePoisha < 0n) {
      throw new InvalidCalcInputError('Commission override cannot be negative');
    }
    if (input.commissionOverridePoisha > grossPoisha) {
      throw new InvalidCalcInputError('Commission override cannot exceed gross amount');
    }
    if (!input.commissionOverrideReason || input.commissionOverrideReason.trim().length === 0) {
      throw new InvalidCalcInputError('Commission override requires a non-empty reason');
    }
  }

  // 5. VAT Component Calculation
  let vatPoisha: Poisha;
  if (
    snapshot.vat.mode !== 'manual' &&
    snapshot.vat.mode !== 'percent_of_gross' &&
    snapshot.vat.mode !== 'percent_inclusive'
  ) {
    throw new InvalidCalcInputError(`Unsupported VAT mode: ${String(snapshot.vat.mode)}`);
  }
  if (snapshot.vat.mode === 'manual') {
    vatPoisha = input.vatInputPoisha!;
  } else if (input.vatOverridePoisha !== undefined && input.vatOverridePoisha !== null) {
    vatPoisha = input.vatOverridePoisha;
  } else if (snapshot.vat.mode === 'percent_of_gross') {
    vatPoisha = mulBp(grossPoisha, snapshot.vat.bp);
  } else {
    // percent_inclusive
    const divisor = 10000n + BigInt(snapshot.vat.bp);
    const basePoisha = roundHalfUp(grossPoisha * 10000n, divisor);
    vatPoisha = grossPoisha - basePoisha;
  }

  // 6. Commission Component Calculation
  let commissionBase: Poisha;
  if (snapshot.commission.base === 'gross') {
    commissionBase = grossPoisha;
  } else if (snapshot.commission.base === 'gross_minus_vat') {
    commissionBase = grossPoisha - vatPoisha;
  } else {
    throw new InvalidCalcInputError(
      `Unsupported commission base: ${String(snapshot.commission.base)}`,
    );
  }

  let commissionPoisha: Poisha;
  if (input.commissionOverridePoisha !== undefined && input.commissionOverridePoisha !== null) {
    commissionPoisha = input.commissionOverridePoisha;
  } else {
    commissionPoisha = mulBp(commissionBase, snapshot.commission.bp);
  }

  // 7. Charge Calculation and Partitioning (Strict enum validation ensures charge partitioning invariant)
  if (snapshot.chargesBorneBy !== 'business' && snapshot.chargesBorneBy !== 'customer') {
    throw new InvalidCalcInputError(
      `Unsupported chargesBorneBy: ${String(snapshot.chargesBorneBy)}`,
    );
  }
  const chargePoisha = mulBp(grossPoisha, snapshot.chargeBp);
  const businessChargePoisha = snapshot.chargesBorneBy === 'business' ? chargePoisha : 0n;
  const customerChargePoisha = snapshot.chargesBorneBy === 'customer' ? chargePoisha : 0n;

  // 8. Authoritative Per-Entry Deduction Guard Evaluated FIRST (PRD §6.3, Hard Rule 3)
  // Evaluated before component non-negativity checks to guarantee DeductionsExceedGrossError precedence
  if (vatPoisha + commissionPoisha + businessChargePoisha > grossPoisha) {
    throw new DeductionsExceedGrossError(
      grossPoisha,
      vatPoisha,
      commissionPoisha,
      businessChargePoisha,
    );
  }

  // 9. Universal Non-Negativity Invariant Assertions
  if (
    vatPoisha < 0n ||
    commissionPoisha < 0n ||
    businessChargePoisha < 0n ||
    customerChargePoisha < 0n
  ) {
    throw new InvalidCalcInputError('Calculated deduction components must be non-negative');
  }

  // 10. Net Component Calculation (PRD §6.3 balancing identity)
  const netAfterDeductionsPoisha =
    grossPoisha - vatPoisha - commissionPoisha - businessChargePoisha;

  return {
    grossPoisha,
    vatPoisha,
    commissionPoisha,
    chargePoisha,
    businessChargePoisha,
    customerChargePoisha,
    netAfterDeductionsPoisha,
  };
}
