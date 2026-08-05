/**
 * Shared WCL run evidence bundle — consumed by Survival and Utility.
 * Fetched once per report/fight/revision/dataset; persisted via RunAnalysis + external_payloads.
 * Utility must not call WCL directly when a compatible bundle exists.
 */
export const WCL_RUN_EVIDENCE_ANALYSIS_VERSION = "wcl-run-evidence-v1";
export const WCL_RUN_EVIDENCE_SCHEMA_VERSION = "1.0.0";
export const WCL_RUN_EVIDENCE_PROVIDER_CONTRACT = "wcl-graphql-v2-events";

/** Hostile NPC cast filter — Casts defaults to Friendlies without hostilityType=Enemies. */
export const HOSTILE_CAST_FILTER_EXPRESSION =
  'type = "begincast" OR type = "cast" OR type = "castfailed" OR type = "interrupted"';

export type WclHostilityType = "Friendlies" | "Enemies";

export type SharedEvidenceDatasetKey =
  | "masterData"
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
  | "CombatantInfo";

export const SHARED_EVIDENCE_DATASETS: SharedEvidenceDatasetKey[] = [
  "masterData",
  "Casts",
  "HostileCasts",
  "Interrupts",
  "Deaths",
  "DamageTaken",
  "DamageDone",
  "Buffs",
  "Debuffs",
  "Dispels",
  "Healing",
  "CombatantInfo",
];

/** Datasets required by Survival consumers. */
export const SURVIVAL_EVIDENCE_CONSUMERS: SharedEvidenceDatasetKey[] = [
  "masterData",
  "Casts",
  "Deaths",
  "DamageTaken",
  "Buffs",
  "Debuffs",
  "Healing",
  "CombatantInfo",
];

/** Datasets required by Utility consumers. */
export const UTILITY_EVIDENCE_CONSUMERS: SharedEvidenceDatasetKey[] = [
  "masterData",
  "Casts",
  "HostileCasts",
  "Interrupts",
  "Deaths",
  "Buffs",
  "Debuffs",
  "Dispels",
  "DamageDone",
  "CombatantInfo",
];

export interface WclRunEvidenceDatasetPage {
  pageIndex: number;
  startTime: number | null;
  nextPageTimestamp: number | null;
  eventCount: number;
  /** Content fingerprint of the page payload for dedupe. */
  payloadFingerprint: string;
}

/** Why ReportEvents pagination stopped for a shared-evidence dataset. */
export type SharedEvidencePaginationStopReason =
  | "NEXT_PAGE_NULL"
  | "CURSOR_REACHED_FIGHT_END"
  | "MAX_PAGES"
  | "NON_PROGRESSING_CURSOR"
  | "EMPTY_PAGE"
  | "GRAPHQL_ERROR";

/** Fight-window coverage diagnostics for one paginated dataset fetch. */
export interface SharedEvidencePaginationDiagnostics {
  requestedFightStartMs: number | null;
  requestedFightEndMs: number | null;
  firstEventTimestampMs: number | null;
  lastEventTimestampMs: number | null;
  nextPageTimestamp: number | null;
  pageCount: number;
  stopReason: SharedEvidencePaginationStopReason;
  coverageRatio: number | null;
  complete: boolean;
}

export interface WclRunEvidenceDataset {
  key: SharedEvidenceDatasetKey;
  state: "OK" | "MISSING" | "ERROR" | "CACHED" | "PERSISTED";
  truncated: boolean;
  pageCount: number;
  eventCount: number;
  filterSourceId: number | null;
  filterExpression: string | null;
  pages: WclRunEvidenceDatasetPage[];
  events: Array<Record<string, unknown>>;
  consumers: Array<"survival" | "utility">;
  /** Null when cost is unknown — never coerce unknown → 0. */
  pointsConsumed: number | null;
  costSource: "measured" | "estimated" | "unknown";
  /** Per-request costUnits samples (null entries mean extension cost absent). */
  requestCostUnits: Array<number | null>;
  wclRequests: number;
  fetchedAt: string | null;
  source: "provider" | "persisted" | "cache" | "missing";
  /** Present on provider-fetched datasets; may be absent on legacy persisted rows. */
  pagination?: SharedEvidencePaginationDiagnostics;
}

