/**
 * Utility V2 Phase 3 — toolkit-exploitation scoring from fact sets.
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
import {
  UTILITY_V2_FAMILY_KEYS,
  emptyFamilyApplicability,
  familiesFromLegacyToolkit,
  legacyToolkitBooleansFromFamilies,
  mergeFamilyApplicability,
  type UtilityFamilyApplicabilityMap,
  type UtilityV2FamilyKey,
} from "./families.js";
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

function restampInterruptCredits(
  attempts: ClassifiedInterruptAttempt[],
  config: UtilityV2ModelConfig,
): ClassifiedInterruptAttempt[] {
  return attempts.map((a) => ({
    ...a,
    credit: config.interruptCredits[a.classification] ?? 0,
  }));
}

/** Apply unmatched spam cap so unmatched cannot dominate interrupt credit. */
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
  const restamped = restampInterruptCredits(attempts, config);
  const summed = sumInterruptCredits(restamped);
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
  const families = mergeFamilyApplicability(
    sets.map((s) => familiesFromLegacyToolkit(s.toolkit)),
  );
  return {
    ...legacyToolkitBooleansFromFamilies(families),
    families,
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

function familyCurveLabel(family: UtilityV2FamilyKey): string {
  switch (family) {
    case "interrupt":
      return "credited_interrupt_attempts_per_active_combat_hour";
    case "crowdControl":
      return "deduped_cc_per_active_combat_hour";
    case "dispelPurge":
      return "dispel_purge_successes_per_active_combat_hour";
    case "groupSupport":
      return "diminished_support_credit_per_active_combat_hour";
    case "movement":
      return "movement_utility_uses_per_active_combat_hour";
    case "combatRes":
      return "combat_res_uses_per_active_combat_hour";
    case "bloodlust":
      return "bloodlust_uses_per_active_combat_hour";
  }
}

function emptyExplanation(
  config: UtilityV2ModelConfig,
  interruptCounts: UtilityV2InterruptCounts,
  extraNotes: string[],
  bindingReasons: string[],
): UtilityV2Explanation {
  const domainCurves = {} as Record<UtilityV2FamilyKey, string>;
  for (const family of UTILITY_V2_FAMILY_KEYS) {
    domainCurves[family] = familyCurveLabel(family);
  }
  return {
    mode: "OBSERVED_CONTRIBUTION",
    publicationBlocked: true,
    availabilityState: "UNAVAILABLE",
    scoreFloor: config.scoreFloor,
    domainWeights: { ...config.familyWeights },
    familyWeights: { ...config.familyWeights },
    interruptCredits: { ...config.interruptCredits },
    interruptClassification: interruptCounts,
    domainCurves,
    caps: {
      unmatchedCreditShareCap: config.unmatchedCreditShareCap,
      unmatchedOnlyMaxDomainScore: config.unmatchedOnlyMaxDomainScore,
    },
    applicableDomains: [],
    unusedDomains: [],
    excludedDomains: [],
    uncertainDomains: [],
    notes: [...config.scoreSemantics.notes, ...extraNotes],
    selectedRuns: [],
    confidenceReasons: ["unavailable"],
    confidenceBreakdown: buildDimensionConfidenceBreakdown({
      value: 0,
      causes: ["unavailable"],
      components: {},
    }),
    bindingReasons,
  };
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
  const explanation = emptyExplanation(config, interruptCounts, [
    "UNAVAILABLE: missing, unbound, or mismatched facts — score withheld.",
  ], bindingReasons);

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
      toolkit: {
        hasInterrupt: false,
        hasSupport: false,
        hasStrategicCc: false,
        families: emptyFamilyApplicability("not_applicable"),
      },
      catalogCoverage: { abilityCatalogCoverage: 0, mechanicCatalogCoverage: 0 },
    },
    explanation,
    metrics,
  };
}

