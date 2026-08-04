/**
 * Dataset union planner — pure, provider-free.
 *
 * Builds the exact union of datasets for enabled consumers from frozen slots
 * supplied by Workstream 02. Does not select slots or finalize manifests.
 *
 * Canonical consumer → dataset matrix lives in @mplus/contracts
 * (CONSUMER_DATASET_REQUIREMENTS). Do not duplicate it here.
 */

import type {
  EvidenceConsumerDimension,
  EvidenceCostEstimate,
  EvidenceDatasetKind,
} from "@mplus/contracts";
import {
  consumersForDataset,
  isDatasetRequiredForConsumers,
  unionDatasetsForConsumers,
} from "@mplus/contracts";
import { HOSTILE_CAST_FILTER_EXPRESSION } from "../evidence/wcl-run-evidence-types.js";
import { estimateDatasetCost } from "./cost-plan.js";
import {
  EVIDENCE_PLANNER_PROVIDER_CONTRACT,
  type EvidenceDatasetPlanEntry,
  type EvidenceFrozenSlotInput,
} from "./planner-types.js";

/** WCL hostilityType numeric encoding used in compatibility keys. */
export const HOSTILITY_FRIENDLIES = 0;
export const HOSTILITY_ENEMIES = 1;

export interface DatasetPlanOptions {
  enabledConsumers: readonly EvidenceConsumerDimension[];
  /** Include optional matrix rows (default true for Phase 1 completeness). */
  includeOptional?: boolean;
  providerContractVersion?: string;
  includeResourcesByDataset?: Partial<Record<EvidenceDatasetKind, boolean>>;
  /** Compatibility keys already satisfied by cache/persisted store. */
  cacheHitKeys?: ReadonlySet<string>;
  /** Override estimated pages for pagination cost (default 1 for tables, 3 for events). */
  estimatedPagesByDataset?: Partial<Record<EvidenceDatasetKind, number>>;
}

export interface CompatibilityKeyInput {
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
}

/** Deterministic dataset cache identity (doc 04 + hostility/includeResources). */
export function buildPlannerCompatibilityKey(input: CompatibilityKeyInput): string {
  return [
    "wcl-evidence-v2",
    input.reportCode,
    `r${input.reportRevision}`,
    `f${input.fightId}`,
    `a${input.actorId ?? "all"}`,
    input.dataset,
    `t${input.startTime ?? 0}-${input.endTime ?? "end"}`,
    `fe:${input.filterExpression ?? "none"}`,
    `h${input.hostilityType ?? "na"}`,
    `res:${input.includeResources ? "1" : "0"}`,
    input.providerContractVersion,
  ].join("|");
}

/** Provider candidate for a planned dataset — acquisition may not invent outside this list. */
export type EvidenceDatasetProviderCandidateV2 =
  | "warcraftlogs"
  | "artifact_cache"
  | "persisted_dataset";

/** Immutable dataset requirements for a Scoring V2 batch (no slot identity yet). */
export interface EvidenceDatasetRequirementV2 {
  dataset: EvidenceDatasetKind;
  /** True when any enabled consumer lists the dataset as required. */
  required: boolean;
  consumers: EvidenceConsumerDimension[];
  providerContractVersion: string;
  /** Artifact/compatibility-key reuse is always eligible for these datasets. */
  cacheReusable: true;
  /**
   * Ordered provider/fallback candidates. Acquisition must try in order and
   * must not call providers outside this list.
   */
  providerCandidates: readonly EvidenceDatasetProviderCandidateV2[];
  /** Known truncation / capability limits recorded at plan time. */
  limitations: readonly string[];
}

const DEFAULT_PROVIDER_FALLBACK: readonly EvidenceDatasetProviderCandidateV2[] = [
  "persisted_dataset",
  "artifact_cache",
  "warcraftlogs",
] as const;

function planLimitationsForDataset(dataset: EvidenceDatasetKind): readonly string[] {
  if (dataset === "RANKING_PARSE") {
    return ["ranking_parse_requires_provider_capability"];
  }
  if (dataset === "HOSTILE_CASTS") {
    return ["hostile_casts_may_truncate_under_page_budget"];
  }
  return [];
}

/**
 * Build the immutable dataset requirement list from enabled consumers.
 * Acquisition must not request datasets outside this list.
 */
export function buildDatasetRequirements(
  enabledConsumers: readonly EvidenceConsumerDimension[],
  options?: {
    includeOptional?: boolean;
    providerContractVersion?: string;
  },
): EvidenceDatasetRequirementV2[] {
  const includeOptional = options?.includeOptional !== false;
  const providerContractVersion =
    options?.providerContractVersion ?? EVIDENCE_PLANNER_PROVIDER_CONTRACT;
  const datasets = unionDatasetsForConsumers(enabledConsumers, includeOptional);
  return datasets.map((dataset) => {
    const consumers = consumersForDataset(dataset, enabledConsumers, includeOptional);
    const required = isDatasetRequiredForConsumers(dataset, enabledConsumers);
    return {
      dataset,
      required,
      consumers,
      providerContractVersion,
      cacheReusable: true as const,
      providerCandidates: DEFAULT_PROVIDER_FALLBACK,
      limitations: planLimitationsForDataset(dataset),
    };
  });
}

