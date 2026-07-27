import type { IsoDateTime, RegionCode } from "@mplus/contracts";

/** Character visibility on Warcraft Logs public API. */
export type WclVisibilityState =
  | "PUBLIC"
  | "HIDDEN"
  | "NO_PUBLIC_LOGS"
  | "PRIVATE_SKIPPED";

export interface WclCharacterSummary {
  wclCharacterId: number;
  canonicalId: number;
  name: string;
  realmSlug: string;
  region: RegionCode;
  classId: number | null;
  level: number | null;
  hidden: boolean;
  visibility: WclVisibilityState;
  fetchedAt: IsoDateTime;
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
  specSlug: string | null;
  roleSlug: string | null;
  durationMs: number | null;
  startTimeMs: number | null;
  reportStartTimeMs: number | null;
  timed: boolean | null;
  metric: string | null;
}

export interface WclRunCandidate {
  reportCode: string;
  fightId: number;
  encounterId: number;
  zoneId: number | null;
  dungeonSlug: string | null;
  keyLevel: number | null;
  score: number | null;
  startTimeMs: number | null;
  completedAt: IsoDateTime | null;
  durationMs: number | null;
  selectionTags: Array<"LATEST" | "HIGHEST">;
  source: "zoneRankings" | "recentReports";
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

export interface RunCombatFactsCoverage {
  casts: boolean;
  interrupts: boolean;
  deaths: boolean;
  damageTaken: boolean;
  auras: boolean;
  dispels: boolean;
  healing: boolean;
  combatantInfo: boolean;
}

export interface RunCombatFactsLimitations {
  missingCategories: string[];
  truncatedPages: string[];
  notes: string[];
}

export interface RunCombatFacts {
  reportCode: string;
  fightId: number;
  revision: number;
  targetSourceId: number;
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

export type RunMatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

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

export interface WclCharacterDiscoveryResult {
  summary: WclCharacterSummary;
  rankings: WclRankingObservation[];
  candidates: WclRunCandidate[];
  latest: WclRunCandidate | null;
  highest: WclRunCandidate | null;
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
