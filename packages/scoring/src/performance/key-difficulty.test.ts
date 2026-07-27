import { describe, expect, it } from "vitest";
import {
  BOUNDED_KEY_DIFFICULTY_ANCHORS,
  computeKeyDifficultyPercentile,
  interpolateKeyDifficultyPercentile,
} from "./key-difficulty.js";

describe("key difficulty normalization", () => {
  it("interpolates between documented bounded anchors", () => {
    expect(interpolateKeyDifficultyPercentile(10, BOUNDED_KEY_DIFFICULTY_ANCHORS)).toBe(52);
    expect(interpolateKeyDifficultyPercentile(12, BOUNDED_KEY_DIFFICULTY_ANCHORS)).toBe(65);
    const mid = interpolateKeyDifficultyPercentile(11, BOUNDED_KEY_DIFFICULTY_ANCHORS);
    expect(mid).toBeGreaterThan(52);
    expect(mid).toBeLessThan(65);
  });

  it("uses regional distribution when anchors are provided", () => {
    const result = computeKeyDifficultyPercentile({
      keyLevel: 14,
      timed: true,
      context: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
        regionalAnchors: [
          { keyLevel: 10, percentile: 40 },
          { keyLevel: 14, percentile: 70 },
          { keyLevel: 18, percentile: 90 },
        ],
      },
    });
    expect(result.source).toBe("regional_distribution");
    expect(result.percentile).toBe(70);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("calibrates from season cutoffs when regional anchors missing", () => {
    const result = computeKeyDifficultyPercentile({
      keyLevel: 16,
      timed: true,
      context: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
        top25CutoffScore: 2800,
        observedKeyLevels: [12, 14, 16, 15],
      },
    });
    expect(result.source).toBe("season_cutoff_calibrated");
    expect(result.percentile).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it("uses bounded fallback with low confidence when cutoffs unavailable", () => {
    const result = computeKeyDifficultyPercentile({
      keyLevel: 12,
      context: {
        seasonSlug: "season-midnight-s1",
        region: "EU",
        top25CutoffScore: null,
      },
    });
    expect(result.source).toBe("bounded_fallback");
    expect(result.percentile).toBe(65);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.reason).toContain("bounded_fallback");
  });

  it("never zero-fills a missing key level", () => {
    const result = computeKeyDifficultyPercentile({
      keyLevel: null,
      context: { seasonSlug: null, region: null },
    });
    expect(result.percentile).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
