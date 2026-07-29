/**
 * Utility V3.2 OBSERVED_CONTRIBUTION — production-candidate scoring mode.
 *
 * One-sided observed-positive-contribution score:
 * - directly observed useful actions may raise the score above neutral (50)
 * - absence of an observed action must not lower any domain or aggregate below 50
 * - zero attributable evidence ⇒ 50 with low confidence
 * - never measures missed opportunities / unobservable non-actions
 * - never credits SUCCESS_OTHER_PLAYER
 *
 * OPPORTUNITY_RESEARCH remains separate and must not feed the public score.
 */
import { getAbilityCatalog, spellIdsForCategory } from "@mplus/abilities";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityOpportunity } from "./utility-opportunity-types.js";
import type { UtilityV2EvidenceItem, UtilityV2RawRunBundle } from "./utility-v2-types.js";
import { classifySupportSemantic } from "./utility-opportunity-engine.js";
import { auditUtilityV3Evidence } from "./utility-v3-evidence-logic.js";
import {
  UTILITY_V3_2_OBSERVED_CONFIG,
  type UtilityV3_2ObservedConfig,
  type ObservedDomainKey,
} from "./utility-v3_2-observed-config.js";
import {
  estimateActiveCombatMs,
  activeCombatHours,
  type ActiveCombatEstimate,
} from "./utility-active-combat.js";
import { UTILITY_OBSERVED_SCORE_SEMANTICS } from "./utility-observed-semantics.js";

export type UtilityScoringMode = "OBSERVED_CONTRIBUTION" | "OPPORTUNITY_RESEARCH";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function interpolatePerHour(
  rate: number,
  points: ReadonlyArray<{ perHour: number; score: number }>,
): number {
  const x = Math.max(0, rate);
  if (x <= points[0]!.perHour) return points[0]!.score;
  const last = points[points.length - 1]!;
  if (x >= last.perHour) return last.score;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (x >= a.perHour && x <= b.perHour) {
      const t = (x - a.perHour) / (b.perHour - a.perHour);
      return a.score + t * (b.score - a.score);
    }
  }
  return last.score;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/** One-sided: never below neutral. */
function floorNeutral(score: number, floor: number): number {
  return Math.max(floor, score);
}

export interface ObservedEventExplanation {
  id: string;
  domain: ObservedDomainKey | "support_other";
  outcome: string;
  abilityGameId: number | null;
  hostileSpellId: number | null;
  dungeonSlug: string;
  runId: string;
  note: string;
}

export interface ObservedDomainBreakdown {
  domain: ObservedDomainKey;
  applicable: boolean;
  rawScore: number | null;
  weight: number;
  weightShare: number;
  uncappedContribution: number;
  cappedContribution: number;
  capApplied: boolean;
  events: number;
  perCombatHour: number | null;
  notes: string[];
}

export interface ObservedContributionResult {
  mode: "OBSERVED_CONTRIBUTION";
  productionCandidate: true;
  scoreKind: typeof UTILITY_OBSERVED_SCORE_SEMANTICS.scoreKind;
  rawBehaviorEstimate: number;
  reliabilityAdjustedScore: number;
  confidence: number;
  confidenceComponents: Record<string, number>;
  reliability: number;
  domainBreakdown: ObservedDomainBreakdown[];
  explanations: ObservedEventExplanation[];
  context: {
    runCount: number;
    dungeonCount: number;
    dungeons: string[];
    combatHours: number;
    fightDurationHours: number;
    activeCombatEstimate: ActiveCombatEstimate | null;
    hostileCastWindows: number;
    playerInterruptSuccesses: number;
    playerDispelPurgeSuccesses: number;
    playerStrategicCcSuccesses: number;
    playerSupportEvents: number;
    attributableEvents: number;
    toolkit: {
      hasInterrupt: boolean;
      hasDispel: boolean;
      hasPurge: boolean;
      hasHardCc: boolean;
    };
  };
  denominatorChoice: {
    selected: string;
    rejected: Array<{ option: string; reason: string }>;
  };
  researchModeExcluded: string[];
}

