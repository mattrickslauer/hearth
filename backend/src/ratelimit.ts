/**
 * In-memory sliding-window rate limiter — shared by auth.ts (OTP) and hubs.ts (enroll/claim).
 *
 * Per-instance (consistent with the memory OTP/account/hub stores) — good enough to blunt
 * email-bombing, OTP brute force and enroll/claim spam; swap for a shared store
 * (Tablestore/Redis) alongside those when they're wired.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    // Bound memory by evicting only fully-expired keys — never wipe live counters.
    // A wholesale clear() could be forced (spoof 50k distinct keys) to reset everyone's
    // limit at once, briefly nullifying the OTP/enroll/claim throttles.
    if (this.hits.size > 50_000) this.sweep(cutoff);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  /** Delete only keys whose most recent hit is already outside the window. */
  private sweep(cutoff: number): void {
    for (const [k, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) this.hits.delete(k);
    }
  }
}
