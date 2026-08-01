/**
 * Cost planning for WCL evidence acquisition — pure estimates.
 * Unknown is distinct from zero. Does not enable admission behavior.
 *
 * Does not build EvidenceAcquisitionPlanV2 (WS02 selection policy).
 */

import type {
  EvidenceCostEstimate,
  EvidenceDatasetKind,
} from "@mplus/contracts";
import { sumEvidenceCostEstimates } from "@mplus/contracts";
import type { WclRateBudgetDecision, WclRateLimitSnapshot } from "../types.js";
import { evaluateRateBudget, type RateBudgetConfig } from "../rate/rate-budget.js";
import type { EvidenceDatasetPlanEntry, WclDatasetCostPlanV2 } from "./planner-types.js";

/** Conservative point estimates per logical operation (cache miss). */
export const DATASET_BASE_COST_POINTS: Record<EvidenceDatasetKind, number | null> = {
  RANKING_PARSE: 1,
  MASTER_DATA: 1,
  CASTS: 1,
  HOSTILE_CASTS: 1,
  INTERRUPTS: 1,
  DEATHS: 1,
  DAMAGE_TAKEN: 1,
  BUFFS: 1,
  DEBUFFS: 1,
  DISPELS: 1,
  HEALING: 1,
  COMBATANT_INFO: 1,
  DAMAGE_DONE: 1,
};

export const DEFAULT_EVENT_PAGES = 3;
export const DEFAULT_TABLE_PAGES = 1;
export const DEFAULT_SAFETY_MARGIN_POINTS = 5;

const EVENT_LIKE: ReadonlySet<EvidenceDatasetKind> = new Set([
  "CASTS",
  "HOSTILE_CASTS",
  "INTERRUPTS",
  "DEATHS",
  "DAMAGE_TAKEN",
  "BUFFS",
  "DEBUFFS",
  "DISPELS",
  "HEALING",
  "COMBATANT_INFO",
  "DAMAGE_DONE",
]);

export function isEventLikeDataset(dataset: EvidenceDatasetKind): boolean {
  return EVENT_LIKE.has(dataset);
}

export function defaultPagesForDataset(dataset: EvidenceDatasetKind): number {
  return isEventLikeDataset(dataset) ? DEFAULT_EVENT_PAGES : DEFAULT_TABLE_PAGES;
}

/**
 * Estimate cost for one dataset fetch.
 * Returns UNKNOWN when the base cost table has no known value.
 */
export function estimateDatasetCost(
  dataset: EvidenceDatasetKind,
  estimatedPages?: number,
): EvidenceCostEstimate {
  const base = DATASET_BASE_COST_POINTS[dataset];
  if (base == null) return { kind: "UNKNOWN" };
  const pages = estimatedPages ?? defaultPagesForDataset(dataset);
  if (!Number.isFinite(pages) || pages < 0) return { kind: "UNKNOWN" };
  return { kind: "KNOWN", points: base * pages };
}

export function estimatePaginationCost(
  dataset: EvidenceDatasetKind,
  pageCount: number,
): EvidenceCostEstimate {
  if (!Number.isFinite(pageCount) || pageCount < 0) return { kind: "UNKNOWN" };
  return estimateDatasetCost(dataset, pageCount);
}

export interface CostPlanSummary {
  entries: EvidenceDatasetPlanEntry[];
  totalEstimatedCost: EvidenceCostEstimate;
  safetyMargin: EvidenceCostEstimate;
  cacheHitCount: number;
  unknownCostEntryCount: number;
  /** Total + safety margin; UNKNOWN if either component is UNKNOWN. */
  totalWithSafetyMargin: EvidenceCostEstimate;
}

export function summarizeCostPlan(
  entries: readonly EvidenceDatasetPlanEntry[],
  safetyMarginPoints: number = DEFAULT_SAFETY_MARGIN_POINTS,
): CostPlanSummary {
  const cacheHitCount = entries.filter((e) => e.estimatedCost.kind === "ZERO_CACHE_HIT").length;
  const unknownCostEntryCount = entries.filter((e) => e.estimatedCost.kind === "UNKNOWN").length;
  const totalEstimatedCost =
    entries.length === 0
      ? ({ kind: "KNOWN", points: 0 } satisfies EvidenceCostEstimate)
      : sumEvidenceCostEstimates(entries.map((e) => e.estimatedCost));
  const safetyMargin: EvidenceCostEstimate =
    totalEstimatedCost.kind === "ZERO_CACHE_HIT" && entries.length > 0
      ? { kind: "ZERO_CACHE_HIT" }
      : { kind: "KNOWN", points: safetyMarginPoints };

  const totalWithSafetyMargin = sumEvidenceCostEstimates([totalEstimatedCost, safetyMargin]);

  return {
    entries: [...entries],
    totalEstimatedCost,
    safetyMargin,
    cacheHitCount,
    unknownCostEntryCount,
    totalWithSafetyMargin,
  };
}

/**
 * Preview rate-budget action for a planned cost without mutating admission state.
 * Uses existing evaluateRateBudget thresholds; does not reserve or execute.
 */
export function previewRateBudgetForPlan(
  snapshot: WclRateLimitSnapshot,
  planCost: EvidenceCostEstimate,
  config: RateBudgetConfig,
  safetyMargin: EvidenceCostEstimate = { kind: "KNOWN", points: DEFAULT_SAFETY_MARGIN_POINTS },
): {
  decision: WclRateBudgetDecision;
  requiredPoints: EvidenceCostEstimate;
  remainingAfterPlan: number | null;
  note: string;
} {
  const decision = evaluateRateBudget(snapshot, config);
  const required = sumEvidenceCostEstimates([planCost, safetyMargin]);

  if (required.kind === "UNKNOWN") {
    return {
      decision,
      requiredPoints: required,
      remainingAfterPlan: null,
      note: "plan_cost_unknown_distinct_from_zero",
    };
  }

  const requiredPoints = required.kind === "KNOWN" ? required.points : 0;
  const remainingAfterPlan = snapshot.pointsRemaining - requiredPoints;

  return {
    decision,
    requiredPoints: required,
    remainingAfterPlan,
    note:
      decision.action === "OK"
        ? "preview_only_no_admission"
        : `preview_only_budget_${decision.action.toLowerCase()}`,
  };
}

/** Build WS03 dataset/cost plan — not EvidenceAcquisitionPlanV2. */
export function buildDatasetCostPlan(input: {
  planContentHash: string;
  characterId: string;
  seasonId: string;
  entries: EvidenceDatasetPlanEntry[];
  plannedAt: string;
  safetyMarginPoints?: number;
}): WclDatasetCostPlanV2 {
  const summary = summarizeCostPlan(input.entries, input.safetyMarginPoints);
  return {
    schemaVersion: "wcl-dataset-cost-plan-v2",
    planContentHash: input.planContentHash,
    characterId: input.characterId,
    seasonId: input.seasonId,
    entries: summary.entries,
    totalEstimatedCost: summary.totalEstimatedCost,
    safetyMargin: summary.safetyMargin,
    plannedAt: input.plannedAt,
  };
}
