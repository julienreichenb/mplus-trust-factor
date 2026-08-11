/**
 * Map an already-fetched public report (fights + masterData) into run candidates.
 * Used only AFTER a reportCode is known — not for run discovery.
 */
import type { WclRunCandidate } from "../types.js";
import {
  extractFriendlyPlayerActorIds,
  resolveFightOwnership,
  type FightOwnershipRejectionReason,
} from "./fight-ownership.js";
import { ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";
import { slugifyDungeonName } from "./dungeon-slug.js";

/** Max Mythic+ fights retained when mapping one already-selected report. */
const MAX_FIGHTS_PER_MAPPED_REPORT = 8;

export interface ReportFightActor {
  id: number;
  name?: string | null;
  server?: string | null;
  type?: string | null;
  subType?: string | null;
}

export interface ReportFight {
  id: number;
  encounterID?: number | null;
  name?: string | null;
  keystoneLevel?: number | null;
  keystoneBonus?: number | null;
  startTime: number;
  endTime: number;
  friendlyPlayers?: Array<number | { id: number }> | null;
  inProgress?: boolean | null;
}

export interface ReportFightPayload {
  code: string;
  startTime: number;
  endTime?: number | null;
  visibility?: string | null;
  revision?: number | null;
  zone?: { id?: number | null; name?: string | null } | null;
  fights: ReportFight[];
  masterData?: { actors?: ReportFightActor[] | null } | null;
}

export function timedFromKeystoneBonus(keystoneBonus: number | null | undefined): boolean | null {
  if (keystoneBonus == null || !Number.isFinite(keystoneBonus)) return null;
  return keystoneBonus >= 1;
}

export function resolveDungeonSlug(
  fight: ReportFight,
  reportZoneName?: string | null,
): string | null {
  if (fight.encounterID != null && ENCOUNTER_DUNGEON_MAP[fight.encounterID]) {
    return ENCOUNTER_DUNGEON_MAP[fight.encounterID]!;
  }
  const reportZoneTrimmed = reportZoneName?.trim() ?? null;
  const reportZoneLower = reportZoneTrimmed?.toLowerCase() ?? null;
  const looksLikeMplusContainerZone =
    reportZoneLower === "mythic" ||
    reportZoneLower === "mythic+" ||
    reportZoneLower?.startsWith("mythic+");

  if (fight.name && fight.name.trim()) {
    if (reportZoneTrimmed && !looksLikeMplusContainerZone) {
      return slugifyDungeonName(reportZoneTrimmed);
    }
    return slugifyDungeonName(fight.name);
  }
  if (reportZoneTrimmed && !looksLikeMplusContainerZone) {
    return slugifyDungeonName(reportZoneTrimmed);
  }
  return null;
}

export function isMythicPlusFight(fight: ReportFight): boolean {
  return typeof fight.keystoneLevel === "number" && fight.keystoneLevel > 0;
}

export function resolveTargetActorId(
  actors: ReportFightActor[],
  friendlyPlayers: ReportFight["friendlyPlayers"],
  characterName: string,
  realmSlug: string,
): number | null {
  const ownership = resolveFightOwnership({
    actors: actors as never,
    friendlyPlayers,
    characterName,
    realmSlug,
    requireMythicPlus: false,
  });
  return ownership.ok ? ownership.targetActorId : null;
}

export function resolveFightTargetOwnership(
  fight: ReportFight,
  actors: ReportFightActor[],
  characterName: string,
  realmSlug: string,
):
  | { ok: true; targetActorId: number; fightFriendlyPlayerActorIds: number[] }
  | {
      ok: false;
      reason: FightOwnershipRejectionReason;
      targetActorId: number | null;
      fightFriendlyPlayerActorIds: number[];
    } {
  const ownership = resolveFightOwnership({
    actors: actors as never,
    friendlyPlayers: fight.friendlyPlayers,
    characterName,
    realmSlug,
    keystoneLevel: fight.keystoneLevel,
    inProgress: fight.inProgress,
    requireMythicPlus: true,
  });
  if (ownership.ok) {
    return {
      ok: true,
      targetActorId: ownership.targetActorId,
      fightFriendlyPlayerActorIds: ownership.fightFriendlyPlayerActorIds,
    };
  }
  return {
    ok: false,
    reason: ownership.reason,
    targetActorId: ownership.targetActorId,
    fightFriendlyPlayerActorIds: ownership.fightFriendlyPlayerActorIds,
  };
}

export { extractFriendlyPlayerActorIds };

export function mappedFightToCandidate(
  report: ReportFightPayload,
  fight: ReportFight,
  targetActorId: number,
): WclRunCandidate {
  const dungeonSlug = resolveDungeonSlug(fight, report.zone?.name);
  const durationMs = Math.max(0, fight.endTime - fight.startTime);
  const completedAtMs = report.startTime + fight.endTime;
  const keyLevel = fight.keystoneLevel ?? null;
  const completedAt = new Date(completedAtMs).toISOString();
  const timed = timedFromKeystoneBonus(fight.keystoneBonus);
  const reportRevision =
    typeof report.revision === "number" && Number.isFinite(report.revision)
      ? report.revision
      : null;

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
    timed,
    selectionTags: [],
    source: "encounterRankings",
    matchConfidence: null,
    targetActorId,
    reportRevision,
    incompleteness: {
      dungeonUnknown: dungeonSlug == null,
      seasonUnknown: true,
      timedUnknown: timed == null,
      keyLevelUnknown: keyLevel == null,
      rosterIncomplete: true,
    },
    warnings: [
      "mapped from selected report fight/masterData",
      ...(dungeonSlug == null ? ["dungeonSlug unresolved from encounter/fight name"] : []),
      ...(timed == null ? ["timed unresolved — keystoneBonus absent"] : []),
      ...(reportRevision == null ? ["reportRevision unresolved from WCL metadata"] : []),
    ],
  };
}

export function candidatesFromMappedReport(
  report: ReportFightPayload,
  characterName: string,
  realmSlug: string,
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
      rejected.push(`fight_${fight.id}_FIGHT_NOT_MYTHIC_PLUS`);
      continue;
    }
    mplusSeen += 1;
    if (mplusSeen > MAX_FIGHTS_PER_MAPPED_REPORT) {
      rejected.push(`fight_${fight.id}_over_report_cap`);
      continue;
    }
    const ownership = resolveFightTargetOwnership(fight, actors, characterName, realmSlug);
    if (!ownership.ok) {
      rejected.push(`fight_${fight.id}_${ownership.reason}`);
      continue;
    }
    candidates.push(mappedFightToCandidate(report, fight, ownership.targetActorId));
  }

  return { candidates, rejected };
}
