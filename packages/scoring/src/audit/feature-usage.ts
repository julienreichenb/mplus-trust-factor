/**
 * Bounded featureUsage sections for dimension metrics / evidence audit.
 * Consumed=true only when a scorer-owned consumption trace exists.
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
import {
  indexTracesByFeature,
  type FeatureConsumptionTrace,
} from "./consumption-trace.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countZeroMeaningful(n: number | null | undefined): number {
  return n === 0 ? 1 : 0;
}

export interface FeatureUsageBuildResult {
  featureUsage: FeatureUsageEntry[];
  integrityFailures: string[];
}

function baseEntry(
  feature: EvidenceAuditFeatureRegistryEntry,
  partial: Omit<FeatureUsageEntry, "featurePath" | "scoringRole">,
): FeatureUsageEntry {
  return {
    featurePath: feature.featurePath,
    scoringRole: feature.scoringRole,
    ...partial,
  };
}

function resolveConsumption(
  feature: EvidenceAuditFeatureRegistryEntry,
  byPath: Map<string, FeatureConsumptionTrace>,
  n: number,
): {
  consumed: boolean;
  outputField: string | null;
  exclusionReason: string | null;
  integrityFailure: string | null;
} {
  const trace = byPath.get(feature.featurePath);
  if (trace) {
    const offMode =
      trace.exclusionReason != null &&
      /relativeDamageMode=off/i.test(trace.exclusionReason);
    return {
      consumed: !offMode,
      outputField: trace.outputField,
      exclusionReason: trace.exclusionReason ?? null,
      integrityFailure: null,
    };
  }
  if (n === 0) {
    return {
      consumed: false,
      outputField: null,
      exclusionReason: "no_selected_slot_facts",
      integrityFailure: null,
    };
  }
  if (feature.scoringRole === "SCORE" && !feature.nullableOptional) {
    return {
      consumed: false,
      outputField: null,
      exclusionReason: "SCORE_FEATURE_NOT_CONSUMED",
      integrityFailure: `SCORE_FEATURE_NOT_CONSUMED:${feature.featurePath}`,
    };
  }
  return {
    consumed: false,
    outputField: null,
    exclusionReason: "not_traced_by_scorer",
    integrityFailure: null,
  };
}

export function buildSurvivalFeatureUsage(
  factSets: SurvivalFactDocumentV2[],
  options?: {
    relativeDamageMode?: "off" | "shadow" | "active";
    consumptionTraces?: readonly FeatureConsumptionTrace[];
  },
): FeatureUsageBuildResult {
  const n = factSets.length;
  const byPath = indexTracesByFeature(options?.consumptionTraces ?? []);
  const integrityFailures: string[] = [];
  const featureUsage: FeatureUsageEntry[] = [];

  for (const feature of SURVIVAL_FEATURE_REGISTRY) {
    let containing = 0;
    let valid = 0;
    let missing = 0;
    let zero = 0;

    for (const fs of factSets) {
      containing += 1;
      switch (feature.featurePath) {
        case "survival.deaths":
          valid += 1;
          zero += countZeroMeaningful(fs.deaths.count);
          break;
        case "survival.activeCombat":
          if (fs.activeCombat.durationMs > 0) valid += 1;
          else {
            missing += 1;
            zero += 1;
          }
          break;
        case "survival.defensiveActivations.byCategory": {
          valid += 1;
          const total = Object.values(fs.defensiveActivations.byCategory).reduce(
            (s, v) => s + (v ?? 0),
            0,
          );
          zero += countZeroMeaningful(total);
          break;
        }
        case "survival.defensiveActivations.toolkit":
          if (fs.defensiveActivations.toolkit.length > 0) valid += 1;
          else missing += 1;
          break;
        case "survival.defensiveActivations.catalogCoverage":
          valid += 1;
          zero += countZeroMeaningful(fs.defensiveActivations.catalogCoverage);
          break;
        case "survival.dangerWindows":
          valid += 1;
          zero += countZeroMeaningful(fs.dangerWindows.length);
          break;
        case "survival.dangerWindows.hpEvidenceQuality": {
          const withHp = fs.dangerWindows.filter((w) => w.hpEvidenceQuality !== "MISSING");
          if (withHp.length > 0 || fs.dangerWindows.length > 0) valid += 1;
          else missing += 1;
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
        case "survival.relativeDamage":
          if (fs.relativeDamage == null) missing += 1;
          else valid += 1;
          break;
        case "survival.healthEvidence.mode":
          valid += 1;
          if (fs.healthEvidence.mode === "MISSING") missing += 1;
          break;
        default:
          missing += 1;
      }
    }

    const consumption = resolveConsumption(feature, byPath, n);
    if (consumption.integrityFailure) {
      integrityFailures.push(consumption.integrityFailure);
    }

    featureUsage.push(
      baseEntry(feature, {
        selectedSlotCountContaining: containing,
        validValueCount: valid,
        missingCount: n === 0 ? 1 : missing,
        zeroCount: feature.featurePath.includes("toolkit") ? null : zero,
        consumed: consumption.consumed,
        outputComponentOrConfidenceField: consumption.outputField,
        exclusionReason: consumption.exclusionReason,
      }),
    );
  }

  return { featureUsage, integrityFailures };
}

export function buildUtilityFeatureUsage(
  factSets: UtilityV2RunFactSet[],
  options?: { consumptionTraces?: readonly FeatureConsumptionTrace[] },
): FeatureUsageBuildResult {
  const n = factSets.length;
  const byPath = indexTracesByFeature(options?.consumptionTraces ?? []);
  const integrityFailures: string[] = [];
  const featureUsage: FeatureUsageEntry[] = [];

  for (const feature of UTILITY_FEATURE_REGISTRY) {
    let containing = 0;
    let valid = 0;
    let missing = 0;
    let zero = 0;

    for (const fs of factSets) {
      containing += 1;
      switch (feature.featurePath) {
        case "utility.interruptAttempts.CONFIRMED_SUCCESS": {
          valid += 1;
          zero += countZeroMeaningful(
            fs.interruptAttempts.filter((a) => a.classification === "CONFIRMED_SUCCESS")
              .length,
          );
          break;
        }
        case "utility.interruptAttempts.VALID_OVERLAP": {
          valid += 1;
          zero += countZeroMeaningful(
            fs.interruptAttempts.filter((a) => a.classification === "VALID_OVERLAP").length,
          );
          break;
        }
        case "utility.interruptAttempts.MATCHED_FAILED": {
          valid += 1;
          zero += countZeroMeaningful(
            fs.interruptAttempts.filter((a) => a.classification === "MATCHED_FAILED")
              .length,
          );
          break;
        }
        case "utility.interruptAttempts.UNMATCHED_ATTEMPT": {
          valid += 1;
          zero += countZeroMeaningful(
            fs.interruptAttempts.filter((a) => a.classification === "UNMATCHED_ATTEMPT")
              .length,
          );
          break;
        }
        case "utility.hostileObservability":
          valid += 1;
          if (fs.hostileObservability === "ABSENT") missing += 1;
          zero += countZeroMeaningful(fs.hostileBegincastCount);
          break;
        case "utility.ccActions":
          valid += 1;
          zero += countZeroMeaningful(fs.ccActions.length);
          break;
        case "utility.supportActions":
          valid += 1;
          zero += countZeroMeaningful(fs.supportActions.length);
          break;
        case "utility.dispelPurgeSuccessCount":
          valid += 1;
          zero += countZeroMeaningful(fs.dispelPurgeSuccessCount);
          break;
        case "utility.activeCombatMs":
          if (fs.activeCombatMs > 0) valid += 1;
          else {
            missing += 1;
            zero += 1;
          }
          break;
        case "utility.toolkit":
          valid += 1;
          break;
        case "utility.catalogCoverage.abilityCatalogCoverage":
          valid += 1;
          zero += countZeroMeaningful(fs.catalogCoverage.abilityCatalogCoverage);
          break;
        case "utility.catalogCoverage.mechanicCatalogCoverage":
          valid += 1;
          zero += countZeroMeaningful(fs.catalogCoverage.mechanicCatalogCoverage);
          break;
        default:
          missing += 1;
      }
    }

    const consumption = resolveConsumption(feature, byPath, n);
    if (consumption.integrityFailure) {
      integrityFailures.push(consumption.integrityFailure);
    }

    featureUsage.push(
      baseEntry(feature, {
        selectedSlotCountContaining: containing,
        validValueCount: valid,
        missingCount: n === 0 ? 1 : missing,
        zeroCount: zero,
        consumed: consumption.consumed,
        outputComponentOrConfidenceField: consumption.outputField,
        exclusionReason: consumption.exclusionReason,
      }),
    );
  }

  return { featureUsage, integrityFailures };
}

export function buildPerformanceFeatureUsage(
  runParseFacts: PerformanceRunParseFactV2[],
  options?: {
    hasProfileAggregate?: boolean;
    unavailableProvenance?: string[];
    consumptionTraces?: readonly FeatureConsumptionTrace[];
  },
): FeatureUsageBuildResult {
  const n = runParseFacts.length;
  const provenance = options?.unavailableProvenance ?? [];
  const byPath = indexTracesByFeature(options?.consumptionTraces ?? []);
  const integrityFailures: string[] = [];
  const featureUsage: FeatureUsageEntry[] = [];

  for (const feature of PERFORMANCE_FEATURE_REGISTRY) {
    let containing = 0;
    let valid = 0;
    let missing = 0;
    let zero = 0;

    if (feature.featurePath === "performance.profileAggregate") {
      if (options?.hasProfileAggregate) {
        containing = 1;
        valid = 1;
      } else missing = 1;
    } else if (feature.featurePath === "performance.unavailableProvenance") {
      containing = provenance.length > 0 || n > 0 ? 1 : 0;
      if (provenance.length > 0) valid = 1;
      else missing = 1;
    } else {
      for (const f of runParseFacts) {
        containing += 1;
        switch (feature.featurePath) {
          case "performance.parsePercentile":
            if (f.semantic === "UNAVAILABLE" || f.parsePercentile == null) missing += 1;
            else {
              valid += 1;
              zero += countZeroMeaningful(f.parsePercentile);
            }
            break;
          case "performance.semantic":
            valid += 1;
            break;
          case "performance.keyLevel":
            if (Number.isFinite(f.keyLevel)) valid += 1;
            else missing += 1;
            break;
          case "performance.partition":
            if (f.partition == null) missing += 1;
            else valid += 1;
            break;
          default:
            missing += 1;
        }
      }
    }

    const consumption = resolveConsumption(
      feature,
      byPath,
      Math.max(n, options?.hasProfileAggregate ? 1 : 0, provenance.length > 0 ? 1 : 0),
    );
    if (consumption.integrityFailure) {
      integrityFailures.push(consumption.integrityFailure);
    }

    featureUsage.push(
      baseEntry(feature, {
        selectedSlotCountContaining: containing,
        validValueCount: valid,
        missingCount: missing,
        zeroCount: feature.featurePath === "performance.semantic" ? null : zero,
        consumed: consumption.consumed,
        outputComponentOrConfidenceField: consumption.outputField,
        exclusionReason: consumption.exclusionReason,
      }),
    );
  }

  return { featureUsage, integrityFailures };
}

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
