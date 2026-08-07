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
  });
});
