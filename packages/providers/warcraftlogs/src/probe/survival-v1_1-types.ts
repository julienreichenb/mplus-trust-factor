import type { AbilityAvailability, AbilityCategory } from "@mplus/abilities";
import type { SurvivalStandaloneV1_1Config } from "./survival-v1_1-config.js";

export type SurvivalV1_1ScoreMode = "FULL_BEHAVIORAL" | "PARTIAL_BEHAVIORAL" | "OUTCOME_ONLY";

export type SurvivalV1_1WindowClass =
  | "NON_FATAL_PRESSURE"
  | "FATAL_PRESSURE"
  | "DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE";

export type SurvivalV1_1MaxHpConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type SurvivalV1_1DefensiveCoverageKind =
  | "proactive"
  | "reactive"
  | "death_only"
  | "eligible_miss"
  | "unavailable"
  | "insufficient_reaction_time"
  | "not_applicable";

export type SurvivalV1_1RecoveryCoverageKind =
  | "covered"
  | "eligible_miss"
  | "insufficient_reaction_time"
  | "death_only_health_context_unavailable"
  | "not_applicable";

export interface HealthSchemaVariant {
  sourceLabel: string;
  dataType: string;
  path: string;
  sampleValueType: string;
  sampleValue: unknown;
  occurrenceCount: number;
}

export interface ExplicitHealthSnapshot {
  timestamp: number;
  currentHp: number | null;
  maxHp: number | null;
  absorb: number | null;
  path: string;
  dataType: string;
  abilityGameID: number | null;
  sourceID: number | null;
  targetID: number | null;
  eventType: string | null;
  rawFragment: Record<string, unknown>;
}

export interface MaxHpResolution {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  maxHp: number | null;
  maxHpSource: string | null;
  maxHpConfidence: SurvivalV1_1MaxHpConfidence;
  sourcePayloadPath: string | null;
  corroboratingEventCount: number;
  allObservedMaxHpValues: number[];
  modalStableValue: number | null;
  temporaryMaxHpValues: number[];
  conflictingValues: number[];
  resolutionFailureReason: string | null;
}

export interface HealthTimelinePoint {
  timestamp: number;
  currentHp: number;
  maxHp: number;
  hpPercent: number;
  absorbed: number | null;
  triggeringEvent: string;
  sourceAbility: number | null;
  confidence: "OBSERVED" | "RECONSTRUCTED";
  directlyObserved: boolean;
}

export interface HealthTimeline {
  runId: string;
  reportCode: string;
  fightId: number;
  complete: boolean;
  incompletenessReasons: string[];
  points: HealthTimelinePoint[];
  observedSnapshotCount: number;
  reconstructedPointCount: number;
}

export interface SurvivalV1_1DangerWindowAudit {
  windowId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  windowClass: SurvivalV1_1WindowClass;
  startTimestamp: number;
  endTimestamp: number;
  firstTriggerTimestamp: number;
  deathTimestamp: number | null;
  triggerTypes: Array<"LOW_HP" | "ROLLING_DAMAGE" | "LARGE_HIT" | "PLAYER_DEATH">;
  timeBelow35HpMs: number | null;
  timeFromFirstTriggerToDeathMs: number | null;
  reactionIntervalMs: number | null;
  reactionEligible: boolean;
  reactionIneligibilityReason: string | null;
  hpBefore: number | null;
  minimumHp: number | null;
  maximumHp: number | null;
  damageEventsResponsible: Array<{
    timestamp: number;
    abilityGameID: number | null;
    sourceID: number | null;
    amount: number;
    absorbed: number;
  }>;
  deathOutcome: boolean;
  applicableDefensiveRules: Array<{
    canonicalKey: string;
    spellId: number;
    category: AbilityCategory;
    availability: AbilityAvailability;
    cooldownSeconds: number | null;
  }>;
  confirmedAvailableDefensives: Array<{
    canonicalKey: string;
    spellId: number;
    reason: string;
  }>;
  defensiveCastsOrBuffsDetected: Array<{
    canonicalKey: string;
    spellId: number;
    kind: "cast" | "buff_active" | "buff_apply";
    timestamp: number;
  }>;
  defensiveCoverageKind: SurvivalV1_1DefensiveCoverageKind;
  recoveryResourcesConfirmedAvailable: Array<{ canonicalKey: string; reason: string }>;
  recoveryActionsDetected: Array<{
    canonicalKey: string;
    kind: "healthstone" | "healing_potion" | "self_heal";
    timestamp: number;
    amount: number | null;
  }>;
  recoveryCoverageKind: SurvivalV1_1RecoveryCoverageKind;
  eventDataComplete: boolean;
}

