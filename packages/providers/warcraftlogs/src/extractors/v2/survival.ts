/**
 * Survival V2 fact extractors — pure mapping + shared-evidence path.
 * No network; consumes persisted WclRunEvidenceBundle or analysis intermediates.
 */

import type { AbilityCatalog } from "@mplus/abilities";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
  type SurvivalFactDocumentV2,
} from "@mplus/scoring";

type SurvivalV2DangerWindowFact = SurvivalFactDocumentV2["dangerWindows"][number];
type SurvivalV2DefensiveActivationFact = SurvivalFactDocumentV2["defensiveActivations"];
type SurvivalV2DefensiveCategory = Exclude<
  keyof NonNullable<SurvivalV2DefensiveActivationFact["byCategory"]>,
  number | symbol
>;
type SurvivalV2HealthEvidenceMode = SurvivalFactDocumentV2["healthEvidence"]["mode"];
type SurvivalV2HpEvidenceQuality = SurvivalV2DangerWindowFact["hpEvidenceQuality"];
type SurvivalV2ToolkitAvailabilityState =
  SurvivalV2DefensiveActivationFact["toolkit"][number]["state"];
import {
  buildSurvivalAnalysisFromSharedEvidence,
  sharedEvidenceBundleHasSurvivalDatasets,
} from "../../evidence/survival-from-shared-evidence.js";
import type { WclRunEvidenceBundle } from "../../evidence/wcl-run-evidence-types.js";
import type { SurvivalCalibrationRun } from "../../probe/survival-calibration-types.js";
import type { SurvivalProbeIdentity } from "../../probe/survival-probe-types.js";
import { scoreSurvivalV1_1_1Run } from "../../probe/survival-v1_1_1-logic.js";
import type { SurvivalV1_1DangerWindowAudit } from "../../probe/survival-v1_1-types.js";
import type { SurvivalV1_1_1RunScore } from "../../probe/survival-v1_1_1-logic.js";
import {
  FACT_V2_MAX_LIMITATIONS,
  SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
  SURVIVAL_V2_MAX_DANGER_WINDOWS,
} from "./constants.js";
import type {
  FrozenSlotBindingV2,
  SurvivalFactExtractionOutcome,
} from "./types.js";

const APPLICABLE_DEFENSIVE_CATEGORIES = new Set<string>([
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
  "ABSORB",
  "HEALTH_INCREASE",
]);

function clampLimitations(limitations: string[]): string[] {
  return [...new Set(limitations.filter((l) => l.length > 0))].slice(
    0,
    FACT_V2_MAX_LIMITATIONS,
  );
}

function mapToolkitState(
  availability: SurvivalCalibrationRun["defensives"][number]["availability"],
  castCount: number,
  talentDependentOrUncertain: boolean,
): SurvivalV2ToolkitAvailabilityState {
  if (talentDependentOrUncertain && castCount === 0) return "UNKNOWN";
  if (availability === "BASELINE") {
    return castCount > 0 ? "AVAILABLE_CONFIRMED" : "AVAILABLE_INFERRED";
  }
  if (availability === "TALENT" || availability === "CHOICE_NODE") {
    return castCount > 0 ? "AVAILABLE_CONFIRMED" : "AVAILABLE_INFERRED";
  }
  if (availability === "PET_DEPENDENT" || availability === "FORM_DEPENDENT") {
    return castCount > 0 ? "AVAILABLE_CONFIRMED" : "UNKNOWN";
  }
  return castCount > 0 ? "AVAILABLE_CONFIRMED" : "UNKNOWN";
}

function mapHealthMode(input: {
  runScore: SurvivalV1_1_1RunScore;
  truncated: boolean;
  missingDatasets: boolean;
}): SurvivalV2HealthEvidenceMode {
  if (input.missingDatasets) return "MISSING";
  if (input.truncated) return "TRUNCATED";
  if (input.runScore.scoreMode === "OUTCOME_ONLY") return "OUTCOME_ONLY";
  if (input.runScore.scoreMode === "PARTIAL_BEHAVIORAL") return "PARTIAL";
  if (input.runScore.healthTimelineComplete) return "FULL";
  return "PARTIAL";
}

