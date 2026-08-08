import { describe, expect, it, vi } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import { createRaiderIoProvider, DisabledRaiderIoProvider } from "./index.js";
import { FixtureRaiderIoProvider } from "./fixture-provider.js";
import { InMemoryProviderCache } from "./cache.js";

const ctx = {
  region: "EU" as const,
  requestId: "req-1",
  correlationId: null,
  forceRefresh: false,
  now: "2026-07-27T10:00:00.000Z",
};

const deps = {
  env: {
    RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
    RAIDERIO_NEGATIVE_CACHE_SECONDS: 2700,
    RAIDERIO_CUTOFFS_TTL_SECONDS: 86_400,
    RAIDERIO_STATIC_DATA_TTL_SECONDS: 604_800,
  },
};

describe("FixtureRaiderIoProvider", () => {
  const provider = new FixtureRaiderIoProvider(deps);

  it("returns normalized character profile with attribution, gear and ranks", async () => {
    const result = await provider.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Fixturehero" },
      { ...ctx, forceRefresh: true },
    );
    expect(result.data.displayName).toBe("Fixturehero");
    expect(result.data.currentSeason?.scores.all).toBe(2845.5);
    expect(result.data.gear?.itemLevelEquipped).toBe(684);
    expect(result.data.ranks?.overall).toBe(89000);
    expect(result.data.attribution.displayText).toBe("Data from Raider.IO");
    expect(result.data.attribution.profileUrl).toContain("Fixturehero");
    expect(result.provenance.sourceUrl).toContain("raider.io");
    expect(result.metadata.cacheHit).toBe(false);
    expect(result.freshness.stale).toBe(false);
  });

  it("marks stale last_crawled_at profiles", async () => {
    const result = await provider.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Stalehero" },
      { ...ctx, forceRefresh: true },
    );
    expect(result.data.crawlStale).toBe(true);
    expect(result.freshness.stale).toBe(true);
    expect(result.data.lastCrawledAt).toBe("2017-01-19T00:00:00.000Z");
  });

  it("handles missing optional fields", async () => {
    const result = await provider.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Partialhero" },
      { ...ctx, forceRefresh: true },
    );
    expect(result.data.ranks).toBeNull();
    expect(result.data.gear).toBeNull();
    expect(result.data.recentRuns).toEqual([]);
    expect(result.data.attribution.homepageUrl).toBe("https://raider.io");
  });

  it("caches character profile on second request and exposes cache metadata", async () => {
    const cache = new InMemoryProviderCache();
    const local = new FixtureRaiderIoProvider({ ...deps, cache });
    const identity = { region: "EU" as const, realmSlug: "tarren-mill", name: "Cachedhero" };
    await local.getCharacterProfile(identity, ctx);
    const cached = await local.getCharacterProfile(identity, ctx);
    expect(cached.metadata.cacheHit).toBe(true);
    expect(cached.metadata.requestFingerprint).toBeTruthy();
    expect(local.metrics.cacheHits).toBeGreaterThan(0);
    const meta = local.describeCacheEntry(
      "characters.profile",
      "EU",
      { region: "eu", realm: "tarren-mill", name: "Cachedhero", fields: "gear" },
      43_200,
    );
    expect(meta.provider).toBe("raiderio");
    expect(meta.schemaVersion).toBe("0.62.5+cutoffs-v3");
  });

  it("returns season cutoffs with full percentile anchors and preserves top25Percent", async () => {
    const result = await provider.getSeasonCutoffs("EU", "season-mn-1", { ...ctx, forceRefresh: true });
    expect(result.data.top0_1Percent?.quantile).toBe("p999");
    expect(result.data.top0_1Percent?.label).toBe("top_0_1_percent");
    expect(result.data.top0_1Percent?.score).toBe(3483.25);
    expect(result.data.top1Percent?.score).toBe(3201.5);
    expect(result.data.top10Percent?.score).toBe(2850.75);
    expect(result.data.top25Percent?.score).toBe(2650.5);
    expect(result.data.top40Percent?.score).toBe(2410.125);
    expect(result.data.attribution.homepageUrl).toBe("https://raider.io");
    expect(provider.getCapabilities().seasonCutoffs).toBe("available");
  });

  it("marks seasonCutoffs available when only p990 is present", async () => {
    const local = new FixtureRaiderIoProvider(deps);
    const result = await local.getSeasonCutoffs("EU", "season-p990-only", {
      ...ctx,
      forceRefresh: true,
    });
    expect(result.data.top1Percent?.score).toBe(3201.5);
    expect(result.data.top25Percent).toBeNull();
    expect(local.getCapabilities().seasonCutoffs).toBe("available");
  });

  it("caches season-cutoffs: one cold request, zero additional on hit", async () => {
    const local = new FixtureRaiderIoProvider(deps);
    const fetchSpy = vi.spyOn(
      local as unknown as { fetchSeasonCutoffs: (...args: unknown[]) => unknown },
      "fetchSeasonCutoffs",
    );
    const cold = await local.getSeasonCutoffs("EU", "season-mn-1", { ...ctx, forceRefresh: true });
    const warm = await local.getSeasonCutoffs("EU", "season-mn-1", { ...ctx, forceRefresh: false });
    expect(cold.metadata.cacheHit).toBe(false);
    expect(warm.metadata.cacheHit).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warm.data.top25Percent?.score).toBe(cold.data.top25Percent?.score);
  });

  it("makes season-cutoffs optional and non-blocking on 5xx", async () => {
    const local = new FixtureRaiderIoProvider(deps);
    const result = await local.getSeasonCutoffs("EU", "unavailable", { ...ctx, forceRefresh: true });
    expect(result.data.top0_1Percent).toBeNull();
    expect(result.data.top1Percent).toBeNull();
    expect(result.data.top10Percent).toBeNull();
    expect(result.data.top25Percent).toBeNull();
    expect(result.data.top40Percent).toBeNull();
    expect(result.freshness.stale).toBe(true);
    expect(local.getCapabilities().seasonCutoffs).toBe("unavailable");
  });

  it("uses bumped schema version in fingerprints after cutoffs contract change", async () => {
    const local = new FixtureRaiderIoProvider(deps);
    const meta = local.describeCacheEntry(
      "mythic-plus.season-cutoffs",
      "EU",
      { region: "eu", season: "season-mn-1" },
      86_400,
    );
    expect(meta.schemaVersion).toBe("0.62.5+cutoffs-v3");
  });

  it("returns static data with resolved expansion and periods", async () => {
    const staticData = await provider.getStaticData({ ...ctx, forceRefresh: true });
    expect(staticData.data.seasons.length).toBeGreaterThan(0);
    expect(staticData.data.expansionId).toBe(11);
    const periods = await provider.getPeriods({ ...ctx, forceRefresh: true });
    expect(periods.data.length).toBeGreaterThan(0);
  });

  it("returns run details using request region, not hardcoded EU", async () => {
    const usCtx = { ...ctx, region: "US" as const, forceRefresh: true };
    const euCtx = { ...ctx, region: "EU" as const, forceRefresh: true };
    const usResult = await provider.getRunDetails("season-mn-1", "99001001", usCtx);
    const euResult = await provider.getRunDetails("season-mn-1", "99001001-eu", euCtx);
    expect(usResult.data.roster.length).toBeGreaterThanOrEqual(4);
    // Roster regions come from payload (EU in fixture), not a hardcoded provider default.
    expect(usResult.data.roster.every((m) => m.region === "EU")).toBe(true);
    expect(usResult.metadata.requestFingerprint).not.toBe(euResult.metadata.requestFingerprint);
    expect(usResult.data.attribution.displayText).toBe("Data from Raider.IO");
  });

  it("throws NOT_FOUND for missing character fixture", async () => {
    await expect(
      provider.getCharacterProfile(
        { region: "EU", realmSlug: "tarren-mill", name: "Missinghero" },
        { ...ctx, forceRefresh: true },
      ),
    ).rejects.toBeInstanceOf(ExternalApiError);
  });

  it("uses one profile call worth of data per refresh", async () => {
    const local = new FixtureRaiderIoProvider(deps);
    const before = local.metrics.requestsTotal;
    await local.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Onecall" },
      { ...ctx, forceRefresh: true },
    );
    expect(local.metrics.requestsTotal - before).toBe(1);
  });
});

describe("createRaiderIoProvider disabled", () => {
  it("returns disabled provider when RAIDERIO_ENABLED is false", () => {
    const provider = new DisabledRaiderIoProvider();
    expect(provider.enabled).toBe(false);
    expect(createRaiderIoProvider("fixture")).toBeDefined();
  });

  it("disabled provider rejects calls", async () => {
    const provider = new DisabledRaiderIoProvider();
    await expect(
      provider.getCharacterProfile(
        { region: "EU", realmSlug: "tarren-mill", name: "Test" },
        ctx,
      ),
    ).rejects.toThrow(/disabled/i);
  });
});
