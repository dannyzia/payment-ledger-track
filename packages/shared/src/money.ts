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
