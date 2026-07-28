import { slugifyDungeonName } from "../discovery/report-hydration.js";
import { ENCOUNTER_DUNGEON_MAP } from "../discovery/run-discovery.js";
import type {
  PerformanceDungeonSummary,
  PerformanceGlobalSummary,
  PerformanceSpecRank,
  ProbeZoneEncounter,
  RunCompletionMetadata,
} from "./types.js";

export function parseJsonScalar<T = unknown>(value: unknown): T | unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value;
    }
  }
  return value;
}

export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Investigation notes: WCL playerscore zoneRankings `fastestKill` / `bestRank.speed`
 *
 * Observed (Wallidrixe, zone 47, partition 1, metric playerscore):
 * - Both fields are large negative integers (e.g. fastestKill ≈ -438e6, speed ≈ -878e6).
 * - For most dungeons: speed - fastestKill === -440_000_000 (constant).
 * - Windrunner Spire had fastestKill === speed (both ≈ -878e6) — not a plain duration.
 * - Low-24-bit decode of |fastestKill| yields ~30–37 min values that LOOK plausible for +22
 *   keys, but fail cross-check against ReportFight.keystoneTime for the same character:
 *     Algeth'ar Academy: fight keystoneTime 1_813_086 (30:13) vs |fk|&0xffffff = 1_979_298 (32:59)
 *     Skyreach:          fight keystoneTime 1_557_871 (25:57) vs |fk|&0xffffff = 2_234_513 (37:14)
 * - WCL zone ranking HTML lists durations as plain positive ms (e.g. "1855296$30:55"),
 *   but that field is not present on character zoneRankings aggregate JSON rows.
 * - Real M+ completion time for a fight is ReportFight.keystoneTime — intentionally not
 *   fetched by this Performance probe (no report/fight/event fan-out).
 *
 * Conclusion: do not emit completionTimeMs from fastestKill/speed until WCL documents
 * or we verify a packing formula against keystoneTime. Preserve raw metadata only.
 */
export const SPEED_FASTESTKILL_ENCODING_NOTE =
  "fastestKill/bestRank.speed are opaque signed ranking fields on playerscore zoneRankings; " +
  "low-24-bit and similar heuristics disagree with ReportFight.keystoneTime. " +
  "completionTimeMs is not emitted until encoding is verified.";

export function buildRunCompletionMetadata(row: Record<string, unknown>): RunCompletionMetadata {
  const bestRank = isRecord(row.bestRank) ? row.bestRank : null;
  return {
    fastestKillRaw: coerceFiniteNumber(row.fastestKill),
    speedRaw: coerceFiniteNumber(bestRank?.speed),
    fightMetadataRaw: coerceFiniteNumber(bestRank?.fight_metadata),
    leaderboardRaw: coerceFiniteNumber(bestRank?.leaderboard),
    affixesRaw: coerceFiniteNumber(bestRank?.affixes),
    completionTimeMs: null,
    encodingStatus: "unverified_not_emitted",
    encodingNote: SPEED_FASTESTKILL_ENCODING_NOTE,
  };
}

/**
 * @deprecated Do not use for emitted completionTimeMs — retained only so tests can
 * assert the heuristic is incorrect vs real keystoneTime.
 */
export function experimentalLow24BitDurationMs(value: unknown): number | null {
  const n = coerceFiniteNumber(value);
  if (n == null) return null;
  const packedMs = Math.abs(Math.trunc(n)) & 0xffffff;
  if (packedMs >= 60_000 && packedMs <= 2 * 60 * 60 * 1000) return packedMs;
  return null;
}

export function buildZoneEncounters(
  worldEncounters: Array<{ id: number; name?: string | null }> | null | undefined,
): ProbeZoneEncounter[] {
  const rows = worldEncounters ?? [];
  if (rows.length > 0) {
    return rows.map((encounter) => ({
      id: encounter.id,
      name: encounter.name ?? null,
      dungeonSlug:
        ENCOUNTER_DUNGEON_MAP[encounter.id] ??
        (encounter.name ? slugifyDungeonName(encounter.name) : null),
    }));
  }
  return Object.entries(ENCOUNTER_DUNGEON_MAP).map(([id, dungeonSlug]) => ({
    id: Number(id),
    name: null,
    dungeonSlug,
  }));
}

function resolveDungeonSlug(encounterId: number | null, encounterName: string | null): string | null {
  if (encounterId != null && ENCOUNTER_DUNGEON_MAP[encounterId]) {
    return ENCOUNTER_DUNGEON_MAP[encounterId]!;
  }
  if (encounterName) return slugifyDungeonName(encounterName);
  return null;
}

