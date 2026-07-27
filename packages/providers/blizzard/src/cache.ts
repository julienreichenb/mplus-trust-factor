export interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
  etag: string | null;
  lastModified: string | null;
}

export class TtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get<T>(key: string): CacheEntry<T> | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry as CacheEntry<T>;
  }

  set<T>(key: string, value: T, ttlSeconds: number, meta?: { etag?: string | null; lastModified?: string | null }): void {
    this.store.set(key, {
      value,
      expiresAtMs: this.now() + Math.max(1, ttlSeconds) * 1000,
      etag: meta?.etag ?? null,
      lastModified: meta?.lastModified ?? null,
    });
  }

  async dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = factory().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }
}

/** Simple semaphore for request concurrency. */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
