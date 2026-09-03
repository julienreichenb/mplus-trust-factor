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
import { NATIVE_BAND_STANDING_SCORES } from "../experience/phase1/season-population-policy.js";
import type { PerformancePhase2ComputeResult } from "../performance/phase2/types.js";
import type {
  SurvivalV2ComputeResult,
  SurvivalV2DungeonAggregate,
  SurvivalV2RunScore,
} from "../survival/v2/types.js";
import type { UtilityV2ComputeResult, UtilityV2DomainBreakdown } from "../utility/v2/types.js";
import {
  buildScoreExplainabilityV1,
  fingerprintScoreExplainability,
  projectScoreExplainabilityPublic,
  SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION,
} from "./index.js";

const RECONCILE_EPS = 1e-6;

function sumDriverContributions(
  drivers: Array<{ contribution: number | null }>,
): number {
  return drivers.reduce((s, d) => s + (d.contribution ?? 0), 0);
}

function survivalComponent(
  metricKey: string,
  score: number | null,
  weightUsed: number,
  state: "SCORED" | "NOT_APPLICABLE" = score == null ? "NOT_APPLICABLE" : "SCORED",
): SurvivalV2RunScore["outcome"] {
  return {
    metricKey,
    state,
    score,
    weightUsed,
    reason: state === "NOT_APPLICABLE" ? "unavailable" : null,
    evidence: {},
  };
}

function survivalRun(input: {
  dungeonSlug: string;
  slotIndex: number;
  outcome: number | null;
  defensive: number | null;
  recovery: number | null;
  relativeDamage?: number | null;
  weightsApplied: SurvivalV2RunScore["weightsApplied"];
  valid?: boolean;
}): SurvivalV2RunScore {
  const w = input.weightsApplied;
  const relative = input.relativeDamage ?? null;
  const behavioralScore =
    (input.outcome ?? 0) * w.outcome +
    (input.defensive ?? 0) * w.defensive +
    (input.recovery ?? 0) * w.recovery +
    (relative != null ? relative * w.relativeDamage : 0);
  return {
    dungeonSlug: input.dungeonSlug,
    slotIndex: input.slotIndex,
    identity: {
      reportCode: "TESTCODE000001",
      fightId: input.slotIndex + 1,
      reportRevision: 1,
    },
    keyLevel: 10,
    behavioralScore: input.valid === false ? null : behavioralScore,
    outcome: survivalComponent("survival.outcome", input.outcome, w.outcome),
    defensive: survivalComponent(
      "survival.defensive_response",
      input.defensive,
      w.defensive,
    ),
    recovery: survivalComponent(
      "survival.emergency_recovery",
      input.recovery,
      w.recovery,
    ),
    relativeDamageShadow: {
      mode: w.relativeDamage > 0 ? "active" : "shadow",
      reliability: "RELIABLE",
      score: relative,
      publicContribution: 0,
      reasons: [],
      evidence: {},
    },
    weightsApplied: w,
    healthEvidenceMode: input.defensive == null ? "OUTCOME_ONLY" : "FULL",
    pressureClusterCount: 0,
    deathCount: input.outcome === 100 ? 0 : 1,
    limitations: [],
    valid: input.valid !== false,
    invalidReason: null,
  };
}

function survivalDungeon(
  dungeonSlug: string,
  runs: SurvivalV2RunScore[],
): SurvivalV2DungeonAggregate {
  const valid = runs.filter((r) => r.valid && r.behavioralScore != null);
  const scores = valid.map((r) => r.behavioralScore!);
  const median =
    scores.length === 0
      ? null
      : scores.length === 1
        ? scores[0]!
        : (scores[0]! + scores[1]!) / 2;
  return {
    dungeonSlug,
    runCount: valid.length,
    medianBehavioralScore: median,
    medianOutcome: null,
    medianDefensive: null,
    medianRecovery: null,
    runs,
  };
}

