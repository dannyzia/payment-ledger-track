export type Poisha = bigint;
export type SerializedPoisha = string;

export type VatMode = 'manual' | 'percent_of_gross' | 'percent_inclusive';
export type CommissionBase = 'gross' | 'gross_minus_vat';
export type ChargesBorneBy = 'business' | 'customer';

/**
 * Authoritative calculation engine version (PRD §6.1).
 * Mismatches trigger HTTP 426 upgrade_required during sync.
 */
export const ENGINE_VERSION = 1;

export interface RateSnapshot {
  rateProfileId: string;
  version: number;
  engineVersion: number; // Current integer version: 1
  vat: {
    mode: VatMode;
    bp: number;
  };
  commission: {
    bp: number;
    base: CommissionBase;
  };
  chargeBp: number;
  chargesBorneBy: ChargesBorneBy;
  rounding: 'half_up';
}

export interface CalcInput {
  grossPoisha: Poisha;
  snapshot: RateSnapshot;
  vatInputPoisha?: Poisha | undefined;
  vatOverridePoisha?: Poisha | undefined;
  vatOverrideReason?: string | undefined; // PLAN-DERIVED
  commissionOverridePoisha?: Poisha | undefined;
  commissionOverrideReason?: string | undefined; // PLAN-DERIVED
}

export interface CalcResult {
  grossPoisha: Poisha;
  vatPoisha: Poisha;
  commissionPoisha: Poisha;
  chargePoisha: Poisha;
  businessChargePoisha: Poisha;
  customerChargePoisha: Poisha;
  netAfterDeductionsPoisha: Poisha;
}
