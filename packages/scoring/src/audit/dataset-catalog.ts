/**
 * Expected Scoring V2 evidence datasets — derived from canonical
 * CONSUMER_DATASET_REQUIREMENTS in @mplus/contracts (single source of truth).
 *
 * Persistence contracts:
 * - Event-like kinds in DATASETS_WITH_EVIDENCE_PAGES produce EvidenceDatasetPage rows.
 * - MASTER_DATA: descriptor + WclRunSourceDigest / masterData artifact — no event pages.
 * - RANKING_PARSE: EvidenceDataset descriptor + logical outcome — no EvidenceDatasetPage rows.
 */

import type { EvidenceConsumerDimension, EvidenceDatasetKind } from "@mplus/contracts";
import {
  CONSUMER_DATASET_REQUIREMENTS,
  DATASETS_WITH_EVIDENCE_PAGES,
  consumersForDataset,
  isDatasetRequiredForConsumers,
  unionDatasetsForConsumers,
} from "@mplus/contracts";

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
  | "masterData"
  | "RankingParse";

export interface ExpectedEventDatasetSpec {
  kind: EvidenceDatasetKind;
  persistedKey: PersistedDatasetKey;
  required: boolean;
  consumers: EvidenceConsumerDimension[];
  /** False for MASTER_DATA / RANKING_PARSE — no EvidenceDatasetPage rows. */
  producesPages: boolean;
}

const KIND_TO_PERSISTED: Partial<Record<EvidenceDatasetKind, PersistedDatasetKey>> = {
  CASTS: "Casts",
  HOSTILE_CASTS: "HostileCasts",
  INTERRUPTS: "Interrupts",
  DEATHS: "Deaths",
  DAMAGE_TAKEN: "DamageTaken",
  DAMAGE_DONE: "DamageDone",
  BUFFS: "Buffs",
  DEBUFFS: "Debuffs",
  DISPELS: "Dispels",
  HEALING: "Healing",
  COMBATANT_INFO: "CombatantInfo",
  MASTER_DATA: "masterData",
  RANKING_PARSE: "RankingParse",
};

const DEFAULT_ENABLED: readonly EvidenceConsumerDimension[] = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
];

function buildExpectedDatasets(
  enabled: readonly EvidenceConsumerDimension[] = DEFAULT_ENABLED,
): ExpectedEventDatasetSpec[] {
  const kinds = unionDatasetsForConsumers(enabled, true);
  return kinds
    .map((kind) => {
      const persistedKey = KIND_TO_PERSISTED[kind];
      if (!persistedKey) return null;
      return {
        kind,
        persistedKey,
        required: isDatasetRequiredForConsumers(kind, enabled),
        consumers: consumersForDataset(kind, enabled, true),
        producesPages: DATASETS_WITH_EVIDENCE_PAGES.has(kind),
      } satisfies ExpectedEventDatasetSpec;
    })
    .filter((s): s is ExpectedEventDatasetSpec => s != null);
}

/** All planned datasets for enabled WCL consumers (including non-page kinds). */
export const EXPECTED_DATASETS: readonly ExpectedEventDatasetSpec[] =
  buildExpectedDatasets();

/**
 * Event-like datasets that produce EvidenceDatasetPage rows.
 * MASTER_DATA / RANKING_PARSE are audited separately.
 */
export const EXPECTED_EVENT_DATASETS: readonly ExpectedEventDatasetSpec[] =
  EXPECTED_DATASETS.filter((s) => s.producesPages);

const KIND_TO_PERSISTED_MAP: Record<string, PersistedDatasetKey> = Object.fromEntries(
  Object.entries(KIND_TO_PERSISTED).filter(([, v]) => v != null),
) as Record<string, PersistedDatasetKey>;

const PERSISTED_TO_KIND: Record<string, EvidenceDatasetKind> = Object.fromEntries(
  Object.entries(KIND_TO_PERSISTED_MAP).map(([k, v]) => [v.toLowerCase(), k as EvidenceDatasetKind]),
);

export function datasetKindFromPersistedKey(key: string): EvidenceDatasetKind | null {
  const lower = key.toLowerCase();
  if (PERSISTED_TO_KIND[lower]) return PERSISTED_TO_KIND[lower]!;
  // Descriptor keys often use lowercase EvidenceDatasetKind.
  const upper = key.toUpperCase().replace(/-/g, "_");
  if (upper in KIND_TO_PERSISTED) return upper as EvidenceDatasetKind;
  if (lower === "rankingparse" || lower === "ranking_parse") return "RANKING_PARSE";
  return null;
}

export function persistedKeyForKind(kind: EvidenceDatasetKind): PersistedDatasetKey | null {
  return KIND_TO_PERSISTED[kind] ?? null;
}

/** @deprecated Prefer persistedKeyForKind. */
export function persistedKeyForDatasetKind(
  kind: EvidenceDatasetKind,
): PersistedDatasetKey | null {
  return persistedKeyForKind(kind);
}

export function normalizePersistedDatasetKey(key: string): string {
  return key.trim();
}

export {
  CONSUMER_DATASET_REQUIREMENTS,
  DATASETS_WITH_EVIDENCE_PAGES,
  consumersForDataset,
  isDatasetRequiredForConsumers,
  unionDatasetsForConsumers,
};
