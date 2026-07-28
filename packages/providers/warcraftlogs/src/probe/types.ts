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
  scoreRankPercent: number | null;
  total: number | null;
  partition: number | null;
}

export interface RunCompletionMetadata {
  fastestKillRaw: number | null;
  speedRaw: number | null;
  fightMetadataRaw: number | null;
  leaderboardRaw: number | null;
  affixesRaw: number | null;
  completionTimeMs: null;
  encodingStatus: "unverified_not_emitted";
  encodingNote: string;
}

export interface PerformanceGlobalSummary {
  totalMythicPlusScore: number | null;
  /**
   * Arithmetic mean of the 8 per-dungeon Best execution % values.
   * Distinct from WCL payload bestPerformanceAverage (compared in diagnostics).
   */
  bestDpsPercentileAverage: number | null;
  /**
   * Arithmetic mean of the 8 per-dungeon Median execution % values.
   * Distinct from WCL payload medianPerformanceAverage (compared in diagnostics).
   */
  medianDpsPercentileAverage: number | null;
  /** WCL-supplied global averages from the points_and_damage payload, when present. */
  wclBestPerformanceAverage: number | null;
  wclMedianPerformanceAverage: number | null;
  totalLoggedRuns: number;
  partition: number | null;
  zoneId: number | null;
  metric: "points_and_damage";
  /** Payload-level filter sentinels (e.g. difficulty/size 5000 = unrestricted). */
  itemLevelFilter: {
    difficulty: number | null;
    size: number | null;
  } | null;
  specRanks: PerformanceSpecRank[];
}

export interface PerformanceDungeonSummary {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  keystoneLevel: number | null;
  /** Displayed contextual run count from score rankings (e.g. totalKills). */
  displayedRunCount: number;
  /** Throughput sample size from throughputRankings when provided. */
  throughputSampleCount: number | null;
  /** Bracket / key used for throughput comparison when provided. */
  throughputBracket: number | null;
  /** Item-level filter metadata from throughput row when provided. */
  itemLevelFilter: unknown;
  ratingPoints: number | null;
  scoreRank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  scoreRankPercent: number | null;
  specialization: string | null;
  bestDps: number | null;
  bestExecutionPercentile: number | null;
  medianExecutionPercentile: number | null;
  lockedIn: boolean | null;
  completion: RunCompletionMetadata;
}

export interface PerformanceProbeDataset {
  probeVersion: "4";
  probedAt: string;
  identity: PerformanceProbeIdentity;
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
      reason: "no_score_row" | "no_throughput_row" | "no_zone_rankings_row";
    }>;
  };
  /** Complete raw points_and_damage zoneRankings JSON. */
  rawZoneRankingsPointsAndDamage: unknown;
  diagnostics: {
    source: "character.zoneRankings";
    state: "OK" | "ERROR";
    query: {
      zoneID: number;
      metric: "points_and_damage";
      byBracket: true;
      partition: number | null;
      ok: boolean;
    };
    dungeonRowCount: number;
    unavailableEncounterCount: number;
    averageComparison: {
      computedBestAverage: number | null;
      wclBestPerformanceAverage: number | null;
      computedMedianAverage: number | null;
      wclMedianPerformanceAverage: number | null;
    } | null;
    note: string;
  };
  graphqlErrors: GraphQlErrorRecord[];
  rateLimit: {
    initial: WclRateLimitSnapshot | null;
    final: WclRateLimitSnapshot | null;
    perOperation: ProbeRateLimitRecord[];
  };
}
