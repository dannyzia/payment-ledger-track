/**
 * Admin screens read server-only data through `authFetch`, so with the network cut
 * the underlying fetch rejects with `TypeError: Failed to fetch`. That text means
 * nothing to staff and reads like a bug, so admin callers map it to the state the
 * user is actually in. The ledger itself is offline-first; admin configuration is
 * not, and nothing is written locally when one of those calls fails.
 */
export const ADMIN_OFFLINE_MESSAGE =
  'This admin area needs a connection: its data lives on the server, so nothing was loaded or changed. ' +
  'Ledger entries keep queuing offline and sync when you are back online.';

/** Error text for an admin request, naming the offline case instead of a raw fetch failure. */
export function adminFetchError(e: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return ADMIN_OFFLINE_MESSAGE;
  }
  return e instanceof Error ? e.message : String(e);
}
