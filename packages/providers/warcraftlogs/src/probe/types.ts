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

export interface ProbeZonePartition {
  id: number;
  name: string | null;
}

export interface ProbeZoneRecord {
  config: MplusZoneConfig;
  worldData: {
    id: number;
    name: string;
    frozen: boolean | null;
    encounters: ProbeZoneEncounter[];
    partitions: ProbeZonePartition[];
  } | null;
  partitionUsed: number | null;
}

export interface PerformanceSpecRank {
  spec: string | null;
  points: number | null;
  possiblePoints: number | null;
  rank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  /** All-stars score percentile — not an execution (DPS) parse. */
  scoreRankPercent: number | null;
  total: number | null;
  partition: number | null;
}

/**
 * Raw run-completion metadata from the playerscore zoneRankings row.
 * completionTimeMs is intentionally null until WCL's fastestKill/speed packing is confirmed.
 * See docs in performance-probe-logic.ts (investigateSpeedFastestKillEncoding).
 */
export interface RunCompletionMetadata {
  fastestKillRaw: number | null;
  speedRaw: number | null;
  fightMetadataRaw: number | null;
  leaderboardRaw: number | null;
  affixesRaw: number | null;
  /**
   * Always null in v3 until encoding is verified against ReportFight.keystoneTime.
   * Do not invent a conversion from fastestKill/speed.
   */
  completionTimeMs: null;
  encodingStatus: "unverified_not_emitted";
  encodingNote: string;
}

export interface PerformanceGlobalSummary {
  totalMythicPlusScore: number | null;
  /** From metric:dps zoneRankings.bestPerformanceAverage */
  bestDpsPercentileAverage: number | null;
  /** From metric:dps zoneRankings.medianPerformanceAverage */
  medianDpsPercentileAverage: number | null;
  totalLoggedRuns: number;
  partition: number | null;
  zoneId: number | null;
  scoreMetric: "playerscore";
  executionMetric: "dps";
  specRanks: PerformanceSpecRank[];
}

export interface PerformanceDungeonSummary {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  /** From playerscore bestRank.ilvl when byBracket: true */
  keystoneLevel: number | null;
  loggedRunCount: number;
  ratingPoints: number | null;
  scoreRank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  /** playerscore row rankPercent / allStars.rankPercent — not DPS execution. */
  scoreRankPercent: number | null;
  specialization: string | null;
  /** From dps row bestAmount */
  bestDps: number | null;
  /** From dps row rankPercent */
  bestExecutionPercentile: number | null;
  /** From dps row medianPercent */
  medianExecutionPercentile: number | null;
  lockedIn: boolean | null;
  completion: RunCompletionMetadata;
}

export interface PerformanceProbeDataset {
  probeVersion: "3";
  probedAt: string;
  identity: PerformanceProbeIdentity;
  /** OK when both zoneRankings queries succeed; ERROR when either fails. */
  state: "OK" | "ERROR";
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  summary: {
    global: PerformanceGlobalSummary | null;
    dungeons: PerformanceDungeonSummary[];
    unavailableEncounters: Array<{
      encounterID: number;
      encounterName: string | null;
      dungeonSlug: string | null;
      reason: "no_score_row" | "no_execution_row" | "no_zone_rankings_row";
    }>;
  };
  rawZoneRankingsScore: unknown;
  rawZoneRankingsExecution: unknown;
  diagnostics: {
    source: "character.zoneRankings";
    state: "OK" | "ERROR";
    scoreQuery: {
      zoneID: number;
      metric: "playerscore";
      byBracket: true;
      partition: number | null;
      ok: boolean;
    };
    executionQuery: {
      zoneID: number;
      metric: "dps";
      byBracket: true;
      partition: number | null;
      ok: boolean;
    };
    dungeonRowCount: number;
    unavailableEncounterCount: number;
    note: string;
  };
  graphqlErrors: GraphQlErrorRecord[];
  rateLimit: {
    initial: WclRateLimitSnapshot | null;
    final: WclRateLimitSnapshot | null;
    perOperation: ProbeRateLimitRecord[];
  };
}
