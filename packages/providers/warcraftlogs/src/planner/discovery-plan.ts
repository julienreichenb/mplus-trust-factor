/**
 * V2 discovery planning — pure, provider-free.
 *
 * Combines zone rankings, recent reports, and persisted WCL sources into bounded
 * candidates with factual access/incompleteness diagnostics.
 *
 * Does NOT select final slots (Workstream 02 ownership).
 */

import {
  discoveryIdentityKey,
  EVIDENCE_PLAN_MAX_CANDIDATES_PER_DUNGEON,
  EVIDENCE_SLOTS_PER_DUNGEON,
  type EvidenceAccessState,
  type EvidenceCandidateDiscoveryIdentity,
  type EvidenceCandidateMetadataV2,
  type EvidenceIdentityResolution,
} from "@mplus/contracts";

/** V2 retention bounds (normative doc 03 + WS02 plan constant). */
export const V2_MAX_CANDIDATES_PER_DUNGEON = EVIDENCE_PLAN_MAX_CANDIDATES_PER_DUNGEON;
export const V2_MAX_TOTAL_CANDIDATES = 80;
/** Slots WS02 will eventually fill per dungeon — used only for fallback-depth reporting. */
export const V2_TARGET_SLOTS_PER_DUNGEON = EVIDENCE_SLOTS_PER_DUNGEON;

export type DiscoverySourceKind =
  | "zone_rankings"
  | "recent_reports"
  | "persisted_wcl"
  | "parse_row";

export interface DiscoverySourceRow {
  reportCode: string;
  fightId: number;
  dungeonSlug: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  runScore: number | null;
  completedAt: string | null;
  fightDurationMs: number | null;
  actorId: number | null;
  reportRevision: number | null;
  source: DiscoverySourceKind;
  /** Optional parse percentile — diagnostics only; never used for selection here. */
  parsePercentile?: number | null;
  visibility?: "public" | "private" | "hidden" | "unknown";
  archivedOrGated?: boolean;
  schemaUnsupported?: boolean;
  rateDeferred?: boolean;
  identityResolution?: EvidenceIdentityResolution;
  hardError?: boolean;
  fightAccessible?: boolean;
}

export interface DiscoveryBounds {
  maxPerDungeon: number;
  maxTotal: number;
  targetSlotsPerDungeon: number;
}

export const DEFAULT_DISCOVERY_BOUNDS: DiscoveryBounds = {
  maxPerDungeon: V2_MAX_CANDIDATES_PER_DUNGEON,
  maxTotal: V2_MAX_TOTAL_CANDIDATES,
  targetSlotsPerDungeon: V2_TARGET_SLOTS_PER_DUNGEON,
};

export interface DiscoveryAccessDiagnostics {
  accessState: EvidenceAccessState;
  identityResolution: EvidenceIdentityResolution;
  fightAccessible: boolean;
  hardError: boolean;
  incompleteness: {
    dungeonUnknown: boolean;
    keyLevelUnknown: boolean;
    revisionUnknown: boolean;
    actorUnknown: boolean;
    durationUnknown: boolean;
  };
}

export interface PlannedDiscoveryCandidate {
  discoveryIdentity: EvidenceCandidateDiscoveryIdentity;
  dungeonSlug: string | null;
  keyLevel: number | null;
  reportRevision: number | null;
  source: DiscoverySourceKind;
  diagnostics: DiscoveryAccessDiagnostics;
  /** Raw factual fields retained for WS02 metadata mapping after hydration. */
  factual: {
    timed: boolean | null;
    runScore: number | null;
    completedAt: string | null;
    fightDurationMs: number | null;
    actorId: number | null;
    parsePercentile: number | null;
  };
}

export interface DungeonFallbackDepth {
  dungeonSlug: string;
  retainedCount: number;
  /** How many retained candidates exceed the WS02 target slot count. */
  fallbackDepth: number;
  truncatedByBound: boolean;
}

export interface ReportHydrationGroup {
  reportCode: string;
  fightIds: number[];
  candidateKeys: string[];
}

export interface DiscoveryPlanResult {
  candidates: PlannedDiscoveryCandidate[];
  perDungeon: DungeonFallbackDepth[];
  hydrationGroups: ReportHydrationGroup[];
  totals: {
    inputCount: number;
    retainedCount: number;
    truncatedTotal: boolean;
    privateOrHiddenSkipped: number;
  };
}

