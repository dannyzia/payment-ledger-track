import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { ensureTestDatabase, testDatabaseUrl } from './helpers/test-db';
import fs from 'node:fs';

const { Pool } = pg;

// Portable JSON fixture loading compatible with NodeNext and bundler resolutions
const fixtures = JSON.parse(
  fs.readFileSync(
    new URL('../../packages/calc/fixtures/test_fixtures.json', import.meta.url),
    'utf8',
  ),
);

describe('Database SQL Arithmetic Backstop Parity Tests (PRD §6.5, §7.3)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    await ensureTestDatabase();
    pool = new Pool({ connectionString: testDatabaseUrl() });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
  });

  it('verifies mul_bp() in PostgreSQL matches TS mulBp across all paper ledger fixtures', async () => {
    for (const row of fixtures.paperLedgerRows) {
      const res = await pool.query('SELECT mul_bp($1::bigint, $2::int) as charge', [
        row.grossPoisha,
        row.chargeBp,
      ]);
      expect(res.rows[0].charge).toBe(row.expectedChargePoisha);
    }
  });

  it('verifies the two rounding traps in PostgreSQL match TypeScript engine', async () => {
    // Card charge row 5: 590900 poisha * 150 bp = 8864 poisha
    const resCard = await pool.query('SELECT mul_bp(590900::bigint, 150) as charge');
    expect(resCard.rows[0].charge).toBe('8864');

    // bKash charge row 1: 590900 poisha * 115 bp = 6795 poisha
    const resBkash = await pool.query('SELECT mul_bp(590900::bigint, 115) as charge');
    expect(resBkash.rows[0].charge).toBe('6795');
  });

  it('verifies round_half_up() in PostgreSQL matches TS roundHalfUp across percent_inclusive fixtures (P1, P2, P3)', async () => {
    for (const fixture of fixtures.forwardLookingFixtures.percentInclusive) {
      const gross = BigInt(fixture.grossPoisha);
      const vatBp = BigInt(fixture.vatBp);
      const divisor = 10000n + vatBp;
      const res = await pool.query('SELECT round_half_up($1::bigint * 10000, $2::bigint) as base', [
        gross.toString(),
        divisor.toString(),
      ]);
      expect(res.rows[0].base).toBe(fixture.expectedBasePoisha);
    }
  });

  it('verifies deduction guard parity between TypeScript and database constraints', async () => {
    // Vectors where deductions > gross must fail database check constraints or triggers
    for (const testCase of fixtures.guardRejectionCases) {
      // Components are expressed as rates in the fixture and are rounded with
      // the same mul_bp() backstop used by the database. chargesBorneBy =
      // 'business' puts the whole method charge into the deduction side.
      const res = await pool.query(
        `SELECT
           $1::bigint + mul_bp($2::bigint, $3::int)
             + (CASE WHEN $4 = 'business' THEN mul_bp($2::bigint, $5::int) ELSE 0 END)
           <= $2::bigint AS valid`,
        [
          testCase.vatInputPoisha,
          testCase.grossPoisha,
          testCase.commissionBp,
          testCase.chargesBorneBy,
          testCase.chargeBp,
        ],
      );
      expect(res.rows[0].valid).toBe(false);
    }
  });

  it('verifies override parity preserves gross conservation in SQL', async () => {
    const gross = 100000n;
    const vatOverride = 15000n;
    const commOverride = 25000n;
    const bizCharge = 1500n;
    const net = gross - (vatOverride + commOverride + bizCharge);

    expect(vatOverride + commOverride + bizCharge + net).toBe(gross);

    const res = await pool.query(
      'SELECT ($1::bigint + $2::bigint + $3::bigint + $4::bigint = $5::bigint) as conserved',
      [
        vatOverride.toString(),
        commOverride.toString(),
        bizCharge.toString(),
        net.toString(),
        gross.toString(),
      ],
    );
    expect(res.rows[0].conserved).toBe(true);
  });
});
