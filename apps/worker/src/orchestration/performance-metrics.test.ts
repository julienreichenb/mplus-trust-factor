import { describe, expect, it } from "vitest";
import { buildMythicRatingObservation } from "./performance-metrics.js";

describe("buildMythicRatingObservation", () => {
  it("uses season cutoffs when available and does not claim percentile labeling", () => {
    const obs = buildMythicRatingObservation({
      mythicRating: 2400,
      observedAt: "2026-07-27T12:00:00.000Z",
      cutoffs: {
        region: "EU",
        seasonSlug: "season-tww-3",
        updatedAt: "2026-07-27T00:00:00.000Z",
        top25Percent: { score: 2500, quantile: "p750", label: "top_25_percent" },
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: null,
          sourceUrl: null,
        },
      },
    });

    expect(obs.metricKey).toBe("performance.mythic_rating");
    expect(obs.metricKey).not.toContain("percentile");
    expect(obs.confidence).toBeGreaterThanOrEqual(0.7);
    expect((obs.context as { normalization: string }).normalization).toBe("season_cutoff_top25");
    expect((obs.context as { raiderIoScoreKeptSeparate: boolean }).raiderIoScoreKeptSeparate).toBe(
      true,
    );
  });

  it("falls back to a transparent low-confidence heuristic when cutoffs are unavailable", () => {
    const obs = buildMythicRatingObservation({
      mythicRating: 1800,
      observedAt: "2026-07-27T12:00:00.000Z",
      cutoffs: null,
      heuristicCeiling: 3600,
    });

    expect(obs.metricKey).toBe("performance.mythic_rating");
    expect(obs.normalizedValue).toBeCloseTo(50, 5);
    expect(obs.confidence).toBeLessThan(0.5);
    expect((obs.context as { normalization: string }).normalization).toBe(
      "transparent_heuristic_ceiling",
    );
    expect((obs.context as { warning: string }).warning).toMatch(/not a percentile/i);
  });

  it("never uses the fake rating/3200 percentile mapping as the metric key", () => {
    const obs = buildMythicRatingObservation({
      mythicRating: 3200,
      observedAt: "2026-07-27T12:00:00.000Z",
      cutoffs: null,
    });
    expect(obs.metricKey).not.toBe("performance.spec_percentile");
    expect(obs.rawValue).toBe(3200);
  });
});
