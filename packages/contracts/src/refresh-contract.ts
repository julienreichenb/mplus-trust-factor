import { createHash } from "node:crypto";

/** Observation row / metric-key contract used by refresh → ScoreSnapshot. */
export const OBSERVATION_SCHEMA_VERSION = "observations-v1";

/** Active-season eight-run selection algorithm identity. */
export const RUN_SELECTION_VERSION = "active-season-eight-v1";

/**
 * Versioned refresh contract. Any bump must invalidate compatible cache reuse,
 * observation/score fingerprints, job dedupe, and published ScoreSnapshot freshness.
 */
export interface RefreshContractVersions {
  scoringModelKey: string;
  scoringModelVersion: number;
  observationSchemaVersion: string;
  wclAdapterVersion: string;
  blizzardAdapterVersion: string;
  raiderIoAdapterVersion: string;
  runSelectionVersion: string;
  abilityCatalogVersion: string;
  mechanicCatalogVersion: string;
  /** Active season slug (or stable id string). */
  activeSeasonId: string;
  /** WCL Mythic+ zone id when relevant; null when unknown. */
  zoneId: number | null;
  /** WCL partition; null means "current". */
  partition: number | null;
}

export type RefreshContractStaleReason =
  | "SCORING_MODEL_CHANGED"
  | "OBSERVATION_SCHEMA_CHANGED"
  | "WCL_ADAPTER_CHANGED"
  | "BLIZZARD_ADAPTER_CHANGED"
  | "RAIDERIO_ADAPTER_CHANGED"
  | "RUN_SELECTION_CHANGED"
  | "ABILITY_CATALOG_CHANGED"
  | "MECHANIC_CATALOG_CHANGED"
  | "ACTIVE_SEASON_CHANGED"
  | "ZONE_OR_PARTITION_CHANGED"
  | "SCORE_STALE_VS_PROVIDERS"
  | "REFRESH_FAILED"
  | "TTL_EXPIRED"
  | "CONTRACT_MISSING";

const FIELD_REASONS: Array<{
  key: keyof RefreshContractVersions;
  reason: RefreshContractStaleReason;
}> = [
  { key: "scoringModelKey", reason: "SCORING_MODEL_CHANGED" },
  { key: "scoringModelVersion", reason: "SCORING_MODEL_CHANGED" },
  { key: "observationSchemaVersion", reason: "OBSERVATION_SCHEMA_CHANGED" },
  { key: "wclAdapterVersion", reason: "WCL_ADAPTER_CHANGED" },
  { key: "blizzardAdapterVersion", reason: "BLIZZARD_ADAPTER_CHANGED" },
  { key: "raiderIoAdapterVersion", reason: "RAIDERIO_ADAPTER_CHANGED" },
  { key: "runSelectionVersion", reason: "RUN_SELECTION_CHANGED" },
  { key: "abilityCatalogVersion", reason: "ABILITY_CATALOG_CHANGED" },
  { key: "mechanicCatalogVersion", reason: "MECHANIC_CATALOG_CHANGED" },
  { key: "activeSeasonId", reason: "ACTIVE_SEASON_CHANGED" },
  { key: "zoneId", reason: "ZONE_OR_PARTITION_CHANGED" },
  { key: "partition", reason: "ZONE_OR_PARTITION_CHANGED" },
];

export function normalizeRefreshContract(
  input: RefreshContractVersions,
): RefreshContractVersions {
  return {
    scoringModelKey: input.scoringModelKey,
    scoringModelVersion: input.scoringModelVersion,
    observationSchemaVersion: input.observationSchemaVersion,
    wclAdapterVersion: input.wclAdapterVersion,
    blizzardAdapterVersion: input.blizzardAdapterVersion,
    raiderIoAdapterVersion: input.raiderIoAdapterVersion,
    runSelectionVersion: input.runSelectionVersion,
    abilityCatalogVersion: input.abilityCatalogVersion,
    mechanicCatalogVersion: input.mechanicCatalogVersion,
    activeSeasonId: input.activeSeasonId,
    zoneId: input.zoneId,
    partition: input.partition,
  };
}

