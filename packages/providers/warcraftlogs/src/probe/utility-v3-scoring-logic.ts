import type { AbilityCatalog } from "@mplus/abilities";
import { getAbilityCatalog, spellIdsForCategory } from "@mplus/abilities";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import { equalWeightMean, median } from "./survival-calibration-logic.js";
import { activeSeasonDungeonPool } from "./survival-probe-logic.js";
import type { UtilityEventDataType, UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityV2DomainEvidenceSummary } from "./utility-v2-types.js";
import {
  UTILITY_V3_SIMULATION_CONFIG,
  type UtilityV3DomainEligibility,
  type UtilityV3DomainKey,
  type UtilityV3EvidenceTier,
  type UtilityV3SimulationConfig,
} from "./utility-v3-config.js";
import type {
  UtilityV3DomainRunScore,
  UtilityV3DungeonSimulation,
  UtilityV3RunSimulation,
  UtilityV3ScenarioOptions,
  UtilityV3SensitivityResult,
  UtilityV3SimulationDataset,
} from "./utility-v3-types.js";
import { auditUtilityV3Evidence } from "./utility-v3-evidence-logic.js";
import type { UtilityV2RawRunBundle } from "./utility-v2-types.js";

const DOMAIN_KEYS = Object.keys(
  UTILITY_V3_SIMULATION_CONFIG.domainWeights,
) as UtilityV3DomainKey[];

function emptyTierCounts(): Record<UtilityV3EvidenceTier, number> {
  return { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 };
}

function ruleSpellIds(rule: { spellIds: number[]; aliases?: number[] }): Set<number> {
  return new Set<number>([...rule.spellIds, ...(rule.aliases ?? [])]);
}

function casterControlSpellIdsFromCatalog(catalog: AbilityCatalog): Set<number> {
  const out = new Set<number>();
  for (const rule of catalog.rules) {
    if (!rule.canonicalKey.includes("caster-control")) continue;
    for (const id of ruleSpellIds(rule)) out.add(id);
  }
  return out;
}

function shadowmeldSpellIdsFromCatalog(catalog: AbilityCatalog): Set<number> {
  const out = new Set<number>();
  for (const rule of catalog.rules) {
    if (rule.name.toLowerCase() !== "shadowmeld") continue;
    for (const id of ruleSpellIds(rule)) out.add(id);
  }
  return out;
}

function demonicGatewaySpellIdsFromCatalog(catalog: AbilityCatalog): {
  castIds: Set<number>;
  auraIds: Set<number>;
} {
  const castIds = new Set<number>();
  const auraIds = new Set<number>();
  for (const rule of catalog.rules) {
    if (!rule.canonicalKey.includes("demonic-gateway") && rule.name !== "Demonic Gateway") continue;
    for (const id of rule.spellIds) castIds.add(id);
    for (const id of rule.aliases ?? []) auraIds.add(id);
  }
  return { castIds, auraIds };
}

function hasToolkit(
  domain: UtilityV3DomainKey,
  catalog: AbilityCatalog,
  classSlug: string | null,
  specSlug: string | null,
): boolean {
  const opts = { classSlug, specSlug };
  switch (domain) {
    case "castStops":
      return spellIdsForCategory(catalog, "INTERRUPT", opts).size > 0;
    case "casterControl":
      return casterControlSpellIdsFromCatalog(catalog).size > 0;
    case "strategicCc": {
      // Exclude caster-control (Tongues) spells from the strategic CC domain.
      const ccIds = new Set<number>([
        ...spellIdsForCategory(catalog, "HARD_CC", opts),
        ...spellIdsForCategory(catalog, "SOFT_CC", opts),
      ]);
      for (const id of casterControlSpellIdsFromCatalog(catalog)) ccIds.delete(id);
      return ccIds.size > 0;
    }
    case "mechanicAvoidance":
      return shadowmeldSpellIdsFromCatalog(catalog).size > 0;
    case "groupMobility":
      return demonicGatewaySpellIdsFromCatalog(catalog).castIds.size > 0;
    case "support":
      return (
        spellIdsForCategory(catalog, "DISPEL", opts).size > 0 ||
        spellIdsForCategory(catalog, "PURGE", opts).size > 0 ||
        spellIdsForCategory(catalog, "EXTERNAL_DEFENSIVE", opts).size > 0 ||
        spellIdsForCategory(catalog, "BATTLE_REZ", opts).size > 0
      );
    default:
      return false;
  }
}

