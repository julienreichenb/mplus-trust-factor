import type { RegionCode } from "@mplus/contracts";
import type { WclDataState, WclProvenance } from "@mplus/contracts";
import type {
  WclCharacterSummary,
  WclRankingObservation,
  WclRunCandidate,
  WclRunCandidateIncompleteness,
  WclVisibilityState,
} from "../types.js";
import { MAX_DISCOVERY_CANDIDATES } from "./bounds.js";
import { FIXTURE_MPLUS_ZONE_ID } from "./mplus-zone.js";
import { dedupeCandidates, selectLatestAndHighest } from "./run-matching.js";

/** @deprecated Use FIXTURE_MPLUS_ZONE_ID — live mode must not use this silently. */
export const DEFAULT_MPLUS_ZONE_ID = FIXTURE_MPLUS_ZONE_ID;

/** Encounter ID → dungeon slug mapping for fixture/MVP season. */
export const ENCOUNTER_DUNGEON_MAP: Record<number, string> = {
  1201: "ara-kara-city-of-echoes",
  1202: "eco-dome-al'dani",
  1203: "halls-of-atonement",
  1204: "operation-floodgate",
  1205: "priory-of-the-sacred-flame",
  1206: "tazavesh-streets-of-wonder",
  1207: "the-dawnbreaker",
  1208: "the-rookery",
};

export interface ZoneRankingsPayload {
  metric?: string | null;
  difficulty?: number | null;
  rankPercent?: number | null;
  totalParses?: number | null;
  zone?: number | { id: number; name?: string | null } | null;
  /** May include aggregate rows (no report/fight) or parse rows (report+fightID). */
  rankings?: unknown[];
}

function isParseRankingRow(row: unknown): row is {
  report: { code: string; startTime: number; endTime?: number | null };
  fightID: number;
  encounterID?: number | null;
  difficulty?: number | null;
  kill?: boolean | null;
  duration?: number | null;
  bracket?: number | null;
  score?: number | null;
  total?: number | null;
  amount?: number | null;
  spec?: string | null;
  role?: string | null;
  startTime?: number | null;
} {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  const report = r.report;
  if (!report || typeof report !== "object") return false;
  const code = (report as { code?: unknown }).code;
  return typeof code === "string" && typeof r.fightID === "number";
}

export function countParseStyleRankingRows(payload: ZoneRankingsPayload | null | undefined): {
  totalRows: number;
  parseRows: number;
} {
  const rankings = payload?.rankings ?? [];
  return {
    totalRows: rankings.length,
    parseRows: rankings.filter(isParseRankingRow).length,
  };
}

export interface RecentReportsPayload {
  data?: Array<{
    code: string;
    title?: string | null;
    startTime: number;
    endTime?: number | null;
    visibility?: string | null;
    zone?: { id: number; name?: string | null } | null;
  }>;
  total?: number | null;
  has_more_pages?: boolean | null;
}

export interface CharacterResolvePayload {
  id: number;
  canonicalID: number;
  name: string;
  level?: number | null;
  classID?: number | null;
  faction?: number | { id: number; name?: string | null } | null;
  hidden: boolean;
  server: { slug: string; region?: { name: string } };
}

function emptyIncompleteness(
  overrides: Partial<WclRunCandidateIncompleteness> = {},
): WclRunCandidateIncompleteness {
  return {
    dungeonUnknown: true,
    seasonUnknown: true,
    timedUnknown: true,
    keyLevelUnknown: true,
    rosterIncomplete: true,
    fightUnknown: false,
    ...overrides,
  };
}

export function mapCharacterSummary(
  character: CharacterResolvePayload,
  region: RegionCode,
  fetchedAt: string,
  visibility: WclVisibilityState | null,
  warnings: string[] = [],
  dataState: WclDataState = "NO_PUBLIC_LOGS",
): WclCharacterSummary {
  return {
    wclCharacterId: character.id,
    canonicalId: character.canonicalID,
    name: character.name,
    realmSlug: character.server.slug,
    region,
    classId: character.classID ?? null,
    level: character.level ?? null,
    hidden: character.hidden,
    visibility,
    dataState,
    fetchedAt,
    warnings,
  };
}

/**
 * Derive explicit profile visibility + independent data-state from discovery inputs.
 * Matching outcomes (NO_MATCHED_RUN / RANKINGS_ONLY) are refined later in the pipeline.
 */
