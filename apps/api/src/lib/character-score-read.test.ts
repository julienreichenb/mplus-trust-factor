import { describe, expect, it } from "vitest";
import { mapCharacterScoreToSnapshotDto } from "./character-score-read.js";

describe("mapCharacterScoreToSnapshotDto partial composite", () => {
  const baseRow = {
    id: "score-1",
    characterId: "char-1",
    seasonId: "season-1",
    scoringVersion: "scoring-v1",
    performance: 83.16,
    utility: 61.88,
    survival: 74.27,
    experience: null as number | null,
    composite: null as number | null,
    confidence: null as number | null,
    tier: null as string | null,
    calculatedAt: new Date("2026-01-01T00:00:00.000Z"),
    dimensionDetails: {},
    season: { slug: "season-tww-3" },
  };

  it("P+U+S available, E missing → composite + letter grade (not U)", () => {
    const dto = mapCharacterScoreToSnapshotDto(baseRow, {
      modelKey: "default",
      modelVersion: 6,
      dimensionWeights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experience: 0.1,
      },
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      minConfidenceForGrade: 0.35,
    });

    expect(dto.overallScore).toBeGreaterThan(0);
    expect(dto.grade).not.toBe("U");
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.score).toBeNull();
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.state).toBe("UNAVAILABLE");
    expect(dto.explanation).toMatchObject({
      missingDimensionsExcluded: expect.stringContaining("renormalized"),
    });
  });

  it("prefers persisted composite/tier/confidence", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        composite: 77.5,
        confidence: 0.72,
        tier: "B",
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.overallScore).toBe(77.5);
    expect(dto.grade).toBe("B");
    expect(dto.confidence).toBe(0.72);
  });

  it("does not keep stale tier=U when P/U/S composite is calculable", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        composite: 73.68,
        confidence: 0.18,
        tier: "U",
      },
      {
        modelKey: "default",
        modelVersion: 6,
        dimensionWeights: {
          performance: 0.35,
          survival: 0.3,
          utility: 0.25,
          experience: 0.1,
        },
        gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      },
    );
    expect(dto.overallScore).toBeCloseTo(73.68, 2);
    expect(dto.grade).not.toBe("U");
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.score).toBeNull();
  });

  it("zero available dimensions → U", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        performance: null,
        utility: null,
        survival: null,
        experience: null,
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.grade).toBe("U");
    expect(dto.overallScore).toBe(0);
  });

  it("Experience unavailable is not Experience = 0", () => {
    const unavailable = mapCharacterScoreToSnapshotDto(baseRow, {
      dimensionWeights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experience: 0.1,
      },
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });
    const asZero = mapCharacterScoreToSnapshotDto(
      { ...baseRow, experience: 0 },
      {
        dimensionWeights: {
          performance: 0.35,
          survival: 0.3,
          utility: 0.25,
          experience: 0.1,
        },
        gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      },
    );
    expect(unavailable.overallScore).toBeGreaterThan(asZero.overallScore);
    expect(asZero.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      reason: null,
    });
  });

  it("does not reuse overall confidence for every dimension", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        confidence: 0.26,
        dimensionDetails: {
          performance: { confidence: 0.41, limitations: ["profile_only"] },
          survival: {
            confidence: 0.52,
            explanation: { limitations: ["MAX_HP_CONTEXT_UNAVAILABLE"] },
          },
          utility: {
            confidence: 0.33,
            explanation: { confidenceReasons: ["no_hostile_casts_observed"] },
          },
          experience: {
            score: null,
            available: false,
            reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.confidence).toBe(0.26);
    expect(dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.confidence).toBe(0.41);
    expect(dto.dimensions.find((d) => d.dimension === "SURVIVAL")?.confidence).toBe(0.52);
    expect(dto.dimensions.find((d) => d.dimension === "UTILITY")?.confidence).toBe(0.33);
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: null,
      state: "UNAVAILABLE",
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
    });
    expect(
      (dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
        limitations?: string[];
        negative?: unknown[];
      }).limitations,
    ).toEqual(["profile_only"]);
    expect(
      (dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
        negative?: unknown[];
      }).negative,
    ).toEqual([]);
  });

  it("Experience 0 from dimensionDetails is available when column is set", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        experience: 0,
        dimensionDetails: {
          experience: {
            score: 0,
            available: true,
            reason: null,
            previousStandingScore: 0,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      reason: null,
    });
  });

  it("reads Experience confidence from dimensionDetails (not hard-coded 1)", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        experience: 0,
        confidence: 0.5,
        dimensionDetails: {
          performance: { confidence: 1 },
          survival: { confidence: 1 },
          utility: { confidence: 1 },
          experience: {
            score: 0,
            available: true,
            confidence: 0.87,
            confidenceCauses: ["previous_evidence_unavailable"],
            reason: null,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    const experience = dto.dimensions.find((d) => d.dimension === "EXPERIENCE");
    expect(experience).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      confidence: 0.87,
      reason: null,
    });
    expect(
      (experience?.contributors as { limitations?: string[]; negative?: unknown[] })
        .limitations,
    ).toEqual(["previous_evidence_unavailable"]);
    expect(
      (experience?.contributors as { negative?: unknown[] }).negative,
    ).toEqual([]);
  });
});