function datasetsObservable(
  normalized: UtilityNormalizedRun,
  domain: UtilityV3DomainKey,
  config: UtilityV3SimulationConfig = UTILITY_V3_SIMULATION_CONFIG,
): { observable: boolean; reason: string } {
  const required = config.requiredDatasets[domain];
  for (const ds of required) {
    if (normalized.datasetStates[ds as UtilityEventDataType] !== "OK") {
      return { observable: false, reason: `dataset_${ds}_not_ok` };
    }
    if (normalized.truncatedDatasets.includes(ds as UtilityEventDataType)) {
      return { observable: false, reason: `dataset_${ds}_truncated` };
    }
  }
  return { observable: true, reason: "datasets_complete" };
}

function confirmedTierCount(tiers: Record<UtilityV3EvidenceTier, number>): number {
  return tiers.CONFIRMED_IMPACT + tiers.CONFIRMED_APPLICATION;
}

export function effectiveEventsPerHour(
  tierCounts: Record<UtilityV3EvidenceTier, number>,
  durationHours: number,
  config: UtilityV3SimulationConfig = UTILITY_V3_SIMULATION_CONFIG,
): number {
  const hours = Math.max(durationHours, 1 / 60);
  let weighted = 0;
  for (const tier of config.evidenceTiers) {
    weighted += tierCounts[tier] * config.tierWeights[tier];
  }
  return weighted / hours;
}

export function interpolateDomainCurve(
  effectivePerHour: number,
  domain: UtilityV3DomainKey,
  config: UtilityV3SimulationConfig = UTILITY_V3_SIMULATION_CONFIG,
): number {
  const points = config.domainCurves[domain].points;
  const rate = Math.max(0, effectivePerHour);
  if (rate <= points[0]!.effectivePerHour) return points[0]!.score;
  const last = points[points.length - 1]!;
  if (rate >= last.effectivePerHour) return last.score;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (rate >= a.effectivePerHour && rate <= b.effectivePerHour) {
      const t = (rate - a.effectivePerHour) / (b.effectivePerHour - a.effectivePerHour);
      return a.score + t * (b.score - a.score);
    }
  }
  return last.score;
}

export function determineDomainEligibility(input: {
  domain: UtilityV3DomainKey;
  normalized: UtilityNormalizedRun;
  summary: UtilityV2DomainEvidenceSummary;
  catalog: AbilityCatalog;
  config?: UtilityV3SimulationConfig;
}): { eligibility: UtilityV3DomainEligibility; reason: string } {
  const config = input.config ?? UTILITY_V3_SIMULATION_CONFIG;
  const classSlug = input.normalized.classSlug;
  const specSlug = input.normalized.specialization;

  if (!hasToolkit(input.domain, input.catalog, classSlug, specSlug)) {
    return { eligibility: "NOT_APPLICABLE", reason: "no_toolkit_for_class_spec" };
  }

  const ds = datasetsObservable(input.normalized, input.domain, config);
  if (!ds.observable) {
    return { eligibility: "NOT_OBSERVABLE", reason: ds.reason };
  }

  if (confirmedTierCount(input.summary.tierCounts) > 0) {
    return { eligibility: "SCORED", reason: "confirmed_tier_evidence_present" };
  }

  if (input.summary.items.length > 0 || input.summary.tierCounts.RAW_CAST > 0) {
    return {
      eligibility: "NO_CONFIRMED_CONTRIBUTION",
      reason: "observable_toolkit_raw_or_unconfirmed_only",
    };
  }

  return {
    eligibility: "NO_CONFIRMED_CONTRIBUTION",
    reason: "observable_toolkit_no_evidence_in_run",
  };
}

