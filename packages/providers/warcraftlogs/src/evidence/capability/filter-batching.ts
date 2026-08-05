/**
 * Deterministic WCL filterExpression builders + ability/actor batching.
 *
 * Live-verified on 1WKcCz2BnAQmbhfq:1:
 * - ability.id / ability.id IN (...) works for Buffs and Casts.
 * - Combining ability.id with source.id/target.id in one expression returns empty.
 * - DamageTaken multi-actor filterExpression (source.id/target.id) returns empty;
 *   GraphQL sourceID (single victim) works — use deterministic actor batches.
 */
import { hashSortedInts } from "@mplus/contracts";
import {
  FILTER_ABILITY_ID_BATCH_SIZE,
  FILTER_EXPRESSION_MAX_CHARS,
} from "./wcl-report-events-contract.js";

export function formatIdInList(ids: readonly number[]): string {
  return [...new Set(ids.filter((n) => Number.isFinite(n)))]
    .sort((a, b) => a - b)
    .join(", ");
}

export function buildAbilityIdInExpression(abilityIds: readonly number[]): string {
  const list = formatIdInList(abilityIds);
  if (!list) {
    throw new Error("ability_filter_requires_at_least_one_id");
  }
  return `ability.id IN (${list})`;
}

export function buildActorIdInExpression(
  field: "source.id" | "target.id",
  actorIds: readonly number[],
): string {
  const list = formatIdInList(actorIds);
  if (!list) {
    throw new Error("actor_filter_requires_at_least_one_id");
  }
  return `${field} IN (${list})`;
}

/** Friendly involvement expression (documented; not used for Buffs after live verify). */
export function buildFriendlyActorInvolvementExpression(
  actorIds: readonly number[],
): string {
  const source = buildActorIdInExpression("source.id", actorIds);
  const target = buildActorIdInExpression("target.id", actorIds);
  return `(${source} OR ${target})`;
}

/**
 * Preferred Buffs/Casts/Debuffs filter: ability IDs only.
 * Actor scoping is applied client-side after fetch (verified: AND with source/target
 * empties the Buff stream).
 */
export function buildRelevantBuffsFilterExpression(input: {
  abilityIds: readonly number[];
  actorIds?: readonly number[];
}): string {
  void input.actorIds;
  return buildAbilityIdInExpression(input.abilityIds);
}

export interface FilterBatch {
  batchIndex: number;
  batchCount: number;
  abilityIds: number[];
  /** GraphQL sourceID when filterExpression cannot express multi-actor scope. */
  sourceID: number | null;
  filterExpression: string | null;
  filterIdentity: string;
}

function splitIdsToFit(
  ids: readonly number[],
  maxBatchSize: number,
  buildExpression: (batch: number[]) => string,
  maxChars: number,
): number[][] {
  const sorted = [...new Set(ids.filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0) return [];

  const batches: number[][] = [];
  let current: number[] = [];

  const flush = () => {
    if (current.length > 0) {
      batches.push(current);
      current = [];
    }
  };

  for (const id of sorted) {
    const candidate = [...current, id];
    const expression = buildExpression(candidate);
    if (
      current.length > 0 &&
      (candidate.length > maxBatchSize || expression.length > maxChars)
    ) {
      flush();
      current = [id];
      const single = buildExpression(current);
      if (single.length > maxChars) {
        throw new Error(
          `filter_expression_single_id_exceeds_max_chars:${id}:${single.length}`,
        );
      }
    } else {
      current = candidate;
    }
  }
  flush();
  return batches;
}

/**
 * Preferred order:
 * 1. one run-level ability filter;
 * 2. deterministic ability-ID batches when size limits require them;
 * 3. deterministic actor sourceID groups when filterExpression cannot express scope.
 */
export function buildDeterministicAbilityFilterBatches(input: {
  abilityIds: readonly number[];
  actorIds?: readonly number[];
  maxAbilityBatchSize?: number;
  maxExpressionChars?: number;
}): FilterBatch[] {
  void input.actorIds;
  const maxBatchSize = input.maxAbilityBatchSize ?? FILTER_ABILITY_ID_BATCH_SIZE;
  const maxChars = input.maxExpressionChars ?? FILTER_EXPRESSION_MAX_CHARS;

  const batches = splitIdsToFit(
    input.abilityIds,
    maxBatchSize,
    (abilityBatch) => buildAbilityIdInExpression(abilityBatch),
    maxChars,
  );

  if (batches.length === 0) {
    throw new Error("ability_filter_batches_require_ids");
  }

  const batchCount = batches.length;
  return batches.map((abilityIds, batchIndex) => {
    const filterExpression = buildAbilityIdInExpression(abilityIds);
    return {
      batchIndex,
      batchCount,
      abilityIds,
      sourceID: null,
      filterExpression,
      filterIdentity: `abilities:${hashSortedInts(abilityIds)}|b${batchIndex}/${batchCount}`,
    };
  });
}

/**
 * DamageTaken / Deaths: one GraphQL sourceID per friendly player (shared job, N≤5).
 * Verified limitation: filterExpression actor IN lists return empty on DamageTaken.
 */
export function buildDeterministicSourceIdActorBatches(input: {
  actorIds: readonly number[];
}): FilterBatch[] {
  const sorted = [...new Set(input.actorIds.filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0) {
    throw new Error("actor_sourceid_batches_require_ids");
  }
  const batchCount = sorted.length;
  return sorted.map((actorId, batchIndex) => ({
    batchIndex,
    batchCount,
    abilityIds: [],
    sourceID: actorId,
    filterExpression: null,
    filterIdentity: `sourceID:${actorId}|b${batchIndex}/${batchCount}`,
  }));
}

export function abilityFilterHashFromIds(abilityIds: readonly number[]): string {
  if (abilityIds.length === 0) return "none";
  return hashSortedInts(abilityIds);
}

export function actorSetHashFromIds(actorIds: readonly number[]): string {
  return hashSortedInts(actorIds);
}
