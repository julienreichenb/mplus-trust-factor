/**
 * Canonical canary report projection from authoritative ScoreCharacterResult.
 * Score drivers / confidence reasons come ONLY from the shared public projector.
 */
import type {
  PublicDimensionExplainabilityV1,
  ScoreExplainabilityV1,
} from "@mplus/contracts";
import {
  computeScoringConfidenceV1,
  missingDungeonsFromCoverage,
  productDimensionExplainabilityFields,
  projectScoreExplainabilityPublic,
  type ScoringConfidenceV1,
} from "@mplus/scoring";
import type { ScoreCharacterResult } from "../score-character.js";
import type { RunOrchestrationResult } from "../run-orchestration/orchestrator.js";

export const CANARY_AUTHORITATIVE_DIMENSION_KEYS = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
] as const;

export type CanaryAuthoritativeDimensionKey =
  (typeof CANARY_AUTHORITATIVE_DIMENSION_KEYS)[number];

export interface CanaryAuthoritativeDimensionReport {
  score: number | null;
  confidence: number | null;
  state: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  scoreDrivers: PublicDimensionExplainabilityV1["scoreDrivers"];
  confidenceReasons: PublicDimensionExplainabilityV1["confidenceReasons"];
  /** Operator-friendly labels derived only from public scoreDrivers (POSITIVE). */
  strengths: string[];
  /** Operator-friendly labels derived only from public scoreDrivers (NEGATIVE). NEUTRAL excluded. */
  weaknesses: string[];
  /** Operator-friendly labels from public scoreDrivers (NEUTRAL) — score facts / context. */
  scoreFacts: string[];
  /** Operator-friendly confidence reason labels. */
  confidenceReasonLabels: string[];
}

export interface CanaryAuthoritativeCompositeReport {
  score: number | null;
  confidence: number;
  tier: string;
  availabilityCoverage: number;
  effectiveWeights: Record<string, number>;
  availableDimensions: string[];
  unavailableDimensions: string[];
}

export interface CanaryAuthoritativeReplayAssertion {
  providerCalls: number;
  characterScoreWrites: number;
  scoresEqual: boolean;
  confidenceEqual: boolean;
  compositeEqual: boolean;
  tierEqual: boolean;
  explainabilityFingerprintEqual: boolean;
  publicProjectionEqual: boolean;
}

/** @deprecated Diagnostic only — not dimension/composite confidence. */
export type CanaryEvidenceCoverageDiagnostic = ScoringConfidenceV1;

export function buildCanaryAuthoritativeDimensionReport(
  explainability: ScoreExplainabilityV1,
  key: CanaryAuthoritativeDimensionKey,
): CanaryAuthoritativeDimensionReport {
  const dim = explainability.dimensions[key];
  const { explainability: publicProj } = productDimensionExplainabilityFields(
    explainability,
    key,
  );
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const scoreFacts: string[] = [];
  for (const driver of publicProj.scoreDrivers) {
    if (driver.direction === "POSITIVE") strengths.push(driver.label);
    else if (driver.direction === "NEGATIVE") weaknesses.push(driver.label);
    else scoreFacts.push(driver.label);
  }
  return {
    score: dim.score,
    confidence: dim.confidenceStory.value,
    state: dim.availability,
    scoreDrivers: publicProj.scoreDrivers,
    confidenceReasons: publicProj.confidenceReasons,
    strengths,
    weaknesses,
    scoreFacts,
    confidenceReasonLabels: publicProj.confidenceReasons.map((r) => r.label),
  };
}

export function buildCanaryAuthoritativeDimensions(
  explainability: ScoreExplainabilityV1,
): Record<
  "performance" | "survival" | "utility" | "experience",
  CanaryAuthoritativeDimensionReport
> {
  return {
    performance: buildCanaryAuthoritativeDimensionReport(
      explainability,
      "PERFORMANCE",
    ),
    survival: buildCanaryAuthoritativeDimensionReport(explainability, "SURVIVAL"),
    utility: buildCanaryAuthoritativeDimensionReport(explainability, "UTILITY"),
    experience: buildCanaryAuthoritativeDimensionReport(
      explainability,
      "EXPERIENCE",
    ),
  };
}

export function buildCanaryAuthoritativeComposite(
  explainability: ScoreExplainabilityV1,
): CanaryAuthoritativeCompositeReport {
  const c = explainability.composite;
  return {
    score: c.score,
    confidence: c.confidence,
    tier: c.grade,
    availabilityCoverage: c.availabilityCoverage,
    effectiveWeights: { ...c.effectiveWeights },
    availableDimensions: [...c.availableDimensions],
    unavailableDimensions: [...c.unavailableDimensions],
  };
}

