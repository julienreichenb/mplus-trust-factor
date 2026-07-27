export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefillMs = Date.now();
  }

  private refill(nowMs: number): void {
    const elapsed = nowMs - this.lastRefillMs;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillMs = nowMs;
  }

  tryAcquire(nowMs = Date.now()): boolean {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  getAvailableTokens(nowMs = Date.now()): number {
    this.refill(nowMs);
    return this.tokens;
  }
}

export function createRpmLimiter(softRpm: number): TokenBucketRateLimiter {
  const tokensPerMinute = Math.max(1, softRpm);
  return new TokenBucketRateLimiter(tokensPerMinute, tokensPerMinute / 60_000);
}
