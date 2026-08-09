/**
 * Utility V2 Phase 1 — pure observed-contribution scoring from fact sets.
 */

import { clamp, clamp01 } from "../../math.js";
import { buildUtilityFeatureUsage } from "../../audit/feature-usage.js";
import { buildDimensionConfidenceBreakdown } from "../../confidence/dimension-confidence.js";
import { bindUtilityV2FactsToManifest } from "./bind.js";
import {
  UTILITY_V2_MODEL_CONFIG,
  type UtilityV2ModelConfig,
  type UtilityV2SupportSemantic,
} from "./constants.js";
import { emitUtilityConsumptionTraces } from "./consumption-traces.js";
import { sumInterruptCredits } from "./classify-interrupts.js";
import { computeUtilityV2InputFingerprint } from "./fingerprint.js";
import {
  fingerprintUtilityV2ModelConfig,
  resolveUtilityV2ModelConfig,
} from "./model-config.js";
import type {
  ClassifiedInterruptAttempt,
  UtilityV2AvailabilityState,
  UtilityV2CcAction,
  UtilityV2ComputeInput,
  UtilityV2ComputeOptions,
  UtilityV2ComputeResult,
  UtilityV2DomainBreakdown,
  UtilityV2Explanation,
  UtilityV2InterruptCounts,
  UtilityV2RunFactSet,
  UtilityV2SupportAction,
  UtilityV2ToolkitApplicability,
} from "./types.js";

export type { UtilityV2ComputeOptions };

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

function floorNeutral(score: number, floor: number): number {
  return Math.max(floor, score);
}

function emptySemantic(): Record<UtilityV2SupportSemantic, number> {
  return {
    REACTIVE_SUPPORT: 0,
    STRATEGIC_SUPPORT: 0,
    EMERGENCY_SUPPORT: 0,
    ROUTINE_ROTATIONAL_SUPPORT: 0,
    PASSIVE_SUPPORT: 0,
    PERSONAL_MOBILITY: 0,
    UNVERIFIED_EXTERNAL: 0,
  };
}

function emptyInterruptCounts(): UtilityV2InterruptCounts {
  return {
    CONFIRMED_SUCCESS: 0,
    VALID_OVERLAP: 0,
    MATCHED_FAILED: 0,
    UNMATCHED_ATTEMPT: 0,
    NOT_OBSERVABLE: 0,
    creditedTotal: 0,
    unmatchedCreditBeforeCap: 0,
    unmatchedCreditAfterCap: 0,
    unmatchedCapApplied: false,
  };
}

/** Apply unmatched spam cap so unmatched cannot dominate cast-stop credit. */
export function applyUnmatchedSpamCap(
  attempts: ClassifiedInterruptAttempt[],
  config: UtilityV2ModelConfig = UTILITY_V2_MODEL_CONFIG,
): {
  creditedTotal: number;
  unmatchedBefore: number;
  unmatchedAfter: number;
  capApplied: boolean;
  counts: UtilityV2InterruptCounts;
} {
  const summed = sumInterruptCredits(attempts);
  const nonUnmatched =
    summed.byClass.CONFIRMED_SUCCESS +
    summed.byClass.VALID_OVERLAP +
    summed.byClass.MATCHED_FAILED;
  const unmatchedBefore = summed.unmatchedCredit;
  let unmatchedAfter = unmatchedBefore;
  let capApplied = false;
  const unmatchedCreditShareCap = config.unmatchedCreditShareCap;

  if (unmatchedBefore > 0) {
    const maxUnmatched =
      nonUnmatched <= 0
        ? unmatchedBefore
        : (nonUnmatched * unmatchedCreditShareCap) /
          Math.max(1e-9, 1 - unmatchedCreditShareCap);
    if (unmatchedBefore > maxUnmatched && nonUnmatched > 0) {
      unmatchedAfter = maxUnmatched;
      capApplied = true;
    }
  }

  const creditedTotal = nonUnmatched + unmatchedAfter;
  return {
    creditedTotal,
    unmatchedBefore,
    unmatchedAfter,
    capApplied,
    counts: {
      CONFIRMED_SUCCESS: summed.counts.CONFIRMED_SUCCESS,
      VALID_OVERLAP: summed.counts.VALID_OVERLAP,
      MATCHED_FAILED: summed.counts.MATCHED_FAILED,
      UNMATCHED_ATTEMPT: summed.counts.UNMATCHED_ATTEMPT,
      NOT_OBSERVABLE: summed.counts.NOT_OBSERVABLE,
      creditedTotal: round2(creditedTotal),
      unmatchedCreditBeforeCap: round2(unmatchedBefore),
      unmatchedCreditAfterCap: round2(unmatchedAfter),
      unmatchedCapApplied: capApplied,
    },
  };
}

