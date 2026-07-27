import { describe, expect, it } from "vitest";
import { buildMinimalCharacterFields, MINIMAL_CHARACTER_FIELDS } from "./fields.js";

describe("buildMinimalCharacterFields", () => {
  it("requests the minimal documented field set in one string", () => {
    const fields = buildMinimalCharacterFields();
    expect(fields).toContain("mythic_plus_scores_by_season:current:previous");
    expect(fields).toContain("mythic_plus_ranks");
    expect(fields).toContain("mythic_plus_recent_runs");
    expect(fields).toContain("mythic_plus_best_runs");
    expect(fields).toContain("mythic_plus_highest_level_runs");
    expect(fields).toContain("raid_progression:current-expansion");
    expect(fields).not.toContain("gear");
    expect(fields).not.toContain("talents");
    expect(MINIMAL_CHARACTER_FIELDS.length).toBe(6);
  });
});
