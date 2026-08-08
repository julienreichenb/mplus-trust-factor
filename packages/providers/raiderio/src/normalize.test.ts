import { describe, expect, it } from "vitest";
import {
  extractBoostSupportFacts,
  isCrawlStale,
  mapGear,
  mapRanks,
  normalizeCharacterProfile,
  normalizePeriods,
  normalizeSeasonCutoffs,
  seasonCutoffsHaveAnyThreshold,
  unavailableSeasonCutoffs,
} from "./normalize.js";
import { parseWithSchema, seasonCutoffsSchema } from "./schemas.js";
import type { RawCharacterProfileResponse, RawSeasonCutoffsResponse } from "./raw-types.js";

const sampleProfile: RawCharacterProfileResponse = {
  name: "Fixturehero",
  class: "Mage",
  active_spec_name: "Arcane",
  active_spec_role: "DPS",
  region: "eu",
  realm: "tarren-mill",
  profile_url: "https://raider.io/characters/eu/tarren-mill/Fixturehero",
  last_crawled_at: "2026-07-26T12:00:00.000Z",
  gear: {
    item_level_equipped: 684,
    items: {
      head: { item_id: 1, item_level: 684, name: "Helm", icon: "icon", item_quality: 4 },
    },
  },
  talents: { loadout: [] },
  mythic_plus_scores_by_season: [{ season: "season-mn-1", scores: { all: 2845.5 } }],
  mythic_plus_ranks: {
    overall: { world: 89000, region: 12000, realm: 450 },
    class: { world: 2100, region: 800, realm: 40 },
    dps: { world: 50000, region: 8000, realm: 300 },
  },
  mythic_plus_recent_runs: [
    {
      keystone_run_id: 1,
      dungeon: "Ara-Kara",
      short_name: "ARAK",
      mythic_level: 12,
      completed_at: "2026-07-19T18:30:00.000Z",
      clear_time_ms: 1680000,
      par_time_ms: 1800000,
      num_keystone_upgrades: 1,
      score: 385.5,
      roster: [
        {
          character: {
            name: "Fixturehero",
            class: "Mage",
            realm: "tarren-mill",
            region: "eu",
          },
          role: "dps",
        },
        {
          character: {
            name: "Helper",
            class: "Paladin",
            realm: "tarren-mill",
            region: "eu",
          },
          role: "tank",
          ranks: { overall: 3100 },
        },
      ],
    },
  ],
};

describe("normalizeCharacterProfile", () => {
  it("maps scores, nested ranks, gear, attribution and freshness", () => {
    const profile = normalizeCharacterProfile(sampleProfile, "EU", Date.parse("2026-07-27T10:00:00.000Z"));
    expect(profile.currentSeason?.scores.all).toBe(2845.5);
    expect(profile.previousSeason).toBeNull();
    expect(profile.ranks?.overall).toBe(89000);
    expect(profile.ranks?.region).toBe(12000);
    expect(profile.ranks?.server).toBe(450);
    expect(profile.ranks?.role).toBe("dps");
    expect(profile.ranks?.classRank).toEqual({
      world: 2100,
      region: 800,
      realm: 40,
    });
    expect(profile.previousRanks).toBeNull();
    expect(profile.gear?.itemLevelEquipped).toBe(684);
    expect(profile.gear?.items[0]?.slot).toBe("head");
    expect(profile.talents?.present).toBe(true);
    expect(profile.crawlStale).toBe(false);
    expect(profile.recentRuns[0]?.keyLevel).toBe(12);
    expect(profile.attribution.displayText).toBe("Data from Raider.IO");
    expect(profile.attribution.profileUrl).toContain("Fixturehero");
    expect(profile.runHistoryIncomplete).toBe(true);
  });

  it("marks stale last_crawled_at", () => {
    const profile = normalizeCharacterProfile(
      { ...sampleProfile, last_crawled_at: "2017-01-19T00:00:00.000Z" },
      "EU",
      Date.parse("2026-07-27T10:00:00.000Z"),
    );
    expect(profile.crawlStale).toBe(true);
    expect(isCrawlStale("2017-01-19T00:00:00.000Z", Date.parse("2026-07-27T10:00:00.000Z"))).toBe(true);
  });

  it("tolerates missing optional fields", () => {
    const profile = normalizeCharacterProfile(
      {
        name: "Partialhero",
        region: "eu",
        realm: "tarren-mill",
        profile_url: "https://raider.io/characters/eu/tarren-mill/Partialhero",
      },
      "EU",
      Date.parse("2026-07-27T10:00:00.000Z"),
    );
    expect(profile.currentSeason).toBeNull();
    expect(profile.ranks).toBeNull();
    expect(profile.gear).toBeNull();
    expect(profile.talents?.shape).toBe("absent");
    expect(profile.recentRuns).toEqual([]);
    expect(profile.bestRuns).toEqual([]);
    expect(profile.crawlStale).toBe(true);
    expect(profile.attribution.homepageUrl).toBe("https://raider.io");
  });
});

