/**
 * Utility V3.1 offline scoring logic (calibration experiment).
 * Reuses V3 evidence audit; changes only aggregation, curves, shrinkage, and credit classes.
 */
import { getAbilityCatalog } from "@mplus/abilities";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import { equalWeightMean, median } from "./survival-calibration-logic.js";
import { activeSeasonDungeonPool } from "./survival-probe-logic.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityV2EvidenceItem } from "./utility-v2-types.js";
import {
  UTILITY_V3_SIMULATION_CONFIG,
  type UtilityV3DomainEligibility,
  type UtilityV3DomainKey,
  type UtilityV3EvidenceTier,
} from "./utility-v3-config.js";
import {
  determineDomainEligibility,
  effectiveEventsPerHour,
  interpolateDomainCurve,
  redistributeBehaviorWeights,
  semanticBandForScore,
} from "./utility-v3-scoring-logic.js";
import { auditUtilityV3Evidence } from "./utility-v3-evidence-logic.js";
import type { UtilityV2RawRunBundle } from "./utility-v2-types.js";
import {
  UTILITY_V3_1_SIMULATION_CONFIG,
  type SupportCreditClass,
  type UtilityV3_1AblationMode,
  type UtilityV3_1DomainKey,
  type UtilityV3_1SimulationConfig,
} from "./utility-v3_1-config.js";

const DOMAIN_KEYS = Object.keys(
  UTILITY_V3_1_SIMULATION_CONFIG.domainWeights,
) as UtilityV3_1DomainKey[];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function saturate(count: number, saturation: number): number {
  if (saturation <= 0) return 0;
  return clamp(count / saturation, 0, 1);
}

function interpolatePoints(
  x: number,
  points: ReadonlyArray<{ effectivePerHour?: number; responseRate?: number; score: number }>,
  key: "effectivePerHour" | "responseRate",
): number {
  const rate = Math.max(0, x);
  const xs = points.map((p) => p[key] ?? 0);
  if (rate <= xs[0]!) return points[0]!.score;
  const last = points[points.length - 1]!;
  if (rate >= xs[xs.length - 1]!) return last.score;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const ax = a[key] ?? 0;
    const bx = b[key] ?? 0;
    if (rate >= ax && rate <= bx) {
      const t = (rate - ax) / (bx - ax);
      return a.score + t * (b.score - a.score);
    }
  }
  return last.score;
}

/** Generic support credit class — no class/spec branches. */
export function classifySupportEvidence(
  item: UtilityV2EvidenceItem,
  playerActorId: number | null,
): SupportCreditClass {
  const notes = item.correlationNotes ?? [];
  const unverified =
    notes.includes("value_not_inferable_from_cast_alone") || notes.includes("cast_observed");
  const selfTarget =
    playerActorId != null &&
    item.targetActorId != null &&
    item.targetActorId === playerActorId;
  const unknownTarget = item.targetActorId == null || item.targetActorId < 0;

  if (item.kind === "DISPEL" || item.kind === "PURGE") {
    return item.tier === "CONFIRMED_IMPACT" || item.removedSpellId != null
      ? "reactive"
      : "routine";
  }
  if (item.kind === "BATTLE_REZ") {
    return item.tier === "CONFIRMED_IMPACT" ? "strategic" : "routine";
  }
  if (item.kind === "EXTERNAL") {
    if (selfTarget) return "personalExcluded";
    if (item.tier === "CONFIRMED_IMPACT") return "discretionary";
    if (unverified && unknownTarget) return "unverified";
    if (unverified) return "routine";
    return "routine";
  }
  return item.tier === "CONFIRMED_IMPACT" ? "discretionary" : "routine";
}

export function supportItemEffectiveWeight(
  item: UtilityV2EvidenceItem,
  playerActorId: number | null,
  config: UtilityV3_1SimulationConfig = UTILITY_V3_1_SIMULATION_CONFIG,
): { creditClass: SupportCreditClass; weight: number } {
  const creditClass = classifySupportEvidence(item, playerActorId);
  const classMult = config.supportCreditClass[creditClass];
  const tierMult = config.tierWeights[item.tier as UtilityV3EvidenceTier] ?? 0;
  return { creditClass, weight: classMult * tierMult };
}

export function shrinkTowardNeutral(rawScore: number, reliability: number): number {
  const r = clamp(reliability, 0, 1);
  return 50 + r * (rawScore - 50);
}

export interface DomainReliabilityInput {
  dungeonCount: number;
  runCount: number;
  uniqueAbilityOrSpellCount: number;
  uniqueTargetCount: number;
  opportunityCount: number;
  datasetComplete: boolean;
  domain: UtilityV3_1DomainKey;
}

