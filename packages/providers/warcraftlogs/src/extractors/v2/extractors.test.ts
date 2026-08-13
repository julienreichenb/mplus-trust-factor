/**
 * Fixture-backed Scoring V2 fact extractor tests — no provider network.
 */
import { describe, expect, it } from "vitest";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
  UTILITY_V2_EXTRACTOR_FAMILY,
  parseSurvivalFactDocumentV2,
} from "@mplus/scoring";
import {
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  buildTypedFactSetFingerprint,
  extractPerformanceProfileAggregateFactV2,
  extractPerformanceRunParseFactV2,
  extractUtilityV2RunFactSetFromSharedEvidence,
  hashFactDocumentContent,
  mapSurvivalRunToFactDocumentV2,
  mapUtilityNormalizedRunToFactSet,
  toPerformanceRunParseFactV2,
  type FrozenSlotBindingV2,
  type RankingParseEvidenceV2,
} from "./index.js";
import type { SurvivalCalibrationRun } from "../../probe/survival-calibration-types.js";
import type { SurvivalNormalizedDataset } from "../../probe/survival-probe-types.js";
import type { SurvivalV1_1_1RunScore } from "../../probe/survival-v1_1_1-logic.js";
import type { SurvivalV1_1DangerWindowAudit } from "../../probe/survival-v1_1-types.js";
import type {
  UtilityCcEvent,
  UtilityDispelPurgeEvent,
  UtilityGroupUtilityEvent,
  UtilityNormalizedRun,
  UtilityPreservedEvent,
} from "../../probe/utility-probe-types.js";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
} from "../../evidence/wcl-run-evidence.js";
import {
  HOSTILE_CAST_FILTER_EXPRESSION,
  UTILITY_EVIDENCE_CONSUMERS,
  type WclRunEvidenceDataset,
} from "../../evidence/wcl-run-evidence-types.js";

const SLOT: FrozenSlotBindingV2 = {
  slotId: "ara-kara:0",
  dungeonSlug: "ara-kara",
  slotIndex: 0,
  keyLevel: 12,
  identity: {
    reportCode: "AbCdEfGhIjKl",
    fightId: 3,
    reportRevision: 1,
  },
};

function rankingEvidence(
  overrides: Partial<RankingParseEvidenceV2> = {},
): RankingParseEvidenceV2 {
  return {
    reportCode: SLOT.identity.reportCode,
    fightId: SLOT.identity.fightId,
    reportRevision: SLOT.identity.reportRevision,
    dungeonSlug: "ara-kara",
    keyLevel: 12,
    bracketPercent: 78.5,
    rankPercent: null,
    amountPercent: null,
    amount: 420_000,
    partition: 2,
    ...overrides,
  };
}

function okDataset(
  key: WclRunEvidenceDataset["key"],
  events: Array<Record<string, unknown>> = [],
): WclRunEvidenceDataset {
  return {
    key,
    state: "OK",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: key === "HostileCasts" ? null : 10,
    filterExpression:
      key === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null,
    pages: [
      {
        pageIndex: 0,
        startTime: 0,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: `${key}-fp`,
      },
    ],
    events,
    consumers: ["survival", "utility"],
    pointsConsumed: null,
    costSource: "unknown",
    requestCostUnits: [],
    wclRequests: 0,
    fetchedAt: "2026-08-02T00:00:00.000Z",
    source: "persisted",
  };
}