export function domainEvidenceContribution(
  tierCounts: Record<UtilityV3EvidenceTier, number>,
  domainScore: number,
  config: UtilityV3SimulationConfig = UTILITY_V3_SIMULATION_CONFIG,
): Record<UtilityV3EvidenceTier, number> {
  const totalWeighted = DOMAIN_KEYS.reduce((s, _d) => s, 0);
  void totalWeighted;
  const tierWeightSum =
    tierCounts.CONFIRMED_IMPACT * config.tierWeights.CONFIRMED_IMPACT +
    tierCounts.CONFIRMED_APPLICATION * config.tierWeights.CONFIRMED_APPLICATION +
    tierCounts.RAW_CAST * config.tierWeights.RAW_CAST;

  if (tierWeightSum <= 0) {
    return { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 };
  }

  return {
    CONFIRMED_IMPACT:
      (tierCounts.CONFIRMED_IMPACT * config.tierWeights.CONFIRMED_IMPACT * domainScore) /
      tierWeightSum,
    CONFIRMED_APPLICATION:
      (tierCounts.CONFIRMED_APPLICATION * config.tierWeights.CONFIRMED_APPLICATION * domainScore) /
      tierWeightSum,
    RAW_CAST:
      (tierCounts.RAW_CAST * config.tierWeights.RAW_CAST * domainScore) / tierWeightSum,
  };
}

export function domainConfidence(input: {
  eligibility: UtilityV3DomainEligibility;
  observability: UtilityV2DomainEvidenceSummary["observability"];
  tierCounts: Record<UtilityV3EvidenceTier, number>;
  datasetComplete: boolean;
  config?: UtilityV3SimulationConfig;
}): number {
  const config = input.config ?? UTILITY_V3_SIMULATION_CONFIG;
  if (input.eligibility === "NOT_APPLICABLE") return 100;
  if (input.eligibility === "NOT_OBSERVABLE") return 25;

  const obs =
    input.observability === "FULL"
      ? config.observabilityWeights.FULL
      : input.observability === "PARTIAL"
        ? config.observabilityWeights.PARTIAL
        : config.observabilityWeights.LIMITED;

  const confirmed = confirmedTierCount(input.tierCounts);
  const total =
    confirmed + input.tierCounts.RAW_CAST + (input.tierCounts.CONFIRMED_IMPACT === 0 ? 0 : 0);
  const tierQuality =
    total > 0
      ? (input.tierCounts.CONFIRMED_IMPACT * 1 +
          input.tierCounts.CONFIRMED_APPLICATION * 0.65 +
          input.tierCounts.RAW_CAST * 0.2) /
        (input.tierCounts.CONFIRMED_IMPACT +
          input.tierCounts.CONFIRMED_APPLICATION +
          input.tierCounts.RAW_CAST)
      : 0.35;

  const dataset = input.datasetComplete ? 1 : 0.5;
  return Math.round((obs * 0.45 + tierQuality * 0.35 + dataset * 0.2) * 100);
}

export function redistributeBehaviorWeights(
  baseWeights: Record<UtilityV3DomainKey, number>,
  eligibility: Record<UtilityV3DomainKey, UtilityV3DomainEligibility>,
): Record<UtilityV3DomainKey, number> {
  const out = { ...baseWeights };
  let removed = 0;
  for (const k of DOMAIN_KEYS) {
    if (eligibility[k] === "NOT_OBSERVABLE" || eligibility[k] === "NOT_APPLICABLE") {
      removed += out[k];
      out[k] = 0;
    }
  }
  const included = DOMAIN_KEYS.filter(
    (k) => eligibility[k] === "SCORED" || eligibility[k] === "NO_CONFIRMED_CONTRIBUTION",
  );
  if (included.length === 0 || removed <= 0) return out;
  const sum = included.reduce((s, k) => s + baseWeights[k], 0);
  for (const k of included) {
    out[k] = baseWeights[k] + (removed * baseWeights[k]) / sum;
  }
  return out;
}

