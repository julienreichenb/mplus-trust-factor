import { ENCOUNTER_DUNGEON_MAP } from "../discovery/run-discovery.js";
import type {
  EligibleLoggedRun,
  ProbeFightRow,
  ProbeZoneEncounter,
  SelectedHighestRatedRun,
} from "./types.js";

export const PROBE_RECENT_REPORTS_PAGE_LIMIT = 100;

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

export function isPublicAccessibleReport(visibility: string | null | undefined): boolean {
  return (visibility ?? "public").toLowerCase() === "public";
}

export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
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
      dungeonSlug: ENCOUNTER_DUNGEON_MAP[encounter.id] ?? null,
    }));
  }
  return Object.entries(ENCOUNTER_DUNGEON_MAP).map(([id, dungeonSlug]) => ({
    id: Number(id),
    name: null,
    dungeonSlug,
  }));
}

export function zoneEncounterIdSet(encounters: ProbeZoneEncounter[]): Set<number> {
  return new Set(encounters.map((e) => e.id));
}

export function toAbsoluteTimestamp(reportStartTimeMs: number, fightOffsetMs: number): string | null {
  if (!Number.isFinite(reportStartTimeMs) || !Number.isFinite(fightOffsetMs)) return null;
  return new Date(reportStartTimeMs + fightOffsetMs).toISOString();
}

export function mapRawFightRow(
  fight: Record<string, unknown>,
  reportStartTimeMs: number,
): ProbeFightRow {
  const startTime = coerceFiniteNumber(fight.startTime) ?? 0;
  const endTime = coerceFiniteNumber(fight.endTime) ?? 0;
  return {
    id: coerceFiniteNumber(fight.id) ?? 0,
    encounterID: coerceFiniteNumber(fight.encounterID),
    name: typeof fight.name === "string" ? fight.name : null,
    difficulty: coerceFiniteNumber(fight.difficulty),
    kill: typeof fight.kill === "boolean" ? fight.kill : null,
    inProgress: typeof fight.inProgress === "boolean" ? fight.inProgress : null,
    startTime,
    endTime,
    keystoneLevel: coerceFiniteNumber(fight.keystoneLevel),
    keystoneTime: coerceFiniteNumber(fight.keystoneTime),
    rating: coerceFiniteNumber(fight.rating),
    startTimeAbsolute: toAbsoluteTimestamp(reportStartTimeMs, startTime),
    endTimeAbsolute: toAbsoluteTimestamp(reportStartTimeMs, endTime),
  };
}

export function isEligibleMplusFight(
  fight: ProbeFightRow,
  zoneEncounterIds: Set<number>,
): boolean {
  if (fight.encounterID == null || !zoneEncounterIds.has(fight.encounterID)) return false;
  if (fight.kill !== true) return false;
  if (fight.inProgress === true) return false;
  if (fight.rating == null) return false;
  if (fight.keystoneLevel == null) return false;
  return true;
}

export function fightToEligibleRun(
  fight: ProbeFightRow,
  reportCode: string,
  reportStartTimeMs: number,
  encounters: ProbeZoneEncounter[],
): EligibleLoggedRun | null {
  if (fight.encounterID == null || fight.rating == null || fight.keystoneLevel == null) {
    return null;
  }
  const encounter = encounters.find((e) => e.id === fight.encounterID);
  const startAbsolute =
    fight.startTimeAbsolute ?? toAbsoluteTimestamp(reportStartTimeMs, fight.startTime);
  const endAbsolute = fight.endTimeAbsolute ?? toAbsoluteTimestamp(reportStartTimeMs, fight.endTime);
  if (!startAbsolute || !endAbsolute) return null;

  return {
    reportCode,
    fightID: fight.id,
    encounterID: fight.encounterID,
    encounterName: encounter?.name ?? fight.name,
    dungeonSlug: encounter?.dungeonSlug ?? null,
    rating: fight.rating,
    keystoneLevel: fight.keystoneLevel,
    keystoneTime: fight.keystoneTime,
    kill: true,
    startTimeMs: fight.startTime,
    endTimeMs: fight.endTime,
    startTimeAbsolute: startAbsolute,
    endTimeAbsolute: endAbsolute,
    reportStartTimeMs,
  };
}

export function selectHighestRatedRunPerEncounter(
  runs: EligibleLoggedRun[],
): SelectedHighestRatedRun[] {
  const bestByEncounter = new Map<number, EligibleLoggedRun>();
  for (const run of runs) {
    const existing = bestByEncounter.get(run.encounterID);
    if (!existing || run.rating > existing.rating) {
      bestByEncounter.set(run.encounterID, run);
    }
  }
  return [...bestByEncounter.values()]
    .sort((a, b) => a.encounterID - b.encounterID)
    .map((run) => ({
      ...run,
      selectionReason: "highest_rating_per_encounter" as const,
    }));
}

export function collectUnavailableEncounters(
  encounters: ProbeZoneEncounter[],
  selected: SelectedHighestRatedRun[],
): Array<{
  encounterID: number;
  encounterName: string | null;
  dungeonSlug: string | null;
  reason: "no_eligible_logged_run";
}> {
  const selectedIds = new Set(selected.map((s) => s.encounterID));
  return encounters
    .filter((encounter) => !selectedIds.has(encounter.id))
    .map((encounter) => ({
      encounterID: encounter.id,
      encounterName: encounter.name,
      dungeonSlug: encounter.dungeonSlug,
      reason: "no_eligible_logged_run" as const,
    }));
}