const SOURCE_PRIORITY: Record<DiscoverySourceKind, number> = {
  zone_rankings: 0,
  parse_row: 1,
  persisted_wcl: 2,
  recent_reports: 3,
};

function resolveAccessState(row: DiscoverySourceRow): EvidenceAccessState {
  if (row.hardError) return "UNKNOWN";
  if (row.schemaUnsupported) return "SCHEMA_UNSUPPORTED";
  if (row.rateDeferred) return "RATE_DEFERRED";
  if (row.archivedOrGated) return "ARCHIVED_OR_GATED";
  if (row.visibility === "private" || row.visibility === "hidden") {
    return "PRIVATE_OR_HIDDEN";
  }
  if (row.visibility === "public") return "PUBLIC";
  return "UNKNOWN";
}

function buildDiagnostics(row: DiscoverySourceRow): DiscoveryAccessDiagnostics {
  return {
    accessState: resolveAccessState(row),
    identityResolution: row.identityResolution ?? "UNRESOLVED",
    fightAccessible: row.fightAccessible ?? row.fightId >= 0,
    hardError: row.hardError === true,
    incompleteness: {
      dungeonUnknown: row.dungeonSlug == null || row.dungeonSlug.length === 0,
      keyLevelUnknown: row.keyLevel == null || row.keyLevel <= 0,
      revisionUnknown: row.reportRevision == null,
      actorUnknown: row.actorId == null,
      durationUnknown: row.fightDurationMs == null || row.fightDurationMs <= 0,
    },
  };
}

function compareForRetention(a: DiscoverySourceRow, b: DiscoverySourceRow): number {
  // Prefer richer factual metadata when merging duplicates — not WS02 selection order.
  const aRev = a.reportRevision != null ? 1 : 0;
  const bRev = b.reportRevision != null ? 1 : 0;
  if (bRev !== aRev) return bRev - aRev;
  const aActor = a.actorId != null ? 1 : 0;
  const bActor = b.actorId != null ? 1 : 0;
  if (bActor !== aActor) return bActor - aActor;
  const sourceDelta = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
  if (sourceDelta !== 0) return sourceDelta;
  const aKey = a.keyLevel ?? -1;
  const bKey = b.keyLevel ?? -1;
  if (bKey !== aKey) return bKey - aKey;
  return discoveryIdentityKey({ reportCode: a.reportCode, fightId: a.fightId }).localeCompare(
    discoveryIdentityKey({ reportCode: b.reportCode, fightId: b.fightId }),
  );
}

function mergeFieldPreferDefined<T>(a: T, b: T): T {
  if (a == null && b != null) return b;
  if (b == null && a != null) return a;
  return a;
}

function mergeDuplicateRows(preferred: DiscoverySourceRow, other: DiscoverySourceRow): DiscoverySourceRow {
  return {
    ...preferred,
    dungeonSlug: preferred.dungeonSlug ?? other.dungeonSlug,
    keyLevel: preferred.keyLevel ?? other.keyLevel,
    timed: preferred.timed ?? other.timed,
    runScore: preferred.runScore ?? other.runScore,
    completedAt: preferred.completedAt ?? other.completedAt,
    fightDurationMs: preferred.fightDurationMs ?? other.fightDurationMs,
    actorId: preferred.actorId ?? other.actorId,
    reportRevision: preferred.reportRevision ?? other.reportRevision,
    parsePercentile: mergeFieldPreferDefined(preferred.parsePercentile, other.parsePercentile),
    visibility: preferred.visibility ?? other.visibility,
    archivedOrGated: preferred.archivedOrGated === true || other.archivedOrGated === true,
    schemaUnsupported: preferred.schemaUnsupported === true || other.schemaUnsupported === true,
    rateDeferred: preferred.rateDeferred === true || other.rateDeferred === true,
    hardError: preferred.hardError === true || other.hardError === true,
    fightAccessible: preferred.fightAccessible ?? other.fightAccessible,
    identityResolution:
      preferred.identityResolution === "RESOLVED"
        ? preferred.identityResolution
        : other.identityResolution ?? preferred.identityResolution,
  };
}