function collectHostileTimestamps(
  opportunities: UtilityOpportunity[],
  rawByRunId: Map<string, UtilityV2RawRunBundle>,
  hostileCastEventsByRun?: Map<string, Array<Record<string, unknown>>>,
): number[] {
  const ts: number[] = [];
  if (hostileCastEventsByRun) {
    for (const events of hostileCastEventsByRun.values()) {
      for (const e of events) {
        const t = Number(e.timestamp);
        if (Number.isFinite(t)) ts.push(t);
      }
    }
    if (ts.length) return ts;
  }
  for (const o of opportunities) {
    if (o.opportunityType === "interrupt" && o.openedAt != null) ts.push(o.openedAt);
  }
  for (const raw of rawByRunId.values()) {
    const casts = (raw.casts as Array<Record<string, unknown>> | undefined) ?? [];
    for (const e of casts) {
      const src = (e.source as { type?: string } | undefined)?.type?.toLowerCase();
      if (src === "npc" || src === "boss") {
        const t = Number(e.timestamp);
        if (Number.isFinite(t)) ts.push(t);
      }
    }
  }
  return ts;
}

function countHostileBegincasts(
  opportunities: UtilityOpportunity[],
  rawByRunId: Map<string, UtilityV2RawRunBundle>,
  hostileCastEventsByRun?: Map<string, Array<Record<string, unknown>>>,
): number {
  const fromWindows = opportunities.filter(
    (o) =>
      o.opportunityType === "interrupt" &&
      (o.derivation === "hostile_cast_window" || o.derivation === "success_only_implied"),
  ).length;
  if (fromWindows > 0) return fromWindows;

  let n = 0;
  if (hostileCastEventsByRun) {
    for (const events of hostileCastEventsByRun.values()) {
      n += events.filter((e) => String(e.type) === "begincast").length;
    }
    return n;
  }
  for (const raw of rawByRunId.values()) {
    const casts = (raw.casts as Array<Record<string, unknown>> | undefined) ?? [];
    n += casts.filter((e) => {
      const t = (e.source as { type?: string } | undefined)?.type?.toLowerCase();
      return String(e.type) === "begincast" && (t === "npc" || t === "boss");
    }).length;
  }
  return n;
}

/**
 * Score OBSERVED_CONTRIBUTION production candidate from positively observed player events.
 */