export function semanticBandForScore(
  score: number,
  config: UtilityV3SimulationConfig = UTILITY_V3_SIMULATION_CONFIG,
): string {
  for (const band of config.semanticBands) {
    if (score >= band.min && score <= band.max) return band.label;
  }
  return "unknown";
}

/** Canonical global behavior: equal-weight mean of per-dungeon median run scores. */
export function canonicalGlobalBehaviorScore(
  perDungeon: Array<{ runCount: number; medianBehaviorScore: number | null }>,
): number | null {
  const values = perDungeon
    .filter((d) => d.runCount > 0)
    .map((d) => d.medianBehaviorScore);
  const mean = equalWeightMean(values);
  return mean != null ? Math.round(mean * 100) / 100 : null;
}

/** Canonical global confidence: equal-weight mean of per-dungeon median confidence. */
export function canonicalGlobalConfidence(
  perDungeon: Array<{ runCount: number; medianConfidence: number | null }>,
): number | null {
  const values = perDungeon
    .filter((d) => d.runCount > 0)
    .map((d) => d.medianConfidence);
  const mean = equalWeightMean(values);
  return mean != null ? Math.round(mean * 100) / 100 : null;
}

export function explainSemanticBand(
  behaviorScore: number,
  global: {
    aggregateTierCounts: Record<UtilityV3EvidenceTier, number>;
    domainScores: Record<UtilityV3DomainKey, number | null>;
    scoredVsExcludedDomains: UtilityV3SimulationDataset["global"]["scoredVsExcludedDomains"];
  },
  config: UtilityV3SimulationConfig = UTILITY_V3_SIMULATION_CONFIG,
): string {
  const band = semanticBandForScore(behaviorScore, config);
  const impact = global.aggregateTierCounts.CONFIRMED_IMPACT;
  const application = global.aggregateTierCounts.CONFIRMED_APPLICATION;
  const castStops = global.domainScores.castStops;
  const support = global.domainScores.support;
  const excluded = DOMAIN_KEYS.filter(
    (d) => global.scoredVsExcludedDomains.notObservable[d] > 0,
  ).length;

  return [
    `Behavior score ${behaviorScore.toFixed(2)} maps to band "${band}".`,
    `Confirmed impacts: ${impact}, applications: ${application}.`,
    castStops != null ? `Cast-stops domain ${castStops.toFixed(1)}.` : null,
    support != null ? `Support domain ${support.toFixed(1)}.` : null,
    excluded > 0
      ? `${excluded} domain(s) excluded as NOT_OBSERVABLE — not diluting behavior with placeholder 50.`
      : "All applicable domains observable.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function scoreUtilityV3Run(input: {
  normalized: UtilityNormalizedRun;
  domains: Record<UtilityV3DomainKey, UtilityV2DomainEvidenceSummary>;
  durationHours: number;
  missedInterruptOpportunities: number;
  catalog?: AbilityCatalog;
  options?: UtilityV3ScenarioOptions;
  config?: UtilityV3SimulationConfig;
}): Omit<
  UtilityV3RunSimulation,
  "runId" | "reportCode" | "fightId" | "dungeonSlug" | "durationMs"
