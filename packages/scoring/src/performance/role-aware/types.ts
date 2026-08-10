import type { EvidenceRole } from "@mplus/contracts";
import type { DimensionConfidenceBreakdown } from "../../confidence/dimension-confidence.js";
import type { OffensiveCooldownDisciplineResult } from "../phase2/cooldown-discipline.js";
import type { PerformanceCooldownRunEvidence } from "../phase2/cooldown-discipline.js";

export type PerformanceThroughputChannelKind = "damage" | "healing";

export interface PerformanceDungeonThroughputFact {
  dungeonSlug: string;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  specialization?: string | null;
  bestThroughputAmount?: number | null;
}

export interface PerformanceThroughputChannelFact {
  kind: PerformanceThroughputChannelKind;
  metric: "points_and_damage" | "points_and_healing";
  perDungeon: readonly PerformanceDungeonThroughputFact[];
  /** Precomputed equal-dungeon averages when provided by aggregate global. */
  bestPercentileAverage: number | null;
  medianPercentileAverage: number | null;
  partition: number | null;
  zoneId: number | null;
  totalLoggedRuns: number | null;
  observedSpecs: readonly string[];
  specBinding: "EXACT_MATCH" | "COHERENT_UNPROVEN" | "MISMATCH_REJECTED";
}

export interface ParseChannelScoreResult {
  score: number | null;
  confidence: number;
  causes: string[];
  availableCells: number;
  expectedCells: number;
  evidenceCoverage: number;
  bestAverage: number | null;
  medianAverage: number | null;
  dungeonsUsed: number;
  state: "AVAILABLE" | "UNAVAILABLE";
}

export interface RoleAwarePerformanceWeightsApplied {
  damageParse: number;
  healingParse: number;
  cooldown: number;
}

export interface RoleAwarePerformanceComputeInput {
  role: EvidenceRole;
  specSlug: string | null;
  activeDungeonSlugs: readonly string[];
  damage: PerformanceThroughputChannelFact | null;
  healing: PerformanceThroughputChannelFact | null;
  /** DPS only — ignored for tank/healer. */
  cooldownRuns: readonly PerformanceCooldownRunEvidence[];
  expectedPartition?: number | null;
  /** @deprecated Unused in 04B baseline — freshness is not part of parse confidence. */
  logFreshness?: number;
  computedAt?: string;
}

export interface RoleAwarePerformanceComputeResult {
  state: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  score: number | null;
  confidence: number;
  confidenceBreakdown: DimensionConfidenceBreakdown;
  role: EvidenceRole;
  damageParse: ParseChannelScoreResult | null;
  healingParse: ParseChannelScoreResult | null;
  offensiveCooldownDiscipline: number | null;
  cooldown: OffensiveCooldownDisciplineResult | null;
  weightsApplied: RoleAwarePerformanceWeightsApplied;
  limitations: string[];
  algorithmVersion: string;
  modelLabel: string;
  inputFingerprint: string;
  coverage: {
    activeDungeonCount: number;
    damageDungeonCount: number;
    healingDungeonCount: number;
    damageAvailableCells: number;
    healingAvailableCells: number;
    cooldownUsableRunCount: number;
    evaluatedAbilityCount: number;
    selectedRunCount: number;
  };
  contributors: Array<{
    key: string;
    value: number | null;
    weight: number;
    note: string | null;
  }>;
}