describe("mapRanks and mapGear", () => {
  it("supports legacy flat ranks", () => {
    const ranks = mapRanks({ overall: 10, class: 2, server: 1, world: 10, region: 4, role: "tank" });
    expect(ranks.overall).toBe(10);
    expect(ranks.role).toBe("tank");
    expect(ranks.classRank).toEqual({ world: 2, region: null, realm: null });
  });

  it("preserves class.region distinctly from overall region", () => {
    const ranks = mapRanks({
      overall: { world: 18745, region: 5607, realm: 95 },
      class: { world: 1456, region: 503, realm: 12 },
    });
    expect(ranks.region).toBe(5607);
    expect(ranks.class).toBe(1456);
    expect(ranks.classRank).toEqual({ world: 1456, region: 503, realm: 12 });
  });

  it("maps empty gear arrays", () => {
    expect(mapGear({ item_level_equipped: 0, items: [] })?.items).toEqual([]);
  });
});

describe("normalizeCharacterProfile previous ranks", () => {
  it("normalizes previous_mythic_plus_ranks.class.region", () => {
    const profile = normalizeCharacterProfile(
      {
        ...sampleProfile,
        previous_mythic_plus_ranks: {
          overall: { world: 18745, region: 5607, realm: 95 },
          class: { world: 1456, region: 503, realm: 12 },
        },
      },
      "EU",
      Date.parse("2026-07-27T10:00:00.000Z"),
    );
    expect(profile.previousRanks?.region).toBe(5607);
    expect(profile.previousRanks?.classRank.region).toBe(503);
    expect(profile.ranks?.classRank.region).toBe(800);
  });
});

describe("normalizeSeasonCutoffs", () => {
  it("maps all five documented quantiles with explicit top-percent semantics", () => {
    const raw: RawSeasonCutoffsResponse = {
      cutoffs: {
        updatedAt: "2026-07-20T06:00:00.000Z",
        p999: {
          score: 3483.25,
          all: { quantilePopulationCount: 900, totalPopulationCount: 900000 },
        },
        p990: { score: 3201.5 },
        p900: { score: 2850.75 },
        p750: { score: 2650.5 },
        p600: { score: 2410.125 },
      },
    };
    const cutoffs = normalizeSeasonCutoffs(raw, "EU", "season-mn-1");
    expect(cutoffs.top0_1Percent).toEqual({
      score: 3483.25,
      quantile: "p999",
      label: "top_0_1_percent",
      quantilePopulationCount: 900,
      totalPopulationCount: 900000,
    });
    expect(cutoffs.top1Percent).toMatchObject({
      score: 3201.5,
      quantile: "p990",
      label: "top_1_percent",
    });
    expect(cutoffs.top10Percent).toMatchObject({
      score: 2850.75,
      quantile: "p900",
      label: "top_10_percent",
    });
    expect(cutoffs.top25Percent).toMatchObject({
      score: 2650.5,
      quantile: "p750",
      label: "top_25_percent",
    });
    expect(cutoffs.top40Percent).toMatchObject({
      score: 2410.125,
      quantile: "p600",
      label: "top_40_percent",
    });
    // Preserve exact floating scores — no rounding/interpolation.
    expect(cutoffs.top40Percent?.score).toBe(2410.125);
    expect(cutoffs.attribution.displayText).toBe("Data from Raider.IO");
  });

  it("keeps available thresholds when some percentile nodes are absent", () => {
    const cutoffs = normalizeSeasonCutoffs(
      {
        cutoffs: {
          p999: { score: 3500 },
          p990: { score: 3200 },
          p750: { score: 2650.5 },
          p600: { score: 2400 },
        },
      },
      "EU",
      "season-mn-1",
    );
    expect(cutoffs.top0_1Percent?.score).toBe(3500);
    expect(cutoffs.top1Percent?.score).toBe(3200);
    expect(cutoffs.top10Percent).toBeNull();
    expect(cutoffs.top25Percent?.score).toBe(2650.5);
    expect(cutoffs.top40Percent?.score).toBe(2400);
  });

  it("does not fabricate a threshold from a missing score", () => {
    const cutoffs = normalizeSeasonCutoffs(
      { cutoffs: { p750: { all: { totalPopulationCount: 1 } } } },
      "EU",
      "season-mn-1",
    );
    expect(cutoffs.top25Percent).toBeNull();
    expect(seasonCutoffsHaveAnyThreshold(cutoffs)).toBe(false);
  });

  it("maps remapped historical cutoffs that only expose all.quantileMinValue (season-tww-3 shape)", () => {
    // Live EU season-tww-3 (isRemappedSeason): percentile nodes omit top-level `score`.
    const raw: RawSeasonCutoffsResponse = {
      cutoffs: {
        updatedAt: "Wed Jan 28 2026 19:41:04 GMT+0000 (Coordinated Universal Time)",
        p999: {
          all: {
            quantile: 0.999,
            quantileMinValue: 3946.97,
            quantilePopulationCount: 900,
            quantilePopulationFraction: 0.001,
            totalPopulationCount: 900_000,
          },
        },
        p990: { all: { quantile: 0.99, quantileMinValue: 3602.13 } },
        p900: { all: { quantile: 0.9, quantileMinValue: 3114.82 } },
        p750: { all: { quantile: 0.75, quantileMinValue: 2876.44 } },
        p600: { all: { quantile: 0.6, quantileMinValue: 2558.75 } },
      },
    };
    const cutoffs = normalizeSeasonCutoffs(raw, "EU", "season-tww-3");
    expect(cutoffs.top0_1Percent).toEqual({
      score: 3946.97,
      quantile: "p999",
      label: "top_0_1_percent",
      quantilePopulationCount: 900,
      totalPopulationCount: 900_000,
    });
    expect(cutoffs.top1Percent?.score).toBe(3602.13);
    expect(cutoffs.top10Percent?.score).toBe(3114.82);
    expect(cutoffs.top25Percent?.score).toBe(2876.44);
    expect(cutoffs.top40Percent?.score).toBe(2558.75);
    expect(seasonCutoffsHaveAnyThreshold(cutoffs)).toBe(true);
  });

  it("prefers top-level score over all.quantileMinValue when both exist", () => {
    const cutoffs = normalizeSeasonCutoffs(
      {
        cutoffs: {
          p750: {
            score: 2650.5,
            all: { quantileMinValue: 9999 },
          },
        },
      },
      "EU",
      "season-mn-1",
    );
    expect(cutoffs.top25Percent?.score).toBe(2650.5);
  });

  it("treats p990-only payload as useful cutoff evidence", () => {
    const cutoffs = normalizeSeasonCutoffs(
      { cutoffs: { p990: { score: 3201.5 } } },
      "EU",
      "season-mn-1",
    );
    expect(cutoffs.top1Percent?.label).toBe("top_1_percent");
    expect(cutoffs.top25Percent).toBeNull();
    expect(seasonCutoffsHaveAnyThreshold(cutoffs)).toBe(true);
  });
});