function mapSpecRank(row: unknown): PerformanceSpecRank | null {
  if (!isRecord(row)) return null;
  return {
    spec: typeof row.spec === "string" ? row.spec : null,
    points: coerceFiniteNumber(row.points),
    possiblePoints: coerceFiniteNumber(row.possiblePoints),
    rank: coerceFiniteNumber(row.rank),
    regionRank: coerceFiniteNumber(row.regionRank),
    serverRank: coerceFiniteNumber(row.serverRank),
    scoreRankPercent: coerceFiniteNumber(row.rankPercent),
    total: coerceFiniteNumber(row.total),
    partition: coerceFiniteNumber(row.partition),
  };
}

export interface ScoreDungeonRow {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  keystoneLevel: number | null;
  loggedRunCount: number;
  ratingPoints: number | null;
  scoreRank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  scoreRankPercent: number | null;
  specialization: string | null;
  lockedIn: boolean | null;
  completion: RunCompletionMetadata;
}

export interface ExecutionDungeonRow {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  bestDps: number | null;
  bestExecutionPercentile: number | null;
  medianExecutionPercentile: number | null;
  lockedIn: boolean | null;
}

function extractEncounter(row: Record<string, unknown>): {
  encounterId: number | null;
  encounterName: string | null;
} {
  const encounter = isRecord(row.encounter) ? row.encounter : null;
  return {
    encounterId: coerceFiniteNumber(encounter?.id) ?? coerceFiniteNumber(row.encounterID),
    encounterName:
      typeof encounter?.name === "string"
        ? encounter.name
        : typeof row.name === "string"
          ? row.name
          : null,
  };
}

function isParseStyleRow(row: Record<string, unknown>): boolean {
  return isRecord(row.report) && typeof row.fightID === "number";
}

export function mapScoreDungeonRow(row: unknown): ScoreDungeonRow | null {
  if (!isRecord(row) || isParseStyleRow(row)) return null;
  const { encounterId, encounterName } = extractEncounter(row);
  const allStars = isRecord(row.allStars) ? row.allStars : null;
  const bestRank = isRecord(row.bestRank) ? row.bestRank : null;

  const ratingPoints =
    coerceFiniteNumber(allStars?.points) ??
    coerceFiniteNumber(row.bestAmount) ??
    coerceFiniteNumber(row.amount) ??
    coerceFiniteNumber(row.score);

  if (encounterId == null && ratingPoints == null) return null;

  return {
    encounterId,
    encounterName,
    dungeonSlug: resolveDungeonSlug(encounterId, encounterName),
    keystoneLevel:
      coerceFiniteNumber(bestRank?.ilvl) ??
      coerceFiniteNumber(row.bracket) ??
      coerceFiniteNumber(row.keystoneLevel),
    loggedRunCount: Math.max(
      0,
      coerceFiniteNumber(row.totalKills) ?? coerceFiniteNumber(row.totalParses) ?? 0,
    ),
    ratingPoints,
    scoreRank: coerceFiniteNumber(allStars?.rank) ?? coerceFiniteNumber(row.rank),
    regionRank: coerceFiniteNumber(allStars?.regionRank),
    serverRank: coerceFiniteNumber(allStars?.serverRank),
    scoreRankPercent:
      coerceFiniteNumber(allStars?.rankPercent) ?? coerceFiniteNumber(row.rankPercent),
    specialization:
      (typeof row.bestSpec === "string" ? row.bestSpec : null) ??
      (typeof row.spec === "string" ? row.spec : null),
    lockedIn: typeof row.lockedIn === "boolean" ? row.lockedIn : null,
    completion: buildRunCompletionMetadata(row),
  };
}

export function mapExecutionDungeonRow(row: unknown): ExecutionDungeonRow | null {
  if (!isRecord(row) || isParseStyleRow(row)) return null;
  const { encounterId, encounterName } = extractEncounter(row);

  const bestExecutionPercentile =
    coerceFiniteNumber(row.rankPercent) ??
    coerceFiniteNumber(row.bestPercentile) ??
    coerceFiniteNumber(row.percentile);
  const medianExecutionPercentile =
    coerceFiniteNumber(row.medianPercent) ??
    coerceFiniteNumber(row.medianPercentile) ??
    coerceFiniteNumber(row.median);
  const bestDps =
    coerceFiniteNumber(row.bestAmount) ??
    coerceFiniteNumber(row.amount) ??
    coerceFiniteNumber(row.dps);

  if (
    encounterId == null &&
    bestDps == null &&
    bestExecutionPercentile == null &&
    medianExecutionPercentile == null
  ) {
    return null;
  }

  return {
    encounterId,
    encounterName,
    dungeonSlug: resolveDungeonSlug(encounterId, encounterName),
    bestDps,
    bestExecutionPercentile,
    medianExecutionPercentile,
    lockedIn: typeof row.lockedIn === "boolean" ? row.lockedIn : null,
  };
}