export function computeDomainReliability(
  input: DomainReliabilityInput,
  config: UtilityV3_1SimulationConfig = UTILITY_V3_1_SIMULATION_CONFIG,
): { reliability: number; components: Record<string, number> } {
  const w = config.reliability.weights;
  const dungeonCoverage = saturate(input.dungeonCount, config.reliability.dungeonSaturation);
  const runCount = saturate(input.runCount, config.reliability.runSaturation);
  const evidenceDiversity = saturate(
    input.uniqueAbilityOrSpellCount,
    config.reliability.diversitySaturation,
  );
  const targetDiversity = saturate(
    input.uniqueTargetCount,
    config.reliability.targetSaturation,
  );
  // CastStops: missing opportunity stream is a reliability penalty (not a score penalty).
  const opportunityObservability =
    input.domain === "castStops"
      ? input.opportunityCount > 0
        ? saturate(input.opportunityCount, config.reliability.opportunitySaturation)
        : 0.25
      : 0.85;
  const datasetCompleteness = input.datasetComplete ? 1 : 0.45;

  const components = {
    dungeonCoverage,
    runCount,
    evidenceDiversity,
    targetDiversity,
    opportunityObservability,
    datasetCompleteness,
  };

  let reliability =
    dungeonCoverage * w.dungeonCoverage +
    runCount * w.runCount +
    evidenceDiversity * w.evidenceDiversity +
    targetDiversity * w.targetDiversity +
    opportunityObservability * w.opportunityObservability +
    datasetCompleteness * w.datasetCompleteness;

  reliability = clamp(reliability, config.reliability.minReliability, 1);
  return { reliability: round2(reliability), components };
}

export interface ConfidenceComponents {
  dungeonCoverage: number;
  runCount: number;
  evidenceCompleteness: number;
  opportunityObservability: number;
  actorResolution: number;
  datasetIntegrity: number;
  domainCoverage: number;
  raw: number;
  capped: number;
  artifactState: "COMPLETE" | "PARTIAL" | "NONE";
}

export function computeV3_1Confidence(input: {
  dungeonCount: number;
  runCount: number;
  expectedDungeons: number;
  scoredDomainCount: number;
  applicableDomainCount: number;
  opportunityCount: number;
  evidenceItemCount: number;
  actorResolved: boolean;
  datasetsOkRatio: number;
  artifactState: "COMPLETE" | "PARTIAL" | "NONE";
  config?: UtilityV3_1SimulationConfig;
}): ConfidenceComponents {
  const config = input.config ?? UTILITY_V3_1_SIMULATION_CONFIG;
  const w = config.confidence.weights;
  const dungeonCoverage = saturate(input.dungeonCount, input.expectedDungeons);
  const runCount = saturate(input.runCount, 8);
  const evidenceCompleteness = clamp(input.evidenceItemCount / Math.max(input.runCount * 8, 1), 0, 1);
  const opportunityObservability =
    input.opportunityCount > 0 ? saturate(input.opportunityCount, 20) : 0.3;
  const actorResolution = input.actorResolved ? 1 : 0.4;
  const datasetIntegrity = clamp(input.datasetsOkRatio, 0, 1);
  const domainCoverage =
    input.applicableDomainCount > 0
      ? clamp(input.scoredDomainCount / input.applicableDomainCount, 0, 1)
      : 0.5;

  const raw =
    (dungeonCoverage * w.dungeonCoverage +
      runCount * w.runCount +
      evidenceCompleteness * w.evidenceCompleteness +
      opportunityObservability * w.opportunityObservability +
      actorResolution * w.actorResolution +
      datasetIntegrity * w.datasetIntegrity +
      domainCoverage * w.domainCoverage) *
    100;

  let capped = raw;
  if (input.artifactState !== "COMPLETE") {
    capped = Math.min(capped, config.confidence.maxConfidenceWhenPartial);
  }
  if (input.dungeonCount < config.confidence.tinySampleDungeonThreshold) {
    capped = Math.min(capped, config.confidence.maxConfidenceWhenTinySample);
  }

  return {
    dungeonCoverage: round2(dungeonCoverage),
    runCount: round2(runCount),
    evidenceCompleteness: round2(evidenceCompleteness),
    opportunityObservability: round2(opportunityObservability),
    actorResolution: round2(actorResolution),
    datasetIntegrity: round2(datasetIntegrity),
    domainCoverage: round2(domainCoverage),
    raw: round2(raw),
    capped: round2(capped),
    artifactState: input.artifactState,
  };
}

