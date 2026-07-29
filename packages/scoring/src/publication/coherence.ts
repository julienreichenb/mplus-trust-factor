import type { DimensionScoreDTO, MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import type { ScoreModelConfigV1 } from "../types.js";
import { computeModelCoverage } from "../model-coverage.js";

/** Publication states for immutable score snapshots. */
export type PublicationStatus =
  | "CANDIDATE"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "REJECTED_INCOMPLETE"
  | "DRAFT"
  | "PUBLIC";

export type CoverageState = "COMPLETE" | "PARTIAL" | "DEGRADED" | "INSUFFICIENT";

export interface CoherenceValidationInput {
  candidate: ScoreSnapshotDTO;
  published: ScoreSnapshotDTO | null;
  model: ScoreModelConfigV1;
  refreshContractHash: string;
  expectedModelKey: string;
  expectedModelVersion: number;
  /** Observations used to build the candidate (for schema checks). */
  observations: MetricObservationDTO[];
  /** True when this is the first-ever calculation for the character/season. */
  isFirstCalculation: boolean;
}

export interface CoherenceViolation {
  code: string;
  message: string;
  dimension?: string;
}

export interface CoherenceValidationResult {
  ok: boolean;
  violations: CoherenceViolation[];
  coverageState: CoverageState;
  /** Dimensions that regressed vs published snapshot. */
  regressedDimensions: string[];
}

const SKILL_DIMENSIONS = ["PERFORMANCE", "SURVIVAL", "EXPERIENCE"] as const;

function dimensionMap(
  snapshot: ScoreSnapshotDTO,
): Map<string, DimensionScoreDTO> {
  return new Map(snapshot.dimensions.map((d) => [d.dimension, d]));
}

function isDimensionAvailable(dim: DimensionScoreDTO | undefined): boolean {
  if (!dim) return false;
  return dim.state === "AVAILABLE" || dim.state === "PARTIAL";
}

function hasUsableScore(dim: DimensionScoreDTO | undefined): boolean {
  if (!dim) return false;
  return dim.score != null && dim.confidence > 0 && isDimensionAvailable(dim);
}

function readContractHash(explanation: unknown): string | null {
  if (!explanation || typeof explanation !== "object") return null;
  const hash = (explanation as { refreshContractHash?: unknown }).refreshContractHash;
  return typeof hash === "string" ? hash : null;
}

/**
 * Validates whether a candidate snapshot may replace the current published snapshot.
 * Enforces last-known-good semantics: partial provider failures must not erase dimensions.
 */
export function validateCoherence(input: CoherenceValidationInput): CoherenceValidationResult {
  const violations: CoherenceViolation[] = [];
  const regressedDimensions: string[] = [];
  const { candidate, published, model, observations } = input;

  if (candidate.modelKey !== input.expectedModelKey) {
    violations.push({
      code: "MODEL_KEY_MISMATCH",
      message: `Expected model key ${input.expectedModelKey}, got ${candidate.modelKey}`,
    });
  }
  if (candidate.modelVersion !== input.expectedModelVersion) {
    violations.push({
      code: "MODEL_VERSION_MISMATCH",
      message: `Expected model version ${input.expectedModelVersion}, got ${candidate.modelVersion}`,
    });
  }

  const candidateContractHash = readContractHash(candidate.explanation);
  if (candidateContractHash && candidateContractHash !== input.refreshContractHash) {
    violations.push({
      code: "REFRESH_CONTRACT_MISMATCH",
      message: "Candidate refresh contract hash does not match active contract",
    });
  }

  for (const obs of observations) {
    if (!obs.metricKey || typeof obs.metricKey !== "string") {
      violations.push({
        code: "INVALID_OBSERVATION_SCHEMA",
        message: "Observation missing metricKey",
      });
      break;
    }
    if (obs.confidence < 0 || obs.confidence > 1 || !Number.isFinite(obs.confidence)) {
      violations.push({
        code: "INVALID_OBSERVATION_SCHEMA",
        message: `Invalid confidence for ${obs.metricKey}`,
      });
    }
  }

  const candidateDims = dimensionMap(candidate);
  const publishedDims = published ? dimensionMap(published) : null;

  if (publishedDims) {
    for (const dimName of SKILL_DIMENSIONS) {
      const prev = publishedDims.get(dimName);
      const next = candidateDims.get(dimName);
      const prevAvailable = hasUsableScore(prev);
      const nextAvailable = hasUsableScore(next);

      if (prevAvailable && !nextAvailable) {
        regressedDimensions.push(dimName);
        violations.push({
          code: "DIMENSION_REGRESSION",
          message: `${dimName} was available in published snapshot but unavailable in candidate`,
          dimension: dimName,
        });
      }
    }

    const prevCoverage = published.modelCoverageRatio ?? computeModelCoverage(
      published.dimensions.map((d) => ({
        dimension: d.dimension,
        score: d.score,
        confidence: d.confidence,
        weight: d.weight,
        contributors: (d.contributors ?? []) as never[],
        state: d.state,
        reason: d.reason,
      })),
      model,
    ).modelCoverageRatio;

    const nextCoverage = candidate.modelCoverageRatio ?? computeModelCoverage(
      candidate.dimensions.map((d) => ({
        dimension: d.dimension,
        score: d.score,
        confidence: d.confidence,
        weight: d.weight,
        contributors: (d.contributors ?? []) as never[],
        state: d.state,
        reason: d.reason,
      })),
      model,
    ).modelCoverageRatio;

    if (nextCoverage < prevCoverage - 0.05) {
      violations.push({
        code: "COVERAGE_REGRESSION",
        message: `Model coverage dropped from ${(prevCoverage * 100).toFixed(1)}% to ${(nextCoverage * 100).toFixed(1)}%`,
      });
    }
  }

  const coverage = computeModelCoverage(
    candidate.dimensions.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      confidence: d.confidence,
      weight: d.weight,
      contributors: (d.contributors ?? []) as never[],
      state: d.state,
      reason: d.reason,
    })),
    model,
  );

  let coverageState: CoverageState;
  if (coverage.modelCoverageRatio >= 0.9) {
    coverageState = "COMPLETE";
  } else if (coverage.modelCoverageRatio >= 0.5) {
    coverageState = "PARTIAL";
  } else if (published && violations.some((v) => v.code === "DIMENSION_REGRESSION")) {
    coverageState = "DEGRADED";
  } else {
    coverageState = "INSUFFICIENT";
  }

  if (input.isFirstCalculation && coverage.modelCoverageRatio < 0.5) {
    // First calculation may legitimately be incomplete — allow but mark insufficient.
    return {
      ok: violations.filter((v) => v.code !== "DIMENSION_REGRESSION" && v.code !== "COVERAGE_REGRESSION").length === 0,
      violations,
      coverageState: "INSUFFICIENT",
      regressedDimensions,
    };
  }

  const blockingViolations = violations.filter(
    (v) =>
      v.code === "DIMENSION_REGRESSION" ||
      v.code === "COVERAGE_REGRESSION" ||
      v.code === "MODEL_KEY_MISMATCH" ||
      v.code === "MODEL_VERSION_MISMATCH" ||
      v.code === "REFRESH_CONTRACT_MISMATCH" ||
      v.code === "INVALID_OBSERVATION_SCHEMA",
  );

  return {
    ok: blockingViolations.length === 0,
    violations,
    coverageState,
    regressedDimensions,
  };
}

