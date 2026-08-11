/**
 * Character.encounterRankings — per-dungeon M+ run lists for discovery.
 *
 * Preferred over recentReports → mass report hydration when active-season
 * encounter IDs are known. Payload is a JSON scalar with `ranks[]`.
 */
import type { WclRankingObservation, WclRunCandidate } from "../types.js";
import {
  TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON,
} from "./bounds.js";
import { ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";
import type { ZoneRankingsPayload } from "./run-discovery.js";

/** Reverse of ENCOUNTER_DUNGEON_MAP for active-season slug → encounter ID. */
export const DUNGEON_ENCOUNTER_MAP: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(ENCOUNTER_DUNGEON_MAP).map(([id, slug]) => [slug, Number(id)]),
  ),
);

export interface EncounterRankingsPayload {
  bestAmount?: number | null;
  medianPerformance?: number | null;
  averagePerformance?: number | null;
  totalKills?: number | null;
  fastestKill?: number | null;
  difficulty?: number | null;
  metric?: string | null;
  partition?: number | null;
  zone?: number | { id: number } | null;
  ranks?: unknown[];
}

export interface EncounterRankRow {
  lockedIn?: boolean | null;
  rankPercent?: number | null;
  historicalPercent?: number | null;
  todayPercent?: number | null;
  report?: {
    code?: string | null;
    startTime?: number | null;
    fightID?: number | null;
  } | null;
  duration?: number | null;
  startTime?: number | null;
  amount?: number | null;
  /** M+ key level on character encounter ranking rows. */
  bracketData?: number | null;
  bracket?: number | null;
  spec?: string | null;
  medal?: string | null;
  score?: number | null;
  leaderboard?: number | null;
  affixes?: number[] | null;
}

/**
 * Derive timed tri-state from WCL M+ medal on encounter ranking rows.
 * bronze/silver/gold ⇒ timed; none ⇒ depleted; unknown medal ⇒ null.
 */
export function timedFromMedal(medal: string | null | undefined): boolean | null {
  if (medal == null) return null;
  const m = medal.trim().toLowerCase();
  if (m === "bronze" || m === "silver" || m === "gold") return true;
  if (m === "none" || m === "" || m === "depleted") return false;
  return null;
}

