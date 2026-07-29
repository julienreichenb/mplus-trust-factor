import type { RegionCode } from "@mplus/contracts";
import type {
  AbilityAvailability,
  AbilityCategory,
  AbilityRule,
  SourceOwnership,
} from "@mplus/abilities";
import type { WclRateLimitSnapshot } from "../types.js";
import type {
  GraphQlErrorRecord,
  ProbeCharacterRecord,
  ProbeRateLimitRecord,
  ProbeZoneRecord,
} from "./types.js";
import type { SurvivalProbeIdentity, SurvivalRunCandidate } from "./survival-probe-types.js";

export type UtilityProbeIdentity = SurvivalProbeIdentity;

export type UtilityEventDataType =
  | "Interrupts"
  | "Casts"
  | "Buffs"
  | "Debuffs"
  | "Dispels"
  | "DamageDone"
  | "Deaths"
  | "CombatantInfo";

export const UTILITY_EVENT_TYPES: UtilityEventDataType[] = [
  "Interrupts",
  "Casts",
  "Buffs",
  "Debuffs",
  "Dispels",
  "DamageDone",
  "Deaths",
  "CombatantInfo",
];

/** Core datasets required for a usable Utility run. */
export const UTILITY_CORE_EVENT_TYPES: UtilityEventDataType[] = [
  "Interrupts",
  "Casts",
  "Buffs",
  "Debuffs",
  "Dispels",
  "CombatantInfo",
];

export type UtilityUsefulnessClass =
  | "CONFIRMED_USEFUL"
  | "POSSIBLY_USEFUL"
  | "RAW_USE_ONLY"
  | "NOT_APPLICABLE"
  | "UNRESOLVED";

export type UtilityCooldownState = "AVAILABLE" | "ON_COOLDOWN" | "UNKNOWN";

export type UtilityOpportunityStatus =
  | "CANDIDATE"
  | "PLAYER_AVAILABLE"
  | "INVALIDATED_OTHER_INTERRUPTED_FIRST"
  | "PLAYER_ON_COOLDOWN"
  | "UNRESOLVED";

export interface UtilityRawEventPage {
  pageIndex: number;
  startTime: number | null;
  nextPageTimestamp: number | null;
  eventCount: number;
  rawResponseData: unknown;
  graphqlErrors: string[];
}

export interface UtilityRawEventDataset {
  dataType: UtilityEventDataType;
  state: "OK" | "ERROR" | "MISSING";
  pageCount: number;
  truncated: boolean;
  filterSourceId: number | null;
  events: Array<Record<string, unknown>>;
  pages: UtilityRawEventPage[];
  graphqlErrors: string[];
  note: string | null;
}

