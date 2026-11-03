export interface RateLimiter {
  /** true = permintaan boleh dilanjutkan. */
  consume(key: string, limit: number, windowMs: number, now?: number): boolean;
  reset(): void;
}

/**
 * Fixed-window in-memory limiter. Cukup untuk satu instance; restart mereset
 * hitungan. Ini bukan rate limit terdistribusi dan tidak diklaim demikian.
 */
export function createRateLimiter(): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key, limit, windowMs, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
    reset() {
      buckets.clear();
    },
  };
}
