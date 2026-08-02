/**
 * WS03-local planner types that are not part of the WS02 Evidence V2 contracts.
 *
 * Canonical candidate / identity / cost-estimate / acquisition-plan types come
 * from `@mplus/contracts` (evidence-v2). Do not re-declare those here.
 *
 * Note: official EvidenceAcquisitionPlanV2 is WS02 selection policy (ordered
 * discovery-identity candidates per slot). Dataset union + cost estimates are
 * a separate WS03 execution-planning artifact.
 */

import type {
  EvidenceCandidateFrozenIdentity,
  EvidenceConsumerDimension,
  EvidenceCostEstimate,
  EvidenceDatasetKind,
} from "@mplus/contracts";

export const EVIDENCE_PLANNER_PROVIDER_CONTRACT = "wcl-graphql-v2-events" as const;

/**
 * One logical dataset fetch in the WS03 detailed cost/dataset plan.
 * Not the WS02 EvidenceAcquisitionPlanV2 slot policy.
 */
export interface EvidenceDatasetPlanEntry {
  compatibilityKey: string;
  reportCode: string;
  reportRevision: number;
  fightId: number;
  actorId: number | null;
  dataset: EvidenceDatasetKind;
  startTime: number | null;
  endTime: number | null;
  filterExpression: string | null;
  hostilityType: number | null;
  includeResources: boolean;
  providerContractVersion: string;
  estimatedCost: EvidenceCostEstimate;
  consumers: EvidenceConsumerDimension[];
}

/**
 * Frozen-slot input for detailed dataset planning after WS02 finalization.
 * WS03 must not invent these slots.
 */
export interface EvidenceFrozenSlotInput {
  slotId: string;
  dungeonSlug: string;
  identity: EvidenceCandidateFrozenIdentity;
  actorId: number | null;
  startTime: number | null;
  endTime: number | null;
}

/**
 * WS03 dataset/cost plan for provider execution.
 * Distinct from EvidenceAcquisitionPlanV2 (WS02 ordered candidate policy).
 */
export interface WclDatasetCostPlanV2 {
  schemaVersion: "wcl-dataset-cost-plan-v2";
  /** Manifest content hash when planning from a frozen manifest; else acquisition-plan hash. */
  planContentHash: string;
  characterId: string;
  seasonId: string;
  entries: EvidenceDatasetPlanEntry[];
  totalEstimatedCost: EvidenceCostEstimate;
  safetyMargin: EvidenceCostEstimate;
  plannedAt: string;
}
