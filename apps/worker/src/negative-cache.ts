import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { CharacterIdentityInput } from "@mplus/contracts";

interface NegativeCacheEntry {
  expiresAt: number;
  reason: string;
}

/**
 * Simple in-memory TTL cache for identities confirmed NOT_FOUND upstream.
 * Prevents refresh-storms for identities that will never resolve.
 * Exported for reuse by the API app (search/profile endpoints).
 */
export class NegativeCache {
  private readonly entries = new Map<string, NegativeCacheEntry>();

  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}

  private key(identity: CharacterIdentityInput): string {
    return [
      normalizeRegion(identity.region),
      normalizeRealmSlug(identity.realmSlug),
      normalizeName(identity.name),
    ].join("|");
  }

  set(identity: CharacterIdentityInput, reason = "NOT_FOUND"): void {
    this.entries.set(this.key(identity), { expiresAt: Date.now() + this.ttlMs, reason });
  }

  has(identity: CharacterIdentityInput): boolean {
    const key = this.key(identity);
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  clear(identity: CharacterIdentityInput): void {
    this.entries.delete(this.key(identity));
  }

  size(): number {
    return this.entries.size;
  }
}

/** Process-wide default instance; safe to share across the worker process. */
export const negativeCache = new NegativeCache();
