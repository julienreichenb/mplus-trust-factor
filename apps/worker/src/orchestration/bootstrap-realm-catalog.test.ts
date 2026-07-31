import { describe, expect, it, vi } from "vitest";
import { ensureRealmCatalogReady } from "./bootstrap-realm-catalog.js";

describe("ensureRealmCatalogReady", () => {
  it("fail-closes when catalogs stay empty after a failed sync", async () => {
    const realms = {
      getRegionCatalogStats: vi.fn(async (region: string) => ({
        regionCode: region,
        activeCount: 0,
        lastSyncedAt: null,
      })),
      countActiveByRegion: vi.fn(async () => 0),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
    };
    const blizzard = {
      getRealmIndex: vi.fn(async () => {
        throw new Error("blizzard unavailable");
      }),
      getRealm: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await ensureRealmCatalogReady({
      blizzard: blizzard as never,
      realms: realms as never,
      logger: logger as never,
      staleAfterSeconds: 604_800,
    });

    expect(result.ready).toBe(false);
    expect(result.failClosed).toBe(true);
    expect(result.synced).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("remains ready with last-known-good when refresh fails on a populated catalog", async () => {
    const staleAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    let calls = 0;
    const realms = {
      getRegionCatalogStats: vi.fn(async (region: string) => {
        calls += 1;
        // First pass: stale but non-empty. After failed sync: still non-empty.
        return {
          regionCode: region,
          activeCount: 40,
          lastSyncedAt: staleAt,
        };
      }),
      countActiveByRegion: vi.fn(async () => 40),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
    };
    const blizzard = {
      getRealmIndex: vi.fn(async () => {
        throw new Error("blizzard unavailable");
      }),
      getRealm: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await ensureRealmCatalogReady({
      blizzard: blizzard as never,
      realms: realms as never,
      logger: logger as never,
      staleAfterSeconds: 604_800,
    });

    expect(result.ready).toBe(true);
    expect(result.failClosed).toBe(false);
    expect(result.synced).toBe(true);
    expect(calls).toBeGreaterThan(4);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips sync when all regions are fresh", async () => {
    const realms = {
      getRegionCatalogStats: vi.fn(async (region: string) => ({
        regionCode: region,
        activeCount: 10,
        lastSyncedAt: new Date(),
      })),
    };
    const blizzard = {
      getRealmIndex: vi.fn(),
      getRealm: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await ensureRealmCatalogReady({
      blizzard: blizzard as never,
      realms: realms as never,
      logger: logger as never,
      staleAfterSeconds: 604_800,
    });

    expect(result.ready).toBe(true);
    expect(result.synced).toBe(false);
    expect(blizzard.getRealmIndex).not.toHaveBeenCalled();
  });
});
