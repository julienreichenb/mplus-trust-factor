/**
 * Transparent run/dungeon coverage confidence (scoring-confidence-v1).
 * Does not alter score formulas — metadata only.
 */
export const SCORING_CONFIDENCE_POLICY_VERSION = "scoring-confidence-v1" as const;

export type ScoringConfidenceBand = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type EvidenceManifestAnalysisStatus = "EMPTY" | "PARTIAL" | "COMPLETE";

export interface ScoringConfidenceV1Inputs {
  usableRunCount: number;
  targetRunCount: number;
  representedDungeonCount: number;
  activeDungeonCount: number;
  missingDungeons?: readonly string[];
  /** When both provided, missingDungeons is derived if not explicitly passed. */
  activeDungeonSlugs?: readonly string[];
  representedDungeonSlugs?: readonly string[];
}

/** Dungeons in the active pool with zero usable digests. */
export function missingDungeonsFromCoverage(
  activeDungeonSlugs: readonly string[],
  representedDungeonSlugs: readonly string[],
): string[] {
  const represented = new Set(
    representedDungeonSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return [
    ...new Set(
      activeDungeonSlugs
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && !represented.has(s)),
    ),
  ].sort();
}

export interface ScoringConfidenceV1 {
  policyVersion: typeof SCORING_CONFIDENCE_POLICY_VERSION;
  usableRunCount: number;
  targetRunCount: number;
  representedDungeonCount: number;
  activeDungeonCount: number;
  missingRunCount: number;
  missingDungeons: string[];
  runCoverage: number;
  dungeonCoverage: number;
  confidenceScore: number;
  confidenceBand: ScoringConfidenceBand;
  unavailableReason: string | null;
}

export function evidenceManifestAnalysisStatus(input: {
  selectedSlotCount: number;
  targetRunCount: number;
}): EvidenceManifestAnalysisStatus {
  if (input.selectedSlotCount <= 0) return "EMPTY";
  if (input.selectedSlotCount >= input.targetRunCount) return "COMPLETE";
  return "PARTIAL";
}

export function confidenceBandFromScore(score: number): ScoringConfidenceBand {
  if (score <= 0) return "NONE";
  if (score >= 85) return "HIGH";
  if (score >= 60) return "MEDIUM";
  return "LOW";
}

/**
 * runCoverage = min(usable/target, 1)
 * dungeonCoverage = min(represented/active, 1)
 * confidenceScore = round(100 * sqrt(runCoverage * dungeonCoverage))
 */
export function computeScoringConfidenceV1(
  input: ScoringConfidenceV1Inputs,
): ScoringConfidenceV1 {
  const usableRunCount = Math.max(0, input.usableRunCount);
  const targetRunCount = Math.max(0, input.targetRunCount);
  const representedDungeonCount = Math.max(0, input.representedDungeonCount);
  const activeDungeonCount = Math.max(0, input.activeDungeonCount);
  const missingRunCount = Math.max(0, targetRunCount - usableRunCount);
  const missingDungeons = [
    ...(input.missingDungeons ??
      (input.activeDungeonSlugs != null && input.representedDungeonSlugs != null
        ? missingDungeonsFromCoverage(
            input.activeDungeonSlugs,
            input.representedDungeonSlugs,
          )
        : [])),
  ].sort();

  if (usableRunCount === 0 || targetRunCount === 0 || activeDungeonCount === 0) {
    return {
      policyVersion: SCORING_CONFIDENCE_POLICY_VERSION,
      usableRunCount,
      targetRunCount,
      representedDungeonCount,
      activeDungeonCount,
      missingRunCount: targetRunCount,
      missingDungeons,
      runCoverage: 0,
      dungeonCoverage: 0,
      confidenceScore: 0,
      confidenceBand: "NONE",
      unavailableReason:
        usableRunCount === 0 ? "ZERO_USABLE_RUNS" : "INVALID_TARGET_OR_POOL",
    };
  }

  const runCoverage = Math.min(usableRunCount / targetRunCount, 1);
  const dungeonCoverage = Math.min(
    representedDungeonCount / activeDungeonCount,
    1,
  );
  const confidenceScore = Math.round(
    100 * Math.sqrt(runCoverage * dungeonCoverage),
  );

  return {
    policyVersion: SCORING_CONFIDENCE_POLICY_VERSION,
    usableRunCount,
    targetRunCount,
    representedDungeonCount,
    activeDungeonCount,
    missingRunCount,
    missingDungeons,
    runCoverage,
    dungeonCoverage,
    confidenceScore,
    confidenceBand: confidenceBandFromScore(confidenceScore),
    unavailableReason: null,
  };
}

/** Overall composite confidence is the minimum of included dimension confidences. */
export function overallConfidenceFromDimensions(
  dimensionScores: readonly number[],
): number {
  if (dimensionScores.length === 0) return 0;
  return Math.min(...dimensionScores);
}
