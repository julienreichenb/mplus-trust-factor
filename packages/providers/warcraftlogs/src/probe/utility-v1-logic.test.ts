import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import {
  auditCatalogSpellOnStream,
  KNOWN_CROSS_STREAM_CC_IN_INTERRUPTS,
} from "./utility-catalog-audit.js";
import { UTILITY_STANDALONE_V1_CONFIG } from "./utility-v1-config.js";
import {
  aggregateUtilityV1Dungeons,
  assessGroupUtilityEligibility,
  diminishingReturnsScore,
  extractConfirmedActions,
  scoreUtilityV1Run,
} from "./utility-v1-logic.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";

function baseRun(overrides: Partial<UtilityNormalizedRun> = {}): UtilityNormalizedRun {
  const datasets = {
    Interrupts: "OK",
    Casts: "OK",
    Buffs: "OK",
    Debuffs: "OK",
    Dispels: "OK",
    DamageDone: "OK",
    Deaths: "OK",
    CombatantInfo: "OK",
  } as UtilityNormalizedRun["datasetStates"];

  return {
    reportCode: "abc123",
    fightId: 1,
    dungeonSlug: "pit-of-saron",
    keyLevel: 12,
    durationMs: 1_800_000,
    playerActorId: 1,
    petActorIds: [2],
    specialization: "demonology",
    classSlug: "warlock",
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: datasets,
    truncatedDatasets: [],
    ...overrides,
  };
}

describe("utility-catalog-audit", () => {
  const catalog = getAbilityCatalog({
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
  });

  it("classifies Banish on Interrupts stream as cross-stream CC match", () => {
    const audit = auditCatalogSpellOnStream(710, "Interrupts", catalog, {
      classSlug: "warlock",
      specSlug: "demonology",
    });
    expect(audit.kind).toBe("CROSS_STREAM_MATCH");
    expect(audit.catalogCategory).toBe("SOFT_CC");
    expect(KNOWN_CROSS_STREAM_CC_IN_INTERRUPTS.has(710)).toBe(true);
  });

  it("classifies Axe Toss alias 347008 as alias match on Interrupts", () => {
    const audit = auditCatalogSpellOnStream(347008, "Interrupts", catalog, {
      classSlug: "warlock",
      specSlug: "demonology",
    });
    expect(audit.kind).toBe("ALIAS_MATCH");
    expect(audit.canonicalKey).toBe("warlock.interrupt.axe-toss");
  });

  it("classifies Singe Magic alias 132411 on Dispels stream", () => {
    const audit = auditCatalogSpellOnStream(132411, "Dispels", catalog, {
      classSlug: "warlock",
      specSlug: "demonology",
    });
    expect(audit.kind).toBe("ALIAS_MATCH");
    expect(audit.canonicalKey).toBe("warlock.dispel.singe-magic");
  });
});