export interface UtilityPreservedEvent {
  timestamp: number | null;
  sourceID: number | null;
  targetID: number | null;
  abilityGameID: number | null;
  extraAbilityGameID: number | null;
  type: string | null;
  hitType: number | null;
  fightId: number;
  reportCode: string;
  actorOwnership: "PLAYER" | "OWNED_PET" | "OTHER_FRIENDLY" | "HOSTILE" | "UNKNOWN";
  additionalFields: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface UtilityActorContext {
  playerActorId: number;
  ownedPetActorIds: number[];
  friendlyPlayerIds: number[];
  actorsById: Map<
    number,
    {
      id: number;
      name: string;
      type: string;
      subType?: string | null;
      petOwner?: number | null;
    }
  >;
  /** Targets that received DamageDone from attributed sources (optional validation). */
  hostileValidatedByDamage: Set<number>;
}

export interface UtilityCanonicalAbilityRef {
  canonicalKey: string;
  name: string;
  category: AbilityCategory;
  spellId: number;
  sourceOwnership: SourceOwnership;
  availability: AbilityAvailability;
  cooldownSeconds: number | null;
  rule: AbilityRule;
}

export interface UtilityInterruptEvent {
  timestamp: number;
  sourceID: number;
  targetID: number | null;
  abilityGameID: number;
  interruptedSpellId: number | null;
  sourceKind: "PLAYER" | "OWNED_PET";
  canonical: UtilityCanonicalAbilityRef | null;
  cooldownStateAtCast: UtilityCooldownState;
  repeatedOnSameCast: boolean;
  unmatchedSpellId: boolean;
  event: UtilityPreservedEvent;
}

export interface UtilityInterruptOpportunity {
  id: string;
  status: UtilityOpportunityStatus;
  castStart: number | null;
  castEnd: number | null;
  castSourceId: number | null;
  castAbilityGameId: number | null;
  interruptibleEvidence: boolean | null;
  successfulCastEvidence: boolean | null;
  interruptedEvidence: boolean | null;
  playerInterruptAvailable: boolean | null;
  interruptedByOtherFirst: boolean | null;
  playerInterruptTimestamp: number | null;
  otherInterruptTimestamp: number | null;
  unresolvedReasons: string[];
  evidence: string[];
}

export interface UtilityCcEvent {
  timestamp: number;
  sourceID: number;
  targetID: number | null;
  abilityGameID: number;
  category: "HARD_CC" | "SOFT_CC";
  sourceKind: "PLAYER" | "OWNED_PET";
  canonical: UtilityCanonicalAbilityRef | null;
  hostileTarget: boolean;
  nonBossTarget: boolean | null;
  debuffApplied: boolean;
  durationMs: number | null;
  breakOrRemovalTimestamp: number | null;
  repeatedOnSameTarget: boolean;
  unmatchedSpellId: boolean;
  usefulnessClassification: null;
  usefulnessNote: string;
  event: UtilityPreservedEvent;
}

export interface UtilityDispelPurgeEvent {
  timestamp: number;
  sourceID: number;
  targetID: number | null;
  abilityGameID: number;
  removedSpellId: number | null;
  kind: "DISPEL" | "PURGE";
  targetSide: "FRIENDLY" | "HOSTILE" | "UNKNOWN";
  sourceKind: "PLAYER" | "OWNED_PET";
  canonical: UtilityCanonicalAbilityRef | null;
  cooldownStateAtCast: UtilityCooldownState;
  unmatchedSpellId: boolean;
  event: UtilityPreservedEvent;
}

export interface UtilityDispelPurgeOpportunity {
  id: string;
  kind: "DISPEL" | "PURGE";
  status: UtilityOpportunityStatus | "RAW_EVIDENCE_ONLY";
  auraAbilityGameId: number | null;
  auraTargetId: number | null;
  auraApplyTimestamp: number | null;
  reactionWindowMs: number | null;
  playerAbilityAvailable: boolean | null;
  removedByPlayer: boolean | null;
  removedByOther: boolean | null;
  unresolvedReasons: string[];
  evidence: string[];
}

export interface UtilityGroupUtilityEvent {
  timestamp: number;
  sourceID: number;
  targetID: number | null;
  abilityGameID: number;
  category:
    | "EXTERNAL_DEFENSIVE"
    | "GROUP_UTILITY"
    | "MOVEMENT_UTILITY"
    | "BATTLE_REZ"
    | "BLOODLUST";
  sourceKind: "PLAYER" | "OWNED_PET";
  canonical: UtilityCanonicalAbilityRef | null;
  successfulApplication: boolean | null;
  targetDeathNearby: boolean | null;
  battleRezResult: "REVIVED" | "FAILED" | "UNKNOWN" | null;
  classification: UtilityUsefulnessClass;
  evidence: string[];
  unmatchedSpellId: boolean;
  event: UtilityPreservedEvent;
}

export interface UtilityNormalizedRun {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number | null;
  durationMs: number;
  playerActorId: number;
  petActorIds: number[];
  specialization: string | null;
  classSlug: string | null;
  /** Resolved from WCL zoneRankings.role for this run's candidate. */
  roleSlug: string | null;
  interruptEvents: UtilityInterruptEvent[];
  ccEvents: UtilityCcEvent[];
  dispelPurgeEvents: UtilityDispelPurgeEvent[];
  externalGroupUtilityEvents: UtilityGroupUtilityEvent[];
  classSpecificEvents: UtilityGroupUtilityEvent[];
  interruptOpportunities: UtilityInterruptOpportunity[];
  dispelPurgeOpportunities: UtilityDispelPurgeOpportunity[];
  unmatchedAbilityIds: number[];
  incompleteDatasets: UtilityEventDataType[];
  datasetStates: Record<UtilityEventDataType, UtilityRawEventDataset["state"]>;
  truncatedDatasets: UtilityEventDataType[];
}

export interface UtilityRunSummary {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number | null;
  durationMs: number;
  playerActorId: number;
  petActorIds: number[];
  specialization: string | null;
  successfulInterrupts: number;
  interruptOpportunityCandidates: number;
  interruptOpportunitiesPlayerAvailable: number;
  interruptOpportunitiesInvalidatedOtherFirst: number;
  interruptOpportunitiesUnresolved: number;
  ccUses: number;
  hardCcUses: number;
  softCcUses: number;
  dispels: number;
  purges: number;
  externalGroupUtilityUses: number;
  classSpecificUses: number;
  unmatchedAbilityIds: number[];
  incompleteDatasets: UtilityEventDataType[];
  normalized: UtilityNormalizedRun;
}

export interface UtilityDungeonAggregate {
  dungeonSlug: string;
  runCount: number;
  runIds: string[];
  successfulInterruptsMedian: number | null;
  interruptOpportunityCandidatesMedian: number | null;
  ccUsesMedian: number | null;
  dispelsPurgesMedian: number | null;
  externalGroupUtilityMedian: number | null;
  classSpecificMedian: number | null;
  unmatchedAbilityIdCount: number;
}

export interface UtilityGlobalSummary {
  dungeonCount: number;
  totalRuns: number;
  equalWeightAverages: {
    successfulInterruptsMedian: number | null;
    interruptOpportunityCandidatesMedian: number | null;
    ccUsesMedian: number | null;
    dispelsPurgesMedian: number | null;
    externalGroupUtilityMedian: number | null;
    classSpecificMedian: number | null;
  };
  coverage: {
    expectedDungeonCount: number;
    dungeonsWithRuns: number;
    dungeonsMissingRuns: string[];
    sampleSizeByDungeon: Record<string, number>;
    /**
     * Per-dungeon classification for missing dungeons.
     * Possible values:
     *  - "no_candidates": zoneRankings had no entry and recentReports found none
     *  - "actor_absent": candidates found but player actor absent from friendlyPlayers
     *  - "report_cap_reached": candidates existed but per-dungeon report cap exhausted
     *  - "report_private": report fetch returned private/unauthorized
     *  - "outside_report_window": all candidates outside the inspected report window
     *  - "unknown": rejected for other reasons
     */
    missingDungeonReasons: Record<string, string>;
  };
  reliabilityAssessment: {
    reliableEnoughForStandaloneV1: string[];
    diagnosticOnly: string[];
    evidenceNotes: string[];
  };
  note: string;
}

export interface UtilityCostDiagnostics {
  totalWclRequests: number;
  estimatedQueryCostUnits: number | null;
  cache: {
    reportMasterDataHits: number;
    reportMasterDataMisses: number;
    eventDatasetHits: number;
    eventDatasetMisses: number;
  };
  perOperationRequestCounts: Record<string, number>;
  paginationPageCountTotal: Record<UtilityEventDataType, number>;
  maxRunsPerDungeon: number;
  maxReportsInspectedPerDungeon: number;
}

export interface UtilityProbeDiagnostics {
  reportsInspected: string[];
  fightsInspected: Array<{ reportCode: string; fightId: number }>;
  candidateRunsRejected: Array<{
    reportCode: string;
    fightId: number;
    dungeonSlug: string | null;
    reason: string;
  }>;
  candidateRunsInspected: number;
  wclRequestCount: number;
  graphqlOperationCount: number;
  cacheHits: number;
  cacheMisses: number;
  paginationPagesByDataset: Record<UtilityEventDataType, number>;
  actorAndPetResolution: Array<{
    runId: string;
    playerActorId: number;
    petActorIds: number[];
  }>;
  catalogMatches: {
    matchedSpellIds: number[];
    unmatchedSpellIds: number[];
  };
  successfulUses: {
    interrupts: number;
    cc: number;
    dispels: number;
    purges: number;
    externalGroupUtility: number;
    classSpecific: number;
  };
  candidateOpportunities: {
    interrupt: number;
    dispelPurge: number;
  };
  unresolvedOpportunityReasons: Record<string, number>;
  datasetsInsufficientForStandaloneScoring: string[];
  incompleteDatasets: Array<{ runId: string; missing: UtilityEventDataType[] }>;
  graphqlErrors: GraphQlErrorRecord[];
  schemaWarnings: string[];
  cost: UtilityCostDiagnostics;
  activeDungeonPool: string[];
  note: string;
}

export interface UtilityProbeDataset {
  probeVersion: "utility-1";
  probedAt: string;
  identity: UtilityProbeIdentity;
  state: "OK" | "PARTIAL" | "ERROR";
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  runs: UtilityRunSummary[];
  perDungeon: UtilityDungeonAggregate[];
  global: UtilityGlobalSummary;
  diagnostics: UtilityProbeDiagnostics;
  graphqlErrors: GraphQlErrorRecord[];
  rateLimit: {
    initial: WclRateLimitSnapshot | null;
    final: WclRateLimitSnapshot | null;
    perOperation: ProbeRateLimitRecord[];
  };
  candidatesByDungeon: Record<string, SurvivalRunCandidate[]>;
}

export type { RegionCode, SurvivalRunCandidate };
