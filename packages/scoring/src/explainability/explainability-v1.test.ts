import { describe, expect, it } from "vitest";
import {
  SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION,
  scoreExplainabilityV1Schema,
} from "@mplus/contracts";
import { buildDimensionConfidenceBreakdown } from "../confidence/dimension-confidence.js";
import type { PartialCompositeResult } from "../composite/partial-composite.js";
import {
  EXPERIENCE_PHASE1_ELITE_FLOOR,
  type ExperiencePhase1Result,
} from "../experience/phase1/calculate.js";
import type { PerformancePhase2ComputeResult } from "../performance/phase2/types.js";
import type { SurvivalV2ComputeResult } from "../survival/v2/types.js";
import type { UtilityV2ComputeResult, UtilityV2DomainBreakdown } from "../utility/v2/types.js";
import {
  buildScoreExplainabilityV1,
  fingerprintScoreExplainability,
  projectScoreExplainabilityPublic,
  SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION,
} from "./index.js";

function emptyComposite(
  overrides: Partial<PartialCompositeResult> = {},
): PartialCompositeResult {
  return {
    composite: 70,
    effectiveWeights: { performance: 0.4, survival: 0.3, utility: 0.2, experience: 0.1 },
    availabilityCoverage: 1,
    availableCount: 4,
    confidence: 0.8,
    grade: "B",
    explanation: {
      unavailableKeys: [],
      renormalized: false,
      availabilityCoverage: 1,
      evidenceConfidence: 0.8,
      weakestDimensionKey: "utility",
      formulaVersion: "partial-composite-weakest-link-v1",
      causes: [],
    },
    ...overrides,
  };
}

function performanceFixture(
  overrides: Partial<PerformancePhase2ComputeResult> = {},
): PerformancePhase2ComputeResult {
  const confidenceBreakdown = buildDimensionConfidenceBreakdown({
    value: 0.72,
    causes: ["incomplete_cooldown_run_coverage", "incomplete_dungeon_coverage"],
    components: {
      phase1Confidence: 0.8,
      cooldownEvidenceConfidence: 0.4,
      phase1Weight: 0.8,
      cooldownWeight: 0.2,
      cooldownRunCoverage: 0.4,
    },
  });
  return {
    state: "AVAILABLE",
    score: 71,
    confidence: 0.72,
    confidenceBreakdown,
    phase1Score: 80,
    offensiveCooldownDiscipline: 35,
    weightsApplied: { phase1: 0.8, cooldown: 0.2 },
    phase1: {} as PerformancePhase2ComputeResult["phase1"],
    cooldown: {
      score: 35,
      selectedRunCount: 10,
      cooldownUsableRunCount: 4,
      evaluatedAbilityCount: 3,
      catalogueIncompatibleRuns: [],
      runsWithoutValidDuration: [],
    } as PerformancePhase2ComputeResult["cooldown"],
    detailedRuns: [],
    dungeonScores: [],
    profileSummary: null,
    coverage: {
      activeDungeonCount: 8,
      detailedDungeonCount: 6,
      selectedRunCount: 10,
      profileDungeonCount: 8,
      cooldownUsableRunCount: 4,
      evaluatedAbilityCount: 3,
    },
    limitations: ["incomplete_cooldown_run_coverage"],
    calculatorVersion: "performance-phase2-test",
    algorithmVersion: "performance-phase2-test",
    modelLabel: "performance-phase2-test",
    inputFingerprint: "perf-fp",
    explanation: {} as PerformancePhase2ComputeResult["explanation"],
    metrics: {},
    contributors: [],
    ...overrides,
  };
}

function survivalFixture(
  overrides: Partial<SurvivalV2ComputeResult> = {},
): SurvivalV2ComputeResult {
  const confidenceBreakdown = buildDimensionConfidenceBreakdown({
    value: 0.65,
    causes: ["max_hp_unavailable", "incomplete_dungeon_coverage"],
    components: {
      dungeonCoverage: 0.75,
      slotFill: 0.8,
      healthFactor: 0.55,
      catalogFactor: 0.9,
    },
  });
  return {
    algorithmVersion: "survival-v2-test",
    modelLabel: "survival-v2-test",
    calibrationStatus: "CANDIDATE_DEFAULTS_UNCALIBRATED",
    modelConfigFingerprint: "surv-cfg",
    inputFingerprint: "surv-fp",
    score: 62,
    confidence: 0.65,
    confidenceBreakdown,
    state: "PARTIAL",
    dungeons: [],
    components: {
      outcome: 100,
      defensive: 35,
      recovery: 55,
      relativeDamage: 40,
    },
    observations: {
      "survival.outcome": 100,
      "survival.defensive_response": 35,
      "survival.emergency_recovery": 55,
      "survival.relative_avoidable_damage": null,
    },
    relativeDamageMode: "shadow",
    relativeDamagePublicContribution: null,
    explanation: {
      selectedSlotCount: 12,
      expectedSlotCount: 16,
      scoredRunCount: 12,
      pressureClusterCount: 4,
      deathCount: 2,
      healthModes: { FULL: 4, MISSING: 2 },
      notes: [],
      limitations: ["max_hp_unavailable"],
      contributors: [],
      perDungeon: [],
    },
    metrics: {},
    ...overrides,
  };
}

