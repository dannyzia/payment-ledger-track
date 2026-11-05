import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { bkashCsvAdapter, parseCsvRows, parsePoisha, normalizeDate } from '$lib/server/reconcile/adapters/bkash-csv';
import { cardCombinedCsvAdapter } from '$lib/server/reconcile/adapters/card-combined-csv';
import { executeAutoMatch, type LedgerEntryCandidate } from '$lib/reconcile/matching';
import type { StatementLine } from '$lib/reconcile/types';

describe('Reconciliation Mode B Statement Adapters & Matching Engine', () => {
  it('parses bKash CSV statement with RFC 4180 quoted numbers and commas', async () => {
    const csvContent = [
      'TrxID,Date,Amount,Fee,Customer',
      'TRX987654,2026-03-05,"1,25,000.00",250.00,01700000000',
      'TRX987655,2026-03-06,500.50,10.00,01800000000',
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    expect(bkashCsvAdapter.accepts(buffer, 'text/csv')).toBe(true);
    expect(bkashCsvAdapter.accepts(buffer, 'application/vnd.ms-excel')).toBe(true);

    const parsed = await bkashCsvAdapter.parse(buffer);
    expect(parsed.adapterId).toBe('bkash-merchant-csv');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].reference).toBe('TRX987654');
    expect(parsed.lines[0].grossPoisha).toBe(12500000n); // 1,25,000.00 * 100
    expect(parsed.lines[0].feePoisha).toBe(25000n);      // 250.00 * 100
    expect(parsed.summary.totalGrossPoisha).toBe(12550050n);
  });

  it('rejects unsupported MIME types in header sniffing', () => {
    const buffer = Buffer.from('TrxID,Amount,Fee\nTRX1,100.00,5.00', 'utf-8');
    expect(bkashCsvAdapter.accepts(buffer, 'application/json')).toBe(false);
    expect(bkashCsvAdapter.accepts(buffer, 'image/png')).toBe(false);
  });

  it('parses negative amounts and accounting parentheses without floating point errors', () => {
    expect(parsePoisha('-150.75')).toBe(-15075n);
    expect(parsePoisha('(250.00)')).toBe(-25000n);
    expect(parsePoisha('"(1,250.50)"')).toBe(-125050n);
    expect(parsePoisha('+500.00')).toBe(50000n);
  });

  it('parses RFC 4180 quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCsvRows('Name,"Amount, Boss",Fee\n"He said ""ok""",100.00,5.00"\n');
    // Header row
    expect(rows[0][0]).toBe('Name');
    expect(rows[0][1]).toBe('Amount, Boss');
    // Data row: embedded double quotes unescaped to single quotes, field preserved
    expect(rows[1][0]).toBe('He said "ok"');
    expect(rows[1]).toHaveLength(3);
  });

  it('rejects malformed amounts as zero (integer-math only, no floats)', () => {
    expect(parsePoisha('abc')).toBe(0n);
    expect(parsePoisha('')).toBe(0n);
    expect(parsePoisha(null)).toBe(0n);
    expect(parsePoisha('12.345')).toBe(1234n); // truncated to 2 decimal places, never rounded via float
  });

  it('safely handles jagged CSV rows and empty trailing lines', async () => {
    const csvContent = [
      'TrxID,Date,Amount,Fee,Customer',
      'TRX101,2026-03-01,100.00',          // Jagged row: missing Fee and Customer
      'TRX102,2026-03-02,200.00,5.00,User',
      '',                                   // Empty trailing line
      '   ',                                // Whitespace line
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    const parsed = await bkashCsvAdapter.parse(buffer);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].reference).toBe('TRX101');
    expect(parsed.lines[0].feePoisha).toBe(0n); // Defaulted safely
  });

  it('parses Combined Card CSV statement with AuthCode and CardType headers', async () => {
    const csvContent = [
      'AuthCode,Date,CardType,Amount,MDR,Terminal',
      'AUTH1001,2026-03-10,VISA,3500.00,52.50,TERM01',
      'AUTH1002,2026-03-11,MASTERCARD,4200.00,63.00,TERM02',
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    expect(cardCombinedCsvAdapter.accepts(buffer, 'text/csv')).toBe(true);
    expect(cardCombinedCsvAdapter.accepts(buffer, '')).toBe(true);

    const parsed = await cardCombinedCsvAdapter.parse(buffer);
    expect(parsed.adapterId).toBe('card-combined-csv');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].reference).toBe('AUTH1001');
    expect(parsed.lines[0].grossPoisha).toBe(350000n);
    expect(parsed.lines[0].feePoisha).toBe(5250n);
    expect(parsed.summary.linesCount).toBe(2);
    expect(parsed.summary.totalFeePoisha).toBe(11550n); // 52.50 + 63.00
  });

  it('card adapter prefers the gross/txn amount column over net columns', async () => {
    const csvContent = [
      'AuthCode,Date,CardType,GrossAmount,NetAmount,MDR',
      'AUTH2001,2026-03-12,VISA,"1,000.00",965.00,35.00',
    ].join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    expect(cardCombinedCsvAdapter.accepts(buffer, 'text/csv')).toBe(true);
    const parsed = await cardCombinedCsvAdapter.parse(buffer);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].grossPoisha).toBe(100000n); // Gross, not net
    expect(parsed.lines[0].feePoisha).toBe(3500n);     // MDR fee, not (gross - net)
  });

  it('throws a descriptive error when amount column is missing', async () => {
    const buffer = Buffer.from('TrxID,Date,Customer\nTRX1,2026-03-01,01700000000\n', 'utf-8');
    await expect(bkashCsvAdapter.parse(buffer)).rejects.toThrow(
      'Unable to identify transaction amount column in bKash statement'
    );
  });

  it('rejects a header-only CSV with insufficient rows', async () => {
    const buffer = Buffer.from('TrxID,Amount,Fee\n', 'utf-8');
    await expect(bkashCsvAdapter.parse(buffer)).rejects.toThrow('CSV file contains insufficient rows');
  });

  it('computes 64-character SHA-256 hex digest for statement verification', () => {
    const content = Buffer.from('test statement payload');
    const hash = createHash('sha256').update(content).digest('hex');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('normalizes statement dates from YYYY-MM-DD and DD/MM/YYYY forms', () => {
    expect(normalizeDate('2026-03-05')).toBe('2026-03-05');
    expect(normalizeDate('2026-03-05T10:30:00')).toBe('2026-03-05');
    expect(normalizeDate('05/03/2026')).toBe('2026-03-05');
    expect(normalizeDate('5-3-2026')).toBe('2026-03-05');
    expect(normalizeDate('05-03-2026 14:02')).toBe('2026-03-05');
    expect(normalizeDate('')).toBeUndefined();
    expect(normalizeDate('not-a-date')).toBeUndefined();
  });

  it('Pass 1: matches unique reference on both sides', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'TXN100', grossPoisha: 10000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-1', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'TXN100', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].lineIndex).toBe(1);
    expect(result.matches[0].entryId).toBe('entry-1');
    expect(result.matches[0].pass).toBe(1);
  });

  it('Pass 1: reference collision on either side skips Pass 1 and prevents Pass 2 fallback', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'COLLIDE_REF', date: '2026-03-01', grossPoisha: 10000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-1', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'COLLIDE_REF', status: 'active' },
      { id: 'entry-2', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'COLLIDE_REF', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    // Collided on entry side: both entries have same txn_ref
    expect(result.matches).toHaveLength(0);
    expect(result.collidedReferences).toContain('COLLIDE_REF');
    expect(result.unmatchedLineIndices).toContain(1);
  });

  it('Pass 1: duplicate references among lines themselves collide and do not match', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'DUP', grossPoisha: 10000n, raw: {} },
      { lineIndex: 2, reference: 'DUP', grossPoisha: 20000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-1', entry_date: '2026-03-01', gross_poisha: 10000n, liability_poisha: 115n, txn_ref: 'DUP', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(0);
    expect(result.collidedReferences).toContain('DUP');
    expect(result.unmatchedLineIndices).toContain(1);
    expect(result.unmatchedLineIndices).toContain(2);
  });

  it('Pass 2: matches unreferenced lines via unique date + gross fallback', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: undefined, date: '2026-03-05', grossPoisha: 250000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-unref', entry_date: '2026-03-05', gross_poisha: 250000n, liability_poisha: 2875n, txn_ref: null, status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].lineIndex).toBe(1);
    expect(result.matches[0].entryId).toBe('entry-unref');
    expect(result.matches[0].pass).toBe(2);
  });

  it('Pass 2: ambiguous date + gross duplicates do not match (two-sided uniqueness)', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, date: '2026-03-05', grossPoisha: 30000n, raw: {} },
      { lineIndex: 2, date: '2026-03-05', grossPoisha: 30000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'e1', entry_date: '2026-03-05', gross_poisha: 30000n, liability_poisha: 345n, txn_ref: null, status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(0); // lineDateGross count is 2
    expect(result.unmatchedLineIndices).toEqual([1, 2]);
  });

  it('excludes candidate entries with zero liability from matching', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'TXN_ZERO', grossPoisha: 50000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-zero', entry_date: '2026-03-05', gross_poisha: 50000n, liability_poisha: 0n, txn_ref: 'TXN_ZERO', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    // Zero liability entries carry 0 merchant settlement liability and are exempt from matching
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedLineIndices).toContain(1);
    expect(result.unmatchedEntryIds).toEqual([]); // zero-liability entries are not counted as coverable
  });

  it('excludes voided and superseded entries from matching', () => {
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'TXN_VOID', grossPoisha: 12000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'entry-voided', entry_date: '2026-03-05', gross_poisha: 12000n, liability_poisha: 138n, txn_ref: 'TXN_VOID', status: 'voided' },
      { id: 'entry-superseded', entry_date: '2026-03-05', gross_poisha: 12000n, liability_poisha: 138n, txn_ref: 'TXN_VOID', status: 'superseded' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedLineIndices).toContain(1);
  });

  it('does not reuse a matched entry in the later pass (two-sided 1-to-1 guarantee)', () => {
    // e1 matches line 1 via Pass 1 reference equality; line 2 is unreferenced with
    // the same date+gross key as e1, but e1 is already consumed in Pass 1, so the
    // same entry must never be reused by Pass 2.
    const lines: StatementLine[] = [
      { lineIndex: 1, reference: 'TXN_ONLY', grossPoisha: 40000n, raw: {} },
      { lineIndex: 2, date: '2026-03-05', grossPoisha: 40000n, raw: {} },
    ];
    const entries: LedgerEntryCandidate[] = [
      { id: 'e1', entry_date: '2026-03-05', gross_poisha: 40000n, liability_poisha: 460n, txn_ref: 'TXN_ONLY', status: 'active' },
    ];

    const result = executeAutoMatch(lines, entries);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].pass).toBe(1);
    expect(result.matches[0].entryId).toBe('e1');
    expect(result.unmatchedLineIndices).toContain(2);
    expect(result.unmatchedEntryIds).toHaveLength(0); // e1 is consumed exactly once
  });
});