function dedupeByEncounterId<T extends { encounterId: number | null }>(
  rows: T[],
  prefer: (a: T, b: T) => T,
): Map<number, T> {
  const byId = new Map<number, T>();
  for (const row of rows) {
    if (row.encounterId == null) continue;
    const prev = byId.get(row.encounterId);
    byId.set(row.encounterId, prev ? prefer(prev, row) : row);
  }
  return byId;
}

export interface NormalizedScorePayload {
  totalMythicPlusScore: number | null;
  partition: number | null;
  zoneId: number | null;
  totalLoggedRuns: number;
  specRanks: PerformanceSpecRank[];
  dungeons: ScoreDungeonRow[];
}

export interface NormalizedExecutionPayload {
  bestDpsPercentileAverage: number | null;
  medianDpsPercentileAverage: number | null;
  partition: number | null;
  zoneId: number | null;
  dungeons: ExecutionDungeonRow[];
}

export function normalizeScoreZoneRankings(raw: unknown): NormalizedScorePayload {
  const empty: NormalizedScorePayload = {
    totalMythicPlusScore: null,
    partition: null,
    zoneId: null,
    totalLoggedRuns: 0,
    specRanks: [],
    dungeons: [],
  };
  const parsed = parseJsonScalar(raw);
  if (!isRecord(parsed)) return empty;

  const mapped = (Array.isArray(parsed.rankings) ? parsed.rankings : [])
    .map(mapScoreDungeonRow)
    .filter((r): r is ScoreDungeonRow => r != null);

  const byId = dedupeByEncounterId(mapped, (a, b) =>
    (b.ratingPoints ?? 0) > (a.ratingPoints ?? 0) ? b : a,
  );
  const dungeons = [...byId.values()].sort((a, b) =>
    (a.encounterName ?? "").localeCompare(b.encounterName ?? ""),
  );

  const specRanks = (Array.isArray(parsed.allStars) ? parsed.allStars : [])
    .map(mapSpecRank)
    .filter((r): r is PerformanceSpecRank => r != null);

  const totalFromSpecs = specRanks.reduce((sum, s) => sum + (s.points ?? 0), 0);

  return {
    totalMythicPlusScore: totalFromSpecs > 0 ? totalFromSpecs : null,
    partition: coerceFiniteNumber(parsed.partition),
    zoneId:
      coerceFiniteNumber(parsed.zone) ??
      (isRecord(parsed.zone) ? coerceFiniteNumber(parsed.zone.id) : null),
    totalLoggedRuns: dungeons.reduce((sum, d) => sum + d.loggedRunCount, 0),
    specRanks,
    dungeons,
  };
}

export function normalizeExecutionZoneRankings(raw: unknown): NormalizedExecutionPayload {
  const empty: NormalizedExecutionPayload = {
    bestDpsPercentileAverage: null,
    medianDpsPercentileAverage: null,
    partition: null,
    zoneId: null,
    dungeons: [],
  };
  const parsed = parseJsonScalar(raw);
  if (!isRecord(parsed)) return empty;

  const mapped = (Array.isArray(parsed.rankings) ? parsed.rankings : [])
    .map(mapExecutionDungeonRow)
    .filter((r): r is ExecutionDungeonRow => r != null);

  const byId = dedupeByEncounterId(mapped, (a, b) =>
    (b.bestExecutionPercentile ?? 0) > (a.bestExecutionPercentile ?? 0) ? b : a,
  );
  const dungeons = [...byId.values()].sort((a, b) =>
    (a.encounterName ?? "").localeCompare(b.encounterName ?? ""),
  );

  return {
    bestDpsPercentileAverage: coerceFiniteNumber(parsed.bestPerformanceAverage),
    medianDpsPercentileAverage: coerceFiniteNumber(parsed.medianPerformanceAverage),
    partition: coerceFiniteNumber(parsed.partition),
    zoneId:
      coerceFiniteNumber(parsed.zone) ??
      (isRecord(parsed.zone) ? coerceFiniteNumber(parsed.zone.id) : null),
    dungeons,
  };
}

export interface MergedZoneRankingsSummary {
  global: PerformanceGlobalSummary;
  dungeons: PerformanceDungeonSummary[];
}

/**
 * Merge playerscore + dps zoneRankings by encounter.id.
 * Score fields come only from playerscore; execution fields only from dps.
 */