function utilityDomain(
  partial: Partial<UtilityV2DomainBreakdown> & Pick<UtilityV2DomainBreakdown, "domain">,
): UtilityV2DomainBreakdown {
  return {
    applicable: true,
    rawScore: 70,
    weight: 0.4,
    weightShare: 0.4,
    uncappedContribution: 8,
    cappedContribution: 8,
    capApplied: false,
    events: 10,
    creditedEvents: 8,
    perCombatHour: 2,
    notes: [],
    ...partial,
  };
}

function utilityFixture(
  overrides: Partial<UtilityV2ComputeResult> = {},
): UtilityV2ComputeResult {
  const confidenceBreakdown = buildDimensionConfidenceBreakdown({
    value: 0.55,
    causes: ["tiny_run_sample", "partial_dungeon_coverage"],
    components: {
      dungeonCoverage: 0.5,
      runCoverage: 0.3,
      combatDuration: 0.4,
      attributableEvents: 0.6,
      mechanicCatalogCoverageObserved: 0.9,
      sourceCompleteness: 0.7,
    },
  });
  return {
    mode: "OBSERVED_CONTRIBUTION",
    phase: 1,
    opportunityMode: "off",
    algorithmVersion: "utility-v2-test",
    scoreSemantics: "floor-plus-observed",
    modelConfigFingerprint: "util-cfg",
    availabilityState: "PARTIAL",
    score: 58,
    rawBehaviorEstimate: 66,
    confidence: 0.55,
    confidenceComponents: confidenceBreakdown.components,
    confidenceBreakdown,
    reliability: 0.6,
    inputFingerprint: "util-fp",
    domainBreakdown: [
      utilityDomain({
        domain: "castStops",
        cappedContribution: 10,
        rawScore: 75,
        weightShare: 0.5,
      }),
      utilityDomain({
        domain: "support",
        applicable: false,
        rawScore: null,
        cappedContribution: 0,
        weightShare: 0,
        notes: ["toolkit_interrupt_absent_domain_neutral"],
      }),
      utilityDomain({
        domain: "strategicCc",
        cappedContribution: 0,
        rawScore: 50,
        weightShare: 0.5,
        events: 0,
        creditedEvents: 0,
        notes: ["zero_observed_cc_casts_remain_neutral"],
      }),
    ],
    interruptCounts: {
      CONFIRMED_SUCCESS: 0,
      VALID_OVERLAP: 0,
      MATCHED_FAILED: 0,
      UNMATCHED_ATTEMPT: 0,
      NOT_OBSERVABLE: 0,
      creditedTotal: 0,
      unmatchedCreditBeforeCap: 0,
      unmatchedCreditAfterCap: 0,
      unmatchedCapApplied: false,
    },
    support: {
      rawCredit: 0,
      diminishedCredit: 0,
      bySemantic: {
        REACTIVE_SUPPORT: 0,
        STRATEGIC_SUPPORT: 0,
        EMERGENCY_SUPPORT: 0,
        ROUTINE_ROTATIONAL_SUPPORT: 0,
        PASSIVE_SUPPORT: 0,
        PERSONAL_MOBILITY: 0,
        UNVERIFIED_EXTERNAL: 0,
      },
      passiveOrRotationalIgnored: 0,
    },
    strategicCc: { rawActions: 0, dedupedActions: 0 },
    context: {
      runCount: 2,
      dungeonCount: 2,
      dungeons: ["ara-kara", "dawnbreaker"],
      combatHours: 0.5,
      fightDurationHours: 0.6,
      hostileBegincastCount: 10,
      attributableEvents: 8,
      selectedSlotCount: 4,
      boundSelectedSlotCount: 4,
      expectedSlotCount: 16,
      toolkit: {
        hasInterrupt: true,
        hasSupport: false,
        hasStrategicCc: true,
      },
      catalogCoverage: {
        abilityCatalogCoverage: 1,
        mechanicCatalogCoverage: 0.9,
      },
    },
    explanation: {
      mode: "OBSERVED_CONTRIBUTION",
      publicationBlocked: true,
      availabilityState: "PARTIAL",
      scoreFloor: 50,
      domainWeights: { castStops: 0.45, support: 0.35, strategicCc: 0.2 },
      interruptClassification: {
        CONFIRMED_SUCCESS: 0,
        VALID_OVERLAP: 0,
        MATCHED_FAILED: 0,
        UNMATCHED_ATTEMPT: 0,
        NOT_OBSERVABLE: 0,
        creditedTotal: 0,
        unmatchedCreditBeforeCap: 0,
        unmatchedCreditAfterCap: 0,
        unmatchedCapApplied: false,
      },
      domainCurves: {
        castStops: "credited_attempts_per_active_combat_hour",
        support: "diminished_semantic_credit_per_active_combat_hour",
        strategicCc: "deduped_cc_per_active_combat_hour",
      },
      caps: {
        domainContributionCap: 25,
        unmatchedCreditShareCap: 0.35,
        unmatchedOnlyMaxDomainScore: 65,
      },
      applicableDomains: ["castStops", "strategicCc"],
      excludedDomains: [{ domain: "support", reason: "not_applicable" }],
      notes: [],
      selectedRuns: [
        {
          slotId: "slot-1",
          runId: "run-1",
          dungeonSlug: "ara-kara",
          slotIndex: 0,
          reportCode: "AbCdEfGhIjKl12Op",
          fightId: 3,
          reportRevision: 1,
        },
      ],
      confidenceReasons: ["tiny_run_sample", "partial_dungeon_coverage"],
      bindingReasons: [],
    },
    metrics: {},
    ...overrides,
  };
}

