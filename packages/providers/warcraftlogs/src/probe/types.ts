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
  /** Partition passed to zoneRankings (null = WCL current default). */
  partitionUsed: number | null;
}

/** Spec-level All Stars row from zoneRankings.allStars. */
export interface PerformanceSpecRank {
  spec: string | null;
  points: number | null;
  possiblePoints: number | null;
  rank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  rankPercent: number | null;
  total: number | null;
  partition: number | null;
}

/**
 * Global Mythic+ character summary — mirrors the WCL character M+ header.
 * Logged-run counts affect confidence only; they are not score inputs.
 */
export interface PerformanceGlobalSummary {
  totalMythicPlusScore: number | null;
  bestPerformanceAverage: number | null;
  medianPerformanceAverage: number | null;
  totalLoggedRuns: number;
  partition: number | null;
  metric: string | null;
  difficulty: number | null;
  zoneId: number | null;
  specRanks: PerformanceSpecRank[];
}

/**
 * Per-dungeon row from zoneRankings.rankings (character summary page).
 * keystoneLevel / completionTimeMs are explanatory; ratingPoints already includes them.
 */
export interface PerformanceDungeonSummary {
  encounterId: number | null;
  encounterName: string | null;
  dungeonSlug: string | null;
  keystoneLevel: number | null;
  completionTimeMs: number | null;
  loggedRunCount: number;
  ratingPoints: number | null;
  scoreRank: number | null;
  regionRank: number | null;
  serverRank: number | null;
  specialization: string | null;
  bestDps: number | null;
  bestPerformancePercentile: number | null;
  medianPerformancePercentile: number | null;
  lockedIn: boolean | null;
}

export interface PerformanceProbeDataset {
  probeVersion: "2";
  probedAt: string;
  identity: PerformanceProbeIdentity;
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  /** Character-page summary extracted from zoneRankings. */
  summary: {
    global: PerformanceGlobalSummary;
    dungeons: PerformanceDungeonSummary[];
    unavailableEncounters: Array<{
      encounterID: number;
      encounterName: string | null;
      dungeonSlug: string | null;
      reason: "no_zone_rankings_row";
    }>;
  };
  /**
   * Complete raw zoneRankings payload (JSON scalar parsed when needed).
   * No assumption about internal structure beyond permissive extraction.
   */
  rawZoneRankings: unknown;
  diagnostics: {
    source: "character.zoneRankings";
    query: {
      zoneID: number;
      metric: "playerscore";
      byBracket: true;
      partition: number | null;
      compare: null;
      specName: null;
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