export function resolveEncounterIdForDungeon(dungeonSlug: string): number | null {
  const slug = dungeonSlug.trim().toLowerCase();
  const id = DUNGEON_ENCOUNTER_MAP[slug];
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

export class MissingDungeonEncounterMappingError extends Error {
  readonly code = "MISSING_DUNGEON_ENCOUNTER_MAPPING" as const;
  readonly missingDungeonSlugs: string[];

  constructor(missingDungeonSlugs: readonly string[]) {
    const missing = [...missingDungeonSlugs];
    super(
      `MISSING_DUNGEON_ENCOUNTER_MAPPING: no WCL encounter ID for dungeon(s): ${missing.join(", ")}`,
    );
    this.name = "MissingDungeonEncounterMappingError";
    this.missingDungeonSlugs = missing;
  }
}

export type ActiveDungeonEncounterBinding = {
  dungeonSlug: string;
  encounterId: number;
};

/**
 * Resolve encounter IDs for every active-season dungeon.
 * Prefers authoritative SeasonDungeon bindings; falls back to the static
 * catalog reverse-map only for unbound slugs. Never silently drops a dungeon.
 */
export function requireActiveDungeonEncounters(input: {
  activeDungeonSlugs: readonly string[];
  /** Authoritative bindings from SeasonDungeon (may omit some slugs). */
  authoritativeEncounters?: ReadonlyArray<{
    dungeonSlug: string;
    encounterId: number | null;
  }>;
  catalogBySlug?: Readonly<Record<string, number>>;
}): ActiveDungeonEncounterBinding[] {
  const catalog = input.catalogBySlug ?? DUNGEON_ENCOUNTER_MAP;
  const authBySlug = new Map<string, number | null>();
  for (const row of input.authoritativeEncounters ?? []) {
    const slug = row.dungeonSlug.trim().toLowerCase();
    if (!slug) continue;
    authBySlug.set(slug, row.encounterId);
  }

  const out: ActiveDungeonEncounterBinding[] = [];
  const missing: string[] = [];
  const seenEncounterIds = new Set<number>();

  for (const raw of input.activeDungeonSlugs) {
    const dungeonSlug = raw.trim().toLowerCase();
    if (!dungeonSlug) continue;

    let encounterId: number | null = null;
    if (authBySlug.has(dungeonSlug)) {
      const authId = authBySlug.get(dungeonSlug) ?? null;
      encounterId =
        typeof authId === "number" && Number.isFinite(authId) && authId > 0 ? authId : null;
    }
    if (encounterId == null) {
      const catalogId = catalog[dungeonSlug];
      encounterId =
        typeof catalogId === "number" && Number.isFinite(catalogId) && catalogId > 0
          ? catalogId
          : null;
    }

    if (encounterId == null) {
      missing.push(dungeonSlug);
      continue;
    }
    if (seenEncounterIds.has(encounterId)) {
      throw new MissingDungeonEncounterMappingError([
        ...missing,
        dungeonSlug,
        `(duplicate encounterId ${encounterId})`,
      ]);
    }
    seenEncounterIds.add(encounterId);
    out.push({ dungeonSlug, encounterId });
  }

  if (missing.length > 0) {
    throw new MissingDungeonEncounterMappingError(missing);
  }
  return out;
}

/**
 * @deprecated Prefer {@link requireActiveDungeonEncounters} — this helper
 * silently skipped unmapped dungeons and must not be used for production pools.
 */
export function encounterIdsForActiveDungeons(
  activeDungeonSlugs: readonly string[],
): ActiveDungeonEncounterBinding[] {
  return requireActiveDungeonEncounters({ activeDungeonSlugs });
}

/** Deterministic GraphQL field alias for a dungeon slug (safe identifier). */
export function encounterRankingsGraphqlAlias(dungeonSlug: string): string {
  const alias = dungeonSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (!alias || !/^[a-z]/.test(alias)) {
    return `dungeon_${alias || "unknown"}`;
  }
  return alias;
}

/**
 * One HTTP GraphQL operation: aliased encounterRankings for each active dungeon.
 */
export function buildAliasedEncounterRankingsQuery(
  encounters: ReadonlyArray<{ dungeonSlug: string; encounterId: number }>,
): {
  operationName: string;
  query: string;
  aliasByEncounterId: Map<number, string>;
  aliasByDungeonSlug: Map<string, string>;
} {
  const aliasByEncounterId = new Map<number, string>();
  const aliasByDungeonSlug = new Map<string, string>();
  const fields = encounters.map(({ dungeonSlug, encounterId }) => {
    const alias = encounterRankingsGraphqlAlias(dungeonSlug);
    aliasByEncounterId.set(encounterId, alias);
    aliasByDungeonSlug.set(dungeonSlug.trim().toLowerCase(), alias);
    return `${alias}: encounterRankings(encounterID: ${encounterId}, metric: playerscore, byBracket: true, compare: Parses)`;
  });
  const query = `query CharacterEncounterRankingsAliased($name: String!, $serverSlug: String!, $serverRegion: String!) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      ${fields.join("\n      ")}
    }
  }
}`;
  return {
    operationName: "CharacterEncounterRankingsAliased",
    query,
    aliasByEncounterId,
    aliasByDungeonSlug,
  };
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isEncounterRankRow(row: unknown): row is EncounterRankRow {
  return row != null && typeof row === "object";
}

/**
 * Map one encounterRankings JSON payload into fight-local ranking observations.
 * Skips leaderboard-only rows without a public report code + fightID.
 */
export function mapEncounterRankings(input: {
  payload: EncounterRankingsPayload | null | undefined;
  encounterId: number;
  dungeonSlug?: string | null;
  zoneId?: number | null;
}): WclRankingObservation[] {
  const ranks = input.payload?.ranks;
  if (!Array.isArray(ranks) || ranks.length === 0) return [];
  const dungeonSlug =
    input.dungeonSlug?.trim().toLowerCase() ||
    ENCOUNTER_DUNGEON_MAP[input.encounterId] ||
    null;
  const zoneFromPayload =
    typeof input.payload?.zone === "number"
      ? input.payload.zone
      : input.payload?.zone && typeof input.payload.zone === "object"
        ? input.payload.zone.id
        : null;
  const zoneId = input.zoneId ?? zoneFromPayload;
  const metric = input.payload?.metric ?? "playerscore";

  const out: WclRankingObservation[] = [];
  for (const raw of ranks) {
    if (!isEncounterRankRow(raw)) continue;
    const code = raw.report?.code?.trim() ?? "";
    const fightId = asFiniteNumber(raw.report?.fightID);
    if (!code || fightId == null || fightId <= 0) continue;

    const keyLevel = asFiniteNumber(raw.bracketData) ?? asFiniteNumber(raw.bracket);
    const rankPercent = asFiniteNumber(raw.rankPercent);
    const durationMs = asFiniteNumber(raw.duration);
    const startTimeMs = asFiniteNumber(raw.startTime);
    const timed = timedFromMedal(raw.medal ?? null);

    out.push({
      reportCode: code,
      fightId,
      encounterId: input.encounterId,
      zoneId,
      bracket: keyLevel,
      keyLevel,
      score: asFiniteNumber(raw.score) ?? asFiniteNumber(raw.amount),
      amount: asFiniteNumber(raw.amount),
      percentile: rankPercent,
      rankPercent,
      bracketPercent: null,
      specSlug: raw.spec ?? null,
      roleSlug: null,
      durationMs,
      startTimeMs,
      reportStartTimeMs: asFiniteNumber(raw.report?.startTime),
      timed,
      metric,
    });
    void dungeonSlug;
  }
  return out;
}

export function mapAliasedEncounterRankings(input: {
  characterPayload: Record<string, unknown> | null | undefined;
  encounters: ReadonlyArray<{ dungeonSlug: string; encounterId: number }>;
  zoneId: number;
}): WclRankingObservation[] {
  if (!input.characterPayload) return [];
  const out: WclRankingObservation[] = [];
  for (const { dungeonSlug, encounterId } of input.encounters) {
    const alias = encounterRankingsGraphqlAlias(dungeonSlug);
    let payload = input.characterPayload[alias] as EncounterRankingsPayload | string | null;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload) as EncounterRankingsPayload;
      } catch {
        payload = null;
      }
    }
    out.push(
      ...mapEncounterRankings({
        payload,
        encounterId,
        dungeonSlug,
        zoneId: input.zoneId,
      }),
    );
  }
  return out;
}