function mapHpEvidenceQuality(
  window: SurvivalV1_1DangerWindowAudit,
): SurvivalV2HpEvidenceQuality {
  if (window.minimumHp != null && window.maximumHp != null) return "EXPLICIT";
  if (window.hpBefore != null || window.minimumHp != null) return "PARTIAL";
  if (window.deathOutcome) return "RECONSTRUCTED";
  return "MISSING";
}

function mapDangerWindows(
  windows: SurvivalV1_1DangerWindowAudit[],
): SurvivalV2DangerWindowFact[] {
  const bounded = windows.slice(0, SURVIVAL_V2_MAX_DANGER_WINDOWS);
  return bounded.map((w) => ({
    startMs: w.startTimestamp,
    endMs: w.endTimestamp,
    triggerTypes: w.triggerTypes.map(String),
    hpEvidenceQuality: mapHpEvidenceQuality(w),
    damageAmount: null,
    recoveryUseful: w.recoveryActionsDetected.length > 0,
    recoveryEligible: w.recoveryCoverageKind !== "not_applicable",
    deathOutcome: w.deathOutcome,
    availabilityState:
      w.confirmedAvailableDefensives.length > 0
        ? ("AVAILABLE_CONFIRMED" as const)
        : w.applicableDefensiveRules.length > 0
          ? ("AVAILABLE_INFERRED" as const)
          : ("UNKNOWN" as const),
  }));
}

function mapDefensiveActivations(
  run: SurvivalCalibrationRun,
): SurvivalV2DefensiveActivationFact {
  const byCategory: Partial<Record<SurvivalV2DefensiveCategory, number>> = {};
  const toolkit: SurvivalV2DefensiveActivationFact["toolkit"] = [];
  let covered = 0;
  let applicable = 0;

  for (const d of run.defensives) {
    if (!APPLICABLE_DEFENSIVE_CATEGORIES.has(d.category)) continue;
    applicable += 1;
    const category = d.category as SurvivalV2DefensiveCategory;
    byCategory[category] = (byCategory[category] ?? 0) + d.castCount;
    const state = mapToolkitState(
      d.availability,
      d.castCount,
      d.talentDependentOrUncertain,
    );
    if (state !== "UNKNOWN" && state !== "NOT_APPLICABLE") covered += 1;
    toolkit.push({
      category,
      state,
      reason: d.note || null,
      spellIds: [d.spellId],
    });
  }

  return {
    byCategory,
    toolkit,
    catalogCoverage: applicable === 0 ? 0 : covered / applicable,
  };
}

/**
 * Pure mapper: Survival calibration analysis → bounded SurvivalFactDocumentV2.
 * Does not call providers.
 */
export function mapSurvivalRunToFactDocumentV2(input: {
  run: SurvivalCalibrationRun;
  reportRevision: number;
  slotIndex: number;
  runScore: SurvivalV1_1_1RunScore;
  dangerWindows: SurvivalV1_1DangerWindowAudit[];
  pressureClustersPremerged?: boolean;
  truncated?: boolean;
  limitations?: string[];
  extractorVersion?: string;
}): SurvivalFactDocumentV2 {
  const fightDurationMs = Math.max(1, input.run.durationMs);
  const truncated = input.truncated === true;
  const missingDatasets = input.run.missingDatasets.length > 0;
  const limitations = clampLimitations([
    ...(input.limitations ?? []),
    ...(truncated ? ["event_pages_truncated"] : []),
    ...(missingDatasets
      ? input.run.missingDatasets.map((d) => `missing_dataset:${d}`)
      : []),
    ...(input.dangerWindows.length > SURVIVAL_V2_MAX_DANGER_WINDOWS
      ? ["danger_windows_truncated_to_bound"]
      : []),
  ]);

  return {
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
    extractorVersion: input.extractorVersion ?? SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
    dungeonSlug: input.run.dungeonSlug,
    slotIndex: input.slotIndex,
    identity: {
      reportCode: input.run.reportCode,
      fightId: input.run.fightId,
      reportRevision: input.reportRevision,
    },
    keyLevel: input.run.keyLevel,
    deaths: {
      count: input.run.deaths.deathCount,
      timestampsMs: input.run.deaths.deathTimestamps.slice(0, 32),
    },
    activeCombat: {
      // Phase 1: fight duration is the active-combat denominator when a dedicated
      // combat-clock dataset is absent (explicit limitation).
      durationMs: fightDurationMs,
      fightDurationMs,
      truncated,
    },
    defensiveActivations: mapDefensiveActivations(input.run),
    dangerWindows: mapDangerWindows(input.dangerWindows),
    pressureClustersPremerged: input.pressureClustersPremerged === true,
    healthEvidence: {
      mode: mapHealthMode({
        runScore: input.runScore,
        truncated,
        missingDatasets,
      }),
    },
    // Relative damage stays null under Phase 1 default (mode off) — never fabricate.
    relativeDamage: null,
    limitations: [
      ...limitations,
      "active_combat:fight_duration_fallback",
      "relative_damage:not_extracted_phase1",
    ].slice(0, FACT_V2_MAX_LIMITATIONS),
  };
}

