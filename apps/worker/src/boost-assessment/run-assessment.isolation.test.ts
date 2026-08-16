import { describe, expect, it, vi } from "vitest";
import { runBoostAssessmentFromPersisted } from "./run-assessment.js";

describe("boost assessment persistence isolation", () => {
  it("16. persisting an assessment does not write CharacterScore / publication fields", async () => {
    const characterScore = {
      update: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(async () => null),
    };
    const scoreSnapshot = { update: vi.fn(), create: vi.fn() };
    const prisma = {
      characterScore,
      scoreSnapshot,
      characterPublishedScore: { update: vi.fn(), upsert: vi.fn() },
      character: {
        findUnique: vi.fn(async () => ({ id: "c1", region: { code: "EU" } })),
      },
      evidenceManifest: { findFirst: vi.fn(async () => null) },
      evidenceManifestSlot: { findMany: vi.fn(async () => []) },
      season: {
        findUnique: vi.fn(async () => ({
          blizzardSeasonId: 13,
          slug: "s1",
          dungeonCount: 8,
          seasonDungeons: [],
        })),
      },
      seasonScoreContextRevision: { findFirst: vi.fn(async () => null) },
      scoreContextRevisionRegionSnapshot: { findUnique: vi.fn(async () => null) },
      runParticipant: { findMany: vi.fn(async () => []) },
      wclRunRaw: { findMany: vi.fn(async () => []) },
      runRankingFact: { findMany: vi.fn(async () => []) },
      wclFightRankingSnapshot: { findFirst: vi.fn(async () => null) },
      characterRunDigest: { findMany: vi.fn(async () => []) },
      characterBoostAssessment: {
        findFirst: vi.fn(async () => null),
        upsert: vi.fn(async () => ({ id: "boost-1" })),
      },
    };

    const out = await runBoostAssessmentFromPersisted({
      prisma: prisma as never,
      characterId: "c1",
      seasonId: "s1",
      persist: true,
      now: new Date("2026-08-15T00:00:00.000Z"),
    });

    expect(out.persistedId).toBe("boost-1");
    expect(characterScore.update).not.toHaveBeenCalled();
    expect(characterScore.upsert).not.toHaveBeenCalled();
    expect(characterScore.create).not.toHaveBeenCalled();
    expect(scoreSnapshot.update).not.toHaveBeenCalled();
    expect(prisma.characterPublishedScore.update).not.toHaveBeenCalled();
    expect(prisma.characterBoostAssessment.upsert).toHaveBeenCalledTimes(1);
  });
});