/** Convert encounter ranks into the ZoneRankingsPayload shape used by ranking-parse resolve. */
export function encounterObservationsToZoneRankingsPayload(
  observations: readonly WclRankingObservation[],
  zoneId: number,
  metric = "playerscore",
): ZoneRankingsPayload {
  return {
    metric,
    zone: zoneId,
    rankings: observations.map((o) => ({
      report: {
        code: o.reportCode,
        startTime: o.reportStartTimeMs ?? o.startTimeMs ?? 0,
      },
      fightID: o.fightId,
      encounterID: o.encounterId,
      bracket: o.keyLevel,
      score: o.score,
      amount: o.amount,
      duration: o.durationMs,
      startTime: o.startTimeMs,
      rankPercent: o.rankPercent,
      bracketPercent: o.bracketPercent,
      spec: o.specSlug,
      role: o.roleSlug,
    })),
  };
}

export function rankingsToEncounterCandidates(
  rankings: readonly WclRankingObservation[],
  dungeonSlugByEncounterId?: ReadonlyMap<number, string>,
): WclRunCandidate[] {
  return rankings.map((r) => {
    const dungeonSlug =
      dungeonSlugByEncounterId?.get(r.encounterId) ??
      ENCOUNTER_DUNGEON_MAP[r.encounterId] ??
      null;
    const warnings: string[] = [];
    if (dungeonSlug == null && r.encounterId > 0) {
      warnings.push(`Unknown encounter→dungeon mapping for encounterId=${r.encounterId}`);
    }
    const completedAt =
      r.startTimeMs != null && r.durationMs != null
        ? new Date(r.startTimeMs + r.durationMs).toISOString()
        : r.startTimeMs != null
          ? new Date(r.startTimeMs).toISOString()
          : null;
    return {
      reportCode: r.reportCode,
      fightId: r.fightId,
      encounterId: r.encounterId,
      zoneId: r.zoneId,
      dungeonSlug,
      seasonSlug: null,
      keyLevel: r.keyLevel,
      score: r.score,
      startTimeMs: r.startTimeMs,
      completedAt,
      durationMs: r.durationMs,
      timed: r.timed,
      selectionTags: [],
      source: "encounterRankings" as const,
      matchConfidence: null,
      incompleteness: {
        dungeonUnknown: dungeonSlug == null,
        seasonUnknown: true,
        timedUnknown: r.timed == null,
        keyLevelUnknown: r.keyLevel == null,
        rosterIncomplete: true,
        fightUnknown: false,
      },
      warnings,
    };
  });
}

