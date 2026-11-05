import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { calculateEntry, mulBp, roundHalfUp, DeductionsExceedGrossError } from '@clt/calc';
import type { RateSnapshot } from '@clt/calc';

/**
 * Plan 020 §6.2 — Differential parity of the TypeScript calculation engine
 * against PostgreSQL arithmetic using the canonical fixture dataset
 * `packages/calc/fixtures/test_fixtures.json` (PRD §6.5, §6.6, §6.7).
 * All comparisons stay on integer poisha (Hard Rule 2); zero net values are supported.
 */

const CONNECTION_STRING =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Reaches the repo root from any runner cwd (apps/web, repo root, etc.) by
// walking up to the directory containing pnpm-workspace.yaml.
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.resolve(dir, '..');
  }
  return process.cwd();
}

const fixturePath = path.join(
  repoRoot(),
  'packages',
  'calc',
  'fixtures',
  'test_fixtures.json',
);

interface PaperRow {
  grossPoisha: string;
  vatInputPoisha: string;
  chargeBp: number;
  expectedCommissionPoisha: string;
  expectedChargePoisha: string;
  expectedNetPoisha: string;
}

interface FrozenSnapshot {
  rateProfileId: string;
  version: number;
  engineVersion: number;
  vat: { mode: 'manual' | 'percent_of_gross' | 'percent_inclusive'; bp: number };
  commission: { bp: number; base: 'gross' | 'gross_minus_vat' };
  chargeBp: number;
  chargesBorneBy: 'business' | 'customer';
  rounding: 'half_up';
}

interface FixtureFile {
  paperLedgerProfile: FrozenSnapshot;
  paperLedgerRows: PaperRow[];
  roundingBoundaryVectors: Array<{ amountPoisha: string; bp: number; expectedPoisha: string }>;
  forwardLookingFixtures: {
    percentInclusive: Array<{
      id: string;
      grossPoisha: string;
      vatBp: number;
      expectedBasePoisha: string;
      expectedVatPoisha: string;
    }>;
    percentOfGross: {
      id: string;
      grossPoisha: string;
      vatBp: number;
      commissionBp: number;
      commissionBase: string;
      chargeBp: number;
      chargesBorneBy: string;
      expectedVatPoisha: string;
      expectedCommissionBasePoisha: string;
      expectedCommissionPoisha: string;
      expectedChargePoisha: string;
      expectedBusinessChargePoisha: string;
      expectedCustomerChargePoisha: string;
      expectedNetPoisha: string;
    };
    customerBorneCharge: {
      id: string;
      grossPoisha: string;
      vatInputPoisha: string;
      commissionBp: number;
      commissionBase: string;
      chargeBp: number;
      chargesBorneBy: string;
      expectedVatPoisha: string;
      expectedCommissionPoisha: string;
      expectedChargePoisha: string;
      expectedBusinessChargePoisha: string;
      expectedCustomerChargePoisha: string;
      expectedNetPoisha: string;
    };
    explicitOverrides: {
      id: string;
      grossPoisha: string;
      vatMode: string;
      vatBp: number;
      vatOverridePoisha: string;
      vatOverrideReason: string;
      commissionBase: string;
      commissionBp: number;
      commissionOverridePoisha: string;
      commissionOverrideReason: string;
      chargeBp: number;
      chargesBorneBy: string;
      expectedVatPoisha: string;
      expectedCommissionPoisha: string;
      expectedChargePoisha: string;
      expectedBusinessChargePoisha: string;
      expectedCustomerChargePoisha: string;
      expectedNetPoisha: string;
    };
  };
  guardRejectionCases: Array<{
    grossPoisha: string;
    vatInputPoisha: string;
    commissionBp: number;
    chargeBp: number;
    expectedError: string;
  }>;
}

