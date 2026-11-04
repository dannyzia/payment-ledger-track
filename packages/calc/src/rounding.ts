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