function mergeRows(rows: DiscoverySourceRow[]): DiscoverySourceRow[] {
  const byKey = new Map<string, DiscoverySourceRow>();
  for (const row of rows) {
    const key = discoveryIdentityKey({ reportCode: row.reportCode, fightId: row.fightId });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const preferred = compareForRetention(row, existing) < 0 ? row : existing;
    const other = preferred === row ? existing : row;
    byKey.set(key, mergeDuplicateRows(preferred, other));
  }
  return [...byKey.values()];
}

function toPlanned(row: DiscoverySourceRow): PlannedDiscoveryCandidate {
  return {
    discoveryIdentity: { reportCode: row.reportCode, fightId: row.fightId },
    dungeonSlug: row.dungeonSlug,
    keyLevel: row.keyLevel,
    reportRevision: row.reportRevision,
    source: row.source,
    diagnostics: buildDiagnostics(row),
    factual: {
      timed: row.timed,
      runScore: row.runScore,
      completedAt: row.completedAt,
      fightDurationMs: row.fightDurationMs,
      actorId: row.actorId,
      parsePercentile: row.parsePercentile ?? null,
    },
  };
}

/**
 * Build a bounded discovery plan. Pure: no provider, Prisma, or queue I/O.
 * Does not order for selection and does not freeze slots.
 */
export function buildDiscoveryPlan(input: {
  zoneRankingCandidates?: DiscoverySourceRow[];
  parseRows?: DiscoverySourceRow[];
  recentReportCandidates?: DiscoverySourceRow[];
  persistedWclSources?: DiscoverySourceRow[];
  activeDungeonSlugs: readonly string[];
  bounds?: Partial<DiscoveryBounds>;
}): DiscoveryPlanResult {
  const bounds: DiscoveryBounds = { ...DEFAULT_DISCOVERY_BOUNDS, ...input.bounds };
  const active = new Set(input.activeDungeonSlugs);

  const merged = mergeRows([
    ...(input.zoneRankingCandidates ?? []),
    ...(input.parseRows ?? []),
    ...(input.recentReportCandidates ?? []),
    ...(input.persistedWclSources ?? []),
  ]);

  let privateOrHiddenSkipped = 0;
  const eligible = merged.filter((row) => {
    const access = resolveAccessState(row);
    if (access === "PRIVATE_OR_HIDDEN") {
      privateOrHiddenSkipped += 1;
      return false;
    }
    if (row.dungeonSlug != null && !active.has(row.dungeonSlug)) {
      return false;
    }
    return true;
  });

  // Stable retention order by identity — selection ordering is WS02.
  eligible.sort((a, b) =>
    discoveryIdentityKey({ reportCode: a.reportCode, fightId: a.fightId }).localeCompare(
      discoveryIdentityKey({ reportCode: b.reportCode, fightId: b.fightId }),
    ),
  );

  const perDungeonCounts = new Map<string, number>();
  const perDungeonTruncated = new Map<string, boolean>();
  const retained: DiscoverySourceRow[] = [];

  for (const row of eligible) {
    const dungeonKey = row.dungeonSlug ?? "__unknown__";
    const count = perDungeonCounts.get(dungeonKey) ?? 0;
    if (count >= bounds.maxPerDungeon) {
      perDungeonTruncated.set(dungeonKey, true);
      continue;
    }
    if (retained.length >= bounds.maxTotal) break;
    retained.push(row);
    perDungeonCounts.set(dungeonKey, count + 1);
  }

  const truncatedTotal = eligible.length > retained.length;

  const candidates = retained.map(toPlanned);

  const perDungeon: DungeonFallbackDepth[] = input.activeDungeonSlugs.map((slug) => {
    const retainedCount = perDungeonCounts.get(slug) ?? 0;
    return {
      dungeonSlug: slug,
      retainedCount,
      fallbackDepth: Math.max(0, retainedCount - bounds.targetSlotsPerDungeon),
      truncatedByBound: perDungeonTruncated.get(slug) === true,
    };
  });

  const hydrationGroups = groupCandidatesForHydration(candidates);

  return {
    candidates,
    perDungeon,
    hydrationGroups,
    totals: {
      inputCount: merged.length,
      retainedCount: candidates.length,
      truncatedTotal,
      privateOrHiddenSkipped,
    },
  };
}

