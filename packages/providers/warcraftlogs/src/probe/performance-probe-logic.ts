import { slugifyDungeonName } from "../discovery/report-hydration.js";
import { ENCOUNTER_DUNGEON_MAP } from "../discovery/run-discovery.js";
import type {
  PerformanceDungeonSummary,
  PerformanceGlobalSummary,
  PerformanceSpecRank,
  ProbeZoneEncounter,
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
 * WCL packs M+ completion time into the low 24 bits of |speed| / |fastestKill|
 * when those ranking fields are large signed integers (character summary encoding).
 * Plain positive durations under 2h are accepted as-is.
 */
export function decodeMplusCompletionTimeMs(value: unknown): number | null {
  const n = coerceFiniteNumber(value);
  if (n == null) return null;
  if (n > 0 && n <= 2 * 60 * 60 * 1000) return Math.trunc(n);

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
    rankPercent: coerceFiniteNumber(row.rankPercent),
    total: coerceFiniteNumber(row.total),
    partition: coerceFiniteNumber(row.partition),
  };
}

function mapDungeonRow(row: unknown): PerformanceDungeonSummary | null {
  if (!isRecord(row)) return null;
  // Parse-style discovery rows (report + fightID) are not character-summary rows.
  if (isRecord(row.report) && typeof row.fightID === "number") return null;

  const encounter = isRecord(row.encounter) ? row.encounter : null;
  const encounterId =
    coerceFiniteNumber(encounter?.id) ?? coerceFiniteNumber(row.encounterID);
  const encounterName =
    typeof encounter?.name === "string"
      ? encounter.name
      : typeof row.name === "string"
        ? row.name
        : null;

  const allStars = isRecord(row.allStars) ? row.allStars : null;
  const bestRank = isRecord(row.bestRank) ? row.bestRank : null;

  const ratingPoints =
    coerceFiniteNumber(allStars?.points) ??
    coerceFiniteNumber(row.bestAmount) ??
    coerceFiniteNumber(row.amount) ??
    coerceFiniteNumber(row.score);

  const bestPerformancePercentile =
    coerceFiniteNumber(row.rankPercent) ??
    coerceFiniteNumber(row.bestPercentile) ??
    coerceFiniteNumber(row.percentile);

  const medianPerformancePercentile =
    coerceFiniteNumber(row.medianPercent) ??
    coerceFiniteNumber(row.medianPercentile) ??
    coerceFiniteNumber(row.median);

  // Summary rows without any score/percentile signal are skipped.
  if (
    ratingPoints == null &&
    bestPerformancePercentile == null &&
    medianPerformancePercentile == null &&
    encounterId == null
  ) {
    return null;
  }

  const keystoneLevel =
    coerceFiniteNumber(bestRank?.ilvl) ??
    coerceFiniteNumber(row.bracket) ??
    coerceFiniteNumber(row.keystoneLevel);

  const completionTimeMs =
    decodeMplusCompletionTimeMs(bestRank?.duration) ??
    decodeMplusCompletionTimeMs(row.duration) ??
    decodeMplusCompletionTimeMs(row.fastestKill) ??
    decodeMplusCompletionTimeMs(bestRank?.speed);

  const specialization =
    (typeof row.bestSpec === "string" ? row.bestSpec : null) ??
    (typeof row.spec === "string" ? row.spec : null);

  // playerscore metric: bestAmount is rating points, not DPS. Keep DPS null unless a
  // distinct damage field is present (future metric variants).
  const bestDps =
    coerceFiniteNumber(row.bestDps) ??
    coerceFiniteNumber(row.dps) ??
    null;

  const loggedRunCount = Math.max(
    0,
    coerceFiniteNumber(row.totalKills) ?? coerceFiniteNumber(row.totalParses) ?? 0,
  );

  return {
    encounterId,
    encounterName,
    dungeonSlug: resolveDungeonSlug(encounterId, encounterName),
    keystoneLevel,
    completionTimeMs,
    loggedRunCount,
    ratingPoints,
    scoreRank: coerceFiniteNumber(allStars?.rank) ?? coerceFiniteNumber(row.rank),
    regionRank: coerceFiniteNumber(allStars?.regionRank),
    serverRank: coerceFiniteNumber(allStars?.serverRank),
    specialization,
    bestDps,
    bestPerformancePercentile,
    medianPerformancePercentile,
    lockedIn: typeof row.lockedIn === "boolean" ? row.lockedIn : null,
  };
}

export interface NormalizedZoneRankingsSummary {
  global: PerformanceGlobalSummary;
  dungeons: PerformanceDungeonSummary[];
}

/**
 * Normalize raw Character.zoneRankings JSON into the WCL Mythic+ character summary shape.
 * Permissive: unknown fields are ignored; missing dungeons are not invented.
 */
