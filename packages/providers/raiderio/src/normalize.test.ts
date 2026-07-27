import { describe, expect, it } from "vitest";
import { normalizeCharacterProfile, normalizeSeasonCutoffs, extractBoostSupportFacts } from "./normalize.js";
import type { RawCharacterProfileResponse, RawSeasonCutoffsResponse } from "./raw-types.js";

const sampleProfile: RawCharacterProfileResponse = {
  name: "Fixturehero",
  class: "Mage",
  active_spec_name: "Arcane",
  active_spec_role: "DPS",
  region: "eu",
  realm: "tarren-mill",
  profile_url: "https://raider.io/characters/eu/tarren-mill/Fixturehero",
  mythic_plus_scores_by_season: [
    { season: "season-tww-2", scores: { all: 2845.5 } },
    { season: "season-tww-1", scores: { all: 2650.2 } },
  ],
  mythic_plus_ranks: { overall: 15234, role: "dps" },
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
  it("maps scores, runs, ranks, and attribution", () => {
    const profile = normalizeCharacterProfile(sampleProfile, "EU");
    expect(profile.currentSeason?.scores.all).toBe(2845.5);
    expect(profile.previousSeason?.scores.all).toBe(2650.2);
    expect(profile.ranks?.overall).toBe(15234);
    expect(profile.recentRuns[0]?.keyLevel).toBe(12);
    expect(profile.attribution.displayText).toBe("Data from Raider.IO");
    expect(profile.attribution.profileUrl).toContain("Fixturehero");
    expect(profile.runHistoryIncomplete).toBe(true);
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
    const cutoffs = normalizeSeasonCutoffs(raw, "EU", "season-tww-2");
    expect(cutoffs.top25Percent?.score).toBe(2650.5);
    expect(cutoffs.top25Percent?.label).toBe("top_25_percent");
    expect(cutoffs.attribution.displayText).toBe("Data from Raider.IO");
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
