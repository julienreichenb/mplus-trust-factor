import { describe, expect, it } from "vitest";
import {
  collectActiveDungeonSeasonSpecs,
  collectObservedWclSeasonSpecs,
  collectSpecRankSeasonSpecs,
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

const MYZOUTH_DUNGEONS = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
] as const;

const elementalProfile: SeasonScoringProfileIdentity = {
  classSlug: "shaman",
  specSlug: "elemental",
  role: "DPS",
};

const unholyProfile: SeasonScoringProfileIdentity = {
  classSlug: "death-knight",
  specSlug: "unholy",
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

describe("resolveSeasonScoringIdentity evidence precedence", () => {
  it("A. Aspha: active Restoration only → Restoration/HEALER (ignore nothing conflicting)", () => {
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
      source: "WCL_ACTIVE_DUNGEONS",
      observedWclSpecs: ["restoration"],
      limitations: [],
    });
    expect(profile).toEqual(elementalProfile);
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(false);
  });

  it("B. Myzouth: active Unholy only; global Unholy/Frost/Blood → Unholy/DPS", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: unholyProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Unholy" }, { spec: "Frost" }, { spec: "Blood" }],
        dungeonAggregates: MYZOUTH_DUNGEONS.map((dungeonSlug) => ({
          dungeonSlug,
          specialization: "Unholy",
        })),
      },
      activeDungeonSlugs: MYZOUTH_DUNGEONS,
    });
    expect(identity).toMatchObject({
      classSlug: "death-knight",
      specSlug: "unholy",
      role: "DPS",
      source: "WCL_ACTIVE_DUNGEONS",
      observedWclSpecs: ["unholy"],
      limitations: [],
    });
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(true);
  });

  it("C. active rows Restoration + Elemental → cross-role ambiguous / fail closed", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        // Global ranks must not break or worsen the active-row decision.
        specRanks: [{ spec: "Restoration" }],
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

  it("D. no usable active dungeon spec; global Unholy only → fallback Unholy/DPS", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: unholyProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Unholy" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: null },
          { dungeonSlug: "grim-batol", specialization: "" },
        ],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity).toMatchObject({
      classSlug: "death-knight",
      specSlug: "unholy",
      role: "DPS",
      source: "WCL_SPEC_RANKS",
      observedWclSpecs: ["unholy"],
    });
  });

  it("E. no active spec evidence; global Unholy/Frost/Blood → ambiguity fail closed", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: unholyProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Unholy" }, { spec: "Frost" }, { spec: "Blood" }],
        dungeonAggregates: [{ dungeonSlug: "ara-kara", specialization: null }],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.source).toBe("WCL_SEASON_ROLE_AMBIGUOUS");
    expect(identity.specSlug).toBeNull();
    expect(identity.role).toBe("UNKNOWN");
    expect(identity.observedWclSpecs).toEqual(["blood", "frost", "unholy"]);
  });

  it("F. no usable WCL evidence → existing profile fallback", () => {
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

  it("G. rows outside active dungeon pool must not influence identity", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Elemental" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: "Restoration" },
          { dungeonSlug: "halls-of-origination", specialization: "Elemental" },
        ],
      },
      activeDungeonSlugs: ASHPA_DUNGEONS,
    });
    expect(identity.specSlug).toBe("restoration");
    expect(identity.role).toBe("HEALER");
    expect(identity.source).toBe("WCL_ACTIVE_DUNGEONS");
    expect(identity.observedWclSpecs).toEqual(["restoration"]);
  });

  it("active Elemental only → Elemental/DPS", () => {
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
      source: "WCL_ACTIVE_DUNGEONS",
      observedWclSpecs: ["elemental"],
    });
    expect(seasonIdentityAllowsDamageWarmHit(identity)).toBe(true);
  });

  it("active Elemental + Enhancement → same-role spec ambiguous", () => {
    const identity = resolveSeasonScoringIdentity({
      profileIdentity: elementalProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Elemental" }],
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

  it("profile Restoration + active Restoration → unchanged healer identity", () => {
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
      source: "WCL_ACTIVE_DUNGEONS",
    });
  });

  it("current profile object is not rewritten when scoring identity differs", () => {
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
    expect(identity.source).toBe("WCL_ACTIVE_DUNGEONS");
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

describe("collectObservedWclSeasonSpecs / staged collectors", () => {
  it("active dungeon collector ignores global ranks and out-of-pool rows", () => {
    const specs = collectActiveDungeonSeasonSpecs({
      classSlug: "shaman",
      activeDungeonSlugs: ["ara-kara"],
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Elemental" }],
        dungeonAggregates: [
          { dungeonSlug: "ara-kara", specialization: "Restoration" },
          { dungeonSlug: "grim-batol", specialization: "Elemental" },
        ],
      },
    });
    expect(specs).toEqual(["restoration"]);
  });

  it("diagnostic observed set prefers active dungeons over ranks", () => {
    const specs = collectObservedWclSeasonSpecs({
      classSlug: "death-knight",
      activeDungeonSlugs: MYZOUTH_DUNGEONS,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Unholy" }, { spec: "Frost" }, { spec: "Blood" }],
        dungeonAggregates: MYZOUTH_DUNGEONS.map((dungeonSlug) => ({
          dungeonSlug,
          specialization: "Unholy",
        })),
      },
    });
    expect(specs).toEqual(["unholy"]);
  });

  it("spec-rank collector is used only when active dungeon specs are empty", () => {
    expect(
      collectSpecRankSeasonSpecs({
        classSlug: "death-knight",
        wclPerformanceEvidence: {
          specRanks: [{ spec: "Unholy" }, { spec: "Frost" }, { spec: "Blood" }],
        },
      }),
    ).toEqual(["blood", "frost", "unholy"]);
  });

  it("maps persisted aggregate dungeon specialization without inventing ranks", () => {
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
        observedSpecs: ["Restoration", "Elemental"],
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
    // Active dungeon Restoration wins; persisted observedSpecs Elemental is ignored.
    expect(identity.specSlug).toBe("restoration");
    expect(identity.role).toBe("HEALER");
    expect(identity.source).toBe("WCL_ACTIVE_DUNGEONS");
  });
});