/** @deprecated Prefer consumersForDataset from @mplus/contracts. */
export function consumersForDatasetKind(
  dataset: EvidenceDatasetKind,
  enabled: readonly EvidenceConsumerDimension[],
  includeOptional = true,
): EvidenceConsumerDimension[] {
  return consumersForDataset(dataset, enabled, includeOptional);
}

function defaultFilter(dataset: EvidenceDatasetKind): string | null {
  if (dataset === "HOSTILE_CASTS") return HOSTILE_CAST_FILTER_EXPRESSION;
  return null;
}

function defaultHostility(dataset: EvidenceDatasetKind): number | null {
  if (dataset === "HOSTILE_CASTS") return HOSTILITY_ENEMIES;
  if (dataset === "CASTS" || dataset === "BUFFS" || dataset === "DEBUFFS") {
    return HOSTILITY_FRIENDLIES;
  }
  return null;
}

function defaultActorScope(
  dataset: EvidenceDatasetKind,
  slotActorId: number | null,
): number | null {
  // master data / ranking / hostile NPC casts are report- or fight-scoped.
  if (
    dataset === "MASTER_DATA" ||
    dataset === "RANKING_PARSE" ||
    dataset === "HOSTILE_CASTS" ||
    dataset === "INTERRUPTS"
  ) {
    return null;
  }
  return slotActorId;
}

function defaultIncludeResources(
  dataset: EvidenceDatasetKind,
  overrides?: Partial<Record<EvidenceDatasetKind, boolean>>,
): boolean {
  if (overrides?.[dataset] != null) return overrides[dataset]!;
  // Health-bearing survival windows need resources; others default off.
  return dataset === "DAMAGE_TAKEN" || dataset === "HEALING" || dataset === "COMBATANT_INFO";
}

/**
 * Union datasets across selected frozen slots. One entry per compatibility key.
 */
export function buildDatasetPlanEntries(
  slots: readonly EvidenceFrozenSlotInput[],
  options: DatasetPlanOptions,
): EvidenceDatasetPlanEntry[] {
  const includeOptional = options.includeOptional !== false;
  const providerContractVersion =
    options.providerContractVersion ?? EVIDENCE_PLANNER_PROVIDER_CONTRACT;
  const datasets = unionDatasetsForConsumers(options.enabledConsumers, includeOptional);
  const byKey = new Map<string, EvidenceDatasetPlanEntry>();

  for (const slot of slots) {
    for (const dataset of datasets) {
      const consumers = consumersForDataset(
        dataset,
        options.enabledConsumers,
        includeOptional,
      );
      if (consumers.length === 0) continue;

      const actorId = defaultActorScope(dataset, slot.actorId);
      const filterExpression = defaultFilter(dataset);
      const hostilityType = defaultHostility(dataset);
      const includeResources = defaultIncludeResources(
        dataset,
        options.includeResourcesByDataset,
      );

      const compatibilityKey = buildPlannerCompatibilityKey({
        reportCode: slot.identity.reportCode,
        reportRevision: slot.identity.reportRevision,
        fightId: slot.identity.fightId,
        actorId,
        dataset,
        startTime: slot.startTime,
        endTime: slot.endTime,
        filterExpression,
        hostilityType,
        includeResources,
        providerContractVersion,
      });

      const existing = byKey.get(compatibilityKey);
      if (existing) {
        const merged = new Set([...existing.consumers, ...consumers]);
        existing.consumers = [...merged].sort((a, b) =>
          a.localeCompare(b),
        ) as EvidenceConsumerDimension[];
        continue;
      }

      const cacheHit = options.cacheHitKeys?.has(compatibilityKey) === true;
      const pages = options.estimatedPagesByDataset?.[dataset];
      const estimatedCost: EvidenceCostEstimate = cacheHit
        ? { kind: "ZERO_CACHE_HIT" }
        : estimateDatasetCost(dataset, pages);

      byKey.set(compatibilityKey, {
        compatibilityKey,
        reportCode: slot.identity.reportCode,
        reportRevision: slot.identity.reportRevision,
        fightId: slot.identity.fightId,
        actorId,
        dataset,
        startTime: slot.startTime,
        endTime: slot.endTime,
        filterExpression,
        hostilityType,
        includeResources,
        providerContractVersion,
        estimatedCost,
        consumers: [...consumers].sort((a, b) =>
          a.localeCompare(b),
        ) as EvidenceConsumerDimension[],
      });
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.compatibilityKey.localeCompare(b.compatibilityKey),
  );
}