export function scoreCastStopsV3_1(input: {
  tierCounts: Record<UtilityV3EvidenceTier, number>;
  durationHours: number;
  opportunityCount: number;
  confirmedStopsMatchingOpportunity: number;
  confirmedMisses: number;
  dungeonCount: number;
  uniqueInterruptedSpells: number;
  uniqueTargets: number;
  config?: UtilityV3_1SimulationConfig;
}): {
  rawScore: number;
  mode: "opportunity_response" | "volume_cautious";
  effectivePerHour: number;
  responseRate: number | null;
  notes: string[];
} {
  const config = input.config ?? UTILITY_V3_1_SIMULATION_CONFIG;
  const effectivePerHour = effectiveEventsPerHour(
    input.tierCounts,
    input.durationHours,
    UTILITY_V3_SIMULATION_CONFIG,
  );
  const notes: string[] = [];

  if (input.opportunityCount > 0) {
    const denom =
      input.confirmedStopsMatchingOpportunity + input.confirmedMisses || input.opportunityCount;
    const responseRate = clamp(
      input.confirmedStopsMatchingOpportunity / Math.max(denom, 1),
      0,
      1,
    );
    let rawScore = interpolatePoints(
      responseRate,
      config.castStopsOpportunityCurve.points,
      "responseRate",
    );
    if (
      rawScore >= 95 &&
      (input.dungeonCount < config.castStopsOpportunityCurve.minDungeonsFor95 ||
        input.opportunityCount < config.castStopsOpportunityCurve.minOpportunitiesForHighBand)
    ) {
      rawScore = Math.min(rawScore, 92);
      notes.push("95+_gated_insufficient_dungeon_or_opportunity_coverage");
    }
    if (input.confirmedMisses > 0 && responseRate < 0.5) {
      notes.push("confirmed_misses_pull_below_strong_band");
    }
    return {
      rawScore: round2(rawScore),
      mode: "opportunity_response",
      effectivePerHour: round2(effectivePerHour),
      responseRate: round2(responseRate),
      notes,
    };
  }

  // No opportunity denominator: cautiously positive from volume + light diversity uplift.
  let rawScore = interpolatePoints(
    effectivePerHour,
    config.castStopsVolumeCurve.points,
    "effectivePerHour",
  );
  const diversityBonus =
    0.35 * saturate(input.uniqueInterruptedSpells, 10) +
    0.25 * saturate(input.uniqueTargets, 8) +
    0.4 * saturate(input.dungeonCount, 8);
  rawScore = Math.min(
    config.castStopsVolumeCurve.maxScoreWithoutOpportunities,
    rawScore + diversityBonus * 3,
  );
  notes.push("no_opportunity_denominator_volume_cautious_cap");
  if (input.tierCounts.CONFIRMED_IMPACT + input.tierCounts.CONFIRMED_APPLICATION === 0) {
    rawScore = config.noConfirmedContributionScore;
    notes.push("no_confirmed_stops");
  }
  return {
    rawScore: round2(rawScore),
    mode: "volume_cautious",
    effectivePerHour: round2(effectivePerHour),
    responseRate: null,
    notes,
  };
}

export function scoreSupportV3_1(input: {
  items: UtilityV2EvidenceItem[];
  durationHours: number;
  playerActorId: number | null;
  config?: UtilityV3_1SimulationConfig;
}): {
  rawScore: number;
  effectivePerHour: number;
  byCreditClass: Record<SupportCreditClass, number>;
  byAbility: Array<{
    abilityName: string | null;
    abilityGameID: number | null;
    creditClass: SupportCreditClass;
    tier: string;
    count: number;
    effectiveWeight: number;
  }>;
  strategicShare: number;
  notes: string[];
} {
  const config = input.config ?? UTILITY_V3_1_SIMULATION_CONFIG;
  const byCreditClass: Record<SupportCreditClass, number> = {
    reactive: 0,
    strategic: 0,
    discretionary: 0,
    routine: 0,
    unverified: 0,
    personalExcluded: 0,
  };
  const abilityMap = new Map<
    string,
    {
      abilityName: string | null;
      abilityGameID: number | null;
      creditClass: SupportCreditClass;
      tier: string;
      count: number;
      effectiveWeight: number;
    }
  >();

  let effective = 0;
  for (const item of input.items) {
    const { creditClass, weight } = supportItemEffectiveWeight(
      item,
      input.playerActorId,
      config,
    );
    byCreditClass[creditClass] += weight;
    effective += weight;
    const key = `${item.abilityGameID ?? "?"}:${item.abilityName ?? "?"}:${creditClass}:${item.tier}`;
    const prev = abilityMap.get(key);
    if (prev) {
      prev.count += 1;
      prev.effectiveWeight += weight;
    } else {
      abilityMap.set(key, {
        abilityName: item.abilityName,
        abilityGameID: item.abilityGameID,
        creditClass,
        tier: item.tier,
        count: 1,
        effectiveWeight: weight,
      });
    }
  }

  const hours = Math.max(input.durationHours, 1 / 60);
  const effectivePerHour = effective / hours;
  const strategic =
    byCreditClass.reactive + byCreditClass.strategic + byCreditClass.discretionary;
  const strategicShare = effective > 0 ? strategic / effective : 0;

  let rawScore =
    effective <= 0
      ? config.noConfirmedContributionScore
      : interpolatePoints(effectivePerHour, config.supportCurve.points, "effectivePerHour");

  const notes: string[] = [];
  if (strategicShare < 0.35 && rawScore > config.supportCurve.maxScoreWhenMostlyRoutine) {
    rawScore = config.supportCurve.maxScoreWhenMostlyRoutine;
    notes.push("capped_mostly_routine_or_unverified_support");
  }
  if (
    rawScore > 90 &&
    strategicShare < config.supportCurve.minStrategicShareFor90
  ) {
    rawScore = Math.min(rawScore, 88);
    notes.push("90+_requires_majority_reactive_or_strategic_credit");
  }
  if (byCreditClass.personalExcluded > 0 || byCreditClass.unverified > 0) {
    notes.push("personal_or_unverified_external_casts_downweighted");
  }

  return {
    rawScore: round2(rawScore),
    effectivePerHour: round2(effectivePerHour),
    byCreditClass,
    byAbility: [...abilityMap.values()].sort((a, b) => b.effectiveWeight - a.effectiveWeight),
    strategicShare: round2(strategicShare),
    notes,
  };
}