describe("utility-v1-logic", () => {
  const catalog = getAbilityCatalog({
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
  });

  it("scores first interrupt with meaningful credit and caps high volume", () => {
    expect(diminishingReturnsScore(1, UTILITY_STANDALONE_V1_CONFIG.diminishingReturns.interrupts).score).toBe(
      50,
    );
    const at14 = diminishingReturnsScore(
      14,
      UTILITY_STANDALONE_V1_CONFIG.diminishingReturns.interrupts,
    );
    expect(at14.score).toBeGreaterThan(80);
    const atCap = diminishingReturnsScore(
      25,
      UTILITY_STANDALONE_V1_CONFIG.diminishingReturns.interrupts,
    );
    expect(atCap.cappedCount).toBe(18);
    expect(atCap.score).toBe(100);
  });

  it("extracts pet interrupt via alias 347008 and excludes cross-stream CC from interrupts", () => {
    const normalized = baseRun({
      interruptEvents: [
        {
          timestamp: 1000,
          sourceID: 2,
          targetID: 100,
          abilityGameID: 347008,
          interruptedSpellId: 388862,
          sourceKind: "OWNED_PET",
          canonical: null,
          cooldownStateAtCast: "AVAILABLE",
          repeatedOnSameCast: false,
          unmatchedSpellId: false,
          event: {} as never,
        },
        {
          timestamp: 2000,
          sourceID: 1,
          targetID: 100,
          abilityGameID: 710,
          interruptedSpellId: null,
          sourceKind: "PLAYER",
          canonical: null,
          cooldownStateAtCast: "UNKNOWN",
          repeatedOnSameCast: false,
          unmatchedSpellId: false,
          event: {} as never,
        },
      ],
    });
    const actions = extractConfirmedActions({ normalized, catalog });
    expect(actions.filter((a) => a.component === "interrupts")).toHaveLength(1);
    expect(actions[0]?.rawSpellId).toBe(347008);
    expect(actions[0]?.sourceOwnership).toBe("OWNED_PET");
  });

  it("marks ZERO_CONFIRMED_CONTRIBUTION separately from NOT_APPLICABLE for purge on warlock", () => {
    const normalized = baseRun();
    const { runScore } = scoreUtilityV1Run({ normalized, catalog });
    expect(runScore.notApplicableComponents).not.toContain("dispelsPurges");
    expect(runScore.zeroContributionComponents).toContain("dispelsPurges");
    expect(runScore.components.dispelsPurges.state).toBe("ZERO_CONFIRMED_CONTRIBUTION");
    expect(runScore.components.dispelsPurges.score).toBe(0);
  });

  it("marks group utility RAW_USE_ONLY casts as NOT_APPLICABLE, not zero contribution", () => {
    const normalized = baseRun({
      classSpecificEvents: [
        {
          timestamp: 5000,
          sourceID: 1,
          targetID: null,
          abilityGameID: 111771,
          category: "GROUP_UTILITY",
          sourceKind: "PLAYER",
          canonical: null,
          successfulApplication: null,
          targetDeathNearby: null,
          battleRezResult: null,
          classification: "RAW_USE_ONLY",
          evidence: ["cast_observed", "value_not_inferable_from_cast_alone"],
          unmatchedSpellId: false,
          event: {} as never,
        },
      ],
    });
    const eligibility = assessGroupUtilityEligibility({
      normalized,
      catalog,
      scoreableActionCount: 0,
    });
    expect(eligibility.outcome).toBe("NOT_APPLICABLE");
    expect(eligibility.reason).toBe("wcl_cannot_confirm_group_utility_application_or_value");

    const { runScore } = scoreUtilityV1Run({ normalized, catalog });
    expect(runScore.notApplicableComponents).toContain("groupUtility");
    expect(runScore.zeroContributionComponents).not.toContain("groupUtility");
    expect(runScore.components.groupUtility.state).toBe("NOT_APPLICABLE");
    expect(runScore.weightsApplied.groupUtility).toBe(0);
    expect(runScore.weightsApplied.interrupts).toBeCloseTo(0.5, 2);
    expect(runScore.weightsApplied.dispelsPurges).toBeCloseTo(0.2778, 2);
    expect(runScore.weightsApplied.crowdControl).toBeCloseTo(0.2222, 2);
  });

  it("keeps ZERO_CONFIRMED_CONTRIBUTION when group toolkit exists but no casts observed", () => {
    const normalized = baseRun();
    const eligibility = assessGroupUtilityEligibility({
      normalized,
      catalog,
      scoreableActionCount: 0,
    });
    expect(eligibility.outcome).toBe("ZERO_CONFIRMED_CONTRIBUTION");
    const { runScore } = scoreUtilityV1Run({ normalized, catalog });
    expect(runScore.zeroContributionComponents).toContain("groupUtility");
    expect(runScore.notApplicableComponents).not.toContain("groupUtility");
  });

  it("scores POSSIBLY_USEFUL group utility normally", () => {
    const normalized = baseRun({
      classSpecificEvents: [
        {
          timestamp: 5000,
          sourceID: 1,
          targetID: 2,
          abilityGameID: 111771,
          category: "GROUP_UTILITY",
          sourceKind: "PLAYER",
          canonical: null,
          successfulApplication: true,
          targetDeathNearby: null,
          battleRezResult: null,
          classification: "POSSIBLY_USEFUL",
          evidence: ["cast_observed", "buff_or_placeable_application_observed"],
          unmatchedSpellId: false,
          event: {} as never,
        },
      ],
    });
    const actions = extractConfirmedActions({ normalized, catalog });
    expect(actions.filter((a) => a.component === "groupUtility")).toHaveLength(1);
    const { runScore } = scoreUtilityV1Run({ normalized, catalog });
    expect(runScore.components.groupUtility.state).toBe("SCORED");
    expect(runScore.components.groupUtility.score).toBe(70);
  });

  it("redistributes weight proportionally when a component is NOT_APPLICABLE", () => {
    const normalized = baseRun({
      datasetStates: {
        ...baseRun().datasetStates,
        Dispels: "ERROR",
      },
      incompleteDatasets: ["Dispels"],
    });
    const { runScore } = scoreUtilityV1Run({ normalized, catalog });
    expect(runScore.notApplicableComponents).toContain("dispelsPurges");
    expect(runScore.weightsApplied.dispelsPurges).toBe(0);
    expect(runScore.weightsApplied.interrupts).toBeCloseTo(0.6, 2);
    expect(runScore.weightsApplied.crowdControl).toBeCloseTo(0.2667, 2);
    expect(runScore.weightsApplied.groupUtility).toBeCloseTo(0.1333, 2);
  });

  it("equal-weight aggregates dungeon medians without run-count weighting", () => {
    const runs = [
      {
        runId: "a:1",
        reportCode: "a",
        fightId: 1,
        dungeonSlug: "d1",
        keyLevel: 10,
        durationMs: 1,
        specialization: "demonology",
        classSlug: "warlock",
        components: {} as never,
        notApplicableComponents: [],
        zeroContributionComponents: [],
        confirmedEventCounts: {} as never,
        score: 80,
        weightsApplied: {} as never,
        actionIds: [],
      },
      {
        runId: "b:1",
        reportCode: "b",
        fightId: 1,
        dungeonSlug: "d2",
        keyLevel: 10,
        durationMs: 1,
        specialization: "demonology",
        classSlug: "warlock",
        components: {} as never,
        notApplicableComponents: [],
        zeroContributionComponents: [],
        confirmedEventCounts: {} as never,
        score: 40,
        weightsApplied: {} as never,
        actionIds: [],
      },
    ];
    const { global } = aggregateUtilityV1Dungeons(runs, [], ["d1", "d2"]);
    expect(global.score).toBe(60);
  });
});