describe("mapCharacterScoreToSnapshotDto Score Explainability V1", () => {
  const baseRow = {
    id: "score-1",
    characterId: "char-1",
    seasonId: "season-1",
    scoringVersion: "scoring-v1",
    performance: 71,
    utility: 56,
    survival: 72.5,
    experience: 0 as number | null,
    composite: 68,
    confidence: 0.7,
    tier: "B" as string | null,
    calculatedAt: new Date("2026-01-01T00:00:00.000Z"),
    dimensionDetails: {} as unknown,
    season: { slug: "season-tww-3" },
  };

  it("projects persisted canonical explainability via shared public projector", async () => {
    const { buildScoreExplainabilityV1, projectScoreExplainabilityPublic } =
      await import("@mplus/scoring");

    const canonical = buildScoreExplainabilityV1({
      performance: null,
      survival: null,
      utility: null,
      experience: {
        score: 0,
        available: true,
        previousStandingScore: 0,
        classRankFloor: null,
        classRankFloorApplied: false,
        eliteFloorApplied: false,
        confirmedEliteTitleCount: 0,
        confidence: 1,
        confidenceCauses: [],
        reason: null,
      },
      composite: null,
    });

    // Simulate CharacterScore JSON persistence (serialize → DB → parse).
    const persistedDetails = JSON.parse(
      JSON.stringify({
        explainability: canonical,
        performance: { confidence: 0.72, limitations: ["incomplete_dungeon_coverage"] },
        survival: { confidence: 0.65 },
        utility: { confidence: 0.55 },
        experience: {
          score: 0,
          available: true,
          confidence: 1,
          confidenceCauses: [],
          reason: null,
        },
      }),
    );

    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        performance: null,
        utility: null,
        survival: null,
        experience: 0,
        dimensionDetails: persistedDetails,
      },
      { modelKey: "default", modelVersion: 6 },
    );

    const expected = projectScoreExplainabilityPublic(canonical);
    for (const key of [
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
    ] as const) {
      const dim = dto.dimensions.find((d) => d.dimension === key);
      expect(dim?.explainability).toEqual(expected.dimensions[key]);
    }

    const experience = dto.dimensions.find((d) => d.dimension === "EXPERIENCE");
    expect(experience?.explainability?.scoreDrivers.map((d) => d.code)).toContain(
      "experience.confirmed_no_activity",
    );
    expect(experience?.explainability?.confidenceReasons).toEqual([]);
    expect(
      (experience?.contributors as { negative?: Array<{ metricKey: string }> }).negative?.map(
        (n) => n.metricKey,
      ),
    ).toContain("experience.confirmed_no_activity");
    expect(
      (dto.explanation as { explainabilityFingerprint?: string })
        .explainabilityFingerprint,
    ).toBe(canonical.fingerprint);
  });

  it("soft-fails malformed explainability without breaking profile reads", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        dimensionDetails: {
          explainability: { schemaVersion: "not-a-real-schema", bogus: true },
          performance: { confidence: 0.9, limitations: ["profile_only"] },
          experience: {
            score: 0,
            available: true,
            confidence: 1,
            reason: null,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );

    expect(dto.overallScore).toBe(68);
    expect(dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.score).toBe(71);
    expect(
      dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.explainability,
    ).toBeUndefined();
    expect(
      (
        dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
          negative?: unknown[];
          limitations?: string[];
        }
      ).negative,
    ).toEqual([]);
    expect(
      (
        dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
          limitations?: string[];
        }
      ).limitations,
    ).toEqual(["profile_only"]);
  });

  it("never maps confidence limitations into negative contributors on legacy rows", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        experience: null,
        dimensionDetails: {
          performance: {
            confidence: 0.4,
            limitations: ["incomplete_dungeon_coverage", "incomplete_cooldown_run_coverage"],
          },
          survival: {
            confidence: 0.5,
            explanation: { limitations: ["max_hp_unavailable"] },
          },
          utility: {
            confidence: 0.3,
            explanation: { confidenceReasons: ["tiny_run_sample"] },
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );

    for (const key of ["PERFORMANCE", "SURVIVAL", "UTILITY"] as const) {
      const dim = dto.dimensions.find((d) => d.dimension === key);
      expect(
        (dim?.contributors as { negative?: unknown[] }).negative,
      ).toEqual([]);
      expect(dim?.explainability).toBeUndefined();
    }
  });
});
