/**
 * Shared cache contract for Agent 15 persistent ExternalRequest wiring.
 * In-memory implementation is the default; workers may inject a durable store.
 */
export interface RaiderIoCacheStore {
  get<T>(
    fingerprint: string,
    nowMs?: number,
  ): { hit: true; value: T; negative: boolean; expiresAtMs: number } | { hit: false };
  set<T>(
    fingerprint: string,
    value: T,
    ttlSeconds: number,
    nowMs?: number,
    isNegative?: boolean,
  ): void;
  dedupe<T>(fingerprint: string, factory: () => Promise<T>): Promise<T>;
  clear(): void;
}

export interface RaiderIoCacheEntryMetadata {
  provider: "raiderio";
  endpointKey: string;
  requestFingerprint: string;
  ttlSeconds: number;
  schemaVersion: string;
  queryParams: Record<string, string>;
  negativeCacheTtlSeconds: number;
}

export interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
  isNegative?: boolean;
}

export class InMemoryProviderCache implements RaiderIoCacheStore {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  get<T>(
    fingerprint: string,
    nowMs = Date.now(),
  ): { hit: true; value: T; negative: boolean; expiresAtMs: number } | { hit: false } {
    const entry = this.entries.get(fingerprint) as CacheEntry<T> | undefined;
    if (!entry) return { hit: false };
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(fingerprint);
      return { hit: false };
    }
    return {
      hit: true,
      value: entry.value,
      negative: entry.isNegative ?? false,
      expiresAtMs: entry.expiresAtMs,
    };
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
