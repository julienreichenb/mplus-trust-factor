import { describe, expect, it } from "vitest";
import {
  collectObservedWclSeasonSpecs,
  resolveSeasonScoringIdentity,
  seasonIdentityAllowsDamageWarmHit,
  wclSeasonEvidenceFromPersistedAggregate,
  type SeasonScoringProfileIdentity,
  type WclSeasonPerformanceEvidence,
} from "./season-scoring-identity.js";

const ASHPA_DUNGEONS = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
] as const;

const elementalProfile: SeasonScoringProfileIdentity = {
  classSlug: "shaman",
  specSlug: "elemental",
  role: "DPS",
};

function restorationEvidence(
  dungeonSlugs: readonly string[] = ASHPA_DUNGEONS,
): WclSeasonPerformanceEvidence {
  return {
    specRanks: [{ spec: "Restoration" }],
    dungeonAggregates: dungeonSlugs.map((dungeonSlug) => ({
      dungeonSlug,
      specialization: "Restoration",
    })),
  };
}

describe("resolveSeasonScoringIdentity", () => {
  it("A. Aspha: profile Elemental/DPS, WCL Restoration only → scoring Restoration/HEALER", () => {
    const profile = { ...elementalProfile };
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: profile,
      wclPerformanceEvidence: restorationEvidence(),
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity).toMatchObject({
      classSlug: "shaman",
      specSlug: "restoration",
      role: "HEALER",
      source: "WCL_SEASON",
      observedWclSpecs: ["restoration"],
      limitations: [],
    });
    expect(profile).toEqual(elementalProfile);
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(false);
  });

  it("B. profile Elemental, WCL Elemental only → scoring Elemental/DPS", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Elemental" }],
        dungeonAggregates: ASHPA_DUNGEONS.map((dungeonSlug) => ({
          dungeonSlug,
          specialization: "Elemental",
        })),
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity).toMatchObject({
      classSlug: "shaman",
      specSlug: "elemental",
      role: "DPS",
      source: "WCL_SEASON",
      observedWclSpecs: ["elemental"],
    });
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(true);
  });

  it("C. no usable WCL spec evidence → profile identity fallback", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: null }, { spec: "" }, { spec: "NotASpec" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: null },
          { dungeonSlug: "outside-season", specialization: "Restoration" },
        ],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity).toMatchObject({
      classSlug: "shaman",
      specSlug: "elemental",
      role: "DPS",
      source: "PROFILE",
    });
    expect(identity.limitations).toContain("season_scoring_identity_wcl_spec_absent");
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(true);
  });

  it("D. conflicting Restoration + Elemental → no arbitrary pick, role-ambiguous fail closed", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Restoration" }, { spec: "Elemental" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: "Restoration" },
          { dungeonSlug: "grim-batol", specialization: "Elemental" },
        ],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.source).toBe("WCL_SEASON_ROLE_AMBIGUOUS");
    expect(identity.specSlug).toBeNull();
    expect(identity.role).toBe("UNKNOWN");
    expect(identity.observedWclSpecs).toEqual(["elemental", "restoration"]);
    expect(identity.limitations).toContain("season_scoring_identity_role_ambiguous");
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(false);
  });

  it("E. multiple specs same role → keep role, do not invent a spec", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Elemental" }, { spec: "Enhancement" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: "Elemental" },
          { dungeonSlug: "grim-batol", specialization: "Enhancement" },
        ],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.source).toBe("WCL_SEASON_SPEC_AMBIGUOUS");
    expect(identity.specSlug).toBeNull();
    expect(identity.role).toBe("DPS");
    expect(identity.observedWclSpecs).toEqual(["elemental", "enhancement"]);
    expect(identity.limitations).toContain("season_scoring_identity_spec_ambiguous");
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(false);
  });

  it("F. profile Restoration, WCL Restoration → unchanged healer identity", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: {
        classSlug: "shaman",
        specSlug: "restoration",
        role: "HEALER",
      },
      wclPerformanceEvidence: restorationEvidence(),
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity).toMatchObject({
      classSlug: "shaman",
      specSlug: "restoration",
      role: "HEALER",
      source: "WCL_SEASON",
    });
  });

  it("F. current profile object is not rewritten when scoring identity differs", () => {
    const profile = { ...elementalProfile };
    resolveSeasonScoringIdentity({
      profileIdentity: profile,
      wclPerformanceEvidence: restorationEvidence(),
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(profile.classSlug).toBe("shaman");
    expect(profile.specSlug).toBe("elemental");
    expect(profile.role).toBe("DPS");
  });

  it("ignores dungeon rows outside the active pool", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Restoration" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: "Restoration" },
          { dungeonSlug: "halls-of-origination", specialization: "Elemental" },
        ],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.specSlug).toBe("restoration");
    expect(identity.role).toBe("HEALER");
    expect(identity.observedWclSpecs).toEqual(["restoration"]);
  });

  it("normalizes Beast Mastery via hyphenation against the catalog", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: {
        classSlug: "hunter",
        specSlug: "marksmanship",
        role: "DPS",
      },
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Beast Mastery" }],
        dungeonAggregates: [{ dungeonSlug: "ara-kara", specialization: "Beast Mastery" }],
      },
      activeDungeonSlugs: ["ara-kara"],
    });
    expect(identity.specSlug).toBe("beast-mastery");
    expect(identity.role).toBe("DPS");
    expect(identity.source).toBe("WCL_SEASON");
  });

  it("does not trust a WCL spec that belongs to another class", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Holy" }],
        dungeonAggregates: [{ dungeonSlug: "ara-kara", specialization: "Holy" }],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.source).toBe("PROFILE");
    expect(identity.specSlug).toBe("elemental");
    expect(identity.role).toBe("DPS");
  });

  it("null WCL evidence falls back to profile (DPS/TANK stay available)", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: null,
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.source).toBe("PROFILE");
    expect(identity.role).toBe("DPS");
    expect(identity.specSlug).toBe("elemental");
  });
});

describe("collectObservedWclSeasonSpecs / persisted aggregate evidence", () => {
  it("reads specRanks.spec and active dungeon specialization only", () => {
    const specs = collectObservedWclSeasonSpecs({
      classSlug: "shaman",
      activeDungeonSlugs: ["ara-kara"],
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Restoration" }, { spec: null }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: "Restoration" },
          { dungeonSlug: "grim-batol", specialization: "Elemental" },
        ],
      },
    });
    expect(specs).toEqual(["restoration"]);
  });

  it("maps persisted aggregate observedSpecs + dungeon specialization", () => {
    const evidence = wclSeasonEvidenceFromPersistedAggregate({
      damage: {
        metric: "points_and_damage",
        dungeonAggregates: [
          {
            dungeonSlug: "ara-kara",
            dungeonName: "Ara-Kara",
            encounterId: 1,
            bestParsePercentile: 80,
            medianParsePercentile: 70,
            loggedRunCount: 4,
            specialization: "Restoration",
            keystoneLevel: 12,
            bestDps: 1,
          },
        ],
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        totalLoggedRuns: 4,
        totalMythicPlusScore: 1,
        partition: null,
        zoneId: 47,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        wclBestPerformanceAverage: 80,
        wclMedianPerformanceAverage: 70,
      },
      healing: null,
    });
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: evidence,
      activeDungeonSlugs: ["ara-kara"],
    });
    expect(identity.specSlug).toBe("restoration");
    expect(identity.role).toBe("HEALER");
  });
});