/**
 * Extract SurvivalFactDocumentV2 from a persisted shared WCL evidence bundle.
 */
export function extractSurvivalFactDocumentV2FromSharedEvidence(input: {
  bundle: WclRunEvidenceBundle;
  slot: FrozenSlotBindingV2;
  characterId: string;
  identity: SurvivalProbeIdentity;
  playerActorId: number;
  ownedPetActorIds?: number[];
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  keyLevel?: number | null;
  extractorVersion?: string;
}): SurvivalFactExtractionOutcome {
  const { slot, bundle } = input;
  const reportRevision = slot.identity.reportRevision;

  if (
    bundle.reportCode !== slot.identity.reportCode ||
    bundle.fightId !== slot.identity.fightId
  ) {
    return {
      status: "FAILED",
      dimension: "SURVIVAL",
      fact: null,
      limitations: ["frozen_identity_mismatch"],
      category: "incompatible_evidence",
      reason: "bundle_identity_does_not_match_frozen_slot",
    };
  }

  if (bundle.reportRevision != null && bundle.reportRevision !== reportRevision) {
    return {
      status: "FAILED",
      dimension: "SURVIVAL",
      fact: null,
      limitations: ["report_revision_mismatch"],
      category: "incompatible_evidence",
      reason: "bundle_revision_mismatch",
    };
  }

  if (!sharedEvidenceBundleHasSurvivalDatasets(bundle)) {
    return {
      status: "UNAVAILABLE",
      dimension: "SURVIVAL",
      fact: null,
      limitations: ["incomplete_survival_shared_evidence"],
      category: "incomplete_shared_evidence",
      reason: "required_survival_datasets_absent",
    };
  }

  try {
    const fightStart = bundle.startTime ?? 0;
    const fightEnd =
      bundle.endTime ??
      (bundle.startTime != null ? bundle.startTime + 1_800_000 : 1_800_000);

    const analyzed = buildSurvivalAnalysisFromSharedEvidence({
      bundle,
      characterId: input.characterId,
      identity: input.identity,
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      reportRevision,
      dungeonSlug: slot.dungeonSlug || bundle.dungeonSlug,
      keyLevel: input.keyLevel ?? slot.keyLevel,
      playerActorId: input.playerActorId,
      ownedPetActorIds: input.ownedPetActorIds ?? bundle.ownedPetActorIds ?? [],
      fightStartTime: fightStart,
      fightEndTime: fightEnd,
      catalog: input.catalog,
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    });

    // Re-score to recover danger windows (summary path drops them).
    const scored = scoreSurvivalV1_1_1Run({
      run: analyzed.run,
      catalog: input.catalog,
      classSlug: input.classSlug,
      snapshots: analyzed.snapshots,
      eventPagesComplete: !analyzed.truncated,
    });

    const fact = mapSurvivalRunToFactDocumentV2({
      run: analyzed.run,
      reportRevision,
      slotIndex: slot.slotIndex,
      runScore: scored.runScore,
      dangerWindows: scored.dangerWindows,
      pressureClustersPremerged: true,
      truncated: analyzed.truncated,
      limitations: analyzed.maxHpFailureReason
        ? [`max_hp:${analyzed.maxHpFailureReason}`]
        : [],
      extractorVersion: input.extractorVersion,
    });

    return {
      status: "WRITTEN",
      dimension: "SURVIVAL",
      fact,
      limitations: fact.limitations,
      category: null,
      reason: null,
    };
  } catch {
    return {
      status: "FAILED",
      dimension: "SURVIVAL",
      fact: null,
      limitations: ["survival_extraction_failed"],
      category: "analysis_failed",
      reason: "survival_analysis_threw",
    };
  }
}