> {
  const config = input.config ?? UTILITY_V3_SIMULATION_CONFIG;
  const catalog =
    input.catalog ??
    getAbilityCatalog({
      classSlug: input.normalized.classSlug,
      specSlug: input.normalized.specialization,
      includeRacials: true,
    });
  const curveMult = input.options?.curveMultiplier ?? 1;

  const weights: Record<UtilityV3DomainKey, number> = { ...config.domainWeights };
  if (input.options?.weightOverrides) {
    for (const [k, v] of Object.entries(input.options.weightOverrides) as [
      UtilityV3DomainKey,
      number,
    ][]) {
      weights[k] = v;
    }
    const sum = DOMAIN_KEYS.reduce((s, k) => s + weights[k], 0);
    if (sum > 0) for (const k of DOMAIN_KEYS) weights[k] /= sum;
  }

  const eligibility: Record<UtilityV3DomainKey, UtilityV3DomainEligibility> = {} as Record<
    UtilityV3DomainKey,
    UtilityV3DomainEligibility
  >;
  const eligibilityReason: Record<UtilityV3DomainKey, string> = {} as Record<
    UtilityV3DomainKey,
    string
  >;

  for (const d of DOMAIN_KEYS) {
    const det = determineDomainEligibility({
      domain: d,
      normalized: input.normalized,
      summary: input.domains[d],
      catalog,
      config,
    });
    eligibility[d] = det.eligibility;
    eligibilityReason[d] = det.reason;
  }

  const redistributedWeights = redistributeBehaviorWeights(weights, eligibility);

  const domainScores: Record<UtilityV3DomainKey, UtilityV3DomainRunScore> = {} as Record<
    UtilityV3DomainKey,
    UtilityV3DomainRunScore
  >;

  let behaviorWeighted = 0;
  let behaviorWeightSum = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const d of DOMAIN_KEYS) {
    const summary = input.domains[d];
    const elig = eligibility[d];
    const dsOk = datasetsObservable(input.normalized, d, config).observable;

    let domainScore: number | null = null;
    let effectivePerHour: number | null = null;
    let evidenceContribution = emptyTierCounts();

    if (elig === "SCORED") {
      effectivePerHour =
        effectiveEventsPerHour(summary.tierCounts, input.durationHours, config) * curveMult;
      domainScore = interpolateDomainCurve(effectivePerHour, d, config);
      evidenceContribution = domainEvidenceContribution(summary.tierCounts, domainScore, config);
    } else if (elig === "NO_CONFIRMED_CONTRIBUTION") {
      domainScore = config.noConfirmedContributionScore;
      effectivePerHour = 0;
    }

    if (domainScore != null && redistributedWeights[d]! > 0) {
      behaviorWeighted += domainScore * redistributedWeights[d]!;
      behaviorWeightSum += redistributedWeights[d]!;
    }

    const domConf = domainConfidence({
      eligibility: elig,
      observability: summary.observability,
      tierCounts: summary.tierCounts,
      datasetComplete: dsOk,
      config,
    });

    if (elig !== "NOT_APPLICABLE") {
      confidenceSum += domConf;
      confidenceCount += 1;
    }

    domainScores[d] = {
      domain: d,
      eligibility: elig,
      eligibilityReason: eligibilityReason[d]!,
      domainScore,
      effectivePerHour,
      tierCounts: { ...summary.tierCounts },
      observability:
        elig === "NOT_APPLICABLE" || elig === "NOT_OBSERVABLE"
          ? ("NOT_TRACKED" as const)
          : summary.observability === "NOT_APPLICABLE"
            ? ("NOT_TRACKED" as const)
            : (summary.observability as "FULL" | "PARTIAL" | "LIMITED"),
      confidence: domConf,
      redistributedWeight: redistributedWeights[d]! > 0 ? redistributedWeights[d]! : null,
      evidenceContribution,
    };
  }

  let behaviorScore = behaviorWeightSum > 0 ? behaviorWeighted / behaviorWeightSum : 50;

  if (
    input.options?.applyMissedOpportunityPenalty &&
    input.missedInterruptOpportunities > 0
  ) {
    const penalty = Math.min(
      config.missedOpportunity.maxPenaltyPoints,
      input.missedInterruptOpportunities * config.missedOpportunity.perMissedAvailableInterrupt,
    );
    behaviorScore = Math.max(config.missedOpportunity.floorScore, behaviorScore - penalty);
  }

  const confidence =
    confidenceCount > 0 ? Math.round((confidenceSum / confidenceCount) * 100) / 100 : 50;

  return {
    durationHours: input.durationHours,
    domains: domainScores,
    behaviorScore: Math.round(behaviorScore * 100) / 100,
    confidence,
    semanticBand: semanticBandForScore(behaviorScore, config),
    redistributedWeights,
    scoredDomainCount: DOMAIN_KEYS.filter((d) => eligibility[d] === "SCORED").length,
    excludedDomainCount: DOMAIN_KEYS.filter(
      (d) => eligibility[d] === "NOT_OBSERVABLE" || eligibility[d] === "NOT_APPLICABLE",
    ).length,
    missedInterruptOpportunities: input.missedInterruptOpportunities,
  };
}

