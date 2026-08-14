import { findSpecDefinition } from "@mplus/abilities";
import {
  NONE_CONTEXT_REVISION_KEY,
  SCORE_CONTEXT_SCHEMA_VERSION,
  type AppliedScoreContext,
  type MetaTier,
  type ScoreContextCanonicalRun,
  type ScoreContextKeyBreakdown,
  type ScoreContextMetaBreakdown,
  type SeasonScoreContextRevisionDoc,
} from "@mplus/contracts";
import { clamp } from "../math.js";
import { gradeScore } from "../trust.js";
import type { ScoringRunSelection } from "../selection/scoring-run-selection.js";
import { computeTrueMedian } from "./median.js";
import { pickStepBandAnchor, resolveAnchorsAgainstDistribution } from "./step-band.js";

export const DEFAULT_CONTEXT_GRADE_THRESHOLDS = { S: 90, A: 80, B: 65, C: 50 } as const;

export interface SeasonScoringSpecInput {
  classSlug: string | null;
  specSlug: string | null;
  source: string | null;
}

export interface ApplyScoreContextInput {
  seasonId: string;
  rawScoreBeforeContext: number | null;
  canonicalRunSelection: ScoringRunSelection | null;
  seasonContextRevision: SeasonScoreContextRevisionDoc | null;
  seasonScoringSpec: SeasonScoringSpecInput | null;
  gradeThresholds?: { S: number; A: number; B: number; C: number };
}

export function isCompleteCanonicalRunSelection(
  selection: ScoringRunSelection | null | undefined,
): selection is ScoringRunSelection {
  if (!selection) return false;
  const expected = selection.expectedDungeonCount;
  if (!Number.isInteger(expected) || expected <= 0) return false;
  if (selection.selectedRuns.length !== expected) return false;
  const slugs = selection.selectedRuns.map((r) => r.dungeonSlug.trim().toLowerCase());
  if (slugs.some((s) => !s)) return false;
  return new Set(slugs).size === expected;
}

function emptyKey(runs: ScoreContextCanonicalRun[], extras: Partial<ScoreContextKeyBreakdown>): ScoreContextKeyBreakdown {
  return {
    status: extras.status ?? "UNKNOWN",
    canonicalRuns: runs,
    medianKeyLevel: extras.medianKeyLevel ?? null,
    appliedAnchorPercentileBps: extras.appliedAnchorPercentileBps ?? null,
    appliedAnchorKeyThreshold: extras.appliedAnchorKeyThreshold ?? null,
    nextAnchorPercentileBps: extras.nextAnchorPercentileBps ?? null,
    nextAnchorKeyThreshold: extras.nextAnchorKeyThreshold ?? null,
    factor: extras.factor ?? 1,
    distributionSnapshotId: extras.distributionSnapshotId ?? null,
    distributionSource: extras.distributionSource ?? null,
    distributionVersion: extras.distributionVersion ?? null,
    distributionCollectedAt: extras.distributionCollectedAt ?? null,
    reason: extras.reason ?? null,
  };
}

function toCanonicalRuns(selection: ScoringRunSelection | null): ScoreContextCanonicalRun[] {
  if (!selection) return [];
  return selection.selectedRuns.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    canonicalRunId: r.canonicalRunId,
    keyLevel: r.keyLevel,
    timed: r.timed,
    selectionReason: r.selectionReason,
  }));
}

function resolveKeyContext(input: ApplyScoreContextInput): ScoreContextKeyBreakdown {
  const runs = toCanonicalRuns(input.canonicalRunSelection);
  const revision = input.seasonContextRevision;
  const dist = revision?.distribution ?? null;

  if (!isCompleteCanonicalRunSelection(input.canonicalRunSelection)) {
    return emptyKey(runs, {
      status: "INCOMPLETE_SELECTION",
      reason: "INCOMPLETE_CANONICAL_SELECTION",
    });
  }

  const median = computeTrueMedian(input.canonicalRunSelection.selectedRuns.map((r) => r.keyLevel));
  if (median == null) {
    return emptyKey(runs, {
      status: "UNAVAILABLE",
      reason: "MEDIAN_UNAVAILABLE",
    });
  }

  if (!revision) {
    return emptyKey(runs, {
      status: "UNKNOWN",
      medianKeyLevel: median,
      reason: "CONTEXT_REVISION_NOT_PUBLISHED",
    });
  }

  if (!dist || dist.points.length === 0) {
    return emptyKey(runs, {
      status: "UNKNOWN",
      medianKeyLevel: median,
      reason: "MEDIAN_KEY_DISTRIBUTION_MISSING",
    });
  }

  const resolved = resolveAnchorsAgainstDistribution({
    anchors: revision.percentileAnchors,
    points: dist.points,
  });
  if (resolved.length === 0) {
    return emptyKey(runs, {
      status: "NOT_CONFIGURED",
      medianKeyLevel: median,
      distributionSnapshotId: dist.id,
      distributionSource: dist.source,
      distributionVersion: dist.sourceVersion,
      distributionCollectedAt: dist.collectedAt,
      reason: "KEY_ANCHORS_NOT_CONFIGURED",
    });
  }

  const pick = pickStepBandAnchor(median, resolved);
  if (!pick) {
    return emptyKey(runs, {
      status: "UNAVAILABLE",
      medianKeyLevel: median,
      distributionSnapshotId: dist.id,
      distributionSource: dist.source,
      distributionVersion: dist.sourceVersion,
      distributionCollectedAt: dist.collectedAt,
      reason: "KEY_BAND_UNRESOLVED",
    });
  }

  return {
    status: "AVAILABLE",
    canonicalRuns: runs,
    medianKeyLevel: median,
    appliedAnchorPercentileBps: pick.applied.percentileBps,
    appliedAnchorKeyThreshold: pick.applied.keyThreshold,
    nextAnchorPercentileBps: pick.next?.percentileBps ?? null,
    nextAnchorKeyThreshold: pick.next?.keyThreshold ?? null,
    factor: pick.applied.factor,
    distributionSnapshotId: dist.id,
    distributionSource: dist.source,
    distributionVersion: dist.sourceVersion,
    distributionCollectedAt: dist.collectedAt,
    reason: null,
  };
}

