/**
 * Clock Skew Detection and Reconciliation Helper (PRD §9.2.2)
 * Compares client local system time against HTTP `Date` headers.
 * Reconciles timestamp drift to prevent server `clock_skew_exceeded` rejections.
 */

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Calculates clock delta between server Date header and local system time.
 * Optional roundTripTimeMs accounts for network latency (subtracts RTT/2).
 * Positive delta: client is behind server.
 * Negative delta: client is ahead of server.
 */
export function calculateClockSkewDelta(
  serverDateHeader: string,
  clientNowMs = Date.now(),
  roundTripTimeMs = 0
): number {
  const serverTimeMs = Date.parse(serverDateHeader);
  if (isNaN(serverTimeMs)) {
    return 0;
  }
  const adjustedServerTimeMs = serverTimeMs + Math.max(0, Math.floor(roundTripTimeMs / 2));
  return adjustedServerTimeMs - clientNowMs;
}

/**
 * Returns true if the clock skew between client and server exceeds the 5-minute threshold.
 */
export function isClockSkewExceeded(deltaMs: number): boolean {
  return Math.abs(deltaMs) > MAX_CLOCK_SKEW_MS;
}

/**
 * Reconciles an ISO 8601 timestamp by applying the calculated server clock skew delta.
 */
export function reconcileTimestamp(clientIsoDate: string, deltaMs: number): string {
  const clientTimeMs = Date.parse(clientIsoDate);
  if (isNaN(clientTimeMs)) {
    return clientIsoDate;
  }
  const reconciledMs = clientTimeMs + deltaMs;
  return new Date(reconciledMs).toISOString();
}
