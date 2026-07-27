/**
 * Bounded recentReports → fight/masterData hydration.
 * Stubs (fightUnknown) are expanded into Mythic+ candidates before discoverCharacterRuns filtering.
 */
import type { IsoDateTime } from "@mplus/contracts";
import type { WclRunCandidate } from "../types.js";
import {
  HYDRATION_HINT_WINDOW_MS,
  MAX_FIGHTS_PER_HYDRATED_REPORT,
  MAX_HYDRATION_REPORTS,
} from "./bounds.js";
import { ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";

export interface HydrationHint {
  completedAt: IsoDateTime;
  dungeonSlug?: string;
  keyLevel?: number;
}

export interface HydrationActor {
  id: number;
  name: string;
  type: string;
  server?: string | null;
}

export interface HydrationFight {
  id: number;
  encounterID?: number | null;
  name?: string | null;
  difficulty?: number | null;
  kill?: boolean | null;
  startTime: number;
  endTime: number;
  keystoneLevel?: number | null;
  friendlyPlayers?: Array<number | { id: number; name?: string; server?: string }>;
}

export interface HydrationReportPayload {
  code: string;
  startTime: number;
  endTime?: number | null;
  visibility?: string | null;
  zone?: { id: number; name?: string | null } | null;
  fights: HydrationFight[];
  masterData?: { actors?: HydrationActor[] } | null;
}

export type FetchReportForHydration = (reportCode: string) => Promise<HydrationReportPayload | null>;

export function slugifyDungeonName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveDungeonSlug(
  fight: HydrationFight,
  reportZoneName?: string | null,
): string | null {
  if (fight.encounterID != null && ENCOUNTER_DUNGEON_MAP[fight.encounterID]) {
    return ENCOUNTER_DUNGEON_MAP[fight.encounterID]!;
  }
  if (fight.name && fight.name.trim()) {
    const fromName = slugifyDungeonName(fight.name);
    if (fromName) return fromName;
  }
  if (reportZoneName?.trim()) {
    const fromZone = slugifyDungeonName(reportZoneName);
    if (fromZone) return fromZone;
  }
  return null;
}

/** Mythic+ fights expose a keystone level; raid/trash do not. */
export function isMythicPlusFight(fight: HydrationFight): boolean {
  return typeof fight.keystoneLevel === "number" && fight.keystoneLevel > 0;
}

export function resolveTargetActorId(
  actors: HydrationActor[],
  friendlyPlayers: HydrationFight["friendlyPlayers"],
  characterName: string,
  realmSlug: string,
): number | null {
  const targetName = characterName.toLowerCase();
  const targetRealm = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const nameMatches = (name: string | undefined, server: string | null | undefined) => {
    if ((name ?? "").toLowerCase() !== targetName) return false;
    if (!server) return true;
    const normalizedServer = server.toLowerCase().replace(/\s+/g, "-");
    return normalizedServer === targetRealm || normalizedServer.includes(targetRealm) || targetRealm.includes(normalizedServer);
  };

  for (const actor of actors) {
    if (actor.type === "Player" && nameMatches(actor.name, actor.server)) {
      return actor.id;
    }
  }

  const byId = new Map(actors.map((a) => [a.id, a]));
  for (const entry of friendlyPlayers ?? []) {
    if (typeof entry === "number") {
      const actor = byId.get(entry);
      if (actor && nameMatches(actor.name, actor.server)) return entry;
      continue;
    }
    if (nameMatches(entry.name, entry.server)) return entry.id;
  }
  return null;
}

/**
 * Prioritize fightUnknown stubs: closest to external hints, else most recent.
 */
export function prioritizeReportsForHydration(
  stubs: WclRunCandidate[],
  hints: HydrationHint[],
  maxReports = MAX_HYDRATION_REPORTS,
): WclRunCandidate[] {
  const byCode = new Map<string, WclRunCandidate>();
  for (const stub of stubs) {
    if (!stub.reportCode || !stub.incompleteness.fightUnknown) continue;
    if (!byCode.has(stub.reportCode)) byCode.set(stub.reportCode, stub);
  }
  const unique = [...byCode.values()];
  const hintTimes = hints
    .map((h) => Date.parse(h.completedAt))
    .filter((ms) => !Number.isNaN(ms));

  unique.sort((a, b) => {
    const aStart = a.startTimeMs ?? 0;
    const bStart = b.startTimeMs ?? 0;
    if (hintTimes.length > 0) {
      const aDelta = Math.min(...hintTimes.map((t) => Math.abs(t - aStart)));
      const bDelta = Math.min(...hintTimes.map((t) => Math.abs(t - bStart)));
      const aInWindow = aDelta <= HYDRATION_HINT_WINDOW_MS ? 0 : 1;
      const bInWindow = bDelta <= HYDRATION_HINT_WINDOW_MS ? 0 : 1;
      if (aInWindow !== bInWindow) return aInWindow - bInWindow;
      if (aDelta !== bDelta) return aDelta - bDelta;
    }
    return bStart - aStart;
  });

  return unique.slice(0, maxReports);
}

export function hydratedFightToCandidate(
  report: HydrationReportPayload,
  fight: HydrationFight,
  targetActorId: number,
  hints: HydrationHint[] = [],
): WclRunCandidate {
  let dungeonSlug = resolveDungeonSlug(fight, report.zone?.name);
  const durationMs = Math.max(0, fight.endTime - fight.startTime);
  const completedAtMs = report.startTime + fight.endTime;
  const keyLevel = fight.keystoneLevel ?? null;
  const completedAt = new Date(completedAtMs).toISOString();

  // Prefer external hydration hints when encounter→dungeon map misses the season pool.
  if ((dungeonSlug == null || !dungeonSlug.trim()) && keyLevel != null && hints.length > 0) {
    const CLOCK_SKEW_MS = 45 * 60 * 1000;
    let best: { hint: HydrationHint; delta: number } | null = null;
    for (const h of hints) {
      if (!h.dungeonSlug?.trim()) continue;
      if (h.keyLevel != null && h.keyLevel !== keyLevel) continue;
      const delta = Math.abs(Date.parse(h.completedAt) - completedAtMs);
      if (delta > CLOCK_SKEW_MS) continue;
      if (!best || delta < best.delta) best = { hint: h, delta };
    }
    if (best?.hint.dungeonSlug) {
      dungeonSlug = best.hint.dungeonSlug;
    }
  }

  if (dungeonSlug != null && !dungeonSlug.trim()) {
    dungeonSlug = null;
  }

  return {
    reportCode: report.code,
    fightId: fight.id,
    encounterId: fight.encounterID ?? 0,
    zoneId: report.zone?.id ?? null,
    dungeonSlug,
    seasonSlug: null,
    keyLevel,
    score: null,
    startTimeMs: report.startTime + fight.startTime,
    completedAt,
    durationMs,
    timed: null,
    selectionTags: [],
    source: "recentReports",
    matchConfidence: null,
    targetActorId,
    incompleteness: {
      dungeonUnknown: dungeonSlug == null || !dungeonSlug.trim(),
      seasonUnknown: true,
      timedUnknown: true,
      keyLevelUnknown: keyLevel == null,
      rosterIncomplete: true,
      fightUnknown: false,
    },
    warnings: [
      "hydrated from recentReports fight/masterData",
      ...(dungeonSlug == null || !dungeonSlug.trim()
        ? ["dungeonSlug unresolved from encounter/fight name"]
        : []),
    ],
  };
}

export function candidatesFromHydratedReport(
  report: HydrationReportPayload,
  characterName: string,
  realmSlug: string,
  hints: HydrationHint[] = [],
): { candidates: WclRunCandidate[]; rejected: string[] } {
  const rejected: string[] = [];
  const vis = (report.visibility ?? "public").toLowerCase();
  if (vis !== "public") {
    rejected.push(`report_${report.code}_not_public`);
    return { candidates: [], rejected };
  }

  const actors = report.masterData?.actors ?? [];
  const candidates: WclRunCandidate[] = [];
  let mplusSeen = 0;

  for (const fight of report.fights) {
    if (!isMythicPlusFight(fight)) {
      rejected.push(`fight_${fight.id}_not_mythic_plus`);
      continue;
    }
    mplusSeen += 1;
    if (mplusSeen > MAX_FIGHTS_PER_HYDRATED_REPORT) {
      rejected.push(`fight_${fight.id}_over_report_cap`);
      continue;
    }
    const targetActorId = resolveTargetActorId(
      actors,
      fight.friendlyPlayers,
      characterName,
      realmSlug,
    );
    if (targetActorId == null) {
      rejected.push(`fight_${fight.id}_target_absent`);
      continue;
    }
    candidates.push(hydratedFightToCandidate(report, fight, targetActorId, hints));
  }

  return { candidates, rejected };
}

export async function hydrateFightUnknownCandidates(input: {
  candidates: WclRunCandidate[];
  characterName: string;
  realmSlug: string;
  hints?: HydrationHint[];
  maxReports?: number;
  fetchReport: FetchReportForHydration;
}): Promise<{
  candidates: WclRunCandidate[];
  hydratedReportCount: number;
  rejectedReasons: string[];
}> {
  const stubs = input.candidates.filter((c) => c.incompleteness.fightUnknown);
  const known = input.candidates.filter((c) => !c.incompleteness.fightUnknown);
  const prioritized = prioritizeReportsForHydration(
    stubs,
    input.hints ?? [],
    input.maxReports ?? MAX_HYDRATION_REPORTS,
  );

  const hydrated: WclRunCandidate[] = [];
  const rejectedReasons: string[] = [];
  let hydratedReportCount = 0;

  for (const stub of prioritized) {
    try {
      const report = await input.fetchReport(stub.reportCode);
      if (!report) {
        rejectedReasons.push(`report_${stub.reportCode}_fetch_empty`);
        continue;
      }
      hydratedReportCount += 1;
      const mapped = candidatesFromHydratedReport(
        report,
        input.characterName,
        input.realmSlug,
        input.hints ?? [],
      );
      rejectedReasons.push(...mapped.rejected);
      hydrated.push(...mapped.candidates);
    } catch (error) {
      rejectedReasons.push(
        `report_${stub.reportCode}_fetch_error:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Keep non-hydrated stubs out — discoverCharacterRuns filters fightUnknown anyway.
  const remainingStubCodes = new Set(prioritized.map((s) => s.reportCode));
  const untouchedStubs = stubs.filter((s) => !remainingStubCodes.has(s.reportCode));

  return {
    candidates: [...known, ...hydrated, ...untouchedStubs],
    hydratedReportCount,
    rejectedReasons: rejectedReasons.slice(0, 40),
  };
}
