import { describe, it, expect } from 'vitest';
import {
  poishaToString,
  stringToPoisha,
  poishaSchema,
  canonicalJson,
  canonicalJsonHash,
  centerDtoSchema,
  outboxOpSchema,
  entryDtoSchema,
  ENTRY_ID_REGEX,
  entryIdSchema,
  formatEntryId,
  parseEntryId,
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
    // formatSouthAsianNumber supports lakh/crore grouping directly
    expect(formatSouthAsianNumber(12345600n / 100n)).toBe('1,23,456');
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

  it('accepts a valid center DTO and rejects malformed codes, lengths, and UUIDs', () => {
    const valid = {
      id: '00000000-0000-0000-0000-000000000001',
      centerNumber: 1,
      code: 'MHK',
      name: 'Mohakhali Center',
      legalEntityName: 'Mohakhali Learning Center Ltd',
      binNumber: null,
      tradeLicenseNumber: null,
      vatCircle: null,
      address: 'Mohakhali, Dhaka',
      phone: '01700000000',
      status: 'active' as const,
      createdAt: '2026-11-08T00:00:00+06:00',
    };
    expect(centerDtoSchema.parse(valid).code).toBe('MHK');

    expect(() => centerDtoSchema.parse({ ...valid, code: 'mhk' })).toThrow();
    expect(() => centerDtoSchema.parse({ ...valid, code: 'A' })).toThrow();
    expect(() => centerDtoSchema.parse({ ...valid, code: 'TOOLONGCODE' })).toThrow();
    expect(() =>
      centerDtoSchema.parse({ ...valid, id: '00000000-0000-0000-0000-00000000000z' }),
    ).toThrow();
    expect(() => centerDtoSchema.parse({ ...valid, status: 'closed' })).toThrow();
  });

  it('requires a valid center_id UUID on outbox operations and entry DTOs', () => {
    const op = {
      opId: '99999999-9999-9999-9999-999999999991',
      centerId: '00000000-0000-0000-0000-000000000001',
      type: 'create_entry' as const,
      clientCreatedAt: '2026-11-08T00:00:00+06:00',
      payload: {},
      maxKnownRateVersion: 1,
    };
    expect(outboxOpSchema.parse(op).centerId).toBe(op.centerId);
    expect(() => outboxOpSchema.parse({ ...op, centerId: 'not-a-uuid' })).toThrow();
    expect(() => outboxOpSchema.parse({ ...op, centerId: undefined })).toThrow();

    const entry = {
      id: '66666666-6666-6666-6666-666666666661',
      centerId: '00000000-0000-0000-0000-000000000001',
      entryDate: '2026-11-08',
      customerName: 'Customer',
      subQty: 1,
      paymentMethodCode: 'bkash',
      grossPoisha: '100000',
      vatPoisha: '0',
      commissionPoisha: '42000',
      chargePoisha: '1150',
      businessChargePoisha: '1150',
      customerChargePoisha: '0',
      netPoisha: '56850',
      rateProfileId: '33333333-3333-3333-3333-333333333333',
      rateSnapshot: {},
    };
    expect(entryDtoSchema.parse(entry).centerId).toBe(entry.centerId);
    expect(() => entryDtoSchema.parse({ ...entry, centerId: 'not-a-uuid' })).toThrow();
    expect(() => entryDtoSchema.parse({ ...entry, centerId: undefined })).toThrow();
  });

  it('formats center-prefixed entry IDs with a zero-padded sequence', () => {
    expect(formatEntryId('MHK', '2026-11-08', 42)).toBe('E-MHK-202611-000042');
    expect(formatEntryId('RMP', new Date('2026-12-01T00:00:00Z'), 100000n)).toBe(
      'E-RMP-202612-100000',
    );
    expect(formatEntryId('mhk', '2026-11-08', 1)).toBe('E-MHK-202611-000001');
    expect(formatEntryId('MHK', '2026-11-08', 1234567n)).toBe('E-MHK-202611-1234567');

    expect(() => formatEntryId('mhk', '2026-11-08', 42)).not.toThrow();
    expect(() => formatEntryId('M', '2026-11-08', 42)).toThrow(TypeError);
    expect(() => formatEntryId('TOOLONGCODE', '2026-11-08', 42)).toThrow(TypeError);
    expect(() => formatEntryId('MHK', '11/08/2026', 42)).toThrow(TypeError);
    expect(() => formatEntryId('MHK', '2026-11-08', 0)).toThrow(RangeError);
    expect(() => formatEntryId('MHK', '2026-11-08', -1)).toThrow(RangeError);
  });

  it('parses center-prefixed entry IDs and rejects the legacy single-tenant format', () => {
    expect(parseEntryId('E-MHK-202611-000042')).toEqual({
      centerCode: 'MHK',
      yearMonth: '202611',
      seq: 42n,
    });
    expect(parseEntryId('E-202611-000042')).toBeNull();
    expect(parseEntryId('E-MHK-2026-000042')).toBeNull();
    expect(parseEntryId('E-mhk-202611-000042')).toBeNull();
    expect(parseEntryId('e-MHK-202611-000042')).toBeNull();
    expect(parseEntryId('E-MHK-202611-42')).toBeNull();
    expect(parseEntryId('')).toBeNull();

    expect(ENTRY_ID_REGEX.test('E-MHK-202611-000042')).toBe(true);
    expect(entryIdSchema.parse('E-MHK-202611-000042')).toBe('E-MHK-202611-000042');
    expect(() => entryIdSchema.parse('E-202611-000042')).toThrow();
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
