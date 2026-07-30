import { describe, expect, it, vi } from "vitest";
import { buildAccountCharactersView } from "./account-characters-view.js";

describe("buildAccountCharactersView read-only semantics", () => {
  function buildPrisma(overrides: Record<string, unknown> = {}) {
    const ingestionJobFindFirst = vi.fn(async () => null);
    const seasonFindFirst = vi.fn(async () => ({ id: "season-17", slug: "blizzard-season-17" }));
    const prisma = {
      battleNetAccount: {
        findFirst: vi.fn(async () => ({
          id: "bnet-1",
          lastDiscoveryStatus: "COMPLETED",
          lastDiscoveryJobId: "d1",
          lastDiscoveryStartedAt: null,
          lastDiscoveryFinishedAt: new Date(),
          lastDiscoveryError: null,
        })),
      },
      verifiedCharacterOwnership: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [
          {
            id: "own-1",
            regionId: "region-eu",
            characterId: "char-1",
            characterName: "Main",
            realmSlug: "tarren-mill",
            realmName: "Tarren Mill",
            characterLevel: 90,
            isPrimary: true,
            playableClassId: 8,
            relevancePolicyVersion: "v1",
            relevanceEligible: true,
            relevanceReasons: ["MYTHIC_RATING_THRESHOLD"],
            relevanceEvaluatedAt: new Date(),
            currentSeasonMythicRating: 1500,
            currentSeasonMythicSeasonId: "blizzard-season-17",
            currentSeasonMythicFetchedAt: new Date(),
            currentSeasonMythicSource: "blizzard",
            currentSeasonMythicState: "OK",
            region: { code: "EU" },
            character: {
              gameClass: { slug: "mage" },
              snapshots: [],
              publishedScores: [],
            },
          },
        ]),
      },
      season: { findFirst: seasonFindFirst, update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      scoreModel: {
        findFirst: vi.fn(async () => ({ id: "model-1", version: 6 })),
      },
      ingestionJob: {
        findFirst: ingestionJobFindFirst,
        create: vi.fn(),
        update: vi.fn(),
      },
      ...overrides,
    };
    return { prisma, ingestionJobFindFirst, seasonFindFirst };
  }

  const env = {
    ACTIVE_SCORE_MODEL_KEY: "default",
    ACTIVE_SCORE_MODEL_VERSION: 6,
    SCORE_TTL_SECONDS: 604_800,
    REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
    BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
    WCL_CHARACTER_TTL_SECONDS: 43_200,
    RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
  };

  it("fifty sequential calls create zero jobs, provider calls, season writes, or recalculations", async () => {
    const { prisma, seasonFindFirst } = buildPrisma();
    const providerCalls = { count: 0 };

    for (let i = 0; i < 50; i += 1) {
      await buildAccountCharactersView({
        prisma: prisma as never,
        env: env as never,
        userId: "user-1",
      });
    }

    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
    expect(prisma.ingestionJob.update).not.toHaveBeenCalled();
    expect(prisma.season.update).not.toHaveBeenCalled();
    expect(prisma.season.updateMany).not.toHaveBeenCalled();
    expect(prisma.season.create).not.toHaveBeenCalled();
    expect(seasonFindFirst).toHaveBeenCalled();
    expect(providerCalls.count).toBe(0);
  });

  it("concurrent calls remain side-effect free", async () => {
    const { prisma } = buildPrisma();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        buildAccountCharactersView({
          prisma: prisma as never,
          env: env as never,
          userId: "user-1",
        }),
      ),
    );
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
    expect(prisma.season.create).not.toHaveBeenCalled();
    expect(prisma.season.update).not.toHaveBeenCalled();
    expect(prisma.season.updateMany).not.toHaveBeenCalled();
  });

  it("resolves current season per ownership region (read-only)", async () => {
    const { prisma, seasonFindFirst } = buildPrisma();
    await buildAccountCharactersView({
      prisma: prisma as never,
      env: env as never,
      userId: "user-1",
    });
    expect(seasonFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ regionId: "region-eu", isCurrent: true }),
      }),
    );
  });

  it("keeps published grade B when latest refresh FAILED and sanitizes error", async () => {
    const failedAt = new Date();
    const { prisma } = buildPrisma();
    prisma.verifiedCharacterOwnership.findMany = vi.fn(async () => [
      {
        id: "own-1",
        regionId: "region-eu",
        characterId: "char-1",
        characterName: "Main",
        realmSlug: "tarren-mill",
        realmName: "Tarren Mill",
        characterLevel: 90,
        isPrimary: true,
        playableClassId: 8,
        relevancePolicyVersion: "v1",
        relevanceEligible: true,
        relevanceReasons: ["MYTHIC_RATING_THRESHOLD"],
        relevanceEvaluatedAt: new Date(),
        currentSeasonMythicRating: 1500,
        currentSeasonMythicSeasonId: "blizzard-season-17",
        currentSeasonMythicFetchedAt: new Date(),
        currentSeasonMythicSource: "blizzard",
        currentSeasonMythicState: "OK",
        region: { code: "EU" },
        character: {
          gameClass: { slug: "mage" },
          snapshots: [],
          publishedScores: [
            {
              seasonId: "season-17",
              scoreModelId: "model-1",
              scopeType: "CHARACTER",
              publishedSnapshot: {
                isPublic: true,
                overallScore: 72,
                grade: "B",
                confidence: 0.8,
                calculatedAt: new Date(Date.now() - 2 * 86_400_000),
                coverageState: "COMPLETE",
                rejectionReason: null,
                scoreModel: { version: 6 },
              },
            },
          ],
        },
      },
    ]);
    prisma.ingestionJob.findFirst = vi.fn(async ({ where }: { where?: { status?: { in?: string[] } } }) => {
      if (where?.status?.in) return null;
      return {
        id: "job-fail",
        status: "FAILED",
        completedAt: failedAt,
        scheduledAt: failedAt,
        error: {
          code: "REFRESH_CONTRACT_HASH_MISMATCH",
          message:
            "REFRESH_CONTRACT_HASH_MISMATCH: requested=2e8ff99743bee2aa68d8ab3fb80bf3cf136da5144ba521efeb24a8c01cccd997 computed=bff6e03d2fc5b4bd1f114ca49c872df25eaac33e8cc16c17952e894b9197adbd",
        },
      };
    });

    const view = await buildAccountCharactersView({
      prisma: prisma as never,
      env: env as never,
      userId: "user-1",
    });

    const character = view.characters[0]!;
    expect(character.trustScore.grade).toBe("B");
    expect(character.trustScore.score).toBe(72);
    expect(character.trustScore.status).toBe("STALE");
    expect(character.trustScore.errorMessage).toBe("La dernière actualisation a échoué.");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("REFRESH_CONTRACT_HASH_MISMATCH");
    expect(serialized).not.toContain("2e8ff99743bee2aa68d8ab3fb80bf3cf136da5144ba521efeb24a8c01cccd997");
    expect(serialized).not.toContain("bff6e03d2fc5b4bd1f114ca49c872df25eaac33e8cc16c17952e894b9197adbd");
  });

  it("maps no published score + FAILED refresh to FAILED with generic message only", async () => {
    const { prisma } = buildPrisma();
    prisma.ingestionJob.findFirst = vi.fn(async ({ where }: { where?: { status?: { in?: string[] } } }) => {
      if (where?.status?.in) return null;
      return {
        id: "job-fail",
        status: "FAILED",
        completedAt: new Date(),
        scheduledAt: new Date(),
        error: {
          code: "REFRESH_CONTRACT_HASH_MISMATCH",
          message: "REFRESH_CONTRACT_HASH_MISMATCH: requested=aaa computed=bbb",
        },
      };
    });

    const view = await buildAccountCharactersView({
      prisma: prisma as never,
      env: env as never,
      userId: "user-1",
    });
    const character = view.characters[0]!;
    expect(character.trustScore.grade).toBeNull();
    expect(character.trustScore.status).toBe("FAILED");
    expect(character.trustScore.errorMessage).toBe("Trust Score is temporarily unavailable.");
    expect(JSON.stringify(character)).not.toContain("REFRESH_CONTRACT_HASH_MISMATCH");
  });
});
