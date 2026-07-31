import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import { calculateScore } from "../calculate.js";
import { computeInputFingerprint } from "../fingerprint.js";
import type { ScoreModelConfigV1, ScoringContext } from "../types.js";
import { DIMENSION_WEIGHT_KEYS } from "../types.js";
import type { PerCharacterCalibrationResult, WeightAblationResult } from "./types.js";

const PUBLIC_WEIGHT_KEYS = [
  "performance",
  "survival",
  "utility",
  "experienceConsistency",
] as const;

type PublicWeightKey = (typeof PUBLIC_WEIGHT_KEYS)[number];

function deepCloneModel(model: ScoreModelConfigV1): ScoreModelConfigV1 {
  return structuredClone(model);
}

/**
 * Zero one public dimension weight and renormalize remaining public weights.
 * Does not mutate the original model. RAID / mythicRaid left unchanged.
 */
export function createAblatedModel(
  model: ScoreModelConfigV1,
  zeroWeightKey: PublicWeightKey,
): ScoreModelConfigV1 {
  const next = deepCloneModel(model);
  const weights = { ...next.weights, [zeroWeightKey]: 0 };
  let sum = 0;
  for (const key of PUBLIC_WEIGHT_KEYS) {
    sum += weights[key];
  }
  if (sum <= 0) {
    throw new Error(`Cannot renormalize weights after zeroing ${zeroWeightKey}`);
  }
  for (const key of PUBLIC_WEIGHT_KEYS) {
    weights[key] = weights[key] / sum;
  }
  next.weights = weights;
  return next;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export interface AblationReplayInput {
  characterId: string;
  seasonSlug: string;
  observations: MetricObservationDTO[];
  context: ScoringContext;
  calculatedAt: string;
  baselineScore: number;
  baselineGrade: string | null;
}

/**
 * True engine weight ablation: evaluate through calculateScore with ablated config.
 */
export function computeEngineWeightAblation(input: {
  model: ScoreModelConfigV1;
  members: AblationReplayInput[];
}): WeightAblationResult[] {
  const results: WeightAblationResult[] = [];
  const originalJson = JSON.stringify(input.model);

  for (const weightKey of PUBLIC_WEIGHT_KEYS) {
    const ablatedModel = createAblatedModel(input.model, weightKey);
    const deltas: number[] = [];
    let gradeChanges = 0;

    for (const member of input.members) {
      const fingerprint = computeInputFingerprint({
        characterId: member.characterId,
        seasonSlug: member.seasonSlug,
        model: ablatedModel,
        scopeType: "CHARACTER",
        scopeKey: null,
        observations: member.observations,
        context: member.context,
      });
      const snapshot: ScoreSnapshotDTO = calculateScore({
        characterId: member.characterId,
        seasonSlug: member.seasonSlug,
        model: ablatedModel,
        scopeType: "CHARACTER",
        scopeKey: null,
        observations: member.observations,
        calculatedAt: member.calculatedAt,
        inputFingerprint: fingerprint,
        context: member.context,
      });
      deltas.push(snapshot.overallScore - member.baselineScore);
      if (
        member.baselineGrade &&
        snapshot.grade !== member.baselineGrade
      ) {
        gradeChanges += 1;
      }
    }

    if (deltas.length === 0) continue;
    const meanScoreDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    results.push({
      weightKey,
      delta: -1,
      meanScoreDelta,
      medianScoreDelta: median(deltas),
      gradeChangeCount: gradeChanges,
      sampleSize: deltas.length,
      exploratory: true,
      method: "engine-zero-renormalize",
    });
  }

  if (JSON.stringify(input.model) !== originalJson) {
    throw new Error("Ablation mutated the original model config");
  }

  return results;
}

/** Map dimension name → public weight key for reporting. */
export function dimensionToWeightKey(dimension: string): PublicWeightKey | null {
  const key =
    DIMENSION_WEIGHT_KEYS[dimension as keyof typeof DIMENSION_WEIGHT_KEYS];
  if (!key) return null;
  if ((PUBLIC_WEIGHT_KEYS as readonly string[]).includes(key)) {
    return key as PublicWeightKey;
  }
  return null;
}

/**
 * Build ablation replay inputs from character rows that have stored replay payloads.
 * Callers attach observations/context via a side map when available.
 */
export function filterScoredRowsForAblation(
  rows: PerCharacterCalibrationResult[],
): PerCharacterCalibrationResult[] {
  return rows.filter(
    (r) =>
      r.overallScore != null &&
      !r.error &&
      !r.validationFailure &&
      r.evaluationKind === "replay",
  );
}
