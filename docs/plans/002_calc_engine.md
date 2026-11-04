# 002_calc_engine.md — Authoritative Calculation Engine, Shared Domain Schemas, and Differential Fixtures

- Plan Identifier: CLT-PLAN-002
- Phase: Phase 0 / M0
- Milestone: M0
- Parent Document: docs/plans/PRD-payment-ledger-app.md (v1.19)
- PRD sections covered: §4 (Q12), §6.1–§6.8, §9.1 (wire format and validation), §12 (South Asian currency grouping), §16.1 (calculation and invariant tests)
- Depends on: 001
- Current Status: Not Implemented
- Revision: 2.2 — 2026-11-01 (remediated 11 Cold Financial & Distributed Systems audit findings)

## 1. Purpose

Implement the single authoritative calculation engine (`packages/calc`) and the shared domain schemas, serialization utilities, and validation rules (`packages/shared`). This package executes pure financial arithmetic in native integer `bigint` poisha without floats, enforces deduction guards and mode-specific input validation, satisfies paper ledger fixtures (PRD §6.6) and forward-looking fixtures P1–P6 (PRD §6.7), generates fast-check property tests (conservation, non-negativity, idempotence, charge partitioning, input-mode mutual exclusivity, boundary conditions, and guard rejection), and exports a canonical fixture file (`packages/calc/fixtures/test_fixtures.json`) for SQL differential parity testing in Plan 004.

## 2. Scope

