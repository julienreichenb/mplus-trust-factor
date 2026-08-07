/**
 * Provider-free Scoring V2 dimension replay from frozen manifest + persisted facts.
 * Zero provider calls by construction — import-boundary tests prove no provider clients.
 *
 * WCL-backed dimensions only by default: PERFORMANCE, SURVIVAL, UTILITY.
 * EXPERIENCE is OUT_OF_SCOPE / NOT_AUDITED here.
 */

import { createHash } from "node:crypto";
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceAuditReplayResult,
  FeatureUsageEntry,
} from "@mplus/contracts";
import { characterSeasonEvidenceManifestV2Schema } from "@mplus/contracts";
import {
  finalizeShadowDimensions,
  type PersistedFactSetRef,
  type ScoringPublicDimension,
} from "../dimensions/v2/index.js";
import { stableStringify } from "../model-config/stable-hash.js";
import { parseFactDocumentIdentity, identitiesMatch } from "./fact-identity.js";

export interface ReplayPersistedDimension {
  dimension: ScoringPublicDimension;
  score: number | null;
  confidence: number;
  state: string;
  inputFingerprint: string;
  metrics: unknown;
  explanation: unknown;
  scoreModelId?: string | null;
}

export interface ReplayscoringDimensionsInput {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  manifestDocument: unknown;
  expectedManifestContentHash: string;
  factSets: PersistedFactSetRef[];
  persistedDimensions: ReplayPersistedDimension[];
  /** Defaults to WCL-backed dimensions only (EXPERIENCE excluded). */
  enabledDimensions?: ScoringPublicDimension[];
}

const WCL_REPLAY_DIMENSIONS: ScoringPublicDimension[] = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
];

/** Explicitly allowlisted volatile fields stripped before fingerprint compare. */
const VOLATILE_METRIC_KEYS = new Set([
  "computedAt",
  "auditedAt",
  "wallClockMs",
  "latencyMs",
]);

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
  if (state === "AVAILABLE" || state === "PARTIAL" || state === "UNAVAILABLE") {
    return state;
  }
  return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (VOLATILE_METRIC_KEYS.has(k)) continue;
    out[k] = stripVolatile(v);
  }
  return out;
}

