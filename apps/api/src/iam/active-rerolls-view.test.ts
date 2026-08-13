import { describe, expect, it, vi } from "vitest";
import { ACTIVE_REROLLS_MAX } from "@mplus/contracts";
import {
  ACTIVE_REROLL_ACCOUNT_FILTER,
  ACTIVE_REROLL_OWNERSHIP_FILTER,
  DISPLAYED_OWNERSHIP_AMBIGUITY_PROBE,
  buildActiveRerollsView,
  resolveAccountPrimaryOwnershipId,
} from "./active-rerolls-view.js";

const FORBIDDEN_KEYS = [
  "ownershipId",
  "battleNetAccountId",
  "providerAccountId",
  "userId",
  "battletag",
  "BattleTag",
  "email",
  "confidence",
  "relevanceEligible",
  "relevanceReasons",
  "relevancePolicyVersion",
  "status",
  "revokedAt",
  "unlinkedAt",
  "accessToken",
  "refreshToken",
  "lastOwnershipSync",
];

const env = {
  ACTIVE_SCORE_MODEL_KEY: "default",
  ACTIVE_SCORE_MODEL_VERSION: 6,
};

const displayedCandidate = {
  id: "own-display",
  battleNetAccountId: "bnet-1",
  characterId: "char-display",
  isPrimary: true,
  verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function ownershipRow(
  overrides: Record<string, unknown> & {
    id: string;
    characterId: string;
    characterName: string;
    realmSlug: string;
  },
) {
  return {
    battleNetAccountId: "bnet-1",
    regionId: "region-eu",
    realmName: overrides.realmSlug,
    playableClassId: 8,
    isPrimary: false,
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    relevanceEligible: true,
    currentSeasonMythicRating: 1000,
    region: { code: "EU" },
    character: {
      id: overrides.characterId,
      gameClass: { slug: "mage" },
      snapshots: [{ rawSummary: { media: { avatarUrl: "https://cdn.example/a.png" } } }],
      publishedScores: [
        {
          seasonId: "season-1",
          scoreModelId: "model-1",
          scopeType: "CHARACTER",
          publishedSnapshot: { isPublic: true, grade: "A" },
        },
      ],
    },
    ...overrides,
  };
}

/** Split displayed-ownership probe (take=2) from same-account roster findMany. */
function ownershipFindMany(probe: unknown[], roster: unknown[]) {
  return vi.fn(async (args: { take?: number }) => {
    if (args.take === DISPLAYED_OWNERSHIP_AMBIGUITY_PROBE) return probe;
    return roster;
  });
}

function effectiveSeasonPrisma(seasonId = "season-1") {
  const season = {
    id: seasonId,
    slug: "blizzard-season-13",
    name: "S13",
    regionId: "region-eu",
    blizzardSeasonId: 13,
    isCurrent: true,
  };
  return {
    runtimeSetting: { findUnique: vi.fn(async () => null) },
    season: {
      findFirst: vi.fn(async () => season),
      findUnique: vi.fn(async () => season),
      findMany: vi.fn(async () => [{ id: seasonId, slug: "blizzard-season-13" }]),
    },
  };
}

describe("resolveAccountPrimaryOwnershipId", () => {
  it("prefers the displayed primary when multiple primaries exist", () => {
    const warn = vi.fn();
    const chosen = resolveAccountPrimaryOwnershipId(
      [
        { id: "own-a", isPrimary: true, verifiedAt: new Date("2026-01-01") },
        { id: "own-b", isPrimary: true, verifiedAt: new Date("2026-06-01") },
      ],
      "own-a",
      { warn } as never,
    );
    expect(chosen).toBe("own-a");
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to most recently verified primary", () => {
    const chosen = resolveAccountPrimaryOwnershipId(
      [
        { id: "own-old", isPrimary: true, verifiedAt: new Date("2025-01-01") },
        { id: "own-new", isPrimary: true, verifiedAt: new Date("2026-06-01") },
      ],
      "own-other",
      null,
    );
    expect(chosen).toBe("own-new");
  });
});

describe("buildActiveRerollsView eligibility", () => {
  it("returns empty when displayed ownership prerequisites are missing", async () => {
    const findMany = ownershipFindMany([], []);
    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: { findMany },
      scoreModel: { findFirst: vi.fn() },
      season: { findMany: vi.fn() },
    };

    const result = await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });
    expect(result).toEqual({ displayedCharacterIsMain: false, rerolls: [] });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(prisma.scoreModel.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when multiple qualifying ownerships own the displayed character", async () => {
    const warn = vi.fn();
    const secretRoster = [
      ownershipRow({
        id: "own-secret-alt",
        characterId: "99999999-9999-4999-8999-999999999999",
        characterName: "SecretAltFromAccountA",
        realmSlug: "kazzak",
        currentSeasonMythicRating: 9999,
      }),
    ];
    const findMany = ownershipFindMany(
      [
        {
          id: "own-a",
          battleNetAccountId: "bnet-a",
          characterId: "char-display",
          isPrimary: true,
          verifiedAt: new Date("2026-06-01"),
        },
        {
          id: "own-b",
          battleNetAccountId: "bnet-b",
          characterId: "char-display",
          isPrimary: false,
          verifiedAt: new Date("2026-01-01"),
        },
      ],
      secretRoster,
    );
    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: { findMany },
      scoreModel: { findFirst: vi.fn() },
      season: { findMany: vi.fn() },
    };

    const result = await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
      logger: { warn } as never,
    });

    expect(result).toEqual({ displayedCharacterIsMain: false, rerolls: [] });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: DISPLAYED_OWNERSHIP_AMBIGUITY_PROBE,
        orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
        where: expect.objectContaining({
          ...ACTIVE_REROLL_OWNERSHIP_FILTER,
          characterId: "char-display",
          battleNetAccount: ACTIVE_REROLL_ACCOUNT_FILTER,
        }),
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "active_rerolls.ambiguous_displayed_ownership" }),
      expect.any(String),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SecretAltFromAccountA");
    expect(serialized).not.toContain("bnet-a");
    expect(serialized).not.toContain("bnet-b");
    expect(prisma.scoreModel.findFirst).not.toHaveBeenCalled();
  });

  it("applies CURRENT/CONFIRMED/claimed/linked filters and relevance policy", async () => {
    const findMany = ownershipFindMany([displayedCandidate], []);
    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: { findMany },
      scoreModel: { findFirst: vi.fn(async () => ({ id: "model-1" })) },
      season: { findMany: vi.fn(async () => []) },
    };

    await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });

    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        take: DISPLAYED_OWNERSHIP_AMBIGUITY_PROBE,
        where: expect.objectContaining({
          ...ACTIVE_REROLL_OWNERSHIP_FILTER,
          characterId: "char-display",
          battleNetAccount: ACTIVE_REROLL_ACCOUNT_FILTER,
        }),
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          battleNetAccountId: "bnet-1",
          ...ACTIVE_REROLL_OWNERSHIP_FILTER,
          battleNetAccount: ACTIVE_REROLL_ACCOUNT_FILTER,
          OR: [{ relevanceEligible: true }, { isPrimary: true }],
        }),
      }),
    );
  });

  it("excludes displayed character, includes relevanceEligible and isPrimary-only rows, sorts deterministically", async () => {
    const roster = [
      ownershipRow({
        id: "own-display",
        characterId: "char-display",
        characterName: "Aleria",
        realmSlug: "tarren-mill",
        isPrimary: true,
        currentSeasonMythicRating: 3000,
      }),
      ownershipRow({
        id: "own-relevant",
        characterId: "char-relevant",
        characterName: "Zulu",
        realmSlug: "kazzak",
        relevanceEligible: true,
        isPrimary: false,
        currentSeasonMythicRating: 2000,
      }),
      ownershipRow({
        id: "own-primary-only",
        characterId: "char-primary-only",
        characterName: "Alpha",
        realmSlug: "archimonde",
        relevanceEligible: false,
        isPrimary: true,
        currentSeasonMythicRating: 2000,
        character: {
          id: "char-primary-only",
          gameClass: { slug: "warrior" },
          snapshots: [],
          publishedScores: [
            {
              seasonId: "season-1",
              scoreModelId: "model-1",
              scopeType: "CHARACTER",
              publishedSnapshot: { isPublic: true, grade: "S" },
            },
          ],
        },
      }),
    ];
    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: {
        findMany: ownershipFindMany([displayedCandidate], roster),
      },
      scoreModel: { findFirst: vi.fn(async () => ({ id: "model-1" })) },
      ...effectiveSeasonPrisma(),
    };

    const result = await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });

    expect(result.displayedCharacterIsMain).toBe(true);
    expect(result.rerolls.map((r) => r.name)).toEqual(["Alpha", "Zulu"]);
    expect(result.rerolls.some((r) => r.name === "Aleria")).toBe(false);
    expect(result.rerolls.find((r) => r.name === "Alpha")?.isMain).toBe(false);
    expect(result.rerolls.every((r) => r.grade === "A" || r.grade === "S")).toBe(true);
    expect(result.rerolls.every((r) => !("rank" in r))).toBe(true);
  });

  it("never exposes forbidden DTO fields", async () => {
    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: {
        findMany: ownershipFindMany(
          [{ ...displayedCandidate, isPrimary: false, battleNetAccountId: "bnet-secret" }],
          [
            ownershipRow({
              id: "own-display",
              characterId: "char-display",
              characterName: "Aleria",
              realmSlug: "tarren-mill",
            }),
            ownershipRow({
              id: "own-alt",
              characterId: "11111111-1111-1111-1111-111111111111",
              characterName: "Alt",
              realmSlug: "silvermoon",
              currentSeasonMythicRating: 2500,
              isPrimary: true,
            }),
          ],
        ),
      },
      scoreModel: { findFirst: vi.fn(async () => ({ id: "model-1" })) },
      ...effectiveSeasonPrisma(),
    };

    const result = await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });

    const serialized = JSON.stringify(result);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialized.toLowerCase()).not.toContain(key.toLowerCase());
    }
    expect(Object.keys(result).sort()).toEqual(["displayedCharacterIsMain", "rerolls"]);
    expect(Object.keys(result.rerolls[0]!).sort()).toEqual(
      [
        "characterId",
        "classColor",
        "className",
        "classSlug",
        "grade",
        "isMain",
        "mythicPlusScore",
        "name",
        "portraitUrl",
        "realmName",
        "realmSlug",
        "region",
      ].sort(),
    );
    expect(result.rerolls[0]?.isMain).toBe(true);
    expect(result.rerolls[0]?.grade).toBe("A");
    expect(ACTIVE_REROLLS_MAX).toBe(24);
  });

  it("resolves effective scoring season once per unique region (no per-reroll season lookup)", async () => {
    const stubs = effectiveSeasonPrisma();
    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: {
        findMany: ownershipFindMany(
          [displayedCandidate],
          [
            ownershipRow({
              id: "own-display",
              characterId: "char-display",
              characterName: "Aleria",
              realmSlug: "tarren-mill",
              isPrimary: true,
            }),
            ownershipRow({
              id: "own-1",
              characterId: "22222222-2222-2222-2222-222222222222",
              characterName: "One",
              realmSlug: "a",
              currentSeasonMythicRating: 1,
            }),
            ownershipRow({
              id: "own-2",
              characterId: "33333333-3333-3333-3333-333333333333",
              characterName: "Two",
              realmSlug: "b",
              currentSeasonMythicRating: 2,
            }),
          ],
        ),
      },
      scoreModel: { findFirst: vi.fn(async () => ({ id: "model-1" })) },
      ...stubs,
    };

    await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });

    expect(stubs.season.findFirst).toHaveBeenCalledTimes(1);
  });

  it("enforces ACTIVE_REROLLS_MAX", async () => {
    const rows = Array.from({ length: ACTIVE_REROLLS_MAX + 5 }, (_, i) =>
      ownershipRow({
        id: `own-${i}`,
        characterId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        characterName: `Char${String(i).padStart(2, "0")}`,
        realmSlug: "realm",
        currentSeasonMythicRating: 1000 + i,
        isPrimary: i === 0,
      }),
    );
    rows[0] = ownershipRow({
      id: "own-display",
      characterId: "char-display",
      characterName: "Aleria",
      realmSlug: "tarren-mill",
      isPrimary: true,
      currentSeasonMythicRating: 9999,
    });

    const prisma = {
      region: { findFirst: vi.fn(async () => ({ id: "region-eu" })) },
      character: { findFirst: vi.fn(async () => ({ id: "char-display" })) },
      verifiedCharacterOwnership: {
        findMany: ownershipFindMany([displayedCandidate], rows),
      },
      scoreModel: { findFirst: vi.fn(async () => ({ id: "model-1" })) },
      ...effectiveSeasonPrisma(),
    };

    const result = await buildActiveRerollsView({
      prisma: prisma as never,
      env: env as never,
      region: "EU",
      realmSlug: "tarren-mill",
      name: "Aleria",
    });
    expect(result.rerolls.length).toBeLessThanOrEqual(ACTIVE_REROLLS_MAX);
  });
});