/** Lazy hydration: group fight IDs by report code (batch-safe metadata). */
export function groupCandidatesForHydration(
  candidates: readonly PlannedDiscoveryCandidate[],
): ReportHydrationGroup[] {
  const byReport = new Map<string, ReportHydrationGroup>();
  for (const candidate of candidates) {
    const code = candidate.discoveryIdentity.reportCode;
    let group = byReport.get(code);
    if (!group) {
      group = { reportCode: code, fightIds: [], candidateKeys: [] };
      byReport.set(code, group);
    }
    if (!group.fightIds.includes(candidate.discoveryIdentity.fightId)) {
      group.fightIds.push(candidate.discoveryIdentity.fightId);
    }
    group.candidateKeys.push(discoveryIdentityKey(candidate.discoveryIdentity));
  }
  for (const group of byReport.values()) {
    group.fightIds.sort((a, b) => a - b);
    group.candidateKeys.sort((a, b) => a.localeCompare(b));
  }
  return [...byReport.values()].sort((a, b) => a.reportCode.localeCompare(b.reportCode));
}

/**
 * Map a hydrated discovery candidate into WS02-consumable factual metadata.
 * Requires a known dungeonSlug and positive keyLevel for the metadata schema.
 */
export function toCandidateMetadataV2(
  candidate: PlannedDiscoveryCandidate,
  overrides?: Partial<
    Pick<
      EvidenceCandidateMetadataV2,
      | "reportRevision"
      | "dungeonSlug"
      | "keyLevel"
      | "actorId"
      | "accessState"
      | "identityResolution"
      | "fightAccessible"
      | "hardError"
      | "evidenceCompleteness"
      | "timed"
      | "runScore"
      | "completedAt"
      | "fightDurationMs"
    >
  >,
): EvidenceCandidateMetadataV2 {
  const dungeonSlug = overrides?.dungeonSlug ?? candidate.dungeonSlug;
  const keyLevel = overrides?.keyLevel ?? candidate.keyLevel;
  if (dungeonSlug == null || dungeonSlug.length === 0) {
    throw new Error("toCandidateMetadataV2 requires dungeonSlug");
  }
  if (keyLevel == null || keyLevel <= 0) {
    throw new Error("toCandidateMetadataV2 requires positive keyLevel");
  }

  const reportRevision = overrides?.reportRevision ?? candidate.reportRevision;
  const actorId = overrides?.actorId ?? candidate.factual.actorId;
  const fightDurationMs = overrides?.fightDurationMs ?? candidate.factual.fightDurationMs;
  const accessState = overrides?.accessState ?? candidate.diagnostics.accessState;
  const identityResolution =
    overrides?.identityResolution ?? candidate.diagnostics.identityResolution;
  const fightAccessible = overrides?.fightAccessible ?? candidate.diagnostics.fightAccessible;
  const hardError = overrides?.hardError ?? candidate.diagnostics.hardError;

  const completeness =
    overrides?.evidenceCompleteness ??
    computeEvidenceCompleteness({
      reportRevision,
      actorId,
      fightDurationMs,
      accessState,
      identityResolution,
      fightAccessible,
      hardError,
    });

  return {
    discoveryIdentity: candidate.discoveryIdentity,
    reportRevision,
    dungeonSlug,
    keyLevel,
    timed: overrides?.timed ?? candidate.factual.timed,
    runScore: overrides?.runScore ?? candidate.factual.runScore,
    evidenceCompleteness: completeness,
    completedAt: overrides?.completedAt ?? candidate.factual.completedAt,
    fightDurationMs,
    actorId,
    accessState,
    identityResolution,
    fightAccessible,
    hardError,
    discoverySource: candidate.source,
    diagnosticsOnly: {
      parsePercentile: candidate.factual.parsePercentile,
    },
  };
}

export function computeEvidenceCompleteness(input: {
  reportRevision: number | null;
  actorId: number | null;
  fightDurationMs: number | null;
  accessState: EvidenceAccessState;
  identityResolution: EvidenceIdentityResolution;
  fightAccessible: boolean;
  hardError: boolean;
}): number {
  if (input.hardError) return 0;
  let score = 0;
  if (input.accessState === "PUBLIC") score += 0.25;
  if (input.fightAccessible) score += 0.2;
  if (input.identityResolution === "RESOLVED") score += 0.2;
  if (input.reportRevision != null) score += 0.15;
  if (input.actorId != null) score += 0.1;
  if (input.fightDurationMs != null && input.fightDurationMs > 0) score += 0.1;
  return Math.min(1, Math.round(score * 1000) / 1000);
}
