import type { DimensionConfidenceBreakdown } from "../../confidence/dimension-confidence.js";
import type {
  PerformanceContributorDiagnosticV2,
  PerformanceDungeonScoreV2,
  PerformanceExplanationV2,
  PerformanceProfileAggregateFactV2,
  PerformanceV2AvailabilityState,
  PerformanceV2ComputeInput,
  PerformanceV2ComputeResult,
} from "../v2/types.js";
import type { OffensiveCooldownDisciplineResult } from "./cooldown-discipline.js";
import type { PerformanceCooldownRunEvidence } from "./cooldown-discipline.js";

export type {
  PerformanceCooldownRunEvidence,
  OffensiveCooldownDisciplineResult,
  RunCooldownDisciplineResult,
  AbilityCooldownScore,
} from "./cooldown-discipline.js";

export interface PerformancePhase2WeightsApplied {
  phase1: number;
  cooldown: number;
}

export interface PerformancePhase2Coverage {
  activeDungeonCount: number;
  detailedDungeonCount: number;
  selectedRunCount: number;
  profileDungeonCount: number;
  cooldownUsableRunCount: number;
  evaluatedAbilityCount: number;
}

export interface PerformancePhase2ComputeInput {
  /** Phase 1 parse/profile/difficulty input (provider-free). */
  phase1: PerformanceV2ComputeInput;
  /** Selected target-character digests projected to cooldown evidence. */
  cooldownRuns: readonly PerformanceCooldownRunEvidence[];
}

export interface PerformancePhase2ComputeResult {
  state: PerformanceV2AvailabilityState;
  score: number | null;
  confidence: number;
  confidenceBreakdown: DimensionConfidenceBreakdown;

  phase1Score: number | null;
  offensiveCooldownDiscipline: number | null;

  weightsApplied: PerformancePhase2WeightsApplied;

  /** Full Phase 1 calculator result (diagnostics). */
  phase1: PerformanceV2ComputeResult;
  cooldown: OffensiveCooldownDisciplineResult;

  detailedRuns: PerformanceExplanationV2["selectedRuns"];
  dungeonScores: PerformanceDungeonScoreV2[];
  profileSummary: PerformanceProfileAggregateFactV2 | null;

  coverage: PerformancePhase2Coverage;
  limitations: string[];
  calculatorVersion: string;
  algorithmVersion: string;
  modelLabel: string;
  inputFingerprint: string;
  explanation: PerformanceExplanationV2 & {
    phase1Score: number | null;
    offensiveCooldownDiscipline: number | null;
    weightsApplied: PerformancePhase2WeightsApplied;
    cooldown: OffensiveCooldownDisciplineResult;
    phase2State: "ACTIVE";
    phase3State: "DEFERRED_CRITICAL_MASS";
    confidenceBreakdown: DimensionConfidenceBreakdown;
  };
  metrics: Record<string, unknown>;
  contributors: PerformanceContributorDiagnosticV2[];
}
