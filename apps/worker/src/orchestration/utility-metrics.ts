import type { MetricObservationDTO, UtilityRawFacts } from "@mplus/contracts";
import {
  loadSeedAbilityCatalog,
  resolveUtilityCapability,
  type AbilityCatalog,
} from "@mplus/mechanics";
import {
  computeUtilityDimension,
  resolveUtilityMetricWeights,
  utilityDimensionToMetricObservations,
  UTILITY_V3_FORMULA_VERSION,
  type ComputeUtilityResult,
  type UtilityRunFactsInput,
  type UtilitySummaryDTO,
} from "@mplus/scoring";

export interface UtilityRunBridgeInput {
  dungeonSlug: string;
  dungeonName?: string;
  canonicalRunId: string;
  keyLevel: number;
  durationMs: number | null;
  detailAvailable: boolean;
  wclCoverageRatio?: number | null;
  utility: UtilityRawFacts | null;
}

export interface BuildUtilityObservationsInput {
  runs: UtilityRunBridgeInput[];
  expectedDungeonCount: number;
  selectedRunWclCoverage: number;
  classSlug?: string | null;
  specSlug?: string | null;
  hasResolvedSpecAndRole: boolean;
  logFreshness?: number;
  observedAt: string;
  abilityCatalog?: AbilityCatalog;
}

export interface BuildUtilityObservationsResult {
  observations: MetricObservationDTO[];
  summary: UtilitySummaryDTO;
  confidence: number;
  utilityScore: number | null;
  /** Patch onto active model metricWeights.UTILITY before calculateScore (default@3). */
  utilityMetricWeights: Array<{ metricKey: string; weight: number }>;
  computed: ComputeUtilityResult;
}

function toUtilityRunInput(run: UtilityRunBridgeInput): UtilityRunFactsInput | null {
  if (!run.utility) return null;
  const u = run.utility;
  return {
    dungeonSlug: run.dungeonSlug,
    dungeonName: run.dungeonName,
    canonicalRunId: run.canonicalRunId,
    keyLevel: run.keyLevel,
    durationMs: run.durationMs,
    detailAvailable: run.detailAvailable,
    kickCasts: u.kickCasts,
    successfulInterrupts: u.successfulInterrupts,
    effectiveKickCooldownMs: u.effectiveKickCooldownMs,
    distinctCcTargets: u.distinctCcTargets,
    groupSupportCasts: u.groupSupportCasts,
    defensiveDispels: u.defensiveDispels,
    offensiveDispels: u.offensiveDispels,
    wclCoverageRatio: run.wclCoverageRatio ?? null,
  };
}

/**
 * Build UTILITY v3 observations from eight selected-run raw facts.
 * Capability-aware metric weights are patched at score time for default@3.
 */
export function buildUtilityObservations(
  input: BuildUtilityObservationsInput,
): BuildUtilityObservationsResult {
  const catalog = input.abilityCatalog ?? loadSeedAbilityCatalog();
  const capability = resolveUtilityCapability({
    abilityCatalog: catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });

  const runs: UtilityRunFactsInput[] = [];
  for (const run of input.runs) {
    const mapped = toUtilityRunInput(run);
    if (mapped) runs.push(mapped);
  }

  const computed = computeUtilityDimension({
    runs,
    expectedDungeonCount: input.expectedDungeonCount,
    capability,
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    logFreshness: input.logFreshness,
    abilityCatalogVersion: catalog.catalogVersion,
    observedAt: input.observedAt,
  });

  const utilityMetricWeights = resolveUtilityMetricWeights(capability);
  const observations = utilityDimensionToMetricObservations({
    result: computed,
    observedAt: input.observedAt,
    sourceProvider: "warcraftlogs",
    abilityCatalogVersion: catalog.catalogVersion,
  }).map((obs) => ({
    ...obs,
    context: {
      ...(typeof obs.context === "object" && obs.context ? obs.context : {}),
      formulaVersion: UTILITY_V3_FORMULA_VERSION,
      capability,
    },
  }));

  return {
    observations,
    summary: computed.summary,
    confidence: computed.confidence,
    utilityScore: computed.utilityScore,
    utilityMetricWeights,
    computed,
  };
}