export function buildUtilityV3SimulationDataset(input: {
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
  subject: UtilityV3SimulationDataset["subject"];
  scoredAt: string;
  config?: UtilityV3SimulationConfig;
}): UtilityV3SimulationDataset {
  const config = input.config ?? UTILITY_V3_SIMULATION_CONFIG;
  const expected = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);

  const runSimulations: UtilityV3RunSimulation[] = input.runs.map((normalized) => {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId)!;
    const master = input.masterByReport.get(normalized.reportCode);
    const evidence = auditUtilityV3Evidence({
      normalized,
      raw,
      masterActors: master?.actors ?? [],
    });
    const scored = scoreUtilityV3Run({
      normalized,
      domains: evidence.domains,
      durationHours: evidence.durationHours,
      missedInterruptOpportunities: evidence.missedInterruptOpportunities,
    });

    return {
      runId,
      reportCode: normalized.reportCode,
      fightId: normalized.fightId,
      dungeonSlug: normalized.dungeonSlug,
      durationMs: normalized.durationMs,
      ...scored,
    };
  });

  const evidenceInventory = input.runs.flatMap((normalized) => {
    const runId = `${normalized.reportCode}:${normalized.fightId}`;
    const raw = input.rawByRunId.get(runId)!;
    const master = input.masterByReport.get(normalized.reportCode);
    return auditUtilityV3Evidence({
      normalized,
      raw,
      masterActors: master?.actors ?? [],
    }).evidenceInventory;
  });

  const perDungeon: UtilityV3DungeonSimulation[] = expected.map((dungeonSlug) => {
    const runs = runSimulations.filter((r) => r.dungeonSlug === dungeonSlug);
    const eligibilitySummary = Object.fromEntries(
      DOMAIN_KEYS.map((d) => [
        d,
        {
          SCORED: 0,
          NOT_OBSERVABLE: 0,
          NOT_APPLICABLE: 0,
          NO_CONFIRMED_CONTRIBUTION: 0,
        },
      ]),
    ) as UtilityV3DungeonSimulation["eligibilitySummary"];

    for (const run of runs) {
      for (const d of DOMAIN_KEYS) {
        eligibilitySummary[d][run.domains[d].eligibility] += 1;
      }
    }

    const domainMedians = Object.fromEntries(
      DOMAIN_KEYS.map((d) => [
        d,
        median(
          runs
            .map((r) => r.domains[d].domainScore)
            .filter((s): s is number => s != null),
        ),
      ]),
    ) as Record<UtilityV3DomainKey, number | null>;

    return {
      dungeonSlug,
      runCount: runs.length,
      medianBehaviorScore: median(runs.map((r) => r.behaviorScore)),
      medianConfidence: median(runs.map((r) => r.confidence)),
      domainMedians,
      eligibilitySummary,
    };
  });

  const dungeonsWithRuns = perDungeon.filter((d) => d.runCount > 0);

  const aggregateTierCounts = emptyTierCounts();
  const scoredVsExcluded = {
    scored: Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 0])) as Record<
      UtilityV3DomainKey,
      number
    >,
    excluded: Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 0])) as Record<
      UtilityV3DomainKey,
      number
    >,
    notApplicable: Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 0])) as Record<
      UtilityV3DomainKey,
      number
    >,
    noConfirmedContribution: Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 0])) as Record<
      UtilityV3DomainKey,
      number
    >,
    notObservable: Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 0])) as Record<
      UtilityV3DomainKey,
      number
    >,
  };

  for (const run of runSimulations) {
    for (const d of DOMAIN_KEYS) {
      const dom = run.domains[d];
      for (const tier of config.evidenceTiers) {
        aggregateTierCounts[tier] += dom.tierCounts[tier];
      }
      if (dom.eligibility === "SCORED") scoredVsExcluded.scored[d] += 1;
      if (dom.eligibility === "NOT_APPLICABLE") scoredVsExcluded.notApplicable[d] += 1;
      if (dom.eligibility === "NOT_OBSERVABLE") scoredVsExcluded.notObservable[d] += 1;
      if (dom.eligibility === "NO_CONFIRMED_CONTRIBUTION") {
        scoredVsExcluded.noConfirmedContribution[d] += 1;
      }
      if (dom.eligibility === "NOT_OBSERVABLE" || dom.eligibility === "NOT_APPLICABLE") {
        scoredVsExcluded.excluded[d] += 1;
      }
    }
  }

  const domainScores = Object.fromEntries(
    DOMAIN_KEYS.map((d) => [
      d,
      equalWeightMean(
        dungeonsWithRuns.map((dungeon) => dungeon.domainMedians[d]).filter((s) => s != null),
      ),
    ]),
  ) as Record<UtilityV3DomainKey, number | null>;

  const behaviorScore = canonicalGlobalBehaviorScore(dungeonsWithRuns);
  const confidence = canonicalGlobalConfidence(dungeonsWithRuns);

  const evidenceContributionByType = emptyTierCounts();
  for (const run of runSimulations) {
    for (const d of DOMAIN_KEYS) {
      const contrib = run.domains[d].evidenceContribution;
      evidenceContributionByType.CONFIRMED_IMPACT += contrib.CONFIRMED_IMPACT;
      evidenceContributionByType.CONFIRMED_APPLICATION += contrib.CONFIRMED_APPLICATION;
      evidenceContributionByType.RAW_CAST += contrib.RAW_CAST;
    }
  }

  const globalRedistributed = redistributeBehaviorWeights(
    config.domainWeights,
    Object.fromEntries(
      DOMAIN_KEYS.map((d) => {
        const scoredRuns = runSimulations.filter((r) => r.domains[d].eligibility === "SCORED").length;
        const noConf = runSimulations.filter(
          (r) => r.domains[d].eligibility === "NO_CONFIRMED_CONTRIBUTION",
        ).length;
        const na = runSimulations.filter((r) => r.domains[d].eligibility === "NOT_APPLICABLE").length;
        const no = runSimulations.filter((r) => r.domains[d].eligibility === "NOT_OBSERVABLE").length;
        let elig: UtilityV3DomainEligibility = "NOT_OBSERVABLE";
        if (scoredRuns > no && scoredRuns > noConf) elig = "SCORED";
        else if (noConf > 0) elig = "NO_CONFIRMED_CONTRIBUTION";
        else if (na === runSimulations.length) elig = "NOT_APPLICABLE";
        return [d, elig];
      }),
    ) as Record<UtilityV3DomainKey, UtilityV3DomainEligibility>,
  );

  const globalPayload = {
    aggregateTierCounts,
    domainScores,
    scoredVsExcludedDomains: scoredVsExcluded,
  };

  const sensitivityAnalysis = runV3Sensitivity(runSimulations, perDungeon, config);

  return {
    simulationVersion: config.version,
    scoredAt: input.scoredAt,
    config,
    subject: input.subject,
    evidenceInventory,
    runSimulations,
    perDungeon,
    global: {
      behaviorScore,
      confidence,
      semanticBand: behaviorScore != null ? semanticBandForScore(behaviorScore, config) : "unknown",
      semanticExplanation:
        behaviorScore != null ? explainSemanticBand(behaviorScore, globalPayload, config) : "",
      runCount: runSimulations.length,
      dungeonCount: dungeonsWithRuns.length,
      scoredVsExcludedDomains: scoredVsExcluded,
      domainScores,
      redistributedWeights: globalRedistributed,
      evidenceContributionByType,
      aggregateTierCounts,
    },
    sensitivityAnalysis,
    diagnostics: {
      rejectedV2Reasons: [
        "V2 used baseline 50 for both neutral behavior and missing observability",
        "V2 domain maxima (~60–68) compressed strong utility toward neutral after weighting",
        "V2 included NOT_OBSERVABLE domains at weight 50, diluting confirmed evidence",
      ],
      notes: [...config.notes],
    },
  };
}

