/**
 * Plan 023 §6.3 — the one place the center app learns why an account is withheld.
 *
 * The server answers `403 center_suspended` or `403 center_archived` (see
 * `$lib/server/auth`); screens resolve the key below through the message catalog and
 * never hardcode a sentence. The platform seat is not withheld: it keeps reading and
 * acting on a suspended center.
 */
export type WithheldReason = 'center_suspended' | 'center_archived';

const MESSAGE_KEYS: Record<WithheldReason, string> = {
  center_suspended: 'auth.center_suspended',
  center_archived: 'auth.center_archived',
};

/** English copy used until the key below is resolved through the catalog. */
const NOTICE_TEXT: Record<WithheldReason, string> = {
  center_suspended:
    'This account is withheld. Your center is suspended and cannot record payments. Contact your head office.',
  center_archived:
    'This account is closed. Your center is archived. Contact your head office if you believe this is wrong.',
};

export function isWithheldReason(value: unknown): value is WithheldReason {
  return value === 'center_suspended' || value === 'center_archived';
}

export function withheldMessageKey(reason: WithheldReason): string {
  return MESSAGE_KEYS[reason];
}

export function withheldNoticeText(reason: WithheldReason): string {
  return NOTICE_TEXT[reason];
}
