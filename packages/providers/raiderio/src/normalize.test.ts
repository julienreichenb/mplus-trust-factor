import { describe, expect, it } from "vitest";
import {
  extractBoostSupportFacts,
  isCrawlStale,
  mapGear,
  mapRanks,
  normalizeCharacterProfile,
  normalizePeriods,
  normalizeSeasonCutoffs,
} from "./normalize.js";
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
  mythic_plus_scores_by_season: [
    { season: "season-mn-1", scores: { all: 2845.5 } },
    { season: "season-tww-3", scores: { all: 3012.0 } },
  ],
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
    expect(profile.previousSeason?.seasonSlug).toBe("season-tww-3");
    expect(profile.previousSeason?.scores.all).toBe(3012.0);
    expect(profile.seasons).toHaveLength(2);
    expect(profile.seasons[0]?.isCurrentSeason).toBe(true);
    expect(profile.seasons[1]?.isPreviousSeason).toBe(true);
    expect(profile.ranks?.overall).toBe(89000);
    expect(profile.ranks?.region).toBe(12000);
    expect(profile.ranks?.server).toBe(450);
    expect(profile.ranks?.role).toBe("dps");
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
    expect(profile.previousSeason).toBeNull();
    expect(profile.seasons).toEqual([]);
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
  });

  it("maps empty gear arrays", () => {
    expect(mapGear({ item_level_equipped: 0, items: [] })?.items).toEqual([]);
  });
});

describe("normalizeSeasonCutoffs", () => {
  it("exposes top 25% threshold from p750", () => {
    const raw: RawSeasonCutoffsResponse = {
      cutoffs: {
        updatedAt: "2026-07-20T06:00:00.000Z",
        p750: { score: 2650.5 },
      },
    };
    const cutoffs = normalizeSeasonCutoffs(raw, "EU", "season-mn-1");
    expect(cutoffs.top25Percent?.score).toBe(2650.5);
    expect(cutoffs.top25Percent?.label).toBe("top_25_percent");
    expect(cutoffs.attribution.displayText).toBe("Data from Raider.IO");
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