function survivalFromRuns(
  dungeons: SurvivalV2DungeonAggregate[],
  overrides: Partial<SurvivalV2ComputeResult> = {},
): SurvivalV2ComputeResult {
  const withScores = dungeons.filter((d) => d.medianBehavioralScore != null);
  const score =
    withScores.length === 0
      ? null
      : withScores.reduce((s, d) => s + d.medianBehavioralScore!, 0) /
        withScores.length;

  const allValid = dungeons.flatMap((d) =>
    d.runs.filter((r) => r.valid && r.behavioralScore != null),
  );
  const meanOrNull = (pick: (r: SurvivalV2RunScore) => number | null) => {
    const vals = allValid
      .map(pick)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  const relativeMode =
    overrides.relativeDamageMode ??
    (allValid.some((r) => r.weightsApplied.relativeDamage > 0)
      ? "active"
      : "shadow");

  return survivalFixture({
    score,
    state: score == null ? "UNAVAILABLE" : "PARTIAL",
    dungeons,
    components: {
      outcome: meanOrNull((r) => r.outcome.score),
      defensive: meanOrNull((r) => r.defensive.score),
      recovery: meanOrNull((r) => r.recovery.score),
      relativeDamage:
        relativeMode === "active"
          ? meanOrNull((r) =>
              r.weightsApplied.relativeDamage > 0
                ? r.relativeDamageShadow.score
                : null,
            )
          : null,
    },
    relativeDamageMode: relativeMode,
    relativeDamagePublicContribution:
      relativeMode === "active"
        ? meanOrNull((r) =>
            r.weightsApplied.relativeDamage > 0
              ? r.relativeDamageShadow.score
              : null,
          )
        : null,
    ...overrides,
  });
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

  // Default coherent single-run fixture (weights 55/30/15).
  const defaultRun = survivalRun({
    dungeonSlug: "ara-kara",
    slotIndex: 0,
    outcome: 100,
    defensive: 35,
    recovery: 55,
    weightsApplied: {
      outcome: 0.55,
      defensive: 0.3,
      recovery: 0.15,
      relativeDamage: 0,
    },
  });
  const defaultDungeon = survivalDungeon("ara-kara", [defaultRun]);
  const defaultScore = defaultRun.behavioralScore!;

  return {
    algorithmVersion: "survival-v2-test",
    modelLabel: "survival-v2-test",
    calibrationStatus: "CANDIDATE_DEFAULTS_UNCALIBRATED",
    modelConfigFingerprint: "surv-cfg",
    inputFingerprint: "surv-fp",
    score: defaultScore,
    confidence: 0.65,
    confidenceBreakdown,
    state: "PARTIAL",
    dungeons: [defaultDungeon],
    components: {
      outcome: 100,
      defensive: 35,
      recovery: 55,
      relativeDamage: null,
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
    damageParseScore: 80,
    healingParseScore: null,
    offensiveCooldownDiscipline: 35,
    weightsApplied: {
      phase1: 0.8,
      damageParse: 0.8,
      healingParse: 0,
      cooldown: 0.2,
    },
    roleAware: {} as PerformancePhase2ComputeResult["roleAware"],
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
      damageDungeonCount: 8,
      healingDungeonCount: 0,
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
    score: 37.5,
    rawBehaviorEstimate: 37.5,
    confidence: 0.55,
    confidenceComponents: confidenceBreakdown.components,
    confidenceBreakdown,
    reliability: 0.6,
    inputFingerprint: "util-fp",
    domainBreakdown: [
      utilityDomain({
        domain: "interrupt",
        cappedContribution: 37.5,
        rawScore: 75,
        weightShare: 0.5,
        creditedEvents: 8,
      }),
      utilityDomain({
        domain: "groupSupport",
        applicable: false,
        rawScore: null,
        cappedContribution: 0,
        weightShare: 0,
        notes: ["excluded:not_applicable"],
      }),
      utilityDomain({
        domain: "crowdControl",
        cappedContribution: 0,
        rawScore: 0,
        weightShare: 0.5,
        events: 0,
        creditedEvents: 0,
        notes: ["applicable_unused_zero_contribution"],
      }),
    ],
    interruptCounts: {
      CONFIRMED_SUCCESS: 4,
      VALID_OVERLAP: 2,
      MATCHED_FAILED: 1,
      UNMATCHED_ATTEMPT: 0,
      NOT_OBSERVABLE: 0,
      creditedTotal: 6.5,
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
        PROVIDED_GROUP_UTILITY: 0,
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
      scoreFloor: 0,
      domainWeights: {
        interrupt: 0.28,
        crowdControl: 0.18,
        dispelPurge: 0.16,
        groupSupport: 0.18,
        movement: 0.1,
        combatRes: 0.05,
        bloodlust: 0.05,
      },
      familyWeights: {
        interrupt: 0.28,
        crowdControl: 0.18,
        dispelPurge: 0.16,
        groupSupport: 0.18,
        movement: 0.1,
        combatRes: 0.05,
        bloodlust: 0.05,
      },
      interruptCredits: {
        CONFIRMED_SUCCESS: 1,
        VALID_OVERLAP: 0.9,
        MATCHED_FAILED: 0.8,
        UNMATCHED_ATTEMPT: 0.15,
        NOT_OBSERVABLE: 0,
      },
      interruptClassification: {
        CONFIRMED_SUCCESS: 4,
        VALID_OVERLAP: 2,
        MATCHED_FAILED: 1,
        UNMATCHED_ATTEMPT: 0,
        NOT_OBSERVABLE: 0,
        creditedTotal: 6.5,
        unmatchedCreditBeforeCap: 0,
        unmatchedCreditAfterCap: 0,
        unmatchedCapApplied: false,
      },
      domainCurves: {
        interrupt: "credited_interrupt_attempts_per_active_combat_hour",
        crowdControl: "deduped_cc_per_active_combat_hour",
        dispelPurge: "dispel_purge_successes_per_active_combat_hour",
        groupSupport: "diminished_support_credit_per_active_combat_hour",
        movement: "movement_utility_uses_per_active_combat_hour",
        combatRes: "combat_res_uses_per_active_combat_hour",
        bloodlust: "bloodlust_uses_per_active_combat_hour",
      },
      caps: {
        unmatchedCreditShareCap: 0.35,
        unmatchedOnlyMaxDomainScore: 35,
      },
      applicableDomains: ["interrupt", "crowdControl"],
      unusedDomains: ["crowdControl"],
      excludedDomains: [{ domain: "groupSupport", reason: "not_applicable" }],
      uncertainDomains: [],
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
  const baseStanding =
    overrides.historicalStandingScore ?? overrides.previousStandingScore ?? 85;
  return {
    score: 85,
    available: true,
    confidence: 1,
    confidenceCauses: [],
    historicalStandingScore: baseStanding,
    previousStandingScore: baseStanding,
    classRankFloor: 80,
    classRankFloorApplied: false,
    eliteFloorApplied: false,
    confirmedEliteTitleCount: 0,
    reason: null,
    ...overrides,
    historicalStandingScore:
      overrides.historicalStandingScore ??
      overrides.previousStandingScore ??
      baseStanding,
    previousStandingScore:
      overrides.previousStandingScore ??
      overrides.historicalStandingScore ??
      baseStanding,
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
      const damageParse = dim.scoreStory.drivers.find(
        (d) => d.code === "performance.damage_parse",
      );
      expect(damageParse?.direction).toBe("POSITIVE");
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

    it("reconstructs mixed applicability across two runs (outcome-only + full)", () => {
      // Counterexample from review: outcome-only 100 + full 55 → dungeon 77.5
      const runA = survivalRun({
        dungeonSlug: "ara-kara",
        slotIndex: 0,
        outcome: 100,
        defensive: null,
        recovery: null,
        weightsApplied: {
          outcome: 1,
          defensive: 0,
          recovery: 0,
          relativeDamage: 0,
        },
      });
      const runB = survivalRun({
        dungeonSlug: "ara-kara",
        slotIndex: 1,
        outcome: 100,
        defensive: 0,
        recovery: 0,
        weightsApplied: {
          outcome: 0.55,
          defensive: 0.3,
          recovery: 0.15,
          relativeDamage: 0,
        },
      });
      expect(runA.behavioralScore).toBeCloseTo(100, 6);
      expect(runB.behavioralScore).toBeCloseTo(55, 6);

      const survival = survivalFromRuns([
        survivalDungeon("ara-kara", [runA, runB]),
      ]);
      expect(survival.score).toBeCloseTo(77.5, 6);
      // Season component summaries look like defaults — must not drive contributions.
      expect(survival.components.outcome).toBe(100);
      expect(survival.components.defensive).toBe(0);
      expect(survival.components.recovery).toBe(0);

      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(
        survival.score!,
        6,
      );
      // Must not equal the false 55 reconstruction from global .55/.30/.15.
      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).not.toBeCloseTo(
        55,
        1,
      );
    });

    it("follows actual run.weightsApplied even when they differ from defaults", () => {
      const run = survivalRun({
        dungeonSlug: "dawnbreaker",
        slotIndex: 0,
        outcome: 80,
        defensive: 20,
        recovery: 40,
        // Intentionally non-canonical applied weights.
        weightsApplied: {
          outcome: 0.2,
          defensive: 0.5,
          recovery: 0.3,
          relativeDamage: 0,
        },
      });
      const survival = survivalFromRuns([survivalDungeon("dawnbreaker", [run])]);
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(dim.scoreStory.drivers.find((d) => d.code === "survival.outcome")?.weight).toBeCloseTo(
        0.2,
        6,
      );
      expect(
        dim.scoreStory.drivers.find((d) => d.code === "survival.defensive_response")
          ?.weight,
      ).toBeCloseTo(0.5, 6);
      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(
        run.behavioralScore!,
        6,
      );
    });

    it("does not apply a component weight on runs where it was unavailable", () => {
      const run = survivalRun({
        dungeonSlug: "priory",
        slotIndex: 0,
        outcome: 100,
        defensive: null,
        recovery: null,
        weightsApplied: {
          outcome: 1,
          defensive: 0,
          recovery: 0,
          relativeDamage: 0,
        },
      });
      const survival = survivalFromRuns([survivalDungeon("priory", [run])], {
        // Misleading season summary that would invite a wrong global reweight.
        components: {
          outcome: 100,
          defensive: 0,
          recovery: 0,
          relativeDamage: null,
        },
      });
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(
        dim.scoreStory.drivers.map((d) => d.code),
      ).toEqual(["survival.outcome"]);
      expect(dim.scoreStory.drivers[0]?.weight).toBeCloseTo(1, 6);
      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(100, 6);
    });

    it("includes relative damage only from runs with non-zero applied relative weight", () => {
      const withRelative = survivalRun({
        dungeonSlug: "floodgate",
        slotIndex: 0,
        outcome: 100,
        defensive: 50,
        recovery: 50,
        relativeDamage: 20,
        weightsApplied: {
          outcome: 0.5,
          defensive: 0.25,
          recovery: 0.15,
          relativeDamage: 0.1,
        },
      });
      const withoutRelative = survivalRun({
        dungeonSlug: "floodgate",
        slotIndex: 1,
        outcome: 100,
        defensive: 50,
        recovery: 50,
        relativeDamage: 20,
        weightsApplied: {
          outcome: 0.55,
          defensive: 0.3,
          recovery: 0.15,
          relativeDamage: 0,
        },
      });
      const survival = survivalFromRuns(
        [survivalDungeon("floodgate", [withRelative, withoutRelative])],
        { relativeDamageMode: "active" },
      );
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      const relative = dim.scoreStory.drivers.find(
        (d) => d.code === "survival.relative_avoidable_damage",
      );
      expect(relative).toBeDefined();
      // Mean applied relative weight across the two runs = 0.05
      expect(relative?.weight).toBeCloseTo(0.05, 6);
      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(
        survival.score!,
        6,
      );
    });

    it("never contributes shadow relative damage to the score story", () => {
      const run = survivalRun({
        dungeonSlug: "cinderbrew",
        slotIndex: 0,
        outcome: 90,
        defensive: 40,
        recovery: 60,
        relativeDamage: 10,
        weightsApplied: {
          outcome: 0.55,
          defensive: 0.3,
          recovery: 0.15,
          relativeDamage: 0,
        },
      });
      const survival = survivalFromRuns([survivalDungeon("cinderbrew", [run])], {
        relativeDamageMode: "shadow",
        components: {
          outcome: 90,
          defensive: 40,
          recovery: 60,
          relativeDamage: 10,
        },
      });
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(
        dim.scoreStory.drivers.map((d) => d.code),
      ).not.toContain("survival.relative_avoidable_damage");
      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(
        survival.score!,
        6,
      );
    });

    it("fails closed (no invented contributions) when run lineage is missing", () => {
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: survivalFixture({
          dungeons: [],
          score: 62,
          components: {
            outcome: 100,
            defensive: 0,
            recovery: 0,
            relativeDamage: null,
          },
        }),
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(dim.scoreStory.drivers).toEqual([]);
    });
  });

  describe("score reconstruction invariants", () => {
    it("Performance: 50 + sum(contributions) ~= final score", () => {
      const perf = performanceFixture();
      const dim = buildScoreExplainabilityV1({
        performance: perf,
        survival: null,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.PERFORMANCE;

      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(
        perf.score!,
        Math.round(-Math.log10(RECONCILE_EPS)),
      );
    });

    it("Utility: weighted family scores reconstruct the final score", () => {
      const util = utilityFixture();
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: util,
        experience: null,
        composite: null,
      }).dimensions.UTILITY;

      const familyDrivers = dim.scoreStory.drivers.filter((d) =>
        d.code.startsWith("utility.family."),
      );
      const reconstructed = familyDrivers.reduce((sum, d) => {
        const raw = d.value ?? 0;
        const share = d.weight ?? 0;
        return sum + share * raw;
      }, 0);
      expect(reconstructed).toBeCloseTo(
        util.score!,
        Math.round(-Math.log10(RECONCILE_EPS)),
      );
      expect(sumDriverContributions(familyDrivers)).toBeCloseTo(
        util.score!,
        Math.round(-Math.log10(RECONCILE_EPS)),
      );
    });

    it("Survival: 50 + aggregated run-lineage contributions ~= final score", () => {
      const survival = survivalFixture();
      const dim = buildScoreExplainabilityV1({
        performance: null,
        survival,
        utility: null,
        experience: null,
        composite: null,
      }).dimensions.SURVIVAL;

      expect(50 + sumDriverContributions(dim.scoreStory.drivers)).toBeCloseTo(
        survival.score!,
        Math.round(-Math.log10(RECONCILE_EPS)),
      );
    });
  });

  describe("unavailable product projection", () => {
    it("emits no product score drivers when dimension score is unavailable", () => {
      const built = buildScoreExplainabilityV1({
        performance: performanceFixture({
          state: "UNAVAILABLE",
          score: null,
          phase1Score: null,
          offensiveCooldownDiscipline: null,
          weightsApplied: { phase1: 0, damageParse: 0, healingParse: 0, cooldown: 0 },
          confidenceBreakdown: buildDimensionConfidenceBreakdown({
            value: 0,
            causes: ["performance_unavailable"],
            components: {},
          }),
        }),
        survival: null,
        utility: null,
        experience: experienceFixture({
          score: null,
          available: false,
          confidence: null,
          confidenceCauses: ["previous_evidence_unavailable"],
          reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
        }),
        composite: null,
      });

      const publicView = projectScoreExplainabilityPublic(built);
      expect(publicView.dimensions.PERFORMANCE.scoreDrivers).toEqual([]);
      expect(publicView.dimensions.EXPERIENCE.scoreDrivers).toEqual([]);
      expect(
        publicView.dimensions.PERFORMANCE.confidenceReasons.map((r) => r.code),
      ).toContain("performance_unavailable");
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
      expect(codes).toContain("utility.family.interrupt");
      expect(codes).not.toContain("utility.family.groupSupport");
      expect(
        dim.scoreStory.drivers.find((d) => d.code === "utility.family.interrupt")
          ?.direction,
      ).toBe("POSITIVE");

      const zeroCc = dim.scoreStory.drivers.find(
        (d) => d.code === "utility.family.crowdControl",
      );
      expect(zeroCc?.direction).toBe("NEGATIVE");
      expect(zeroCc?.params.zeroObservedContribution).toBe(true);

      expect(codes).not.toContain("utility.reliability_attenuation");

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
        (d) => d.code === "experience.historical_standing",
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
        dim.scoreStory.drivers.find((d) => d.code === "experience.historical_standing")
          ?.params.determinedFinalScore,
      ).toBe(false);
    });

    it("exposes CONFIRMED_NO_ACTIVITY as NEUTRAL score fact with confidence 1", () => {
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
      expect(dim.scoreStory.drivers[0]?.direction).toBe("NEUTRAL");
      expect(dim.scoreStory.drivers[0]?.label).toMatch(/no confirmed Mythic\+ history/i);
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

    function winningHistoricalProofForBand(
      nativeBand: "p999" | "p990" | "p900" | "p750" | "p600" | "below_p600",
    ) {
      const score =
        (NATIVE_BAND_STANDING_SCORES as Record<string, number>)[nativeBand] ?? 0;
      const seasonSlug = "test-season";
      const policySeasonSlug = "test-policy-season";
      const bandMap: Record<string, string> = {
        p999: "TOP_0_1_OR_BETTER",
        p990: "TOP_1",
        p900: "TOP_10",
        p750: "TOP_25",
        p600: "TOP_40",
        below_p600: "BELOW_TOP_40",
      };
      return {
        seasonId: "season-1",
        seasonSlug,
        blizzardSeasonId: 1,
        rating: 200,
        nativeBand,
        standingScore: score,
        standing: {
          rating: 200,
          nativeBand,
          standingScore: score,
          band: bandMap[nativeBand] ?? "TOP_10",
          estimatedTopPercent: null,
          method: "NATIVE_BAND",
          betterAnchor: null,
          worseAnchor: null,
          thresholdsUsed: [],
          policyVersion: "v1",
          region: "US",
          seasonSlug,
        },
        thresholdsUsed: [],
        populationPolicyVersion: "v1",
        region: "US",
        policySeasonSlug,
      };
    }

    it("maps p999 (Top 0.1%) to VERY GOOD historical standing", () => {
      const band = "p999" as const;
      const score = NATIVE_BAND_STANDING_SCORES.p999;

      const built = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score,
          historicalStandingScore: score,
          previousStandingScore: score,
          winningHistoricalProof: winningHistoricalProofForBand(band),
        }),
        composite: null,
      });

      const dim = projectScoreExplainabilityPublic(built).dimensions.EXPERIENCE;
      const driver = dim.scoreDrivers.find(
        (d) => d.code === "experience.historical_standing",
      );
      expect(driver?.qualitativeLabel).toBe("VERY GOOD");
      expect(driver?.label).toContain("top 0.1%");
    });

    it("maps p990 (Top 1%) to GOOD historical standing", () => {
      const band = "p990" as const;
      const score = NATIVE_BAND_STANDING_SCORES.p990;

      const built = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score,
          historicalStandingScore: score,
          previousStandingScore: score,
          winningHistoricalProof: winningHistoricalProofForBand(band),
        }),
        composite: null,
      });

      const dim = projectScoreExplainabilityPublic(built).dimensions.EXPERIENCE;
      const driver = dim.scoreDrivers.find(
        (d) => d.code === "experience.historical_standing",
      );
      expect(driver?.qualitativeLabel).toBe("GOOD");
      expect(driver?.label).toContain("top 1%");
    });

    it("maps p900 (Top 10%) to BAD historical standing", () => {
      const band = "p900" as const;
      const score = NATIVE_BAND_STANDING_SCORES.p900;

      const built = buildScoreExplainabilityV1({
        performance: null,
        survival: null,
        utility: null,
        experience: experienceFixture({
          score,
          historicalStandingScore: score,
          previousStandingScore: score,
          winningHistoricalProof: winningHistoricalProofForBand(band),
        }),
        composite: null,
      });

      const dim = projectScoreExplainabilityPublic(built).dimensions.EXPERIENCE;
      const driver = dim.scoreDrivers.find(
        (d) => d.code === "experience.historical_standing",
      );
      expect(driver?.qualitativeLabel).toBe("BAD");
      expect(driver?.label).toContain("top 10%");
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
