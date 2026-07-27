import type { RegionCode } from "@mplus/contracts";
import type {
  WclCharacterSummary,
  WclRankingObservation,
  WclRunCandidate,
  WclVisibilityState,
} from "../types.js";
import { dedupeCandidates, selectLatestAndHighest } from "./run-matching.js";

/** MVP season zone mapping — replace with live worldData lookup in Agent 5. */
export const DEFAULT_MPLUS_ZONE_ID = 45;

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
  zone?: { id: number; name?: string | null } | null;
  rankings?: Array<{
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
  }>;
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
  faction?: number | null;
  hidden: boolean;
  server: { slug: string; region?: { name: string } };
}

export function mapCharacterSummary(
  character: CharacterResolvePayload,
  region: RegionCode,
  fetchedAt: string,
  visibility: WclVisibilityState,
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
    fetchedAt,
  };
}

export function deriveVisibility(
  character: CharacterResolvePayload | null,
  rankings: WclRankingObservation[],
  recentPublicCount: number,
): WclVisibilityState {
  if (!character) {
    return "NO_PUBLIC_LOGS";
  }
  if (character.hidden) {
    return "HIDDEN";
  }
  if (rankings.length === 0 && recentPublicCount === 0) {
    return "NO_PUBLIC_LOGS";
  }
  return "PUBLIC";
}

export function mapZoneRankings(
  payload: ZoneRankingsPayload | null | undefined,
  zoneId: number,
): WclRankingObservation[] {
  if (!payload?.rankings) {
    return [];
  }
  return payload.rankings.map((row) => ({
    reportCode: row.report.code,
    fightId: row.fightID,
    encounterId: row.encounterID ?? 0,
    zoneId: payload.zone?.id ?? zoneId,
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
    timed: row.kill ?? null,
    metric: payload.metric ?? null,
  }));
}

export function rankingsToCandidates(rankings: WclRankingObservation[]): WclRunCandidate[] {
  return rankings.map((r) => ({
    reportCode: r.reportCode,
    fightId: r.fightId,
    encounterId: r.encounterId,
    zoneId: r.zoneId,
    dungeonSlug: ENCOUNTER_DUNGEON_MAP[r.encounterId] ?? null,
    keyLevel: r.keyLevel,
    score: r.score,
    startTimeMs: r.startTimeMs,
    completedAt:
      r.reportStartTimeMs != null && r.startTimeMs != null
        ? new Date(r.reportStartTimeMs + r.startTimeMs).toISOString()
        : null,
    durationMs: r.durationMs,
    selectionTags: [],
    source: "zoneRankings" as const,
  }));
}

export function recentReportsToCandidates(
  payload: RecentReportsPayload | null | undefined,
): WclRunCandidate[] {
  if (!payload?.data) {
    return [];
  }
  return payload.data
    .filter((r) => (r.visibility ?? "public") === "public")
    .map((r) => ({
      reportCode: r.code,
      fightId: 1,
      encounterId: 0,
      zoneId: r.zone?.id ?? null,
      dungeonSlug: null,
      keyLevel: null,
      score: null,
      startTimeMs: r.startTime,
      completedAt: new Date(r.startTime).toISOString(),
      durationMs: r.endTime != null ? r.endTime - r.startTime : null,
      selectionTags: [],
      source: "recentReports" as const,
    }));
}

export function buildCharacterDiscovery(input: {
  summary: WclCharacterSummary;
  rankings: WclRankingObservation[];
  rankingCandidates: WclRunCandidate[];
  recentCandidates: WclRunCandidate[];
}) {
  const merged = dedupeCandidates([...input.rankingCandidates, ...input.recentCandidates]);
  const { latest, highest } = selectLatestAndHighest(merged);
  return {
    summary: input.summary,
    rankings: input.rankings,
    candidates: merged,
    latest,
    highest,
  };
}

export function mapRegionToWcl(region: RegionCode): string {
  return region.toUpperCase();
}