export interface WclCanonicalRunSelection {
  characterKey: string;
  seasonSlug: string;
  refreshContractHash: string | null;
  scoringModelScope: string;
  selectedAt: string;
  runs: Array<{
    dungeonSlug: string;
    reportCode: string;
    reportRevision: number | null;
    fightId: number;
    playerActorId: number | null;
    ownedPetActorIds: number[];
    startTime: number | null;
    endTime: number | null;
    selectionReason: string;
    providerDataAsOf: string | null;
  }>;
}

export interface WclRunEvidenceBundle {
  schemaVersion: typeof WCL_RUN_EVIDENCE_SCHEMA_VERSION;
  analysisVersion: typeof WCL_RUN_EVIDENCE_ANALYSIS_VERSION;
  providerContractVersion: typeof WCL_RUN_EVIDENCE_PROVIDER_CONTRACT;
  reportCode: string;
  reportRevision: number | null;
  fightId: number;
  playerActorId: number | null;
  ownedPetActorIds: number[];
  dungeonSlug: string;
  startTime: number | null;
  endTime: number | null;
  masterData: unknown | null;
  eventDatasets: Partial<Record<SharedEvidenceDatasetKey, WclRunEvidenceDataset>>;
  completeness: {
    required: SharedEvidenceDatasetKey[];
    present: SharedEvidenceDatasetKey[];
    missing: SharedEvidenceDatasetKey[];
    truncated: SharedEvidenceDatasetKey[];
  };
  fetchedAt: string;
  payloadFingerprints: Record<string, string>;
  accounting: {
    datasetsRequested: SharedEvidenceDatasetKey[];
    cacheHits: number;
    persistedHits: number;
    providerCalls: number;
    pages: number;
    /** Null when costSource is unknown — never treat unknown as zero. */
    pointsConsumed: number | null;
    estimatedPointsConsumed: number | null;
    costSource: "measured" | "estimated" | "unknown";
    consumers: Array<"survival" | "utility">;
    duplicatedLogicalFetches: number;
  };
}

export interface SharedEvidenceCompatibilityKey {
  reportCode: string;
  reportRevision: number | null;
  fightId: number;
  actorId: number | null;
  dataset: SharedEvidenceDatasetKey;
  startTime: number | null;
  endTime: number | null;
  filterExpression: string | null;
  providerContractVersion: string;
  payloadFingerprint: string | null;
}

/** Deterministic compatibility key for durable reuse. */
export function buildSharedEvidenceCompatibilityKey(
  input: SharedEvidenceCompatibilityKey,
): string {
  return [
    "wcl-evidence",
    input.reportCode,
    `r${input.reportRevision ?? "unknown"}`,
    `f${input.fightId}`,
    `a${input.actorId ?? "all"}`,
    input.dataset,
    `t${input.startTime ?? 0}-${input.endTime ?? "end"}`,
    `fe:${input.filterExpression ?? "none"}`,
    input.providerContractVersion,
    input.payloadFingerprint ?? "nopayload",
  ].join("|");
}

export function consumersForDataset(
  key: SharedEvidenceDatasetKey,
): Array<"survival" | "utility"> {
  const out: Array<"survival" | "utility"> = [];
  if (SURVIVAL_EVIDENCE_CONSUMERS.includes(key)) out.push("survival");
  if (UTILITY_EVIDENCE_CONSUMERS.includes(key)) out.push("utility");
  return out;
}

export function unionRequiredDatasets(
  consumers: Array<"survival" | "utility">,
): SharedEvidenceDatasetKey[] {
  const set = new Set<SharedEvidenceDatasetKey>();
  if (consumers.includes("survival")) {
    for (const k of SURVIVAL_EVIDENCE_CONSUMERS) set.add(k);
  }
  if (consumers.includes("utility")) {
    for (const k of UTILITY_EVIDENCE_CONSUMERS) set.add(k);
  }
  return [...set];
}
