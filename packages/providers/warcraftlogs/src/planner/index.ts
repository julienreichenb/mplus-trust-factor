/**
 * WCL Evidence Query Planner V2 — public API.
 *
 * Workstream 03: discovery, hydration grouping, dataset union, cost estimates.
 * Does not select final slots or finalize EvidenceManifestV2 (Workstream 02).
 */

import {
  discoveryIdentityKey,
  frozenIdentityKey,
  sumEvidenceCostEstimates,
  type EvidenceAccessState,
  type EvidenceAcquisitionPlanV2,
  type EvidenceCandidateDiscoveryIdentity,
  type EvidenceCandidateFrozenIdentity,
  type EvidenceCandidateMetadataV2,
  type EvidenceConsumerDimension,
  type EvidenceCostEstimate,
  type EvidenceDatasetKind,
  type EvidenceIdentityResolution,
} from "@mplus/contracts";
import {
  buildDatasetCostPlan,
  previewRateBudgetForPlan,
  summarizeCostPlan,
  type CostPlanSummary,
} from "./cost-plan.js";
import {
  buildDatasetPlanEntries,
  buildDatasetRequirements,
  buildPlannerCompatibilityKey,
  unionDatasetsForConsumers,
  type DatasetPlanOptions,
  type EvidenceDatasetProviderCandidateV2,
  type EvidenceDatasetRequirementV2,
} from "./dataset-plan.js";
import {
  buildDiscoveryPlan,
  groupCandidatesForHydration,
  toCandidateMetadataV2,
  type DiscoveryPlanResult,
  type DiscoverySourceRow,
} from "./discovery-plan.js";
import type {
  EvidenceDatasetPlanEntry,
  EvidenceFrozenSlotInput,
  WclDatasetCostPlanV2,
} from "./planner-types.js";
import type { WclRateLimitSnapshot } from "../types.js";
import type { RateBudgetConfig } from "../rate/rate-budget.js";

export type {
  EvidenceAccessState,
  EvidenceAcquisitionPlanV2,
  EvidenceCandidateDiscoveryIdentity,
  EvidenceCandidateFrozenIdentity,
  EvidenceCandidateMetadataV2,
  EvidenceConsumerDimension,
  EvidenceCostEstimate,
  EvidenceDatasetKind,
  EvidenceIdentityResolution,
  EvidenceDatasetPlanEntry,
  EvidenceFrozenSlotInput,
  WclDatasetCostPlanV2,
};

export {
  discoveryIdentityKey,
  frozenIdentityKey,
  sumEvidenceCostEstimates,
};

export * from "./planner-types.js";
export * from "./discovery-plan.js";
export * from "./dataset-plan.js";
export * from "./cost-plan.js";

export interface PlanDetailedEvidenceInput {
  /** Frozen slots from WS02 EvidenceManifestV2 — never invented here. */
  frozenSlots: readonly EvidenceFrozenSlotInput[];
  /** Content hash of the frozen manifest (or acquisition plan) driving this plan. */
  planContentHash: string;
  characterId: string;
  seasonId: string;
  plannedAt: string;
  dataset: DatasetPlanOptions;
  safetyMarginPoints?: number;
}

export interface DetailedEvidencePlan {
  /** WS03 dataset/cost plan — not EvidenceAcquisitionPlanV2. */
  datasetCostPlan: WclDatasetCostPlanV2;
  cost: CostPlanSummary;
}

/** Stage A/B: discovery + hydration grouping (no slot selection). */
export function planCandidateDiscovery(input: {
  zoneRankingCandidates?: DiscoverySourceRow[];
  parseRows?: DiscoverySourceRow[];
  recentReportCandidates?: DiscoverySourceRow[];
  persistedWclSources?: DiscoverySourceRow[];
  activeDungeonSlugs: readonly string[];
  bounds?: Parameters<typeof buildDiscoveryPlan>[0]["bounds"];
}): DiscoveryPlanResult {
  return buildDiscoveryPlan(input);
}

/**
 * Stage C: detailed dataset union + cost for frozen manifest slots.
 * Does not build EvidenceAcquisitionPlanV2 or finalize manifests.
 */
export function planDetailedEvidence(input: PlanDetailedEvidenceInput): DetailedEvidencePlan {
  const entries = buildDatasetPlanEntries(input.frozenSlots, input.dataset);
  const cost = summarizeCostPlan(entries, input.safetyMarginPoints);
  const datasetCostPlan = buildDatasetCostPlan({
    planContentHash: input.planContentHash,
    characterId: input.characterId,
    seasonId: input.seasonId,
    entries,
    plannedAt: input.plannedAt,
    safetyMarginPoints: input.safetyMarginPoints,
  });
  return { datasetCostPlan, cost };
}

export {
  buildPlannerCompatibilityKey,
  buildDatasetRequirements,
  unionDatasetsForConsumers,
  groupCandidatesForHydration,
  toCandidateMetadataV2,
  previewRateBudgetForPlan,
};

export type { WclRateLimitSnapshot, RateBudgetConfig, EvidenceDatasetRequirementV2, EvidenceDatasetProviderCandidateV2 };
