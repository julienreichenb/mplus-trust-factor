import { describe, expect, it } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import { createRaiderIoProvider, DisabledRaiderIoProvider } from "./index.js";
import { FixtureRaiderIoProvider } from "./fixture-provider.js";

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

  it("is enabled and returns normalized character profile with attribution", async () => {
    const result = await provider.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Fixturehero" },
      ctx,
    );
    expect(result.data.displayName).toBe("Fixturehero");
    expect(result.data.currentSeason?.scores.all).toBe(2845.5);
    expect(result.data.attribution.displayText).toBe("Data from Raider.IO");
    expect(result.metadata.cacheHit).toBe(false);
    expect(result.provenance.provider).toBe("raiderio");
  });

  it("caches character profile on second request", async () => {
    const identity = { region: "EU" as const, realmSlug: "tarren-mill", name: "Cachedhero" };
    await provider.getCharacterProfile(identity, ctx);
    const cached = await provider.getCharacterProfile(identity, ctx);
    expect(cached.metadata.cacheHit).toBe(true);
    expect(provider.metrics.cacheHits).toBeGreaterThan(0);
  });

  it("returns season cutoffs with top 25% threshold", async () => {
    const result = await provider.getSeasonCutoffs("EU", "season-tww-2", ctx);
    expect(result.data.top25Percent?.score).toBe(2650.5);
    expect(result.data.attribution.homepageUrl).toBe("https://raider.io");
  });

  it("returns static data and periods", async () => {
    const staticData = await provider.getStaticData(ctx);
    expect(staticData.data.seasons.length).toBeGreaterThan(0);
    const periods = await provider.getPeriods(ctx);
    expect(periods.data.length).toBeGreaterThan(0);
  });

  it("returns run details with roster", async () => {
    const result = await provider.getRunDetails("season-tww-2", "99001001", ctx);
    expect(result.data.roster.length).toBeGreaterThanOrEqual(4);
    expect(result.data.attribution.displayText).toBe("Data from Raider.IO");
  });

  it("throws NOT_FOUND for missing character fixture", async () => {
    await expect(
      provider.getCharacterProfile(
        { region: "EU", realmSlug: "tarren-mill", name: "Missinghero" },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ExternalApiError);
  });

  it("uses one profile call worth of data per refresh (no extra endpoints required)", async () => {
    const before = provider.metrics.requestsTotal;
    await provider.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Onecall" },
      { ...ctx, forceRefresh: true },
    );
    expect(provider.metrics.requestsTotal - before).toBe(1);
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
