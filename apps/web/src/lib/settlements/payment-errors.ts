/**
 * Settlement payment/RPC failures reach the browser as Postgres `raise exception`
 * texts, either `422 future_payment_date` or a bare machine code. They are contract
 * tokens, not copy, so the payment modal translates the ones it can trigger.
 *
 * Codes come from `record_settlement_payment` (supabase/migrations/
 * 20261029000006_functions_settlement_recon_month.sql) and the API route guards.
 */
const PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  future_payment_date: "The payment date can't be in the future. Pick today or an earlier date.",
  payment_predates_settlement_month:
    "The payment date can't be earlier than the month this settlement belongs to.",
  amount_must_be_positive: 'Enter an amount greater than zero.',
  settlement_not_found: 'This settlement no longer exists. Reload the page and try again.',
  reversal_id_required: 'The payment being reversed could not be found. Reload and try again.',
  payment_not_found: 'The payment being reversed no longer exists. Reload and try again.',
  cannot_reverse_reversal: 'A reversal cannot itself be reversed.',
  settlement_id_mismatch: 'That payment belongs to a different settlement.',
  reversals_exceed_original_amount:
    'The reversal is larger than what remains of the original payment.',
  month_closed: 'This month is closed. Payments and reversals are locked.',
  settlement_payments_immutable: "Settlement payments can't be edited. Record a reversal instead.",
  unauthorized: 'You need Admin or Owner access to record payments.',
};

const MACHINE_CODE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/i;

/** Strips the `422 ` style status prefix Postgres raise-exception texts carry. */
function toCode(raw: string): string {
  return raw.replace(/^\d{3}\s+/, '').trim();
}

/**
 * Turns an error payload from `/api/v1/settlements/payments` into something a person
 * can act on. Server sentences are kept as-is; known machine codes are translated.
 */
export function describePaymentError(payload: { error?: unknown; message?: unknown }): string {
  const error = typeof payload.error === 'string' ? payload.error : '';
  const message = typeof payload.message === 'string' ? payload.message : '';

  const mapped = PAYMENT_ERROR_MESSAGES[toCode(error)] ?? PAYMENT_ERROR_MESSAGES[toCode(message)];
  if (mapped) return mapped;

  // A server sentence (e.g. the closed-month message) reads better than anything here.
  if (error && !MACHINE_CODE.test(toCode(error))) return toCode(error);
  if (message && !MACHINE_CODE.test(toCode(message))) return toCode(message);

  const code = toCode(error) || toCode(message);
  return code
    ? `Could not record the payment. Please try again. (${code})`
    : 'Could not record the payment. Please try again.';
}
