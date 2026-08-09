import { describe, expect, it } from "vitest";
import { extractExactSeasonHistoricalRatingFromRaw } from "./exact-season-historical-rating.js";
import type { RawCharacterProfileResponse } from "./raw-types.js";

function rawBase(
  overrides: Partial<RawCharacterProfileResponse> = {},
): RawCharacterProfileResponse {
  return {
    name: "Tester",
    region: "eu",
    realm: "Archimonde",
    ...overrides,
  };
}

describe("extractExactSeasonHistoricalRatingFromRaw", () => {
  it("extracts positive exact-season score with activity proof", () => {
    const out = extractExactSeasonHistoricalRatingFromRaw(
      rawBase({
        mythic_plus_scores_by_season: [
          { season: "season-tww-3", scores: { all: 2900, dps: 2900, healer: 0, tank: 0 } },
        ],
        mythic_plus_dungeon_run_counts: [
          { zone_id: 1, season_runs_total: 3, season_runs_timed: 2 },
        ],
      }),
      "season-tww-3",
    );
    expect(out).toEqual({
      requestedSeasonSlug: "season-tww-3",
      seasonFound: true,
      scoreAll: 2900,
      activityProof: "PROVEN_ACTIVITY",
      totalSeasonRuns: 3,
    });
  });

  it("treats zero score + zero-filled run counts as PROVEN_NONE", () => {
    const out = extractExactSeasonHistoricalRatingFromRaw(
      rawBase({
        mythic_plus_scores_by_season: [
          { season: "season-tww-3", scores: { all: 0, dps: 0, healer: 0, tank: 0 } },
        ],
        mythic_plus_dungeon_run_counts: [
          { zone_id: 1, season_runs_total: 0, season_runs_timed: 0 },
          { zone_id: 2, season_runs_total: 0, season_runs_timed: 0 },
        ],
      }),
      "season-tww-3",
    );
    expect(out.seasonFound).toBe(true);
    expect(out.scoreAll).toBe(0);
    expect(out.activityProof).toBe("PROVEN_NONE");
    expect(out.totalSeasonRuns).toBe(0);
  });

  it("rejects wrong-season / event-season payloads", () => {
    const out = extractExactSeasonHistoricalRatingFromRaw(
      rawBase({
        mythic_plus_scores_by_season: [
          {
            season: "season-mn-1-break-the-meta",
            scores: { all: 100, dps: 100, healer: 0, tank: 0 },
          },
        ],
      }),
      "season-tww-3",
    );
    expect(out.seasonFound).toBe(false);
    expect(out.scoreAll).toBeNull();
  });

  it("marks activity UNKNOWN when run counts are absent", () => {
    const out = extractExactSeasonHistoricalRatingFromRaw(
      rawBase({
        mythic_plus_scores_by_season: [
          { season: "season-tww-3", scores: { all: 0, dps: 0, healer: 0, tank: 0 } },
        ],
      }),
      "season-tww-3",
    );
    expect(out.activityProof).toBe("UNKNOWN");
    expect(out.totalSeasonRuns).toBeNull();
  });
});