/**
 * Per-dungeon funnel diagnostics from a raw encounterRankings JSON payload.
 */
export function summarizeEncounterRanksPayload(input: {
  dungeonSlug: string;
  encounterId: number;
  payload: EncounterRankingsPayload | null | undefined;
}): {
  dungeonSlug: string;
  encounterId: number;
  rankRows: number;
  logBackedRows: number;
  timedRows: number;
  eligibleRows: number;
} {
  const ranks = Array.isArray(input.payload?.ranks) ? input.payload!.ranks! : [];
  let logBackedRows = 0;
  let timedRows = 0;
  let eligibleRows = 0;
  for (const raw of ranks) {
    if (!isEncounterRankRow(raw)) continue;
    const code = raw.report?.code?.trim() ?? "";
    const fightId = asFiniteNumber(raw.report?.fightID);
    const logBacked = Boolean(code && fightId != null && fightId > 0);
    if (logBacked) logBackedRows += 1;
    const timed = timedFromMedal(raw.medal ?? null);
    if (logBacked && timed === true) timedRows += 1;
    const keyLevel = asFiniteNumber(raw.bracketData) ?? asFiniteNumber(raw.bracket);
    if (logBacked && timed === true && keyLevel != null && keyLevel > 0) {
      eligibleRows += 1;
    }
  }
  return {
    dungeonSlug: input.dungeonSlug,
    encounterId: input.encounterId,
    rankRows: ranks.length,
    logBackedRows,
    timedRows,
    eligibleRows,
  };
}

export function parseAliasedEncounterPayloads(input: {
  characterPayload: Record<string, unknown> | null | undefined;
  encounters: ReadonlyArray<{ dungeonSlug: string; encounterId: number }>;
}): Array<{
  dungeonSlug: string;
  encounterId: number;
  payload: EncounterRankingsPayload | null;
}> {
  return input.encounters.map(({ dungeonSlug, encounterId }) => {
    const alias = encounterRankingsGraphqlAlias(dungeonSlug);
    let payload = (input.characterPayload?.[alias] ?? null) as
      | EncounterRankingsPayload
      | string
      | null;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload) as EncounterRankingsPayload;
      } catch {
        payload = null;
      }
    }
    return { dungeonSlug, encounterId, payload };
  });
}

export function timedEligibleCoverageByDungeon(
  candidates: readonly WclRunCandidate[],
  activeDungeonSlugs: readonly string[],
): {
  distinctTimedPerDungeon: Record<string, number>;
  fullCoverage: boolean;
  underCovered: string[];
} {
  const active = activeDungeonSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const distinctTimedPerDungeon: Record<string, number> = {};
  for (const slug of active) distinctTimedPerDungeon[slug] = 0;

  const seen = new Map<string, Set<string>>();
  for (const slug of active) seen.set(slug, new Set());

  for (const c of candidates) {
    const slug = c.dungeonSlug?.trim().toLowerCase();
    if (!slug || !seen.has(slug)) continue;
    if (c.fightId <= 0 || c.incompleteness.fightUnknown) continue;
    if (c.timed !== true) continue;
    // Coverage must reflect candidates that can be turned into target-resolvable
    // evidence, but `encounterRankings` candidates frequently have
    // `rosterIncomplete=true` (target ownership is resolved later).
    // Only exclude rosterIncomplete candidates for `recentReports` stubs.
    if (c.source === "recentReports" && c.incompleteness.rosterIncomplete) continue;
    if (c.keyLevel == null || c.keyLevel <= 0) continue;
    seen.get(slug)!.add(`${c.reportCode}:${c.fightId}`);
  }

  for (const slug of active) {
    distinctTimedPerDungeon[slug] = seen.get(slug)?.size ?? 0;
  }
  const underCovered = active.filter(
    (slug) => (distinctTimedPerDungeon[slug] ?? 0) < TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON,
  );
  return {
    distinctTimedPerDungeon,
    fullCoverage: active.length > 0 && underCovered.length === 0,
    underCovered,
  };
}