- IN:
  - Pure calculation engine in `packages/calc`:
    - Native `bigint` integer arithmetic (1 BDT = 100 poisha).
    - Rounding functions: `mulBp(amount, bp)` and `roundHalfUp(numerator, divisor)` with non-negative floor integer math and range guards.
    - Exported constant `ENGINE_VERSION = 1` for protocol compatibility checks (PRD §6.1).
    - Domain types: `Poisha`, `SerializedPoisha`, `RateSnapshot`, `CalcInput`, `CalcResult`, `VatMode`, `CommissionBase`, `ChargesBorneBy`.
    - Custom error classes: `InvalidCalcInputError` and `DeductionsExceedGrossError`.
    - Snapshot basis-point range validation: integer between 0 and 10000 (0% to 100%) for VAT, commission, and charge basis points.
    - Input validation rules (F20, Finding #23): positive gross guard, manual VAT validation, percentage VAT override validation, and commission override validation.
    - Authoritative per-entry deduction guard evaluated first (`vat + commission + businessCharge <= gross`) before universal non-negativity checks.
    - Three VAT calculation modes: `manual`, `percent_of_gross`, and `percent_inclusive`.
    - Fee partitioning model: `businessCharge` versus `customerCharge`.
    - Paper-ledger fixture tests (all 10 entries individually, aggregate totals, and 2 rounding traps).
    - Forward-looking automated fixture tests (P1, P2, P3, P4, P5, P6).
    - Property-based tests via `fast-check` for mathematical and financial invariants (Gross Conservation across all modes including manual VAT, Non-negativity, Idempotence of calculateEntry, Charge partitioning, Mode Mutual Exclusivity F20, Gross = 1 boundary, and Deduction Guard rejection).
    - Shared test fixtures JSON artifact (`packages/calc/fixtures/test_fixtures.json`) with paper ledger rows, P1–P6 fixtures, explicit overrides, guard-rejection cases, `mulBp` half-up boundary vectors at 0.5, and customer-borne charge cases.
  - Shared domain schemas and wire format in `packages/shared`:
    - Dependency on `@clt/calc` workspace package and TypeScript project references.
    - Safe wire serialization: `bigint` to decimal string and decimal string to `bigint` with real verification of BigInt JSON serialization failure and Number precision loss (> 2^53 - 1).
    - Zod validation schemas for monetary amounts: `poishaSchema` enforcing non-negative integer regex `/^(0|[1-9]\d*)$/` and PostgreSQL 64-bit signed integer max ceiling (`9223372036854775807n`).
    - Domain Zod schemas: `outboxOpSchema`, `entryDtoSchema`, and `rateProfileSchema` with embedded `methodRates`.
    - RFC 8785 JSON Canonicalization Scheme (JCS) helper `canonicalJson` and SHA-256 hash helper `canonicalJsonHash`.
    - BDT currency display formatters using deterministic South Asian digit grouping (`৳1,23,456.00` and `৳1,00,00,000.00`) independent of Node ICU builds.
    - User input decimal constraint: rejects inputs with more than 2 decimal digits with exact message `Maximum 2 decimal digits allowed`.
    - Pure integer `parseBdtToPoisha` parser for UI input handling without floating-point math, strictly rejecting empty strings and invalid formats.
- OUT:
  - Database schema migrations or PostgreSQL constraint DDL (owned by Plan 003).
  - Database stored procedures or SQL functions (owned by Plans 004 and 005).
  - Client state store or Dexie offline outbox (owned by Plans 010 and 011).
  - SvelteKit server endpoints or route handlers (owned by Plans 008, 009, 011).

## 3. Preconditions

1. Plan 001 is Implemented and workspace package manifests configure inter-package dependencies.
   - Check command: `test -f packages/calc/package.json && test -f packages/shared/package.json && echo "READY"`
   - Expected output: `READY`
2. Workspace dependencies installed and `@clt/calc` referenced by `@clt/shared` via `"@clt/calc": "workspace:*"`.
   - Check command: `pnpm --filter @clt/shared exec tsc -v`
   - Expected output: string containing `Version 5.`.
3. Vitest and fast-check available in `packages/calc` and `packages/shared`.
   - Check command: `pnpm --filter @clt/calc exec vitest --version`
   - Expected output: string matching `^2.`.
4. `tsconfig.base.json` includes `"resolveJsonModule": true` and project references.

## 4. Files

| Exact Path | Action | One-line Purpose |
|---|---|---|
| `packages/calc/package.json` | update | Package manifest exporting build types and scripts |
| `packages/calc/tsconfig.json` | update | TypeScript config with composite project references and test inclusion |
| `packages/calc/src/types.ts` | create | TypeScript type definitions matching PRD §6.1 and `ENGINE_VERSION = 1` |
| `packages/calc/src/errors.ts` | create | Error classes `InvalidCalcInputError` and `DeductionsExceedGrossError` |
| `packages/calc/src/rounding.ts` | create | Rounding functions `mulBp` and `roundHalfUp` with input validation |
| `packages/calc/src/calculate.ts` | create | Pure entry calculation function `calculateEntry` with deduction guards |
| `packages/calc/src/index.ts` | create | Root barrel export for `@clt/calc` package |
| `packages/calc/fixtures/test_fixtures.json` | create | Comprehensive canonical fixture file consumed by TS and SQL differential tests |
| `packages/calc/test/fixtures.test.ts` | create | Unit tests executing fixtures from PRD §6.6 and §6.7, rounding traps, and guard precedence |
| `packages/calc/test/properties.test.ts` | create | Property tests executing fast-check invariant assertions across all modes and boundaries |
| `packages/shared/package.json` | update | Package manifest declaring workspace dependency on `@clt/calc` |
| `packages/shared/tsconfig.json` | update | TypeScript config with project reference to `packages/calc` |
| `packages/shared/src/types.ts` | create | Re-exported calculation types, domain DTO types, and wire types |
| `packages/shared/src/wire.ts` | create | Decimal string to bigint converters, 64-bit ceiling Zod schemas, domain schemas, and RFC 8785 hashing |
| `packages/shared/src/money.ts` | create | Deterministic South Asian grouping, string parsing, and 2-decimal input validation |
| `packages/shared/src/index.ts` | create | Root barrel export for `@clt/shared` package |
| `packages/shared/test/wire.test.ts` | create | Tests for 64-bit precision, BigInt serialization failures, formatting, and RFC 8785 hashing |

## 5. Steps

Shell: bash. Working directory for all steps is `/home/zia/Documents/My Projects/Cosmo_Ledger_Track`.

1. Configure `packages/calc/package.json` and `packages/calc/tsconfig.json` referencing Specification 6.14.
   - Command: copy configuration blocks into `packages/calc/package.json` and `packages/calc/tsconfig.json`.
   - Check: `pnpm --filter @clt/calc exec tsc --version`
   - Expected output: exits 0.

2. Create types definition file `packages/calc/src/types.ts` referencing Specification 6.1.
   - Command: copy block 6.1 into `packages/calc/src/types.ts`.
   - Check: `grep -c 'ENGINE_VERSION = 1' packages/calc/src/types.ts`
   - Expected output: `1`

3. Create custom errors file `packages/calc/src/errors.ts` referencing Specification 6.2.
   - Command: copy block 6.2 into `packages/calc/src/errors.ts`.
   - Check: `cat packages/calc/src/errors.ts`
   - Expected output: contains `class InvalidCalcInputError` and `class DeductionsExceedGrossError`.

4. Create rounding implementation file `packages/calc/src/rounding.ts` referencing Specification 6.3.
   - Command: copy block 6.3 into `packages/calc/src/rounding.ts`.
   - Check: `cat packages/calc/src/rounding.ts`
   - Expected output: exports `mulBp` and `roundHalfUp`.

5. Create calculation engine file `packages/calc/src/calculate.ts` referencing Specification 6.4.
   - Command: copy block 6.4 into `packages/calc/src/calculate.ts`.
   - Check: `head -n 35 packages/calc/src/calculate.ts`
   - Expected output: exports `calculateEntry`.

6. Create barrel export file `packages/calc/src/index.ts` referencing Specification 6.5.
   - Command: copy block 6.5 into `packages/calc/src/index.ts`.
   - Check: `cat packages/calc/src/index.ts`
   - Expected output: exports all functions, errors, types, and `ENGINE_VERSION`.

7. Create shared canonical fixture file `packages/calc/fixtures/test_fixtures.json` referencing Specification 6.6.
   - Command: copy block 6.6 into `packages/calc/fixtures/test_fixtures.json`.
   - Check: `node -e 'const f=JSON.parse(fs.readFileSync("packages/calc/fixtures/test_fixtures.json")); console.log(f.paperLedgerRows.length);'`
   - Expected output: `10`

8. Create unit test suite `packages/calc/test/fixtures.test.ts` referencing Specification 6.7.
   - Command: copy block 6.7 into `packages/calc/test/fixtures.test.ts`.
   - Check: `pnpm --filter @clt/calc test`
   - Expected output: all unit fixture tests pass.

9. Create property test suite `packages/calc/test/properties.test.ts` referencing Specification 6.8.
   - Command: copy block 6.8 into `packages/calc/test/properties.test.ts`.
   - Check: `pnpm --filter @clt/calc test`
   - Expected output: all fast-check property tests pass.

10. Configure `packages/shared/package.json` and `packages/shared/tsconfig.json` referencing Specification 6.14.
    - Command: copy configuration blocks into `packages/shared/package.json` and `packages/shared/tsconfig.json`.
    - Check: `cat packages/shared/package.json`
    - Expected output: contains `"@clt/calc": "workspace:*"`.

11. Create shared types file `packages/shared/src/types.ts` referencing Specification 6.9.
    - Command: copy block 6.9 into `packages/shared/src/types.ts`.
    - Check: `cat packages/shared/src/types.ts`
    - Expected output: contains re-exports from `@clt/calc` and shared DTO types.

12. Create wire serialization file `packages/shared/src/wire.ts` referencing Specification 6.10.
    - Command: copy block 6.10 into `packages/shared/src/wire.ts`.
    - Check: `cat packages/shared/src/wire.ts`
    - Expected output: exports `poishaToString`, `stringToPoisha`, `poishaSchema`, and `canonicalJsonHash`.

13. Create money formatting and input validation file `packages/shared/src/money.ts` referencing Specification 6.11.
    - Command: copy block 6.11 into `packages/shared/src/money.ts`.
    - Check: `cat packages/shared/src/money.ts`
    - Expected output: exports `formatPoishaToBdt`, `parseBdtToPoisha`, and `validateBdtInput`.

14. Create barrel export file `packages/shared/src/index.ts` referencing Specification 6.12.
    - Command: copy block 6.12 into `packages/shared/src/index.ts`.
    - Check: `cat packages/shared/src/index.ts`
    - Expected output: exports wire, domain schema, and money symbols.

15. Create shared test suite `packages/shared/test/wire.test.ts` referencing Specification 6.13.
    - Command: copy block 6.13 into `packages/shared/test/wire.test.ts`.
    - Check: `pnpm --filter @clt/shared test`
    - Expected output: all serialization, precision failure, and validation tests pass.

16. Execute build, typecheck, and test scripts across all workspace packages.
    - Command: `pnpm -r build && pnpm typecheck && pnpm test`
    - Check: check exit code.
    - Expected output: exits with code 0.

## 6. Specifications

### 6.1 `packages/calc/src/types.ts`
```typescript
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
```

### 6.2 `packages/calc/src/errors.ts`
```typescript
export class InvalidCalcInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCalcInputError';
  }
}

export class DeductionsExceedGrossError extends Error {
  public readonly grossPoisha: bigint;
  public readonly totalDeductionsPoisha: bigint;
  public readonly vatPoisha: bigint;
  public readonly commissionPoisha: bigint;
  public readonly businessChargePoisha: bigint;

  constructor(
    grossPoisha: bigint,
    vatPoisha: bigint,
    commissionPoisha: bigint,
    businessChargePoisha: bigint,
  ) {
    const totalDeductionsPoisha = vatPoisha + commissionPoisha + businessChargePoisha;
    super(
      `Total deductions (${totalDeductionsPoisha.toString()} poisha: vat=${vatPoisha.toString()}, commission=${commissionPoisha.toString()}, businessCharge=${businessChargePoisha.toString()}) exceed gross amount (${grossPoisha.toString()} poisha)`,
    );
    this.name = 'DeductionsExceedGrossError';
    this.grossPoisha = grossPoisha;
    this.totalDeductionsPoisha = totalDeductionsPoisha;
    this.vatPoisha = vatPoisha;
    this.commissionPoisha = commissionPoisha;
    this.businessChargePoisha = businessChargePoisha;
  }
}
```

### 6.3 `packages/calc/src/rounding.ts`
```typescript
import type { Poisha } from './types.js';
import { InvalidCalcInputError } from './errors.js';

/**
 * mulBp(amount, bp) = floor((amount * bp + 5000n) / 10000n)
 * Round half up on non-negative integer poisha amounts (PRD §6.2).
 */
export function mulBp(amount: Poisha, bp: number | bigint): Poisha {
  if (amount < 0n) {
    throw new InvalidCalcInputError('Cannot multiply negative poisha amount in mulBp');
  }
  if (typeof bp === 'number') {
    if (!Number.isInteger(bp)) {
      throw new InvalidCalcInputError(`Basis points must be an integer, received: ${bp}`);
    }
  }
  const bpBig = typeof bp === 'bigint' ? bp : BigInt(bp);
  if (bpBig < 0n || bpBig > 10000n) {
    throw new InvalidCalcInputError('Basis points must be between 0 and 10000');
  }
  return (amount * bpBig + 5000n) / 10000n;
}

/**
 * roundHalfUp(numerator, divisor) = floor((2n * numerator + divisor) / (2n * divisor))
 * Exact integer half-up without odd divisor bias (PRD §6.2).
 */
export function roundHalfUp(numerator: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) {
    throw new InvalidCalcInputError('Divisor must be positive in roundHalfUp');
  }
  if (numerator < 0n) {
    throw new InvalidCalcInputError('Numerator must be non-negative in roundHalfUp');
  }
  return (2n * numerator + divisor) / (2n * divisor);
}
```

### 6.4 `packages/calc/src/calculate.ts`
```typescript
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
  if (
    !Number.isInteger(snapshot.vat.bp) ||
    snapshot.vat.bp < 0 ||
    snapshot.vat.bp > 10000
  ) {
    throw new InvalidCalcInputError('VAT basis points must be an integer between 0 and 10000');
  }
  if (
    !Number.isInteger(snapshot.commission.bp) ||
    snapshot.commission.bp < 0 ||
    snapshot.commission.bp > 10000
  ) {
    throw new InvalidCalcInputError('Commission basis points must be an integer between 0 and 10000');
  }
  if (
    !Number.isInteger(snapshot.chargeBp) ||
    snapshot.chargeBp < 0 ||
    snapshot.chargeBp > 10000
  ) {
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
    throw new InvalidCalcInputError(`Unsupported commission base: ${String(snapshot.commission.base)}`);
  }

  let commissionPoisha: Poisha;
  if (input.commissionOverridePoisha !== undefined && input.commissionOverridePoisha !== null) {
    commissionPoisha = input.commissionOverridePoisha;
  } else {
    commissionPoisha = mulBp(commissionBase, snapshot.commission.bp);
  }

  // 7. Charge Calculation and Partitioning (Strict enum validation ensures charge partitioning invariant)
  if (snapshot.chargesBorneBy !== 'business' && snapshot.chargesBorneBy !== 'customer') {
    throw new InvalidCalcInputError(`Unsupported chargesBorneBy: ${String(snapshot.chargesBorneBy)}`);
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
  if (vatPoisha < 0n || commissionPoisha < 0n || businessChargePoisha < 0n || customerChargePoisha < 0n) {
    throw new InvalidCalcInputError('Calculated deduction components must be non-negative');
  }

  // 10. Net Component Calculation (PRD §6.3 balancing identity)
  const netAfterDeductionsPoisha = grossPoisha - vatPoisha - commissionPoisha - businessChargePoisha;

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
```

### 6.5 `packages/calc/src/index.ts`
```typescript
export * from './types.js';
export * from './errors.js';
export * from './rounding.js';
export * from './calculate.js';
```

### 6.6 `packages/calc/fixtures/test_fixtures.json`
```json
{
  "version": 1,
  "description": "Comprehensive authoritative fixtures from PRD §6.6 and §6.7 in poisha",
  "paperLedgerProfile": {
    "rateProfileId": "00000000-0000-0000-0000-000000000001",
    "version": 1,
    "engineVersion": 1,
    "vat": { "mode": "manual", "bp": 0 },
    "commission": { "bp": 4200, "base": "gross_minus_vat" },
    "chargeBp": 0,
    "chargesBorneBy": "business",
    "rounding": "half_up"
  },
  "paperLedgerRows": [
    { "row": 1, "customer": "Ayash", "subQty": 2, "method": "bkash", "chargeBp": 115, "grossPoisha": "590900", "vatInputPoisha": "50900", "expectedCommissionPoisha": "226800", "expectedChargePoisha": "6795", "expectedNetPoisha": "306405" },
    { "row": 2, "customer": "Abida", "subQty": 1, "method": "cash", "chargeBp": 0, "grossPoisha": "330000", "vatInputPoisha": "30000", "expectedCommissionPoisha": "126000", "expectedChargePoisha": "0", "expectedNetPoisha": "174000" },
    { "row": 3, "customer": "Ahiyan", "subQty": 2, "method": "cash", "chargeBp": 0, "grossPoisha": "590900", "vatInputPoisha": "50900", "expectedCommissionPoisha": "226800", "expectedChargePoisha": "0", "expectedNetPoisha": "313200" },
    { "row": 4, "customer": "Suhaima (H)", "subQty": 2, "method": "card", "chargeBp": 150, "grossPoisha": "838400", "vatInputPoisha": "58400", "expectedCommissionPoisha": "327600", "expectedChargePoisha": "12576", "expectedNetPoisha": "439824" },
    { "row": 5, "customer": "Tahra", "subQty": 2, "method": "card", "chargeBp": 150, "grossPoisha": "590900", "vatInputPoisha": "50900", "expectedCommissionPoisha": "226800", "expectedChargePoisha": "8864", "expectedNetPoisha": "304336" },
    { "row": 6, "customer": "Aaan", "subQty": 2, "method": "card", "chargeBp": 150, "grossPoisha": "590900", "vatInputPoisha": "50900", "expectedCommissionPoisha": "226800", "expectedChargePoisha": "8864", "expectedNetPoisha": "304336" },
    { "row": 7, "customer": "Azlan", "subQty": 1, "method": "card", "chargeBp": 150, "grossPoisha": "330000", "vatInputPoisha": "30000", "expectedCommissionPoisha": "126000", "expectedChargePoisha": "4950", "expectedNetPoisha": "169050" },
    { "row": 8, "customer": "Mandisha", "subQty": 1, "method": "cash", "chargeBp": 0, "grossPoisha": "330000", "vatInputPoisha": "30000", "expectedCommissionPoisha": "126000", "expectedChargePoisha": "0", "expectedNetPoisha": "174000" },
    { "row": 9, "customer": "Autnika", "subQty": 1, "method": "cash", "chargeBp": 0, "grossPoisha": "330000", "vatInputPoisha": "30000", "expectedCommissionPoisha": "126000", "expectedChargePoisha": "0", "expectedNetPoisha": "174000" },
    { "row": 10, "customer": "Tridha", "subQty": 2, "method": "card", "chargeBp": 150, "grossPoisha": "590900", "vatInputPoisha": "50900", "expectedCommissionPoisha": "226800", "expectedChargePoisha": "8864", "expectedNetPoisha": "304336" }
  ],
  "paperLedgerAssertedTotals": {
    "totalSubQty": 16,
    "totalGrossPoisha": "5112900",
    "totalVatPoisha": "432900",
    "totalCommissionPoisha": "1965600",
    "totalBkashChargePoisha": "6795",
    "totalCardChargePoisha": "44118",
    "totalNetPoisha": "2663487"
  },
  "forwardLookingFixtures": {
    "percentInclusive": [
      { "id": "P1", "grossPoisha": "590900", "vatBp": 1000, "expectedBasePoisha": "537182", "expectedVatPoisha": "53718" },
      { "id": "P2", "grossPoisha": "330000", "vatBp": 500, "expectedBasePoisha": "314286", "expectedVatPoisha": "15714" },
      { "id": "P3", "grossPoisha": "1000000", "vatBp": 1500, "expectedBasePoisha": "869565", "expectedVatPoisha": "130435" }
    ],
    "percentOfGross": {
      "id": "P4",
      "grossPoisha": "500000",
      "vatBp": 750,
      "commissionBp": 4200,
      "commissionBase": "gross_minus_vat",
      "chargeBp": 115,
      "chargesBorneBy": "business",
      "expectedVatPoisha": "37500",
      "expectedCommissionBasePoisha": "462500",
      "expectedCommissionPoisha": "194250",
      "expectedChargePoisha": "5750",
      "expectedBusinessChargePoisha": "5750",
      "expectedCustomerChargePoisha": "0",
      "expectedNetPoisha": "262500"
    },
    "customerBorneCharge": {
      "id": "P5",
      "grossPoisha": "590900",
      "vatInputPoisha": "50900",
      "commissionBp": 4200,
      "commissionBase": "gross_minus_vat",
      "chargeBp": 115,
      "chargesBorneBy": "customer",
      "expectedVatPoisha": "50900",
      "expectedCommissionPoisha": "226800",
      "expectedChargePoisha": "6795",
      "expectedBusinessChargePoisha": "0",
      "expectedCustomerChargePoisha": "6795",
      "expectedNetPoisha": "313200"
    },
    "explicitOverrides": {
      "id": "P6",
      "grossPoisha": "1000000",
      "vatMode": "percent_inclusive",
      "vatBp": 1500,
      "vatOverridePoisha": "100000",
      "vatOverrideReason": "Special statutory exemption agreement",
      "commissionBase": "gross",
      "commissionBp": 4000,
      "commissionOverridePoisha": "300000",
      "commissionOverrideReason": "Volume bonus waiver",
      "chargeBp": 150,
      "chargesBorneBy": "business",
      "expectedVatPoisha": "100000",
      "expectedCommissionPoisha": "300000",
      "expectedChargePoisha": "15000",
      "expectedBusinessChargePoisha": "15000",
      "expectedCustomerChargePoisha": "0",
      "expectedNetPoisha": "585000"
    }
  },
  "roundingBoundaryVectors": [
    { "amountPoisha": "100", "bp": 50, "expectedPoisha": "1", "note": "Exact half-up boundary: 100*50 + 5000 = 10000 / 10000 = 1" },
    { "amountPoisha": "100", "bp": 49, "expectedPoisha": "0", "note": "Just below half-up boundary: 100*49 + 5000 = 9900 / 10000 = 0" },
    { "amountPoisha": "300", "bp": 50, "expectedPoisha": "2", "note": "300*50 + 5000 = 20000 / 10000 = 2" }
  ],
  "guardRejectionCases": [
    {
      "grossPoisha": "100000",
      "vatInputPoisha": "20000",
      "commissionBp": 8000,
      "chargeBp": 1000,
      "chargesBorneBy": "business",
      "expectedError": "DeductionsExceedGrossError",
      "note": "20000 + 80000 + 10000 = 110000 > 100000"
    }
  ]
}
```

### 6.7 `packages/calc/test/fixtures.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateEntry } from '../src/calculate.js';
import { mulBp, roundHalfUp } from '../src/rounding.js';
import { DeductionsExceedGrossError, InvalidCalcInputError } from '../src/errors.js';
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
    expect(result.vatPoisha + result.commissionPoisha + result.businessChargePoisha + result.netAfterDeductionsPoisha).toBe(result.grossPoisha);
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
```

### 6.8 `packages/calc/test/properties.test.ts`
```typescript
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
        fc.bigInt({ min: 1n, max: 10000000000n }),   // 1 poisha boundary up to 100,000,000 BDT
        fc.integer({ min: 0, max: 2500 }),           // VAT bp: 0% to 25%
        fc.integer({ min: 0, max: 5000 }),           // Commission bp: 0% to 50%
        fc.integer({ min: 0, max: 500 }),            // Charge bp: 0% to 5%
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
          expect(result.businessChargePoisha + result.customerChargePoisha).toBe(result.chargePoisha);
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
        fc.bigInt({ min: 1n, max: 10000000000n }),   // 1 poisha boundary
        fc.integer({ min: 0, max: 4000 }),           // Manual VAT ratio bp: 0% to 40%
        fc.integer({ min: 0, max: 5000 }),           // Commission bp: 0% to 50%
        fc.integer({ min: 0, max: 500 }),            // Charge bp: 0% to 5%
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
          expect(result.businessChargePoisha + result.customerChargePoisha).toBe(result.chargePoisha);
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

          expect(() => calculateEntry({ grossPoisha, snapshot })).toThrow(DeductionsExceedGrossError);
        },
      ),
      { numRuns: 300 },
    );
  });
});
```

### 6.9 `packages/shared/src/types.ts`
```typescript
export type {
  Poisha,
  SerializedPoisha,
  VatMode,
  CommissionBase,
  ChargesBorneBy,
  RateSnapshot,
  CalcInput,
  CalcResult,
} from '@clt/calc';
export { ENGINE_VERSION } from '@clt/calc';