function runV3Sensitivity(
  runs: UtilityV3RunSimulation[],
  perDungeon: UtilityV3DungeonSimulation[],
  config: UtilityV3SimulationConfig,
): UtilityV3SensitivityResult[] {
  const baselineId = config.sensitivityScenarios[0]?.id ?? "baseline";
  let baselineBehavior: number | null = null;
  const results: UtilityV3SensitivityResult[] = [];

  for (const scenario of config.sensitivityScenarios) {
    const rescored = runs.map((run) => {
      let behavior = run.behaviorScore;
      if (scenario.curveMultiplier !== 1) {
        let weighted = 0;
        let sum = 0;
        for (const d of DOMAIN_KEYS) {
          const dom = run.domains[d];
          if (dom.eligibility !== "SCORED" && dom.eligibility !== "NO_CONFIRMED_CONTRIBUTION") {
            continue;
          }
          let score = dom.domainScore ?? config.noConfirmedContributionScore;
          if (dom.eligibility === "SCORED" && dom.effectivePerHour != null) {
            score = interpolateDomainCurve(
              dom.effectivePerHour * scenario.curveMultiplier,
              d,
              config,
            );
          }
          const w = run.redistributedWeights[d] ?? 0;
          weighted += score * w;
          sum += w;
        }
        behavior = sum > 0 ? weighted / sum : run.behaviorScore;
      }

      if ("weightOverrides" in scenario && scenario.weightOverrides) {
        const weights: Record<UtilityV3DomainKey, number> = {
          ...config.domainWeights,
          ...scenario.weightOverrides,
        };
        const sum = DOMAIN_KEYS.reduce((s, k) => s + weights[k], 0);
        if (sum > 0) for (const k of DOMAIN_KEYS) weights[k] /= sum;
        const eligibility = Object.fromEntries(
          DOMAIN_KEYS.map((d) => [d, run.domains[d].eligibility]),
        ) as Record<UtilityV3DomainKey, UtilityV3DomainEligibility>;
        const rw = redistributeBehaviorWeights(weights, eligibility);
        let weighted = 0;
        let wSum = 0;
        for (const d of DOMAIN_KEYS) {
          const score =
            run.domains[d].domainScore ??
            (run.domains[d].eligibility === "NO_CONFIRMED_CONTRIBUTION"
              ? config.noConfirmedContributionScore
              : null);
          if (score == null || !rw[d]) continue;
          weighted += score * rw[d]!;
          wSum += rw[d]!;
        }
        behavior = wSum > 0 ? weighted / wSum : behavior;
      }

      if (scenario.applyMissedOpportunityPenalty && run.missedInterruptOpportunities > 0) {
        const penalty = Math.min(
          config.missedOpportunity.maxPenaltyPoints,
          run.missedInterruptOpportunities * config.missedOpportunity.perMissedAvailableInterrupt,
        );
        behavior = Math.max(config.missedOpportunity.floorScore, behavior - penalty);
      }

      return Math.round(behavior * 100) / 100;
    });

    const dungeonMedians = perDungeon.map((d) => ({
      dungeonSlug: d.dungeonSlug,
      median: median(
        rescored.filter((_, i) => runs[i]?.dungeonSlug === d.dungeonSlug),
      ),
    }));

    const behaviorScore = canonicalGlobalBehaviorScore(
      dungeonMedians.map((d) => ({
        runCount: perDungeon.find((p) => p.dungeonSlug === d.dungeonSlug)?.runCount ?? 0,
        medianBehaviorScore: d.median,
      })),
    );
    const confidence = canonicalGlobalConfidence(
      perDungeon.filter((d) => d.runCount > 0),
    );

    if (scenario.id === baselineId) baselineBehavior = behaviorScore;

    results.push({
      scenarioId: scenario.id,
      label: scenario.label,
      behaviorScore,
      confidence,
      deltaBehaviorFromBaseline:
        baselineBehavior != null && behaviorScore != null
          ? Math.round((behaviorScore - baselineBehavior) * 100) / 100
          : null,
    });
  }

  return results;
}
