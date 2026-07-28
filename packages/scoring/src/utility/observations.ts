import type { MetricObservationDTO } from "@mplus/contracts";
import type { ComputeUtilityResult } from "./types.js";
import { UTILITY_V3_FORMULA_VERSION, UTILITY_V3_METRIC_KEYS } from "./aggregate.js";

/**
 * Persistable UTILITY v3 metric observations (normalized 0–100).
 * Intended for Agent 27 model composition — does not alter default@2 weights.
 */
export function utilityDimensionToMetricObservations(input: {
  result: ComputeUtilityResult;
  observedAt: string;
  sourceProvider?: MetricObservationDTO["sourceProvider"];
  abilityCatalogVersion?: string | null;
}): MetricObservationDTO[] {
  const { result } = input;
  const context = {
    formulaVersion: UTILITY_V3_FORMULA_VERSION,
    abilityCatalogVersion: input.abilityCatalogVersion ?? null,
    droppedContributors: result.summary.droppedContributors,
    appliedWeights: result.summary.appliedWeights,
    dungeonCount: result.summary.dungeonCount,
    expectedDungeonCount: result.summary.expectedDungeonCount,
    runs: result.summary.runs.map((r) => ({
      dungeonSlug: r.dungeonSlug,
      canonicalRunId: r.canonicalRunId,
      keyLevel: r.keyLevel,
      detailAvailable: r.detailAvailable,
      runUtilityScore: r.runUtilityScore,
      confidence: r.confidence,
      missingContributors: r.missingContributors,
      contributors: r.contributors.map((c) => ({
        key: c.key,
        weight: c.weight,
        score: c.score,
        available: c.available,
        evidence: c.evidence,
      })),
      catalogCoverage: r.catalogCoverage,
    })),
  };

  const rows: Array<{
    metricKey: string;
    rawValue: number | null;
  }> = [
    { metricKey: UTILITY_V3_METRIC_KEYS.interrupts, rawValue: result.observations.interrupts },
    {
      metricKey: UTILITY_V3_METRIC_KEYS.crowdControl,
      rawValue: result.observations.crowdControl,
    },
    {
      metricKey: UTILITY_V3_METRIC_KEYS.groupSupport,
      rawValue: result.observations.groupSupport,
    },
    { metricKey: UTILITY_V3_METRIC_KEYS.dispels, rawValue: result.observations.dispels },
  ];

  return rows.map((row) => ({
    metricKey: row.metricKey,
    dimension: "UTILITY" as const,
    rawValue: row.rawValue,
    normalizedValue: row.rawValue,
    confidence: row.rawValue == null ? 0 : result.confidence,
    observedAt: input.observedAt,
    sourceProvider: input.sourceProvider ?? "derived",
    coverage: {
      present: result.summary.dungeonCount,
      expected: result.summary.expectedDungeonCount,
      ratio:
        result.summary.expectedDungeonCount > 0
          ? result.summary.dungeonCount / result.summary.expectedDungeonCount
          : 0,
    },
    context,
  }));
}
