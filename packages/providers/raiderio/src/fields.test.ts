import { describe, expect, it } from "vitest";
import { buildMinimalCharacterFields, MINIMAL_CHARACTER_FIELDS } from "./fields.js";

describe("buildMinimalCharacterFields", () => {
  it("requests the Wave 3 documented field set in one string", () => {
    const fields = buildMinimalCharacterFields();
    expect(fields).toContain("gear");
    expect(fields).toContain("talents");
    expect(fields).toContain("mythic_plus_scores_by_season:current");
    expect(fields).not.toContain("previous");
    expect(fields).toContain("mythic_plus_ranks");
    expect(fields).toContain("mythic_plus_recent_runs");
    expect(fields).toContain("mythic_plus_best_runs");
    expect(fields).not.toContain("mythic_plus_highest_level_runs");
    expect(fields).not.toContain("raid_progression");
    expect(MINIMAL_CHARACTER_FIELDS.length).toBe(6);
  });
});