export function deriveWclProvenance(
  character: CharacterResolvePayload | null,
  rankings: WclRankingObservation[],
  recentPublicCount: number,
  options: {
    privateSkipped?: number;
    rateLimited?: boolean;
    unavailable?: boolean;
  } = {},
): WclProvenance & { dataState: WclDataState } {
  if (options.rateLimited) {
    return { visibility: null, dataState: "RATE_LIMITED" };
  }
  if (options.unavailable) {
    return { visibility: null, dataState: "UNAVAILABLE" };
  }
  if (!character) {
    return { visibility: null, dataState: "NO_PUBLIC_LOGS" };
  }
  if (character.hidden) {
    return { visibility: "HIDDEN", dataState: "NO_PUBLIC_LOGS" };
  }
  if (rankings.length === 0 && recentPublicCount === 0) {
    return { visibility: "PUBLIC", dataState: "NO_PUBLIC_LOGS" };
  }
  // Public profile with discoverable logs/rankings — matching refined after analyze.
  return { visibility: "PUBLIC", dataState: "NO_MATCHED_RUN" };
}

/** @deprecated Prefer deriveWclProvenance — returns visibility only (or null for failures). */
export function deriveVisibility(
  character: CharacterResolvePayload | null,
  rankings: WclRankingObservation[],
  recentPublicCount: number,
  options: {
    privateSkipped?: number;
    rateLimited?: boolean;
    unavailable?: boolean;
  } = {},
): WclVisibilityState | null {
  return deriveWclProvenance(character, rankings, recentPublicCount, options).visibility;
}

export function mapZoneRankings(
  payload: ZoneRankingsPayload | null | undefined,
  zoneId: number,
): WclRankingObservation[] {
  if (!payload?.rankings) {
    return [];
  }
  const resolvedZoneId =
    typeof payload.zone === "number" ? payload.zone : (payload.zone?.id ?? zoneId);
  return payload.rankings.filter(isParseRankingRow).map((row) => ({
    reportCode: row.report.code,
    fightId: row.fightID,
    encounterId: row.encounterID ?? 0,
    zoneId: resolvedZoneId,
    bracket: row.bracket ?? null,
    keyLevel: row.bracket ?? null,
    score: row.score ?? null,
    amount: row.amount ?? null,
    percentile: row.total != null && row.amount != null ? (row.amount / row.total) * 100 : null,
    specSlug: row.spec ?? null,
    roleSlug: row.role ?? null,
    durationMs: row.duration ?? null,
    startTimeMs: row.startTime ?? null,
    reportStartTimeMs: row.report.startTime,
    // kill ≠ timed; WCL rankings do not expose timer success here
    timed: null,
    metric: payload.metric ?? null,
  }));
}

export function rankingsToCandidates(rankings: WclRankingObservation[]): WclRunCandidate[] {
  return rankings.map((r) => {
    const dungeonSlug = ENCOUNTER_DUNGEON_MAP[r.encounterId] ?? null;
    const warnings: string[] = [];
    if (dungeonSlug == null && r.encounterId > 0) {
      warnings.push(`Unknown encounter→dungeon mapping for encounterId=${r.encounterId}`);
    }
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
      completedAt:
        r.reportStartTimeMs != null && r.startTimeMs != null
          ? new Date(r.reportStartTimeMs + r.startTimeMs).toISOString()
          : null,
      durationMs: r.durationMs,
      timed: null,
      selectionTags: [],
      source: "zoneRankings" as const,
      matchConfidence: null,
      incompleteness: emptyIncompleteness({
        dungeonUnknown: dungeonSlug == null,
        seasonUnknown: true,
        timedUnknown: true,
        keyLevelUnknown: r.keyLevel == null,
        rosterIncomplete: true,
        fightUnknown: false,
      }),
      warnings,
    };
  });
}

export function classifyReportVisibility(visibility: string | null | undefined): {
  isPublic: boolean;
  isPrivate: boolean;
  isUnlisted: boolean;
} {
  const v = (visibility ?? "public").toLowerCase();
  return {
    isPublic: v === "public",
    isPrivate: v === "private",
    isUnlisted: v === "unlisted",
  };
}

export function recentReportsToCandidates(
  payload: RecentReportsPayload | null | undefined,
): { candidates: WclRunCandidate[]; privateSkipped: number; unlistedSkipped: number } {
  if (!payload?.data) {
    return { candidates: [], privateSkipped: 0, unlistedSkipped: 0 };
  }

  let privateSkipped = 0;
  let unlistedSkipped = 0;
  const candidates: WclRunCandidate[] = [];

  for (const r of payload.data) {
    const vis = classifyReportVisibility(r.visibility);
    if (vis.isPrivate) {
      privateSkipped += 1;
      continue;
    }
    if (vis.isUnlisted) {
      unlistedSkipped += 1;
      continue;
    }
    if (!vis.isPublic) {
      privateSkipped += 1;
      continue;
    }

    candidates.push({
      reportCode: r.code,
      // Fight unknown until report metadata is fetched — never invent fightId=1 as fact
      fightId: 0,
      encounterId: 0,
      zoneId: r.zone?.id ?? null,
      dungeonSlug: null,
      seasonSlug: null,
      keyLevel: null,
      score: null,
      startTimeMs: r.startTime,
      completedAt: new Date(r.startTime).toISOString(),
      durationMs: r.endTime != null ? r.endTime - r.startTime : null,
      timed: null,
      selectionTags: [],
      source: "recentReports" as const,
      matchConfidence: null,
      incompleteness: emptyIncompleteness({
        fightUnknown: true,
        dungeonUnknown: true,
        seasonUnknown: true,
        timedUnknown: true,
        keyLevelUnknown: true,
        rosterIncomplete: true,
      }),
      warnings: ["recentReports stub — fight/dungeon/key unknown until report metadata"],
    });
  }

  return { candidates, privateSkipped, unlistedSkipped };
}

