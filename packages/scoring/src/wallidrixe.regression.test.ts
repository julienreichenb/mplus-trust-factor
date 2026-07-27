import { describe, expect, it } from "vitest";
import { calculateScore, createDefaultModelV1, createDefaultModelV2 } from "./index.js";
import type { MetricObservationDTO } from "@mplus/contracts";

function observation(
  overrides: Partial<MetricObservationDTO> & Pick<MetricObservationDTO, "metricKey" | "dimension">,
): MetricObservationDTO {
  return {
    rawValue: 70,
    normalizedValue: 70,
    confidence: 0.8,
    observedAt: "2026-07-20T18:00:00.000Z",
    sourceProvider: "warcraftlogs",
    coverage: null,
    context: {},
    ...overrides,
  };
}

describe("Wallidrixe-shaped scoring regressions", () => {
  it("scores PERFORMANCE from WCL peak/consistency, never treating Mythic+ rating as a percentile", () => {
    const model = createDefaultModelV2();
    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "performance.current_season_peak",
          dimension: "PERFORMANCE",
          rawValue: 80.875,
          normalizedValue: 80.875,
        }),
        observation({
          metricKey: "performance.current_season_consistency",
          dimension: "PERFORMANCE",
          rawValue: 77.75,
          normalizedValue: 77.75,
        }),
        observation({
          metricKey: "experience.mythic_rating",
          dimension: "EXPERIENCE",
          rawValue: 2845,
          normalizedValue: 78,
          sourceProvider: "blizzard",
          context: {
            normalization: "season_cutoff_top25",
            notAParsePercentile: true,
          },
        }),
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "wallidrixe-metric",
      context: { role: "DPS", freshness: 0.8, selectedRunCoverage: 0.5 },
    });

    const performance = snapshot.dimensions.find((d) => d.dimension === "PERFORMANCE");
    expect(performance).toBeDefined();
    expect(performance!.score).toBeGreaterThan(50);
    const expected = 0.65 * 80.875 + 0.35 * 77.75;
    const contributors = performance!.contributors as { rawScore?: number };
    expect(contributors.rawScore).toBeCloseTo(expected, 5);
    expect(JSON.stringify(snapshot.explanation)).not.toContain("performance.mythic_rating");
    expect(snapshot.modelVersion).toBe(2);
  });

  it("keeps v1 snapshots distinguishable by modelVersion", () => {
    const v1 = createDefaultModelV1();
    const v2 = createDefaultModelV2();
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.metricWeights.PERFORMANCE[0]?.metricKey).toBe("performance.mythic_rating");
    expect(v2.metricWeights.PERFORMANCE[0]?.metricKey).toBe("performance.current_season_peak");
  });

  it("emits logs_hidden only for explicit HIDDEN visibility, not zero coverage", () => {
    const model = createDefaultModelV2();
    const lowCoverage = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "experience.mythic_rating",
          dimension: "EXPERIENCE",
          context: { wclVisibility: "PUBLIC" },
        }),
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "wallidrixe-coverage",
      context: {
        role: "DPS",
        freshness: 0.7,
        selectedRunCoverage: 0,
        wclVisibility: "PUBLIC",
        matchedWclRunCount: 0,
      },
    });

    expect(lowCoverage.redFlags.some((f) => f.key === "logs_hidden")).toBe(false);
    expect(lowCoverage.redFlags.some((f) => f.key === "no_matched_run")).toBe(true);
  });

  it("no WCL PERFORMANCE observations → PERFORMANCE confidence stays low / near neutral", () => {
    const model = createDefaultModelV2();
    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "experience.mythic_rating",
          dimension: "EXPERIENCE",
          rawValue: 2845,
          normalizedValue: 78,
        }),
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "wallidrixe-no-wcl",
      context: { role: "DPS", freshness: 0.5, selectedRunCoverage: 0 },
    });
    const performance = snapshot.dimensions.find((d) => d.dimension === "PERFORMANCE")!;
    expect(performance.confidence).toBe(0);
    expect(performance.score).toBe(50);
  });
});
