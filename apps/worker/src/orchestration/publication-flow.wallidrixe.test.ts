import { describe, expect, it, vi } from "vitest";
import { createDefaultModelV4 } from "@mplus/scoring";
import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import { attemptPublication } from "./publication-flow.js";
import type { ScoreRepository } from "../persistence/score-repository.js";
import type { MetricRepository } from "../persistence/metric-repository.js";

function dim(dimension: "PERFORMANCE" | "SURVIVAL" | "EXPERIENCE", score: number) {
  return {
    dimension,
    score,
    confidence: 0.8,
    weight: 0.3,
    state: "AVAILABLE" as const,
    reason: null,
    contributors: [],
  };
}

function snapshot(overrides: Partial<ScoreSnapshotDTO> = {}): ScoreSnapshotDTO {
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
    dimensions: [dim("PERFORMANCE", 80), dim("SURVIVAL", 75), dim("EXPERIENCE", 70)],
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

function mockScoreRepo(overrides: Partial<ScoreRepository> = {}): ScoreRepository {
  return {
    getPublishedSnapshot: vi.fn().mockResolvedValue(null),
    publishOrRejectCandidate: vi.fn().mockResolvedValue({
      published: true,
      snapshot: { id: "snap-1" },
    }),
    ...overrides,
  } as unknown as ScoreRepository;
}

function mockMetricRepo(): MetricRepository {
  return {
    upsertObservations: vi.fn().mockResolvedValue(undefined),
    replaceObservations: vi.fn(),
    listForCharacter: vi.fn().mockResolvedValue([]),
  } as unknown as MetricRepository;
}

describe("attemptPublication — Wallidrixe regression", () => {
  const model = createDefaultModelV4();
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

  it("rejects candidate that loses Survival and keeps published snapshot", async () => {
    const published = snapshot();
    const candidate = snapshot({
      dimensions: [dim("PERFORMANCE", 80), dim("SURVIVAL", 0), dim("EXPERIENCE", 70)],
      grade: "U",
      confidence: 0.3,
      modelCoverageRatio: 0.65,
    });
    candidate.dimensions[1]!.score = null;
    candidate.dimensions[1]!.confidence = 0;
    candidate.dimensions[1]!.state = "UNAVAILABLE";

    const scoreRepository = mockScoreRepo({
      getPublishedSnapshot: vi.fn().mockResolvedValue({
        id: "published-1",
        characterId: "char-1",
        season: { slug: "blizzard-season-13" },
        scoreModel: { key: model.key, version: model.version },
        scopeType: "CHARACTER",
        scopeKey: null,
        overallScore: 75,
        grade: "B",
        skillScore: 75,
        authenticityScore: 70,
        confidence: 0.75,
        calculatedAt: new Date("2026-07-20T18:00:00.000Z"),
        inputFingerprint: "fp-published",
        explanation: { refreshContractHash: "contract-v1" },
        dimensionScores: published.dimensions.map((d) => ({
          ...d,
          score: d.score,
        })),
      }),
      publishOrRejectCandidate: vi.fn().mockResolvedValue({
        published: false,
        snapshot: { id: "rejected-1" },
        rejectionReason: "DIMENSION_REGRESSION",
      }),
    });

    const metricRepository = mockMetricRepo();

    const result = await attemptPublication({
      characterId: "char-1",
      seasonId: "season-1",
      scoreModelId: "model-1",
      model,
      candidate,
      incomingObservations: [],
      persistedObservations: [survivalObs],
      failedDimensions: new Set(["SURVIVAL"]),
      refreshedMetricKeys: new Set(),
      refreshContractHash: "contract-v1",
      providerDataAsOf: new Date(),
      scoreRepository,
      metricRepository,
    });

    expect(result.published).toBe(false);
    expect(result.coherence.ok).toBe(false);
    expect(result.coherence.regressedDimensions).toContain("SURVIVAL");
    expect(metricRepository.upsertObservations).toHaveBeenCalled();
    expect(result.mergedObservations.some((o) => o.metricKey === "survival.avoidable_damage")).toBe(
      true,
    );
  });

  it("publishes candidate that maintains all dimensions", async () => {
    const candidate = snapshot();
    const scoreRepository = mockScoreRepo();
    const metricRepository = mockMetricRepo();

    const result = await attemptPublication({
      characterId: "char-1",
      seasonId: "season-1",
      scoreModelId: "model-1",
      model,
      candidate,
      incomingObservations: [survivalObs],
      persistedObservations: [],
      failedDimensions: new Set(),
      refreshedMetricKeys: new Set(["survival.avoidable_damage"]),
      refreshContractHash: "contract-v1",
      providerDataAsOf: new Date(),
      scoreRepository,
      metricRepository,
    });

    expect(result.published).toBe(true);
    expect(result.coherence.ok).toBe(true);
  });
});