/** Neutral-baseline aggregation: N/A domains keep weight but contribute 0 deviation. */
export function aggregateNeutralBaseline(
  domainScores: Record<UtilityV3_1DomainKey, number | null>,
  reliability: Record<UtilityV3_1DomainKey, number>,
  originalWeights: Record<UtilityV3_1DomainKey, number>,
  eligibility: Record<UtilityV3_1DomainKey, UtilityV3DomainEligibility>,
): {
  behaviorScore: number;
  contributions: Record<
    UtilityV3_1DomainKey,
    {
      originalWeight: number;
      reliability: number;
      domainScore: number | null;
      deviation: number;
      contribution: number;
      eligibility: UtilityV3DomainEligibility;
    }
  >;
} {
  let sum = 0;
  const contributions = {} as Record<
    UtilityV3_1DomainKey,
    {
      originalWeight: number;
      reliability: number;
      domainScore: number | null;
      deviation: number;
      contribution: number;
      eligibility: UtilityV3DomainEligibility;
    }
  >;

  for (const d of DOMAIN_KEYS) {
    const w = originalWeights[d]!;
    const r = reliability[d] ?? 1;
    const elig = eligibility[d]!;
    let score = domainScores[d];
    if (elig === "NOT_APPLICABLE" || elig === "NOT_OBSERVABLE") {
      score = 50; // zero deviation
    } else if (score == null) {
      score = 50;
    }
    const deviation = score - 50;
    const contribution = w * r * deviation;
    sum += contribution;
    contributions[d] = {
      originalWeight: w,
      reliability: r,
      domainScore: domainScores[d],
      deviation: round2(deviation),
      contribution: round2(contribution),
      eligibility: elig,
    };
  }

  return {
    behaviorScore: round2(50 + sum),
    contributions,
  };
}

/** Classic V3 redistribution aggregation (for ablations A/C/D/E baselines). */
export function aggregateRedistributed(
  domainScores: Record<UtilityV3_1DomainKey, number | null>,
  weights: Record<UtilityV3_1DomainKey, number>,
): number {
  let weighted = 0;
  let sumW = 0;
  for (const d of DOMAIN_KEYS) {
    const s = domainScores[d];
    const w = weights[d] ?? 0;
    if (s != null && w > 0) {
      weighted += s * w;
      sumW += w;
    }
  }
  return sumW > 0 ? round2(weighted / sumW) : 50;
}

export interface V3_1ProfileScoreResult {
  mode: UtilityV3_1AblationMode;
  behaviorScore: number;
  confidence: number;
  confidenceComponents: ConfidenceComponents;
  semanticBand: string;
  domainScoresRaw: Record<UtilityV3_1DomainKey, number | null>;
  domainScoresShrunk: Record<UtilityV3_1DomainKey, number | null>;
  reliability: Record<UtilityV3_1DomainKey, number>;
  reliabilityComponents: Record<UtilityV3_1DomainKey, Record<string, number>>;
  originalWeights: Record<UtilityV3_1DomainKey, number>;
  redistributedWeights: Record<UtilityV3_1DomainKey, number> | null;
  contributions: Record<string, unknown>;
  eligibility: Record<UtilityV3_1DomainKey, UtilityV3DomainEligibility>;
  castStopsDetail: ReturnType<typeof scoreCastStopsV3_1> | null;
  supportDetail: ReturnType<typeof scoreSupportV3_1> | null;
  coverage: {
    runCount: number;
    dungeonCount: number;
    dungeons: string[];
    opportunityCount: number;
    confirmedMisses: number;
  };
  compressionAudit?: CompressionAudit;
}

export interface CompressionAudit {
  originalWeights: Record<UtilityV3_1DomainKey, number>;
  redistributedWeights: Record<UtilityV3_1DomainKey, number>;
  domainScores: Record<UtilityV3_1DomainKey, number | null>;
  neutralBaselineContribution: number;
  positiveDeviationByDomain: Record<UtilityV3_1DomainKey, number>;
  finalContributionByDomain: Record<UtilityV3_1DomainKey, number>;
  redistributionAmplification: number;
  sampleSizeNote: string;
}