describe("unavailableSeasonCutoffs", () => {
  it("nulls all five threshold fields", () => {
    const cutoffs = unavailableSeasonCutoffs("EU", "season-mn-1");
    expect(cutoffs.top0_1Percent).toBeNull();
    expect(cutoffs.top1Percent).toBeNull();
    expect(cutoffs.top10Percent).toBeNull();
    expect(cutoffs.top25Percent).toBeNull();
    expect(cutoffs.top40Percent).toBeNull();
    expect(cutoffs.updatedAt).toBeNull();
  });
});

describe("seasonCutoffsSchema soft node handling", () => {
  it("drops a malformed percentile node without discarding siblings", () => {
    const parsed = parseWithSchema(
      seasonCutoffsSchema,
      {
        cutoffs: {
          p999: { score: "not-a-number" },
          p750: { score: 2650.5 },
        },
      },
      "mythic-plus.season-cutoffs",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const cutoffs = normalizeSeasonCutoffs(parsed.data as RawSeasonCutoffsResponse, "EU", "s");
    expect(cutoffs.top0_1Percent).toBeNull();
    expect(cutoffs.top25Percent?.score).toBe(2650.5);
  });
});

describe("normalizePeriods", () => {
  it("maps live region period windows", () => {
    const periods = normalizePeriods([
      {
        region: "eu",
        current: { period: 1073, start: "2026-07-22T04:00:00.000Z", end: "2026-07-29T04:00:00.000Z" },
      },
    ]);
    expect(periods).toEqual([
      {
        id: 1073,
        seasonSlug: null,
        startsAt: "2026-07-22T04:00:00.000Z",
        endsAt: "2026-07-29T04:00:00.000Z",
      },
    ]);
  });
});

describe("extractBoostSupportFacts", () => {
  it("provides neutral teammate recurrence facts without boost verdict", () => {
    const profile = normalizeCharacterProfile(sampleProfile, "EU");
    const facts = extractBoostSupportFacts(profile);
    expect(facts.currentSeasonScore).toBe(2845.5);
    expect(facts.historyIncomplete).toBe(true);
    expect(facts.runs.length).toBeGreaterThan(0);
    expect(facts).not.toHaveProperty("boosted");
    expect(facts.attribution.displayText).toBe("Data from Raider.IO");
  });
});
