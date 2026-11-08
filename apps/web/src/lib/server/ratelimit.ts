interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic memory TTL cleanup interval every 5 minutes
if (typeof setInterval !== 'undefined') {
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 60000;
    for (const [key, entry] of rateLimitStore.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
      if (entry.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, 300000);
  (cleanupTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Sliding-window request rate limiter.
 * Enforces PRD §9.1 limit: Maximum 60 requests per minute per device/IP.
 * Returns { allowed: boolean, retryAfter: number }.
 */
export function checkRateLimit(
  key: string,
  limit = 60,
  windowMs = 60000,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Filter timestamps within the sliding window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= limit) {
    const oldestTimestamp = entry.timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));
    return { allowed: false, retryAfter };
  }

  entry.timestamps.push(now);
  return { allowed: true, retryAfter: 0 };
}
