import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CHARACTER_BELOW_MAX_LEVEL,
  CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE,
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
  evaluateCharacterRefreshEligibility,
} from "@mplus/config";
import {
  RefreshEligibilityError,
  runRefreshEligibilityGate,
} from "./refresh-eligibility-gate.js";
import type { VerifiedSeasonAuthority } from "./season-authority.js";

const authority: VerifiedSeasonAuthority = {
  regionCode: "EU",
  regionId: "reg-eu",
  seasonRowId: "season-row-1",
  blizzardSeasonId: 13,
  slug: "blizzard-season-13",
  authoritySource: "season_index.current_season",
  authorityVerifiedAt: new Date("2026-07-31T00:00:00.000Z"),
  resolution: "memory",
};

function prismaEligible() {
  return {
    character: {
      findUnique: vi.fn(async () => ({ id: "c1", level: 90, regionId: "reg-eu" })),
    },
    verifiedCharacterOwnership: {
      findFirst: vi.fn(async () => ({
        currentSeasonMythicRating: 1800,
        currentSeasonMythicSeasonId: authority.seasonRowId,
      })),
    },
    metricObservation: { findFirst: vi.fn(async () => null) },
    characterSnapshot: { findMany: vi.fn(async () => []) },
  };
}

describe("refresh eligibility gate", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks level 89 when max is 90 with zero provider calls", async () => {
    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({ id: "c1", level: 89, regionId: "reg-eu" })),
      },
      verifiedCharacterOwnership: {
        findFirst: vi.fn(async () => ({
          currentSeasonMythicRating: 2500,
          currentSeasonMythicSeasonId: authority.seasonRowId,
        })),
      },
      metricObservation: { findFirst: vi.fn() },
      characterSnapshot: { findMany: vi.fn(async () => []) },
    };

    await expect(
      runRefreshEligibilityGate(
        { prisma: prisma as never, logger },
        {
          characterId: "c1",
          authority,
          jobId: "job-1",
          triggerSource: "MANUAL_REFRESH",
        },
      ),
    ).rejects.toMatchObject({ code: CHARACTER_BELOW_MAX_LEVEL, providerCalls: 0 });
  });

  it("accepts level 90 with current-season score > 0", async () => {
    const result = await runRefreshEligibilityGate(
      { prisma: prismaEligible() as never, logger },
      { characterId: "c1", authority, jobId: "job-1" },
    );
    expect(result.eligible).toBe(true);
  });

  it("blocks current-season rating 0", async () => {
    const prisma = prismaEligible();
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async () => ({
      currentSeasonMythicRating: 0,
      currentSeasonMythicSeasonId: authority.seasonRowId,
    }));
    await expect(
      runRefreshEligibilityGate({ prisma: prisma as never, logger }, { characterId: "c1", authority, jobId: "j" }),
    ).rejects.toMatchObject({ code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE });
  });

  it("blocks current-season rating null", async () => {
    const prisma = prismaEligible();
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async () => null);
    prisma.metricObservation.findFirst = vi.fn(async () => null);
    await expect(
      runRefreshEligibilityGate({ prisma: prisma as never, logger }, { characterId: "c1", authority, jobId: "j" }),
    ).rejects.toMatchObject({ code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE });
  });

  it("blocks previous-season rating > 0", async () => {
    const prisma = prismaEligible();
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async () => null); // season filter excludes old
    prisma.metricObservation.findFirst = vi.fn(async () => null);
    prisma.characterSnapshot.findMany = vi.fn(async () => [
      {
        mythicRating: 3000,
        rawSummary: { eligibility: { authoritativeSeasonId: "old-season" } },
      },
    ]);
    await expect(
      runRefreshEligibilityGate({ prisma: prisma as never, logger }, { characterId: "c1", authority, jobId: "j" }),
    ).rejects.toMatchObject({ code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE });
  });

  it("blocks season mismatch on tagged snapshot", async () => {
    const prisma = prismaEligible();
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async () => null);
    prisma.metricObservation.findFirst = vi.fn(async () => null);
    prisma.characterSnapshot.findMany = vi.fn(async () => [
      {
        mythicRating: 2200,
        rawSummary: { eligibility: { authoritativeSeasonId: "other-season" } },
      },
    ]);
    await expect(
      runRefreshEligibilityGate({ prisma: prisma as never, logger }, { characterId: "c1", authority, jobId: "j" }),
    ).rejects.toMatchObject({ code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE });
  });

  it("fails closed when authoritative season is missing", async () => {
    await expect(
      runRefreshEligibilityGate(
        { prisma: prismaEligible() as never, logger },
        { characterId: "c1", authority: null as never, jobId: "j" },
      ),
    ).rejects.toMatchObject({ code: CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN });
  });

  it("fails closed on unscoped snapshot mythicRating", async () => {
    const prisma = prismaEligible();
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async () => null);
    prisma.metricObservation.findFirst = vi.fn(async () => null);
    prisma.characterSnapshot.findMany = vi.fn(async () => [
      { mythicRating: 4000, rawSummary: { note: "no season tag" } },
    ]);
    await expect(
      runRefreshEligibilityGate({ prisma: prisma as never, logger }, { characterId: "c1", authority, jobId: "j" }),
    ).rejects.toMatchObject({ code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE });
  });

  it("fails closed when level is missing — identical for every provider mode", async () => {
    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({ id: "c1", level: null, regionId: "reg-eu" })),
      },
      verifiedCharacterOwnership: { findFirst: vi.fn() },
      metricObservation: { findFirst: vi.fn() },
      characterSnapshot: { findMany: vi.fn(async () => []) },
    };

    for (const mode of ["live", "fixture", "fixture-live", "mock"] as const) {
      await expect(
        runRefreshEligibilityGate(
          { prisma: prisma as never, logger, maxCharacterLevel: 90 },
          { characterId: "c1", authority, jobId: `job-${mode}` },
        ),
      ).rejects.toBeInstanceOf(RefreshEligibilityError);
      await expect(
        runRefreshEligibilityGate(
          { prisma: prisma as never, logger, maxCharacterLevel: 90 },
          { characterId: "c1", authority, jobId: `job-${mode}` },
        ),
      ).rejects.toMatchObject({ code: CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN });
    }
  });

  it("fails closed when ownership rating is scoped to a mismatched season row id", async () => {
    const prisma = {
      character: {
        findUnique: vi.fn(async () => ({ id: "c1", level: 90, regionId: "reg-eu" })),
      },
      verifiedCharacterOwnership: {
        // Gate filters by authority.seasonRowId — slug / old row never matches.
        findFirst: vi.fn(async () => null),
      },
      metricObservation: { findFirst: vi.fn(async () => null) },
      characterSnapshot: { findMany: vi.fn(async () => []) },
    };

    await expect(
      runRefreshEligibilityGate(
        { prisma: prisma as never, logger },
        { characterId: "c1", authority, jobId: "job-mismatch" },
      ),
    ).rejects.toMatchObject({ code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE, providerCalls: 0 });

    expect(prisma.verifiedCharacterOwnership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          currentSeasonMythicSeasonId: authority.seasonRowId,
        }),
      }),
    );
  });

  it("never invokes providers from the eligibility gate", async () => {
    const providerCalls = {
      blizzard: vi.fn(),
      raiderio: vi.fn(),
      warcraftlogs: vi.fn(),
    };
    const prisma = prismaEligible();
    await runRefreshEligibilityGate(
      { prisma: prisma as never, logger },
      { characterId: "c1", authority, jobId: "job-no-provider" },
    );
    expect(providerCalls.blizzard).not.toHaveBeenCalled();
    expect(providerCalls.raiderio).not.toHaveBeenCalled();
    expect(providerCalls.warcraftlogs).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ providerCalls: 0, eligible: true }),
      expect.any(String),
    );
  });

  it("accepts season-tagged snapshot evidence", async () => {
    const prisma = prismaEligible();
    prisma.verifiedCharacterOwnership.findFirst = vi.fn(async () => null);
    prisma.metricObservation.findFirst = vi.fn(async () => null);
    prisma.characterSnapshot.findMany = vi.fn(async () => [
      {
        mythicRating: 1500,
        rawSummary: { eligibility: { authoritativeSeasonId: authority.seasonRowId } },
      },
    ]);
    const result = await runRefreshEligibilityGate(
      { prisma: prisma as never, logger },
      { characterId: "c1", authority, jobId: "j" },
    );
    expect(result.eligible).toBe(true);
  });

  it("maps pure evaluator consistently for admin/bulk/explicit triggers", () => {
    const blocked = evaluateCharacterRefreshEligibility({
      characterLevel: 89,
      currentSeasonMythicScore: 2000,
      authoritativeSeasonKnown: true,
    });
    expect(blocked.code).toBe(CHARACTER_BELOW_MAX_LEVEL);
  });
});
