import type { AbilityAvailability, AbilityCategory } from "@mplus/abilities";
import type { SurvivalStandaloneV1Config } from "./survival-v1-config.js";

export type SurvivalV1ComponentState = "SCORED" | "NOT_APPLICABLE";

export type DangerTriggerType =
  | "LOW_HP"
  | "ROLLING_DAMAGE"
  | "LARGE_HIT"
  | "PLAYER_DEATH";

export interface SurvivalV1ComponentResult {
  state: SurvivalV1ComponentState;
  score: number | null;
  weightUsed: number;
  reason: string | null;
  evidence: Record<string, unknown>;
}

export interface SurvivalV1DangerWindowAudit {
  windowId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  startTimestamp: number;
  endTimestamp: number;
  firstTriggerTimestamp: number;
  triggerTypes: DangerTriggerType[];
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
  recoveryResourcesConfirmedAvailable: Array<{
    canonicalKey: string;
    reason: string;
  }>;
  recoveryActionsDetected: Array<{
    canonicalKey: string;
    kind: "healthstone" | "healing_potion" | "self_heal";
    timestamp: number;
    amount: number | null;
  }>;
  defensiveCovered: boolean | null;
  recoveryCovered: boolean | null;
  defensiveEligible: boolean;
  recoveryEligible: boolean;
  componentResult: {
    defensive: "covered" | "missed" | "not_eligible";
    recovery: "covered" | "missed" | "not_eligible";
  };
  rejectionOrNotApplicableReason: string | null;
  eventDataComplete: boolean;
}

export interface SurvivalV1RunScore {
  runId: string;
  dungeonSlug: string;
  reportCode: string;
  fightId: number;
  keyLevel: number | null;
  deathCount: number;
  maxHp: number | null;
  maxHpSource: "event_maxHitPoints" | "combatantInfo" | "raw_field" | null;
  outcome: SurvivalV1ComponentResult;
  defensiveResponse: SurvivalV1ComponentResult;
  emergencyRecovery: SurvivalV1ComponentResult;
  /** Final 0–100 run score after weight redistribution. */
  score: number;
  weightsApplied: {
    survivalOutcome: number;
    defensiveResponse: number;
    emergencyRecovery: number;
  };
  dangerWindowCount: number;
  eligibleDefensiveWindows: number;
  coveredDefensiveWindows: number;
  eligibleRecoveryWindows: number;
  coveredRecoveryWindows: number;
  dangerWindowIds: string[];
}

export interface SurvivalV1DungeonScore {
  dungeonSlug: string;
  runCount: number;
  medianScore: number | null;
  runScores: number[];
  componentCoverage: {
    outcomeScored: number;
    defensiveScored: number;
    defensiveNotApplicable: number;
    recoveryScored: number;
    recoveryNotApplicable: number;
  };
}

export interface SurvivalV1GlobalScore {
  score: number | null;
  availableDungeonCount: number;
  expectedDungeonCount: number;
  dungeonMedians: Array<{ dungeonSlug: string; medianScore: number | null }>;
  note: string;
}

export interface SurvivalV1ConfidenceDiagnostics {
  dungeonCoverage: {
    available: number;
    expected: number;
    missing: string[];
  };
  runCount: number;
  runsWithValidMaxHp: number;
  totalDangerWindows: number;
  eligibleDefensiveWindows: number;
  eligibleRecoveryWindows: number;
  coveredDefensiveWindows: number;
  coveredRecoveryWindows: number;
  percentWindowsWithCompleteEventData: number | null;
  unavailableComponents: Array<{
    runId: string;
    component: "defensiveResponse" | "emergencyRecovery" | "dangerDetection";
    reason: string;
  }>;
  deathsDetected: number;
  notApplicableCounts: {
    defensiveResponse: number;
    emergencyRecovery: number;
  };
  notApplicableReasons: Record<string, number>;
  configVersion: string;
}

export interface SurvivalV1ScoreDataset {
  probeVersion: "survival-standalone-v1";
  scoredAt: string;
  config: SurvivalStandaloneV1Config;
  runs: SurvivalV1RunScore[];
  dangerWindows: SurvivalV1DangerWindowAudit[];
  perDungeon: SurvivalV1DungeonScore[];
  global: SurvivalV1GlobalScore;
  diagnostics: SurvivalV1ConfidenceDiagnostics;
}