export interface OutboxOpDto {
  opId: string;
  type: 'create_entry' | 'request_void' | 'void_entry' | 'supersede_entry' | 'discard_rejected_entry';
  clientCreatedAt: string;
  payload: Record<string, unknown>;
  supersedesRejectedOpId?: string | null;
  maxKnownRateVersion: number;
}

export interface EntryDto {
  id: string;
  entryDate: string;
  customerName: string;
  subQty: number;
  paymentMethodCode: string;
  txnRef?: string | null;
  grossPoisha: string;
  vatInputPoisha?: string | null;
  vatOverridePoisha?: string | null;
  vatOverrideReason?: string | null;
  commissionOverridePoisha?: string | null;
  commissionOverrideReason?: string | null;
  vatPoisha: string;
  commissionPoisha: string;
  chargePoisha: string;
  businessChargePoisha: string;
  customerChargePoisha: string;
  netPoisha: string;
  rateProfileId: string;
  rateSnapshot: Record<string, unknown>;
}
```

### 6.10 `packages/shared/src/wire.ts`
```typescript
import { z } from 'zod';
import type { Poisha, SerializedPoisha } from '@clt/calc';

/**
 * Maximum 64-bit signed integer value in PostgreSQL (2^63 - 1).
 */
export const MAX_POISHA_64BIT = 9223372036854775807n;

