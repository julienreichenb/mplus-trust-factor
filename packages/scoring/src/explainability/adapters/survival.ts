import type {
  DimensionExplainabilityV1,
  ScoreDriverV1,
} from "@mplus/contracts";
import type {
  SurvivalV2ComputeResult,
  SurvivalV2DungeonAggregate,
  SurvivalV2RunScore,
} from "../../survival/v2/types.js";
import {
  buildConfidenceComponents,
  buildConfidenceReasonsFromCauses,
  buildScoreDriver,
  directionFromSignedContribution,
  sortDrivers,
} from "../helpers.js";
import { SCORE_EXPLAINABILITY_NEUTRAL_POINT } from "../label-registry.js";

type SurvivalComponentKey =
  | "outcome"
  | "defensive"
  | "recovery"
  | "relativeDamage";

const COMPONENT_DRIVER_CODES: Record<SurvivalComponentKey, string> = {
  outcome: "survival.outcome",
  defensive: "survival.defensive_response",
  recovery: "survival.emergency_recovery",
  relativeDamage: "survival.relative_avoidable_damage",
};

interface ComponentLineage {
  contribution: number;
  weight: number;
}

/**
 * Replay one run's already-applied arithmetic:
 *   signedContribution = weightsApplied[c] * (componentScore - 50)
 * Missing / weight-0 components contribute 0.
 */
function runComponentLineage(
  run: SurvivalV2RunScore,
  key: SurvivalComponentKey,
): ComponentLineage | null {
  const weight = run.weightsApplied[key];
  if (!(weight > 0)) {
    return { contribution: 0, weight: 0 };
  }

  const score =
    key === "outcome"
      ? run.outcome.score
      : key === "defensive"
        ? run.defensive.score
        : key === "recovery"
          ? run.recovery.score
          : run.relativeDamageShadow.score;

  if (score == null || !Number.isFinite(score)) {
    // Applied weight without a scored component — cannot invent a contribution.
    return null;
  }

  return {
    contribution: weight * (score - SCORE_EXPLAINABILITY_NEUTRAL_POINT),
    weight,
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Aggregate component contributions using the same dungeon → season semantics
 * as Survival scoring: per-dungeon mean of ≤2 valid runs (median≡mean), then
 * equal-weight across represented dungeons.
 *
 * Returns null when reconstruction is impossible for the result shape.
 */
export function reconstructSurvivalComponentContributions(
  dungeons: readonly SurvivalV2DungeonAggregate[],
): Record<SurvivalComponentKey, ComponentLineage> | null {
  const keys: SurvivalComponentKey[] = [
    "outcome",
    "defensive",
    "recovery",
    "relativeDamage",
  ];

  const dungeonMeans: Record<SurvivalComponentKey, number[]> = {
    outcome: [],
    defensive: [],
    recovery: [],
    relativeDamage: [],
  };
  const dungeonWeights: Record<SurvivalComponentKey, number[]> = {
    outcome: [],
    defensive: [],
    recovery: [],
    relativeDamage: [],
  };

  let representedDungeons = 0;

  for (const dungeon of dungeons) {
    const validRuns = dungeon.runs.filter(
      (run) =>
        run.valid &&
        run.behavioralScore != null &&
        Number.isFinite(run.behavioralScore),
    );
    if (validRuns.length === 0) continue;

    // Current evidence contract: at most 2 selected runs/dungeon. Median≡mean
    // only for 1–2 runs; refuse to invent contributions for larger shapes.
    if (validRuns.length > 2) {
      return null;
    }

    for (const key of keys) {
      const runContribs: number[] = [];
      const runWeights: number[] = [];
      for (const run of validRuns) {
        const lineage = runComponentLineage(run, key);
        if (lineage == null) return null;
        runContribs.push(lineage.contribution);
        runWeights.push(lineage.weight);
      }
      dungeonMeans[key].push(mean(runContribs)!);
      dungeonWeights[key].push(mean(runWeights)!);
    }
    representedDungeons += 1;
  }

  if (representedDungeons === 0) {
    return null;
  }

  const out = {} as Record<SurvivalComponentKey, ComponentLineage>;
  for (const key of keys) {
    out[key] = {
      contribution: mean(dungeonMeans[key])!,
      weight: mean(dungeonWeights[key])!,
    };
  }
  return out;
}

export function adaptSurvivalExplainability(
  result: SurvivalV2ComputeResult | null | undefined,
): DimensionExplainabilityV1 {
  if (result == null) {
    return {
      dimension: "SURVIVAL",
      score: null,
      availability: "UNAVAILABLE",
      scoreStory: { drivers: [] },
      confidenceStory: {
        value: null,
        band: null,
        reasons: buildConfidenceReasonsFromCauses(["no_survival_evidence"], {
          confidenceValue: 0,
        }),
        components: [],
      },
    };
  }

  const drivers: ScoreDriverV1[] = [];
  const lineage =
    result.score != null && Number.isFinite(result.score)
      ? reconstructSurvivalComponentContributions(result.dungeons)
      : null;

  const seasonValues: Record<SurvivalComponentKey, number | null> = {
    outcome: result.components.outcome,
    defensive: result.components.defensive,
    recovery: result.components.recovery,
    relativeDamage: result.components.relativeDamage,
  };

  if (lineage != null) {
    const keys: SurvivalComponentKey[] = [
      "outcome",
      "defensive",
      "recovery",
      "relativeDamage",
    ];
    for (const key of keys) {
      const { contribution, weight } = lineage[key];
      // Relative damage only when actual applied weight mass is present.
      if (!(weight > 0) && Math.abs(contribution) < 1e-12) continue;
      if (!(weight > 0)) continue;

      drivers.push(
        buildScoreDriver({
          code: COMPONENT_DRIVER_CODES[key],
          direction: directionFromSignedContribution(contribution),
          value: seasonValues[key],
          weight,
          contribution,
          materiality: Math.abs(contribution),
          params: {
            aggregation: "run_weightsApplied_dungeon_mean_season_equal",
            relativeDamageMode: result.relativeDamageMode,
          },
          evidence: {
            representedDungeonCount: result.dungeons.filter((d) =>
              d.runs.some((r) => r.valid && r.behavioralScore != null),
            ).length,
          },
        }),
      );
    }
  }
  // If lineage is null (no runs / unsupported shape / no score): fail closed —
  // do not invent contributions from season component summaries + default weights.

  const breakdown = result.confidenceBreakdown;
  return {
    dimension: "SURVIVAL",
    score: result.score,
    availability: result.state,
    scoreStory: { drivers: sortDrivers(drivers) },
    confidenceStory: {
      value: breakdown.value,
      band: breakdown.band,
      reasons: buildConfidenceReasonsFromCauses(breakdown.causes, {
        confidenceValue: breakdown.value,
      }),
      components: buildConfidenceComponents(breakdown.components),
    },
  };
}
