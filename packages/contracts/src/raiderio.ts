import type { IsoDateTime, RegionCode } from "./identity.js";

/** Attribution required when Raider.IO-derived data is shown publicly. */
export interface RaiderIoAttribution {
  provider: "raiderio";
  displayText: "Data from Raider.IO";
  homepageUrl: "https://raider.io";
  profileUrl: string | null;
  sourceUrl: string | null;
}

export interface RaiderIoScoreSummary {
  all: number;
  dps: number | null;
  healer: number | null;
  tank: number | null;
}

export interface RaiderIoSeasonScores {
  seasonSlug: string;
  scores: RaiderIoScoreSummary;
  isCurrentSeason: boolean;
  isPreviousSeason: boolean;
}

export interface RaiderIoRankSummary {
  overall: number | null;
  class: number | null;
  server: number | null;
  world: number | null;
  region: number | null;
  role: string | null;
}

export interface RaiderIoRosterMember {
  providerCharacterKey: string;
  displayName: string;
  realmSlug: string;
  region: RegionCode;
  classSlug: string | null;
  specSlug: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  mythicRating: number | null;
  rankOverall: number | null;
}

export interface RaiderIoRunCandidate {
  externalRunId: string;
  seasonSlug: string;
  dungeonSlug: string;
  dungeonName: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  durationMs: number;
  timerMs: number | null;
  timed: boolean;
  scoreValue: number | null;
  source: "recent" | "best" | "highest_level";
  roster: RaiderIoRosterMember[];
  rosterComplete: boolean;
  profileUrl: string | null;
}

export interface RaiderIoRaidProgressionEntry {
  raidSlug: string;
  raidName: string;
  summary: string;
  totalBosses: number;
  normalBossesKilled: number;
  heroicBossesKilled: number;
  mythicBossesKilled: number;
}

export interface RaiderIoGearItem {
  slot: string;
  itemId: number | null;
  itemLevel: number | null;
  name: string | null;
  icon: string | null;
  quality: number | null;
}

export interface RaiderIoGearSummary {
  itemLevelEquipped: number | null;
  itemLevelTotal: number | null;
  items: RaiderIoGearItem[];
}

/** Minimal talent presence marker; full loadout parsing stays provider-local until needed. */
export interface RaiderIoTalentSummary {
  present: boolean;
  shape: "object" | "array" | "absent";
}

export interface RaiderIoCharacterProfile {
  region: RegionCode;
  realmSlug: string;
  normalizedName: string;
  displayName: string;
  classSlug: string | null;
  specSlug: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  profileUrl: string;
  lastCrawledAt: IsoDateTime | null;
  /** True when `lastCrawledAt` is older than the provider stale threshold. */
  crawlStale: boolean;
  gear: RaiderIoGearSummary | null;
  talents: RaiderIoTalentSummary | null;
  currentSeason: RaiderIoSeasonScores | null;
  previousSeason: RaiderIoSeasonScores | null;
  ranks: RaiderIoRankSummary | null;
  recentRuns: RaiderIoRunCandidate[];
  bestRuns: RaiderIoRunCandidate[];
  highestLevelRuns: RaiderIoRunCandidate[];
  raidProgression: RaiderIoRaidProgressionEntry[];
  runHistoryIncomplete: boolean;
  representedRunCount: number;
  attribution: RaiderIoAttribution;
}

export type RaiderIoCutoffQuantile = "p999" | "p990" | "p900" | "p750" | "p600";

export type RaiderIoCutoffLabel =
  | "top_0_1_percent"
  | "top_1_percent"
  | "top_10_percent"
  | "top_25_percent"
  | "top_40_percent";

export interface RaiderIoCutoffThreshold {
  score: number;
  quantile: RaiderIoCutoffQuantile;
  label: RaiderIoCutoffLabel;
  /** Combined (`all`) population at/above this quantile when Raider.IO provides it. */
  quantilePopulationCount?: number | null;
  /** Combined (`all`) regional Mythic+ population when Raider.IO provides it. */
  totalPopulationCount?: number | null;
}

export interface RaiderIoSeasonCutoffs {
  region: RegionCode;
  seasonSlug: string | null;
  updatedAt: IsoDateTime | null;
  /** p999 — 99.9th percentile threshold ≈ top 0.1%. */
  top0_1Percent: RaiderIoCutoffThreshold | null;
  /** p990 — 99th percentile threshold ≈ top 1%. */
  top1Percent: RaiderIoCutoffThreshold | null;
  /** p900 — 90th percentile threshold ≈ top 10%. */
  top10Percent: RaiderIoCutoffThreshold | null;
  /** p750 — 75th percentile threshold ≈ top 25%. */
  top25Percent: RaiderIoCutoffThreshold | null;
  /** p600 — 60th percentile threshold ≈ top 40%. */
  top40Percent: RaiderIoCutoffThreshold | null;
  attribution: RaiderIoAttribution;
}

export interface RaiderIoStaticDungeon {
  slug: string;
  name: string;
  shortName: string;
  mapChallengeModeId: number | null;
  zoneId: number | null;
}

export interface RaiderIoStaticSeason {
  slug: string;
  name: string;
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  isCurrent: boolean;
  dungeonSlugs: string[];
}

export interface RaiderIoStaticData {
  expansionId: number;
  seasons: RaiderIoStaticSeason[];
  dungeons: RaiderIoStaticDungeon[];
  attribution: RaiderIoAttribution;
}

export interface RaiderIoPeriod {
  id: number;
  seasonSlug: string | null;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
}

export interface RaiderIoRunDetails {
  externalRunId: string;
  seasonSlug: string;
  dungeonSlug: string;
  dungeonName: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  durationMs: number;
  timerMs: number | null;
  timed: boolean;
  scoreValue: number | null;
  roster: RaiderIoRosterMember[];
  profileUrl: string | null;
  attribution: RaiderIoAttribution;
}

/** Neutral facts for authenticity/boost analysis (Agent 4). Does not compute boost verdicts. */
export interface RaiderIoBoostSupportFacts {
  targetCharacterKey: string;
  snapshotAt: IsoDateTime;
  currentSeasonScore: number | null;
  previousSeasonScore: number | null;
  currentRanks: RaiderIoRankSummary | null;
  runs: Array<{
    externalRunId: string;
    completedAt: IsoDateTime;
    dungeonSlug: string;
    keyLevel: number;
    durationMs: number;
    timed: boolean;
    scoreValue: number | null;
    source: RaiderIoRunCandidate["source"];
    teammates: RaiderIoRosterMember[];
  }>;
  teammateRecurrence: Array<{
    providerCharacterKey: string;
    sharedRunCount: number;
    averageTeammateScore: number | null;
  }>;
  representedRunCount: number;
  historyIncomplete: boolean;
  attribution: RaiderIoAttribution;
}
