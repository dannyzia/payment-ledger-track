const DEVICE_ID_KEY = 'clt_device_id';
const V4_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

let inMemoryDeviceId: string | null = null;

/**
 * Validates that an identifier strictly conforms to RFC 4122 v4 lowercase UUID
 * and rejects the nil UUID (PRD §9.1, Finding H5).
 */
export function isValidDeviceId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const lower = id.trim().toLowerCase();
  if (lower === NIL_UUID) return false;
  return V4_UUID_REGEX.test(lower);
}

/**
 * Retrieves the persisted device ID from local storage or generates a fresh v4 UUID.
 * In private browsing modes where storage access throws, an in-memory random UUID is returned.
 */
export function getOrGenerateDeviceId(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = window.localStorage.getItem(DEVICE_ID_KEY);
      if (existing && isValidDeviceId(existing)) {
        return existing.toLowerCase();
      }
      const fresh = crypto.randomUUID().toLowerCase();
      window.localStorage.setItem(DEVICE_ID_KEY, fresh);
      return fresh;
    }
  } catch {
    // Storage restricted fallback
  }

  if (!inMemoryDeviceId) {
    inMemoryDeviceId = crypto.randomUUID().toLowerCase();
  }
  return inMemoryDeviceId;
}
