/**
 * Dataset union planner — pure, provider-free.
 *
 * Builds the exact union of datasets for enabled consumers from frozen slots
 * supplied by Workstream 02. Does not select slots or finalize manifests.
 */

import type {
  EvidenceConsumerDimension,
  EvidenceCostEstimate,
  EvidenceDatasetKind,
} from "@mplus/contracts";
import { HOSTILE_CAST_FILTER_EXPRESSION } from "../evidence/wcl-run-evidence-types.js";
import { estimateDatasetCost } from "./cost-plan.js";
import {
  EVIDENCE_PLANNER_PROVIDER_CONTRACT,
  type EvidenceDatasetPlanEntry,
  type EvidenceFrozenSlotInput,
} from "./planner-types.js";

/** Phase 1 consumer matrix (normative doc 04). optional datasets included when listed. */
const CONSUMER_DATASETS: Record<
  EvidenceConsumerDimension,
  ReadonlyArray<{ dataset: EvidenceDatasetKind; required: boolean }>
> = {
  PERFORMANCE: [{ dataset: "RANKING_PARSE", required: true }],
  SURVIVAL: [
    { dataset: "MASTER_DATA", required: true },
    { dataset: "CASTS", required: true },
    { dataset: "HOSTILE_CASTS", required: false },
    { dataset: "DEATHS", required: true },
    { dataset: "DAMAGE_TAKEN", required: true },
    { dataset: "BUFFS", required: true },
    { dataset: "DEBUFFS", required: false },
    { dataset: "HEALING", required: true },
    { dataset: "COMBATANT_INFO", required: true },
    { dataset: "DAMAGE_DONE", required: false },
  ],
  UTILITY: [
    { dataset: "MASTER_DATA", required: true },
    { dataset: "CASTS", required: true },
    { dataset: "HOSTILE_CASTS", required: true },
    { dataset: "INTERRUPTS", required: true },
    { dataset: "DEATHS", required: false },
    { dataset: "BUFFS", required: true },
    { dataset: "DEBUFFS", required: true },
    { dataset: "DISPELS", required: true },
    { dataset: "COMBATANT_INFO", required: true },
  ],
};

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

export function unionDatasetsForConsumers(
  consumers: readonly EvidenceConsumerDimension[],
  includeOptional = true,
): EvidenceDatasetKind[] {
  const set = new Set<EvidenceDatasetKind>();
  for (const consumer of consumers) {
    for (const row of CONSUMER_DATASETS[consumer]) {
      if (row.required || includeOptional) set.add(row.dataset);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function consumersForDatasetKind(
  dataset: EvidenceDatasetKind,
  enabled: readonly EvidenceConsumerDimension[],
  includeOptional = true,
): EvidenceConsumerDimension[] {
  const out: EvidenceConsumerDimension[] = [];
  for (const consumer of enabled) {
    const row = CONSUMER_DATASETS[consumer].find((r) => r.dataset === dataset);
    if (!row) continue;
    if (row.required || includeOptional) out.push(consumer);
  }
  return out;
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
      const consumers = consumersForDatasetKind(
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