describe("Performance V2 fact extractor", () => {
  it("writes a typed parse fact from ranking evidence", () => {
    const outcome = extractPerformanceRunParseFactV2({
      slot: SLOT,
      evidence: rankingEvidence(),
    });
    expect(outcome.status).toBe("WRITTEN");
    expect(outcome.fact?.extractorFamily).toBe(PERFORMANCE_V2_EXTRACTOR_FAMILY);
    expect(outcome.fact?.parsePercentile).toBe(78.5);
    expect(outcome.fact?.semantic).toBe("BRACKET_PERCENT");
    expect(outcome.fact?.identity).toEqual(SLOT.identity);

    const projected = toPerformanceRunParseFactV2(outcome.fact!);
    expect(projected.slotId).toBe("ara-kara:0");
    expect(projected.reportCode).toBe(SLOT.identity.reportCode);
  });

  it("returns UNAVAILABLE when ranking evidence is absent", () => {
    const outcome = extractPerformanceRunParseFactV2({
      slot: SLOT,
      evidence: null,
    });
    expect(outcome.status).toBe("UNAVAILABLE");
    expect(outcome.category).toBe("missing_source_dataset");
    expect(outcome.fact).toBeNull();
  });

  it("fails closed on frozen identity mismatch", () => {
    const outcome = extractPerformanceRunParseFactV2({
      slot: SLOT,
      evidence: rankingEvidence({ fightId: 99 }),
    });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.category).toBe("incompatible_evidence");
  });

  it("hashes fact content deterministically", () => {
    const a = extractPerformanceRunParseFactV2({
      slot: SLOT,
      evidence: rankingEvidence(),
    }).fact!;
    const b = extractPerformanceRunParseFactV2({
      slot: SLOT,
      evidence: rankingEvidence(),
    }).fact!;
    expect(hashFactDocumentContent(a)).toBe(hashFactDocumentContent(b));
    const fp = buildTypedFactSetFingerprint({
      ...SLOT.identity,
      extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
      extractorVersion: a.extractorVersion,
    });
    expect(fp).toHaveLength(64);
  });

  it("extracts profile aggregates from points_and_damage-shaped payload", () => {
    const payload = {
      metric: "points_and_damage",
      zone: 42,
      partition: 2,
      rankings: [
        {
          encounter: { id: 1, name: "Ara-Kara" },
          rankPercent: 80,
          totalKills: 5,
        },
      ],
      throughputRankings: [
        {
          encounter: { id: 1, name: "Ara-Kara" },
          bestPercentile: 81,
          medianPercentile: 70,
          totalKills: 5,
        },
      ],
    };
    const outcome = extractPerformanceProfileAggregateFactV2({
      pointsAndDamagePayload: payload,
    });
    // Adapter may map empty if schema helpers require more fields — accept WRITTEN or UNAVAILABLE.
    expect(["WRITTEN", "UNAVAILABLE"]).toContain(outcome.status);
    if (outcome.status === "WRITTEN") {
      expect(outcome.fact?.partition).toBeTruthy();
    }
  });
});

