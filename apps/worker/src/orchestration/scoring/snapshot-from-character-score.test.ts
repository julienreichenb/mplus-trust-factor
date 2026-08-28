import { describe, expect, it } from "vitest";
import type { ExperiencePhase1Result } from "@mplus/scoring";
import { applyScoreContext, buildScoreExplainabilityV1 } from "@mplus/scoring";
import type { ScoreCharacterResult } from "./score-character.js";
import {
  contributorsFromLimitations,
  scoreCharacterResultToSnapshotDto,
} from "./snapshot-from-character-score.js";

function baseResult(
  overrides?: Partial<ScoreCharacterResult> & {
    experience?: ExperiencePhase1Result | null;
    performanceScore?: number | null;
    performanceConfidence?: number;
    performanceLimitations?: string[];
  },
): ScoreCharacterResult {
  const experience =
    overrides && "experience" in overrides
      ? overrides.experience ?? null
      : null;
  const performanceScore = overrides?.performanceScore ?? 83;
  const performanceConfidence = overrides?.performanceConfidence ?? 0.4;
  const performanceLimitations = overrides?.performanceLimitations ?? [
    "profile_only",
  ];
  const explainability =
    overrides?.explainability ??
    buildScoreExplainabilityV1({
      performance: null,
      survival: null,
      utility: null,
      experience,
      composite: null,
    });

  const result: ScoreCharacterResult = {
    orchestration: {
      selectedSlotCount: 8,
      expectedSlotCount: 16,
      incomplete: true,
      cacheMisses: [],
      fightFailures: [],
      targetDigestFailures: [],
      characterDigests: [],
      accounting: { providerCalls: 0 },
      dimensions: {
        performance: {
          score: performanceScore,
          confidence: performanceConfidence,
          limitations: performanceLimitations,
        } as never,
        utility: {
          score: 62,
          confidence: 0.5,
          explanation: { confidenceReasons: ["tiny_run_sample"] },
        } as never,
        survival: {
          score: 76,
          confidence: 0.55,
          explanation: { limitations: ["MAX_HP_CONTEXT_UNAVAILABLE"] },
        } as never,
        blocked: [],
        performanceDigestDiagnostics: [],
        utilityDigestDiagnostics: [],
        survivalDigestDiagnostics: [],
      },
    } as never,
    characterScoreId: "score-1",
    providerCalls: 0,
    scoringVersion: "test",
    publicationEnabled: false,
    experience,
    explainability,
    appliedContext: applyScoreContext({
      seasonId: "season-1",
      rawScoreBeforeContext: 70,
      canonicalRunSelection: null,
      seasonContextRevision: null,
      seasonScoringSpec: { classSlug: "mage", specSlug: "fire", source: "PROFILE" },
    }),
    performanceAggregate: {
      state: "UNAVAILABLE",
      data: null,
      reason: "test",
      cache: "MISS",
      providerCalls: 0,
      created: false,
      updated: false,
      aggregateRowId: null,
      contentHash: null,
    },
    boostAssessment: null,
    abilityCatalogExecutionPin: {
      kind: "STATIC",
      catalogVersionId: "12.0.0/midnight-season-1",
    },
  };

  if (overrides?.characterScoreId !== undefined) {
    result.characterScoreId = overrides.characterScoreId;
  }
  if (overrides?.providerCalls !== undefined) {
    result.providerCalls = overrides.providerCalls;
  }
  if (overrides?.scoringVersion !== undefined) {
    result.scoringVersion = overrides.scoringVersion;
  }
  if (overrides?.publicationEnabled !== undefined) {
    result.publicationEnabled = overrides.publicationEnabled;
  }
  if (overrides?.orchestration !== undefined) {
    result.orchestration = overrides.orchestration;
  }
  if (overrides?.performanceAggregate !== undefined) {
    result.performanceAggregate = overrides.performanceAggregate;
  }
  return result;
}

