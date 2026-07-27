export interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
  isNegative?: boolean;
}

export class InMemoryProviderCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  get<T>(fingerprint: string, nowMs = Date.now()): { hit: true; value: T; negative: boolean } | { hit: false } {
    const entry = this.entries.get(fingerprint) as CacheEntry<T> | undefined;
    if (!entry) return { hit: false };
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(fingerprint);
      return { hit: false };
    }
    return { hit: true, value: entry.value, negative: entry.isNegative ?? false };
  }

  set<T>(fingerprint: string, value: T, ttlSeconds: number, nowMs = Date.now(), isNegative = false): void {
    this.entries.set(fingerprint, {
      value,
      expiresAtMs: nowMs + ttlSeconds * 1000,
      isNegative,
    });
  }

  async dedupe<T>(fingerprint: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(fingerprint) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = factory().finally(() => {
      this.inFlight.delete(fingerprint);
    });
    this.inFlight.set(fingerprint, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}
