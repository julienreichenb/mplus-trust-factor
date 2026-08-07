import { describe, expect, it, vi } from "vitest";
import { resolveProductScoreDto } from "./product-score-resolve.js";
import type { ScoreSnapshotWithRelations } from "@mplus/worker";

vi.mock("./mappers.js", () => ({
  mapScoreSnapshot: (snapshot: ScoreSnapshotWithRelations) => ({
    characterId: snapshot.characterId,
    seasonSlug: "season",
    modelKey: "published",
    modelVersion: 6,
    scopeType: "CHARACTER" as const,
    scopeKey: null,
    overallScore: Number(snapshot.overallScore),
    grade: snapshot.grade as "U",
    skillScore: 0,
    authenticityScore: 0,
    confidence: Number(snapshot.confidence),
    calculatedAt: snapshot.calculatedAt.toISOString(),
    inputFingerprint: "pub",
    dimensions: (snapshot.dimensionScores ?? []).map((d) => ({
      dimension: d.dimension,
      score: d.score == null ? null : Number(d.score),
      confidence: Number(d.confidence),
      weight: Number(d.weight),
      state: "UNAVAILABLE" as const,
      reason: null,
      contributors: [],
    })),
    redFlags: [],
    explanation: {},
  }),
}));

describe("resolveProductScoreDto", () => {
  it("prefers operational CharacterScore over stale published U", async () => {
    const calculatedAt = new Date("2026-08-07T18:52:58.711Z");
    const prisma = {
      characterScore: {
        findFirst: vi.fn(async () => ({
          id: "cs-1",
          characterId: "char-1",
          seasonId: "season-1",
          scoringVersion: "scoring-v1",
          performance: 83.16,
          utility: 61.75,
          survival: 72.57,
          experience: null,
          composite: 73.68,
          confidence: 0.18,
          tier: "U",
          calculatedAt,
          dimensionDetails: {},
          selectedRuns: [],
          season: { slug: "blizzard-season-17" },
        })),
      },
    };

    const published = {
      characterId: "char-1",
      overallScore: 0,
      grade: "U",
      confidence: 0,
      calculatedAt: new Date("2026-08-07T18:52:30.000Z"),
      dimensionScores: [
        {
          dimension: "PERFORMANCE",
          score: null,
          confidence: 0,
          weight: 0.35,
          contributors: [],
        },
      ],
      season: { slug: "blizzard-season-17" },
      scoreModel: { key: "default", version: 6 },
    } as unknown as ScoreSnapshotWithRelations;

    const resolved = await resolveProductScoreDto({
      prisma: prisma as never,
      characterId: "char-1",
      publishedSnapshot: published,
      modelKey: "default",
      modelVersion: 6,
      dimensionWeights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experience: 0.1,
      },
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });

    expect(resolved.source).toBe("character_score");
    expect(resolved.score?.overallScore).toBeCloseTo(73.68, 2);
    expect(resolved.score?.grade).not.toBe("U");
    expect(resolved.score?.dimensions.find((d) => d.dimension === "EXPERIENCE")?.score).toBeNull();
    expect(resolved.score?.modelKey).toBe("default");
  });

  it("falls back to published snapshot when CharacterScore is absent", async () => {
    const prisma = {
      characterScore: {
        findFirst: vi.fn(async () => null),
      },
    };
    const published = {
      characterId: "char-2",
      overallScore: 50,
      grade: "C",
      confidence: 0.5,
      calculatedAt: new Date("2026-08-01T00:00:00.000Z"),
      dimensionScores: [],
      season: { slug: "blizzard-season-17" },
      scoreModel: { key: "default", version: 6 },
    } as unknown as ScoreSnapshotWithRelations;

    const resolved = await resolveProductScoreDto({
      prisma: prisma as never,
      characterId: "char-2",
      publishedSnapshot: published,
    });

    expect(resolved.source).toBe("published_snapshot");
    expect(resolved.score?.grade).toBe("C");
    expect(resolved.score?.overallScore).toBe(50);
  });
});
