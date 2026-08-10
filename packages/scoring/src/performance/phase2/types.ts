import type { DimensionConfidenceBreakdown } from "../../confidence/dimension-confidence.js";
import type {
  PerformanceContributorDiagnosticV2,
  PerformanceDungeonScoreV2,
  PerformanceExplanationV2,
  PerformanceProfileAggregateFactV2,
  PerformanceV2AvailabilityState,
  PerformanceV2ComputeResult,
} from "../v2/types.js";
import type { OffensiveCooldownDisciplineResult } from "./cooldown-discipline.js";
import type { PerformanceCooldownRunEvidence } from "./cooldown-discipline.js";
import type {
  PerformanceThroughputChannelFact,
  RoleAwarePerformanceComputeResult,
} from "../role-aware/types.js";
import type { EvidenceRole } from "@mplus/contracts";

export type {
  PerformanceCooldownRunEvidence,
  OffensiveCooldownDisciplineResult,
  RunCooldownDisciplineResult,
  AbilityCooldownScore,
} from "./cooldown-discipline.js";

export interface PerformancePhase2WeightsApplied {
  /** @deprecated Prefer damageParse / healingParse / cooldown. Kept for forensic readers. */
  phase1: number;
  damageParse: number;
  healingParse: number;
  cooldown: number;
}

export interface PerformancePhase2Coverage {
  activeDungeonCount: number;
  detailedDungeonCount: number;
  selectedRunCount: number;
  profileDungeonCount: number;
  damageDungeonCount: number;
  healingDungeonCount: number;
  cooldownUsableRunCount: number;
  evaluatedAbilityCount: number;
}

export interface PerformancePhase2ComputeInput {
  role: EvidenceRole;
  specSlug: string | null;
  activeDungeonSlugs: readonly string[];
  damage: PerformanceThroughputChannelFact | null;
  healing: PerformanceThroughputChannelFact | null;
  /** DPS only — ignored for tank/healer. */
  cooldownRuns: readonly PerformanceCooldownRunEvidence[];
  expectedPartition?: number | null;
  logFreshness?: number;
  computedAt?: string;
}

export interface PerformancePhase2ComputeResult {
  state: PerformanceV2AvailabilityState;
  score: number | null;
  confidence: number;
  confidenceBreakdown: DimensionConfidenceBreakdown;

  /** Canonical damage parse score (all roles). */
  damageParseScore: number | null;
  /** Healer-only healing parse score. */
  healingParseScore: number | null;
  /**
   * Legacy alias: damage parse for DPS/Tank; null when healer uses split drivers.
   * Prefer damageParseScore / healingParseScore.
   */
  phase1Score: number | null;
  offensiveCooldownDiscipline: number | null;

  weightsApplied: PerformancePhase2WeightsApplied;

  /** Role-aware calculator result (canonical). */
  roleAware: RoleAwarePerformanceComputeResult;
  /**
   * Forensic stub — detailed Phase1 blend is no longer on the product path.
   * roleAdapter is always SUPPORTED when role-aware scoring runs.
   */
  phase1: PerformanceV2ComputeResult | null;
  cooldown: OffensiveCooldownDisciplineResult | null;

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
    damageParseScore: number | null;
    healingParseScore: number | null;
    offensiveCooldownDiscipline: number | null;
    weightsApplied: PerformancePhase2WeightsApplied;
    cooldown: OffensiveCooldownDisciplineResult | null;
    phase2State: "ACTIVE";
    phase3State: "DEFERRED_CRITICAL_MASS";
    confidenceBreakdown: DimensionConfidenceBreakdown;
  };
  metrics: Record<string, unknown>;
  contributors: PerformanceContributorDiagnosticV2[];
}
