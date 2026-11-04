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
  .regex(/^(0|[1-9]\d*)$/, {
    message: 'Must be a non-negative integer string without leading zeros',
  })
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
  .regex(/^-?(0|[1-9]\d*)$/, {
    message: 'Must be a valid signed integer string without leading zeros',
  })
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
  type: z.enum([
    'create_entry',
    'request_void',
    'void_entry',
    'supersede_entry',
    'discard_rejected_entry',
  ]),
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
  vatInputPoisha: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable()
    .optional(),
  vatOverridePoisha: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable()
    .optional(),
  vatOverrideReason: z.string().nullable().optional(),
  commissionOverridePoisha: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .nullable()
    .optional(),
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
    return (
      '[' + obj.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',') + ']'
    );
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