export interface SurvivalV1_1ReactionOpportunity {
  windowId: string;
  runId: string;
  dungeonSlug: string;
  firstDangerTimestamp: number;
  deathTimestamp: number | null;
  timeBelow35HpMs: number | null;
  timeFromFirstTriggerToDeathMs: number | null;
  reactionIntervalMs: number | null;
  reactionEligible: boolean;
  reason: string | null;
  defensiveAvailable: boolean;
  recoveryAvailable: boolean;
  defensiveCoverageKind: SurvivalV1_1DefensiveCoverageKind;
  recoveryCoverageKind: SurvivalV1_1RecoveryCoverageKind;
}

export interface SurvivalV1_1ComponentResult {
  state: "SCORED" | "NOT_APPLICABLE";
  score: number | null;
  weightUsed: number;
  reason: string | null;
  evidence: Record<string, unknown>;
}

export interface SurvivalV1_1RunScore {
  runId: string;
  dungeonSlug: string;
  reportCode: string;
  fightId: number;
  keyLevel: number | null;
  deathCount: number;
  maxHp: number | null;
  maxHpSource: string | null;
  maxHpConfidence: SurvivalV1_1MaxHpConfidence;
  healthTimelineComplete: boolean;
  outcomeOnlyScore: number;
  behavioralSurvivalScore: number | null;
  outcome: SurvivalV1_1ComponentResult;
  defensiveResponse: SurvivalV1_1ComponentResult;
  emergencyRecovery: SurvivalV1_1ComponentResult;
  weightsApplied: {
    survivalOutcome: number;
    defensiveResponse: number;
    emergencyRecovery: number;
  };
  dangerWindowCount: number;
  nonFatalWindowCount: number;
  fatalWindowCount: number;
  deathOnlyWindowCount: number;
  defensiveCounts: Record<SurvivalV1_1DefensiveCoverageKind, number>;
  recoveryCounts: Record<SurvivalV1_1RecoveryCoverageKind, number>;
  dangerWindowIds: string[];
}

export interface SurvivalV1_1DungeonScore {
  dungeonSlug: string;
  runCount: number;
  medianOutcomeOnlyScore: number | null;
  medianBehavioralScore: number | null;
  runOutcomeOnlyScores: number[];
  runBehavioralScores: number[];
}

export interface SurvivalV1_1GlobalScore {
  outcomeOnlyScore: number | null;
  behavioralSurvivalScore: number | null;
  scoreMode: SurvivalV1_1ScoreMode;
  availableDungeonCount: number;
  expectedDungeonCount: number;
  runsWithValidMaxHp: number;
  runCount: number;
  healthStateCoverageShare: number;
  note: string;
}

export interface SurvivalV1_1Diagnostics {
  configVersion: string;
  runsWithResolvedMaxHp: number;
  runCount: number;
  nonFatalDangerWindowCount: number;
  fatalDangerWindowCount: number;
  deathOnlyWindowCount: number;
  defensiveCounts: Record<SurvivalV1_1DefensiveCoverageKind, number>;
  recoveryCounts: Record<SurvivalV1_1RecoveryCoverageKind, number>;
  windowsRejectedInsufficientReactionTime: number;
  requestCost: {
    wclRequestCount: number;
    estimatedPageCountIncreaseVsCalibrationDamageTaken: number | null;
    notes: string[];
  };
  scoreMode: SurvivalV1_1ScoreMode;
  outcomeOnlyScore: number | null;
  behavioralSurvivalScore: number | null;
}

export interface SurvivalV1_1ScoreDataset {
  probeVersion: string;
  scoredAt: string;
  config: SurvivalStandaloneV1_1Config;
  schemaVariants: HealthSchemaVariant[];
  maxHpResolutions: MaxHpResolution[];
  healthTimelines: HealthTimeline[];
  dangerWindows: SurvivalV1_1DangerWindowAudit[];
  reactionOpportunities: SurvivalV1_1ReactionOpportunity[];
  runs: SurvivalV1_1RunScore[];
  perDungeon: SurvivalV1_1DungeonScore[];
  global: SurvivalV1_1GlobalScore;
  comparisonVsV1: {
    v1GlobalScore: number | null;
    v1_1OutcomeOnly: number | null;
    v1_1Behavioral: number | null;
    perDungeon: Array<{
      dungeonSlug: string;
      v1Median: number | null;
      v1_1OutcomeOnlyMedian: number | null;
      v1_1BehavioralMedian: number | null;
    }>;
  };
  diagnostics: SurvivalV1_1Diagnostics;
}
