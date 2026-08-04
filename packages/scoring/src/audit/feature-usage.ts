/**
 * Bounded featureUsage sections for dimension metrics / evidence audit.
 * Detects SCORE features extracted but never consumed.
 */

import type {
  EvidenceAuditFeatureRegistryEntry,
  FeatureUsageEntry,
} from "@mplus/contracts";
import type { SurvivalFactDocumentV2 } from "../survival/v2/types.js";
import type { UtilityV2RunFactSet } from "../utility/v2/types.js";
import type { PerformanceRunParseFactV2 } from "../performance/v2/types.js";
import {
  PERFORMANCE_FEATURE_REGISTRY,
  SURVIVAL_FEATURE_REGISTRY,
  UTILITY_FEATURE_REGISTRY,
} from "./feature-registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countZeroMeaningful(n: number | null | undefined): number {
  return n === 0 ? 1 : 0;
}

export interface FeatureUsageBuildResult {
  featureUsage: FeatureUsageEntry[];
  /** Fail-closed integrity failures (SCORE extracted but never consumed, etc.). */
  integrityFailures: string[];
}

function baseEntry(
  feature: EvidenceAuditFeatureRegistryEntry,
  partial: Omit<
    FeatureUsageEntry,
    "featurePath" | "scoringRole"
  >,
): FeatureUsageEntry {
  return {
    featurePath: feature.featurePath,
    scoringRole: feature.scoringRole,
    ...partial,
  };
}

export function buildSurvivalFeatureUsage(
  factSets: SurvivalFactDocumentV2[],
  options?: { relativeDamageMode?: "off" | "shadow" | "active" },
): FeatureUsageBuildResult {
  const mode = options?.relativeDamageMode ?? "shadow";
  const n = factSets.length;
  const integrityFailures: string[] = [];
  const featureUsage: FeatureUsageEntry[] = [];

  for (const feature of SURVIVAL_FEATURE_REGISTRY) {
    let containing = 0;
    let valid = 0;
    let missing = 0;
    let zero = 0;
    let consumed = true;
    let outputField: string | null = feature.outputMetricOrExplanationField;
    let exclusionReason: string | null = null;

    for (const fs of factSets) {
      containing += 1;
      switch (feature.featurePath) {
        case "survival.deaths": {
          valid += 1;
          zero += countZeroMeaningful(fs.deaths.count);
          break;
        }
        case "survival.activeCombat": {
          if (fs.activeCombat.durationMs > 0) valid += 1;
          else {
            missing += 1;
            zero += 1;
          }
          break;
        }
        case "survival.defensiveActivations.byCategory": {
          valid += 1;
          const total = Object.values(fs.defensiveActivations.byCategory).reduce(
            (s, v) => s + (v ?? 0),
            0,
          );
          zero += countZeroMeaningful(total);
          break;
        }
        case "survival.defensiveActivations.toolkit": {
          if (fs.defensiveActivations.toolkit.length > 0) valid += 1;
          else missing += 1;
          break;
        }
        case "survival.defensiveActivations.catalogCoverage": {
          valid += 1;
          zero += countZeroMeaningful(fs.defensiveActivations.catalogCoverage);
          break;
        }
        case "survival.dangerWindows": {
          valid += 1;
          zero += countZeroMeaningful(fs.dangerWindows.length);
          break;
        }
        case "survival.dangerWindows.hpEvidenceQuality": {
          const withHp = fs.dangerWindows.filter((w) => w.hpEvidenceQuality !== "MISSING");
          if (withHp.length > 0) valid += 1;
          else if (fs.dangerWindows.length === 0) missing += 1;
          else valid += 1;
          break;
        }
        case "survival.dangerWindows.recoveryUseful": {
          const eligible = fs.dangerWindows.filter((w) => w.recoveryEligible);
          if (eligible.length === 0) missing += 1;
          else {
            valid += 1;
            zero += eligible.every((w) => !w.recoveryUseful) ? 1 : 0;
          }
          break;
        }
        case "survival.relativeDamage": {
          if (fs.relativeDamage == null) {
            missing += 1;
            if (mode !== "active") {
              consumed = false;
              exclusionReason = `relativeDamageMode=${mode}; explainability/shadow only`;
            }
          } else {
            valid += 1;
            if (mode === "off") {
              consumed = false;
              exclusionReason = "relativeDamageMode=off";
            } else if (mode === "shadow") {
              // Consumed into explanation/metrics, not numeric public score.
              outputField = "relativeDamageShadow (publicContribution=0)";
            }
          }
          break;
        }
        case "survival.healthEvidence.mode": {
          valid += 1;
          if (fs.healthEvidence.mode === "MISSING") missing += 1;
          break;
        }
        default:
          missing += 1;
          consumed = false;
          exclusionReason = "unregistered_path_handler";
      }
    }

    if (n === 0) {
      containing = 0;
      missing = 1;
      if (feature.scoringRole === "SCORE" && !feature.nullableOptional) {
        // Required SCORE with no facts — availability limitation expected upstream.
        exclusionReason = exclusionReason ?? "no_selected_slot_facts";
      }
    }

    const entry = baseEntry(feature, {
      selectedSlotCountContaining: containing,
      validValueCount: valid,
      missingCount: missing,
      zeroCount: feature.featurePath.includes("toolkit") ? null : zero,
      consumed,
      outputComponentOrConfidenceField: consumed ? outputField : null,
      exclusionReason,
    });
    featureUsage.push(entry);

    if (feature.scoringRole === "SCORE" && n > 0 && !consumed && !exclusionReason) {
      integrityFailures.push(
        `SCORE_FEATURE_NOT_CONSUMED:${feature.featurePath}`,
      );
    }
    if (
      feature.scoringRole === "SCORE" &&
      !feature.nullableOptional &&
      n > 0 &&
      valid === 0 &&
      missing === n &&
      !exclusionReason
    ) {
      integrityFailures.push(
        `REQUIRED_FEATURE_MISSING:${feature.featurePath}`,
      );
    }
  }

  return { featureUsage, integrityFailures };
}

