import { describe, expect, it } from "vitest";
import { calculateScore } from "./index.js";
import type { ScoreModelConfig } from "@mplus/contracts";
import { validateScoreSnapshot } from "@mplus/test-utils";

const defaultModel: ScoreModelConfig = {
  key: "default",
  version: 1,
  weights: {
    performance: 0.32,
    survival: 0.27,
    utility: 0.23,
    experienceConsistency: 0.13,
    mythicRaid: 0.05,
  },
  authenticityBlend: { skillWeight: 0.6, authenticityWeight: 0.4 },
  confidenceNeutralScore: 50,
  gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
};

describe("scoring data-quality invariants", () => {
  it("placeholder output satisfies invariant checks", () => {
    const snapshot = calculateScore({
      characterId: "11111111-1111-1111-1111-111111111111",
      seasonSlug: "season-midnight-s1",
      model: defaultModel,
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [
        {
          metricKey: "performance.spec_percentile",
          dimension: "PERFORMANCE",
          rawValue: 75,
          normalizedValue: 75,
          confidence: 0.8,
          observedAt: "2026-07-20T18:00:00.000Z",
          sourceProvider: "warcraftlogs",
          coverage: { present: 5, expected: 8, ratio: 0.625 },
          context: {},
        },
      ],
      calculatedAt: "2026-07-20T18:00:00.000Z",
      inputFingerprint: "abc123",
    });

    const report = validateScoreSnapshot(snapshot, defaultModel);
    expect(report.ok, JSON.stringify(report.violations)).toBe(true);
    expect(snapshot.overallScore).toBeGreaterThanOrEqual(0);
    expect(snapshot.overallScore).toBeLessThanOrEqual(100);
    expect(snapshot.confidence).toBeGreaterThanOrEqual(0);
    expect(snapshot.confidence).toBeLessThanOrEqual(1);
  });
});