function experienceFixture(
  overrides: Partial<ExperiencePhase1Result> = {},
): ExperiencePhase1Result {
  return {
    score: 85,
    available: true,
    confidence: 1,
    confidenceCauses: [],
    previousStandingScore: 85,
    classRankFloor: 80,
    classRankFloorApplied: false,
    eliteFloorApplied: false,
    confirmedEliteTitleCount: 0,
    reason: null,
    ...overrides,
  };
}

describe("Score Explainability V1", () => {
  it("builds a valid canonical object with stable fingerprint", () => {
    const built = buildScoreExplainabilityV1({
      performance: performanceFixture(),
      survival: survivalFixture(),
      utility: utilityFixture(),
      experience: experienceFixture(),
      composite: emptyComposite(),
    });

    expect(built.schemaVersion).toBe(SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION);
    expect(built.labelCatalogVersion).toBe(SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION);
    expect(scoreExplainabilityV1Schema.safeParse(built).success).toBe(true);

    const again = buildScoreExplainabilityV1({
      performance: performanceFixture(),
      survival: survivalFixture(),
      utility: utilityFixture(),
      experience: experienceFixture(),
      composite: emptyComposite(),
    });
    expect(again.fingerprint).toBe(built.fingerprint);
    expect(fingerprintScoreExplainability(built)).toBe(built.fingerprint);
  });

  describe("Performance", () => {
    it("marks low cooldown score as a score weakness and coverage as confidence", () => {
      const dim = buildScoreExplainabilityV1({
        performance: performanceFixture(),
        survival: null,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.PERFORMANCE;

      const cooldown = dim.scoreStory.drivers.find(
        (d) => d.code === "performance.offensive_cooldown_discipline",
      );
      const phase1 = dim.scoreStory.drivers.find(
        (d) => d.code === "performance.phase1_score",
      );
      expect(phase1?.direction).toBe("POSITIVE");
      expect(cooldown?.direction).toBe("NEGATIVE");
      expect(cooldown?.value).toBe(35);
      expect(cooldown?.contribution).toBeCloseTo(0.2 * (35 - 50), 6);

      expect(
        dim.confidenceStory.reasons.map((r) => r.code),
      ).toContain("incomplete_cooldown_run_coverage");
      expect(
        dim.scoreStory.drivers.map((d) => d.code),
      ).not.toContain("incomplete_cooldown_run_coverage");
    });

    it("emits no confidence reasons at confidence 1", () => {
      const dim = buildScoreExplainabilityV1({
        performance: performanceFixture({
          confidence: 1,
          confidenceBreakdown: buildDimensionConfidenceBreakdown({
            value: 1,
            causes: ["incomplete_cooldown_run_coverage"],
            components: { phase1Confidence: 1 },
          }),
        }),
        survival: null,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.PERFORMANCE;

      expect(dim.confidenceStory.reasons).toEqual([]);
    });

    it("handles unavailable performance", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.PERFORMANCE;
      expect(dim.availability).toBe("UNAVAILABLE");
      expect(dim.scoreStory.drivers).toEqual([]);
      expect(dim.confidenceStory.reasons[0]?.code).toBe("performance_unavailable");
    });
  });

  describe("Survival", () => {
    it("exposes negative defensive driver and keeps missing HP in confidence", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: survivalFixture(),
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      const defensive = dim.scoreStory.drivers.find(
        (d) => d.code === "survival.defensive_response",
      );
      expect(defensive?.direction).toBe("NEGATIVE");
      expect(
        dim.scoreStory.drivers.map((d) => d.code),
      ).not.toContain("survival.relative_avoidable_damage");
      expect(dim.confidenceStory.reasons.map((r) => r.code)).toContain(
        "max_hp_unavailable",
      );
      expect(
        dim.scoreStory.drivers.some((d) => d.code.includes("max_hp")),
      ).toBe(false);
    });

    it("includes relative damage only when weight-active", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: survivalFixture({
          relativeDamageMode: "active",
          relativeDamagePublicContribution: 40,
          observations: {
            "survival.outcome": 100,
            "survival.defensive_response": 35,
            "survival.emergency_recovery": 55,
            "survival.relative_avoidable_damage": 40,
          },
        }),
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(
        dim.scoreStory.drivers.map((d) => d.code),
      ).toContain("survival.relative_avoidable_damage");
    });
  });

  describe("Utility", () => {
    it("treats positive contribution as strength and non-applicable as omitted", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: utilityFixture(),
        experience: null,
        composite: null,
      }).dimensions.UTILITY;

      const codes = dim.scoreStory.drivers.map((d) => d.code);
      expect(codes).toContain("utility.domain.castStops");
      expect(codes).not.toContain("utility.domain.support");
      expect(
        dim.scoreStory.drivers.find((d) => d.code === "utility.domain.castStops")
          ?.direction,
      ).toBe("POSITIVE");

      const zeroCc = dim.scoreStory.drivers.find(
        (d) => d.code === "utility.domain.strategicCc",
      );
      expect(zeroCc?.direction).toBe("NEUTRAL");
      expect(zeroCc?.params.zeroObservedContribution).toBe(true);

      expect(
        dim.scoreStory.drivers.find(
          (d) => d.code === "utility.reliability_attenuation",
        )?.direction,
      ).toBe("NEUTRAL");

      expect(dim.confidenceStory.reasons.map((r) => r.code)).toEqual([
        "partial_dungeon_coverage",
        "tiny_run_sample",
      ]);
    });

    it("maps mechanic_catalog_below_* dynamic family", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: utilityFixture({
          confidenceBreakdown: buildDimensionConfidenceBreakdown({
            value: 0.4,
            causes: ["mechanic_catalog_below_0.7"],
            components: { mechanicCatalogCoverageObserved: 0.5 },
          }),
        }),
        experience: null,
        composite: null,
      }).dimensions.UTILITY;

      const reason = dim.confidenceStory.reasons[0];
      expect(reason?.code).toBe("mechanic_catalog_below_0.7");
      expect(reason?.params.threshold).toBe(0.7);
      expect(reason?.labelKey).toBe("confidence.utility.mechanic_catalog_below");
    });
  });

  describe("Experience", () => {
    it("marks previous standing as determining when it wins the max", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture(),
        composite: null,
      }).dimensions.EXPERIENCE;

      const previous = dim.scoreStory.drivers.find(
        (d) => d.code === "experience.previous_standing",
      );
      const classRank = dim.scoreStory.drivers.find(
        (d) => d.code === "experience.class_rank_floor",
      );
      expect(previous?.params.determinedFinalScore).toBe(true);
      expect(previous?.direction).toBe("POSITIVE");
      expect(classRank?.params.determinedFinalScore).toBe(false);
      expect(classRank?.direction).toBe("NEUTRAL");
      expect(dim.confidenceStory.value).toBe(1);
      expect(dim.confidenceStory.reasons).toEqual([]);
    });

    it("marks elite floor as determining", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score: EXPERIENCE_PHASE1_ELITE_FLOOR,
          previousStandingScore: 70,
          classRankFloor: null,
          eliteFloorApplied: true,
          confirmedEliteTitleCount: 2,
        }),
        composite: null,
      }).dimensions.EXPERIENCE;

      const elite = dim.scoreStory.drivers.find(
        (d) => d.code === "experience.elite_title_floor",
      );
      expect(elite?.params.determinedFinalScore).toBe(true);
      expect(elite?.value).toBe(EXPERIENCE_PHASE1_ELITE_FLOOR);
    });

    it("marks exact class-rank floor as determining", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score: 94,
          previousStandingScore: 70,
          classRankFloor: 94,
          classRankFloorApplied: true,
          eliteFloorApplied: false,
          confirmedEliteTitleCount: 0,
        }),
        composite: null,
      }).dimensions.EXPERIENCE;

      const classRank = dim.scoreStory.drivers.find(
        (d) => d.code === "experience.class_rank_floor",
      );
      expect(classRank?.params.determinedFinalScore).toBe(true);
      expect(
        dim.scoreStory.drivers.find((d) => d.code === "experience.previous_standing")
          ?.params.determinedFinalScore,
      ).toBe(false);
    });

    it("exposes CONFIRMED_NO_ACTIVITY as score fact with confidence 1", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score: 0,
          previousStandingScore: 0,
          classRankFloor: null,
          classRankFloorApplied: false,
          eliteFloorApplied: false,
          confirmedEliteTitleCount: 0,
          confidence: 1,
          confidenceCauses: [],
        }),
        composite: null,
      }).dimensions.EXPERIENCE;

      expect(dim.scoreStory.drivers[0]?.code).toBe(
        "experience.confirmed_no_activity",
      );
      expect(dim.scoreStory.drivers[0]?.direction).toBe("NEGATIVE");
      expect(dim.confidenceStory.value).toBe(1);
      expect(dim.confidenceStory.reasons).toEqual([]);
    });

    it("keeps provider unavailability out of score weaknesses", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score: null,
          available: false,
          confidence: null,
          confidenceCauses: ["previous_evidence_unavailable"],
          previousStandingScore: null,
          classRankFloor: null,
          reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
        }),
        composite: null,
      }).dimensions.EXPERIENCE;

      expect(dim.availability).toBe("UNAVAILABLE");
      expect(dim.scoreStory.drivers).toEqual([]);
      expect(dim.confidenceStory.reasons.map((r) => r.code)).toEqual([
        "previous_evidence_unavailable",
      ]);
    });
  });

  describe("ordering + public sanitizer", () => {
    it("orders drivers by materiality then code", () => {
      const dim = buildScoreExplainabilityV1({
        performance: performanceFixture(),
        survival: null,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.PERFORMANCE;

      const materialities = dim.scoreStory.drivers.map((d) =>
        Math.abs(d.materiality ?? 0),
      );
      expect(materialities).toEqual([...materialities].sort((a, b) => b - a));
    });

    it("omits privileged evidence and unregistered causes from product projection", () => {
      const built = buildScoreExplainabilityV1({
        performance: performanceFixture({
          confidenceBreakdown: buildDimensionConfidenceBreakdown({
            value: 0.5,
            causes: [
              "incomplete_cooldown_run_coverage",
              "totally_unknown_cause_xyz",
              "role_adapter:UNSUPPORTED_SPEC",
            ],
            components: { phase1Confidence: 0.5 },
          }),
        }),
        survival: null,
        utility: utilityFixture(),
        experience: null,
        composite: emptyComposite(),
      });

      // Audit retains unknown machine code.
      expect(
        built.dimensions.PERFORMANCE.confidenceStory.reasons.map((r) => r.code),
      ).toContain("totally_unknown_cause_xyz");

      const publicView = projectScoreExplainabilityPublic(built);
      const publicCodes =
        publicView.dimensions.PERFORMANCE.confidenceReasons.map((r) => r.code);
      expect(publicCodes).toContain("incomplete_cooldown_run_coverage");
      expect(publicCodes).toContain("role_adapter:UNSUPPORTED_SPEC");
      expect(publicCodes).not.toContain("totally_unknown_cause_xyz");

      const json = JSON.stringify(publicView);
      expect(json).not.toContain("reportCode");
      expect(json).not.toContain("AbCdEfGhIjKl12Op");
      expect(json).not.toContain("fightId");
    });
  });
});