/** Stable recursive fingerprint of explanation+metrics (sorted keys). */
export function fingerprintExplanationMetrics(
  metrics: unknown,
  explanation: unknown,
): string {
  const payload = {
    metrics: stripVolatile(metrics ?? {}),
    explanation: stripVolatile(explanation ?? {}),
  };
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

/** Stable compare of featureUsage — order by featurePath. */
function featureUsageFingerprint(metrics: unknown): string {
  if (!isRecord(metrics) || !Array.isArray(metrics.featureUsage)) {
    return createHash("sha256").update("[]").digest("hex");
  }
  const rows = (metrics.featureUsage as FeatureUsageEntry[])
    .map((e) => ({
      featurePath: e.featurePath,
      scoringRole: e.scoringRole,
      consumed: e.consumed,
      exclusionReason: e.exclusionReason,
      outputComponentOrConfidenceField: e.outputComponentOrConfidenceField,
      selectedSlotCountContaining: e.selectedSlotCountContaining,
      validValueCount: e.validValueCount,
      missingCount: e.missingCount,
      zeroCount: e.zeroCount,
    }))
    .sort((a, b) => a.featurePath.localeCompare(b.featurePath));
  return createHash("sha256").update(stableStringify(rows), "utf8").digest("hex");
}

/**
 * Keep only facts whose document identity matches the exact selected slot
 * they are attached to (dungeonSlug + slotIndex), not merely any selected fight.
 */
export function identityValidFactSets(
  manifest: CharacterSeasonEvidenceManifestV2,
  factSets: PersistedFactSetRef[],
): PersistedFactSetRef[] {
  return factSets.filter((fs) => {
    const family = fs.extractorFamily.toUpperCase();
    if (family !== "PERFORMANCE" && family !== "SURVIVAL" && family !== "UTILITY") {
      return false;
    }
    if (fs.dungeonSlug == null || fs.slotIndex == null) return false;
    const slot = manifest.slots.find(
      (s) =>
        s.state === "SELECTED" &&
        s.dungeonSlug === fs.dungeonSlug &&
        s.slotIndex === fs.slotIndex,
    );
    if (!slot?.identity) return false;
    const doc = parseFactDocumentIdentity(family, fs.facts);
    return identitiesMatch(doc, {
      reportCode: slot.identity.reportCode,
      fightId: slot.identity.fightId,
      reportRevision: slot.identity.reportRevision,
    });
  });
}

/**
 * Replay WCL-backed dimensions from persisted facts and compare to stored computations.
 */
export function replayscoringDimensions(
  input: ReplayscoringDimensionsInput,
): EvidenceAuditReplayResult {
  const details: string[] = [];

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

  const requested = input.enabledDimensions ?? WCL_REPLAY_DIMENSIONS;
  const enabled = requested.filter(
    (d): d is "PERFORMANCE" | "SURVIVAL" | "UTILITY" =>
      d === "PERFORMANCE" || d === "SURVIVAL" || d === "UTILITY",
  );
  if (requested.includes("EXPERIENCE")) {
    details.push("EXPERIENCE:OUT_OF_SCOPE");
  }

  const scoreModelIds = [
    ...new Set(
      input.persistedDimensions
        .filter((d) =>
          (enabled as readonly ScoringPublicDimension[]).includes(d.dimension),
        )
        .map((d) => d.scoreModelId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (scoreModelIds.length > 1) {
    return {
      deterministicMatch: false,
      scoreMatch: false,
      confidenceMatch: false,
      availabilityMatch: false,
      inputFingerprintMatch: false,
      explanationMetricsFingerprintMatch: false,
      providerCallCount: 0,
      details: [`mixed_score_model_ids:${scoreModelIds.join(",")}`],
    };
  }

  const validFacts = identityValidFactSets(manifest, input.factSets);
  const rejected = input.factSets.length - validFacts.length;
  if (rejected > 0) {
    details.push(`excluded_identity_invalid_facts:${rejected}`);
  }

  const result = finalizeShadowDimensions({
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    manifest,
    expectedManifestContentHash: input.expectedManifestContentHash,
    enabledDimensions: enabled,
    factSets: validFacts,
    experienceHistory: null,
    computedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

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
    const replayUsageFp = featureUsageFingerprint(outcome.record.metrics);
    const persistedUsageFp = featureUsageFingerprint(persisted.metrics);

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
    const metricsAvail =
      typeof persisted.metrics === "object" &&
      persisted.metrics != null &&
      "availabilityState" in (persisted.metrics as Record<string, unknown>)
        ? String((persisted.metrics as Record<string, unknown>).availabilityState)
        : availabilityFromPersisted(persisted.state);
    if (replayAvailability !== metricsAvail) {
      availabilityMatch = false;
      details.push(
        `availability_mismatch:${dim}:replay=${replayAvailability}:persisted=${metricsAvail}`,
      );
    }
    if (replayFp !== persisted.inputFingerprint) {
      inputFingerprintMatch = false;
      details.push(`input_fingerprint_mismatch:${dim}`);
    }
    if (replayExplFp !== persistedExplFp) {
      explanationMetricsFingerprintMatch = false;
      details.push(`explanation_metrics_fingerprint_mismatch:${dim}`);
    }
    if (replayUsageFp !== persistedUsageFp) {
      explanationMetricsFingerprintMatch = false;
      details.push(`feature_usage_mismatch:${dim}`);
    }
  }

  const deterministicMatch =
    scoreMatch &&
    confidenceMatch &&
    availabilityMatch &&
    inputFingerprintMatch &&
    explanationMetricsFingerprintMatch;

  return {
    deterministicMatch,
    scoreMatch,
    confidenceMatch,
    availabilityMatch,
    inputFingerprintMatch,
    explanationMetricsFingerprintMatch,
    providerCallCount: 0,
    details,
  };
}
