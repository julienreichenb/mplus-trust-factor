import type { RegionCode } from "@mplus/contracts";
import type { MplusZoneConfig } from "../discovery/mplus-zone.js";
import type { WclRateLimitSnapshot } from "../types.js";

export interface PerformanceProbeIdentity {
  region: RegionCode;
  realmSlug: string;
  name: string;
}

export interface GraphQlErrorRecord {
  operationName: string;
  messages: string[];
}

export interface ProbeRateLimitRecord {
  operationName: string;
  costUnits: number | null;
  durationMs: number;
  snapshot: WclRateLimitSnapshot | null;
}

export interface ProbeCharacterRecord {
  id: number;
  canonicalID: number;
  name: string;
  level: number | null;
  classID: number | null;
  hidden: boolean;
  server: { slug: string; regionName: string | null };
}

export interface ProbeZoneEncounter {
  id: number;
  name: string | null;
  dungeonSlug: string | null;
}

export interface ProbeZoneRecord {
  config: MplusZoneConfig;
  worldData: {
    id: number;
    name: string;
    frozen: boolean | null;
    encounters: ProbeZoneEncounter[];
  } | null;
}

export interface ProbeRecentReportRow {
  code: string;
  title: string | null;
  startTime: number;
  endTime: number | null;
  visibility: string | null;
  zone: { id: number; name: string | null } | null;
}

export interface ProbeReportPage {
  page: number;
  limit: number;
  total: number | null;
  hasMorePages: boolean | null;
  reports: ProbeRecentReportRow[];
  graphqlErrors: string[];
  costUnits: number | null;
  durationMs: number;
}

export interface ProbeFightRow {
  id: number;
  encounterID: number | null;
  name: string | null;
  difficulty: number | null;
  kill: boolean | null;
  inProgress: boolean | null;
  startTime: number;
  endTime: number;
  keystoneLevel: number | null;
  keystoneTime: number | null;
  rating: number | null;
  startTimeAbsolute: string | null;
  endTimeAbsolute: string | null;
}

export interface ProbeReportFightsRecord {
  reportCode: string;
  report: {
    code: string;
    title: string | null;
    startTime: number;
    endTime: number | null;
    visibility: string | null;
    zone: { id: number; name: string | null } | null;
  } | null;
  fights: ProbeFightRow[];
  graphqlErrors: string[];
  costUnits: number | null;
  durationMs: number;
  fetchError: string | null;
}

export interface EligibleLoggedRun {
  reportCode: string;
  fightID: number;
  encounterID: number;
  encounterName: string | null;
  dungeonSlug: string | null;
  rating: number;
  keystoneLevel: number;
  keystoneTime: number | null;
  kill: true;
  startTimeMs: number;
  endTimeMs: number;
  startTimeAbsolute: string;
  endTimeAbsolute: string;
  reportStartTimeMs: number;
}

export interface SelectedHighestRatedRun extends EligibleLoggedRun {
  selectionReason: "highest_rating_per_encounter";
}

export interface PerformanceProbeDataset {
  probeVersion: "1";
  probedAt: string;
  identity: PerformanceProbeIdentity;
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  reports: {
    totalFromApi: number | null;
    publicAccessibleCount: number;
    pagesFetched: number;
    rows: ProbeRecentReportRow[];
  };
  eligibleLoggedRuns: EligibleLoggedRun[];
  selectedHighestRatedRuns: SelectedHighestRatedRun[];
  unavailableEncounters: Array<{
    encounterID: number;
    encounterName: string | null;
    dungeonSlug: string | null;
    reason: "no_eligible_logged_run";
  }>;
  rawZoneRankings: unknown;
  paginationDiagnostics: {
    pageLimit: number;
    pagesFetched: number;
    totalReportsListed: number | null;
    publicReportsKept: number;
    reportsWithFightsFetched: number;
    reportsWithFetchErrors: number;
    totalFightsSeen: number;
    eligibleFightCount: number;
  };
  graphqlErrors: GraphQlErrorRecord[];
  rateLimit: {
    initial: WclRateLimitSnapshot | null;
    final: WclRateLimitSnapshot | null;
    perOperation: ProbeRateLimitRecord[];
  };
}
