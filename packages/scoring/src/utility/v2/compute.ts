/**
 * Utility V2 Phase 1 — pure observed-contribution scoring from fact sets.
 */

import { clamp, clamp01 } from "../../math.js";
import { bindUtilityV2FactsToManifest } from "./bind.js";
import {
  UTILITY_V2_ALGORITHM_VERSION,
  UTILITY_V2_CAST_STOPS_CURVE,
  UTILITY_V2_CC_DEDUPE_WINDOW_MS,
  UTILITY_V2_CONFIDENCE,
  UTILITY_V2_DISPEL_PURGE_EVENT_CREDIT,
  UTILITY_V2_DOMAIN_CONTRIBUTION_CAP,
  UTILITY_V2_DOMAIN_WEIGHTS,
  UTILITY_V2_MIN_HOSTILE_CASTS_PER_HOUR_FOR_FULL_CREDIT,
  UTILITY_V2_SCORE_FLOOR,
  UTILITY_V2_SCORE_SEMANTICS,
  UTILITY_V2_STRATEGIC_CC_CURVE,
  UTILITY_V2_SUPPORT_CURVE,
  UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT,
  UTILITY_V2_SUPPORT_SEMANTIC_CREDIT,
  UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP,
  UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE,
  type UtilityV2SupportSemantic,
} from "./constants.js";
import { sumInterruptCredits } from "./classify-interrupts.js";
import { computeUtilityV2InputFingerprint } from "./fingerprint.js";
import type {
  ClassifiedInterruptAttempt,
  UtilityV2AvailabilityState,
  UtilityV2CcAction,
  UtilityV2ComputeInput,
  UtilityV2ComputeResult,
  UtilityV2DomainBreakdown,
  UtilityV2Explanation,
  UtilityV2InterruptCounts,
  UtilityV2RunFactSet,
  UtilityV2SupportAction,
  UtilityV2ToolkitApplicability,
} from "./types.js";

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
export function applyUnmatchedSpamCap(attempts: ClassifiedInterruptAttempt[]): {
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

  if (unmatchedBefore > 0) {
    const maxUnmatched =
      nonUnmatched <= 0
        ? unmatchedBefore
        : (nonUnmatched * UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP) /
          Math.max(1e-9, 1 - UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP);
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
  windowMs: number = UTILITY_V2_CC_DEDUPE_WINDOW_MS,
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

export function scoreSupportCredit(actions: UtilityV2SupportAction[]): {
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
    const mult = UTILITY_V2_SUPPORT_SEMANTIC_CREDIT[a.semantic] ?? 0;
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
    raw <= 0 ? 0 : Math.pow(raw, UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT);
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
): UtilityV2ComputeResult {
  const fingerprint = computeUtilityV2InputFingerprint(input);
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
    scoreFloor: UTILITY_V2_SCORE_FLOOR,
    domainWeights: { ...UTILITY_V2_DOMAIN_WEIGHTS },
    interruptClassification: interruptCounts,
    domainCurves: {
      castStops: "credited_attempts_per_active_combat_hour",
      support: "diminished_semantic_credit_per_active_combat_hour",
      strategicCc: "deduped_cc_per_active_combat_hour",
    },
    caps: {
      domainContributionCap: UTILITY_V2_DOMAIN_CONTRIBUTION_CAP,
      unmatchedCreditShareCap: UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP,
      unmatchedOnlyMaxDomainScore: UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE,
    },
    applicableDomains: [],
    excludedDomains: [],
    notes: [
      ...UTILITY_V2_SCORE_SEMANTICS.notes,
      "UNAVAILABLE: missing, unbound, or mismatched facts — score withheld.",
    ],
    selectedRuns: [],
    confidenceReasons: ["unavailable"],
    bindingReasons,
  };

  const metrics: Record<string, unknown> = {
    algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
    modelLabel: UTILITY_V2_SCORE_SEMANTICS.scoreKind,
    availabilityState: "UNAVAILABLE",
    publicationBlocked: true,
    manifestContentHash: input.manifest.contentHash,
    bindingReasons,
  };

  return {
    mode: "OBSERVED_CONTRIBUTION",
    phase: 1,
    opportunityMode: "off",
    algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
    scoreSemantics: UTILITY_V2_SCORE_SEMANTICS.scoreKind,
    availabilityState: "UNAVAILABLE",
    score: null,
    rawBehaviorEstimate: null,
    confidence: 0,
    confidenceComponents: {},
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
export function computeUtilityV2(input: UtilityV2ComputeInput): UtilityV2ComputeResult {
  const binding = bindUtilityV2FactsToManifest({
    manifest: input.manifest,
    factSets: input.factSets,
    extractionFailed: input.extractionFailed,
  });

  if (!binding.ok) {
    return unavailableResult(input, binding.reasons);
  }

  const floor = UTILITY_V2_SCORE_FLOOR;
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
  const interruptCap = applyUnmatchedSpamCap(allAttempts);
  const allCc = factSets.flatMap((f) => f.ccActions);
  const dedupedCc = dedupeStrategicCc(allCc);
  const allSupport = factSets.flatMap((f) => f.supportActions);
  const support = scoreSupportCredit(allSupport);
  const dispelPurge = factSets.reduce((s, f) => s + f.dispelPurgeSuccessCount, 0);
  const combinedSupportRaw =
    support.rawCredit + dispelPurge * UTILITY_V2_DISPEL_PURGE_EVENT_CREDIT;
  const supportWithDispel = {
    rawCredit: round2(combinedSupportRaw),
    diminishedCredit: round2(
      combinedSupportRaw <= 0
        ? 0
        : Math.pow(combinedSupportRaw, UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT),
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
      raw = interpolatePerHour(creditedPerHour, UTILITY_V2_CAST_STOPS_CURVE);
      const hostileDensity = hostileBegincastCount / combatHours;
      const densityFactor = clamp(
        hostileDensity / UTILITY_V2_MIN_HOSTILE_CASTS_PER_HOUR_FOR_FULL_CREDIT,
        0.35,
        1,
      );
      raw = floor + (raw - floor) * densityFactor;
      raw = floorNeutral(raw, floor);
      if (unmatchedOnly) {
        raw = Math.min(raw, UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE);
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
      weight: UTILITY_V2_DOMAIN_WEIGHTS.castStops,
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
      raw = floorNeutral(interpolatePerHour(perHour, UTILITY_V2_SUPPORT_CURVE), floor);
      notes.push(
        `denominator=diminished_support_credit_per_active_combat_hour; exponent=${UTILITY_V2_SUPPORT_DIMINISHING_EXPONENT}`,
      );
    }
    if (support.passiveOrRotationalIgnored > 0) {
      notes.push(`ignored_passive_rotational_or_mobility=${support.passiveOrRotationalIgnored}`);
    }

    domainBreakdown.push({
      domain: "support",
      applicable,
      rawScore: raw == null ? null : round2(raw),
      weight: UTILITY_V2_DOMAIN_WEIGHTS.support,
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
      raw = floorNeutral(interpolatePerHour(perHour, UTILITY_V2_STRATEGIC_CC_CURVE), floor);
      notes.push("denominator=deduped_player_pet_cc_per_active_combat_hour");
      if (allCc.length > dedupedCc.length) {
        notes.push(`cc_deduped_${allCc.length - dedupedCc.length}`);
      }
    }

    domainBreakdown.push({
      domain: "strategicCc",
      applicable,
      rawScore: raw == null ? null : round2(raw),
      weight: UTILITY_V2_DOMAIN_WEIGHTS.strategicCc,
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
    const capped = clamp(nonNeg, 0, UTILITY_V2_DOMAIN_CONTRIBUTION_CAP);
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
    0.25 * clamp01(dungeons.length / UTILITY_V2_CONFIDENCE.expectedDungeons) +
      0.2 * clamp01(factSets.length / UTILITY_V2_CONFIDENCE.runSaturation) +
      0.25 * clamp01(combatHours / UTILITY_V2_CONFIDENCE.combatHourSaturation) +
      0.3 * clamp01(attributableEvents / UTILITY_V2_CONFIDENCE.attributableEventSaturation),
    UTILITY_V2_CONFIDENCE.minReliability,
    1,
  );

  const score = round2(
    floorNeutral(floor + reliability * (rawBehaviorEstimate - floor), floor),
  );

  const confComponents = {
    dungeonCoverage: clamp01(dungeons.length / UTILITY_V2_CONFIDENCE.expectedDungeons),
    runCoverage: clamp01(factSets.length / UTILITY_V2_CONFIDENCE.runSaturation),
    combatDuration: clamp01(combatHours / UTILITY_V2_CONFIDENCE.combatHourSaturation),
    attributableEvents: clamp01(
      attributableEvents / UTILITY_V2_CONFIDENCE.attributableEventSaturation,
    ),
    mechanicCatalogCoverageObserved: clamp01(mechanicCoverage),
    sourceCompleteness: clamp01(
      (factSets.length > 0 ? 0.4 : 0) +
        (hostileBegincastCount > 0 ? 0.3 : 0) +
        (attributableEvents > 0 ? 0.3 : 0),
    ),
  };
  const w = UTILITY_V2_CONFIDENCE.weights;
  let confidence =
    (confComponents.dungeonCoverage * w.dungeonCoverage +
      confComponents.runCoverage * w.runCoverage +
      confComponents.combatDuration * w.combatDuration +
      confComponents.attributableEvents * w.attributableEvents +
      confComponents.mechanicCatalogCoverageObserved * w.mechanicCatalogCoverageObserved +
      confComponents.sourceCompleteness * w.sourceCompleteness) *
    100;

  const confidenceReasons: string[] = [];
  if (factSets.length < UTILITY_V2_CONFIDENCE.tinyRunThreshold) {
    confidence = Math.min(confidence, UTILITY_V2_CONFIDENCE.maxWhenTinySample);
    confidenceReasons.push("tiny_run_sample");
  }
  if (dungeons.length < expectedDungeonCount) {
    confidence = Math.min(confidence, UTILITY_V2_CONFIDENCE.maxWhenPartialDungeons);
    confidenceReasons.push("partial_dungeon_coverage");
  }
  if (attributableEvents === 0) {
    confidence = Math.min(confidence, UTILITY_V2_CONFIDENCE.maxWhenZeroAttributable);
    confidenceReasons.push("zero_attributable_events");
  }
  if (hostileBegincastCount === 0 && toolkit.hasInterrupt) {
    confidence = Math.min(confidence, UTILITY_V2_CONFIDENCE.maxWhenNoHostileCasts);
    confidenceReasons.push("no_hostile_casts_observed");
  }
  for (const gate of UTILITY_V2_CONFIDENCE.maxWhenMechanicCatalogBelow) {
    if (confComponents.mechanicCatalogCoverageObserved < gate.below) {
      confidence = Math.min(confidence, gate.maxConfidence);
      confidenceReasons.push(`mechanic_catalog_below_${gate.below}`);
      break;
    }
  }
  confidence = round2(clamp(confidence, 0, 100));

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
    domainWeights: { ...UTILITY_V2_DOMAIN_WEIGHTS },
    interruptClassification: interruptCap.counts,
    domainCurves: {
      castStops: "credited_attempts_per_active_combat_hour",
      support: "diminished_semantic_credit_per_active_combat_hour",
      strategicCc: "deduped_cc_per_active_combat_hour",
    },
    caps: {
      domainContributionCap: UTILITY_V2_DOMAIN_CONTRIBUTION_CAP,
      unmatchedCreditShareCap: UTILITY_V2_UNMATCHED_CREDIT_SHARE_CAP,
      unmatchedOnlyMaxDomainScore: UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE,
    },
    applicableDomains,
    excludedDomains,
    notes: [...UTILITY_V2_SCORE_SEMANTICS.notes],
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
    bindingReasons: [],
  };

  const inputFingerprint = computeUtilityV2InputFingerprint(input);
  const metrics: Record<string, unknown> = {
    algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
    modelLabel: UTILITY_V2_SCORE_SEMANTICS.scoreKind,
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
  };

  return {
    mode: "OBSERVED_CONTRIBUTION",
    phase: 1,
    opportunityMode: "off",
    algorithmVersion: UTILITY_V2_ALGORITHM_VERSION,
    scoreSemantics: UTILITY_V2_SCORE_SEMANTICS.scoreKind,
    availabilityState,
    score,
    rawBehaviorEstimate,
    confidence: round2(confidence / 100),
    confidenceComponents: Object.fromEntries(
      Object.entries(confComponents).map(([k, v]) => [k, round2(v)]),
    ),
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
