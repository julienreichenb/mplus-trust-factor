import type { IsoDateTime, RegionCode } from "@mplus/contracts";
import type {
  RunCombatFactsCoverage,
  RunCombatFactsLimitations,
  WclDataState,
  WclVisibilityState,
} from "@mplus/contracts";

export type {
  RunCombatFactsCoverage,
  RunCombatFactsLimitations,
  WclDataState,
  WclVisibilityState,
};

/**
 * Character / evidence visibility on Warcraft Logs public API.
 * Absence of logs must never directly lower performance score — coverage only.
 * Canonical definition lives in `@mplus/contracts` (CR-14).
 */

export interface WclCharacterSummary {
  wclCharacterId: number;
  canonicalId: number;
  name: string;
  realmSlug: string;
  region: RegionCode;
  classId: number | null;
  level: number | null;
  hidden: boolean;
  /** Explicit profile visibility only (PUBLIC | HIDDEN). */
  visibility: WclVisibilityState | null;
  /** Matching / rankings / availability outcome. */
  dataState: WclDataState;
  fetchedAt: IsoDateTime;
  /** Zone / discovery warnings (expiry, truncated candidates, private skips). */
  warnings: string[];
}

export interface WclRankingObservation {
  reportCode: string;
  fightId: number;
  encounterId: number;
  zoneId: number | null;
  bracket: number | null;
  keyLevel: number | null;
  score: number | null;
  amount: number | null;
  percentile: number | null;
  /** WCL rankPercent for this specific parse row when present. */
  rankPercent: number | null;
  /** Bracket-relative percentile when WCL exposes bracketPercent. */
  bracketPercent: number | null;
  specSlug: string | null;
  roleSlug: string | null;
  durationMs: number | null;
  startTimeMs: number | null;
  reportStartTimeMs: number | null;
  timed: boolean | null;
  metric: string | null;
}

/** Incomplete / unknown facts on a discovery candidate — never invent certainty. */
export interface WclRunCandidateIncompleteness {
  dungeonUnknown: boolean;
  seasonUnknown: boolean;
  timedUnknown: boolean;
  keyLevelUnknown: boolean;
  rosterIncomplete: boolean;
  fightUnknown: boolean;
}

export type RunMatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface WclRunCandidate {
  reportCode: string;
  fightId: number;
  encounterId: number;
  zoneId: number | null;
  /** Null when encounter→dungeon mapping is unknown — do not claim a dungeon. */
  dungeonSlug: string | null;
  /** Null until season metadata is wired — do not claim "current". */
  seasonSlug: string | null;
  keyLevel: number | null;
  score: number | null;
  startTimeMs: number | null;
  completedAt: IsoDateTime | null;
  durationMs: number | null;
  /**
   * Timed only when source evidence exists (timer comparison).
   * Kill ≠ timed. Null means unknown — never default to true.
   */
  timed: boolean | null;
  selectionTags: Array<"LATEST" | "HIGHEST">;
  source: "zoneRankings" | "recentReports";
  /** Cross-provider match confidence when an external run was compared; else null. */
  matchConfidence: RunMatchConfidence | null;
  /** Resolved during report hydration; null until masterData/friendlyPlayers resolve the target. */
  targetActorId?: number | null;
  incompleteness: WclRunCandidateIncompleteness;
  warnings: string[];
}

export interface WclReportSummary {
  code: string;
  title: string;
  revision: number;
  startTimeMs: number;
  endTimeMs: number;
  visibility: string;
  zoneId: number | null;
  zoneName: string | null;
}

export interface WclFightSummary {
  id: number;
  encounterId: number | null;
  name: string | null;
  difficulty: number | null;
  kill: boolean | null;
  startTime: number;
  endTime: number;
  bracket: number | null;
  keystoneLevel: number | null;
  friendlyPlayers: WclFightPlayer[];
}

export interface WclFightPlayer {
  id: number;
  name: string;
  server: string;
  type: string;
  icon: string | null;
}

export interface WclActorMap {
  byId: Map<number, WclActorEntry>;
  byName: Map<string, number[]>;
}

export interface WclActorEntry {
  id: number;
  name: string;
  type: string;
  subType: string | null;
  server: string | null;
}

export interface WclCastEvent {
  timestamp: number;
  abilityGameId: number;
  sourceId: number;
  targetId: number | null;
}

export interface WclInterruptEvent {
  timestamp: number;
  abilityGameId: number;
  sourceId: number;
  targetId: number | null;
  interruptedAbilityGameId: number | null;
}

export interface WclDeathEvent {
  timestamp: number;
  sourceId: number;
  targetId: number;
  killerId: number | null;
  abilityGameId: number | null;
}

export interface WclDamageTakenEvent {
  timestamp: number;
  sourceId: number | null;
  targetId: number;
  abilityGameId: number;
  amount: number;
}