export function buildUtilityFeatureUsage(
  factSets: UtilityV2RunFactSet[],
): FeatureUsageBuildResult {
  const n = factSets.length;
  const integrityFailures: string[] = [];
  const featureUsage: FeatureUsageEntry[] = [];

  for (const feature of UTILITY_FEATURE_REGISTRY) {
    let containing = 0;
    let valid = 0;
    let missing = 0;
    let zero = 0;
    const consumed = true;
    const outputField: string | null = feature.outputMetricOrExplanationField;
    const exclusionReason: string | null = null;

    for (const fs of factSets) {
      containing += 1;
      switch (feature.featurePath) {
        case "utility.interruptAttempts.CONFIRMED_SUCCESS": {
          const c = fs.interruptAttempts.filter((a) => a.classification === "CONFIRMED_SUCCESS")
            .length;
          valid += 1;
          zero += countZeroMeaningful(c);
          break;
        }
        case "utility.interruptAttempts.VALID_OVERLAP": {
          const c = fs.interruptAttempts.filter((a) => a.classification === "VALID_OVERLAP")
            .length;
          valid += 1;
          zero += countZeroMeaningful(c);
          break;
        }
        case "utility.interruptAttempts.MATCHED_FAILED": {
          const c = fs.interruptAttempts.filter((a) => a.classification === "MATCHED_FAILED")
            .length;
          valid += 1;
          zero += countZeroMeaningful(c);
          break;
        }
        case "utility.interruptAttempts.UNMATCHED_ATTEMPT": {
          const c = fs.interruptAttempts.filter((a) => a.classification === "UNMATCHED_ATTEMPT")
            .length;
          valid += 1;
          zero += countZeroMeaningful(c);
          break;
        }
        case "utility.hostileObservability": {
          valid += 1;
          if (fs.hostileObservability === "ABSENT") missing += 1;
          zero += countZeroMeaningful(fs.hostileBegincastCount);
          break;
        }
        case "utility.ccActions": {
          valid += 1;
          zero += countZeroMeaningful(fs.ccActions.length);
          break;
        }
        case "utility.supportActions": {
          valid += 1;
          zero += countZeroMeaningful(fs.supportActions.length);
          break;
        }
        case "utility.dispelPurgeSuccessCount": {
          valid += 1;
          zero += countZeroMeaningful(fs.dispelPurgeSuccessCount);
          break;
        }
        case "utility.activeCombatMs": {
          if (fs.activeCombatMs > 0) valid += 1;
          else {
            missing += 1;
            zero += 1;
          }
          break;
        }
        case "utility.toolkit": {
          valid += 1;
          break;
        }
        case "utility.catalogCoverage.abilityCatalogCoverage": {
          valid += 1;
          zero += countZeroMeaningful(fs.catalogCoverage.abilityCatalogCoverage);
          break;
        }
        case "utility.catalogCoverage.mechanicCatalogCoverage": {
          valid += 1;
          zero += countZeroMeaningful(fs.catalogCoverage.mechanicCatalogCoverage);
          break;
        }
        default:
          missing += 1;
      }
    }

    featureUsage.push(
      baseEntry(feature, {
        selectedSlotCountContaining: containing,
        validValueCount: valid,
        missingCount: n === 0 ? 1 : missing,
        zeroCount: zero,
        consumed: n === 0 ? false : consumed,
        outputComponentOrConfidenceField: n === 0 ? null : outputField,
        exclusionReason: n === 0 ? "no_selected_slot_facts" : exclusionReason,
      }),
    );

    if (feature.scoringRole === "SCORE" && n > 0 && !consumed) {
      integrityFailures.push(`SCORE_FEATURE_NOT_CONSUMED:${feature.featurePath}`);
    }
  }

  return { featureUsage, integrityFailures };
}