export function auditV3Compression(input: {
  domainScores: Record<UtilityV3_1DomainKey, number | null>;
  eligibility: Record<UtilityV3_1DomainKey, UtilityV3DomainEligibility>;
  originalWeights: Record<UtilityV3_1DomainKey, number>;
  dungeonCount: number;
  runCount: number;
}): CompressionAudit {
  const redistributed = redistributeBehaviorWeights(
    input.originalWeights as Record<UtilityV3DomainKey, number>,
    input.eligibility as Record<UtilityV3DomainKey, UtilityV3DomainEligibility>,
  ) as Record<UtilityV3_1DomainKey, number>;

  const positiveDeviationByDomain = {} as Record<UtilityV3_1DomainKey, number>;
  const finalContributionByDomain = {} as Record<UtilityV3_1DomainKey, number>;
  let withRedistrib = 0;
  let withOriginal = 0;
  let sumW = 0;
  let sumOrigIncluded = 0;

  for (const d of DOMAIN_KEYS) {
    const s = input.domainScores[d];
    const elig = input.eligibility[d]!;
    if (elig === "NOT_APPLICABLE" || elig === "NOT_OBSERVABLE" || s == null) {
      positiveDeviationByDomain[d] = 0;
      finalContributionByDomain[d] = 0;
      continue;
    }
    positiveDeviationByDomain[d] = round2(Math.max(0, s - 50));
    const rw = redistributed[d] ?? 0;
    const ow = input.originalWeights[d] ?? 0;
    finalContributionByDomain[d] = round2(rw * s);
    withRedistrib += rw * s;
    withOriginal += ow * s;
    sumW += rw;
    sumOrigIncluded += ow;
  }

  const redistribScore = sumW > 0 ? withRedistrib / sumW : 50;
  const originalScore = sumOrigIncluded > 0 ? withOriginal / sumOrigIncluded : 50;

  return {
    originalWeights: { ...input.originalWeights },
    redistributedWeights: redistributed,
    domainScores: { ...input.domainScores },
    neutralBaselineContribution: 50,
    positiveDeviationByDomain,
    finalContributionByDomain,
    redistributionAmplification: round2(redistribScore - originalScore),
    sampleSizeNote: `${input.runCount} run(s) across ${input.dungeonCount} dungeon(s)`,
  };
}

function emptyDomainRecord<T>(value: T): Record<UtilityV3_1DomainKey, T> {
  return Object.fromEntries(DOMAIN_KEYS.map((d) => [d, value])) as Record<
    UtilityV3_1DomainKey,
    T
  >;
}