/**
 * Legacy run/package coverage diagnostic. NOT scoring confidence.
 * Retained for operator diagnostics about evidence coverage only.
 */
export function buildEvidenceCoverageDiagnostic(input: {
  orchestration: RunOrchestrationResult;
  targetRunCount: number;
  activeDungeonSlugs: readonly string[];
}): CanaryEvidenceCoverageDiagnostic {
  const representedDungeonSlugs = [
    ...new Set(
      input.orchestration.characterDigests.map((d) => d.dungeonSlug.toLowerCase()),
    ),
  ];
  const missingDungeons = missingDungeonsFromCoverage(
    input.activeDungeonSlugs,
    representedDungeonSlugs,
  );
  return computeScoringConfidenceV1({
    usableRunCount: input.orchestration.characterDigests.length,
    targetRunCount: input.targetRunCount,
    representedDungeonCount: representedDungeonSlugs.length,
    activeDungeonCount: input.activeDungeonSlugs.length,
    missingDungeons,
    activeDungeonSlugs: input.activeDungeonSlugs,
    representedDungeonSlugs,
  });
}

export function compareAuthoritativeScoringParity(input: {
  cold: ScoreCharacterResult;
  replay: ScoreCharacterResult;
  replayProviderCalls: number;
}): CanaryAuthoritativeReplayAssertion {
  const cold = input.cold;
  const replay = input.replay;
  const coldDims = cold.explainability.dimensions;
  const replayDims = replay.explainability.dimensions;

  const scoresEqual =
    coldDims.PERFORMANCE.score === replayDims.PERFORMANCE.score &&
    coldDims.SURVIVAL.score === replayDims.SURVIVAL.score &&
    coldDims.UTILITY.score === replayDims.UTILITY.score &&
    coldDims.EXPERIENCE.score === replayDims.EXPERIENCE.score;

  const confidenceEqual =
    coldDims.PERFORMANCE.confidenceStory.value ===
      replayDims.PERFORMANCE.confidenceStory.value &&
    coldDims.SURVIVAL.confidenceStory.value ===
      replayDims.SURVIVAL.confidenceStory.value &&
    coldDims.UTILITY.confidenceStory.value ===
      replayDims.UTILITY.confidenceStory.value &&
    coldDims.EXPERIENCE.confidenceStory.value ===
      replayDims.EXPERIENCE.confidenceStory.value &&
    cold.explainability.composite.confidence ===
      replay.explainability.composite.confidence;

  const compositeEqual =
    cold.explainability.composite.score === replay.explainability.composite.score;
  const tierEqual =
    cold.explainability.composite.grade === replay.explainability.composite.grade;
  const explainabilityFingerprintEqual =
    cold.explainability.fingerprint === replay.explainability.fingerprint;

  const coldPublic = projectScoreExplainabilityPublic(cold.explainability);
  const replayPublic = projectScoreExplainabilityPublic(replay.explainability);
  const publicProjectionEqual =
    JSON.stringify(coldPublic) === JSON.stringify(replayPublic);

  return {
    providerCalls: input.replayProviderCalls,
    characterScoreWrites:
      (cold.characterScoreId != null ? 1 : 0) +
      (replay.characterScoreId != null ? 1 : 0),
    scoresEqual,
    confidenceEqual,
    compositeEqual,
    tierEqual,
    explainabilityFingerprintEqual,
    publicProjectionEqual,
  };
}

/** Concise CLI summary lines for operator display. */
export function formatCanaryDimensionCliSummary(
  name: string,
  dim: CanaryAuthoritativeDimensionReport,
): string {
  const lines = [
    name,
    `  score: ${dim.score == null ? "n/a" : dim.score}`,
    `  confidence: ${
      dim.confidence == null
        ? "n/a"
        : `${Math.round(dim.confidence * 1000) / 10}%`
    }`,
  ];
  if (dim.strengths.length > 0) {
    lines.push("  strengths:");
    for (const s of dim.strengths) lines.push(`    - ${s}`);
  }
  if (dim.weaknesses.length > 0) {
    lines.push("  weaknesses:");
    for (const w of dim.weaknesses) lines.push(`    - ${w}`);
  }
  if (dim.scoreFacts.length > 0) {
    lines.push("  score facts:");
    for (const f of dim.scoreFacts) lines.push(`    - ${f}`);
  }
  lines.push("  confidence limits:");
  if (dim.confidenceReasonLabels.length === 0) {
    lines.push("    - none");
  } else {
    for (const r of dim.confidenceReasonLabels) lines.push(`    - ${r}`);
  }
  return lines.join("\n");
}