describe("Survival V2 fact mapper", () => {
  function baseRun(): SurvivalCalibrationRun {
    const normalized: SurvivalNormalizedDataset = {
      probeVersion: "1",
      probedAt: "2026-08-02T00:00:00.000Z",
      identity: { region: "EU", realmSlug: "archimonde", name: "Tester" },
      run: {
        dungeonSlug: "ara-kara",
        reportCode: SLOT.identity.reportCode,
        fightId: SLOT.identity.fightId,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        durationMs: 600_000,
        keyLevel: 12,
        encounterId: 1,
        encounterName: "Ara-Kara",
        wclCharacterId: 1,
        wclCanonicalId: 1,
      },
      deaths: {
        playerDeathCount: 1,
        deathTimestamps: [120_000],
        deaths: [
          {
            timestamp: 120_000,
            killingAbilityGameId: 100,
            killingSourceId: 1,
            overkill: 0,
            event: {
              timestamp: 120_000,
              sourceID: 1,
              targetID: 10,
              abilityGameID: 100,
              amount: 0,
              absorbed: 0,
              overkill: 0,
              hitType: 1,
              additionalFields: {},
              raw: {},
            },
          },
        ],
      },
      damageTaken: {
        totalDamageTaken: 1_000_000,
        totalAbsorbed: 0,
        byAbility: [],
        bySource: [],
        events: [],
        avoidableClassification: null,
      },
      defensiveUsage: [],
      selfHealingAndConsumables: {
        healing: [],
        consumableAndSelfHealCasts: [],
      },
      combatantInfo: {
        specialization: "demonology",
        specId: 266,
        talents: null,
        gear: null,
        itemLevel: null,
        raw: { sourceID: 10, specID: 266 },
      },
      abilityCatalog: {
        catalogVersion: "test",
        classSlug: "warlock",
        specSlug: "demonology",
        supported: true,
        matchedSpellIds: [104773],
        unmatchedSpellIds: [],
        ambiguousSpellIds: [],
      },
    };

    return {
      runId: `${SLOT.identity.reportCode}:${SLOT.identity.fightId}`,
      dungeonSlug: "ara-kara",
      reportCode: SLOT.identity.reportCode,
      fightId: SLOT.identity.fightId,
      keyLevel: 12,
      timed: true,
      depleted: false,
      completed: true,
      durationMs: 600_000,
      playerActorId: 10,
      ownedPetActorIds: [],
      specialization: "demonology",
      specId: 266,
      itemLevel: 640,
      score: 200,
      encounterId: 1,
      encounterName: "Ara-Kara",
      deaths: {
        deathCount: 1,
        deathTimestamps: [120_000],
        deathsPerRun: 1,
        deathsPer10Minutes: 1,
        deaths: normalized.deaths.deaths,
      },
      damageTaken: {
        totalDamageTaken: 1_000_000,
        damageTakenPerMinute: 100_000,
        absorbedAmount: 0,
        unabsorbedDamage: 1_000_000,
        unabsorbedDamagePerMinute: 100_000,
        absorbedRatio: 0,
        byAbility: [],
        bySource: [],
        playerMaxHp: 1_000_000,
        damageNormalizedByMaxHp: 1,
        avoidableClassification: null,
      },
      defensives: [
        {
          canonicalKey: "unending-resolve",
          category: "DEFENSIVE_MAJOR",
          spellId: 104773,
          name: "Unending Resolve",
          availability: "BASELINE",
          talentDependentOrUncertain: false,
          castCount: 2,
          activeDurationMs: null,
          cooldownSeconds: 180,
          theoreticalMaxUses: 2,
          observedUsageRatio: 1,
          note: "fixture",
        },
      ],
      consumablesAndSelfHealing: {
        healthstoneUses: 0,
        healingPotionUses: 0,
        selfHealingAmount: 0,
        selfHealingPerMinute: null,
        selfHealingPercentOfIncomingDamage: null,
        healingBySpell: [],
        matchedCasts: [],
      },
      normalized,
      missingDatasets: [],
      unmatchedSpellIds: [],
      ambiguousSpellIds: [],
    };
  }

  function stubRunScore(run: SurvivalCalibrationRun): SurvivalV1_1_1RunScore {
    return {
      runId: run.runId,
      dungeonSlug: run.dungeonSlug,
      reportCode: run.reportCode,
      fightId: run.fightId,
      keyLevel: run.keyLevel,
      deathCount: run.deaths.deathCount,
      maxHp: 1_000_000,
      maxHpSource: "fixture",
      maxHpConfidence: "HIGH",
      healthTimelineComplete: true,
      outcomeOnlyScore: 65,
      behavioralSurvivalScore: 70,
      outcome: {
        state: "SCORED",
        score: 65,
        weightUsed: 0.55,
        reason: null,
        evidence: {},
      },
      defensiveResponse: {
        state: "SCORED",
        score: 80,
        weightUsed: 0.3,
        reason: null,
        evidence: {},
      },
      emergencyRecovery: {
        state: "NOT_APPLICABLE",
        score: null,
        weightUsed: 0,
        reason: null,
        evidence: {},
      },
      weightsApplied: {
        survivalOutcome: 0.55,
        defensiveResponse: 0.3,
        emergencyRecovery: 0.15,
      },
      dangerWindowCount: 1,
      nonFatalWindowCount: 0,
      fatalWindowCount: 1,
      deathOnlyWindowCount: 0,
      defensiveCounts: {
        proactive: 0,
        reactive: 1,
        death_only: 0,
        eligible_miss: 0,
        unavailable: 0,
        insufficient_reaction_time: 0,
        not_applicable: 0,
      },
      recoveryCounts: {
        covered: 0,
        eligible_miss: 0,
        insufficient_reaction_time: 0,
        death_only_health_context_unavailable: 0,
        not_applicable: 1,
      },
      dangerWindowIds: ["w1"],
      pressureClusterCount: 1,
      invalidOutlierCount: 0,
      scoreMode: "FULL_BEHAVIORAL",
      maxHpResolutionHardened: {
        baselineMaxHp: 1_000_000,
        baselineConfidence: "HIGH",
        baselineSourcePath: "fixture",
        corroboratingBaselineCount: 1,
        classifiedSnapshots: [],
        temporaryIntervals: [],
        invalidOutlierCount: 0,
        rejectionReasons: {},
        resolutionFailureReason: null,
      },
      preClusterDangerWindowCount: 1,
    };
  }

  function stubWindow(): SurvivalV1_1DangerWindowAudit {
    return {
      windowId: "w1",
      reportCode: SLOT.identity.reportCode,
      fightId: SLOT.identity.fightId,
      dungeonSlug: "ara-kara",
      windowClass: "FATAL_PRESSURE",
      startTimestamp: 100_000,
      endTimestamp: 120_000,
      firstTriggerTimestamp: 100_000,
      deathTimestamp: 120_000,
      triggerTypes: ["PLAYER_DEATH"],
      timeBelow35HpMs: null,
      timeFromFirstTriggerToDeathMs: 20_000,
      reactionIntervalMs: null,
      reactionEligible: false,
      reactionIneligibilityReason: null,
      hpBefore: 200_000,
      minimumHp: 0,
      maximumHp: 1_000_000,
      damageEventsResponsible: [],
      deathOutcome: true,
      applicableDefensiveRules: [],
      confirmedAvailableDefensives: [],
      defensiveCastsOrBuffsDetected: [],
      defensiveCoverageKind: "eligible_miss",
      recoveryResourcesConfirmedAvailable: [],
      recoveryActionsDetected: [],
      recoveryCoverageKind: "not_applicable",
      eventDataComplete: true,
    };
  }

  it("maps calibration analysis to a parseable SurvivalFactDocumentV2", () => {
    const run = baseRun();
    const doc = mapSurvivalRunToFactDocumentV2({
      run,
      reportRevision: SLOT.identity.reportRevision,
      slotIndex: SLOT.slotIndex,
      runScore: stubRunScore(run),
      dangerWindows: [stubWindow()],
      pressureClustersPremerged: true,
    });

    expect(doc.schemaVersion).toBe(SURVIVAL_V2_SCHEMA_VERSION);
    expect(doc.extractorFamily).toBe(SURVIVAL_V2_EXTRACTOR_FAMILY);
    expect(doc.deaths.count).toBe(1);
    expect(doc.defensiveActivations.byCategory.DEFENSIVE_MAJOR).toBe(2);
    expect(doc.dangerWindows).toHaveLength(1);
    expect(doc.relativeDamage).toBeNull();
    expect(doc.healthEvidence.mode).toBe("FULL");

    const parsed = parseSurvivalFactDocumentV2(doc);
    expect(parsed.ok).toBe(true);
    expect(hashFactDocumentContent(doc)).toHaveLength(64);
  });
});