function familyIncluded(
  family: UtilityV2FamilyKey,
  applicability: UtilityFamilyApplicabilityMap[UtilityV2FamilyKey],
  used: boolean,
): { include: boolean; reason: string } {
  if (applicability.state === "not_applicable") {
    return { include: false, reason: applicability.reason ?? "not_applicable" };
  }
  if (applicability.state === "uncertain") {
    return { include: false, reason: applicability.reason ?? "applicability_uncertain" };
  }
  if (applicability.state === "optional" && !used) {
    return { include: false, reason: applicability.reason ?? "optional_group_expectation_unused" };
  }
  return { include: true, reason: applicability.reason ?? "applicable" };
}

/** Runs where the family toolkit is confirmed available (or optional). */
function factSetsWithFamilyOpportunity(
  factSets: UtilityV2RunFactSet[],
  family: UtilityV2FamilyKey,
): UtilityV2RunFactSet[] {
  return factSets.filter((set) => {
    const state = familiesFromLegacyToolkit(set.toolkit)[family].state;
    return state === "applicable" || state === "optional";
  });
}

function aggregateFamilyApplicability(
  factSets: UtilityV2RunFactSet[],
  family: UtilityV2FamilyKey,
): UtilityFamilyApplicabilityMap[UtilityV2FamilyKey] {
  const states = factSets.map((s) => familiesFromLegacyToolkit(s.toolkit)[family]);
  if (states.some((s) => s.state === "applicable")) {
    const hit = states.find((s) => s.state === "applicable")!;
    return { state: "applicable", reason: hit.reason };
  }
  if (states.some((s) => s.state === "optional")) {
    const hit = states.find((s) => s.state === "optional")!;
    return { state: "optional", reason: hit.reason };
  }
  if (states.some((s) => s.state === "uncertain")) {
    const hit = states.find((s) => s.state === "uncertain")!;
    return { state: "uncertain", reason: hit.reason };
  }
  return {
    state: "not_applicable",
    reason: states[0]?.reason ?? "not_applicable",
  };
}

