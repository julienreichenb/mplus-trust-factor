/**
 * Map authoritative CharacterScore / scoreCharacter result → public ScoreSnapshotDTO.
 * Keeps API/UI shape while legacy placeholder calculateScore is removed.
 */
import type {
  DimensionScoreDTO,
  Grade,
  ScoreSnapshotDTO,
} from "@mplus/contracts";
import type { ScoreCharacterResult } from "./score-character.js";
import { SCORING_VERSION } from "./score-character.js";

function dimensionState(
  score: number | null | undefined,
  confidence: number | null | undefined,
  blockedReason: string | null,
): DimensionScoreDTO["state"] {
  if (blockedReason) return "UNAVAILABLE";
  if (score == null || !Number.isFinite(score)) return "UNAVAILABLE";
  if ((confidence ?? 0) < 0.35) return "PARTIAL";
  return "AVAILABLE";
}

function gradeFromScore(score: number | null, confidence: number | null): Grade {
  if (score == null || (confidence ?? 0) < 0.35) return "U";
  if (score >= 90) return "S";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

export function scoreCharacterResultToSnapshotDto(input: {
  result: ScoreCharacterResult;
  characterId: string;
  seasonSlug: string;
  scoreModelKey: string;
  scoreModelVersion: number;
  calculatedAt: string;
  inputFingerprint: string;
  publicationEnabled: boolean;
}): ScoreSnapshotDTO {
  const { orchestration } = input.result;
  const perf = orchestration.dimensions.performance;
  const util = orchestration.dimensions.utility;
  const surv = orchestration.dimensions.survival;
  const blocked = new Map(
    orchestration.dimensions.blocked.map((b) => [b.dimension, b.reason]),
  );

  const dimensions: DimensionScoreDTO[] = [
    {
      dimension: "PERFORMANCE",
      score: perf?.score ?? null,
      confidence: perf?.confidence ?? 0,
      weight: 0.35,
      state: dimensionState(
        perf?.score,
        perf?.confidence,
        blocked.get("PERFORMANCE") ?? null,
      ),
      reason: blocked.get("PERFORMANCE") ?? null,
      contributors: [],
    },
    {
      dimension: "UTILITY",
      score: util?.score ?? null,
      confidence: util?.confidence ?? 0,
      weight: 0.25,
      state: dimensionState(
        util?.score,
        util?.confidence,
        blocked.get("UTILITY") ?? null,
      ),
      reason: blocked.get("UTILITY") ?? null,
      contributors: [],
    },
    {
      dimension: "SURVIVAL",
      score: surv?.score ?? null,
      confidence: surv?.confidence ?? 0,
      weight: 0.25,
      state: dimensionState(
        surv?.score,
        surv?.confidence,
        blocked.get("SURVIVAL") ?? null,
      ),
      reason: blocked.get("SURVIVAL") ?? null,
      contributors: [],
    },
    {
      dimension: "EXPERIENCE",
      score: null,
      confidence: 0,
      weight: 0.15,
      state: "UNAVAILABLE",
      reason: "EXPERIENCE_NOT_YET_WIRED",
      contributors: [],
    },
  ];

  const usable = [perf?.score, util?.score, surv?.score].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const overallScore =
    usable.length > 0
      ? usable.reduce((a, b) => a + b, 0) / usable.length
      : 0;
  const confidences = [perf?.confidence, util?.confidence, surv?.confidence].filter(
    (v): v is number => typeof v === "number",
  );
  const confidence = confidences.length > 0 ? Math.min(...confidences) : 0;

  const incomplete = orchestration.incomplete || usable.length < 3;
  const overallState: NonNullable<ScoreSnapshotDTO["overallState"]> = incomplete
    ? "PROVISIONAL"
    : usable.length === 0
      ? "PROVISIONAL"
      : "DEFINITIVE";

  return {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    modelKey: input.scoreModelKey,
    modelVersion: input.scoreModelVersion,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore,
    skillScore: overallScore,
    authenticityScore: 100,
    confidence,
    grade: gradeFromScore(usable.length > 0 ? overallScore : null, confidence),
    overallState,
    provisionalReason: incomplete
      ? `PARTIAL_EVIDENCE:selected=${orchestration.selectedSlotCount}/${orchestration.expectedSlotCount}`
      : null,
    dimensions,
    calculatedAt: input.calculatedAt,
    inputFingerprint: input.inputFingerprint,
    redFlags: [],
    explanation: {
      scoringVersion: input.result.scoringVersion ?? SCORING_VERSION,
      characterScoreId: input.result.characterScoreId,
      providerCalls: input.result.providerCalls,
      publicationEnabled: input.publicationEnabled,
      incomplete: orchestration.incomplete,
      cacheMisses: orchestration.cacheMisses.length,
      fightFailures: orchestration.fightFailures.length,
      targetDigestFailures: orchestration.targetDigestFailures.length,
      blocked: orchestration.dimensions.blocked,
      selectedRuns: orchestration.characterDigests.map((d) => ({
        slotId: d.slotId,
        dungeonSlug: d.dungeonSlug,
        reportCode: d.digest.reportCode,
        fightId: d.digest.fightId,
        reportRevision: d.digest.reportRevision,
      })),
    },
    rankingEligibility: {
      eligible: !incomplete && usable.length > 0,
      scoreModelVersion: input.scoreModelVersion,
      reasons: incomplete ? ["PARTIAL_EVIDENCE"] : [],
      utilityEligible: util?.score != null,
    },
  };
}

export function scoringDisabledSnapshotDto(input: {
  characterId: string;
  seasonSlug: string;
  scoreModelKey: string;
  scoreModelVersion: number;
  calculatedAt: string;
  inputFingerprint: string;
}): ScoreSnapshotDTO {
  return {
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    modelKey: input.scoreModelKey,
    modelVersion: input.scoreModelVersion,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore: 0,
    skillScore: 0,
    authenticityScore: 0,
    confidence: 0,
    grade: "U",
    overallState: "PROVISIONAL",
    provisionalReason: "SCORING_DISABLED",
    dimensions: (
      ["PERFORMANCE", "UTILITY", "SURVIVAL", "EXPERIENCE"] as const
    ).map((dimension) => ({
      dimension,
      score: null,
      confidence: 0,
      weight: 0.25,
      state: "UNAVAILABLE" as const,
      reason: "SCORING_DISABLED",
      contributors: [],
    })),
    calculatedAt: input.calculatedAt,
    inputFingerprint: input.inputFingerprint,
    redFlags: [],
    explanation: { scoringDisabled: true },
    rankingEligibility: {
      eligible: false,
      scoreModelVersion: input.scoreModelVersion,
      reasons: ["SCORING_DISABLED"],
      utilityEligible: false,
    },
  };
}