/**
 * Deduplicate strategic CC: same ability+target within window counts once.
 * Only PLAYER / OWNED_PET in active combat receive credit.
 */
export function dedupeStrategicCc(
  actions: UtilityV2CcAction[],
  windowMs: number = UTILITY_V2_MODEL_CONFIG.ccDedupeWindowMs,
): UtilityV2CcAction[] {
  const eligible = actions
    .filter(
      (a) =>
        a.inActiveCombat &&
        (a.sourceKind === "PLAYER" || a.sourceKind === "OWNED_PET"),
    )
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));

  const kept: UtilityV2CcAction[] = [];
  for (const a of eligible) {
    const dup = kept.some(
      (k) =>
        k.abilityGameId === a.abilityGameId &&
        k.targetActorId === a.targetActorId &&
        Math.abs(k.timestampMs - a.timestampMs) <= windowMs,
    );
    if (!dup) kept.push(a);
  }
  return kept;
}

export function scoreSupportCredit(
  actions: UtilityV2SupportAction[],
  config: UtilityV2ModelConfig = UTILITY_V2_MODEL_CONFIG,
): {
  rawCredit: number;
  diminishedCredit: number;
  bySemantic: Record<UtilityV2SupportSemantic, number>;
  passiveOrRotationalIgnored: number;
} {
  const bySemantic = emptySemantic();
  let raw = 0;
  let ignored = 0;
  for (const a of actions) {
    if (a.sourceKind !== "PLAYER" && a.sourceKind !== "OWNED_PET") continue;
    const mult = config.supportSemanticCredit[a.semantic] ?? 0;
    const tierMult =
      a.tier === "CONFIRMED_IMPACT" ? 1 : a.tier === "CONFIRMED_APPLICATION" ? 0.45 : 0;
    if (mult <= 0 || tierMult <= 0) {
      if (
        a.semantic === "PASSIVE_SUPPORT" ||
        a.semantic === "PERSONAL_MOBILITY" ||
        a.semantic === "ROUTINE_ROTATIONAL_SUPPORT" ||
        a.semantic === "UNVERIFIED_EXTERNAL"
      ) {
        ignored += 1;
      }
      continue;
    }
    const credit = mult * tierMult;
    bySemantic[a.semantic] += credit;
    raw += credit;
  }
  const diminished =
    raw <= 0 ? 0 : Math.pow(raw, config.supportDiminishingExponent);
  return {
    rawCredit: round2(raw),
    diminishedCredit: round2(diminished),
    bySemantic,
    passiveOrRotationalIgnored: ignored,
  };
}

function mergeToolkit(sets: UtilityV2RunFactSet[]): UtilityV2ToolkitApplicability {
  return {
    hasInterrupt: sets.some((s) => s.toolkit.hasInterrupt),
    hasSupport: sets.some((s) => s.toolkit.hasSupport),
    hasStrategicCc: sets.some((s) => s.toolkit.hasStrategicCc),
  };
}

function resolveAvailability(input: {
  boundSelectedSlotCount: number;
  selectedSlotCount: number;
  expectedSlotCount: number;
}): UtilityV2AvailabilityState {
  if (input.boundSelectedSlotCount <= 0) return "UNAVAILABLE";
  if (
    input.boundSelectedSlotCount < input.selectedSlotCount ||
    input.selectedSlotCount < input.expectedSlotCount
  ) {
    return "PARTIAL";
  }
  return "AVAILABLE";
}