/** Stable material string for hashing / logging. */
export function refreshContractMaterial(input: RefreshContractVersions): string {
  const v = normalizeRefreshContract(input);
  return [
    `scoringModelKey=${v.scoringModelKey}`,
    `scoringModelVersion=${v.scoringModelVersion}`,
    `observationSchemaVersion=${v.observationSchemaVersion}`,
    `wclAdapterVersion=${v.wclAdapterVersion}`,
    `blizzardAdapterVersion=${v.blizzardAdapterVersion}`,
    `raiderIoAdapterVersion=${v.raiderIoAdapterVersion}`,
    `runSelectionVersion=${v.runSelectionVersion}`,
    `abilityCatalogVersion=${v.abilityCatalogVersion}`,
    `mechanicCatalogVersion=${v.mechanicCatalogVersion}`,
    `activeSeasonId=${v.activeSeasonId}`,
    `zoneId=${v.zoneId ?? "null"}`,
    `partition=${v.partition == null ? "current" : String(v.partition)}`,
  ].join("|");
}

export function hashRefreshContract(input: RefreshContractVersions): string {
  return createHash("sha256").update(refreshContractMaterial(input), "utf8").digest("hex");
}

export function isRefreshContractCompatible(
  stored: unknown,
  current: RefreshContractVersions,
): boolean {
  const parsed = parseRefreshContract(stored);
  if (!parsed) return false;
  return hashRefreshContract(parsed) === hashRefreshContract(current);
}

export function parseRefreshContract(value: unknown): RefreshContractVersions | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.scoringModelKey !== "string") return null;
  if (typeof row.scoringModelVersion !== "number" || !Number.isFinite(row.scoringModelVersion)) {
    return null;
  }
  if (typeof row.observationSchemaVersion !== "string") return null;
  if (typeof row.wclAdapterVersion !== "string") return null;
  if (typeof row.blizzardAdapterVersion !== "string") return null;
  if (typeof row.raiderIoAdapterVersion !== "string") return null;
  if (typeof row.runSelectionVersion !== "string") return null;
  if (typeof row.abilityCatalogVersion !== "string") return null;
  if (typeof row.mechanicCatalogVersion !== "string") return null;
  if (typeof row.activeSeasonId !== "string") return null;
  const zoneId =
    row.zoneId == null ? null : typeof row.zoneId === "number" ? row.zoneId : null;
  const partition =
    row.partition == null ? null : typeof row.partition === "number" ? row.partition : null;
  if (row.zoneId != null && zoneId == null) return null;
  if (row.partition != null && partition == null) return null;

  return normalizeRefreshContract({
    scoringModelKey: row.scoringModelKey,
    scoringModelVersion: row.scoringModelVersion,
    observationSchemaVersion: row.observationSchemaVersion,
    wclAdapterVersion: row.wclAdapterVersion,
    blizzardAdapterVersion: row.blizzardAdapterVersion,
    raiderIoAdapterVersion: row.raiderIoAdapterVersion,
    runSelectionVersion: row.runSelectionVersion,
    abilityCatalogVersion: row.abilityCatalogVersion,
    mechanicCatalogVersion: row.mechanicCatalogVersion,
    activeSeasonId: row.activeSeasonId,
    zoneId,
    partition,
  });
}

/** First mismatched field reason, or null when compatible. */
export function refreshContractStaleReasons(
  stored: unknown,
  current: RefreshContractVersions,
): RefreshContractStaleReason[] {
  const parsed = parseRefreshContract(stored);
  if (!parsed) return ["CONTRACT_MISSING"];
  const reasons: RefreshContractStaleReason[] = [];
  const seen = new Set<RefreshContractStaleReason>();
  for (const { key, reason } of FIELD_REASONS) {
    if (parsed[key] !== current[key] && !seen.has(reason)) {
      seen.add(reason);
      reasons.push(reason);
    }
  }
  return reasons;
}

export function readRefreshContractFromExplanation(
  explanation: unknown,
): RefreshContractVersions | null {
  if (!explanation || typeof explanation !== "object") return null;
  const row = explanation as Record<string, unknown>;
  return parseRefreshContract(row.refreshContract);
}

/** True when published snapshot model differs from the active scoring model. */
export function isScoreSnapshotModelStale(
  snapshot: { modelKey?: string | null; modelVersion?: number | null } | null | undefined,
  active: { key: string; version: number },
): boolean {
  if (!snapshot?.modelKey || snapshot.modelVersion == null) return true;
  return snapshot.modelKey !== active.key || snapshot.modelVersion !== active.version;
}
