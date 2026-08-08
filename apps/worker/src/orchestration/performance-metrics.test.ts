import { describe, expect, it } from "vitest";
import { buildMythicRatingObservation } from "./performance-metrics.js";

describe("buildMythicRatingObservation", () => {
  it("emits EXPERIENCE mythic rating, never as a parse percentile", () => {
    const obs = buildMythicRatingObservation({
      mythicRating: 2845,
      observedAt: "2026-07-20T18:00:00.000Z",
      cutoffs: {
        seasonSlug: "season-tww-3",
        region: "EU",
        updatedAt: "2026-07-01T00:00:00.000Z",
        top0_1Percent: null,
        top1Percent: null,
        top10Percent: null,
        top25Percent: { score: 3000, quantile: "p750", label: "top_25_percent" },
        top40Percent: null,
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: null,
          sourceUrl: null,
        },
      },
    });
    expect(obs.metricKey).toBe("experience.mythic_rating");
    expect(obs.dimension).toBe("EXPERIENCE");
    expect(obs.rawValue).toBe(2845);
    expect((obs.context as { notAParsePercentile?: boolean }).notAParsePercentile).toBe(true);
  });

  it("uses heuristic ceiling with low confidence when cutoffs missing", () => {
    const obs = buildMythicRatingObservation({
      mythicRating: 1800,
      observedAt: "2026-07-20T18:00:00.000Z",
      cutoffs: null,
    });
    expect(obs.metricKey).toBe("experience.mythic_rating");
    expect(obs.dimension).toBe("EXPERIENCE");
    expect(obs.confidence).toBeLessThan(0.5);
  });

  it("never labels rating under PERFORMANCE", () => {
    const obs = buildMythicRatingObservation({
      mythicRating: 2000,
      observedAt: "2026-07-20T18:00:00.000Z",
      cutoffs: null,
    });
    expect(obs.dimension).not.toBe("PERFORMANCE");
    expect(obs.metricKey).not.toBe("performance.mythic_rating");
  });
});
