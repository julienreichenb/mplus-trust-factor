import type { Grade } from "./scoring.js";

/**
 * Season-scoped key-difficulty + spec-meta context applied after the raw composite.
 * Pure types — no Prisma. Percentile identity is integer basis points (P90 = 9000).
 */

export const SCORE_CONTEXT_SCHEMA_VERSION = "score-context-v1" as const;

export const NONE_CONTEXT_REVISION_KEY = "none" as const;

export function formatPercentileBpsLabel(bps: number | null | undefined): string | null {
  if (bps == null || !Number.isInteger(bps) || bps <= 0) return null;
  const pct = bps / 100;
  if (Number.isInteger(pct)) return `P${pct}`;
  return `P${pct.toFixed(1).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export const PERCENTILE_BPS_P90 = 9000 as const;
export const PERCENTILE_BPS_P99 = 9900 as const;
export const PERCENTILE_BPS_P99_9 = 9990 as const;

export type ScoreContextStatus =
  | "AVAILABLE"
  | "UNKNOWN"
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "INCOMPLETE_SELECTION"
  | "SPEC_UNKNOWN";

export type MetaTier = 1 | 2 | 3 | 4 | 5;

export interface MedianKeyDistributionPoint {
  percentileBps: number;
  medianKeyThreshold: number;
}

export interface SeasonMedianKeyDistribution {
  id: string;
  seasonId: string;
  source: string;
  provenance: Record<string, unknown>;
  sourceVersion: string | null;
  collectedAt: string;
  effectiveAt: string | null;
  contentHash: string;
  points: MedianKeyDistributionPoint[];
}

export interface ScoreContextPercentileAnchor {
  percentileBps: number;
  factor: number;
}

export interface ScoreContextSpecAssignment {
  classSlug: string;
  specSlug: string;
  tier: MetaTier;
}

export type ScoreContextTierFactors = Record<MetaTier, number>;

export interface SeasonScoreContextRevisionDoc {
  id: string;
  seasonId: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
  tierFactors: ScoreContextTierFactors;
  specAssignments: ScoreContextSpecAssignment[];
  percentileAnchors: ScoreContextPercentileAnchor[];
  distribution: SeasonMedianKeyDistribution | null;
}

export interface ScoreContextCanonicalRun {
  dungeonSlug: string;
  canonicalRunId: string;
  keyLevel: number;
  timed?: boolean | null;
  selectionReason?: string | null;
}

export interface ScoreContextKeyBreakdown {
  status: ScoreContextStatus;
  canonicalRuns: ScoreContextCanonicalRun[];
  medianKeyLevel: number | null;
  appliedAnchorPercentileBps: number | null;
  appliedAnchorKeyThreshold: number | null;
  nextAnchorPercentileBps: number | null;
  nextAnchorKeyThreshold: number | null;
  /** Display label for appliedAnchorPercentileBps (e.g. P99). API-provided. */
  appliedAnchorPercentileLabel: string | null;
  nextAnchorPercentileLabel: string | null;
  factor: number;
  distributionSnapshotId: string | null;
  distributionSource: string | null;
  distributionVersion: string | null;
  distributionCollectedAt: string | null;
  reason: string | null;
}

export interface ScoreContextMetaBreakdown {
  status: ScoreContextStatus;
  classSlug: string | null;
  specSlug: string | null;
  specSource: string | null;
  tier: MetaTier | null;
  factor: number;
  reason: string | null;
}

export interface AppliedScoreContext {
  schemaVersion: typeof SCORE_CONTEXT_SCHEMA_VERSION;
  seasonId: string;
  contextRevisionId: string | null;
  contextRevisionKey: string;
  contextRevisionVersion: number | null;
  distributionSnapshotId: string | null;
  rawScoreBeforeContext: number | null;
  key: ScoreContextKeyBreakdown;
  meta: ScoreContextMetaBreakdown;
  combinedFactor: number;
  preClampAdjustedScore: number | null;
  wasClamped: boolean;
  finalScore: number | null;
  /** Letter grade of rawScoreBeforeContext (P/S/U/E aggregate). Null when raw is missing. */
  rawGrade: Exclude<Grade, "U"> | null;
  /** Letter grade of finalScore (product FINAL SCORE). Null when final is missing. */
  finalGrade: Exclude<Grade, "U"> | null;
}

export interface ScoreSnapshotContextProjection {
  rawScoreBeforeContext: number | null;
  keyContext: ScoreContextKeyBreakdown;
  metaContext: ScoreContextMetaBreakdown;
  combinedFactor: number;
  preClampAdjustedScore: number | null;
  wasClamped: boolean;
  finalScore: number | null;
  rawGrade: Exclude<Grade, "U"> | null;
  finalGrade: Exclude<Grade, "U"> | null;
  contextRevisionId: string | null;
  contextRevisionVersion: number | null;
}
