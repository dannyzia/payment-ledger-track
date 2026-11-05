/**
 * Offline Retention Boundary Helper (PRD §9.1(g), §9.2.2, Test #25)
 * Operations older than 90 days are rejected by the server with `queue_expired_needs_review`
 * and must be reviewed by an authorized Admin before being accepted.
 */

export const MAX_RETENTION_DAYS = 90;
export const NINETY_DAYS_MS = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Returns true if an outbox operation's clientCreatedAt timestamp is older than 90 days.
 * Optional skewDeltaMs calibrates nowMs to true server time.
 */
export function isOpOlderThan90Days(
  clientCreatedAt: string,
  nowMs = Date.now(),
  skewDeltaMs = 0
): boolean {
  const createdAtMs = Date.parse(clientCreatedAt);
  if (isNaN(createdAtMs)) {
    return false;
  }
  const effectiveNow = nowMs + skewDeltaMs;
  return effectiveNow - createdAtMs > NINETY_DAYS_MS;
}
