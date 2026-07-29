import { clamp01 } from "../math.js";
import type {
  ComputeSurvivalInput,
  ComputeSurvivalResult,
  SurvivalDungeonAggregate,
  SurvivalDungeonSummary,
  SurvivalExplanatoryRun,
  SurvivalSummaryDTO,
} from "./types.js";
import {
  SURVIVAL_DEFENSIVE_RESPONSE_WEIGHT,
  SURVIVAL_EMERGENCY_RECOVERY_WEIGHT,
  SURVIVAL_OUTCOME_WEIGHT,
} from "./types.js";

export {
  SURVIVAL_DEFENSIVE_RESPONSE_WEIGHT,
  SURVIVAL_EMERGENCY_RECOVERY_WEIGHT,
  SURVIVAL_OUTCOME_WEIGHT,
} from "./types.js";

function median(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function meanOfValid(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

function weightedMeanOfAvailable(
  values: Array<{ value: number | null; weight: number }>,
): number | null {
  const available = values.filter(
    (entry): entry is { value: number; weight: number } =>
      typeof entry.value === "number" && Number.isFinite(entry.value),
  );
  if (available.length === 0) return null;
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  return available.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

/**
 * Model metric weights for SURVIVAL (outcome / defensive / recovery).
 * Always 0.55 / 0.30 / 0.15 — callers renormalize when components are N/A upstream.
 */
export function resolveSurvivalMetricWeights(): Array<{
  metricKey: string;
  weight: number;
}> {
  return [
    { metricKey: "survival.outcome", weight: SURVIVAL_OUTCOME_WEIGHT },
    {
      metricKey: "survival.defensive_response",
      weight: SURVIVAL_DEFENSIVE_RESPONSE_WEIGHT,
    },
    {
      metricKey: "survival.emergency_recovery",
      weight: SURVIVAL_EMERGENCY_RECOVERY_WEIGHT,
    },
  ];
}

export function computeSurvivalConfidence(input: {
  dungeonCount: number;
  expectedDungeonCount: number;
  totalRuns: number;
  selectedRunWclCoverage: number;
  logFreshness: number;
  scoreMode: SurvivalSummaryDTO["scoreMode"];
}): number {
  if (input.dungeonCount === 0) return 0;
  const expected = Math.max(1, input.expectedDungeonCount);
  const coverage = clamp01(input.dungeonCount / expected);
  const breadth =
    input.dungeonCount <= 1
      ? 0.3
      : input.dungeonCount <= 2
        ? 0.5
        : input.dungeonCount <= 4
          ? 0.75
          : clamp01(0.75 + 0.25 * ((input.dungeonCount - 4) / Math.max(1, expected - 4)));
  const volume =
    input.totalRuns <= 1
      ? 0.25
      : input.totalRuns <= 3
        ? 0.45
        : input.totalRuns <= 8
          ? 0.7
          : clamp01(0.7 + 0.3 * Math.min(1, (input.totalRuns - 8) / 16));
  const modeFactor =
    input.scoreMode === "FULL_BEHAVIORAL"
      ? 1
      : input.scoreMode === "PARTIAL_BEHAVIORAL"
        ? 0.75
        : 0.45;
  const base =
    0.35 * coverage +
    0.25 * breadth +
    0.2 * volume +
    0.1 * clamp01(input.selectedRunWclCoverage) +
    0.1 * clamp01(input.logFreshness);
  return clamp01(base * modeFactor);
}

function pickBestRun(
  runs: SurvivalExplanatoryRun[],
  dungeonSlug: string,
): SurvivalExplanatoryRun | null {
  const forDungeon = runs.filter((r) => r.dungeonSlug === dungeonSlug);
  if (forDungeon.length === 0) return null;
  return [...forDungeon].sort((a, b) => {
    const scoreA = a.behavioralSurvivalScore ?? Number.NEGATIVE_INFINITY;
    const scoreB = b.behavioralSurvivalScore ?? Number.NEGATIVE_INFINITY;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (b.keyLevel ?? 0) - (a.keyLevel ?? 0);
  })[0]!;
}

/**
 * Equal-weight mean of per-dungeon medians of run behavioral survival scores.
 * Missing dungeons are omitted (never zero-filled).
 */
export function computeSurvivalDimension(input: ComputeSurvivalInput): ComputeSurvivalResult {
  const withBehavioral = input.dungeons.filter(
    (d) => d.medianBehavioralScore != null && Number.isFinite(d.medianBehavioralScore),
  );
  const calculatedComponentMedians = {
    outcome: meanOfValid(
      input.dungeons.map(
        (d) => d.medianOutcomeScore ?? d.medianOutcomeOnlyScore ?? d.medianBehavioralScore,
      ),
    ),
    defensiveResponse: meanOfValid(input.dungeons.map((d) => d.medianDefensiveResponseScore)),
    emergencyRecovery: meanOfValid(input.dungeons.map((d) => d.medianEmergencyRecoveryScore)),
  };
  const componentMedians = input.componentMedians ?? calculatedComponentMedians;
  const componentScore = weightedMeanOfAvailable([
    { value: componentMedians.outcome, weight: SURVIVAL_OUTCOME_WEIGHT },
    {
      value: componentMedians.defensiveResponse,
      weight: SURVIVAL_DEFENSIVE_RESPONSE_WEIGHT,
    },
    {
      value: componentMedians.emergencyRecovery,
      weight: SURVIVAL_EMERGENCY_RECOVERY_WEIGHT,
    },
  ]);
  const behavioralScore = meanOfValid(withBehavioral.map((d) => d.medianBehavioralScore));
  const survivalScore = componentScore ?? behavioralScore;

  const totalRuns = input.dungeons.reduce((s, d) => s + Math.max(0, d.runCount), 0);
  const confidence = computeSurvivalConfidence({
    dungeonCount: withBehavioral.length,
    expectedDungeonCount: input.expectedDungeonCount,
    totalRuns,
    selectedRunWclCoverage: input.selectedRunWclCoverage ?? 0,
    logFreshness: input.logFreshness ?? (withBehavioral.length > 0 ? 0.75 : 0),
    scoreMode: input.scoreMode ?? null,
  });

  const explanatory = input.explanatoryRuns ?? [];
  const dungeonSummaries: SurvivalDungeonSummary[] = withBehavioral.map((d) => ({
    dungeonSlug: d.dungeonSlug,
    dungeonName: d.dungeonName,
    medianBehavioralScore: d.medianBehavioralScore,
    runCount: d.runCount,
    bestRun: pickBestRun(explanatory, d.dungeonSlug),
  }));

  const notes: string[] = ["Survival is not a percentile; raw damage volume does not score."];
  if (input.scoreMode === "OUTCOME_ONLY") {
    notes.push("Health-state coverage too low; outcome-only signal is primary.");
  } else if (input.scoreMode === "PARTIAL_BEHAVIORAL") {
    notes.push("Behavioral score is partial — health-state coverage below full threshold.");
  }

  const summary: SurvivalSummaryDTO = {
    score: survivalScore,
    confidence,
    availableDungeonCount: withBehavioral.length,
    expectedDungeonCount: input.expectedDungeonCount,
    scoreMode: input.scoreMode ?? null,
    analyzedRunCount: input.analyzedRunCount,
    cachedRunCount: input.cachedRunCount,
    newlyFetchedRunCount: input.newlyFetchedRunCount,
    components: componentMedians,
    pressureClusterCount: input.pressureClusterCount,
    deathCount: input.deathCount,
    defensiveCounts: input.defensiveCounts,
    recoveryCounts: input.recoveryCounts,
    maxHpDiagnostics: input.maxHpDiagnostics,
    dungeons: dungeonSummaries,
    notes,
    requestCost: input.requestCost,
    diagnostics: input.diagnostics,
  };

  // Observations use identity normalization (0–100 already). Component medians
  // populate their matching model metrics when supplied by the V1.1.1 pipeline.
  const observations = {
    "survival.outcome": componentMedians.outcome,
    "survival.defensive_response": componentMedians.defensiveResponse,
    "survival.emergency_recovery": componentMedians.emergencyRecovery,
  };

  return {
    summary,
    survivalScore,
    confidence,
    observations,
    componentMedians,
  };
}

/** Helper: median of run behavioral scores for one dungeon bucket. */
export function medianSurvivalRunScores(scores: number[]): number | null {
  return median(scores);
}

export type { SurvivalDungeonAggregate };
