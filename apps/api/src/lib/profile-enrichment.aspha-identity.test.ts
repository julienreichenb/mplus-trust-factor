import { describe, expect, it } from "vitest";
import { buildProfileEnrichments } from "./profile-enrichment.js";
import type { AppEnv } from "@mplus/config";
import type { Character, GameClass, GameSpecialization } from "@mplus/database";
import type { PerformanceSummaryDTO } from "@mplus/contracts";

const env = { PUBLIC_DETAILS_ALL: true } as AppEnv;

describe("Aspha public profile identity vs season Performance summary", () => {
  it("keeps Elemental/DPS on the character while performanceSummary.roleAware is HEALER", () => {
    const character = {
      id: "char-aspha",
      regionId: "reg-1",
      realmId: "realm-1",
      normalizedName: "aspha",
      displayName: "Aspha",
      classId: "class-shaman",
      activeSpecId: "spec-elemental",
      role: "DPS",
      blizzardCharacterId: null,
      raiderioProfileUrl: null,
      lastSeenAt: new Date(),
      lastPublicRefreshAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      gameClass: { id: "class-shaman", slug: "shaman", name: "Shaman" } as GameClass,
      activeSpec: {
        id: "spec-elemental",
        slug: "elemental",
        name: "Elemental",
        role: "DPS",
      } as GameSpecialization,
    } as Character & { gameClass: GameClass; activeSpec: GameSpecialization };

    const performanceSummary: PerformanceSummaryDTO = {
      currentSeason: {
        peakScore: 67,
        consistencyScore: 60,
        score: 67,
        confidence: 1,
        dungeonCount: 8,
        expectedDungeonCount: 8,
        latestObservedAt: null,
        dungeons: [],
      },
      historical: null,
      roleAware: {
        role: "HEALER",
        performanceScore: 67,
        weightsApplied: { damageParse: 0.35, healingParse: 0.65, cooldown: 0 },
        damage: {
          score: 54.5,
          confidence: 1,
          bestAverage: 60,
          medianAverage: 50,
          availableCells: 16,
          expectedCells: 16,
          dungeons: [],
        },
        healing: {
          score: 74.5,
          confidence: 1,
          bestAverage: 80,
          medianAverage: 70,
          availableCells: 16,
          expectedCells: 16,
          dungeons: [],
        },
      },
    };

    const enrichments = buildProfileEnrichments({
      character,
      latestRun: null,
      highestRun: null,
      runCount: 8,
      seasonSlug: "midnight-season-1",
      wclVisibility: "PUBLIC",
      performanceSummary,
      env,
    });

    expect(enrichments.classSlug).toBe("shaman");
    expect(enrichments.specSlug).toBe("elemental");
    expect(enrichments.role).toBe("DPS");
    expect(enrichments.performanceSummary?.roleAware?.role).toBe("HEALER");
    expect(enrichments.performanceSummary?.roleAware?.healing).not.toBeNull();
    expect(enrichments.performanceSummary?.roleAware?.damage).not.toBeNull();
  });
});