export function scoreObservedContribution(input: {
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
  opportunities: UtilityOpportunity[];
  mechanicCatalogCoverageObserved?: number;
  hostileCastEventsByRun?: Map<string, Array<Record<string, unknown>>>;
  config?: UtilityV3_2ObservedConfig;
}): ObservedContributionResult {
  const config = input.config ?? UTILITY_V3_2_OBSERVED_CONFIG;
  const floor = config.scoreFloor;
  const runs = input.runs;
  const dungeons = [...new Set(runs.map((r) => r.dungeonSlug))];
  const fightDurationMs = runs.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  const fightDurationHours = Math.max(fightDurationMs / 3_600_000, 1 / 60);

  const hostileTs = collectHostileTimestamps(
    input.opportunities,
    input.rawByRunId,
    input.hostileCastEventsByRun,
  );
  const activeCombatEstimate =
    runs.length > 0
      ? estimateActiveCombatMs({
          fightDurationMs,
          hostileEventTimestampsMs: hostileTs,
        })
      : null;
  const hours = activeCombatEstimate
    ? activeCombatHours(activeCombatEstimate)
    : fightDurationHours;

  const classSlug = runs[0]?.classSlug ?? null;
  const specSlug = runs[0]?.specialization ?? null;
  const catalog = getAbilityCatalog({
    classSlug,
    specSlug,
    includeRacials: true,
  });

  const hasInterrupt = spellIdsForCategory(catalog, "INTERRUPT", { classSlug, specSlug }).size > 0;
  const hasDispel = spellIdsForCategory(catalog, "DISPEL", { classSlug, specSlug }).size > 0;
  const hasPurge = spellIdsForCategory(catalog, "PURGE", { classSlug, specSlug }).size > 0;
  const hasHardCc = spellIdsForCategory(catalog, "HARD_CC", { classSlug, specSlug }).size > 0;

  const playerInterrupts = input.opportunities.filter(
    (o) =>
      (o.outcome === "SUCCESS_DIRECT_INTERRUPT" || o.outcome === "SUCCESS_ALTERNATIVE_STOP") &&
      o.opportunityType === "interrupt",
  );
  const playerDispelPurge = input.opportunities.filter(
    (o) =>
      o.outcome === "SUCCESS_REACTIVE_SUPPORT" &&
      (o.opportunityType === "dispel" || o.opportunityType === "purge"),
  );

  let playerCc = 0;
  const ccExplanations: ObservedEventExplanation[] = [];
  for (const run of runs) {
    for (const ev of run.ccEvents ?? []) {
      if (ev.sourceKind !== "PLAYER" && ev.sourceKind !== "OWNED_PET") continue;
      playerCc += 1;
      ccExplanations.push({
        id: `${run.reportCode}:${run.fightId}:cc:${ev.timestamp}:${ev.abilityGameID}`,
        domain: "strategicCc",
        outcome: "SUCCESS_STRATEGIC_CC",
        abilityGameId: ev.abilityGameID,
        hostileSpellId: null,
        dungeonSlug: run.dungeonSlug,
        runId: `${run.reportCode}:${run.fightId}`,
        note: "Player/pet CC cast observed in normalized stream",
      });
    }
  }

  const supportItems: UtilityV2EvidenceItem[] = [];
  let playerActorId: number | null = null;
  for (const normalized of runs) {
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
    playerActorId = normalized.playerActorId;
  }

  let supportCredit = 0;
  const supportExplanations: ObservedEventExplanation[] = [];
  for (const item of supportItems) {
    const semantic = classifySupportSemantic({
      abilityGameId: item.abilityGameID,
      abilityName: item.abilityName,
      kind: item.kind,
      tier: item.tier,
      targetActorId: item.targetActorId,
      playerActorId,
      correlationNotes: item.correlationNotes ?? [],
      catalog,
    });
    const credit = config.supportSemanticCredit[semantic] ?? 0;
    if (credit <= 0) continue;
    const tierMult =
      item.tier === "CONFIRMED_IMPACT" ? 1 : item.tier === "CONFIRMED_APPLICATION" ? 0.45 : 0;
    if (tierMult <= 0) continue;
    supportCredit += credit * tierMult;
    supportExplanations.push({
      id: item.id,
      domain: "support",
      outcome: `SUPPORT_${semantic}`,
      abilityGameId: item.abilityGameID,
      hostileSpellId: null,
      dungeonSlug: "aggregated",
      runId: "support-evidence",
      note: `Directly observed support (${semantic}, ${item.tier})`,
    });
  }

  supportCredit += playerDispelPurge.length * config.dispelPurgeEventCredit;
  const diminishedSupport =
    supportCredit <= 0 ? 0 : Math.pow(supportCredit, config.support.diminishingExponent);

  const hostileWindows = countHostileBegincasts(
    input.opportunities,
    input.rawByRunId,
    input.hostileCastEventsByRun,
  );

  const interruptPerHour = playerInterrupts.length / hours;
  const supportPerHour = diminishedSupport / hours;
  const ccPerHour = playerCc / hours;

  const hostileDensity = hostileWindows / hours;
  const interruptDensityFactor = !hasInterrupt
    ? 0
    : clamp(hostileDensity / config.castStops.minHostileCastsPerHourForFullCredit, 0.35, 1);

  const domainBreakdown: ObservedDomainBreakdown[] = [];

  {
    const notes: string[] = [];
    let raw: number | null = floor;
    let applicable = true;
    if (!hasInterrupt) {
      applicable = false;
      raw = null;
      notes.push("toolkit_interrupt_absent_domain_neutral");
    } else if (playerInterrupts.length === 0 && runs.length > 0) {
      raw = config.zeroContributionScore;
      notes.push("zero_observed_interrupt_successes_remain_neutral");
    } else {
      raw = interpolatePerHour(interruptPerHour, config.castStops.perCombatHourCurve);
      raw = floor + (raw - floor) * interruptDensityFactor;
      raw = floorNeutral(raw, floor);
      notes.push(
        `denominator=player_interrupt_successes_per_active_combat_hour; hostile_density_factor=${round2(interruptDensityFactor)}`,
      );
    }
    domainBreakdown.push({
      domain: "castStops",
      applicable,
      rawScore: raw == null ? null : round2(raw),
      weight: config.domainWeights.castStops,
      weightShare: 0,
      uncappedContribution: 0,
      cappedContribution: 0,
      capApplied: false,
      events: playerInterrupts.length,
      perCombatHour: applicable ? round2(interruptPerHour) : null,
      notes,
    });
  }

  {
    const notes: string[] = [];
    const toolkitSupport = hasDispel || hasPurge || supportCredit > 0;
    let raw: number | null = floor;
    let applicable = true;
    if (!toolkitSupport && playerDispelPurge.length === 0 && supportCredit === 0) {
      applicable = false;
      raw = null;
      notes.push("no_support_toolkit_and_no_observed_support_neutral");
    } else if (supportCredit === 0) {
      raw = config.zeroContributionScore;
      notes.push("zero_observed_support_credit_remain_neutral");
    } else {
      raw = floorNeutral(
        interpolatePerHour(supportPerHour, config.support.perCombatHourCurve),
        floor,
      );
      notes.push(
        `denominator=diminished_player_support_credit_per_active_combat_hour; exponent=${config.support.diminishingExponent}; SUCCESS_OTHER_PLAYER excluded`,
      );
    }
    domainBreakdown.push({
      domain: "support",
      applicable,
      rawScore: raw == null ? null : round2(raw),
      weight: config.domainWeights.support,
      weightShare: 0,
      uncappedContribution: 0,
      cappedContribution: 0,
      capApplied: false,
      events: playerDispelPurge.length + supportExplanations.length,
      perCombatHour: applicable ? round2(supportPerHour) : null,
      notes,
    });
  }

  {
    const notes: string[] = [];
    let raw: number | null = floor;
    let applicable = true;
    if (!hasHardCc) {
      applicable = false;
      raw = null;
      notes.push("toolkit_hard_cc_absent_domain_neutral");
    } else if (playerCc === 0) {
      raw = config.zeroContributionScore;
      notes.push("zero_observed_cc_casts_remain_neutral");
    } else {
      raw = floorNeutral(
        interpolatePerHour(ccPerHour, config.strategicCc.perCombatHourCurve),
        floor,
      );
      notes.push("denominator=player_cc_casts_per_active_combat_hour");
    }
    domainBreakdown.push({
      domain: "strategicCc",
      applicable,
      rawScore: raw == null ? null : round2(raw),
      weight: config.domainWeights.strategicCc,
      weightShare: 0,
      uncappedContribution: 0,
      cappedContribution: 0,
      capApplied: false,
      events: playerCc,
      perCombatHour: applicable ? round2(ccPerHour) : null,
      notes,
    });
  }

  const activeWeights = domainBreakdown
    .filter((d) => d.applicable)
    .reduce((s, d) => s + d.weight, 0);

  for (const d of domainBreakdown) {
    if (!d.applicable) {
      d.weightShare = 0;
      d.uncappedContribution = 0;
      d.cappedContribution = 0;
      d.capApplied = false;
      continue;
    }
    const share = activeWeights > 0 ? d.weight / activeWeights : 0;
    const uncapped = share * ((d.rawScore ?? floor) - floor);
    const nonNeg = Math.max(0, uncapped);
    const capped = clamp(nonNeg, 0, config.domainContributionCap);
    d.weightShare = round2(share);
    d.uncappedContribution = round2(uncapped);
    d.cappedContribution = round2(capped);
    d.capApplied = Math.abs(nonNeg - capped) > 1e-9;
    d.notes.push(`weight_share=${round2(share)}; contribution_capped_after_share`);
  }

  const deviation = domainBreakdown
    .filter((d) => d.applicable)
    .reduce((s, d) => s + d.cappedContribution, 0);

  const rawBehaviorEstimate = round2(floorNeutral(floor + deviation, floor));

  const attributableEvents =
    playerInterrupts.length + playerDispelPurge.length + playerCc + supportExplanations.length;

  const reliability = clamp(
    0.25 * clamp(dungeons.length / config.confidence.expectedDungeons, 0, 1) +
      0.2 * clamp(runs.length / config.confidence.runSaturation, 0, 1) +
      0.25 * clamp(hours / config.confidence.combatHourSaturation, 0, 1) +
      0.3 * clamp(attributableEvents / config.confidence.attributableEventSaturation, 0, 1),
    config.reliability.minReliability,
    1,
  );

  const reliabilityAdjustedScore = round2(
    floorNeutral(floor + reliability * (rawBehaviorEstimate - floor), floor),
  );

  const confComponents = {
    dungeonCoverage: clamp(dungeons.length / config.confidence.expectedDungeons, 0, 1),
    runCoverage: clamp(runs.length / config.confidence.runSaturation, 0, 1),
    combatDuration: clamp(hours / config.confidence.combatHourSaturation, 0, 1),
    attributableEvents: clamp(
      attributableEvents / config.confidence.attributableEventSaturation,
      0,
      1,
    ),
    mechanicCatalogCoverageObserved: clamp(input.mechanicCatalogCoverageObserved ?? 0, 0, 1),
    sourceCompleteness: clamp(
      (runs.length > 0 ? 0.4 : 0) +
        (hostileWindows > 0 ? 0.3 : 0) +
        (attributableEvents > 0 ? 0.3 : 0),
      0,
      1,
    ),
  };
  const w = config.confidence.weights;
  let confidence =
    (confComponents.dungeonCoverage * w.dungeonCoverage +
      confComponents.runCoverage * w.runCoverage +
      confComponents.combatDuration * w.combatDuration +
      confComponents.attributableEvents * w.attributableEvents +
      confComponents.mechanicCatalogCoverageObserved * w.mechanicCatalogCoverageObserved +
      confComponents.sourceCompleteness * w.sourceCompleteness) *
    100;

  if (runs.length < config.confidence.tinyRunThreshold) {
    confidence = Math.min(confidence, config.confidence.maxWhenTinySample);
  }
  if (dungeons.length < config.confidence.expectedDungeons) {
    confidence = Math.min(confidence, config.confidence.maxWhenPartialDungeons);
  }
  if (attributableEvents === 0) {
    confidence = Math.min(confidence, config.confidence.maxWhenZeroAttributable);
  }
  for (const gate of config.confidence.maxWhenMechanicCatalogBelow) {
    if (confComponents.mechanicCatalogCoverageObserved < gate.below) {
      confidence = Math.min(confidence, gate.maxConfidence);
      break;
    }
  }

  const explanations: ObservedEventExplanation[] = [
    ...playerInterrupts.slice(0, 40).map((o) => ({
      id: o.id,
      domain: "castStops" as const,
      outcome: o.outcome,
      abilityGameId: o.abilityGameId,
      hostileSpellId: o.hostileSpellId,
      dungeonSlug: o.dungeonSlug,
      runId: o.runId,
      note: "Player interrupt/alternative stop observed",
    })),
    ...playerDispelPurge.slice(0, 40).map((o) => ({
      id: o.id,
      domain: "support" as const,
      outcome: o.outcome,
      abilityGameId: o.abilityGameId,
      hostileSpellId: o.hostileSpellId,
      dungeonSlug: o.dungeonSlug,
      runId: o.runId,
      note: "Player dispel/purge success observed",
    })),
    ...ccExplanations.slice(0, 40),
    ...supportExplanations.slice(0, 40),
  ];

  const denomMethod = activeCombatEstimate?.method ?? "fight_duration_fallback";
  return {
    mode: "OBSERVED_CONTRIBUTION",
    productionCandidate: true,
    scoreKind: UTILITY_OBSERVED_SCORE_SEMANTICS.scoreKind,
    rawBehaviorEstimate,
    reliabilityAdjustedScore,
    confidence: round2(confidence),
    confidenceComponents: Object.fromEntries(
      Object.entries(confComponents).map(([k, v]) => [k, round2(v)]),
    ),
    reliability: round2(reliability),
    domainBreakdown,
    explanations,
    context: {
      runCount: runs.length,
      dungeonCount: dungeons.length,
      dungeons,
      combatHours: round2(hours),
      fightDurationHours: round2(fightDurationHours),
      activeCombatEstimate,
      hostileCastWindows: hostileWindows,
      playerInterruptSuccesses: playerInterrupts.length,
      playerDispelPurgeSuccesses: playerDispelPurge.length,
      playerStrategicCcSuccesses: playerCc,
      playerSupportEvents: supportExplanations.length,
      attributableEvents,
      toolkit: { hasInterrupt, hasDispel, hasPurge, hasHardCc },
    },
    denominatorChoice: {
      selected: `Player-attributable successes per active-combat hour (method=${denomMethod}, gapMs=${activeCombatEstimate?.gapThresholdMs ?? "n/a"}); toolkit-aware domain N/A when the spec cannot contribute.`,
      rejected: [
        {
          option: "Personal interrupt opportunity miss rate",
          reason: "Range/LoS unobservable — rejected by evidence-quality gate",
        },
        {
          option: "Whole-fight duration including travel/downtime",
          reason:
            "Inflates denominator; prefer hostile-activity windows when ≥3 events and ≥20% coverage",
        },
        {
          option: "Raw event counts across runs",
          reason: "Rewards run volume and long keys without rate normalization",
        },
        {
          option: "Share of party interrupts (incl. SUCCESS_OTHER_PLAYER)",
          reason: "Credits other players; unstable attribution",
        },
        {
          option: "All friendly debuff applies as support denominator",
          reason: "Most auras are not toolkit-eligible; inflates false opportunities",
        },
      ],
    },
    researchModeExcluded: [
      "CAST_COMPLETED_CONFIRMED_MISS",
      "NOT_OBSERVABLE interrupt windows",
      "SUCCESS_OTHER_PLAYER",
      "OPPORTUNITY_RESEARCH response-rate castStops",
    ],
  };
}