export function scoreProfileV3_1(input: {
  runs: UtilityNormalizedRun[];
  rawByRunId: Map<string, UtilityV2RawRunBundle>;
  masterByReport: Map<
    string,
    {
      actors: Array<{
        id: number;
        name: string;
        type: string;
        subType?: string | null;
        petOwner?: number | null;
      }>;
    }
  >;
  mode: UtilityV3_1AblationMode;
  v3DomainScores?: Record<UtilityV3_1DomainKey, number | null>;
  v3RedistributedWeights?: Record<UtilityV3_1DomainKey, number>;
  config?: UtilityV3_1SimulationConfig;
}): V3_1ProfileScoreResult {
  const config = input.config ?? UTILITY_V3_1_SIMULATION_CONFIG;
  const expected = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);
  const dungeons = [...new Set(input.runs.map((r) => r.dungeonSlug))];
  const dungeonCount = dungeons.length;
  const runCount = input.runs.length;
  const artifactState: "COMPLETE" | "PARTIAL" | "NONE" =
    runCount === 0 ? "NONE" : dungeonCount >= expected.length ? "COMPLETE" : "PARTIAL";

  // Aggregate evidence across runs (equal-weight dungeon medians later via per-run then median).
  const perRunScores: Array<{
    dungeonSlug: string;
    behaviorLocal: number;
    domainsRaw: Record<UtilityV3_1DomainKey, number | null>;
    domainsShrunk: Record<UtilityV3_1DomainKey, number | null>;
    eligibility: Record<UtilityV3_1DomainKey, UtilityV3DomainEligibility>;
    reliability: Record<UtilityV3_1DomainKey, number>;
    castStopsDetail: ReturnType<typeof scoreCastStopsV3_1> | null;
    supportDetail: ReturnType<typeof scoreSupportV3_1> | null;
    missed: number;
    opportunities: number;
    evidenceCount: number;
    playerActorId: number | null;
  }> = [];

  let totalOpportunities = 0;
  let totalMisses = 0;
  let totalEvidence = 0;
  let datasetsOk = 0;
  let datasetsTotal = 0;

  for (const normalized of input.runs) {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId);
    if (!raw) continue;
    const master = input.masterByReport.get(normalized.reportCode);
    const evidence = auditUtilityV3Evidence({
      normalized,
      raw,
      masterActors: master?.actors ?? [],
    });
    totalEvidence += evidence.evidenceInventory.length;
    const opps = normalized.interruptOpportunities ?? [];
    const misses = opps.filter(
      (o) => o.status === "PLAYER_AVAILABLE" && o.playerInterruptTimestamp == null,
    ).length;
    totalOpportunities += opps.length;
    totalMisses += misses;

    for (const ds of Object.values(normalized.datasetStates)) {
      datasetsTotal += 1;
      if (ds === "OK") datasetsOk += 1;
    }

    const catalog = getAbilityCatalog({
      classSlug: normalized.classSlug,
      specSlug: normalized.specialization,
      includeRacials: true,
    });

    const eligibility = emptyDomainRecord<UtilityV3DomainEligibility>("NOT_APPLICABLE");
    const domainsRaw = emptyDomainRecord<number | null>(null);
    const reliability = emptyDomainRecord(1);
    const reliabilityComponents = emptyDomainRecord<Record<string, number>>({});

    let castStopsDetail: ReturnType<typeof scoreCastStopsV3_1> | null = null;
    let supportDetail: ReturnType<typeof scoreSupportV3_1> | null = null;

    const castItems = evidence.domains.castStops.items;
    const uniqueSpells = new Set(
      castItems
        .map((i) => i.interruptedSpellId ?? i.abilityGameID)
        .filter((x): x is number => x != null),
    ).size;
    const uniqueTargets = new Set(
      castItems.map((i) => i.targetActorId).filter((x): x is number => x != null && x > 0),
    ).size;

    for (const d of DOMAIN_KEYS) {
      const det = determineDomainEligibility({
        domain: d as UtilityV3DomainKey,
        normalized,
        summary: evidence.domains[d as UtilityV3DomainKey],
        catalog,
      });
      eligibility[d] = det.eligibility;

      const rel = computeDomainReliability({
        dungeonCount,
        runCount,
        uniqueAbilityOrSpellCount:
          d === "castStops"
            ? uniqueSpells
            : new Set(
                evidence.domains[d as UtilityV3DomainKey].items
                  .map((i) => i.abilityGameID)
                  .filter((x): x is number => x != null),
              ).size,
        uniqueTargetCount: uniqueTargets,
        opportunityCount: opps.length,
        datasetComplete: det.eligibility !== "NOT_OBSERVABLE",
        domain: d,
      });
      reliability[d] = rel.reliability;
      reliabilityComponents[d] = rel.components;

      if (det.eligibility === "NO_CONFIRMED_CONTRIBUTION") {
        domainsRaw[d] = config.noConfirmedContributionScore;
        continue;
      }
      if (det.eligibility !== "SCORED") {
        domainsRaw[d] = null;
        continue;
      }

      if (d === "castStops") {
        const useNew =
          input.mode === "F_combined_v3_1" || input.mode === "D_caststop_recalibration_only";
        if (useNew) {
          castStopsDetail = scoreCastStopsV3_1({
            tierCounts: evidence.domains.castStops.tierCounts,
            durationHours: evidence.durationHours,
            opportunityCount: opps.length,
            confirmedStopsMatchingOpportunity: Math.max(
              0,
              opps.length - misses,
            ),
            confirmedMisses: misses,
            dungeonCount,
            uniqueInterruptedSpells: uniqueSpells,
            uniqueTargets,
            config,
          });
          domainsRaw[d] = castStopsDetail.rawScore;
        } else {
          const eph =
            effectiveEventsPerHour(
              evidence.domains.castStops.tierCounts,
              evidence.durationHours,
            );
          domainsRaw[d] = interpolateDomainCurve(eph, "castStops");
        }
      } else if (d === "support") {
        const useNew =
          input.mode === "F_combined_v3_1" || input.mode === "E_support_recalibration_only";
        if (useNew) {
          supportDetail = scoreSupportV3_1({
            items: evidence.domains.support.items,
            durationHours: evidence.durationHours,
            playerActorId: normalized.playerActorId,
            config,
          });
          domainsRaw[d] = supportDetail.rawScore;
        } else {
          const eph = effectiveEventsPerHour(
            evidence.domains.support.tierCounts,
            evidence.durationHours,
          );
          domainsRaw[d] = interpolateDomainCurve(eph, "support");
        }
      } else {
        const eph = effectiveEventsPerHour(
          evidence.domains[d as UtilityV3DomainKey].tierCounts,
          evidence.durationHours,
        );
        domainsRaw[d] = interpolateDomainCurve(eph, d as UtilityV3DomainKey);
      }
    }

    // Apply missed-opportunity penalty to castStops domain when confirmed misses exist.
    if (
      (input.mode === "F_combined_v3_1" || input.mode === "D_caststop_recalibration_only") &&
      misses > 0 &&
      domainsRaw.castStops != null
    ) {
      const penalty = Math.min(
        config.missedOpportunity.maxPenaltyPoints,
        misses * config.missedOpportunity.perMissedAvailableInterrupt,
      );
      domainsRaw.castStops = Math.max(
        config.missedOpportunity.floorScore,
        domainsRaw.castStops - penalty,
      );
    }

    const applyShrink =
      input.mode === "F_combined_v3_1" ||
      input.mode === "C_reliability_shrinkage_only" ||
      input.mode === "D_caststop_recalibration_only" ||
      input.mode === "E_support_recalibration_only";

    const domainsShrunk = emptyDomainRecord<number | null>(null);
    for (const d of DOMAIN_KEYS) {
      const raw = domainsRaw[d];
      if (raw == null) {
        domainsShrunk[d] = null;
        continue;
      }
      if (applyShrink) {
        // For D/E only shrink the recalibrated domain; for C/F shrink all.
        if (
          input.mode === "D_caststop_recalibration_only" &&
          d !== "castStops"
        ) {
          domainsShrunk[d] = raw;
        } else if (
          input.mode === "E_support_recalibration_only" &&
          d !== "support"
        ) {
          domainsShrunk[d] = raw;
        } else {
          domainsShrunk[d] = round2(shrinkTowardNeutral(raw, reliability[d]!));
        }
      } else {
        domainsShrunk[d] = raw;
      }
    }

    const useNeutral =
      input.mode === "B_no_redistribution" || input.mode === "F_combined_v3_1";
    const weights = { ...config.domainWeights };
    const redistributed = redistributeBehaviorWeights(
      weights as Record<UtilityV3DomainKey, number>,
      eligibility as Record<UtilityV3DomainKey, UtilityV3DomainEligibility>,
    ) as Record<UtilityV3_1DomainKey, number>;

    let behaviorLocal: number;
    if (useNeutral) {
      const agg = aggregateNeutralBaseline(
        domainsShrunk,
        input.mode === "B_no_redistribution"
          ? emptyDomainRecord(1)
          : reliability,
        weights,
        eligibility,
      );
      behaviorLocal = agg.behaviorScore;
    } else {
      behaviorLocal = aggregateRedistributed(domainsShrunk, redistributed);
    }

    perRunScores.push({
      dungeonSlug: normalized.dungeonSlug,
      behaviorLocal,
      domainsRaw,
      domainsShrunk,
      eligibility,
      reliability,
      castStopsDetail,
      supportDetail,
      missed: misses,
      opportunities: opps.length,
      evidenceCount: evidence.evidenceInventory.length,
      playerActorId: normalized.playerActorId,
    });
  }

  // Global = equal-weight mean of per-dungeon median run scores.
  const byDungeon = new Map<string, typeof perRunScores>();
  for (const scored of perRunScores) {
    const list = byDungeon.get(scored.dungeonSlug) ?? [];
    list.push(scored);
    byDungeon.set(scored.dungeonSlug, list);
  }

  const dungeonBehavior: number[] = [];
  const dungeonConfidenceProxy: number[] = [];
  for (const [, runs] of byDungeon) {
    const med = median(runs.map((r) => r.behaviorLocal));
    if (med != null) dungeonBehavior.push(med);
    dungeonConfidenceProxy.push(runs.length);
  }

  const behaviorScore =
    round2(equalWeightMean(dungeonBehavior) ?? 50);

  // Domain-level global medians (across dungeons of median per-run domain scores).
  const domainScoresRaw = emptyDomainRecord<number | null>(null);
  const domainScoresShrunk = emptyDomainRecord<number | null>(null);
  const reliabilityGlobal = emptyDomainRecord(1);
  const reliabilityComponentsGlobal = emptyDomainRecord<Record<string, number>>({});
  const eligibilityGlobal = emptyDomainRecord<UtilityV3DomainEligibility>("NOT_APPLICABLE");

  for (const d of DOMAIN_KEYS) {
    const rawMedians: number[] = [];
    const shrunkMedians: number[] = [];
    const rels: number[] = [];
    const eligCounts = new Map<UtilityV3DomainEligibility, number>();
    for (const [, runs] of byDungeon) {
      const rawM = median(
        runs.map((r) => r.domainsRaw[d]).filter((x): x is number => x != null),
      );
      const shrunkM = median(
        runs.map((r) => r.domainsShrunk[d]).filter((x): x is number => x != null),
      );
      if (rawM != null) rawMedians.push(rawM);
      if (shrunkM != null) shrunkMedians.push(shrunkM);
      rels.push(...runs.map((r) => r.reliability[d]!));
      for (const r of runs) {
        eligCounts.set(r.eligibility[d]!, (eligCounts.get(r.eligibility[d]!) ?? 0) + 1);
      }
    }
    domainScoresRaw[d] =
      rawMedians.length > 0 ? round2(equalWeightMean(rawMedians)!) : null;
    domainScoresShrunk[d] =
      shrunkMedians.length > 0 ? round2(equalWeightMean(shrunkMedians)!) : null;
    reliabilityGlobal[d] =
      rels.length > 0 ? round2(equalWeightMean(rels)!) : 1;
    let bestElig: UtilityV3DomainEligibility = "NOT_APPLICABLE";
    let bestCount = -1;
    for (const [e, c] of eligCounts) {
      if (c > bestCount) {
        bestElig = e;
        bestCount = c;
      }
    }
    eligibilityGlobal[d] = bestElig;
  }

  // Prefer stored V3 scores for ablation A when provided.
  if (input.mode === "A_v3_baseline" && input.v3DomainScores) {
    for (const d of DOMAIN_KEYS) {
      domainScoresRaw[d] = input.v3DomainScores[d] ?? null;
      domainScoresShrunk[d] = input.v3DomainScores[d] ?? null;
    }
  }

  const redistributed =
    input.mode === "B_no_redistribution" || input.mode === "F_combined_v3_1"
      ? null
      : (input.v3RedistributedWeights ??
        (redistributeBehaviorWeights(
          config.domainWeights as Record<UtilityV3DomainKey, number>,
          eligibilityGlobal as Record<UtilityV3DomainKey, UtilityV3DomainEligibility>,
        ) as Record<UtilityV3_1DomainKey, number>));

  let finalBehavior = behaviorScore;
  let contributions: Record<string, unknown> = {};

  if (input.mode === "A_v3_baseline" && input.v3DomainScores && input.v3RedistributedWeights) {
    finalBehavior = aggregateRedistributed(
      input.v3DomainScores,
      input.v3RedistributedWeights,
    );
    contributions = { mode: "v3_redistributed_from_artifacts" };
  } else if (input.mode === "B_no_redistribution" || input.mode === "F_combined_v3_1") {
    const agg = aggregateNeutralBaseline(
      domainScoresShrunk,
      input.mode === "B_no_redistribution" ? emptyDomainRecord(1) : reliabilityGlobal,
      config.domainWeights,
      eligibilityGlobal,
    );
    finalBehavior = agg.behaviorScore;
    contributions = agg.contributions;
  } else {
    finalBehavior = aggregateRedistributed(
      domainScoresShrunk,
      redistributed ?? config.domainWeights,
    );
    contributions = { mode: "redistributed", weights: redistributed };
  }

  const castStopsDetail =
    perRunScores.map((r) => r.castStopsDetail).find((x) => x != null) ?? null;
  // Merge support detail across runs
  let supportDetail: ReturnType<typeof scoreSupportV3_1> | null = null;
  {
    const allItems: UtilityV2EvidenceItem[] = [];
    let hours = 0;
    let playerActorId: number | null = null;
    for (const normalized of input.runs) {
      const runId = `${normalized.reportCode}:${normalized.fightId}`;
      const raw = input.rawByRunId.get(runId);
      if (!raw) continue;
      const master = input.masterByReport.get(normalized.reportCode);
      const evidence = auditUtilityV3Evidence({
        normalized,
        raw,
        masterActors: master?.actors ?? [],
      });
      allItems.push(...evidence.domains.support.items);
      hours += evidence.durationHours;
      playerActorId = normalized.playerActorId;
    }
    if (
      input.mode === "F_combined_v3_1" ||
      input.mode === "E_support_recalibration_only"
    ) {
      supportDetail = scoreSupportV3_1({
        items: allItems,
        durationHours: Math.max(hours, 1 / 60),
        playerActorId,
        config,
      });
    }
  }

  // Profile-level castStops detail with global stats
  const allCastItems: UtilityV2EvidenceItem[] = [];
  let totalHours = 0;
  for (const normalized of input.runs) {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId);
    if (!raw) continue;
    const master = input.masterByReport.get(normalized.reportCode);
    const evidence = auditUtilityV3Evidence({
      normalized,
      raw,
      masterActors: master?.actors ?? [],
    });
    allCastItems.push(...evidence.domains.castStops.items);
    totalHours += evidence.durationHours;
  }
  const profileCastStops =
    input.mode === "F_combined_v3_1" || input.mode === "D_caststop_recalibration_only"
      ? scoreCastStopsV3_1({
          tierCounts: allCastItems.reduce(
            (acc, i) => {
              acc[i.tier as UtilityV3EvidenceTier] += 1;
              return acc;
            },
            { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
          ),
          durationHours: Math.max(totalHours, 1 / 60),
          opportunityCount: totalOpportunities,
          confirmedStopsMatchingOpportunity: Math.max(
            0,
            totalOpportunities - totalMisses,
          ),
          confirmedMisses: totalMisses,
          dungeonCount,
          uniqueInterruptedSpells: new Set(
            allCastItems
              .map((i) => i.interruptedSpellId)
              .filter((x): x is number => x != null),
          ).size,
          uniqueTargets: new Set(
            allCastItems
              .map((i) => i.targetActorId)
              .filter((x): x is number => x != null && x > 0),
          ).size,
          config,
        })
      : castStopsDetail;

  const scoredDomainCount = DOMAIN_KEYS.filter(
    (d) => eligibilityGlobal[d] === "SCORED",
  ).length;
  const applicableDomainCount = DOMAIN_KEYS.filter(
    (d) => eligibilityGlobal[d] !== "NOT_APPLICABLE",
  ).length;

  const confidenceComponents = computeV3_1Confidence({
    dungeonCount,
    runCount,
    expectedDungeons: expected.length,
    scoredDomainCount,
    applicableDomainCount,
    opportunityCount: totalOpportunities,
    evidenceItemCount: totalEvidence,
    actorResolved: input.runs.every((r) => r.playerActorId != null),
    datasetsOkRatio: datasetsTotal > 0 ? datasetsOk / datasetsTotal : 0,
    artifactState,
    config,
  });

  const confidence =
    input.mode === "A_v3_baseline"
      ? confidenceComponents.raw // will be overwritten by caller with V3 confidence when available
      : confidenceComponents.capped;

  const compressionAudit = auditV3Compression({
    domainScores: domainScoresRaw,
    eligibility: eligibilityGlobal,
    originalWeights: config.domainWeights,
    dungeonCount,
    runCount,
  });

  return {
    mode: input.mode,
    behaviorScore: finalBehavior,
    confidence: round2(confidence),
    confidenceComponents,
    semanticBand: semanticBandForScore(finalBehavior, UTILITY_V3_SIMULATION_CONFIG),
    domainScoresRaw,
    domainScoresShrunk,
    reliability: reliabilityGlobal,
    reliabilityComponents: reliabilityComponentsGlobal,
    originalWeights: { ...config.domainWeights },
    redistributedWeights: redistributed,
    contributions,
    eligibility: eligibilityGlobal,
    castStopsDetail: profileCastStops,
    supportDetail,
    coverage: {
      runCount,
      dungeonCount,
      dungeons,
      opportunityCount: totalOpportunities,
      confirmedMisses: totalMisses,
    },
    compressionAudit,
  };
}
