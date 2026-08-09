import { describe, expect, it } from "vitest";
import {
  buildExactSeasonHistoricalEvidenceFields,
  buildExactSeasonScoreFields,
  buildMinimalCharacterFields,
  isValidRaiderIoSeasonSlug,
  MINIMAL_CHARACTER_FIELDS,
} from "./fields.js";

describe("buildMinimalCharacterFields", () => {
  it("requests the Wave 3 documented field set in one string", () => {
    const fields = buildMinimalCharacterFields();
    expect(fields).toContain("gear");
    expect(fields).toContain("talents");
    expect(fields).toContain("mythic_plus_scores_by_season:current:previous");
    expect(fields).toContain("previous");
    expect(fields).toContain("mythic_plus_ranks");
    expect(fields).toContain("previous_mythic_plus_ranks");
    expect(fields).toContain("mythic_plus_recent_runs");
    expect(fields).toContain("mythic_plus_best_runs");
    expect(fields).not.toContain("mythic_plus_highest_level_runs");
    expect(fields).not.toContain("raid_progression");
    expect(MINIMAL_CHARACTER_FIELDS.length).toBe(7);
  });
});

describe("buildExactSeasonScoreFields", () => {
  it("requests an exact season slug without previous/current aliases", () => {
    expect(buildExactSeasonScoreFields("season-tww-3")).toBe(
      "mythic_plus_scores_by_season:season-tww-3",
    );
    expect(isValidRaiderIoSeasonSlug("season-mn-1")).toBe(true);
    expect(isValidRaiderIoSeasonSlug("previous")).toBe(false);
    expect(() => buildExactSeasonScoreFields("previous")).toThrow(/invalid_raiderio_season_slug/);
    expect(() => buildExactSeasonScoreFields("current")).toThrow(/invalid_raiderio_season_slug/);
    expect(() => buildExactSeasonScoreFields("bad slug")).toThrow(/invalid_raiderio_season_slug/);
  });
});

describe("buildExactSeasonHistoricalEvidenceFields", () => {
  it("requests exact season scores + dungeon run counts", () => {
    expect(buildExactSeasonHistoricalEvidenceFields("season-tww-3")).toBe(
      "mythic_plus_scores_by_season:season-tww-3,mythic_plus_dungeon_run_counts:season-tww-3",
    );
  });
});