function resolveMetaContext(input: ApplyScoreContextInput): ScoreContextMetaBreakdown {
  const spec = input.seasonScoringSpec;
  const classSlug = spec?.classSlug?.trim() || null;
  const specSlug = spec?.specSlug?.trim() || null;
  const specSource = spec?.source ?? null;

  if (!classSlug || !specSlug) {
    return {
      status: "SPEC_UNKNOWN",
      classSlug,
      specSlug,
      specSource,
      tier: null,
      factor: 1,
      reason: "SPEC_UNKNOWN",
    };
  }

  if (!findSpecDefinition(classSlug, specSlug)) {
    return {
      status: "SPEC_UNKNOWN",
      classSlug,
      specSlug,
      specSource,
      tier: null,
      factor: 1,
      reason: "SPEC_UNKNOWN",
    };
  }

  const revision = input.seasonContextRevision;
  if (!revision) {
    return {
      status: "UNKNOWN",
      classSlug,
      specSlug,
      specSource,
      tier: null,
      factor: 1,
      reason: "CONTEXT_REVISION_NOT_PUBLISHED",
    };
  }

  const assignment = revision.specAssignments.find(
    (a: { classSlug: string; specSlug: string; tier: MetaTier }) =>
      a.classSlug === classSlug && a.specSlug === specSlug,
  );
  if (!assignment) {
    return {
      status: "NOT_CONFIGURED",
      classSlug,
      specSlug,
      specSource,
      tier: null,
      factor: 1,
      reason: "NOT_CONFIGURED",
    };
  }

  const tier = assignment.tier as MetaTier;
  const factor = revision.tierFactors[tier];
  if (!Number.isFinite(factor) || factor <= 0) {
    return {
      status: "NOT_CONFIGURED",
      classSlug,
      specSlug,
      specSource,
      tier,
      factor: 1,
      reason: "TIER_FACTOR_NOT_CONFIGURED",
    };
  }

  return {
    status: "AVAILABLE",
    classSlug,
    specSlug,
    specSource,
    tier,
    factor,
    reason: null,
  };
}

/**
 * Pure contextual adjustment. Zero provider calls. Does not mutate P/S/U/E.
 */
export function applyScoreContext(input: ApplyScoreContextInput): AppliedScoreContext {
  const key = resolveKeyContext(input);
  const meta = resolveMetaContext(input);
  const combinedFactor = key.factor * meta.factor;
  const raw = input.rawScoreBeforeContext;
  const rawOk = raw != null && Number.isFinite(raw);
  const preClamp = rawOk ? raw * combinedFactor : null;
  const finalScore = preClamp != null ? clamp(preClamp, 0, 100) : null;
  const wasClamped = preClamp != null && finalScore != null && finalScore !== preClamp;

  const revision = input.seasonContextRevision;
  const thresholds = input.gradeThresholds ?? DEFAULT_CONTEXT_GRADE_THRESHOLDS;
  const rawGrade = rawOk ? gradeScore(raw, thresholds) : null;
  const finalGrade = finalScore != null && Number.isFinite(finalScore) ? gradeScore(finalScore, thresholds) : null;
  return {
    schemaVersion: SCORE_CONTEXT_SCHEMA_VERSION,
    seasonId: input.seasonId,
    contextRevisionId: revision?.id ?? null,
    contextRevisionKey: revision?.id ?? NONE_CONTEXT_REVISION_KEY,
    contextRevisionVersion: revision?.version ?? null,
    distributionSnapshotId: revision?.distribution?.id ?? null,
    rawScoreBeforeContext: rawOk ? raw : null,
    key,
    meta,
    combinedFactor,
    preClampAdjustedScore: preClamp,
    wasClamped,
    finalScore,
    rawGrade,
    finalGrade,
  };
}

export function toScoreContextProjection(applied: AppliedScoreContext) {
  return {
    rawScoreBeforeContext: applied.rawScoreBeforeContext,
    keyContext: applied.key,
    metaContext: applied.meta,
    combinedFactor: applied.combinedFactor,
    preClampAdjustedScore: applied.preClampAdjustedScore,
    wasClamped: applied.wasClamped,
    finalScore: applied.finalScore,
    rawGrade: applied.rawGrade ?? null,
    finalGrade: applied.finalGrade ?? null,
    contextRevisionId: applied.contextRevisionId,
    contextRevisionVersion: applied.contextRevisionVersion,
  };
}

export function defaultNeutralTierFactors(): Record<MetaTier, number> {
  return { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
}
