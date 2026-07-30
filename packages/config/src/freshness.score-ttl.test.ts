import { describe, expect, it } from "vitest";
import { buildFreshnessConfig, isDatasetFresh } from "./freshness.js";

describe("calculated.score_snapshot TTL", () => {
  it("uses SCORE_TTL_SECONDS (not Blizzard character TTL)", () => {
    const config = buildFreshnessConfig({
      BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
      WCL_CHARACTER_TTL_SECONDS: 43_200,
      RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
      SCORE_TTL_SECONDS: 604_800,
    });
    expect(config.datasets["calculated.score_snapshot"]).toBe(604_800);

    const now = Date.parse("2026-07-30T12:00:00.000Z");
    const twoDaysAgo = new Date(now - 2 * 86_400_000);
    // Older than Blizzard 1d TTL, still within 7d score TTL.
    expect(isDatasetFresh(twoDaysAgo, "calculated.score_snapshot", config, now)).toBe(true);
    expect(isDatasetFresh(twoDaysAgo, "blizzard.character_profile", config, now)).toBe(false);

    const eightDaysAgo = new Date(now - 8 * 86_400_000);
    expect(isDatasetFresh(eightDaysAgo, "calculated.score_snapshot", config, now)).toBe(false);
  });
});