export function normalizeZoneRankingsSummary(
  raw: unknown,
): NormalizedZoneRankingsSummary {
  const empty: NormalizedZoneRankingsSummary = {
    global: {
      totalMythicPlusScore: null,
      bestPerformanceAverage: null,
      medianPerformanceAverage: null,
      totalLoggedRuns: 0,
      partition: null,
      metric: null,
      difficulty: null,
      zoneId: null,
      specRanks: [],
    },
    dungeons: [],
  };

  const parsed = parseJsonScalar(raw);
  if (!isRecord(parsed)) return empty;

  const rankings = Array.isArray(parsed.rankings) ? parsed.rankings : [];
  const dungeons: PerformanceDungeonSummary[] = [];
  for (const row of rankings) {
    const mapped = mapDungeonRow(row);
    if (mapped) dungeons.push(mapped);
  }

  // Prefer encounterId uniqueness; fall back to slug.
  const byKey = new Map<string, PerformanceDungeonSummary>();
  for (const dungeon of dungeons) {
    const key =
      dungeon.encounterId != null
        ? `id:${dungeon.encounterId}`
        : `slug:${dungeon.dungeonSlug ?? dungeon.encounterName ?? "unknown"}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, dungeon);
      continue;
    }
    const prevScore = prev.ratingPoints ?? 0;
    const nextScore = dungeon.ratingPoints ?? 0;
    if (
      nextScore > prevScore ||
      (nextScore === prevScore && dungeon.loggedRunCount > prev.loggedRunCount)
    ) {
      byKey.set(key, dungeon);
    }
  }

  const uniqueDungeons = [...byKey.values()].sort((a, b) =>
    (a.encounterName ?? "").localeCompare(b.encounterName ?? ""),
  );

  const allStarsRaw = Array.isArray(parsed.allStars) ? parsed.allStars : [];
  const specRanks = allStarsRaw
    .map(mapSpecRank)
    .filter((row): row is PerformanceSpecRank => row != null);

  const totalFromSpecs = specRanks.reduce((sum, s) => sum + (s.points ?? 0), 0);
  const totalFromDungeons = uniqueDungeons.reduce((sum, d) => sum + (d.ratingPoints ?? 0), 0);
  const totalMythicPlusScore =
    specRanks.length > 0 && totalFromSpecs > 0
      ? totalFromSpecs
      : totalFromDungeons > 0
        ? totalFromDungeons
        : coerceFiniteNumber(parsed.rankPercent) != null && uniqueDungeons.length === 0
          ? null
          : totalFromDungeons || null;

  const zoneId =
    coerceFiniteNumber(parsed.zone) ??
    (isRecord(parsed.zone) ? coerceFiniteNumber(parsed.zone.id) : null);

  return {
    global: {
      totalMythicPlusScore:
        totalMythicPlusScore != null && totalMythicPlusScore > 0
          ? totalMythicPlusScore
          : null,
      bestPerformanceAverage: coerceFiniteNumber(parsed.bestPerformanceAverage),
      medianPerformanceAverage: coerceFiniteNumber(parsed.medianPerformanceAverage),
      totalLoggedRuns: uniqueDungeons.reduce((sum, d) => sum + d.loggedRunCount, 0),
      partition: coerceFiniteNumber(parsed.partition),
      metric: typeof parsed.metric === "string" ? parsed.metric : null,
      difficulty: coerceFiniteNumber(parsed.difficulty),
      zoneId,
      specRanks,
    },
    dungeons: uniqueDungeons,
  };
}

export function collectUnavailableEncounters(
  encounters: ProbeZoneEncounter[],
  dungeons: PerformanceDungeonSummary[],
): Array<{
  encounterID: number;
  encounterName: string | null;
  dungeonSlug: string | null;
  reason: "no_zone_rankings_row";
}> {
  const present = new Set(
    dungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
  );
  return encounters
    .filter((encounter) => !present.has(encounter.id))
    .map((encounter) => ({
      encounterID: encounter.id,
      encounterName: encounter.name,
      dungeonSlug: encounter.dungeonSlug,
      reason: "no_zone_rankings_row" as const,
    }));
}

/** Pick the current partition id from worldData.partitions when available. */
export function resolveCurrentPartition(
  partitions: Array<{ id: number; name?: string | null }> | null | undefined,
  preferred?: number | null,
): number | null {
  if (preferred != null && Number.isInteger(preferred) && preferred > 0) return preferred;
  const rows = partitions ?? [];
  if (rows.length === 0) return null;
  // Prefer highest id as "current" when WCL lists historical partitions ascending.
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  return sorted[0]?.id ?? null;
}
