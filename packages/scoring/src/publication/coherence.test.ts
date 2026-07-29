import { describe, expect, it } from "vitest";
import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import { createDefaultModelV4 } from "../model/defaults.js";
import {
  mergeObservationsWithLastKnownGood,
  validateCoherence,
} from "./coherence.js";

function dim(
  dimension: "PERFORMANCE" | "SURVIVAL" | "EXPERIENCE",
  score: number | null,
  state: "AVAILABLE" | "UNAVAILABLE" = score != null ? "AVAILABLE" : "UNAVAILABLE",
) {
  return {
    dimension,
    score,
    confidence: score != null ? 0.8 : 0,
    weight: 0.3,
    state,
    reason: state === "UNAVAILABLE" ? "NO_OBSERVATIONS" : null,
    contributors: score != null ? [{ metricKey: `${dimension.toLowerCase()}.test` }] : [],
  };
}

function snapshot(
  dimensions: ReturnType<typeof dim>[],
  overrides: Partial<ScoreSnapshotDTO> = {},
): ScoreSnapshotDTO {
  const model = createDefaultModelV4();
  return {
    characterId: "char-1",
    seasonSlug: "blizzard-season-13",
    modelKey: model.key,
    modelVersion: model.version,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: 75,
    grade: "B",
    skillScore: 75,
    authenticityScore: 70,
    confidence: 0.75,
    calculatedAt: "2026-07-20T18:00:00.000Z",
    inputFingerprint: "fp-1",
    dimensions,
    redFlags: [],
    explanation: { refreshContractHash: "contract-v1" },
    availableModelWeight: 0.9,
    totalModelWeight: 1,
    modelCoverageRatio: 0.9,
    overallState: "DEFINITIVE",
    provisionalReason: null,
    ...overrides,
  };
}

describe("validateCoherence", () => {
  const model = createDefaultModelV4();

  it("accepts a complete first calculation", () => {
    const candidate = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", 75),
      dim("EXPERIENCE", 70),
    ]);
    const result = validateCoherence({
      candidate,
      published: null,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: true,
    });
    expect(result.ok).toBe(true);
    expect(result.coverageState).toBe("COMPLETE");
  });

  it("rejects candidate that loses Survival when published had it (Wallidrixe regression)", () => {
    const published = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", 75),
      dim("EXPERIENCE", 70),
    ]);
    const candidate = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", null, "UNAVAILABLE"),
      dim("EXPERIENCE", 70),
    ], { grade: "U", confidence: 0.3, modelCoverageRatio: 0.65 });

    const result = validateCoherence({
      candidate,
      published,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.ok).toBe(false);
    expect(result.regressedDimensions).toContain("SURVIVAL");
    expect(result.violations.some((v) => v.code === "DIMENSION_REGRESSION")).toBe(true);
  });

  it("rejects candidate that loses Performance after WCL combat-event failure", () => {
    const published = snapshot([
      dim("PERFORMANCE", 82),
      dim("SURVIVAL", 78),
      dim("EXPERIENCE", 72),
    ]);
    const candidate = snapshot([
      dim("PERFORMANCE", null, "UNAVAILABLE"),
      dim("SURVIVAL", 78),
      dim("EXPERIENCE", 72),
    ]);

    const result = validateCoherence({
      candidate,
      published,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.ok).toBe(false);
    expect(result.regressedDimensions).toContain("PERFORMANCE");
  });

  it("accepts candidate that improves or maintains all dimensions", () => {
    const published = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", 75),
      dim("EXPERIENCE", 70),
    ]);
    const candidate = snapshot([
      dim("PERFORMANCE", 85),
      dim("SURVIVAL", 78),
      dim("EXPERIENCE", 72),
    ]);

    const result = validateCoherence({
      candidate,
      published,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.ok).toBe(true);
  });

  it("allows first publish when no published snapshot exists", () => {
    const candidate = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", 75),
      dim("EXPERIENCE", 70),
    ]);

    const result = validateCoherence({
      candidate,
      published: null,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.ok).toBe(true);
    expect(result.regressedDimensions).toHaveLength(0);
    expect(result.violations.some((v) => v.code === "DIMENSION_REGRESSION")).toBe(false);
  });

  it("does not flag regression when published dimension was already unavailable", () => {
    const published = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", null, "UNAVAILABLE"),
      dim("EXPERIENCE", 70),
    ]);
    const candidate = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", null, "UNAVAILABLE"),
      dim("EXPERIENCE", 70),
    ]);

    const result = validateCoherence({
      candidate,
      published,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.regressedDimensions).not.toContain("SURVIVAL");
    expect(result.violations.some((v) => v.code === "DIMENSION_REGRESSION")).toBe(false);
  });

  it("detects regression when candidate omits a previously available dimension", () => {
    const published = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", 75),
      dim("EXPERIENCE", 70),
    ]);
    const candidate = snapshot([
      dim("PERFORMANCE", 80),
      dim("EXPERIENCE", 70),
    ]);

    const result = validateCoherence({
      candidate,
      published,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.ok).toBe(false);
    expect(result.regressedDimensions).toContain("SURVIVAL");
  });

  it("handles nullable dimension score and reason without false regression", () => {
    const published = snapshot([
      {
        dimension: "SURVIVAL",
        score: null,
        confidence: 0,
        weight: 0.3,
        state: "UNAVAILABLE",
        reason: null,
        contributors: [],
      },
      dim("PERFORMANCE", 80),
      dim("EXPERIENCE", 70),
    ]);
    const candidate = snapshot([
      dim("PERFORMANCE", 80),
      dim("SURVIVAL", null, "UNAVAILABLE"),
      dim("EXPERIENCE", 70),
    ]);

    const result = validateCoherence({
      candidate,
      published,
      model,
      refreshContractHash: "contract-v1",
      expectedModelKey: model.key,
      expectedModelVersion: model.version,
      observations: [],
      isFirstCalculation: false,
    });

    expect(result.regressedDimensions).not.toContain("SURVIVAL");
    expect(result.ok).toBe(true);
  });
});

describe("mergeObservationsWithLastKnownGood", () => {
  const survivalObs: MetricObservationDTO = {
    metricKey: "survival.avoidable_damage",
    dimension: "SURVIVAL",
    rawValue: 85,
    normalizedValue: 85,
    confidence: 0.8,
    observedAt: "2026-07-20T18:00:00.000Z",
    sourceProvider: "warcraftlogs",
    coverage: null,
    context: { reportCode: "abc", fightId: 1 },
  };

  it("preserves persisted Survival observations when SURVIVAL failed", () => {
    const merged = mergeObservationsWithLastKnownGood({
      incoming: [],
      persisted: [survivalObs],
      refreshedMetricKeys: new Set(),
      failedDimensions: new Set(["SURVIVAL"]),
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.metricKey).toBe("survival.avoidable_damage");
  });

  it("uses incoming observations when dimension succeeded", () => {
    const updated: MetricObservationDTO = {
      ...survivalObs,
      rawValue: 90,
      normalizedValue: 90,
    };
    const merged = mergeObservationsWithLastKnownGood({
      incoming: [updated],
      persisted: [survivalObs],
      refreshedMetricKeys: new Set(["survival.avoidable_damage"]),
      failedDimensions: new Set(),
    });
    expect(merged[0]!.rawValue).toBe(90);
  });
});
