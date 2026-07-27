import { describe, expect, it } from "vitest";
import { calculateScore, createDefaultModelV1 } from "./index.js";
import type { MetricObservationDTO } from "@mplus/contracts";

const model = createDefaultModelV1();

function observation(
  overrides: Partial<MetricObservationDTO> & Pick<MetricObservationDTO, "metricKey" | "dimension">,
): MetricObservationDTO {
  return {
    rawValue: 70,
    normalizedValue: 70,
    confidence: 0.8,
    observedAt: "2026-07-20T18:00:00.000Z",
    sourceProvider: "blizzard",
    coverage: null,
    context: {},
    ...overrides,
  };
}

describe("Wallidrixe-shaped scoring regressions", () => {
  it("scores PERFORMANCE from performance.mythic_rating, never treating rating as a percentile", () => {
    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "performance.mythic_rating",
          dimension: "PERFORMANCE",
          rawValue: 2845,
          normalizedValue: 78,
          context: {
            normalization: "season_cutoff_top25",
            warning: undefined,
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
    const explanation = snapshot.explanation as { observations?: unknown };
    expect(JSON.stringify(explanation)).not.toContain("spec_percentile");
  });

  it("emits logs_hidden only for explicit HIDDEN visibility, not zero coverage", () => {
    const lowCoverage = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "performance.mythic_rating",
          dimension: "PERFORMANCE",
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

    const hidden = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "performance.mythic_rating",
          dimension: "PERFORMANCE",
          context: { logsHidden: true, wclVisibility: "HIDDEN" },
        }),
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "wallidrixe-hidden",
      context: {
        role: "DPS",
        freshness: 0.35,
        selectedRunCoverage: 0,
        wclVisibility: "HIDDEN",
      },
    });

    expect(hidden.redFlags.some((f) => f.key === "logs_hidden")).toBe(true);

    const noPublic = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({ metricKey: "performance.mythic_rating", dimension: "PERFORMANCE" }),
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "wallidrixe-no-logs",
      context: {
        role: "DPS",
        freshness: 0.45,
        selectedRunCoverage: 0,
        wclVisibility: "NO_PUBLIC_LOGS",
      },
    });

    expect(noPublic.redFlags.some((f) => f.key === "logs_hidden")).toBe(false);
    expect(noPublic.redFlags.some((f) => f.key === "no_public_logs")).toBe(true);
  });

  it("returns grade U (UNRATED) below the confidence threshold instead of a reliable letter grade", () => {
    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "blizzard-season-13",
      model,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        observation({
          metricKey: "performance.mythic_rating",
          dimension: "PERFORMANCE",
          confidence: 0.2,
          normalizedValue: 55,
        }),
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "wallidrixe-unrated",
      context: {
        role: "DPS",
        freshness: 0.2,
        selectedRunCoverage: 0,
        wclVisibility: "NO_PUBLIC_LOGS",
      },
    });

    expect(snapshot.confidence).toBeLessThan(model.minConfidenceForGrade);
    expect(snapshot.grade).toBe("U");
    expect(snapshot.redFlags.some((f) => f.key === "insufficient_data")).toBe(true);
  });
});
