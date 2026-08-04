/**
 * Expected Scoring V2 evidence datasets and consumer mapping.
 * Provider-free catalog — keys map EvidenceDatasetKind ↔ persisted WCL datasetKey.
 */

import type { EvidenceConsumerDimension, EvidenceDatasetKind } from "@mplus/contracts";

/** Persisted WCL event/table datasetKey values (PascalCase / camelCase). */
export type PersistedDatasetKey =
  | "Casts"
  | "HostileCasts"
  | "Interrupts"
  | "Deaths"
  | "DamageTaken"
  | "DamageDone"
  | "Buffs"
  | "Debuffs"
  | "Dispels"
  | "Healing"
  | "CombatantInfo"
  | "masterData";

export interface ExpectedEventDatasetSpec {
  kind: EvidenceDatasetKind;
  persistedKey: PersistedDatasetKey;
  required: boolean;
  consumers: EvidenceConsumerDimension[];
}

/** Event-like datasets audited per selected slot (excludes MASTER_DATA / RANKING_PARSE). */
export const EXPECTED_EVENT_DATASETS: readonly ExpectedEventDatasetSpec[] = [
  {
    kind: "CASTS",
    persistedKey: "Casts",
    required: true,
    consumers: ["SURVIVAL", "UTILITY"],
  },
  {
    kind: "HOSTILE_CASTS",
    persistedKey: "HostileCasts",
    required: true,
    consumers: ["UTILITY"],
  },
  {
    kind: "INTERRUPTS",
    persistedKey: "Interrupts",
    required: true,
    consumers: ["UTILITY"],
  },
  {
    kind: "DEATHS",
    persistedKey: "Deaths",
    required: true,
    consumers: ["SURVIVAL", "UTILITY"],
  },
  {
    kind: "DAMAGE_TAKEN",
    persistedKey: "DamageTaken",
    required: true,
    consumers: ["SURVIVAL"],
  },
  {
    kind: "DAMAGE_DONE",
    persistedKey: "DamageDone",
    required: false,
    consumers: ["UTILITY"],
  },
  {
    kind: "BUFFS",
    persistedKey: "Buffs",
    required: true,
    consumers: ["SURVIVAL", "UTILITY"],
  },
  {
    kind: "DEBUFFS",
    persistedKey: "Debuffs",
    required: true,
    consumers: ["SURVIVAL", "UTILITY"],
  },
  {
    kind: "DISPELS",
    persistedKey: "Dispels",
    required: true,
    consumers: ["UTILITY"],
  },
  {
    kind: "HEALING",
    persistedKey: "Healing",
    required: true,
    consumers: ["SURVIVAL"],
  },
  {
    kind: "COMBATANT_INFO",
    persistedKey: "CombatantInfo",
    required: true,
    consumers: ["SURVIVAL", "UTILITY"],
  },
] as const;

const KIND_TO_PERSISTED: Record<string, PersistedDatasetKey> = Object.fromEntries(
  EXPECTED_EVENT_DATASETS.map((d) => [d.kind, d.persistedKey]),
);
KIND_TO_PERSISTED.MASTER_DATA = "masterData";

const PERSISTED_TO_KIND: Record<string, EvidenceDatasetKind> = Object.fromEntries(
  EXPECTED_EVENT_DATASETS.map((d) => [d.persistedKey.toLowerCase(), d.kind]),
);
PERSISTED_TO_KIND.masterdata = "MASTER_DATA";

export function persistedKeyForDatasetKind(kind: EvidenceDatasetKind): string | null {
  return KIND_TO_PERSISTED[kind] ?? null;
}

export function datasetKindFromPersistedKey(key: string): EvidenceDatasetKind | null {
  return PERSISTED_TO_KIND[key.trim().toLowerCase()] ?? null;
}

export function normalizePersistedDatasetKey(key: string): string {
  const kind = datasetKindFromPersistedKey(key);
  if (!kind) return key;
  return persistedKeyForDatasetKind(kind) ?? key;
}
