import type { MetricObservationDTO, SurvivalRawFacts } from "@mplus/contracts";
import {
  estimateAvailableDefensiveUses,
  hasAbilityCategory,
  loadSeedAbilityCatalog,
  type AbilityCatalog,
} from "@mplus/mechanics";
import {
  computeSurvivalDimension,
  resolveSurvivalMetricWeights,
  SURVIVAL_V3_FORMULA_VERSION,
  SURVIVAL_V3_METRIC_KEYS,
  type ComputeSurvivalResult,
  type SurvivalRunInput,
  type SurvivalSummaryDTO,
} from "@mplus/scoring";

export interface SurvivalRunBridgeInput {
  dungeonSlug: string;
  dungeonName?: string;
  canonicalRunId: string;
  keyLevel: number;
  durationMs: number | null;
  detailAvailable: boolean;
  survival: SurvivalRawFacts | null;
}

export interface BuildSurvivalObservationsInput {
  runs: SurvivalRunBridgeInput[];
  expectedDungeonCount: number;
  selectedRunCount?: number;
  selectedRunWclCoverage: number;
  classSlug?: string | null;
  specSlug?: string | null;
  hasResolvedSpecAndRole: boolean;
  logFreshness?: number;
  observedAt: string;
  abilityCatalog?: AbilityCatalog;
}

export interface BuildSurvivalObservationsResult {
  observations: MetricObservationDTO[];
  summary: SurvivalSummaryDTO;
  confidence: number;
  survivalScore: number | null;
  /** Patch onto active model metricWeights.SURVIVAL before calculateScore (Agent 27). */
  survivalMetricWeights: Array<{ metricKey: string; weight: number }>;
  computed: ComputeSurvivalResult;
}

function toSurvivalRunInput(
  run: SurvivalRunBridgeInput,
  catalog: AbilityCatalog,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): SurvivalRunInput | null {
  if (!run.survival) return null;
  return {
    dungeonSlug: run.dungeonSlug,
    dungeonName: run.dungeonName,
    canonicalRunId: run.canonicalRunId,
    keyLevel: run.keyLevel,
    durationMs: run.durationMs,
    detailAvailable: run.detailAvailable,
    survival: run.survival,
    availableDefensiveUses: estimateAvailableDefensiveUses({
      abilityCatalog: catalog,
      durationMs: run.durationMs,
      classSlug,
      specSlug,
    }),
    hasPersonalDefensiveCapability: hasAbilityCategory(
      catalog,
      "personal_defensive",
      classSlug,
      specSlug,
    ),
    hasSelfHealOrPotionCapability:
      hasAbilityCategory(catalog, "self_heal", classSlug, specSlug) ||
      hasAbilityCategory(catalog, "health_potion", classSlug, specSlug),
  };
}

/**
 * Build SURVIVAL v3 observations from eight selected-run raw facts.
 * Does not mutate global dimension weights — Agent 27 wires default@3.
 */
export function buildSurvivalObservations(
  input: BuildSurvivalObservationsInput,
): BuildSurvivalObservationsResult {
  const catalog = input.abilityCatalog ?? loadSeedAbilityCatalog();
  const runs: SurvivalRunInput[] = [];
  for (const run of input.runs) {
    const mapped = toSurvivalRunInput(run, catalog, input.classSlug, input.specSlug);
    if (mapped) runs.push(mapped);
  }

  const computed = computeSurvivalDimension({
    runs,
    expectedDungeonCount: input.expectedDungeonCount,
    selectedRunCount: input.selectedRunCount ?? input.runs.length,
    selectedRunWclCoverage: input.selectedRunWclCoverage,
    hasResolvedSpecAndRole: input.hasResolvedSpecAndRole,
    logFreshness: input.logFreshness,
  });

  const survivalMetricWeights = resolveSurvivalMetricWeights(computed.activeContributors);
  const coverage = {
    present: computed.summary.availableRunCount,
    expected: computed.summary.expectedDungeonCount,
    selectedRunCount: computed.summary.selectedRunCount,
    ratio:
      computed.summary.expectedDungeonCount > 0
        ? computed.summary.availableRunCount / computed.summary.expectedDungeonCount
        : 0,
  };

  const observations: MetricObservationDTO[] = [];
  const push = (
    metricKey: string,
    value: number | null,
    derivedFrom: string,
  ) => {
    if (value == null) return;
    observations.push({
      metricKey,
      dimension: "SURVIVAL",
      rawValue: value,
      normalizedValue: value,
      confidence: computed.confidence,
      observedAt: input.observedAt,
      sourceProvider: "warcraftlogs",
      coverage,
      context: {
        derivedFrom,
        formulaVersion: SURVIVAL_V3_FORMULA_VERSION,
        equalDungeonWeighting: true,
        abilityCatalogVersion: catalog.catalogVersion,
        activeContributors: computed.activeContributors,
        summaryScore: computed.survivalScore,
      },
    });
  };

  push(SURVIVAL_V3_METRIC_KEYS.deaths, computed.observations.deaths, "survival_v3_deaths");
  push(
    SURVIVAL_V3_METRIC_KEYS.avoidableDamage,
    computed.observations.avoidableDamage,
    "survival_v3_avoidable_damage",
  );
  push(
    SURVIVAL_V3_METRIC_KEYS.personalDefensives,
    computed.observations.personalDefensives,
    "survival_v3_personal_defensives",
  );
  push(
    SURVIVAL_V3_METRIC_KEYS.selfHealAndPotion,
    computed.observations.selfHealAndPotion,
    "survival_v3_self_heal_and_potion",
  );

  return {
    observations,
    summary: computed.summary,
    confidence: computed.confidence,
    survivalScore: computed.survivalScore,
    survivalMetricWeights,
    computed,
  };
}
