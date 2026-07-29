/**
 * Utility publication eligibility + public observation boundary tests.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateUtilityPublicationEligibility,
  runUtilityObservedShadowPass,
  UTILITY_PUBLICATION_METRIC_KEY,
  type UtilityShadowPassResult,
} from "@mplus/provider-warcraftlogs";
import {
  applyUtilityPublicationBoundary,
} from "./utility-publication-refresh.js";
import {
  applyUtilityShadowRefreshBoundary,
  shadowDiagnosticsForScoreExplanation,
} from "./utility-shadow-refresh.js";
import type { MetricObservationDTO } from "@mplus/contracts";
import {
  buildRankingEligibility,
  calculateScore,
  createDefaultModelV5,
  createDefaultModelV6,
  DEFAULT_V6_UTILITY_PUBLICATION_ELIGIBILITY,
} from "@mplus/scoring";

const V6_GATES = { ...DEFAULT_V6_UTILITY_PUBLICATION_ELIGIBILITY };
function scoredShadow(partial: Partial<UtilityShadowPassResult["score"]> = {}): UtilityShadowPassResult {
  return {
    analysisVersion: "utility-observed-shadow-v1",
    publicationMode: "published",
    status: "SHADOW_SCORED",
    altersPublicUtility: false,
    altersPublicTrustScore: false,
    replacesLastKnownGoodUtility: false,
    detailedWclEventCallsMade: 0,
    researchModeAllowedInPublication: false,
    semantics: {
      version: "utility-observed-semantics-v1",
      scoreKind: "observed_positive_contribution",
    } as UtilityShadowPassResult["semantics"],
    adminDiagnosticsOnly: false,
    score: {
      mode: "OBSERVED_CONTRIBUTION",
      productionCandidate: true,
      scoreKind: "observed_positive_contribution",
      rawBehaviorEstimate: 65,
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      confidenceComponents: {},
      reliability: 0.8,
      domainBreakdown: [
        {
          domain: "castStops",
          applicable: true,
          rawScore: 52,
          weight: 0.45,
          weightShare: 0.45,
          uncappedContribution: 1,
          cappedContribution: 1,
          capApplied: false,
          events: 3,
          perCombatHour: 1.2,
          notes: [],
        },
        {
          domain: "support",
          applicable: true,
          rawScore: 64,
          weight: 0.28,
          weightShare: 0.28,
          uncappedContribution: 4,
          cappedContribution: 4,
          capApplied: false,
          events: 45,
          perCombatHour: 7,
          notes: [],
        },
        {
          domain: "strategicCc",
          applicable: true,
          rawScore: 81,
          weight: 0.27,
          weightShare: 0.27,
          uncappedContribution: 8,
          cappedContribution: 8,
          capApplied: false,
          events: 20,
          perCombatHour: 8,
          notes: [],
        },
      ],
      explanations: [],
      context: {
        runCount: 15,
        dungeonCount: 8,
        dungeons: [],
        combatHours: 2,
        fightDurationHours: 3,
        activeCombatEstimate: null,
        hostileCastWindows: 10,
        playerInterruptSuccesses: 3,
        playerDispelPurgeSuccesses: 0,
        playerStrategicCcSuccesses: 20,
        playerSupportEvents: 45,
        attributableEvents: 68,
        toolkit: {
          hasInterrupt: true,
          hasDispel: false,
          hasPurge: false,
          hasHardCc: true,
        },
      },
      denominatorChoice: { selected: "x", rejected: [] },
      researchModeExcluded: [],
      ...partial,
    } as UtilityShadowPassResult["score"],
  };
}

describe("utility publication eligibility", () => {
  it("publishes SHADOW_SCORED when gates pass in published mode", () => {
    const eligibility = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      gates: V6_GATES,
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
        missingMasterDataCount: 0,
        incompleteEvidenceCount: 0,
        classSlug: "warlock",
        specSlug: "affliction",
        evidenceAnalysisVersion: "wcl-run-evidence-v1",
      },
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reasons).toEqual([]);
  });

  it("rejects missing masterData and insufficient runs", () => {
    const eligibility = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 55,
      confidence: 50,
      gates: V6_GATES,
      coverage: {
        candidateRunCount: 2,
        compatibleEvidenceCount: 2,
        analyzedRunCount: 2,
        observedDomainCount: 1,
        missingMasterDataCount: 1,
        incompleteEvidenceCount: 1,
      },
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain("MISSING_MASTER_DATA");
    expect(eligibility.reasons).toContain("INSUFFICIENT_ANALYZED_RUNS");
    expect(eligibility.reasons).toContain("INSUFFICIENT_OBSERVED_DOMAINS");
  });

  it("shadow mode never publishes", () => {
    const eligibility = evaluateUtilityPublicationEligibility({
      publicationMode: "shadow",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      gates: V6_GATES,
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
      },
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain("PUBLICATION_MODE_SHADOW");
  });
});

describe("utility publication boundary", () => {
  it("emits utility.observed_contribution from reliabilityAdjustedScore", () => {
    const combatObs: MetricObservationDTO[] = [
      {
        metricKey: "utility.interrupts",
        dimension: "UTILITY",
        rawValue: 0,
        normalizedValue: 0,
        confidence: 0.7,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: {},
      },
    ];
    const result = applyUtilityPublicationBoundary({
      gates: V6_GATES,
      observations: combatObs,
      shadow: scoredShadow(),
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
        classSlug: "warlock",
        specSlug: "affliction",
      },
      observedAt: new Date().toISOString(),
      classSlug: "warlock",
      specSlug: "affliction",
    });
    expect(result.published).toBe(true);
    expect(result.altersPublicTrustScore).toBe(true);
    const util = result.publicUtilitySafeObservations.filter((o) => o.dimension === "UTILITY");
    expect(util).toHaveLength(1);
    expect(util[0]!.metricKey).toBe(UTILITY_PUBLICATION_METRIC_KEY);
    expect(util[0]!.normalizedValue).toBe(61.91);
    expect(util[0]!.confidence).toBeCloseTo(0.7, 5);
    // No fabricated combat-facts Utility mixed in.
    expect(util.some((o) => o.metricKey === "utility.interrupts")).toBe(false);
  });

  it("keeps Utility unavailable when evidence is insufficient — no fake 50/0", () => {
    const shadow = scoredShadow();
    shadow.status = "SKIPPED_NO_PERSISTED_EVIDENCE";
    shadow.score = null;
    const result = applyUtilityPublicationBoundary({
      gates: V6_GATES,
      observations: [],
      shadow,
      coverage: {
        candidateRunCount: 0,
        compatibleEvidenceCount: 0,
        analyzedRunCount: 0,
        observedDomainCount: 0,
        missingMasterDataCount: 1,
      },
      observedAt: new Date().toISOString(),
    });
    expect(result.published).toBe(false);
    expect(result.publicUtilitySafeObservations.some((o) => o.dimension === "UTILITY")).toBe(
      false,
    );
  });

  it("rollback to shadow leaves public Utility unchanged (no observed publication)", () => {
    const shadow = scoredShadow();
    shadow.publicationMode = "shadow";
    const combatObs: MetricObservationDTO[] = [
      {
        metricKey: "utility.interrupts",
        dimension: "UTILITY",
        rawValue: 3,
        normalizedValue: 60,
        confidence: 0.7,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: {},
      },
    ];
    const result = applyUtilityPublicationBoundary({
      gates: V6_GATES,
      observations: combatObs,
      shadow,
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
      },
      observedAt: new Date().toISOString(),
    });
    expect(result.published).toBe(false);
    expect(result.publicUtilitySafeObservations).toHaveLength(1);
    expect(result.publicUtilitySafeObservations[0]!.metricKey).toBe("utility.interrupts");
  });
});

describe("model v6 Trust integration", () => {
  it("Utility contributes to model v6 Trust and v5 remains unchanged", () => {
    const obs: MetricObservationDTO[] = [
      {
        metricKey: "performance.current_season_peak",
        dimension: "PERFORMANCE",
        rawValue: 80,
        normalizedValue: 80,
        confidence: 0.9,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: {},
      },
      {
        metricKey: "survival.outcome",
        dimension: "SURVIVAL",
        rawValue: 70,
        normalizedValue: 70,
        confidence: 0.85,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: null,
        context: {},
      },
      {
        metricKey: "experience.dungeon_breadth",
        dimension: "EXPERIENCE",
        rawValue: 0.8,
        normalizedValue: 80,
        confidence: 0.8,
        observedAt: new Date().toISOString(),
        sourceProvider: "blizzard",
        coverage: null,
        context: {},
      },
      {
        metricKey: UTILITY_PUBLICATION_METRIC_KEY,
        dimension: "UTILITY",
        rawValue: 61.91,
        normalizedValue: 61.91,
        confidence: 0.7,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: { present: 15, expected: 15, ratio: 1 },
        context: { utilityPublicationApproved: true, utilityScoringMode: "OBSERVED_CONTRIBUTION" },
      },
    ];

    const v5 = calculateScore({
      characterId: "c1",
      seasonSlug: "s1",
      model: createDefaultModelV5(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: obs,
      calculatedAt: new Date().toISOString(),
      inputFingerprint: "fp-v5",
    });
    const v6 = calculateScore({
      characterId: "c1",
      seasonSlug: "s1",
      model: createDefaultModelV6(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: obs,
      calculatedAt: new Date().toISOString(),
      inputFingerprint: "fp-v6",
    });

    const v5Utility = v5.dimensions.find((d) => d.dimension === "UTILITY");
    const v6Utility = v6.dimensions.find((d) => d.dimension === "UTILITY");
    // v5 still looks for legacy combat-facts metrics — published metric alone → unavailable.
    expect(v5Utility?.score).toBeNull();
    expect(v6Utility?.score).not.toBeNull();
    expect(v6Utility?.state === "AVAILABLE" || v6Utility?.state === "PARTIAL").toBe(true);
    // Reliability-adjusted observation is present in contributors (dimension score is confidence-blended).
    const contrib = v6Utility?.contributors as { available?: Array<{ metricKey?: string; normalizedValue?: number }> };
    expect(
      contrib?.available?.some(
        (c) => c.metricKey === UTILITY_PUBLICATION_METRIC_KEY && c.normalizedValue === 61.91,
      ),
    ).toBe(true);
    expect(v6.overallScore).not.toBe(v5.overallScore);

    const ranking = buildRankingEligibility({
      scoreModelVersion: 6,
      dimensions: v6.dimensions,
      utilityPublicationEligible: true,
    });
    expect(ranking.eligible).toBe(true);
    expect(ranking.utilityEligible).toBe(true);

    const rankingNoUtility = buildRankingEligibility({
      scoreModelVersion: 6,
      dimensions: v5.dimensions,
      utilityPublicationEligible: false,
      utilityPublicationReasons: ["INSUFFICIENT_ANALYZED_RUNS"],
    });
    expect(rankingNoUtility.eligible).toBe(false);
    expect(rankingNoUtility.reasons).toContain("UTILITY_NOT_ELIGIBLE");
  });

  it("genuine Utility score 0 remains distinct from unavailable", () => {
    const zeroObs: MetricObservationDTO[] = [
      {
        metricKey: UTILITY_PUBLICATION_METRIC_KEY,
        dimension: "UTILITY",
        rawValue: 0,
        normalizedValue: 0,
        confidence: 0.8,
        observedAt: new Date().toISOString(),
        sourceProvider: "warcraftlogs",
        coverage: { present: 5, expected: 5, ratio: 1 },
        context: { utilityPublicationApproved: true, utilityScoringMode: "OBSERVED_CONTRIBUTION" },
      },
    ];
    const scored = calculateScore({
      characterId: "c1",
      seasonSlug: "s1",
      model: createDefaultModelV6(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: zeroObs,
      calculatedAt: new Date().toISOString(),
      inputFingerprint: "fp-zero",
    });
    const util = scored.dimensions.find((d) => d.dimension === "UTILITY");
    expect(util?.score).not.toBeNull();
    expect(util?.state).not.toBe("UNAVAILABLE");
    const contrib = util?.contributors as { available?: Array<{ metricKey?: string; normalizedValue?: number }> };
    expect(contrib?.available?.some((c) => c.normalizedValue === 0)).toBe(true);

    const empty = calculateScore({
      characterId: "c1",
      seasonSlug: "s1",
      model: createDefaultModelV6(),
      scopeType: "CHARACTER",
      scopeKey: null,
      observations: [],
      calculatedAt: new Date().toISOString(),
      inputFingerprint: "fp-empty",
    });
    expect(empty.dimensions.find((d) => d.dimension === "UTILITY")?.score).toBeNull();
    expect(empty.dimensions.find((d) => d.dimension === "UTILITY")?.state).toBe("UNAVAILABLE");
  });
});

describe("published mode scoring pass", () => {
  it("published mode scores instead of BLOCKED_PUBLISHED_MODE", () => {
    const shadow = runUtilityObservedShadowPass({
      mode: "published",
      hasPersistedSharedEvidence: false,
      runs: [],
      rawByRunId: new Map(),
      masterByReport: new Map(),
      opportunities: [],
    });
    expect(shadow.status).toBe("SKIPPED_NO_PERSISTED_EVIDENCE");
    expect(shadow.status).not.toBe("BLOCKED_PUBLISHED_MODE");
  });

  it("refresh boundary diagnostics expose publication flags", () => {
    const { shadow, published, utilityPublicationEligible } = applyUtilityShadowRefreshBoundary({
      observations: [],
      hasPersistedSharedEvidence: false,
      scoreModelConfig: { utilityPublicationEligibility: V6_GATES },
      shadowScoreInput: {
        mode: "shadow",
        hasPersistedSharedEvidence: false,
        runs: [],
        rawByRunId: new Map(),
        masterByReport: new Map(),
        opportunities: [],
      },
    });
    const diag = shadowDiagnosticsForScoreExplanation(shadow, undefined, {
      published,
      utilityPublicationEligible,
      eligibilityReasons: ["PUBLICATION_MODE_SHADOW"],
    });
    expect(diag.published).toBe(false);
    expect(diag.altersPublicTrustScore).toBe(false);
  });
});