/**
 * Converts native bigint poisha to decimal string for JSON and Dexie storage (PRD §6.1, §9.1).
 */
export function poishaToString(amount: Poisha): SerializedPoisha {
  return amount.toString(10);
}

/**
 * Converts serialized decimal string to native bigint poisha.
 * Strictly verifies no invalid leading zeros and within 64-bit ceiling.
 */
export function stringToPoisha(str: SerializedPoisha): Poisha {
  if (!/^(0|[1-9]\d*)$/.test(str)) {
    throw new TypeError(`Invalid poisha decimal string format: "${str}"`);
  }
  const val = BigInt(str);
  if (val > MAX_POISHA_64BIT) {
    throw new RangeError(`Poisha value exceeds 64-bit integer limit: "${str}"`);
  }
  return val;
}

/**
 * Converts serialized signed decimal string to native bigint poisha.
 * Used for statement and settlement variance computations (paid - expected) which can be negative.
 */
export function stringToSignedPoisha(str: string): Poisha {
  if (!/^-?(0|[1-9]\d*)$/.test(str)) {
    throw new TypeError(`Invalid signed poisha decimal string format: "${str}"`);
  }
  const val = BigInt(str);
  if (val > MAX_POISHA_64BIT || val < -MAX_POISHA_64BIT) {
    throw new RangeError(`Poisha value exceeds 64-bit integer limit: "${str}"`);
  }
  return val;
}

/**
 * Zod schema transforming non-negative decimal string to native BigInt.
 * Enforces regex /^(0|[1-9]\d*)$/ to reject leading zeros (e.g. "007") and 64-bit bounds.
 */
export const poishaSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, { message: 'Must be a non-negative integer string without leading zeros' })
  .refine(
    (val) => {
      try {
        const b = BigInt(val);
        return b <= MAX_POISHA_64BIT;
      } catch {
        return false;
      }
    },
    { message: 'Amount exceeds maximum 64-bit integer limit' },
  )
  .transform((val) => BigInt(val));

/**
 * Zod schema transforming signed decimal string to native BigInt.
 */
export const signedPoishaSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/, { message: 'Must be a valid signed integer string without leading zeros' })
  .refine(
    (val) => {
      try {
        const b = BigInt(val);
        return b <= MAX_POISHA_64BIT && b >= -MAX_POISHA_64BIT;
      } catch {
        return false;
      }
    },
    { message: 'Amount exceeds maximum 64-bit signed integer limit' },
  )
  .transform((val) => BigInt(val));

/**
 * Zod schema for 64-bit sequence string.
 */
export const seq64Schema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, { message: 'Must be a valid 64-bit sequence string' })
  .transform((val) => BigInt(val));

