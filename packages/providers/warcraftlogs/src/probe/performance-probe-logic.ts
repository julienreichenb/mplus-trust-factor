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

export const SPEED_FASTESTKILL_ENCODING_NOTE =
  "fastestKill/bestRank.speed are opaque signed ranking fields; " +
  "completionTimeMs is not emitted until encoding is verified against ReportFight.keystoneTime.";

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

export interface ScoreDungeonRow {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  keystoneLevel: number | null;
  displayedRunCount: number;
  ratingPoints: number | null;
  scoreRank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  scoreRankPercent: number | null;
  specialization: string | null;
  lockedIn: boolean | null;
  completion: RunCompletionMetadata;
}

export interface ThroughputDungeonRow {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  bestDps: number | null;
  bestExecutionPercentile: number | null;
  medianExecutionPercentile: number | null;
  throughputSampleCount: number | null;
  throughputBracket: number | null;
  itemLevelFilter: unknown;
  lockedIn: boolean | null;
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
    displayedRunCount: Math.max(
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

/**
 * Map a throughputRankings entry (Points & Damage page).
 * Live shape is an object keyed by encounterId with snake_case fields:
 *   best_per_second_amount, best_level, best_historical_percentile,
 *   median_historical_percentile, best_historical_low_parses
 */
export function mapThroughputDungeonRow(
  row: unknown,
  encounterIdHint?: number | null,
): ThroughputDungeonRow | null {
  if (!isRecord(row) || isParseStyleRow(row)) return null;
  const fromEncounter = extractEncounter(row);
  const encounterId = fromEncounter.encounterId ?? encounterIdHint ?? null;
  const encounterName = fromEncounter.encounterName;

  const bestExecutionPercentile =
    coerceFiniteNumber(row.best_historical_percentile) ??
    coerceFiniteNumber(row.rankPercent) ??
    coerceFiniteNumber(row.bestPercentile) ??
    coerceFiniteNumber(row.bestPercent) ??
    coerceFiniteNumber(row.percentile);

  const medianExecutionPercentile =
    coerceFiniteNumber(row.median_historical_percentile) ??
    coerceFiniteNumber(row.medianPercent) ??
    coerceFiniteNumber(row.medianPercentile) ??
    coerceFiniteNumber(row.median);

  const bestDps =
    coerceFiniteNumber(row.best_per_second_amount) ??
    coerceFiniteNumber(row.bestAmount) ??
    coerceFiniteNumber(row.amount) ??
    coerceFiniteNumber(row.dps) ??
    coerceFiniteNumber(row.bestDps);

  const throughputSampleCount =
    coerceFiniteNumber(row.totalKills) ??
    coerceFiniteNumber(row.totalParses) ??
    coerceFiniteNumber(row.sampleSize) ??
    coerceFiniteNumber(row.parses) ??
    coerceFiniteNumber(row.throughputSampleCount);

  const throughputBracket =
    coerceFiniteNumber(row.best_level) ??
    coerceFiniteNumber(row.bracket) ??
    coerceFiniteNumber(row.ilvl) ??
    coerceFiniteNumber(row.keystoneLevel) ??
    (isRecord(row.bestRank) ? coerceFiniteNumber(row.bestRank.ilvl) : null);

  const itemLevelFilter = {
    bestHistoricalLowParses:
      typeof row.best_historical_low_parses === "boolean"
        ? row.best_historical_low_parses
        : null,
    itemLevel: row.itemLevel ?? row.ilvlFilter ?? row.itemLevelFilter ?? null,
  };

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
    throughputSampleCount,
    throughputBracket,
    itemLevelFilter,
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

/** Arithmetic mean of finite numbers; null when empty. */
export function arithmeticMean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export interface NormalizedPointsAndDamage {
  totalMythicPlusScore: number | null;
  partition: number | null;
  zoneId: number | null;
  totalLoggedRuns: number;
  wclBestPerformanceAverage: number | null;
  wclMedianPerformanceAverage: number | null;
  itemLevelFilter: { difficulty: number | null; size: number | null } | null;
  specRanks: PerformanceSpecRank[];
  scoreDungeons: ScoreDungeonRow[];
  throughputDungeons: ThroughputDungeonRow[];
  /** Raw top-level keys observed (for diagnostics). */
  payloadTopKeys: string[];
}

/**
 * Normalize raw points_and_damage zoneRankings.
 * Score rows come from rankings; throughput from throughputRankings (never from standalone dps).
 */
export function normalizePointsAndDamage(raw: unknown): NormalizedPointsAndDamage {
  const empty: NormalizedPointsAndDamage = {
    totalMythicPlusScore: null,
    partition: null,
    zoneId: null,
    totalLoggedRuns: 0,
    wclBestPerformanceAverage: null,
    wclMedianPerformanceAverage: null,
    itemLevelFilter: null,
    specRanks: [],
    scoreDungeons: [],
    throughputDungeons: [],
    payloadTopKeys: [],
  };

  const parsed = parseJsonScalar(raw);
  if (!isRecord(parsed)) return empty;

  const payloadTopKeys = Object.keys(parsed);

  const scoreMapped = (Array.isArray(parsed.rankings) ? parsed.rankings : [])
    .map(mapScoreDungeonRow)
    .filter((r): r is ScoreDungeonRow => r != null);
  const scoreById = dedupeByEncounterId(scoreMapped, (a, b) =>
    (b.ratingPoints ?? 0) > (a.ratingPoints ?? 0) ? b : a,
  );
  const scoreDungeons = [...scoreById.values()].sort((a, b) =>
    (a.encounterName ?? "").localeCompare(b.encounterName ?? ""),
  );

  // Live WCL: throughputRankings is a map keyed by encounterId string.
  // Also accept an array form defensively.
  const throughputMapped: ThroughputDungeonRow[] = [];
  const throughputRaw = parsed.throughputRankings ?? parsed.damageRankings ?? parsed.throughput;
  if (Array.isArray(throughputRaw)) {
    for (const row of throughputRaw) {
      const mapped = mapThroughputDungeonRow(row);
      if (mapped) throughputMapped.push(mapped);
    }
  } else if (isRecord(throughputRaw)) {
    for (const [key, row] of Object.entries(throughputRaw)) {
      const idHint = coerceFiniteNumber(key);
      const mapped = mapThroughputDungeonRow(row, idHint);
      if (mapped) {
        // Prefer encounter name from matching score row when map form omits encounter.
        if (mapped.encounterName == null && mapped.encounterId != null) {
          const score = scoreById.get(mapped.encounterId);
          if (score) {
            mapped.encounterName = score.encounterName;
            mapped.dungeonSlug = score.dungeonSlug ?? mapped.dungeonSlug;
          }
        }
        throughputMapped.push(mapped);
      }
    }
  }

  const throughputById = dedupeByEncounterId(throughputMapped, (a, b) =>
    (b.bestExecutionPercentile ?? 0) > (a.bestExecutionPercentile ?? 0) ? b : a,
  );
  const throughputDungeons = [...throughputById.values()].sort((a, b) =>
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
    totalLoggedRuns: scoreDungeons.reduce((sum, d) => sum + d.displayedRunCount, 0),
    wclBestPerformanceAverage: coerceFiniteNumber(parsed.bestPerformanceAverage),
    wclMedianPerformanceAverage: coerceFiniteNumber(parsed.medianPerformanceAverage),
    itemLevelFilter: {
      difficulty: coerceFiniteNumber(parsed.difficulty),
      size: coerceFiniteNumber(parsed.size),
    },
    specRanks,
    scoreDungeons,
    throughputDungeons,
    payloadTopKeys,
  };
}

export interface MergedPointsAndDamageSummary {
  global: PerformanceGlobalSummary;
  dungeons: PerformanceDungeonSummary[];
}

export function mergePointsAndDamage(
  normalized: NormalizedPointsAndDamage,
): MergedPointsAndDamageSummary {
  const throughputById = new Map(
    normalized.throughputDungeons
      .filter((d) => d.encounterId != null)
      .map((d) => [d.encounterId!, d] as const),
  );

  const dungeons: PerformanceDungeonSummary[] = normalized.scoreDungeons.map((s) => {
    const t = s.encounterId != null ? throughputById.get(s.encounterId) : undefined;
    return {
      encounterId: s.encounterId,
      encounterName: s.encounterName,
      dungeonSlug: s.dungeonSlug,
      keystoneLevel: s.keystoneLevel,
      displayedRunCount: s.displayedRunCount,
      throughputSampleCount: t?.throughputSampleCount ?? null,
      throughputBracket: t?.throughputBracket ?? s.keystoneLevel,
      itemLevelFilter: t?.itemLevelFilter ?? null,
      ratingPoints: s.ratingPoints,
      scoreRank: s.scoreRank,
      regionRank: s.regionRank,
      serverRank: s.serverRank,
      scoreRankPercent: s.scoreRankPercent,
      specialization: s.specialization,
      bestDps: t?.bestDps ?? null,
      bestExecutionPercentile: t?.bestExecutionPercentile ?? null,
      medianExecutionPercentile: t?.medianExecutionPercentile ?? null,
      lockedIn: s.lockedIn ?? t?.lockedIn ?? null,
      completion: s.completion,
    };
  });

  for (const t of normalized.throughputDungeons) {
    if (t.encounterId == null) continue;
    if (dungeons.some((d) => d.encounterId === t.encounterId)) continue;
    dungeons.push({
      encounterId: t.encounterId,
      encounterName: t.encounterName,
      dungeonSlug: t.dungeonSlug,
      keystoneLevel: t.throughputBracket,
      displayedRunCount: 0,
      throughputSampleCount: t.throughputSampleCount,
      throughputBracket: t.throughputBracket,
      itemLevelFilter: t.itemLevelFilter,
      ratingPoints: null,
      scoreRank: null,
      regionRank: null,
      serverRank: null,
      scoreRankPercent: null,
      specialization: null,
      bestDps: t.bestDps,
      bestExecutionPercentile: t.bestExecutionPercentile,
      medianExecutionPercentile: t.medianExecutionPercentile,
      lockedIn: t.lockedIn,
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

  const bestDpsPercentileAverage = arithmeticMean(
    dungeons.map((d) => d.bestExecutionPercentile),
  );
  const medianDpsPercentileAverage = arithmeticMean(
    dungeons.map((d) => d.medianExecutionPercentile),
  );

  return {
    global: {
      totalMythicPlusScore: normalized.totalMythicPlusScore,
      bestDpsPercentileAverage,
      medianDpsPercentileAverage,
      wclBestPerformanceAverage: normalized.wclBestPerformanceAverage,
      wclMedianPerformanceAverage: normalized.wclMedianPerformanceAverage,
      totalLoggedRuns: normalized.totalLoggedRuns,
      partition: normalized.partition,
      zoneId: normalized.zoneId,
      metric: "points_and_damage",
      itemLevelFilter: normalized.itemLevelFilter,
      specRanks: normalized.specRanks,
    },
    dungeons,
  };
}

export function collectUnavailableEncounters(
  encounters: ProbeZoneEncounter[],
  scoreIds: Set<number>,
  throughputIds: Set<number>,
): Array<{
  encounterID: number;
  encounterName: string | null;
  dungeonSlug: string | null;
  reason: "no_score_row" | "no_throughput_row" | "no_zone_rankings_row";
}> {
  const out: Array<{
    encounterID: number;
    encounterName: string | null;
    dungeonSlug: string | null;
    reason: "no_score_row" | "no_throughput_row" | "no_zone_rankings_row";
  }> = [];

  for (const encounter of encounters) {
    const hasScore = scoreIds.has(encounter.id);
    const hasThroughput = throughputIds.has(encounter.id);
    if (hasScore && hasThroughput) continue;
    if (!hasScore && !hasThroughput) {
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
        reason: "no_throughput_row",
      });
    }
  }
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