function unavailableResult(
  input: UtilityV2ComputeInput,
  bindingReasons: string[],
  config: UtilityV2ModelConfig = UTILITY_V2_MODEL_CONFIG,
): UtilityV2ComputeResult {
  const modelConfigFingerprint = fingerprintUtilityV2ModelConfig(config);
  const fingerprint = computeUtilityV2InputFingerprint(input, { modelConfig: config });
  const emptySupport = {
    rawCredit: 0,
    diminishedCredit: 0,
    bySemantic: emptySemantic(),
    passiveOrRotationalIgnored: 0,
  };
  const interruptCounts = emptyInterruptCounts();
  const explanation: UtilityV2Explanation = {
    mode: "OBSERVED_CONTRIBUTION",
    publicationBlocked: true,
    availabilityState: "UNAVAILABLE",
    scoreFloor: config.scoreFloor,
    domainWeights: { ...config.domainWeights },
    interruptClassification: interruptCounts,
    domainCurves: {
      castStops: "credited_attempts_per_active_combat_hour",
      support: "diminished_semantic_credit_per_active_combat_hour",
      strategicCc: "deduped_cc_per_active_combat_hour",
    },
    caps: {
      domainContributionCap: config.domainContributionCap,
      unmatchedCreditShareCap: config.unmatchedCreditShareCap,
      unmatchedOnlyMaxDomainScore: config.unmatchedOnlyMaxDomainScore,
    },
    applicableDomains: [],
    excludedDomains: [],
    notes: [
      ...config.scoreSemantics.notes,
      "UNAVAILABLE: missing, unbound, or mismatched facts — score withheld.",
    ],
    selectedRuns: [],
    confidenceReasons: ["unavailable"],
    confidenceBreakdown: buildDimensionConfidenceBreakdown({
      value: 0,
      causes: ["unavailable"],
      components: {},
    }),
    bindingReasons,
  };

  const emptyResultStub = {
    availabilityState: "UNAVAILABLE" as const,
    domainBreakdown: [] as UtilityV2DomainBreakdown[],
  };
  const consumptionTraces = emitUtilityConsumptionTraces({
    boundFactSets: [],
    result: emptyResultStub as UtilityV2ComputeResult,
  });
  const metrics: Record<string, unknown> = {
    algorithmVersion: config.algorithmVersion,
    modelLabel: config.scoreSemantics.scoreKind,
    modelConfigFingerprint,
    availabilityState: "UNAVAILABLE",
    publicationBlocked: true,
    manifestContentHash: input.manifest.contentHash,
    bindingReasons,
    featureUsage: buildUtilityFeatureUsage([], { consumptionTraces }).featureUsage,
  };

  return {
    mode: "OBSERVED_CONTRIBUTION",
    phase: config.scoreSemantics.phase,
    opportunityMode: "off",
    algorithmVersion: config.algorithmVersion,
    scoreSemantics: config.scoreSemantics.scoreKind,
    modelConfigFingerprint,
    availabilityState: "UNAVAILABLE",
    score: null,
    rawBehaviorEstimate: null,
    confidence: 0,
    confidenceComponents: {},
    confidenceBreakdown: buildDimensionConfidenceBreakdown({
      value: 0,
      causes: ["unavailable"],
      components: {},
    }),
    reliability: null,
    inputFingerprint: fingerprint,
    domainBreakdown: [],
    interruptCounts,
    support: emptySupport,
    strategicCc: { rawActions: 0, dedupedActions: 0 },
    context: {
      runCount: 0,
      dungeonCount: 0,
      dungeons: [],
      combatHours: 0,
      fightDurationHours: 0,
      hostileBegincastCount: 0,
      attributableEvents: 0,
      selectedSlotCount: input.manifest.selectedSlotCount,
      boundSelectedSlotCount: 0,
      expectedSlotCount: input.manifest.expectedSlotCount,
      toolkit: { hasInterrupt: false, hasSupport: false, hasStrategicCc: false },
      catalogCoverage: { abilityCatalogCoverage: 0, mechanicCatalogCoverage: 0 },
    },
    explanation,
    metrics,
  };
}

/**
 * Provider-free Utility V2 Phase 1 computation from manifest-bound fact sets.
 *
 * Missing / unbound / mismatched facts → score null, confidence 0, UNAVAILABLE.
 * Bound facts with zero observed actions → score floor 50 (Phase 1), PARTIAL/AVAILABLE.
 */
