import { describe, expect, it, vi } from "vitest";
import { CharacterScoreRepository } from "./character-score-repository.js";

describe("CharacterScoreRepository revision authority", () => {
  it("prefers published N+1 over a later-timestamp N row", async () => {
    const nRow = {
      id: "score-n",
      characterId: "char-1",
      seasonId: "season-a",
      scoringVersion: "scoring-v1",
      contextRevisionKey: "rev-n",
      calculatedAt: new Date("2026-08-14T12:00:00.000Z"),
      season: { slug: "s-a" },
    };
    const n1Row = {
      id: "score-n1",
      characterId: "char-1",
      seasonId: "season-a",
      scoringVersion: "scoring-v1",
      contextRevisionKey: "rev-n1",
      calculatedAt: new Date("2026-08-14T11:00:00.000Z"),
      season: { slug: "s-a" },
    };
    const prisma = {
      characterScore: {
        findFirst: vi.fn(async () => nRow),
        findUnique: vi.fn(async () => n1Row),
      },
      seasonScoreContextRevision: {
        findFirst: vi.fn(async () => ({
          id: "rev-n1",
          seasonId: "season-a",
          version: 2,
          status: "PUBLISHED",
          publishedAt: new Date(),
          tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
          specAssignments: [],
          percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
          distributionSnapshot: null,
        })),
      },
    };

    const row = await new CharacterScoreRepository(prisma as never).findAuthoritativeForCharacter(
      "char-1",
    );
    expect(row?.id).toBe("score-n1");
    expect(prisma.characterScore.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          characterId_seasonId_scoringVersion_contextRevisionKey_abilityCatalogExecutionKey:
            expect.objectContaining({
              abilityCatalogExecutionKey: "static",
              contextRevisionKey: "rev-n1",
              seasonId: "season-a",
            }),
        },
      }),
    );
  });

  it("keeps N visible while published N+1 has no CharacterScore yet", async () => {
    const nRow = {
      id: "score-n",
      characterId: "char-1",
      seasonId: "season-a",
      scoringVersion: "scoring-v1",
      contextRevisionKey: "rev-n",
      calculatedAt: new Date("2026-08-14T12:00:00.000Z"),
      season: { slug: "s-a" },
    };
    const prisma = {
      characterScore: {
        findFirst: vi.fn(async () => nRow),
        findUnique: vi.fn(async () => null),
      },
      seasonScoreContextRevision: {
        findFirst: vi.fn(async () => ({
          id: "rev-n1",
          seasonId: "season-a",
          version: 2,
          status: "PUBLISHED",
          publishedAt: new Date(),
          tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
          specAssignments: [],
          percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
          distributionSnapshot: null,
        })),
      },
    };

    const row = await new CharacterScoreRepository(prisma as never).findAuthoritativeForCharacter(
      "char-1",
    );
    expect(row?.id).toBe("score-n");
  });
});
