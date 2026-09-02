import { describe, expect, it } from "vitest";
import type { ScoreSnapshotWithRelations } from "@mplus/worker";
import { mapScoreSnapshot } from "./mappers.js";

const performanceExplainability = {
  scoreDrivers: [
    {
      code: "performance.damage_parse",
      labelKey: "score.performance.damage_parse",
      label: "Damage parse performance scored 63",
      direction: "POSITIVE" as const,
      value: 63,
      qualitativeLabel: "GOOD" as const,
    },
  ],
  confidenceReasons: [
    {
      code: "cooldown_evidence_partial",
      labelKey: "confidence.performance.cooldown_evidence_partial",
      label: "Offensive cooldown evidence is partial",
    },
  ],
};

function publishedSnapshot(explanation: unknown): ScoreSnapshotWithRelations {
  return {
    id: "snapshot-1",
    characterId: "char-1",
    seasonId: "season-1",
    scoreModelId: "model-1",
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: 69.6,
    grade: "B",
    skillScore: 69.6,
    authenticityScore: 100,
    confidence: 0.8,
    calculatedAt: new Date("2026-09-02T16:21:49.000Z"),
    inputFingerprint: "fp",
    explanation,
    dimensionScores: [
      {
        id: "dimension-1",
        scoreSnapshotId: "snapshot-1",
        dimension: "PERFORMANCE",
        score: 63,
        confidence: 0.8,
        weight: 0.35,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          limitations: [],
          missing: [],
          positive: [
            {
              metricKey: "performance.damage_parse",
              label: "Damage parse performance scored 63",
            },
          ],
          negative: [],
        },
      },
    ],
    scoreModel: {
      id: "model-1",
      key: "default",
      version: 6,
    },
    season: {
      id: "season-1",
      slug: "blizzard-season-18",
    },
  } as unknown as ScoreSnapshotWithRelations;
}

describe("mapScoreSnapshot published explainability", () => {
  it("restores per-dimension explainability persisted in snapshot explanation", () => {
    const dto = mapScoreSnapshot(
      publishedSnapshot({
        publicScoreExplainability: {
          PERFORMANCE: performanceExplainability,
        },
      }),
    );

    expect(dto.dimensions[0]?.explainability).toEqual(performanceExplainability);
  });

  it("soft-fails malformed persisted explainability without breaking the profile", () => {
    const dto = mapScoreSnapshot(
      publishedSnapshot({
        publicScoreExplainability: {
          PERFORMANCE: { scoreDrivers: "invalid" },
        },
      }),
    );

    expect(dto.dimensions[0]?.score).toBe(63);
    expect(dto.dimensions[0]?.explainability).toBeUndefined();
  });
});
