import { describe, expect, it } from "vitest";
import { formatScoringSeasonLabel } from "./scoringSeasonLabel";

describe("formatScoringSeasonLabel", () => {
  it("uses Blizzard Season N / Blizzard N when an id is present", () => {
    expect(formatScoringSeasonLabel({ name: "Season 17", blizzardSeasonId: 17 })).toBe(
      "Blizzard Season 17 / Blizzard 17",
    );
    expect(
      formatScoringSeasonLabel({ name: "Blizzard Season 18 (blizzard-season-18)", blizzardSeasonId: 18 }),
    ).toBe("Blizzard Season 18 / Blizzard 18");
  });

  it("falls back to name when no blizzard id", () => {
    expect(formatScoringSeasonLabel({ name: "placeholder-current", blizzardSeasonId: null })).toBe(
      "placeholder-current",
    );
  });
});
