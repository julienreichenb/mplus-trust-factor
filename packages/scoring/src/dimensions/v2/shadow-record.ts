/**
 * Shared Shadow DimensionComputation record contract for Scoring V2.
 *
 * Lifecycle (`state`) is always SHADOW during the shadow programme.
 * Availability (AVAILABLE | PARTIAL | UNAVAILABLE) lives only in
 * `metrics.availabilityState` — never in the lifecycle column.
 *
 * Does not alter calculator formulas, weights, or availability rules.
 */

export type ScoringV2PublicDimension =
  | "PERFORMANCE"
  | "SURVIVAL"
  | "UTILITY"
  | "EXPERIENCE";

/** DimensionComputation.state during shadow — lifecycle only. */
export type DimensionComputationLifecycleState = "SHADOW";

/** Calculator availability vocabulary — never written to lifecycle column. */
export type DimensionAvailabilityState = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export const DIMENSION_COMPUTATION_LIFECYCLE_SHADOW =
  "SHADOW" as const satisfies DimensionComputationLifecycleState;

export interface NormalizedShadowDimensionMetrics {
  availabilityState: DimensionAvailabilityState;
  publicationBlocked: true;
  [key: string]: unknown;
}

/**
 * Persistence-ready DimensionComputation payload.
 * Matches CreateDimensionComputationInput field shapes (worker maps dates).
 */
export interface NormalizedShadowDimensionRecord {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: ScoringV2PublicDimension;
  algorithmVersion: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  /** Lifecycle — always SHADOW for AVAILABLE / PARTIAL / UNAVAILABLE. */
  state: DimensionComputationLifecycleState;
  metrics: NormalizedShadowDimensionMetrics;
  explanation: Record<string, unknown>;
  computedAt: Date;
}

/** Loose calculator / worker shadow payload before normalization. */
export interface ShadowDimensionPayloadLike {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: ScoringV2PublicDimension;
  algorithmVersion: string;
  inputFingerprint: string;
  score: number | null;
  confidence: number;
  /** May be incorrectly set by callers; normalization forces SHADOW. */
  state?: string;
  metrics?: Record<string, unknown>;
  explanation?: unknown;
  computedAt: Date;
}

export interface NormalizeShadowDimensionRecordInput {
  payload: ShadowDimensionPayloadLike;
  /**
   * Authoritative availability from the calculator result.
   * Required — do not infer from payload.state (lifecycle).
   */
  availabilityState: DimensionAvailabilityState;
  /**
   * Optional structured limitations / failure reasons merged into metrics.
   * Does not replace calculator metrics.
   */
  limitations?: string[];
  failureReasons?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a calculator shadow payload for DimensionComputation persistence.
 * Preserves score, confidence, fingerprint, algorithmVersion, and explanation.
 * Forces lifecycle SHADOW and normalized metrics fields.
 */
export function normalizeShadowDimensionRecord(
  input: NormalizeShadowDimensionRecordInput,
): NormalizedShadowDimensionRecord {
  const { payload, availabilityState } = input;
  const baseMetrics = isRecord(payload.metrics) ? { ...payload.metrics } : {};

  // Strip any accidental lifecycle leakage from metrics / payload.state.
  delete baseMetrics.state;

  const metrics: NormalizedShadowDimensionMetrics = {
    ...baseMetrics,
    availabilityState,
    publicationBlocked: true,
  };

  if (input.limitations && input.limitations.length > 0) {
    const existing = Array.isArray(metrics.limitations)
      ? (metrics.limitations as unknown[])
      : [];
    metrics.limitations = [...existing, ...input.limitations];
  }
  if (input.failureReasons && input.failureReasons.length > 0) {
    const existing = Array.isArray(metrics.failureReasons)
      ? (metrics.failureReasons as unknown[])
      : [];
    metrics.failureReasons = [...existing, ...input.failureReasons];
  }

  const explanation = isRecord(payload.explanation)
    ? { ...payload.explanation }
    : {};

  return {
    characterId: payload.characterId,
    seasonId: payload.seasonId,
    manifestId: payload.manifestId,
    scoreModelId: payload.scoreModelId,
    dimension: payload.dimension,
    algorithmVersion: payload.algorithmVersion,
    inputFingerprint: payload.inputFingerprint,
    score: payload.score,
    confidence: payload.confidence,
    state: DIMENSION_COMPUTATION_LIFECYCLE_SHADOW,
    metrics,
    explanation,
    computedAt: payload.computedAt,
  };
}

export interface BuildUnavailableShadowDimensionRecordInput {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  dimension: ScoringV2PublicDimension;
  algorithmVersion: string;
  /** Deterministic fingerprint for this unavailable outcome. */
  inputFingerprint: string;
  computedAt: Date;
  limitations: string[];
  failureReasons: string[];
  /** Extra metrics (e.g. manifestContentHash) — never overrides availability. */
  extraMetrics?: Record<string, unknown>;
  explanation?: Record<string, unknown>;
}

/**
 * Build a persisted SHADOW + UNAVAILABLE record when facts are missing,
 * placeholder, incompatible, or otherwise not calculator-ready.
 * Never skips an enabled dimension silently.
 */
export function buildUnavailableShadowDimensionRecord(
  input: BuildUnavailableShadowDimensionRecordInput,
): NormalizedShadowDimensionRecord {
  return normalizeShadowDimensionRecord({
    payload: {
      characterId: input.characterId,
      seasonId: input.seasonId,
      manifestId: input.manifestId,
      scoreModelId: input.scoreModelId,
      dimension: input.dimension,
      algorithmVersion: input.algorithmVersion,
      inputFingerprint: input.inputFingerprint,
      score: null,
      confidence: 0,
      state: DIMENSION_COMPUTATION_LIFECYCLE_SHADOW,
      metrics: {
        ...(input.extraMetrics ?? {}),
        source: "unavailable_shadow_record",
      },
      explanation: {
        mode: "unavailable",
        publicationBlocked: true,
        ...(input.explanation ?? {}),
      },
      computedAt: input.computedAt,
    },
    availabilityState: "UNAVAILABLE",
    limitations: input.limitations,
    failureReasons: input.failureReasons,
  });
}

/** Resolve availability from Performance / Survival / Experience result.state. */
export function availabilityFromComputeState(
  state: DimensionAvailabilityState | string,
): DimensionAvailabilityState {
  if (state === "AVAILABLE" || state === "PARTIAL" || state === "UNAVAILABLE") {
    return state;
  }
  // Fail closed — unknown vocabulary must not become AVAILABLE.
  return "UNAVAILABLE";
}

/** Resolve availability from Utility V2 (uses availabilityState field). */
export function availabilityFromUtilityResult(availabilityState: string): DimensionAvailabilityState {
  return availabilityFromComputeState(availabilityState);
}
