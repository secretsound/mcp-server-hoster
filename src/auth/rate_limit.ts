/** Simple sliding-window rate limiter (in-process). */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
}): (key: string) => { ok: boolean; retryAfterSec: number } {
  const hits = new Map<string, number[]>();

  return (key: string) => {
    const now = Date.now();
    const windowStart = now - opts.windowMs;
    const arr = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (arr.length >= opts.max) {
      hits.set(key, arr);
      const oldest = arr[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + opts.windowMs - now) / 1000),
      );
      return { ok: false, retryAfterSec };
    }
    arr.push(now);
    hits.set(key, arr);
    return { ok: true, retryAfterSec: 0 };
  };
}