export function sensitivityDelta(
  base: ObservedContributionResult,
  domain: ObservedDomainKey,
  config: UtilityV3_2ObservedConfig = UTILITY_V3_2_OBSERVED_CONFIG,
): { domain: ObservedDomainKey; approxRawDelta: number; note: string } {
  const row = base.domainBreakdown.find((d) => d.domain === domain);
  if (!row || !row.applicable || row.perCombatHour == null) {
    return { domain, approxRawDelta: 0, note: "domain_not_applicable" };
  }
  const hours = Math.max(base.context.combatHours, 1 / 60);
  const curve =
    domain === "castStops"
      ? config.castStops.perCombatHourCurve
      : domain === "support"
        ? config.support.perCombatHourCurve
        : config.strategicCc.perCombatHourCurve;
  const next = interpolatePerHour(row.perCombatHour + 1 / hours, curve);
  const cur = interpolatePerHour(row.perCombatHour, curve);
  return {
    domain,
    approxRawDelta: round2(Math.max(0, next - cur)),
    note: "One additional observed success at current active-combat-hour density (one-sided)",
  };
}

export function summarizeDispelVolumeStats(perRunCounts: number[]): {
  runs: number;
  median: number | null;
  p90: number | null;
  max: number | null;
  total: number;
} {
  const sorted = [...perRunCounts].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted.length ? sorted[sorted.length - 1]! : null,
    total: perRunCounts.reduce((a, b) => a + b, 0),
  };
}

export type { UtilityV3_2ObservedConfig, ObservedDomainKey };
