import { slugifyDungeonName } from "./dungeon-slug.js";
import { ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";
import type { ZoneRankingsPayload } from "./run-discovery.js";

/** Aggregate (non-parse) dungeon ranking row from WCL zoneRankings without compare:Parses. */
export interface WclDungeonAggregateRanking {
  dungeonSlug: string;
  dungeonName: string;
  encounterId: number | null;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number;
  specSlug: string | null;
  roleSlug: string | null;
  bestAmount: number | null;
}

export interface WclZoneRankingAggregates {
  zoneId: number | null;
  partition: number | null;
  metric: string | null;
  /** Payload-level averages from WCL (informational; scoring uses equal dungeon means). */
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
  dungeons: WclDungeonAggregateRanking[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isParseStyleRow(row: Record<string, unknown>): boolean {
  const report = row.report;
  if (!isRecord(report)) return false;
  return typeof report.code === "string" && typeof row.fightID === "number";
}

function resolveDungeonFromAggregate(row: Record<string, unknown>): {
  dungeonSlug: string;
  dungeonName: string;
  encounterId: number | null;
} | null {
  const encounter = row.encounter;
  let encounterId: number | null = asFiniteNumber(row.encounterID);
  let dungeonName: string | null = null;

  if (isRecord(encounter)) {
    encounterId = asFiniteNumber(encounter.id) ?? encounterId;
    if (typeof encounter.name === "string" && encounter.name.trim()) {
      dungeonName = encounter.name.trim();
    }
  }

  if (encounterId != null && ENCOUNTER_DUNGEON_MAP[encounterId]) {
    const slug = ENCOUNTER_DUNGEON_MAP[encounterId]!;
    return {
      dungeonSlug: slug,
      dungeonName: dungeonName ?? slug,
      encounterId,
    };
  }

  if (dungeonName) {
    return {
      dungeonSlug: slugifyDungeonName(dungeonName),
      dungeonName,
      encounterId,
    };
  }

  return null;
}

/**
 * Map WCL aggregate zoneRankings rows (encounter + rankPercent + medianPercent).
 * Ignores parse-style rows (report + fightID) used for run discovery.
 */
export function mapZoneRankingAggregates(
  payload: ZoneRankingsPayload | null | undefined,
): WclZoneRankingAggregates {
  const empty: WclZoneRankingAggregates = {
    zoneId: null,
    partition: null,
    metric: null,
    bestPerformanceAverage: null,
    medianPerformanceAverage: null,
    dungeons: [],
  };
  if (!payload) return empty;

  const zoneId =
    typeof payload.zone === "number"
      ? payload.zone
      : ((payload.zone as { id?: number } | null | undefined)?.id ?? null);

  const raw = payload as ZoneRankingsPayload & Record<string, unknown>;
  const dungeons: WclDungeonAggregateRanking[] = [];

  for (const row of payload.rankings ?? []) {
    if (!isRecord(row) || isParseStyleRow(row)) continue;
    const dungeon = resolveDungeonFromAggregate(row);
    if (!dungeon) continue;

    const best =
      asFiniteNumber(row.rankPercent) ??
      asFiniteNumber(row.bestPercentile) ??
      asFiniteNumber(row.percentile);
    const median =
      asFiniteNumber(row.medianPercent) ??
      asFiniteNumber(row.medianPercentile) ??
      asFiniteNumber(row.median);
    if (best == null && median == null) continue;

    dungeons.push({
      dungeonSlug: dungeon.dungeonSlug,
      dungeonName: dungeon.dungeonName,
      encounterId: dungeon.encounterId,
      bestParsePercentile: best,
      medianParsePercentile: median,
      loggedRunCount: Math.max(
        0,
        asFiniteNumber(row.totalKills) ?? asFiniteNumber(row.totalParses) ?? 0,
      ),
      specSlug: typeof row.spec === "string" ? row.spec : typeof row.bestSpec === "string" ? row.bestSpec : null,
      roleSlug: typeof row.role === "string" ? row.role : null,
      bestAmount: asFiniteNumber(row.bestAmount),
    });
  }

  // Dedupe by dungeon slug — keep the row with more logged runs / higher best.
  const bySlug = new Map<string, WclDungeonAggregateRanking>();
  for (const d of dungeons) {
    const prev = bySlug.get(d.dungeonSlug);
    if (!prev) {
      bySlug.set(d.dungeonSlug, d);
      continue;
    }
    if (
      d.loggedRunCount > prev.loggedRunCount ||
      (d.loggedRunCount === prev.loggedRunCount &&
        (d.bestParsePercentile ?? 0) > (prev.bestParsePercentile ?? 0))
    ) {
      bySlug.set(d.dungeonSlug, d);
    }
  }

  return {
    zoneId,
    partition: asFiniteNumber(raw.partition),
    metric: typeof payload.metric === "string" ? payload.metric : null,
    bestPerformanceAverage: asFiniteNumber(raw.bestPerformanceAverage),
    medianPerformanceAverage: asFiniteNumber(raw.medianPerformanceAverage),
    dungeons: [...bySlug.values()].sort((a, b) => a.dungeonSlug.localeCompare(b.dungeonSlug)),
  };
}