export function buildPerformanceFeatureUsage(
  runParseFacts: PerformanceRunParseFactV2[],
  options?: {
    hasProfileAggregate?: boolean;
    unavailableProvenance?: string[];
  },
): FeatureUsageBuildResult {
  const n = runParseFacts.length;
  const provenance = options?.unavailableProvenance ?? [];
  const integrityFailures: string[] = [];
  const featureUsage: FeatureUsageEntry[] = [];

  for (const feature of PERFORMANCE_FEATURE_REGISTRY) {
    let containing = 0;
    let valid = 0;
    let missing = 0;
    let zero = 0;
    let consumed = true;
    let outputField: string | null = feature.outputMetricOrExplanationField;
    let exclusionReason: string | null = null;

    if (feature.featurePath === "performance.profileAggregate") {
      if (options?.hasProfileAggregate) {
        containing = 1;
        valid = 1;
      } else {
        missing = 1;
        consumed = false;
        exclusionReason = "profile_aggregate_absent_detailed_only";
        outputField = null;
      }
    } else if (feature.featurePath === "performance.unavailableProvenance") {
      containing = provenance.length > 0 || n > 0 ? 1 : 0;
      if (provenance.length > 0) {
        valid = 1;
        consumed = true;
      } else if (n > 0 && runParseFacts.every((f) => f.semantic !== "UNAVAILABLE")) {
        missing = 1;
        consumed = false;
        exclusionReason = "no_unavailable_provenance_needed";
        outputField = null;
      } else {
        missing = 1;
        // Missing provenance when UNAVAILABLE is an integrity issue.
        if (n > 0 && runParseFacts.some((f) => f.semantic === "UNAVAILABLE")) {
          integrityFailures.push("REQUIRED_FEATURE_MISSING:performance.unavailableProvenance");
        }
      }
    } else {
      for (const f of runParseFacts) {
        containing += 1;
        switch (feature.featurePath) {
          case "performance.parsePercentile": {
            if (f.semantic === "UNAVAILABLE" || f.parsePercentile == null) {
              missing += 1;
              consumed = f.semantic === "UNAVAILABLE";
              if (f.semantic === "UNAVAILABLE") {
                exclusionReason = "semantic_UNAVAILABLE_structured";
              }
            } else {
              valid += 1;
              zero += countZeroMeaningful(f.parsePercentile);
            }
            break;
          }
          case "performance.semantic": {
            valid += 1;
            break;
          }
          case "performance.keyLevel": {
            if (Number.isFinite(f.keyLevel)) valid += 1;
            else missing += 1;
            break;
          }
          case "performance.partition": {
            if (f.partition == null) missing += 1;
            else valid += 1;
            break;
          }
          default:
            missing += 1;
        }
      }
    }

    if (n === 0 && feature.featurePath !== "performance.profileAggregate") {
      if (feature.featurePath === "performance.unavailableProvenance" && provenance.length > 0) {
        // already handled
      } else if (feature.nullableOptional || feature.scoringRole === "EXPLAINABILITY_ONLY") {
        missing = Math.max(missing, 1);
        consumed = feature.scoringRole === "EXPLAINABILITY_ONLY" && provenance.length > 0;
        exclusionReason =
          exclusionReason ??
          (provenance.length > 0
            ? null
            : "ranking_parse_unavailable");
      } else if (feature.scoringRole === "AVAILABILITY") {
        missing = 1;
        consumed = true;
        outputField = "availabilityState=UNAVAILABLE";
      } else {
        missing = 1;
        consumed = false;
        exclusionReason = exclusionReason ?? "ranking_parse_facts_absent";
      }
    }

    featureUsage.push(
      baseEntry(feature, {
        selectedSlotCountContaining: containing,
        validValueCount: valid,
        missingCount: missing,
        zeroCount: feature.featurePath === "performance.semantic" ? null : zero,
        consumed,
        outputComponentOrConfidenceField: consumed ? outputField : null,
        exclusionReason,
      }),
    );

    if (
      feature.scoringRole === "SCORE" &&
      !feature.nullableOptional &&
      n > 0 &&
      !consumed &&
      !exclusionReason
    ) {
      integrityFailures.push(`SCORE_FEATURE_NOT_CONSUMED:${feature.featurePath}`);
    }
  }

  return { featureUsage, integrityFailures };
}