/**
 * Zod schema for outbox operations (PRD §9.1).
 */
export const outboxOpSchema = z.object({
  opId: z.string().uuid(),
  type: z.enum(['create_entry', 'request_void', 'void_entry', 'supersede_entry', 'discard_rejected_entry']),
  clientCreatedAt: z.string().datetime({ offset: true }),
  payload: z.record(z.unknown()),
  supersedesRejectedOpId: z.string().uuid().nullable().optional(),
  maxKnownRateVersion: z.number().int().min(1),
});

/**
 * Zod schema for Entry data transfer object (PRD §6.5, §9.1).
 */
export const entryDtoSchema = z.object({
  id: z.string().uuid(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerName: z.string().min(1),
  subQty: z.number().int().min(1),
  paymentMethodCode: z.string().min(1),
  txnRef: z.string().nullable().optional(),
  grossPoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  vatInputPoisha: z.string().regex(/^(0|[1-9]\d*)$/).nullable().optional(),
  vatOverridePoisha: z.string().regex(/^(0|[1-9]\d*)$/).nullable().optional(),
  vatOverrideReason: z.string().nullable().optional(),
  commissionOverridePoisha: z.string().regex(/^(0|[1-9]\d*)$/).nullable().optional(),
  commissionOverrideReason: z.string().nullable().optional(),
  vatPoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  commissionPoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  chargePoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  businessChargePoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  customerChargePoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  netPoisha: z.string().regex(/^(0|[1-9]\d*)$/),
  rateProfileId: z.string().uuid(),
  rateSnapshot: z.record(z.unknown()),
});

/**
 * Zod schema for Rate Profile data transfer object (PRD §7.1, §8.6).
 */
export const rateProfileSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(1),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['draft', 'published', 'superseded']),
  vatMode: z.enum(['manual', 'percent_of_gross', 'percent_inclusive']),
  vatBp: z.number().int().min(0).max(10000),
  commissionBase: z.enum(['gross', 'gross_minus_vat']),
  commissionBp: z.number().int().min(0).max(10000),
  chargesBorneBy: z.enum(['business', 'customer']),
  methodRates: z.record(
    z.object({
      chargeBp: z.number().int().min(0).max(10000),
      chargeBorneBy: z.enum(['business', 'customer']).optional(),
    }),
  ),
});

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) deterministic stringifier.
 * Complies with RFC 8785 §3.2.2: object properties with undefined values are omitted entirely,
 * and undefined elements in arrays are serialized as null.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === undefined) {
    return 'null';
  }
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',') + ']';
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(rec[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Produces SHA-256 hex digest of RFC 8785 canonicalized JSON.
 */
export async function canonicalJsonHash(data: unknown): Promise<string> {
  const canonical = canonicalJson(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(canonical);
  const cryptoSubtle = globalThis.crypto?.subtle;
  if (!cryptoSubtle) {
    // Fallback for Node environments without globalThis.crypto.subtle
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  }
  const hashBuffer = await cryptoSubtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 6.11 `packages/shared/src/money.ts`
```typescript
import type { Poisha } from '@clt/calc';

/**
 * Deterministic South Asian number grouping (1,23,456 and 1,00,00,000)
 * Independent of Node ICU build configurations (PRD §4 Q12, §12).
 */
export function formatSouthAsianNumber(n: bigint): string {
  const str = n.toString(10);
  if (str.length <= 3) return str;
  const last3 = str.slice(-3);
  const remaining = str.slice(0, -3);
  return remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/**
 * Formats poisha integer into human-readable BDT string with South Asian digit grouping:
 * ৳5,909.00, ৳1,23,456.00, ৳1,00,00,000.00 (PRD §4 Q12, §6.6, §12).
 */
export function formatPoishaToBdt(amount: Poisha): string {
  const isNegative = amount < 0n;
  const absAmount = isNegative ? -amount : amount;
  const taka = absAmount / 100n;
  const poishaRemainder = absAmount % 100n;
  const poishaStr = poishaRemainder.toString(10).padStart(2, '0');

  const takaStr = formatSouthAsianNumber(taka);
  const sign = isNegative ? '-' : '';
  return `${sign}৳${takaStr}.${poishaStr}`;
}

/**
 * Backward-compatible alias for formatPoishaToBdt
 */
export const formatBdt = formatPoishaToBdt;

/**
 * Validates BDT text input: accepts up to 2 decimal places.
 * Throws error with exact PRD §9.1 message if more than 2 decimal places provided.
 */
export function validateBdtInput(input: string): void {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error('BDT amount cannot be empty');
  }
  const parts = trimmed.split('.');
  if (parts.length > 2) {
    throw new Error('Invalid decimal format');
  }
  if (parts.length === 2 && parts[1]!.length > 2) {
    throw new Error('Maximum 2 decimal digits allowed');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`Invalid BDT currency format: "${input}"`);
  }
}

/**
 * Pure integer poisha parser (PRD §6.1, §9.1, AGENTS.md Rule 2).
 * Converts user string input into integer poisha without floating-point math.
 */
export function parseBdtToPoisha(input: string): Poisha {
  const clean = input.replace(/,/g, '').trim();
  if (clean === '') {
    throw new Error('Invalid BDT currency format: ""');
  }
  if (clean === '0' || clean === '0.0' || clean === '0.00') return 0n;
  validateBdtInput(clean);
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    throw new Error(`Invalid BDT currency format: "${input}"`);
  }
  const [intPart, decPart = ''] = clean.split('.');
  const paddedDec = (decPart + '00').slice(0, 2);
  return BigInt(intPart!) * 100n + BigInt(paddedDec);
}
```

### 6.12 `packages/shared/src/index.ts`
```typescript
export * from './types.js';
export * from './wire.js';
export * from './money.js';
```

### 6.13 `packages/shared/test/wire.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import {
  poishaToString,
  stringToPoisha,
  poishaSchema,
  canonicalJson,
  canonicalJsonHash,
} from '../src/wire.js';
import {
  formatPoishaToBdt,
  formatBdt,
  validateBdtInput,
  parseBdtToPoisha,
  formatSouthAsianNumber,
} from '../src/money.js';

describe('Shared Wire and Precision Tests (PRD §9.1, §16.2 Test #4)', () => {
  it('proves BigInt serialization failure in standard JSON.stringify', () => {
    // Native JSON.stringify must throw TypeError on BigInt
    expect(() => JSON.stringify({ amount: 100n })).toThrow(TypeError);
  });

  it('proves JavaScript Number loses precision above 2^53 - 1', () => {
    // 2^53 - 1 = 9007199254740991
    const unsafePoisha = 9007199254740993n;
    const asNumber = Number(unsafePoisha);
    expect(BigInt(asNumber)).not.toBe(unsafePoisha);
  });

  it('safely serializes and deserializes values greater than 2^53 - 1 using decimal strings', () => {
    const hugePoisha = 900719925474099200n; // 9 quintillion poisha
    const serialized = poishaToString(hugePoisha);
    expect(serialized).toBe('900719925474099200');

    const deserialized = stringToPoisha(serialized);
    expect(deserialized).toBe(hugePoisha);

    const zodParsed = poishaSchema.parse(serialized);
    expect(zodParsed).toBe(hugePoisha);
  });

  it('rejects invalid poisha strings with leading zeros or exceeding 64-bit max', () => {
    expect(() => stringToPoisha('007')).toThrow(TypeError);
    expect(() => poishaSchema.parse('007')).toThrow();
    // 2^63 is 9223372036854775808 (exceeds signed 64-bit limit)
    expect(() => stringToPoisha('9223372036854775808')).toThrow(RangeError);
    expect(() => poishaSchema.parse('9223372036854775808')).toThrow();
  });

  it('formats poisha into expected BDT currency string with South Asian digit grouping (PRD §4 Q12, §12)', () => {
    expect(formatPoishaToBdt(590900n)).toBe('৳5,909.00');
    expect(formatBdt(590900n)).toBe('৳5,909.00');
    expect(formatPoishaToBdt(306405n)).toBe('৳3,064.05');
    expect(formatPoishaToBdt(0n)).toBe('৳0.00');
    // South Asian 6-digit lakh grouping
    expect(formatPoishaToBdt(12345600n)).toBe('৳1,23,456.00');
    // South Asian 8-digit crore grouping
    expect(formatPoishaToBdt(1000000000n)).toBe('৳1,00,00,000.00');
    // Negative amounts
    expect(formatPoishaToBdt(-50000n)).toBe('-৳500.00');
  });

  it('enforces 2-decimal BDT input rule and rejects empty strings', () => {
    expect(() => validateBdtInput('100.50')).not.toThrow();
    expect(() => validateBdtInput('100.5')).not.toThrow();
    expect(() => validateBdtInput('100')).not.toThrow();
    expect(() => validateBdtInput('100.555')).toThrow('Maximum 2 decimal digits allowed');
    expect(() => validateBdtInput('10.20.30')).toThrow('Invalid decimal format');
    expect(() => validateBdtInput('')).toThrow('BDT amount cannot be empty');
  });

  it('parses user BDT input strings into exact integer poisha without floats (PRD §6.1, §9.1)', () => {
    expect(parseBdtToPoisha('5909')).toBe(590900n);
    expect(parseBdtToPoisha('5909.5')).toBe(590950n);
    expect(parseBdtToPoisha('3,064.05')).toBe(306405n);
    expect(parseBdtToPoisha('1,23,456.00')).toBe(12345600n);
    expect(parseBdtToPoisha('1,00,00,000.50')).toBe(1000000050n);
    expect(parseBdtToPoisha('0')).toBe(0n);
    expect(parseBdtToPoisha('0.00')).toBe(0n);
    expect(parseBdtToPoisha('0.0')).toBe(0n);

    // Empty and invalid formats
    expect(() => parseBdtToPoisha('')).toThrow('Invalid BDT currency format: ""');
    expect(() => parseBdtToPoisha('100.')).toThrow('Invalid BDT currency format: "100."');
    expect(() => parseBdtToPoisha('.5')).toThrow('Invalid BDT currency format: ".5"');
    expect(() => parseBdtToPoisha('100.555')).toThrow('Maximum 2 decimal digits allowed');
    expect(() => parseBdtToPoisha('-50')).toThrow('Invalid BDT currency format: "-50"');
    expect(() => parseBdtToPoisha('abc')).toThrow('Invalid BDT currency format: "abc"');
  });

  it('generates deterministic RFC 8785 canonical JSON hash', async () => {
    const data1 = { b: 2, a: 1 };
    const data2 = { a: 1, b: 2 };
    expect(canonicalJson(data1)).toBe('{"a":1,"b":2}');
    expect(canonicalJson(data2)).toBe('{"a":1,"b":2}');
    const hash1 = await canonicalJsonHash(data1);
    const hash2 = await canonicalJsonHash(data2);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});
```

### 6.14 Package Configurations and TypeScript References

#### `packages/calc/package.json`
```json
{
  "name": "@clt/calc",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "development": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run"
  },
  "devDependencies": {
    "fast-check": "^3.22.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

#### `packages/calc/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

#### `packages/shared/package.json`
```json
{
  "name": "@clt/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "development": "./src/index.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run"
  },
  "dependencies": {
    "@clt/calc": "workspace:*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

#### `packages/shared/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "references": [
    { "path": "../calc" }
  ],
  "include": ["src/**/*"]
}
```

## 7. Tests

| Test Name | Input | Exact Expected Output | PRD Source | File |
|---|---|---|---|---|
| Paper Ledger Row 1 (Ayash) | Gross: 590900, VAT: 50900, bKash 115 bp | Comm: 226800, Charge: 6795, Net: 306405 | §6.6 Row 1 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 2 (Abida) | Gross: 330000, VAT: 30000, Cash 0 bp | Comm: 126000, Charge: 0, Net: 174000 | §6.6 Row 2 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 3 (Ahiyan) | Gross: 590900, VAT: 50900, Cash 0 bp | Comm: 226800, Charge: 0, Net: 313200 | §6.6 Row 3 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 4 (Suhaima) | Gross: 838400, VAT: 58400, Card 150 bp | Comm: 327600, Charge: 12576, Net: 439824 | §6.6 Row 4 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 5 (Tahra) | Gross: 590900, VAT: 50900, Card 150 bp | Comm: 226800, Charge: 8864, Net: 304336 | §6.6 Row 5 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 6 (Aaan) | Gross: 590900, VAT: 50900, Card 150 bp | Comm: 226800, Charge: 8864, Net: 304336 | §6.6 Row 6 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 7 (Azlan) | Gross: 330000, VAT: 30000, Card 150 bp | Comm: 126000, Charge: 4950, Net: 169050 | §6.6 Row 7 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 8 (Mandisha) | Gross: 330000, VAT: 30000, Cash 0 bp | Comm: 126000, Charge: 0, Net: 174000 | §6.6 Row 8 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 9 (Autnika) | Gross: 330000, VAT: 30000, Cash 0 bp | Comm: 126000, Charge: 0, Net: 174000 | §6.6 Row 9 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Row 10 (Tridha) | Gross: 590900, VAT: 50900, Card 150 bp | Comm: 226800, Charge: 8864, Net: 304336 | §6.6 Row 10 | `packages/calc/test/fixtures.test.ts` |
| Paper Ledger Asserted Totals | Sum of 10 rows (Qty 16) | Gross: 5112900, VAT: 432900, Comm: 1965600, bKash: 6795, Card: 44118, Net: 2663487 | §6.6 Totals | `packages/calc/test/fixtures.test.ts` |
| Rounding Trap 1 (Card row 5) | mulBp(590900, 150) | 8864 poisha | §6.6 Rounding Trap | `packages/calc/test/fixtures.test.ts` |
| Rounding Trap 2 (bKash row 1) | mulBp(590900, 115) | 6795 poisha | §6.6 Rounding Trap | `packages/calc/test/fixtures.test.ts` |
| mulBp Half-Up Boundaries | 100*50bp, 100*49bp, 300*50bp | 1 poisha, 0 poisha, 2 poisha | §6.2 Rounding | `packages/calc/test/fixtures.test.ts` |
| Fixture P1 (percent_inclusive) | Gross: 590900, VAT bp: 1000 | Base: 537182, VAT: 53718 | §6.7.1 P1 | `packages/calc/test/fixtures.test.ts` |
| Fixture P2 (percent_inclusive) | Gross: 330000, VAT bp: 500 | Base: 314286, VAT: 15714 | §6.7.1 P2 | `packages/calc/test/fixtures.test.ts` |
| Fixture P3 (percent_inclusive) | Gross: 1000000, VAT bp: 1500 | Base: 869565, VAT: 130435 | §6.7.1 P3 | `packages/calc/test/fixtures.test.ts` |
| Fixture P4 (percent_of_gross) | Gross: 500000, VAT bp: 750, Comm bp: 4200, bKash 115 bp | VAT: 37500, Comm: 194250, Charge: 5750, Net: 262500 | §6.7.2 P4 | `packages/calc/test/fixtures.test.ts` |
| Fixture P5 (customer-borne) | Gross: 590900, VAT: 50900, bKash 115 bp, customer | BusinessCharge: 0, CustomerCharge: 6795, Net: 313200 | §6.7.3 P5 | `packages/calc/test/fixtures.test.ts` |
| Fixture P6 (explicit overrides) | Gross: 1000000, VAT override: 100000, Comm override: 300000 | VAT: 100000, Comm: 300000, Charge: 15000, Net: 585000 | §6.7.4 P6 | `packages/calc/test/fixtures.test.ts` |
| Guard Precedence Check | Gross: 10000, Comm: 9000, Charge: 2000 (110%) | Throws `DeductionsExceedGrossError` | §6.3, Finding #23 | `packages/calc/test/fixtures.test.ts` |
| Snapshot Basis-Point Validation | Snapshot with bp: -1, 10001, -10, 15000, -5, 20000 | Throws `InvalidCalcInputError` | Finding #5 | `packages/calc/test/fixtures.test.ts` |
| Mode Input Mutual Exclusivity | Manual mode without VAT; manual with override; percent mode with manual VAT | Throws `InvalidCalcInputError` | F20, §6.3 | `packages/calc/test/fixtures.test.ts` |
| Deductions Exceed Gross Guard | Total deductions (10000 + 90000 + 20000 = 120000) > Gross (100000) | Throws `DeductionsExceedGrossError` | §6.3, Finding #23 | `packages/calc/test/fixtures.test.ts` |
| Property 1: Conservation of Gross | `fc.bigInt(1n, 10000000000n)`, all modes, gross=1 boundary | `gross === vat + comm + businessCharge + net`, `charge === biz + cust`, non-negative | §16.1 | `packages/calc/test/properties.test.ts` |
| Property 2: Idempotence | `calculateEntry(input)` called twice with arbitrary valid inputs | `result1 === result2` (deep equality) | Best Practice | `packages/calc/test/properties.test.ts` |
| Property 3: Mutual Exclusivity | Arbitrary `grossPoisha` with forbidden mode-input combinations | Throws `InvalidCalcInputError` | F20, §6.3 | `packages/calc/test/properties.test.ts` |
| Property 4: Deduction Guard | Arbitrary inputs where deductions > gross | Throws `DeductionsExceedGrossError` | §6.3 | `packages/calc/test/properties.test.ts` |
| BigInt JSON Failure Test | `JSON.stringify({ amount: 100n })` | Throws `TypeError` | §16.2 Test #4 | `packages/shared/test/wire.test.ts` |
| Number Precision Loss Test | `9007199254740993n` converted to Number | Precision loss verified (`BigInt(Number(n)) !== n`) | §16.2 Test #4 | `packages/shared/test/wire.test.ts` |
| Test #4 (Wire Precision > 2^53-1) | `900719925474099200n` | string: `"900719925474099200"` and back to bigint | §16.2 Test #4 | `packages/shared/test/wire.test.ts` |
| Poisha Leading Zero Rejection | `"007"` parsed by schema | Zod validation error thrown | §9.1 | `packages/shared/test/wire.test.ts` |
| Poisha 64-bit Ceiling Rejection | `"9223372036854775808"` parsed by schema | RangeError or Zod error thrown | §9.1 | `packages/shared/test/wire.test.ts` |
| South Asian Grouping (en-IN) | `12345600n`, `1000000000n`, `-50000n` | `'৳1,23,456.00'`, `'৳1,00,00,000.00'`, `'-৳500.00'` | §4 Q12, §12 | `packages/shared/test/wire.test.ts` |
| Decimal Digit Input Limit | Input: `'100.555'` | Throws `'Maximum 2 decimal digits allowed'` | §9.1 | `packages/shared/test/wire.test.ts` |
| Empty String BDT Rejection | Input: `''` | Throws `'Invalid BDT currency format: ""'` | §9.1 | `packages/shared/test/wire.test.ts` |
| Parse BDT to Poisha (whole) | `'5909'` | `590900n` | §6.1, §9.1 | `packages/shared/test/wire.test.ts` |
| Parse BDT to Poisha (1-dec) | `'5909.5'` | `590950n` | §6.1, §9.1 | `packages/shared/test/wire.test.ts` |
| Parse BDT to Poisha (2-dec) | `'3,064.05'`, `'1,23,456.00'`, `'1,00,00,000.50'` | `306405n`, `12345600n`, `1000000050n` | §6.1, §9.1 | `packages/shared/test/wire.test.ts` |
| Parse BDT to Poisha (zero) | `'0'`, `'0.00'`, `'0.0'` | `0n` | §6.1, §9.1 | `packages/shared/test/wire.test.ts` |
| Parse BDT to Poisha (invalid) | `'-50'`, `'abc'`, `'100.'`, `'.5'`, `'12.34.56'` | Throws formatting errors | §6.1, §9.1 | `packages/shared/test/wire.test.ts` |
| RFC 8785 Canonical JCS Hash | Key-shuffled objects `{ b: 2, a: 1 }` vs `{ a: 1, b: 2 }` | Canonical string identical, SHA-256 identical | §9.1 | `packages/shared/test/wire.test.ts` |

## 8. Acceptance Criteria

| Criterion | Observable Result | Exact Verify Command | Exact Expected Output |
|---|---|---|---|
| Paper Ledger Totals Match | All 10 fixtures equal asserted sums | `pnpm --filter @clt/calc test -- -t "Paper Ledger Fixtures"` | exits with code 0 |
| Forward Looking Fixtures Match | P1 to P6 pass assertions | `pnpm --filter @clt/calc test -- -t "Forward-Looking Automated Test Fixtures"` | exits with code 0 |
| Basis Point Validation Verified | Snapshot rejects out-of-range basis points | `pnpm --filter @clt/calc test -- -t "rejects out-of-range"` | exits with code 0 |
| Deductions Exceed Guard Verified | Guard evaluates first before non-negativity | `pnpm --filter @clt/calc test -- -t "proves guard precedence"` | exits with code 0 |
| Fast-Check Properties Pass | Conservation, non-negativity, idempotence, mutual exclusivity, and guard rejection verified | `pnpm --filter @clt/calc test -- -t "Fast-Check Property Tests"` | exits with code 0 |
| Wire Format 64-bit Survives | Values > 2^53 - 1 round-trip without loss | `pnpm --filter @clt/shared test -- -t "Shared Wire and Precision Tests"` | exits with code 0 |
| South Asian Formatting Verified | Lakhs (`1,23,456.00`) and Crores (`1,00,00,000.00`) formatted deterministically | `pnpm --filter @clt/shared test -- -t "South Asian digit grouping"` | exits with code 0 |
| Max 2 Decimal Input Guard | Rejects 3 decimal places with exact message | `pnpm --filter @clt/shared test -- -t "2-decimal BDT input rule"` | exits with code 0 |
| Parse BDT to Poisha Integer Parity | String inputs parsed to exact poisha without floats; empty input rejected | `pnpm --filter @clt/shared test -- -t "parses user BDT input strings"` | exits with code 0 |
| Canonical Fixture File Exists | JSON file valid and contains 10 rows plus boundary vectors | `node -e 'const f=JSON.parse(fs.readFileSync("packages/calc/fixtures/test_fixtures.json")); console.log(f.paperLedgerRows.length === 10 && f.roundingBoundaryVectors.length > 0);'` | `true` |

## 9. Hard Rules Touched

- Rule 1: Never hardcode rates; calculation engine takes dynamic `RateSnapshot` arguments.
- Rule 2: Integer poisha throughout; native `bigint` internal representations, decimal strings on wire.
- Rule 3: Single authoritative calculation engine; pure functions without I/O or Date dependencies.
- Rule 11: Zod validation on client and server schemas.
- Rule 17: No invented formulas or rounding methods; matches PRD §6.2 formulas verbatim.

## 10. Pitfalls

1. Floating-point contamination: Using JavaScript `Number` or `/` operator on money amounts.
   - Symptom: Fractional poisha rounding errors or precision loss on values above 90,000,000 BDT.
   - Fix: Use strictly native `bigint` operations (`n` literals) and the integer `mulBp` / `roundHalfUp` functions.
2. Inverted guard precedence: Checking component non-negativity before evaluating the total deduction guard.
   - Symptom: Silent clamping or generic errors instead of explicit `DeductionsExceedGrossError`.
   - Fix: Evaluate `vat + commission + businessCharge <= gross` as the initial verification step before individual non-negativity checks.
3. Mode input contamination: Accepting manual VAT inputs in percentage modes or overrides in manual mode.
   - Symptom: Ambiguous calculation paths or silent overrides.
   - Fix: Enforce strict mutual exclusivity as specified in block 6.4 step 3.
4. Locale mismatch in currency formatting: Depending on Node's ICU build.
   - Symptom: Million grouping (`123,456.00`) instead of South Asian lakh grouping (`1,23,456.00`).
   - Fix: Use deterministic `formatSouthAsianNumber` algorithm with regex `\B(?=(\d{2})+(?!\d))` (PRD §4 Q12, §12).
5. TypeScript RootDir & Project Reference Failures: Importing across workspaces without project references.
   - Symptom: TS6059 "file not under rootDir".
   - Fix: Configure composite project references in `tsconfig.json` and declare `"@clt/calc": "workspace:*"` in `packages/shared/package.json`.

## 11. PRD ISSUES and DECISION PENDING

- `calculateEntry` function name: `[PLAN-DERIVED]`. Central calculation function name derived from PRD §6.3 authoritative specification.
- `vatOverrideReason` and `commissionOverrideReason` fields on `CalcInput`: `[PLAN-DERIVED]`. PRD §6.5 requires overrides to record a reason; structured as explicit fields on `CalcInput` and passed into audit logging.

## 12. Handoff

Once this plan is Implemented, subsequent plans rely on:
- Exported functions from `@clt/calc`: `calculateEntry`, `mulBp`, `roundHalfUp`.
- Exported constants from `@clt/calc`: `ENGINE_VERSION = 1`.
- Exported types from `@clt/calc`: `Poisha`, `SerializedPoisha`, `RateSnapshot`, `CalcInput`, `CalcResult`.
- Exported utilities from `@clt/shared`: `poishaToString`, `stringToPoisha`, `poishaSchema`, `outboxOpSchema`, `entryDtoSchema`, `canonicalJson`, `canonicalJsonHash`, `formatPoishaToBdt`, `parseBdtToPoisha`, `validateBdtInput`.
- Canonical fixture file: `packages/calc/fixtures/test_fixtures.json` (consumed by Plan 004 for SQL parity testing and Plan 020 for differential testing).
- Exported error classes: `InvalidCalcInputError`, `DeductionsExceedGrossError`.

## 13. Suggested Task Breakdown

- Task CLT-T-013: Calculation engine core functions, types, errors, rounding, and project configurations (`packages/calc/src/*`, `packages/calc/package.json`, `packages/calc/tsconfig.json`). Role: Implementer. Priority: P0. Scope: `packages/calc/src/`. Depends on: CLT-T-010.
- Task CLT-T-014: Test fixtures, canonical JSON artifact, rounding boundary vectors, and unit/property test suites (`packages/calc/fixtures/test_fixtures.json`, `packages/calc/test/*`). Role: Implementer. Priority: P0. Scope: `packages/calc/fixtures/`, `packages/calc/test/`. Depends on: CLT-T-013.
- Task CLT-T-015: Shared wire converters, 64-bit ceiling Zod schemas, domain DTO schemas, RFC 8785 canonical hash, South Asian formatting, and wire tests (`packages/shared/src/*`, `packages/shared/test/*`, `packages/shared/package.json`, `packages/shared/tsconfig.json`). Role: Implementer. Priority: P0. Scope: `packages/shared/`. Depends on: CLT-T-013.

## Changelog

- 2026-11-01: Revision 2.2 remediated 11 Cold Financial & Distributed Systems audit findings:
  - Fixed RFC 8785 (JCS) `canonicalJson` implementation to strictly omit object keys with `undefined` values and serialize array `undefined` as `null`, eliminating deterministic client/server SHA-256 hash divergence and false `payload_hash_mismatch` alarms.
  - Implemented and exported missing `entryDtoSchema` and `rateProfileSchema` Zod schemas in `packages/shared/src/wire.ts` and `index.ts`.
  - Conformed `OutboxOpDto` and `outboxOpSchema` to PRD §9.1 and §16.2 Test #11: restored property name `type`, included `'request_void'` in allowed operation types, and removed envelope-level `actorId` and `deviceId` fields.
  - Restored missing authoritative calculation inputs in `EntryDto` (`vatInputPoisha`, `vatOverridePoisha`, `vatOverrideReason`, `commissionOverridePoisha`, `commissionOverrideReason`).
  - Added strict enum validation for `chargesBorneBy` in `calculateEntry` (`'business' | 'customer'`), preventing invalid values from silently zeroing provider fees and violating the Charge Partitioning Invariant.
  - Hardened VAT mode evaluation order in `calculateEntry` to validate `snapshot.vat.mode` before checking overrides, blocking invalid mode bypass.
  - Added `signedPoishaSchema` and `stringToSignedPoisha` supporting negative amounts for settlement and statement variance calculations.
  - Hardened `validateBdtInput` to reject non-numeric strings with exact currency format errors.
  - Added integer checks in `mulBp` to reject floats and NaN with `InvalidCalcInputError` instead of native `RangeError`.
  - Configured `rootDir: "./src"` and `outDir: "./dist"` in `packages/calc` and `packages/shared` `tsconfig.json` preventing source directory pollution during `tsc --build`.
- 2026-10-30: Revision 2.1 remediated all 15 Plan Audit findings:
  - Added `"@clt/calc": "workspace:*"` to `packages/shared/package.json` and composite project references in `tsconfig.json` resolving TS6059 and build failure.
  - Documented `"resolveJsonModule": true` and portable URL-based JSON fixture loading in `fixtures.test.ts`.
  - Configured `tsconfig.json` `rootDir: "."` and included `test/**/*` and `fixtures/**/*` ensuring tests are typechecked during `tsc --build`.
  - Replaced `toLocaleString('en-IN')` with deterministic regex-based `formatSouthAsianNumber` algorithm, guaranteeing `1,23,456.00` and `1,00,00,000.00` across all Node ICU builds.
  - Added fast-check properties for gross=1 boundary, deduction guard rejection, and expanded all 5 PRD §16.1 invariant properties.
  - Formally tagged `calculateEntry`, `vatOverrideReason`, and `commissionOverrideReason` as `[PLAN-DERIVED]` in Section 11 per AGENTS.md §6.
  - Aligned Acceptance Criteria verification command to `-t "Shared Wire and Precision Tests"`.
  - Added explicit unit test proving `DeductionsExceedGrossError` precedence before non-negativity checks.
  - Added real wire precision tests asserting `JSON.stringify` BigInt `TypeError` and Number precision loss above `2^53 - 1`.
  - Expanded `test_fixtures.json` with `roundingBoundaryVectors` (exact .5 half-up tests) and `guardRejectionCases`.
  - Hardened `poishaSchema` with non-negative integer regex `/^(0|[1-9]\d*)$/` rejecting leading zeros (e.g. "007") and signed 64-bit ceiling `MAX_POISHA_64BIT` (`9223372036854775807n`).
  - Added input non-negativity and basis-point range checks (0..10000) inside `mulBp` and `roundHalfUp`.
  - Enforced strict rejection of empty string `""`, `'100.'`, and `'.5'` in `parseBdtToPoisha` with exact PRD formatting error messages.
  - Exported `ENGINE_VERSION = 1` constant from `@clt/calc` package root.
  - Added shared domain schemas (`outboxOpSchema`, `entryDtoSchema`) and RFC 8785 JSON Canonicalization Scheme (`canonicalJson`, `canonicalJsonHash`).
- 2026-10-29: Revision 2.0 remediated Initial Plan Audit findings.
- 2026-10-29: Revision 1.0 initial specification of Plan 002.