describe("scoreCharacterResultToSnapshotDto Experience wiring", () => {
  it("exposes Experience 0 as available 0/100", () => {
    const experience: ExperiencePhase1Result = {
      score: 0,
      available: true,
      previousStandingScore: 0,
      classRankFloor: null,
      classRankFloorApplied: false,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: null,
    };
    const dto = scoreCharacterResultToSnapshotDto({
      result: baseResult({ experience }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });
    const exp = dto.dimensions.find((d) => d.dimension === "EXPERIENCE");
    expect(exp).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      reason: null,
      confidence: 1,
    });
    expect(
      (dto.explanation as { effectiveWeights?: Record<string, number> })
        .effectiveWeights?.experience,
    ).toBeGreaterThan(0);
  });

  it("exposes positive Experience normally", () => {
    const experience: ExperiencePhase1Result = {
      score: 90,
      available: true,
      previousStandingScore: 55,
      classRankFloor: null,
      classRankFloorApplied: false,
      eliteFloorApplied: true,
      confirmedEliteTitleCount: 1,
      reason: null,
    };
    const dto = scoreCharacterResultToSnapshotDto({
      result: baseResult({ experience }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: 90,
      state: "AVAILABLE",
      reason: null,
    });
  });

  it("keeps genuine Experience failure unavailable", () => {
    const experience: ExperiencePhase1Result = {
      score: null,
      available: false,
      previousStandingScore: null,
      classRankFloor: null,
      classRankFloorApplied: false,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
    };
    const dto = scoreCharacterResultToSnapshotDto({
      result: baseResult({ experience }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: null,
      state: "UNAVAILABLE",
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
      confidence: 0,
    });
    expect(dto.reason ?? null).toBeNull();
  });

  it("includes available Experience in the composite", () => {
    const without = scoreCharacterResultToSnapshotDto({
      result: baseResult({
        experience: {
          score: null,
          available: false,
          previousStandingScore: null,
          classRankFloor: null,
          classRankFloorApplied: false,
          eliteFloorApplied: false,
          confirmedEliteTitleCount: 0,
          reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
        },
      }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });
    const withZero = scoreCharacterResultToSnapshotDto({
      result: baseResult({
        experience: {
          score: 0,
          available: true,
          previousStandingScore: 0,
          classRankFloor: null,
          classRankFloorApplied: false,
          eliteFloorApplied: false,
          confirmedEliteTitleCount: 0,
          reason: null,
        },
      }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });
    expect(withZero.overallScore).toBeLessThan(without.overallScore);
  });

  it("prefers persisted CharacterScore experience over in-memory result", () => {
    const dto = scoreCharacterResultToSnapshotDto({
      result: baseResult({
        experience: {
          score: 90,
          available: true,
          previousStandingScore: 90,
          classRankFloor: null,
          classRankFloorApplied: false,
          eliteFloorApplied: false,
          confirmedEliteTitleCount: 0,
          reason: null,
        },
      }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
      persisted: {
        composite: 70,
        confidence: 0.5,
        tier: "B",
        experience: 0,
      },
    });
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.score).toBe(0);
    expect(dto.overallScore).toBe(70);
  });

  it("does not map confidence limitations into negative contributors", () => {
    const dto = scoreCharacterResultToSnapshotDto({
      result: baseResult({
        performanceLimitations: ["profile_only", "phase1_partial"],
      }),
      characterId: "char-1",
      seasonSlug: "season-mn-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-08T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });
    const perf = dto.dimensions.find((d) => d.dimension === "PERFORMANCE");
    const contributors = perf?.contributors as {
      negative?: Array<{ metricKey: string }>;
      limitations?: string[];
    };
    // Confidence/data limitations must never appear as player weaknesses.
    expect(contributors.negative ?? []).toEqual([]);
    expect(perf?.explainability).toBeDefined();
    for (const reason of perf?.explainability?.confidenceReasons ?? []) {
      expect((contributors.negative ?? []).map((n) => n.metricKey)).not.toContain(
        reason.code,
      );
    }
    // Stub orchestration limitations are not projected as scoreDrivers here
    // (canonical explainability was built from null performance in this unit fixture).
    expect(contributors.limitations ?? []).toEqual([]);
    expect(dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.confidence).toBe(0.4);
    expect(dto.dimensions.find((d) => d.dimension === "UTILITY")?.confidence).toBe(0.5);
    expect(dto.dimensions.find((d) => d.dimension === "SURVIVAL")?.confidence).toBe(0.55);
  });

  it("legacy contributorsFromLimitations never fabricates weaknesses", () => {
    const contributors = contributorsFromLimitations([
      "incomplete_dungeon_coverage",
      "profile_only",
    ]) as {
      negative: unknown[];
      limitations: string[];
    };
    expect(contributors.limitations).toEqual([
      "incomplete_dungeon_coverage",
      "profile_only",
    ]);
    expect(contributors.negative).toEqual([]);
  });
});
