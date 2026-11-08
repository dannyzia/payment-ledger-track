/**
 * PWA Storage Persistence & Quota Manager (PRD §12)
 * Requests persistent storage to prevent browser eviction of IndexedDB records.
 */

export interface StorageStatus {
  persisted: boolean;
  quotaBytes?: number;
  usageBytes?: number;
  percentUsed?: number;
}

/**
 * Requests persistent storage permissions from the browser.
 * Returns true if persistent storage is already active or was granted.
 * Safely handles environments where StorageManager throws (e.g. private browsing).
 */
export async function initStoragePersistence(): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.persist === 'function'
  ) {
    try {
      if (typeof navigator.storage.persisted === 'function') {
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) {
          return true;
        }
      }
      const granted = await navigator.storage.persist();
      return granted;
    } catch (err) {
      console.warn('Storage persistence request failed:', err);
      return false;
    }
  }
  return false;
}

/**
 * Queries estimated storage quota and usage from the browser.
 * Safely handles environments where StorageManager estimate throws.
 */
export async function getStorageQuota(): Promise<StorageStatus> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.estimate === 'function'
  ) {
    try {
      const persisted =
        typeof navigator.storage.persisted === 'function'
          ? await navigator.storage.persisted().catch(() => false)
          : false;

      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota ?? 0;
      const usage = estimate.usage ?? 0;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;

      return {
        persisted,
        quotaBytes: quota,
        usageBytes: usage,
        percentUsed: Math.round(percent * 10) / 10,
      };
    } catch (err) {
      console.warn('Storage quota estimation failed:', err);
      return { persisted: false };
    }
  }

  return { persisted: false };
}
