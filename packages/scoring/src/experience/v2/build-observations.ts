import type { MetricObservationDTO } from "@mplus/contracts";
import {
  EXPERIENCE_V2_ANALYSIS_VERSION,
  EXPERIENCE_V2_MODEL_LABEL,
  EXPERIENCE_V2_SCHEMA_VERSION,
  type ExperienceHistoryProvenance,
} from "./constants.js";
import {
  computeExperienceV2,
  type ExperienceV2RunInput,
} from "./compute.js";

export interface ExperienceV2ObservationInput {
  observedAt: string;
  expectedDungeonCount: number;
  selectedRuns: ExperienceV2RunInput[];
  /** All current-season pool runs when available; defaults to selectedRuns. */
  seasonRuns?: ExperienceV2RunInput[];
  priorSeasonCount?: number;
  provenance?: ExperienceHistoryProvenance;
  sourceProvider?: string;
}

/**
 * Build EXPERIENCE observations for model V5 / Experience V2.
 * Character-history only: durable run + season metadata, no WCL combat events, no alts.
 */
export function buildExperienceV2Observations(
  input: ExperienceV2ObservationInput,
): MetricObservationDTO[] {
  const provenance =
    input.provenance ??
    (input.selectedRuns.length > 0 || (input.priorSeasonCount ?? 0) > 0
      ? "HAS_HISTORY"
      : "CONFIRMED_ABSENCE");

  const result = computeExperienceV2({
    expectedDungeonCount: input.expectedDungeonCount,
    selectedRuns: input.selectedRuns,
    seasonRuns: input.seasonRuns ?? input.selectedRuns,
    priorSeasonCount: input.priorSeasonCount ?? 0,
    observedAt: input.observedAt,
    provenance,
  });

  const sourceProvider = input.sourceProvider ?? "character_history";
  const observedAt = input.observedAt;

  return result.components.map((component) => ({
    metricKey: component.metricKey,
    dimension: "EXPERIENCE" as const,
    rawValue: component.rawValue,
    normalizedValue: component.normalizedValue,
    confidence: component.confidence,
    observedAt,
    sourceProvider,
    coverage: component.coverage,
    context: {
      historyMode: "CHARACTER_HISTORY",
      experienceModel: EXPERIENCE_V2_MODEL_LABEL,
      schemaVersion: EXPERIENCE_V2_SCHEMA_VERSION,
      analysisVersion: EXPERIENCE_V2_ANALYSIS_VERSION,
      provenance: result.provenance,
      noAltInference: true,
      independentOfWclDetails: true,
      verifiedAccountHistory: false,
      scoreFiftyMeaning:
        "Moderate current-season coverage: ~half dungeon pool across ~2 key bands with recent activity or prior-season history",
      ...component.detail,
    },
  }));
}

/**
 * Resolve provenance from provider soft-skip flags and whether any history was observed.
 */
export function resolveExperienceProvenance(input: {
  blizzardOk: boolean;
  raiderIoOk: boolean;
  hasAnyHistorySignal: boolean;
}): ExperienceHistoryProvenance {
  if (!input.blizzardOk && !input.raiderIoOk) {
    return "PROVIDER_FAILURE";
  }
  if (input.hasAnyHistorySignal) {
    return input.blizzardOk && input.raiderIoOk ? "HAS_HISTORY" : "PARTIAL_SOURCES";
  }
  if (input.blizzardOk || input.raiderIoOk) {
    return "CONFIRMED_ABSENCE";
  }
  return "PROVIDER_FAILURE";
}