/**
 * Provider-free Utility V2 computation from manifest-bound fact sets.
 *
 * Missing / unbound / mismatched facts → score null, confidence 0, UNAVAILABLE.
 * Applicable unused toolkit → genuine low/zero score (no hidden 50 floor).
 * Uncertain talent applicability is excluded, never a fabricated unused zero.
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
  const families = familiesFromLegacyToolkit(toolkit);

  const allAttempts = factSets.flatMap((f) => f.interruptAttempts);
  const interruptCapAll = applyUnmatchedSpamCap(allAttempts, config);
  const allCc = factSets.flatMap((f) => f.ccActions);
  const allSupport = factSets.flatMap((f) => f.supportActions);
  const groupSupportActionsAll = allSupport.filter(
    (a) =>
      a.semantic !== "PERSONAL_MOBILITY" &&
      a.semantic !== "EMERGENCY_SUPPORT",
  );
  const movementActionsAll = allSupport.filter((a) => a.semantic === "PERSONAL_MOBILITY");
  const combatResActionsAll = allSupport.filter((a) => a.semantic === "EMERGENCY_SUPPORT");
  const dispelPurgeAll = factSets.reduce((s, f) => s + f.dispelPurgeSuccessCount, 0);
  const bloodlustCountAll = factSets.reduce((s, f) => s + (f.bloodlustSuccessCount ?? 0), 0);

  const abilityCoverage =
    factSets.reduce((s, f) => s + f.catalogCoverage.abilityCatalogCoverage, 0) /
    factSets.length;
  const mechanicCoverage =
    input.mechanicCatalogCoverageObserved ??
    factSets.reduce((s, f) => s + f.catalogCoverage.mechanicCatalogCoverage, 0) /
      factSets.length;

  const domainBreakdown: UtilityV2DomainBreakdown[] = [];
  const unusedDomains: UtilityV2FamilyKey[] = [];
  const excludedDomains: Array<{ domain: UtilityV2FamilyKey; reason: string }> = [];
  const uncertainDomains: Array<{ domain: UtilityV2FamilyKey; reason: string }> = [];

  // Per-family opportunity: only runs where the toolkit proves the family available.
  let interruptCap = interruptCapAll;
  let dedupedCc = dedupeStrategicCc(allCc, config.ccDedupeWindowMs);
  let support = scoreSupportCredit(groupSupportActionsAll, config);
  let movementActions = movementActionsAll;
  let combatResActions = combatResActionsAll;
  let dispelPurge = dispelPurgeAll;
  let bloodlustCount = bloodlustCountAll;

  for (const family of UTILITY_V2_FAMILY_KEYS) {
    const applicability = aggregateFamilyApplicability(factSets, family);
    const opportunitySets = factSetsWithFamilyOpportunity(factSets, family);
    const familyCombatHours = Math.max(
      opportunitySets.reduce((s, f) => s + f.activeCombatHours, 0),
      1 / 60,
    );

    let events = 0;
    let credited = 0;
    let perHour = 0;
    const notes: string[] = [];

    if (opportunitySets.length > 0) {
      notes.push(`opportunity_runs=${opportunitySets.length}/${factSets.length}`);
      if (family === "interrupt") {
        const attempts = opportunitySets.flatMap((f) => f.interruptAttempts);
        interruptCap = applyUnmatchedSpamCap(attempts, config);
        events = attempts.length;
        credited = interruptCap.creditedTotal;
        perHour = credited / familyCombatHours;
      } else if (family === "crowdControl") {
        const cc = opportunitySets.flatMap((f) => f.ccActions);
        dedupedCc = dedupeStrategicCc(cc, config.ccDedupeWindowMs);
        events = cc.length;
        credited = dedupedCc.length;
        perHour = credited / familyCombatHours;
      } else if (family === "dispelPurge") {
        dispelPurge = opportunitySets.reduce((s, f) => s + f.dispelPurgeSuccessCount, 0);
        events = dispelPurge;
        credited = dispelPurge;
        perHour = credited / familyCombatHours;
      } else if (family === "groupSupport") {
        const groupActions = opportunitySets
          .flatMap((f) => f.supportActions)
          .filter(
            (a) =>
              a.semantic !== "PERSONAL_MOBILITY" &&
              a.semantic !== "EMERGENCY_SUPPORT",
          );
        support = scoreSupportCredit(groupActions, config);
        events = groupActions.length;
        credited = support.rawCredit;
        perHour = support.diminishedCredit / familyCombatHours;
      } else if (family === "movement") {
        movementActions = opportunitySets
          .flatMap((f) => f.supportActions)
          .filter((a) => a.semantic === "PERSONAL_MOBILITY");
        events = movementActions.length;
        credited = movementActions.length;
        perHour = credited / familyCombatHours;
      } else if (family === "combatRes") {
        combatResActions = opportunitySets
          .flatMap((f) => f.supportActions)
          .filter((a) => a.semantic === "EMERGENCY_SUPPORT");
        events = combatResActions.length;
        credited = combatResActions.length;
        perHour = credited / familyCombatHours;
      } else if (family === "bloodlust") {
        bloodlustCount = opportunitySets.reduce(
          (s, f) => s + (f.bloodlustSuccessCount ?? 0),
          0,
        );
        events = bloodlustCount;
        credited = bloodlustCount;
        perHour = credited / familyCombatHours;
      }
    }

    const used = credited > 0;
    const { include, reason } = familyIncluded(family, applicability, used);
    const applicable = include;
    let raw: number | null = null;

    if (!include) {
      if (applicability.state === "uncertain") {
        uncertainDomains.push({ domain: family, reason });
        notes.push(`excluded_uncertain:${reason}`);
      } else {
        excludedDomains.push({ domain: family, reason });
        notes.push(`excluded:${reason}`);
      }
      domainBreakdown.push({
        domain: family,
        applicable: false,
        rawScore: null,
        weight: config.familyWeights[family],
        weightShare: 0,
        uncappedContribution: 0,
        cappedContribution: 0,
        capApplied: false,
        events,
        creditedEvents: round2(credited),
        perCombatHour: null,
        notes,
      });
      continue;
    }

    if (!used) {
      raw = floor;
      unusedDomains.push(family);
      notes.push("applicable_unused_zero_contribution");
    } else {
      raw = interpolatePerHour(perHour, config.familyCurves[family]);
      notes.push(`denominator=${familyCurveLabel(family)}`);
      if (family === "interrupt") {
        const unmatchedOnly =
          interruptCap.counts.CONFIRMED_SUCCESS +
            interruptCap.counts.VALID_OVERLAP +
            interruptCap.counts.MATCHED_FAILED ===
            0 && interruptCap.counts.UNMATCHED_ATTEMPT > 0;
        if (unmatchedOnly) {
          raw = Math.min(raw, config.unmatchedOnlyMaxDomainScore);
          notes.push("unmatched_only_domain_score_capped");
        }
        if (interruptCap.capApplied) {
          notes.push("unmatched_spam_credit_share_capped");
        }
      }
      if (family === "crowdControl") {
        const rawCc = opportunitySets.flatMap((f) => f.ccActions).length;
        if (rawCc > dedupedCc.length) {
          notes.push(`cc_deduped_${rawCc - dedupedCc.length}`);
        }
      }
      if (family === "groupSupport" && support.passiveOrRotationalIgnored > 0) {
        notes.push(
          `ignored_passive_rotational=${support.passiveOrRotationalIgnored}`,
        );
      }
    }

    raw = clamp(raw, floor, 100);
    domainBreakdown.push({
      domain: family,
      applicable,
      rawScore: round2(raw),
      weight: config.familyWeights[family],
      weightShare: 0,
      uncappedContribution: 0,
      cappedContribution: 0,
      capApplied: false,
      events,
      creditedEvents: round2(credited),
      perCombatHour: round2(perHour),
      notes,
    });
  }

  const supportWithDispel = {
    rawCredit: round2(support.rawCredit + dispelPurge * config.dispelPurgeEventCredit),
    diminishedCredit: round2(
      (() => {
        const combined = support.rawCredit + dispelPurge * config.dispelPurgeEventCredit;
        return combined <= 0 ? 0 : Math.pow(combined, config.supportDiminishingExponent);
      })(),
    ),
    bySemantic: {
      ...support.bySemantic,
      PERSONAL_MOBILITY: movementActions.length,
      EMERGENCY_SUPPORT: combatResActions.length,
    },
    passiveOrRotationalIgnored: support.passiveOrRotationalIgnored,
  };

  const included = domainBreakdown.filter((d) => d.applicable);
  const activeWeights = included.reduce((s, d) => s + d.weight, 0);

  for (const d of domainBreakdown) {
    if (!d.applicable) {
      d.weightShare = 0;
      d.uncappedContribution = 0;
      d.cappedContribution = 0;
      d.capApplied = false;
      continue;
    }
    const share = activeWeights > 0 ? d.weight / activeWeights : 0;
    // 0–100 weighted average: family contribution is share * raw. The old
    // +8 domainContributionCap is obsolete and is not applied.
    const contribution = share * (d.rawScore ?? floor);
    d.weightShare = round2(share);
    d.uncappedContribution = round2(contribution);
    d.cappedContribution = round2(contribution);
    d.capApplied = false;
    d.notes.push(`weight_share=${round2(share)}`);
  }

  const uncertainOnly =
    included.length === 0 && uncertainDomains.length > 0;

  const rawBehaviorEstimate = uncertainOnly
    ? null
    : round2(
        included.reduce((s, d) => s + (d.cappedContribution ?? 0), 0),
      );

  const score =
    rawBehaviorEstimate == null
      ? null
      : round2(clamp(Math.max(floor, rawBehaviorEstimate), 0, 100));

  const attributableEvents = round2(
    interruptCap.creditedTotal +
      support.rawCredit +
      dedupedCc.length +
      dispelPurge +
      movementActions.length +
      combatResActions.length +
      bloodlustCount,
  );

  const reliability = clamp(
    0.25 * clamp01(dungeons.length / config.confidence.expectedDungeons) +
      0.2 * clamp01(factSets.length / config.confidence.runSaturation) +
      0.25 * clamp01(combatHours / config.confidence.combatHourSaturation) +
      0.3 *
        clamp01(
          attributableEvents > 0 || included.length > 0
            ? Math.max(
                attributableEvents / config.confidence.attributableEventSaturation,
                included.length > 0 ? 1 : 0,
              )
            : 0,
        ),
    config.confidence.minReliability,
    1,
  );

  const allLimitations = new Set(factSets.flatMap((f) => f.limitations));
  const hostileNotPersistedInDigest = allLimitations.has(
    "hostile_cast_windows_not_persisted_in_digest",
  );
  const catalogCoverageUnmeasured =
    allLimitations.has("digest_catalog_coverage_unmeasured") ||
    allLimitations.has("catalog_coverage_unmeasured_fallback");
  const talentUncertain = allLimitations.has("talent_data_unavailable") ||
    uncertainDomains.length > 0;

  const observedToolkitComplete = included.length > 0 || unusedDomains.length > 0;
  const confComponents = {
    dungeonCoverage: clamp01(dungeons.length / config.confidence.expectedDungeons),
    runCoverage: clamp01(factSets.length / config.confidence.runSaturation),
    combatDuration: clamp01(combatHours / config.confidence.combatHourSaturation),
    attributableEvents: observedToolkitComplete
      ? 1
      : clamp01(attributableEvents / config.confidence.attributableEventSaturation),
    mechanicCatalogCoverageObserved: catalogCoverageUnmeasured
      ? 0
      : clamp01(mechanicCoverage),
    sourceCompleteness: clamp01(
      (factSets.length > 0 ? 0.4 : 0) +
        (hostileBegincastCount > 0 ? 0.3 : 0) +
        (observedToolkitComplete ? 0.3 : 0),
    ),
  };
  const w = config.confidence.weights;
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
  if (uncertainOnly) {
    confidence = Math.min(confidence, config.confidence.maxWhenZeroAttributable);
    confidenceReasons.push("applicability_uncertain");
  }
  if (
    hostileBegincastCount === 0 &&
    families.interrupt.state === "applicable" &&
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
  if (talentUncertain) {
    confidenceReasons.push("talent_applicability_uncertain");
  }
  confidence = round2(clamp(confidence, 0, 100));

  const confidenceBreakdown = buildDimensionConfidenceBreakdown({
    value: confidence / 100,
    causes: confidenceReasons,
    components: Object.fromEntries(
      Object.entries(confComponents).map(([k, v]) => [k, round2(v)]),
    ),
  });

  const applicableDomains = included.map((d) => d.domain);
  const domainCurves = {} as Record<UtilityV2FamilyKey, string>;
  for (const family of UTILITY_V2_FAMILY_KEYS) {
    domainCurves[family] = familyCurveLabel(family);
  }

  const explanation: UtilityV2Explanation = {
    mode: "OBSERVED_CONTRIBUTION",
    publicationBlocked: true,
    availabilityState: uncertainOnly ? "PARTIAL" : availabilityState,
    scoreFloor: floor,
    domainWeights: { ...config.familyWeights },
    familyWeights: { ...config.familyWeights },
    interruptCredits: { ...config.interruptCredits },
    interruptClassification: interruptCap.counts,
    domainCurves,
    caps: {
      unmatchedCreditShareCap: config.unmatchedCreditShareCap,
      unmatchedOnlyMaxDomainScore: config.unmatchedOnlyMaxDomainScore,
    },
    applicableDomains,
    unusedDomains,
    excludedDomains,
    uncertainDomains,
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
  > = {
    availabilityState: explanation.availabilityState,
    domainBreakdown,
  };
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
    availabilityState: explanation.availabilityState,
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
    availabilityState: explanation.availabilityState,
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
  const families = emptyFamilyApplicability("applicable", "test_fixture");
  families.combatRes = { state: "optional", reason: "optional_group_expectation" };
  families.bloodlust = { state: "optional", reason: "optional_group_expectation" };
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
      families,
    },
    interruptAttempts: [],
    ccActions: [],
    supportActions: [],
    dispelPurgeSuccessCount: 0,
    bloodlustSuccessCount: 0,
    catalogCoverage: {
      abilityCatalogCoverage: 0.8,
      mechanicCatalogCoverage: 0.5,
    },
    limitations: [],
    ...partial,
  };
}
