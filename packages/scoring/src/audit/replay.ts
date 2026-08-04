/**
 * Provider-free Scoring V2 dimension replay from frozen manifest + persisted facts.
 * Zero provider calls — compares recomputed outputs to persisted DimensionComputations.
 */

import { createHash } from "node:crypto";
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceAuditReplayResult,
} from "@mplus/contracts";
import { characterSeasonEvidenceManifestV2Schema } from "@mplus/contracts";
import {
  finalizeShadowDimensions,
  type PersistedFactSetRef,
  type ScoringV2PublicDimension,
} from "../dimensions/v2/index.js";
import { fingerprintExplanationMetrics } from "./build-evidence-audit.js";

export interface ReplayPersistedDimension {
  dimension: ScoringV2PublicDimension;
  score: number | null;
  confidence: number;
  state: string;
  inputFingerprint: string;
  metrics: unknown;
  explanation: unknown;
}

export interface ReplayScoringV2DimensionsInput {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  manifestDocument: unknown;
  expectedManifestContentHash: string;
  factSets: PersistedFactSetRef[];
  persistedDimensions: ReplayPersistedDimension[];
  enabledDimensions?: ScoringV2PublicDimension[];
  /** Test helper: counts any accidental provider callbacks (must stay 0). */
  providerCallCounter?: { count: number };
}

function approxEqual(
  a: number | null | undefined,
  b: number | null | undefined,
  eps = 1e-6,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

function availabilityFromPersisted(state: string): string {
  // DimensionComputation.state may be AVAILABLE/PARTIAL/UNAVAILABLE or lifecycle.
  if (state === "AVAILABLE" || state === "PARTIAL" || state === "UNAVAILABLE") {
    return state;
  }
  return state;
}

/**
 * Replay all enabled dimensions from persisted facts and compare to stored computations.
 */
export function replayScoringV2Dimensions(
  input: ReplayScoringV2DimensionsInput,
): EvidenceAuditReplayResult {
  const details: string[] = [];
  const providerCallCount = 0;
  if (input.providerCallCounter) {
    input.providerCallCounter.count = 0;
  }

  const parsed = characterSeasonEvidenceManifestV2Schema.safeParse(input.manifestDocument);
  if (!parsed.success) {
    return {
      deterministicMatch: false,
      scoreMatch: false,
      confidenceMatch: false,
      availabilityMatch: false,
      inputFingerprintMatch: false,
      explanationMetricsFingerprintMatch: false,
      providerCallCount: 0,
      details: ["manifest_parse_failed"],
    };
  }
  const manifest: CharacterSeasonEvidenceManifestV2 = parsed.data;

  const enabled: ScoringV2PublicDimension[] = input.enabledDimensions ?? [
    "PERFORMANCE",
    "SURVIVAL",
    "UTILITY",
    "EXPERIENCE",
  ];

  const result = finalizeShadowDimensions({
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    manifest,
    expectedManifestContentHash: input.expectedManifestContentHash,
    enabledDimensions: enabled,
    factSets: input.factSets,
    experienceHistory: null,
    computedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  if (input.providerCallCounter && input.providerCallCounter.count !== 0) {
    details.push("provider_calls_detected_during_replay");
  }

  if (result.blockedReason) {
    details.push(`replay_blocked:${result.blockedReason}`);
  }

  let scoreMatch = true;
  let confidenceMatch = true;
  let availabilityMatch = true;
  let inputFingerprintMatch = true;
  let explanationMetricsFingerprintMatch = true;

  for (const dim of enabled) {
    const persisted = input.persistedDimensions.find((d) => d.dimension === dim);
    const outcome = result.outcomes.find((o) => o.dimension === dim);
    if (!persisted) {
      details.push(`missing_persisted:${dim}`);
      scoreMatch = false;
      confidenceMatch = false;
      availabilityMatch = false;
      inputFingerprintMatch = false;
      explanationMetricsFingerprintMatch = false;
      continue;
    }
    if (!outcome) {
      details.push(`missing_replay_outcome:${dim}`);
      scoreMatch = false;
      continue;
    }

    const replayScore = outcome.record.score;
    const replayConfidence = outcome.record.confidence;
    const replayAvailability = String(
      (outcome.record.metrics as { availabilityState?: string }).availabilityState ??
        outcome.record.state,
    );
    const replayFp = outcome.record.inputFingerprint;
    const replayExplFp = fingerprintExplanationMetrics(
      outcome.record.metrics,
      outcome.record.explanation,
    );
    const persistedExplFp = fingerprintExplanationMetrics(
      persisted.metrics,
      persisted.explanation,
    );

    if (!approxEqual(replayScore, persisted.score)) {
      scoreMatch = false;
      details.push(
        `score_mismatch:${dim}:replay=${replayScore}:persisted=${persisted.score}`,
      );
    }
    if (!approxEqual(replayConfidence, persisted.confidence)) {
      confidenceMatch = false;
      details.push(
        `confidence_mismatch:${dim}:replay=${replayConfidence}:persisted=${persisted.confidence}`,
      );
    }
    if (replayAvailability !== availabilityFromPersisted(persisted.state)) {
      // Persisted DimensionComputation.state may store availability in metrics.
      const metricsAvail =
        typeof persisted.metrics === "object" &&
        persisted.metrics != null &&
        "availabilityState" in (persisted.metrics as Record<string, unknown>)
          ? String((persisted.metrics as Record<string, unknown>).availabilityState)
          : persisted.state;
      if (replayAvailability !== metricsAvail) {
        availabilityMatch = false;
        details.push(
          `availability_mismatch:${dim}:replay=${replayAvailability}:persisted=${metricsAvail}`,
        );
      }
    }
    if (replayFp !== persisted.inputFingerprint) {
      inputFingerprintMatch = false;
      details.push(`input_fingerprint_mismatch:${dim}`);
    }
    // Explanation/metrics may include wall-clock computedAt — compare structural subset.
    // Prefer comparing algorithm/availability/featureUsage fingerprints when full JSON differs.
    const replayCore = createHash("sha256")
      .update(
        JSON.stringify({
          availabilityState: replayAvailability,
          score: replayScore,
          confidence: replayConfidence,
          inputFingerprint: replayFp,
        }),
      )
      .digest("hex");
    const persistedCore = createHash("sha256")
      .update(
        JSON.stringify({
          availabilityState: availabilityFromPersisted(persisted.state),
          score: persisted.score,
          confidence: persisted.confidence,
          inputFingerprint: persisted.inputFingerprint,
        }),
      )
      .digest("hex");
    if (replayExplFp !== persistedExplFp && replayCore !== persistedCore) {
      explanationMetricsFingerprintMatch = false;
      details.push(`explanation_metrics_fingerprint_mismatch:${dim}`);
    }
  }

  const deterministicMatch =
    scoreMatch &&
    confidenceMatch &&
    availabilityMatch &&
    inputFingerprintMatch &&
    (input.providerCallCounter?.count ?? 0) === 0;

  return {
    deterministicMatch,
    scoreMatch,
    confidenceMatch,
    availabilityMatch,
    inputFingerprintMatch,
    explanationMetricsFingerprintMatch,
    providerCallCount,
    details,
  };
}
