/**
 * Utility V3.2 scoring — opportunity-primary castStops, semantic support,
 * separated rawBehaviorEstimate / reliabilityAdjustedScore / confidence.
 */
import { getAbilityCatalog } from "@mplus/abilities";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityV2EvidenceItem, UtilityV2RawRunBundle } from "./utility-v2-types.js";
import { auditUtilityV3Evidence } from "./utility-v3-evidence-logic.js";
import {
  classifySupportSemantic,
  extractRunOpportunities,
} from "./utility-opportunity-engine.js";
import type { SupportSemanticClass, UtilityOpportunity } from "./utility-opportunity-types.js";
import {
  UTILITY_V3_2_SIMULATION_CONFIG,
  type UtilityV3_2DomainKey,
  type UtilityV3_2SimulationConfig,
} from "./utility-v3_2-config.js";
import {
  effectiveEventsPerHour,
  interpolateDomainCurve,
} from "./utility-v3-scoring-logic.js";
import type { UtilityV3EvidenceTier } from "./utility-v3-config.js";

const DOMAIN_KEYS = Object.keys(
  UTILITY_V3_2_SIMULATION_CONFIG.domainWeights,
) as UtilityV3_2DomainKey[];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function interpolate(
  x: number,
  points: ReadonlyArray<{ responseRate?: number; effectivePerHour?: number; score: number }>,
  key: "responseRate" | "effectivePerHour",
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

const SUCCESS_OUTCOMES = new Set([
  "SUCCESS_DIRECT_INTERRUPT",
  "SUCCESS_ALTERNATIVE_STOP",
  "SUCCESS_REACTIVE_SUPPORT",
  "SUCCESS_STRATEGIC_SUPPORT",
]);

const MISS_OUTCOMES = new Set([
  "CAST_COMPLETED_CONFIRMED_MISS",
  "SUPPORT_OPPORTUNITY_MISSED",
]);

export function scoreCastStopsFromOpportunities(
  opportunities: UtilityOpportunity[],
  fallback: {
    tierCounts: Record<UtilityV3EvidenceTier, number>;
    durationHours: number;
  },
  config: UtilityV3_2SimulationConfig = UTILITY_V3_2_SIMULATION_CONFIG,
): {
  rawScore: number;
  mode: "opportunity_primary" | "volume_fallback";
  responseRate: number | null;
  scoredOpportunities: number;
  successes: number;
  misses: number;
  missObservable: boolean;
  notes: string[];
} {
  const interruptOpps = opportunities.filter(
    (o) =>
      o.opportunityType === "interrupt" ||
      o.opportunityType === "stun_or_disorient_cast_stop",
  );
  const actionable = interruptOpps.filter(
    (o) =>
      (SUCCESS_OUTCOMES.has(o.outcome) || MISS_OUTCOMES.has(o.outcome)) &&
      o.confidence !== "LOW" &&
      o.outcome !== "SUCCESS_OTHER_PLAYER",
  );
  void actionable;

  // Other-player successes are excluded from player's response rate denominator
  const playerActionable = interruptOpps.filter(
    (o) =>
      o.outcome === "SUCCESS_DIRECT_INTERRUPT" ||
      o.outcome === "SUCCESS_ALTERNATIVE_STOP" ||
      o.outcome === "CAST_COMPLETED_CONFIRMED_MISS",
  );

  const missObservable = playerActionable.some(
    (o) =>
      o.derivation === "hostile_cast_window" ||
      o.derivation === "synthetic_fixture" ||
      o.outcome === "CAST_COMPLETED_CONFIRMED_MISS",
  );

  const notes: string[] = [];

  if (!missObservable || playerActionable.length === 0) {
    const eph = effectiveEventsPerHour(fallback.tierCounts, fallback.durationHours);
    let rawScore = interpolate(
      eph,
      config.castStopsVolumeFallback.points,
      "effectivePerHour",
    );
    rawScore = Math.min(config.castStopsVolumeFallback.maxScore, rawScore);
    if (fallback.tierCounts.CONFIRMED_IMPACT + fallback.tierCounts.CONFIRMED_APPLICATION === 0) {
      rawScore = config.noConfirmedContributionScore;
    }
    notes.push("no_miss_observable_denominator_volume_fallback");
    return {
      rawScore: round2(rawScore),
      mode: "volume_fallback",
      responseRate: null,
      scoredOpportunities: playerActionable.length,
      successes: playerActionable.filter((o) => SUCCESS_OUTCOMES.has(o.outcome)).length,
      misses: 0,
      missObservable: false,
      notes,
    };
  }

  let successWeight = 0;
  let missWeight = 0;
  for (const o of playerActionable) {
    const confMult = o.confidence === "HIGH" ? 1 : o.confidence === "MEDIUM" ? 0.75 : 0.4;
    const w = o.severity * confMult;
    if (o.outcome === "CAST_COMPLETED_CONFIRMED_MISS") missWeight += w;
    else successWeight += w;
  }
  const denom = successWeight + missWeight;
  const responseRate = denom > 0 ? successWeight / denom : 0;
  let rawScore = interpolate(
    responseRate,
    config.castStopsOpportunityCurve.points,
    "responseRate",
  );

  const highConf = playerActionable.filter((o) => o.confidence === "HIGH").length;
  const dungeons = new Set(playerActionable.map((o) => o.dungeonSlug)).size;
  const spells = new Set(
    playerActionable.map((o) => o.hostileSpellId).filter((x): x is number => x != null),
  ).size;
  const missShare = denom > 0 ? missWeight / denom : 0;

  if (rawScore >= 90) {
    const gates = config.castStopsOpportunityCurve;
    if (
      highConf < gates.minHighConfidenceOpportunitiesFor90 ||
      dungeons < gates.minDungeonsFor90 ||
      spells < gates.minDistinctHostileSpellsFor90 ||
      missShare > gates.maxConfirmedMissShareFor90
    ) {
      rawScore = Math.min(rawScore, 88);
      notes.push("90+_gated_insufficient_coverage_or_quality");
    }
  }

  return {
    rawScore: round2(rawScore),
    mode: "opportunity_primary",
    responseRate: round2(responseRate),
    scoredOpportunities: playerActionable.length,
    successes: playerActionable.filter((o) => SUCCESS_OUTCOMES.has(o.outcome)).length,
    misses: playerActionable.filter((o) => o.outcome === "CAST_COMPLETED_CONFIRMED_MISS")
      .length,
    missObservable: true,
    notes,
  };
}

export function scoreSupportFromSemantics(
  items: UtilityV2EvidenceItem[],
  durationHours: number,
  playerActorId: number | null,
  catalog = getAbilityCatalog({ classSlug: null, specSlug: null, includeRacials: true }),
  config: UtilityV3_2SimulationConfig = UTILITY_V3_2_SIMULATION_CONFIG,
): {
  rawScore: number;
  effectivePerHour: number;
  bySemantic: Record<SupportSemanticClass, number>;
  byAbility: Array<{
    abilityName: string | null;
    abilityGameID: number | null;
    semanticClass: SupportSemanticClass;
    count: number;
    effectiveWeight: number;
  }>;
  reactiveShare: number;
  notes: string[];
} {
  const bySemantic: Record<SupportSemanticClass, number> = {
    PERSONAL_MOBILITY: 0,
    ROUTINE_ROTATIONAL_SUPPORT: 0,
    PASSIVE_SUPPORT: 0,
    REACTIVE_SUPPORT: 0,
    STRATEGIC_SUPPORT: 0,
    EMERGENCY_SUPPORT: 0,
    UNVERIFIED_EXTERNAL: 0,
  };
  const abilityMap = new Map<
    string,
    {
      abilityName: string | null;
      abilityGameID: number | null;
      semanticClass: SupportSemanticClass;
      count: number;
      effectiveWeight: number;
    }
  >();

  let effective = 0;
  for (const item of items) {
    const semanticClass = classifySupportSemantic({
      abilityGameId: item.abilityGameID,
      abilityName: item.abilityName,
      kind: item.kind,
      tier: item.tier,
      targetActorId: item.targetActorId,
      playerActorId,
      correlationNotes: item.correlationNotes ?? [],
      catalog,
    });
    const mult = config.supportCredit[semanticClass];
    const tierMult =
      item.tier === "CONFIRMED_IMPACT" ? 1 : item.tier === "CONFIRMED_APPLICATION" ? 0.4 : 0.06;
    const weight = mult * tierMult;
    bySemantic[semanticClass] += weight;
    effective += weight;
    const key = `${item.abilityGameID}:${item.abilityName}:${semanticClass}`;
    const prev = abilityMap.get(key);
    if (prev) {
      prev.count += 1;
      prev.effectiveWeight += weight;
    } else {
      abilityMap.set(key, {
        abilityName: item.abilityName,
        abilityGameID: item.abilityGameID,
        semanticClass,
        count: 1,
        effectiveWeight: weight,
      });
    }
  }

  const hours = Math.max(durationHours, 1 / 60);
  const effectivePerHour = effective / hours;
  const reactive =
    bySemantic.REACTIVE_SUPPORT +
    bySemantic.STRATEGIC_SUPPORT +
    bySemantic.EMERGENCY_SUPPORT;
  const reactiveShare = effective > 0 ? reactive / effective : 0;
  const notes: string[] = [];

  let rawScore =
    effective <= 0
      ? config.noConfirmedContributionScore
      : interpolate(effectivePerHour, config.supportCurve.points, "effectivePerHour");

  if (reactiveShare < 0.35 && rawScore > config.supportCurve.maxScoreWhenMostlyRoutine) {
    rawScore = config.supportCurve.maxScoreWhenMostlyRoutine;
    notes.push("capped_mostly_routine_or_personal_or_unverified");
  }
  if (rawScore >= 88 && reactiveShare < config.supportCurve.minReactiveShareFor88) {
    rawScore = Math.min(rawScore, 86);
    notes.push("88+_requires_majority_reactive_or_strategic");
  }
  if (bySemantic.PERSONAL_MOBILITY > 0) {
    notes.push("personal_mobility_excluded_from_support");
  }

  return {
    rawScore: round2(rawScore),
    effectivePerHour: round2(effectivePerHour),
    bySemantic,
    byAbility: [...abilityMap.values()].sort((a, b) => b.effectiveWeight - a.effectiveWeight),
    reactiveShare: round2(reactiveShare),
    notes,
  };
}

export function computeReliability(input: {
  dungeonCount: number;
  runCount: number;
  missObservable: boolean;
  opportunityCount: number;
  config?: UtilityV3_2SimulationConfig;
}): number {
  const config = input.config ?? UTILITY_V3_2_SIMULATION_CONFIG;
  const d = clamp(input.dungeonCount / config.reliability.dungeonSaturation, 0, 1);
  const r = clamp(input.runCount / config.reliability.runSaturation, 0, 1);
  const opp = input.missObservable
    ? clamp(input.opportunityCount / 20, 0, 1)
    : 0.3;
  return round2(
    clamp(
      d * 0.45 + r * 0.3 + opp * 0.25,
      config.reliability.minReliability,
      1,
    ),
  );
}

export function computeV3_2Confidence(input: {
  dungeonCount: number;
  runCount: number;
  expectedDungeons: number;
  eventCompleteness: number;
  opportunityObservability: number;
  actorResolved: boolean;
  mechanicCatalogCoverage: number;
  abilityCatalogCoverage: number;
  datasetIntegrity: number;
  artifactState: "COMPLETE" | "PARTIAL" | "NONE";
  config?: UtilityV3_2SimulationConfig;
}): { components: Record<string, number>; confidence: number } {
  const config = input.config ?? UTILITY_V3_2_SIMULATION_CONFIG;
  const w = config.confidence.weights;
  const components = {
    dungeonCoverage: clamp(input.dungeonCount / input.expectedDungeons, 0, 1),
    runCoverage: clamp(input.runCount / 8, 0, 1),
    eventCompleteness: clamp(input.eventCompleteness, 0, 1),
    opportunityObservability: clamp(input.opportunityObservability, 0, 1),
    actorResolution: input.actorResolved ? 1 : 0.4,
    mechanicCatalogCoverage: clamp(input.mechanicCatalogCoverage, 0, 1),
    abilityCatalogCoverage: clamp(input.abilityCatalogCoverage, 0, 1),
    datasetIntegrity: clamp(input.datasetIntegrity, 0, 1),
  };
  let confidence =
    (components.dungeonCoverage * w.dungeonCoverage +
      components.runCoverage * w.runCoverage +
      components.eventCompleteness * w.eventCompleteness +
      components.opportunityObservability * w.opportunityObservability +
      components.actorResolution * w.actorResolution +
      components.mechanicCatalogCoverage * w.mechanicCatalogCoverage +
      components.abilityCatalogCoverage * w.abilityCatalogCoverage +
      components.datasetIntegrity * w.datasetIntegrity) *
    100;
  if (input.artifactState !== "COMPLETE") {
    confidence = Math.min(confidence, config.confidence.maxWhenPartial);
  }
  if (input.dungeonCount < config.confidence.tinyDungeonThreshold) {
    confidence = Math.min(confidence, config.confidence.maxWhenTinySample);
  }
  return {
    components: Object.fromEntries(
      Object.entries(components).map(([k, v]) => [k, round2(v)]),
    ),
    confidence: round2(confidence),
  };
}

export interface V3_2ScoreResult {
  rawBehaviorEstimate: number;
  reliabilityAdjustedScore: number;
  confidence: number;
  confidenceComponents: Record<string, number>;
  reliability: number;
  domainRaw: Record<UtilityV3_2DomainKey, number | null>;
  castStops: ReturnType<typeof scoreCastStopsFromOpportunities>;
  support: ReturnType<typeof scoreSupportFromSemantics> | null;
  opportunities: UtilityOpportunity[];
  coverage: { runCount: number; dungeonCount: number; dungeons: string[] };
}

export function scoreProfileV3_2(input: {
  runs: UtilityNormalizedRun[];
  rawByRunId: Map<string, UtilityV2RawRunBundle>;
  masterByReport: Map<
    string,
    {
      actors: Array<{
        id: number;
        name?: string;
        type: string;
        subType?: string | null;
        petOwner?: number | null;
      }>;
    }
  >;
  opportunities?: UtilityOpportunity[];
  config?: UtilityV3_2SimulationConfig;
}): V3_2ScoreResult {
  const config = input.config ?? UTILITY_V3_2_SIMULATION_CONFIG;
  const dungeons = [...new Set(input.runs.map((r) => r.dungeonSlug))];
  const allOpps: UtilityOpportunity[] = input.opportunities
    ? [...input.opportunities]
    : [];

  if (!input.opportunities) {
    for (const normalized of input.runs) {
      const runId = `${normalized.reportCode}:${normalized.fightId}`;
      const raw = input.rawByRunId.get(runId);
      allOpps.push(
        ...extractRunOpportunities({
          normalized,
          raw,
          castEvents: raw?.casts,
          interruptEvents: raw?.interrupts,
        }),
      );
    }
  }

  // Aggregate evidence for support / fallback castStops
  const supportItems: UtilityV2EvidenceItem[] = [];
  let totalHours = 0;
  const castTier = {
    CONFIRMED_IMPACT: 0,
    CONFIRMED_APPLICATION: 0,
    RAW_CAST: 0,
  };
  let playerActorId: number | null = null;

  for (const normalized of input.runs) {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId);
    if (!raw) continue;
    const master = input.masterByReport.get(normalized.reportCode);
    const evidence = auditUtilityV3Evidence({
      normalized,
      raw,
      masterActors: (master?.actors ?? []).map((a) => ({
        id: a.id,
        name: a.name ?? `actor-${a.id}`,
        type: a.type,
        subType: a.subType,
        petOwner: a.petOwner,
      })),
    });
    supportItems.push(...evidence.domains.support.items);
    totalHours += evidence.durationHours;
    castTier.CONFIRMED_IMPACT += evidence.domains.castStops.tierCounts.CONFIRMED_IMPACT;
    castTier.CONFIRMED_APPLICATION +=
      evidence.domains.castStops.tierCounts.CONFIRMED_APPLICATION;
    castTier.RAW_CAST += evidence.domains.castStops.tierCounts.RAW_CAST;
    playerActorId = normalized.playerActorId;
  }

  const castStops = scoreCastStopsFromOpportunities(allOpps, {
    tierCounts: castTier,
    durationHours: Math.max(totalHours, 1 / 60),
  }, config);

  const support = scoreSupportFromSemantics(
    supportItems,
    Math.max(totalHours, 1 / 60),
    playerActorId,
    getAbilityCatalog({
      classSlug: input.runs[0]?.classSlug,
      specSlug: input.runs[0]?.specialization,
      includeRacials: true,
    }),
    config,
  );

  // Other domains: reuse V3 absolute curves on audited evidence (neutral aggregation)
  const domainRaw = {
    castStops: castStops.rawScore,
    casterControl: null as number | null,
    strategicCc: 50,
    mechanicAvoidance: 50,
    groupMobility: null as number | null,
    support: support.rawScore,
  } as Record<UtilityV3_2DomainKey, number | null>;

  // Fill other scored domains from first-run style median via V3 curves when evidence exists
  for (const normalized of input.runs.slice(0, 1)) {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId);
    if (!raw) continue;
    const master = input.masterByReport.get(normalized.reportCode);
    const evidence = auditUtilityV3Evidence({
      normalized,
      raw,
      masterActors: (master?.actors ?? []).map((a) => ({
        id: a.id,
        name: a.name ?? `actor-${a.id}`,
        type: a.type,
        subType: a.subType,
        petOwner: a.petOwner,
      })),
    });
    for (const d of ["casterControl", "strategicCc", "mechanicAvoidance", "groupMobility"] as const) {
      const tiers = evidence.domains[d].tierCounts;
      const confirmed = tiers.CONFIRMED_IMPACT + tiers.CONFIRMED_APPLICATION;
      if (confirmed > 0) {
        const eph = effectiveEventsPerHour(tiers, evidence.durationHours);
        domainRaw[d] = round2(interpolateDomainCurve(eph, d));
      } else if (
        d === "casterControl" ||
        d === "groupMobility"
      ) {
        // leave null if typically N/A — treat as neutral in aggregation
        domainRaw[d] = null;
      } else {
        domainRaw[d] = 50;
      }
    }
  }

  const reliability = computeReliability({
    dungeonCount: dungeons.length,
    runCount: input.runs.length,
    missObservable: castStops.missObservable,
    opportunityCount: castStops.scoredOpportunities,
    config,
  });

  // Neutral baseline aggregation for raw behavior
  let deviationSum = 0;
  for (const d of DOMAIN_KEYS) {
    const w = config.domainWeights[d];
    const score = domainRaw[d] ?? 50;
    deviationSum += w * (score - 50);
  }
  const rawBehaviorEstimate = round2(50 + deviationSum);
  const reliabilityAdjustedScore = round2(
    50 + reliability * (rawBehaviorEstimate - 50),
  );

  const artifactState =
    input.runs.length === 0
      ? "NONE"
      : dungeons.length >= 8
        ? "COMPLETE"
        : "PARTIAL";

  const conf = computeV3_2Confidence({
    dungeonCount: dungeons.length,
    runCount: input.runs.length,
    expectedDungeons: 8,
    eventCompleteness: totalHours > 0 ? 0.85 : 0.2,
    opportunityObservability: castStops.missObservable
      ? clamp(castStops.scoredOpportunities / 20, 0.4, 1)
      : 0.25,
    actorResolved: input.runs.every((r) => r.playerActorId != null),
    mechanicCatalogCoverage: 0.15, // seed/empty catalog
    abilityCatalogCoverage: 0.9,
    datasetIntegrity: 0.85,
    artifactState,
    config,
  });

  return {
    rawBehaviorEstimate,
    reliabilityAdjustedScore,
    confidence: conf.confidence,
    confidenceComponents: conf.components,
    reliability,
    domainRaw,
    castStops,
    support,
    opportunities: allOpps,
    coverage: {
      runCount: input.runs.length,
      dungeonCount: dungeons.length,
      dungeons,
    },
  };
}