export function mergeScoreAndExecution(
  score: NormalizedScorePayload,
  execution: NormalizedExecutionPayload,
): MergedZoneRankingsSummary {
  const execById = new Map(
    execution.dungeons
      .filter((d) => d.encounterId != null)
      .map((d) => [d.encounterId!, d] as const),
  );

  const dungeons: PerformanceDungeonSummary[] = score.dungeons.map((s) => {
    const e = s.encounterId != null ? execById.get(s.encounterId) : undefined;
    return {
      encounterId: s.encounterId,
      encounterName: s.encounterName,
      dungeonSlug: s.dungeonSlug,
      keystoneLevel: s.keystoneLevel,
      loggedRunCount: s.loggedRunCount,
      ratingPoints: s.ratingPoints,
      scoreRank: s.scoreRank,
      regionRank: s.regionRank,
      serverRank: s.serverRank,
      scoreRankPercent: s.scoreRankPercent,
      specialization: s.specialization,
      bestDps: e?.bestDps ?? null,
      bestExecutionPercentile: e?.bestExecutionPercentile ?? null,
      medianExecutionPercentile: e?.medianExecutionPercentile ?? null,
      lockedIn: s.lockedIn ?? e?.lockedIn ?? null,
      completion: s.completion,
    };
  });

  // Include execution-only encounters (no score row) so merge is complete.
  for (const e of execution.dungeons) {
    if (e.encounterId == null) continue;
    if (dungeons.some((d) => d.encounterId === e.encounterId)) continue;
    dungeons.push({
      encounterId: e.encounterId,
      encounterName: e.encounterName,
      dungeonSlug: e.dungeonSlug,
      keystoneLevel: null,
      loggedRunCount: 0,
      ratingPoints: null,
      scoreRank: null,
      regionRank: null,
      serverRank: null,
      scoreRankPercent: null,
      specialization: null,
      bestDps: e.bestDps,
      bestExecutionPercentile: e.bestExecutionPercentile,
      medianExecutionPercentile: e.medianExecutionPercentile,
      lockedIn: e.lockedIn,
      completion: {
        fastestKillRaw: null,
        speedRaw: null,
        fightMetadataRaw: null,
        leaderboardRaw: null,
        affixesRaw: null,
        completionTimeMs: null,
        encodingStatus: "unverified_not_emitted",
        encodingNote: SPEED_FASTESTKILL_ENCODING_NOTE,
      },
    });
  }

  dungeons.sort((a, b) => (a.encounterName ?? "").localeCompare(b.encounterName ?? ""));

  return {
    global: {
      totalMythicPlusScore: score.totalMythicPlusScore,
      bestDpsPercentileAverage: execution.bestDpsPercentileAverage,
      medianDpsPercentileAverage: execution.medianDpsPercentileAverage,
      totalLoggedRuns: score.totalLoggedRuns,
      partition: score.partition ?? execution.partition,
      zoneId: score.zoneId ?? execution.zoneId,
      scoreMetric: "playerscore",
      executionMetric: "dps",
      specRanks: score.specRanks,
    },
    dungeons,
  };
}

export function collectUnavailableEncounters(
  encounters: ProbeZoneEncounter[],
  dungeons: PerformanceDungeonSummary[],
  scoreIds: Set<number>,
  executionIds: Set<number>,
): Array<{
  encounterID: number;
  encounterName: string | null;
  dungeonSlug: string | null;
  reason: "no_score_row" | "no_execution_row" | "no_zone_rankings_row";
}> {
  const out: Array<{
    encounterID: number;
    encounterName: string | null;
    dungeonSlug: string | null;
    reason: "no_score_row" | "no_execution_row" | "no_zone_rankings_row";
  }> = [];

  for (const encounter of encounters) {
    const hasScore = scoreIds.has(encounter.id);
    const hasExec = executionIds.has(encounter.id);
    if (hasScore && hasExec) continue;
    if (!hasScore && !hasExec) {
      out.push({
        encounterID: encounter.id,
        encounterName: encounter.name,
        dungeonSlug: encounter.dungeonSlug,
        reason: "no_zone_rankings_row",
      });
    } else if (!hasScore) {
      out.push({
        encounterID: encounter.id,
        encounterName: encounter.name,
        dungeonSlug: encounter.dungeonSlug,
        reason: "no_score_row",
      });
    } else {
      out.push({
        encounterID: encounter.id,
        encounterName: encounter.name,
        dungeonSlug: encounter.dungeonSlug,
        reason: "no_execution_row",
      });
    }
  }
  void dungeons;
  return out;
}

export function resolveCurrentPartition(
  partitions: Array<{ id: number; name?: string | null }> | null | undefined,
  preferred?: number | null,
): number | null {
  if (preferred != null && Number.isInteger(preferred) && preferred > 0) return preferred;
  const rows = partitions ?? [];
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  return sorted[0]?.id ?? null;
}