export function computeUtilityV2(
  input: UtilityV2ComputeInput,
  options?: UtilityV2ComputeOptions,
): UtilityV2ComputeResult {
  const config = resolveUtilityV2ModelConfig(options?.modelConfig);
  const modelConfigFingerprint = fingerprintUtilityV2ModelConfig(config);
  const binding = bindUtilityV2FactsToManifest({
    manifest: input.manifest,
    factSets: input.factSets,
    extractionFailed: input.extractionFailed,
  });

  if (!binding.ok) {
    return unavailableResult(input, binding.reasons, config);
  }

  const floor = config.scoreFloor;
  const factSets = binding.boundFactSets;
  const availabilityState = resolveAvailability({
    boundSelectedSlotCount: binding.boundSelectedSlotCount,
    selectedSlotCount: binding.selectedSlotCount,
    expectedSlotCount: input.manifest.expectedSlotCount,
  });

  const dungeons = [...new Set(factSets.map((f) => f.dungeonSlug))].sort();
  const expectedDungeonCount = Math.max(
    1,
    input.manifest.activeDungeonSlugs.length ||
      Math.ceil(input.manifest.expectedSlotCount / 2),
  );
  const combatHours = Math.max(
    factSets.reduce((s, f) => s + f.activeCombatHours, 0),
    1 / 60,
  );
  const fightDurationHours = Math.max(
    factSets.reduce((s, f) => s + f.fightDurationMs / 3_600_000, 0),
    1 / 60,
  );
  const hostileBegincastCount = factSets.reduce((s, f) => s + f.hostileBegincastCount, 0);
  const toolkit = mergeToolkit(factSets);

  const allAttempts = factSets.flatMap((f) => f.interruptAttempts);
  const interruptCap = applyUnmatchedSpamCap(allAttempts, config);
  const allCc = factSets.flatMap((f) => f.ccActions);
  const dedupedCc = dedupeStrategicCc(allCc, config.ccDedupeWindowMs);
  const allSupport = factSets.flatMap((f) => f.supportActions);
  const support = scoreSupportCredit(allSupport, config);
  const dispelPurge = factSets.reduce((s, f) => s + f.dispelPurgeSuccessCount, 0);
  const combinedSupportRaw =
    support.rawCredit + dispelPurge * config.dispelPurgeEventCredit;
  const supportWithDispel = {
    rawCredit: round2(combinedSupportRaw),
    diminishedCredit: round2(
      combinedSupportRaw <= 0
        ? 0
        : Math.pow(combinedSupportRaw, config.supportDiminishingExponent),
    ),
    bySemantic: support.bySemantic,
    passiveOrRotationalIgnored: support.passiveOrRotationalIgnored,
  };

  const abilityCoverage =
    factSets.reduce((s, f) => s + f.catalogCoverage.abilityCatalogCoverage, 0) /
    factSets.length;
  const mechanicCoverage =
    input.mechanicCatalogCoverageObserved ??
    factSets.reduce((s, f) => s + f.catalogCoverage.mechanicCatalogCoverage, 0) /
      factSets.length;

  const domainBreakdown: UtilityV2DomainBreakdown[] = [];

  // --- castStops ---
  {
    const notes: string[] = [];
    let raw: number | null = floor;
    let applicable = true;
    const creditedPerHour = interruptCap.creditedTotal / combatHours;
    const unmatchedOnly =
      interruptCap.counts.CONFIRMED_SUCCESS +
        interruptCap.counts.VALID_OVERLAP +
        interruptCap.counts.MATCHED_FAILED ===
        0 && interruptCap.counts.UNMATCHED_ATTEMPT > 0;

    if (!toolkit.hasInterrupt) {
      applicable = false;
      raw = null;
      notes.push("toolkit_interrupt_absent_domain_neutral");
    } else if (interruptCap.creditedTotal <= 0) {
      raw = floor;
      notes.push("zero_credited_interrupt_attempts_remain_neutral");
    } else {
      raw = interpolatePerHour(creditedPerHour, config.castStopsCurve);
      const hostileDensity = hostileBegincastCount / combatHours;
      const densityFactor = clamp(
        hostileDensity / config.minHostileCastsPerHourForFullCredit,
        0.35,
        1,
      );
      raw = floor + (raw - floor) * densityFactor;
      raw = floorNeutral(raw, floor);
      if (unmatchedOnly) {
        raw = Math.min(raw, config.unmatchedOnlyMaxDomainScore);
        notes.push("unmatched_only_domain_score_capped");
      }
      if (interruptCap.capApplied) {
        notes.push("unmatched_spam_credit_share_capped");
      }
      notes.push(
        `denominator=credited_interrupt_attempts_per_active_combat_hour; hostile_density_factor=${round2(densityFactor)}`,
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
      events: allAttempts.length,
      creditedEvents: round2(interruptCap.creditedTotal),
      perCombatHour: applicable ? round2(creditedPerHour) : null,
      notes,
    });
  }

  // --- support ---
  {
    const notes: string[] = [];
    const toolkitSupport =
      toolkit.hasSupport || supportWithDispel.rawCredit > 0 || dispelPurge > 0;
    let raw: number | null = floor;
    let applicable = true;
    const perHour = supportWithDispel.diminishedCredit / combatHours;

    if (!toolkitSupport) {
      applicable = false;
      raw = null;
      notes.push("no_support_toolkit_and_no_observed_support_neutral");
    } else if (supportWithDispel.rawCredit <= 0) {
      raw = floor;
      notes.push("zero_observed_support_credit_remain_neutral");
    } else {
      raw = floorNeutral(interpolatePerHour(perHour, config.supportCurve), floor);
      notes.push(
        `denominator=diminished_support_credit_per_active_combat_hour; exponent=${config.supportDiminishingExponent}`,
      );
    }
    if (support.passiveOrRotationalIgnored > 0) {
      notes.push(`ignored_passive_rotational_or_mobility=${support.passiveOrRotationalIgnored}`);
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
      events: allSupport.length + dispelPurge,
      creditedEvents: round2(supportWithDispel.rawCredit),
      perCombatHour: applicable ? round2(perHour) : null,
      notes,
    });
  }

  // --- strategicCc ---
  {
    const notes: string[] = [];
    let raw: number | null = floor;
    let applicable = true;
    const perHour = dedupedCc.length / combatHours;

    if (!toolkit.hasStrategicCc) {
      applicable = false;
      raw = null;
      notes.push("toolkit_hard_cc_absent_domain_neutral");
    } else if (dedupedCc.length === 0) {
      raw = floor;
      notes.push("zero_observed_cc_casts_remain_neutral");
    } else {
      raw = floorNeutral(interpolatePerHour(perHour, config.strategicCcCurve), floor);
      notes.push("denominator=deduped_player_pet_cc_per_active_combat_hour");
      if (allCc.length > dedupedCc.length) {
        notes.push(`cc_deduped_${allCc.length - dedupedCc.length}`);
      }
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
      events: allCc.length,
      creditedEvents: dedupedCc.length,
      perCombatHour: applicable ? round2(perHour) : null,
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

  const attributableEvents = round2(
    interruptCap.creditedTotal +
      supportWithDispel.rawCredit +
      dedupedCc.length +
      dispelPurge,
  );

  const reliability = clamp(
    0.25 * clamp01(dungeons.length / config.confidence.expectedDungeons) +
      0.2 * clamp01(factSets.length / config.confidence.runSaturation) +
      0.25 * clamp01(combatHours / config.confidence.combatHourSaturation) +
      0.3 * clamp01(attributableEvents / config.confidence.attributableEventSaturation),
    config.confidence.minReliability,
    1,
  );

  const score = round2(
    floorNeutral(floor + reliability * (rawBehaviorEstimate - floor), floor),
  );

  const allLimitations = new Set(factSets.flatMap((f) => f.limitations));
  const hostileNotPersistedInDigest = allLimitations.has(
    "hostile_cast_windows_not_persisted_in_digest",
  );
  const catalogCoverageUnmeasured =
    allLimitations.has("digest_catalog_coverage_unmeasured") ||
    allLimitations.has("catalog_coverage_unmeasured_fallback");

  const confComponents = {
    dungeonCoverage: clamp01(dungeons.length / config.confidence.expectedDungeons),
    runCoverage: clamp01(factSets.length / config.confidence.runSaturation),
    combatDuration: clamp01(combatHours / config.confidence.combatHourSaturation),
    attributableEvents: clamp01(
      attributableEvents / config.confidence.attributableEventSaturation,
    ),
    mechanicCatalogCoverageObserved: catalogCoverageUnmeasured
      ? 0
      : clamp01(mechanicCoverage),
    sourceCompleteness: clamp01(
      (factSets.length > 0 ? 0.4 : 0) +
        (hostileBegincastCount > 0 ? 0.3 : 0) +
        (attributableEvents > 0 ? 0.3 : 0),
    ),
  };
  const w = config.confidence.weights;
  // When catalog coverage is unmeasured, drop that weight and renormalize so a
  // stand-in constant cannot masquerade as observed evidence quality.
  const confidenceWeightEntries: Array<[keyof typeof w, number]> = [
    ["dungeonCoverage", w.dungeonCoverage],
    ["runCoverage", w.runCoverage],
    ["combatDuration", w.combatDuration],
    ["attributableEvents", w.attributableEvents],
    [
      "mechanicCatalogCoverageObserved",
      catalogCoverageUnmeasured ? 0 : w.mechanicCatalogCoverageObserved,
    ],
    ["sourceCompleteness", w.sourceCompleteness],
  ];
  const confidenceWeightSum = confidenceWeightEntries.reduce(
    (s, [, weight]) => s + weight,
    0,
  );
  let confidence =
    confidenceWeightEntries.reduce((s, [key, weight]) => {
      const share =
        confidenceWeightSum > 0 ? weight / confidenceWeightSum : 0;
      return s + confComponents[key] * share;
    }, 0) * 100;

  const confidenceReasons: string[] = [];
  if (factSets.length < config.confidence.tinyRunThreshold) {
    confidence = Math.min(confidence, config.confidence.maxWhenTinySample);
    confidenceReasons.push("tiny_run_sample");
  }
  if (dungeons.length < expectedDungeonCount) {
    confidence = Math.min(confidence, config.confidence.maxWhenPartialDungeons);
    confidenceReasons.push("partial_dungeon_coverage");
  }
  if (attributableEvents === 0) {
    confidence = Math.min(confidence, config.confidence.maxWhenZeroAttributable);
    confidenceReasons.push("zero_attributable_events");
  }
  if (
    hostileBegincastCount === 0 &&
    toolkit.hasInterrupt &&
    !hostileNotPersistedInDigest
  ) {
    confidence = Math.min(confidence, config.confidence.maxWhenNoHostileCasts);
    confidenceReasons.push("no_hostile_casts_observed");
  } else if (hostileNotPersistedInDigest) {
    confidenceReasons.push("hostile_cast_windows_not_persisted_in_digest");
  }
  if (!catalogCoverageUnmeasured) {
    for (const gate of config.confidence.maxWhenMechanicCatalogBelow) {
      if (confComponents.mechanicCatalogCoverageObserved < gate.below) {
        confidence = Math.min(confidence, gate.maxConfidence);
        confidenceReasons.push(`mechanic_catalog_below_${gate.below}`);
        break;
      }
    }
  } else {
    confidenceReasons.push("catalog_coverage_unmeasured");
  }
  confidence = round2(clamp(confidence, 0, 100));

  const confidenceBreakdown = buildDimensionConfidenceBreakdown({
    value: confidence / 100,
    causes: confidenceReasons,
    components: Object.fromEntries(
      Object.entries(confComponents).map(([k, v]) => [k, round2(v)]),
    ),
  });

  const applicableDomains = domainBreakdown
    .filter((d) => d.applicable)
    .map((d) => d.domain);
  const excludedDomains = domainBreakdown
    .filter((d) => !d.applicable)
    .map((d) => ({
      domain: d.domain,
      reason: d.notes[0] ?? "not_applicable",
    }));

  const explanation: UtilityV2Explanation = {
    mode: "OBSERVED_CONTRIBUTION",
    publicationBlocked: true,
    availabilityState,
    scoreFloor: floor,
    domainWeights: { ...config.domainWeights },
    interruptClassification: interruptCap.counts,
    domainCurves: {
      castStops: "credited_attempts_per_active_combat_hour",
      support: "diminished_semantic_credit_per_active_combat_hour",
      strategicCc: "deduped_cc_per_active_combat_hour",
    },
    caps: {
      domainContributionCap: config.domainContributionCap,
      unmatchedCreditShareCap: config.unmatchedCreditShareCap,
      unmatchedOnlyMaxDomainScore: config.unmatchedOnlyMaxDomainScore,
    },
    applicableDomains,
    excludedDomains,
    notes: [...config.scoreSemantics.notes],
    selectedRuns: factSets.map((f) => ({
      slotId: f.slotId,
      runId: f.runId,
      dungeonSlug: f.dungeonSlug,
      slotIndex: f.slotIndex,
      reportCode: f.reportCode,
      fightId: f.fightId,
      reportRevision: f.reportRevision,
    })),
    confidenceReasons,
    confidenceBreakdown,
    bindingReasons: [],
  };

  const inputFingerprint = computeUtilityV2InputFingerprint(input, { modelConfig: config });
  const resultForTraces: Pick<
    UtilityV2ComputeResult,
    "availabilityState" | "domainBreakdown"
  > = { availabilityState, domainBreakdown };
  const consumptionTraces = emitUtilityConsumptionTraces({
    boundFactSets: binding.boundFactSets,
    result: resultForTraces as UtilityV2ComputeResult,
  });
  const { featureUsage } = buildUtilityFeatureUsage(binding.boundFactSets, {
    consumptionTraces,
  });
  const metrics: Record<string, unknown> = {
    algorithmVersion: config.algorithmVersion,
    modelLabel: config.scoreSemantics.scoreKind,
    modelConfigFingerprint,
    availabilityState,
    publicationBlocked: true,
    manifestContentHash: input.manifest.contentHash,
    rawBehaviorEstimate,
    reliability: round2(reliability),
    domainBreakdown,
    interruptCounts: interruptCap.counts,
    support: supportWithDispel,
    strategicCc: {
      rawActions: allCc.length,
      dedupedActions: dedupedCc.length,
    },
    combatHours: round2(combatHours),
    attributableEvents,
    catalogCoverage: {
      abilityCatalogCoverage: round2(abilityCoverage),
      mechanicCatalogCoverage: round2(mechanicCoverage),
    },
    selectedSlotCount: binding.selectedSlotCount,
    boundSelectedSlotCount: binding.boundSelectedSlotCount,
    expectedSlotCount: input.manifest.expectedSlotCount,
    featureUsage,
  };

  return {
    mode: "OBSERVED_CONTRIBUTION",
    phase: config.scoreSemantics.phase,
    opportunityMode: "off",
    algorithmVersion: config.algorithmVersion,
    scoreSemantics: config.scoreSemantics.scoreKind,
    modelConfigFingerprint,
    availabilityState,
    score,
    rawBehaviorEstimate,
    confidence: round2(confidence / 100),
    confidenceComponents: Object.fromEntries(
      Object.entries(confComponents).map(([k, v]) => [k, round2(v)]),
    ),
    confidenceBreakdown,
    reliability: round2(reliability),
    inputFingerprint,
    domainBreakdown,
    interruptCounts: interruptCap.counts,
    support: supportWithDispel,
    strategicCc: {
      rawActions: allCc.length,
      dedupedActions: dedupedCc.length,
    },
    context: {
      runCount: factSets.length,
      dungeonCount: dungeons.length,
      dungeons,
      combatHours: round2(combatHours),
      fightDurationHours: round2(fightDurationHours),
      hostileBegincastCount,
      attributableEvents,
      selectedSlotCount: binding.selectedSlotCount,
      boundSelectedSlotCount: binding.boundSelectedSlotCount,
      expectedSlotCount: input.manifest.expectedSlotCount,
      toolkit,
      catalogCoverage: {
        abilityCatalogCoverage: round2(abilityCoverage),
        mechanicCatalogCoverage: round2(mechanicCoverage),
      },
    },
    explanation,
    metrics,
  };
}

/** Empty fact set helper for tests / fixtures. */
export function emptyUtilityV2FactSet(
  partial: Partial<UtilityV2RunFactSet> &
    Pick<UtilityV2RunFactSet, "runId" | "dungeonSlug" | "slotId">,
): UtilityV2RunFactSet {
  return {
    schemaVersion: "utility-v2-facts",
    extractorFamily: "utility",
    extractorVersion: "utility-v2.0.0",
    keyLevel: 10,
    slotIndex: 0,
    reportCode: "REPORT",
    fightId: 1,
    reportRevision: 1,
    fightDurationMs: 600_000,
    activeCombatMs: 600_000,
    activeCombatHours: 600_000 / 3_600_000,
    hostileBegincastCount: 0,
    hostileObservability: "ABSENT",
    toolkit: {
      hasInterrupt: true,
      hasSupport: true,
      hasStrategicCc: true,
    },
    interruptAttempts: [],
    ccActions: [],
    supportActions: [],
    dispelPurgeSuccessCount: 0,
    catalogCoverage: {
      abilityCatalogCoverage: 0.8,
      mechanicCatalogCoverage: 0.5,
    },
    limitations: [],
    ...partial,
  };
}
