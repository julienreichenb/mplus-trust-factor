import { describe, expect, it } from "vitest";
import { FAQ_DESCRIPTION_MAX_LENGTH, FAQ_TITLE_MAX_LENGTH } from "@mplus/contracts";
import { PRODUCTION_FAQ_ENTRIES, PRODUCTION_FAQ_IDS } from "./faq-production-content.js";

describe("production FAQ catalog", () => {
  it("defines 15 unique published entries with gapped positions and valid lengths", () => {
    expect(PRODUCTION_FAQ_ENTRIES).toHaveLength(15);
    expect(new Set(PRODUCTION_FAQ_IDS).size).toBe(15);
    expect(PRODUCTION_FAQ_ENTRIES.map((e) => e.position)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
    ]);
    expect(PRODUCTION_FAQ_ENTRIES.find((e) => e.position === 20)?.embedType).toBe("SCORE_FLOW");
    expect(PRODUCTION_FAQ_ENTRIES.find((e) => e.position === 30)?.embedType).toBe("SCORING_DIMENSIONS");
    expect(PRODUCTION_FAQ_ENTRIES.find((e) => e.position === 50)?.embedType).toBe("KEY_PERCENTILE_TABLE");
    expect(PRODUCTION_FAQ_ENTRIES.find((e) => e.position === 60)?.embedType).toBe("META_TIER_TABLE");
    expect(PRODUCTION_FAQ_ENTRIES.filter((e) => e.embedType == null)).toHaveLength(11);
    for (const entry of PRODUCTION_FAQ_ENTRIES) {
      expect(entry.isPublished).toBe(true);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.title.length).toBeLessThanOrEqual(FAQ_TITLE_MAX_LENGTH);
      expect(entry.description.trim().length).toBeGreaterThan(0);
      expect(entry.description.length).toBeLessThanOrEqual(FAQ_DESCRIPTION_MAX_LENGTH);
      expect(entry.description).not.toMatch(/<[^>]+>/);
    }
  });
});
