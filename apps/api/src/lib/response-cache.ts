import type { CharacterIdentityInput } from "@mplus/contracts";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Minimal in-memory TTL cache for stable response DTOs (character profile, score-model list, etc.).
 * Not shared across processes — acceptable for the MVP single-instance API; swap for Redis-backed
 * storage later without changing call sites (same get/set/invalidate surface).
 */
export class ResponseCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly defaultTtlMs = 15_000) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = this.defaultTtlMs): void {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Stable cache key for a character identity, independent of input casing/whitespace. */
export function characterCacheKey(identity: CharacterIdentityInput): string {
  return [
    "character",
    normalizeRegion(identity.region),
    normalizeRealmSlug(identity.realmSlug),
    normalizeName(identity.name),
  ].join(":");
}