/**
 * Prefer ranking candidates (have fight IDs) over recentReports stubs when capping.
 */
export function capDiscoveryCandidates(
  rankingCandidates: WclRunCandidate[],
  recentCandidates: WclRunCandidate[],
  max = MAX_DISCOVERY_CANDIDATES,
): { candidates: WclRunCandidate[]; truncated: boolean } {
  const merged = dedupeCandidates([...rankingCandidates, ...recentCandidates]);
  // Prefer zoneRankings rows; demote fightUnknown stubs
  merged.sort((a, b) => {
    const aScore = a.incompleteness.fightUnknown ? 1 : 0;
    const bScore = b.incompleteness.fightUnknown ? 1 : 0;
    if (aScore !== bScore) return aScore - bScore;
    return 0;
  });
  if (merged.length <= max) {
    return { candidates: merged, truncated: false };
  }
  return { candidates: merged.slice(0, max), truncated: true };
}

export function buildCharacterDiscovery(input: {
  summary: WclCharacterSummary;
  rankings: WclRankingObservation[];
  rankingCandidates: WclRunCandidate[];
  recentCandidates: WclRunCandidate[];
  privateReportsSkipped?: number;
  dungeonAggregates?: import("../types.js").WclDungeonPerformanceAggregate[];
}): {
  summary: WclCharacterSummary;
  rankings: WclRankingObservation[];
  dungeonAggregates: import("../types.js").WclDungeonPerformanceAggregate[];
  candidates: WclRunCandidate[];
  latest: WclRunCandidate | null;
  highest: WclRunCandidate | null;
  candidatesTruncated: boolean;
  privateReportsSkipped: number;
} {
  const { candidates, truncated } = capDiscoveryCandidates(
    input.rankingCandidates,
    input.recentCandidates,
  );
  const { latest, highest } = selectLatestAndHighest(candidates);
  const warnings = [...input.summary.warnings];
  if (truncated) {
    warnings.push(
      `Discovery candidates truncated to ${MAX_DISCOVERY_CANDIDATES} (documented cap)`,
    );
  }
  return {
    summary: { ...input.summary, warnings },
    rankings: input.rankings,
    dungeonAggregates: input.dungeonAggregates ?? [],
    candidates,
    latest,
    highest,
    candidatesTruncated: truncated,
    privateReportsSkipped: input.privateReportsSkipped ?? 0,
  };
}

export function mapRegionToWcl(region: RegionCode): string {
  return region.toUpperCase();
}

/**
 * Map a discovery candidate into MythicRunDTO-safe placeholders.
 * Never claims timed=true or a known season/dungeon without evidence.
 */
export function mythicRunPlaceholders(candidate: WclRunCandidate): {
  seasonSlug: string;
  dungeonSlug: string;
  keyLevel: number;
  timed: boolean;
  durationMs: number;
  warnings: string[];
} {
  const warnings = [...candidate.warnings];
  if (candidate.seasonSlug == null) {
    warnings.push("seasonSlug unknown — using sentinel 'unknown'");
  }
  if (candidate.dungeonSlug == null) {
    warnings.push("dungeonSlug unknown — using sentinel 'unknown'");
  }
  if (candidate.timed == null) {
    warnings.push("timed unknown — defaulting to false (not claiming timed)");
  }
  if (candidate.keyLevel == null) {
    warnings.push("keyLevel unknown — using 0 placeholder");
  }
  if (candidate.incompleteness.rosterIncomplete) {
    warnings.push("roster incomplete — fingerprint may be target-only");
  }
  return {
    seasonSlug: candidate.seasonSlug ?? "unknown",
    dungeonSlug: candidate.dungeonSlug ?? "unknown",
    keyLevel: candidate.keyLevel ?? 0,
    timed: candidate.timed ?? false,
    durationMs: candidate.durationMs ?? 0,
    warnings,
  };
}