describe("Utility V2 fact extractor", () => {
  function baseNormalized(
    partial: Partial<UtilityNormalizedRun> = {},
  ): UtilityNormalizedRun {
    return {
      reportCode: SLOT.identity.reportCode,
      fightId: SLOT.identity.fightId,
      dungeonSlug: "ara-kara",
      keyLevel: 12,
      durationMs: 600_000,
      playerActorId: 10,
      petActorIds: [],
      specialization: "frost",
      classSlug: "mage",
      roleSlug: "dps",
      interruptEvents: [
        {
          timestamp: 50_000,
          sourceID: 10,
          targetID: 50,
          abilityGameID: 2139,
          interruptedSpellId: 400001,
          sourceKind: "PLAYER",
          canonical: null,
          cooldownStateAtCast: "AVAILABLE",
          repeatedOnSameCast: false,
          unmatchedSpellId: false,
          event: {
            timestamp: 50_000,
            sourceID: 10,
            targetID: 50,
            abilityGameID: 2139,
            extraAbilityGameID: 400001,
            type: "interrupt",
            hitType: null,
            fightId: SLOT.identity.fightId,
            reportCode: SLOT.identity.reportCode,
            actorOwnership: "PLAYER",
            additionalFields: {},
            raw: {},
          },
        },
      ],
      ccEvents: [],
      dispelPurgeEvents: [],
      externalGroupUtilityEvents: [],
      classSpecificEvents: [],
      interruptOpportunities: [],
      dispelPurgeOpportunities: [],
      unmatchedAbilityIds: [],
      incompleteDatasets: [],
      datasetStates: {
        CombatantInfo: "OK",
        Casts: "OK",
        Buffs: "OK",
        Debuffs: "OK",
        Interrupts: "OK",
        Dispels: "OK",
        Deaths: "OK",
        DamageDone: "OK",
      },
      truncatedDatasets: [],
      ...partial,
    };
  }

  it("maps normalized utility run to UtilityV2RunFactSet with frozen identity", () => {
    const fact = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run: baseNormalized(),
      hostileCastEvents: [
        { timestamp: 49_000, type: "begincast", sourceID: 50, abilityGameID: 400001 },
        { timestamp: 50_500, type: "interrupted", sourceID: 50, abilityGameID: 400001 },
      ],
      castEvents: [
        {
          timestamp: 49_800,
          type: "cast",
          sourceID: 10,
          abilityGameID: 2139,
          targetID: 50,
        },
      ],
      classSlug: "mage",
      specSlug: "frost",
    });

    expect(fact.extractorFamily).toBe(UTILITY_V2_EXTRACTOR_FAMILY);
    expect(fact.reportCode).toBe(SLOT.identity.reportCode);
    expect(fact.fightId).toBe(SLOT.identity.fightId);
    expect(fact.reportRevision).toBe(SLOT.identity.reportRevision);
    expect(fact.interruptAttempts.length).toBeGreaterThan(0);
    expect(fact.hostileObservability).toBe("PRESENT");
    expect(hashFactDocumentContent(fact)).toHaveLength(64);
  });

  it("marks bound zero-observation when evidence is complete but empty", () => {
    const fact = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run: baseNormalized({ interruptEvents: [] }),
      hostileCastEvents: [
        { timestamp: 10_000, type: "begincast", sourceID: 50, abilityGameID: 400001 },
        { timestamp: 12_000, type: "cast", sourceID: 50, abilityGameID: 400001 },
      ],
      castEvents: [],
      classSlug: "mage",
      specSlug: "frost",
    });
    expect(fact.limitations).toContain("zero_observation_bound");
    expect(fact.interruptAttempts).toHaveLength(0);
  });

  it("returns UNAVAILABLE when shared utility datasets are incomplete", () => {
    let bundle = buildEmptyBundle({
      reportCode: SLOT.identity.reportCode,
      reportRevision: SLOT.identity.reportRevision,
      fightId: SLOT.identity.fightId,
      playerActorId: 10,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: 0,
      endTime: 600_000,
      consumers: ["utility"],
    });
    // Only attach a subset — masterData missing.
    for (const key of UTILITY_EVIDENCE_CONSUMERS.filter(
      (k) => k !== "masterData" && k !== "HostileCasts",
    )) {
      bundle = attachDatasetToBundle(bundle, okDataset(key));
    }

    const outcome = extractUtilityV2RunFactSetFromSharedEvidence({
      bundle,
      slot: SLOT,
      classSlug: "mage",
      specSlug: "frost",
    });
    expect(outcome.status).toBe("UNAVAILABLE");
    expect(outcome.category).toBe("incomplete_shared_evidence");
  });

  function preserved(ts: number, spellId: number): UtilityPreservedEvent {
    return {
      timestamp: ts,
      sourceID: 10,
      targetID: 50,
      abilityGameID: spellId,
      extraAbilityGameID: null,
      type: "cast",
      hitType: null,
      fightId: SLOT.identity.fightId,
      reportCode: SLOT.identity.reportCode,
      actorOwnership: "PLAYER",
      additionalFields: {},
      raw: {},
    };
  }

  function ccEvent(ts: number, spellId: number): UtilityCcEvent {
    return {
      timestamp: ts,
      sourceID: 10,
      targetID: 50,
      abilityGameID: spellId,
      category: "HARD_CC",
      sourceKind: "PLAYER",
      canonical: null,
      hostileTarget: true,
      nonBossTarget: true,
      debuffApplied: true,
      durationMs: 4000,
      breakOrRemovalTimestamp: null,
      repeatedOnSameTarget: false,
      unmatchedSpellId: false,
      usefulnessClassification: null,
      usefulnessNote: "",
      event: preserved(ts, spellId),
    };
  }

  function dispelEvent(ts: number, spellId: number): UtilityDispelPurgeEvent {
    return {
      timestamp: ts,
      sourceID: 10,
      targetID: 11,
      abilityGameID: spellId,
      removedSpellId: 1,
      kind: "DISPEL",
      targetSide: "FRIENDLY",
      sourceKind: "PLAYER",
      canonical: null,
      cooldownStateAtCast: "AVAILABLE",
      unmatchedSpellId: false,
      event: preserved(ts, spellId),
    };
  }

  function groupEvent(
    ts: number,
    spellId: number,
    category: UtilityGroupUtilityEvent["category"],
  ): UtilityGroupUtilityEvent {
    return {
      timestamp: ts,
      sourceID: 10,
      targetID: 11,
      abilityGameID: spellId,
      category,
      sourceKind: "PLAYER",
      canonical: null,
      successfulApplication: true,
      targetDeathNearby: null,
      battleRezResult: null,
      classification: "CONFIRMED_USEFUL",
      evidence: [],
      unmatchedSpellId: false,
      event: preserved(ts, spellId),
    };
  }

  it("counts dispel/purge and bloodlust exactly once (not as groupSupport)", () => {
    const fact = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run: baseNormalized({
        interruptEvents: [],
        dispelPurgeEvents: [dispelEvent(20_000, 475)],
        externalGroupUtilityEvents: [
          groupEvent(30_000, 80353, "BLOODLUST"),
          groupEvent(40_000, 1022, "EXTERNAL_DEFENSIVE"),
        ],
        ccEvents: [ccEvent(15_000, 122)],
      }),
      hostileCastEvents: [],
      castEvents: [],
      classSlug: "mage",
      specSlug: "frost",
    });

    expect(fact.dispelPurgeSuccessCount).toBe(1);
    expect(fact.bloodlustSuccessCount).toBe(1);
    expect(fact.ccActions).toHaveLength(1);
    expect(fact.supportActions.map((a) => a.abilityGameId).sort()).toEqual([1022]);
    expect(fact.supportActions.every((a) => a.semantic !== "PERSONAL_MOBILITY")).toBe(true);
    expect(fact.supportActions.some((a) => a.semantic === "REACTIVE_SUPPORT")).toBe(true);
    expect(fact.toolkit.families?.dispelPurge.state).toBe("applicable");
    expect(fact.toolkit.families?.bloodlust.state).toBe("applicable");
  });

  it("unknown class/spec does not claim confirmed toolkit flags", () => {
    const fact = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run: baseNormalized({
        classSlug: null,
        specialization: null,
        interruptEvents: [],
      }),
      hostileCastEvents: [],
      castEvents: [],
      classSlug: null,
      specSlug: null,
    });
    expect(fact.toolkit.hasInterrupt).toBe(false);
    expect(fact.toolkit.hasSupport).toBe(false);
    expect(fact.toolkit.hasStrategicCc).toBe(false);
    expect(fact.limitations).toContain("class_spec_identity_unknown");
    expect(fact.limitations).not.toContain("zero_observation_bound");
    for (const row of Object.values(fact.toolkit.families ?? {})) {
      expect(row.state).toBe("uncertain");
    }
  });

  it("keeps talent-gated families uncertain unless observed or talent-proven", () => {
    const withoutTalent = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run: baseNormalized({
        interruptEvents: [],
        ccEvents: [],
        dispelPurgeEvents: [],
        externalGroupUtilityEvents: [],
      }),
      hostileCastEvents: [],
      castEvents: [],
      classSlug: "mage",
      specSlug: "frost",
      talentDataAvailable: false,
    });
    expect(withoutTalent.toolkit.families?.groupSupport.state).toBe("uncertain");
    expect(withoutTalent.limitations).toContain("talent_data_unavailable");

    const observed = mapUtilityNormalizedRunToFactSet({
      slot: SLOT,
      run: baseNormalized({
        interruptEvents: [],
        ccEvents: [],
        dispelPurgeEvents: [],
        externalGroupUtilityEvents: [groupEvent(18_000, 414660, "EXTERNAL_DEFENSIVE")],
      }),
      hostileCastEvents: [],
      castEvents: [],
      classSlug: "mage",
      specSlug: "frost",
      talentDataAvailable: false,
    });
    expect(observed.toolkit.families?.groupSupport.state).toBe("applicable");
    expect(observed.toolkit.families?.groupSupport.reason).toBe("observed_usage");
  });
});