describe('Calculation Engine Differential Parity Tests (TS vs PostgreSQL)', () => {
  let pgClient: Client;
  let fixtures: FixtureFile;

  beforeAll(async () => {
    pgClient = new Client({ connectionString: CONNECTION_STRING });
    await pgClient.connect();
    fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  });

  afterAll(async () => {
    await pgClient.end();
  });

  it('matches PostgreSQL mul_bp arithmetic on every canonical rounding boundary vector', async () => {
    // PRD §6.6 vectors, including the exact half-up boundary (100*50+5000=10000/10000=1),
    // the just-below boundary (0), and zero-amount edges — identical in TS and in SQL.
    expect(fixtures.roundingBoundaryVectors.length).toBeGreaterThan(0);
    for (const vec of fixtures.roundingBoundaryVectors) {
      const amount = BigInt(vec.amountPoisha);
      const tsResult = mulBp(amount, vec.bp);
      const sqlRes = await pgClient.query('SELECT mul_bp($1::bigint, $2::int) AS result', [
        amount.toString(),
        vec.bp,
      ]);
      const sqlResult = BigInt(sqlRes.rows[0].result);
      expect(tsResult).toBe(BigInt(vec.expectedPoisha));
      expect(sqlResult).toBe(BigInt(vec.expectedPoisha));
    }
  });

  it('validates every paper ledger row against PostgreSQL mul_bp and the TS engine', async () => {
    // The hand-calculated paper ledger fixtures are history's ground truth
    // (PRD §6.6, vat_mode = manual). Commission differential: TS mulBp on the
    // gross-minus-vat base against SQL mul_bp(sum桂枝 aggregation only in production flows).
    expect(fixtures.paperLedgerRows.length).toBeGreaterThan(0);
    for (const row of fixtures.paperLedgerRows) {
      const gross = BigInt(row.grossPoisha);
      const vat = BigInt(row.vatInputPoisha);
      const commissionBp = fixtures.paperLedgerProfile.commission.bp;
      const base = gross - vat; // base 'gross_minus_vat'

      const tsCommission = mulBp(base, commissionBp);
      const sqlRes = await pgClient.query('SELECT mul_bp($1::bigint, $2::int) AS comm', [
        base.toString(),
        commissionBp,
      ]);
      const sqlCommission = BigInt(sqlRes.rows[0].comm);
      expect(tsCommission).toBe(sqlCommission);

      // Full TS engine differential against the hand-calculated expectations;
      // each paper row carries its own method charge bp (115 bkash / 150 cards)
      // which overrides the profile-level chargeBp: 0 stub.
      const result = calculateEntry({
        grossPoisha: gross,
        snapshot: { ...fixtures.paperLedgerProfile, chargeBp: row.chargeBp },
        vatInputPoisha: vat,
      });
      expect(result.commissionPoisha.toString()).toBe(row.expectedCommissionPoisha);
      expect(result.chargePoisha.toString()).toBe(row.expectedChargePoisha);
      expect(result.netAfterDeductionsPoisha.toString()).toBe(row.expectedNetPoisha);
    }
  });

  it('validates percent-inclusive extraction differential (TS roundHalfUp vs SQL integer half-up)', async () => {
    // PRD §6.7 percent_inclusive: base = roundHalfUp(gross*10000, 10000 + vatBp),
    // vat = gross - base. The SQL leg recomputes the same integer half-up division
    // to prove engine↔postgres agreement without any float.
    const rows = fixtures.forwardLookingFixtures.percentInclusive;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const gross = BigInt(row.grossPoisha);
      const divisor = BigInt(10000 + row.vatBp);
      const tsBase = roundHalfUp(gross * 10000n, divisor);
      expect(tsBase.toString()).toBe(row.expectedBasePoisha);
      expect((gross - tsBase).toString()).toBe(row.expectedVatPoisha);

      const sqlRes = await pgClient.query(
        'SELECT ($1::bigint * 10000 + $2::bigint / 2) / $2::bigint AS base, $1::bigint - (($1::bigint * 10000 + $2::bigint / 2) / $2::bigint) AS vat',
        [gross.toString(), divisor.toString()],
      );
      expect(sqlRes.rows[0].base.toString()).toBe(row.expectedBasePoisha);
      expect(sqlRes.rows[0].vat.toString()).toBe(row.expectedVatPoisha);
    }
  });

  it('validates percent-of-gross VAT component differential against SQL mul_bp', async () => {
    const row = fixtures.forwardLookingFixtures.percentOfGross; // fixture P4
    const gross = BigInt(row.grossPoisha);

    // Differential: TS mulBp vs SQL mul_bp for the VAT component
    const tsVat = mulBp(gross, row.vatBp);
    const sqlRes = await pgClient.query('SELECT mul_bp($1::bigint, $2::int) AS vat', [
      gross.toString(),
      row.vatBp,
    ]);
    const sqlVat = BigInt(sqlRes.rows[0].vat);
    expect(tsVat).toBe(BigInt(row.expectedVatPoisha));
    expect(sqlVat).toBe(BigInt(row.expectedVatPoisha));

    // Full TS engine output against the fixture's exact hand values
    const result = calculateEntry({
      grossPoisha: gross,
      snapshot: {
        rateProfileId: fixtures.paperLedgerProfile.rateProfileId,
        version: fixtures.paperLedgerProfile.version,
        engineVersion: fixtures.paperLedgerProfile.engineVersion,
        vat: { mode: 'percent_of_gross', bp: row.vatBp },
        commission: { bp: row.commissionBp, base: 'gross_minus_vat' },
        chargeBp: row.chargeBp,
        chargesBorneBy: 'business',
        rounding: 'half_up',
      },
    });
    expect(result.vatPoisha.toString()).toBe(row.expectedVatPoisha);
    expect(result.commissionPoisha.toString()).toBe(row.expectedCommissionPoisha);
    expect(result.chargePoisha.toString()).toBe(row.expectedChargePoisha);
    expect(result.businessChargePoisha.toString()).toBe(row.expectedBusinessChargePoisha);
    expect(result.customerChargePoisha.toString()).toBe(row.expectedCustomerChargePoisha);
    expect(result.netAfterDeductionsPoisha.toString()).toBe(row.expectedNetPoisha);
  });

  it('validates customer-borne manual VAT and commission differential against SQL mul_bp', async () => {
    const row = fixtures.forwardLookingFixtures.customerBorneCharge; // fixture P5
    const gross = BigInt(row.grossPoisha);
    const vat = BigInt(row.vatInputPoisha);
    const base = gross - vat; // commission base 'gross_minus_vat'

    const tsCommission = mulBp(base, row.commissionBp);
    const sqlRes = await pgClient.query('SELECT mul_bp($1::bigint, $2::int) AS comm', [
      base.toString(),
      row.commissionBp,
    ]);
    const sqlCommission = BigInt(sqlRes.rows[0].comm);
    expect(tsCommission).toBe(BigInt(row.expectedCommissionPoisha));
    expect(sqlCommission).toBe(BigInt(row.expectedCommissionPoisha));

    // Customer-borne: business charge must be zero, customer charge = full charge
    const result = calculateEntry({
      grossPoisha: gross,
      snapshot: {
        rateProfileId: fixtures.paperLedgerProfile.rateProfileId,
        version: fixtures.paperLedgerProfile.version,
        engineVersion: fixtures.paperLedgerProfile.engineVersion,
        vat: { mode: 'manual', bp: 0 },
        commission: { bp: row.commissionBp, base: 'gross_minus_vat' },
        chargeBp: row.chargeBp,
        chargesBorneBy: 'customer',
        rounding: 'half_up',
      },
      vatInputPoisha: vat,
    });
    expect(result.vatPoisha.toString()).toBe(row.expectedVatPoisha);
    expect(result.commissionPoisha.toString()).toBe(row.expectedCommissionPoisha);
    expect(result.chargePoisha.toString()).toBe(row.expectedChargePoisha);
    expect(result.businessChargePoisha.toString()).toBe(row.expectedBusinessChargePoisha);
    expect(result.customerChargePoisha.toString()).toBe(row.expectedCustomerChargePoisha);
    expect(result.netAfterDeductionsPoisha.toString()).toBe(row.expectedNetPoisha);
  });

  it('validates explicit override fixtures against the TS engine (overrides replace computed components)', async () => {
    const row = fixtures.forwardLookingFixtures.explicitOverrides; // fixture P6
    const result = calculateEntry({
      grossPoisha: BigInt(row.grossPoisha),
      snapshot: {
        rateProfileId: fixtures.paperLedgerProfile.rateProfileId,
        version: fixtures.paperLedgerProfile.version,
        engineVersion: fixtures.paperLedgerProfile.engineVersion,
        vat: { mode: 'percent_inclusive', bp: row.vatBp },
        commission: { bp: row.commissionBp, base: 'gross' },
        chargeBp: row.chargeBp,
        chargesBorneBy: 'business',
        rounding: 'half_up',
      },
      vatOverridePoisha: BigInt(row.vatOverridePoisha),
      vatOverrideReason: row.vatOverrideReason,
      commissionOverridePoisha: BigInt(row.commissionOverridePoisha),
      commissionOverrideReason: row.commissionOverrideReason,
    });
    expect(result.vatPoisha.toString()).toBe(row.expectedVatPoisha);
    expect(result.commissionPoisha.toString()).toBe(row.expectedCommissionPoisha);
    expect(result.chargePoisha.toString()).toBe(row.expectedChargePoisha);
    expect(result.businessChargePoisha.toString()).toBe(row.expectedBusinessChargePoisha);
    expect(result.customerChargePoisha.toString()).toBe(row.expectedCustomerChargePoisha);
    expect(result.netAfterDeductionsPoisha.toString()).toBe(row.expectedNetPoisha);
  });

  it('confirms the guard rejection fixture throws DeductionsExceedGrossError in the TS engine', () => {
    const guard = fixtures.guardRejectionCases[0];
    expect(guard.expectedError).toBe('DeductionsExceedGrossError');
    const snapshot: RateSnapshot = {
      rateProfileId: fixtures.paperLedgerProfile.rateProfileId,
      version: fixtures.paperLedgerProfile.version,
      engineVersion: fixtures.paperLedgerProfile.engineVersion,
      vat: { mode: 'manual', bp: 0 },
      commission: { bp: guard.commissionBp, base: 'gross' },
      chargeBp: guard.chargeBp,
      chargesBorneBy: 'business',
      rounding: 'half_up',
    };

    expect(() =>
      calculateEntry({
        grossPoisha: BigInt(guard.grossPoisha),
        snapshot,
        vatInputPoisha: BigInt(guard.vatInputPoisha),
      }),
    ).toThrow(DeductionsExceedGrossError);
  });
});