/** Re-derive featureUsage from persisted dimension metrics when present. */
export function featureUsageFromMetrics(metrics: unknown): FeatureUsageEntry[] | null {
  if (!isRecord(metrics)) return null;
  const usage = metrics.featureUsage;
  if (!Array.isArray(usage)) return null;
  const out: FeatureUsageEntry[] = [];
  for (const item of usage) {
    if (!isRecord(item)) continue;
    if (typeof item.featurePath !== "string") continue;
    if (typeof item.consumed !== "boolean") continue;
    if (
      item.scoringRole !== "SCORE" &&
      item.scoringRole !== "CONFIDENCE" &&
      item.scoringRole !== "AVAILABILITY" &&
      item.scoringRole !== "EXPLAINABILITY_ONLY"
    ) {
      continue;
    }
    out.push({
      featurePath: item.featurePath,
      selectedSlotCountContaining:
        typeof item.selectedSlotCountContaining === "number"
          ? item.selectedSlotCountContaining
          : 0,
      validValueCount: typeof item.validValueCount === "number" ? item.validValueCount : 0,
      missingCount: typeof item.missingCount === "number" ? item.missingCount : 0,
      zeroCount: typeof item.zeroCount === "number" ? item.zeroCount : null,
      scoringRole: item.scoringRole,
      consumed: item.consumed,
      outputComponentOrConfidenceField:
        typeof item.outputComponentOrConfidenceField === "string"
          ? item.outputComponentOrConfidenceField
          : null,
      exclusionReason: typeof item.exclusionReason === "string" ? item.exclusionReason : null,
    });
  }
  return out.length > 0 ? out : null;
}