export interface MergeObservationsInput {
  /** Fresh observations from the current refresh attempt. */
  incoming: MetricObservationDTO[];
  /** Previously persisted observations (last known good). */
  persisted: MetricObservationDTO[];
  /** Metric keys successfully refreshed in this attempt. */
  refreshedMetricKeys: Set<string>;
  /** Dimensions that failed in this refresh (keep persisted observations). */
  failedDimensions: Set<string>;
}

/**
 * Merge incoming observations with persisted ones, preserving last-known-good data
 * for dimensions where the provider failed in the current refresh.
 */
export function mergeObservationsWithLastKnownGood(
  input: MergeObservationsInput,
): MetricObservationDTO[] {
  const byKey = new Map<string, MetricObservationDTO>();

  for (const obs of input.persisted) {
    if (input.failedDimensions.has(obs.dimension)) {
      byKey.set(obs.metricKey, obs);
    }
  }

  for (const obs of input.incoming) {
    if (input.refreshedMetricKeys.has(obs.metricKey) || !input.failedDimensions.has(obs.dimension)) {
      byKey.set(obs.metricKey, obs);
    }
  }

  return [...byKey.values()];
}

export function buildObservationKey(obs: MetricObservationDTO): string {
  const ctx = obs.context && typeof obs.context === "object"
    ? (obs.context as Record<string, unknown>)
    : {};
  const reportCode = typeof ctx.reportCode === "string" ? ctx.reportCode : "";
  const fightId = typeof ctx.fightId === "string" || typeof ctx.fightId === "number"
    ? String(ctx.fightId)
    : "";
  const analysisVersion = typeof ctx.analysisVersion === "string" ? ctx.analysisVersion : "";
  const payloadFingerprint = typeof ctx.sourcePayloadFingerprint === "string"
    ? ctx.sourcePayloadFingerprint
    : "";
  return [
    obs.metricKey,
    obs.sourceProvider,
    reportCode,
    fightId,
    analysisVersion,
    payloadFingerprint,
  ].join("|");
}