export interface WclAuraEvent {
  timestamp: number;
  type: "apply" | "remove" | "refresh";
  abilityGameId: number;
  sourceId: number;
  targetId: number;
}

export interface WclDispelEvent {
  timestamp: number;
  abilityGameId: number;
  sourceId: number;
  targetId: number;
  dispelledAbilityGameId: number | null;
}

export interface WclHealingEvent {
  timestamp: number;
  abilityGameId: number;
  sourceId: number;
  targetId: number;
  amount: number;
  overheal: number | null;
}

export interface WclCombatantInfo {
  sourceId: number;
  specId: number | null;
  gear: unknown;
  talents: unknown;
  artifactTraits: unknown;
}

export interface RunCombatFacts {
  reportCode: string;
  fightId: number;
  revision: number;
  targetSourceId: number;
  /** Player + attributed pet source IDs used for utility extraction. */
  attributedSourceIds: number[];
  actorMap: WclActorMap;
  casts: WclCastEvent[];
  interrupts: WclInterruptEvent[];
  deaths: WclDeathEvent[];
  damageTaken: WclDamageTakenEvent[];
  auras: WclAuraEvent[];
  dispels: WclDispelEvent[];
  healing: WclHealingEvent[];
  combatantInfo: WclCombatantInfo | null;
  coverage: RunCombatFactsCoverage;
  limitations: RunCombatFactsLimitations;
}

export interface RunMatchEvidence {
  dungeonMatch: boolean;
  keyLevelMatch: boolean;
  keyLevelDelta: number | null;
  timeDeltaMs: number | null;
  durationDeltaMs: number | null;
  rosterOverlapRatio: number | null;
}

export interface RunMatchResult {
  confidence: RunMatchConfidence;
  evidence: RunMatchEvidence;
  autoMergeAllowed: boolean;
}

export interface WclRateLimitSnapshot {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsRemaining: number;
  resetAt: IsoDateTime | null;
  fetchedAt: IsoDateTime;
}

export type WclRateBudgetAction = "OK" | "WARN" | "DEFER" | "STOP";

export interface WclRateBudgetDecision {
  action: WclRateBudgetAction;
  utilizationPercent: number;
  snapshot: WclRateLimitSnapshot;
}

/** Raw completion metadata from points_and_damage score rows (no completionTimeMs). */
export interface WclPerformanceCompletionMetadata {
  fastestKillRaw: number | null;
  speedRaw: number | null;
  fightMetadataRaw: number | null;
  leaderboardRaw: number | null;
  affixesRaw: number | null;
  completionTimeMs: null;
  encodingStatus: "unverified_not_emitted";
  encodingNote: string;
}

/**
 * Per-dungeon Performance row from points_and_damage zoneRankings.
 * Peak/consistency use best/median execution percentiles only.
 * ratingPoints / keystoneLevel / scoreRankPercent stay diagnostic (not in score).
 */
export interface WclDungeonPerformanceAggregate {
  dungeonSlug: string;
  dungeonName: string;
  encounterId: number | null;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  /** Displayed contextual run count (totalKills); confidence input only. */
  loggedRunCount: number;
  specSlug: string | null;
  roleSlug: string | null;
  keystoneLevel?: number | null;
  throughputBracket?: number | null;
  ratingPoints?: number | null;
  scoreRank?: number | null;
  regionRank?: number | null;
  serverRank?: number | null;
  scoreRankPercent?: number | null;
  specialization?: string | null;
  bestDps?: number | null;
  completion?: WclPerformanceCompletionMetadata | null;
}

export interface WclCharacterDiscoveryResult {
  summary: WclCharacterSummary;
  rankings: WclRankingObservation[];
  /** Equal-weight dungeon aggregates for PERFORMANCE (not used for run discovery). */
  dungeonAggregates: WclDungeonPerformanceAggregate[];
  /**
   * points_and_damage Performance fetch result (raw + state).
   * GraphQL/schema failures must not appear as an empty valid dataset.
   */
  performance?: import("./discovery/points-and-damage-performance.js").PointsAndDamagePerformanceRecord;
  candidates: WclRunCandidate[];
  latest: WclRunCandidate | null;
  highest: WclRunCandidate | null;
  /** True when candidate list was capped by MAX_DISCOVERY_CANDIDATES. */
  candidatesTruncated: boolean;
  /** Private/unlisted reports observed and skipped (never probed). */
  privateReportsSkipped: number;
}

export interface WclReportFightDetails {
  report: WclReportSummary;
  fight: WclFightSummary;
  combatFacts: RunCombatFacts;
}

export interface ExternalRunMatchInput {
  dungeonSlug: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  durationMs: number;
  participants: Array<{ realmSlug: string; name: string }>;
}
