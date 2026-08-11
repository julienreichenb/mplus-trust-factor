/**
 * Map persisted CharacterScore → ScoreSnapshotDTO for API reads when
 * publication is off / ScoreSnapshot rows are absent.
 */
import type { DimensionScoreDTO, Grade, PerformanceSummaryDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import {
  computePartialComposite,
  contributorsFromLegacyConfidenceContext,
  defaultSkillDimensionWeights,
  mergePublishedSelectedRunsIntoPerformanceSummary,
  productDimensionExplainabilityFields,
  projectPerformanceSummaryFromDimensionDetails,
  tryParsePersistedScoreExplainability,
} from "@mplus/scoring";

export type CharacterScoreReadRow = {
  id: string;
  characterId: string;
  seasonId: string;
  scoringVersion: string;
  performance: number | null;
  utility: number | null;
  survival: number | null;
  experience: number | null;
  composite: number | null;
  confidence: number | null;
  tier?: string | null;
  calculatedAt: Date;
  dimensionDetails: unknown;
  season?: { slug: string } | null;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function dimState(
  score: number | null,
  confidence: number | null,
  reason: string | null,
): DimensionScoreDTO["state"] {
  if (reason) return "UNAVAILABLE";
  if (score == null || !Number.isFinite(score)) return "UNAVAILABLE";
  if ((confidence ?? 0) < 0.35) return "PARTIAL";
  return "AVAILABLE";
}

function blockedReason(
  details: Record<string, unknown> | null,
  dimension: string,
): string | null {
  const blocked = details?.blocked;
  if (!Array.isArray(blocked)) return null;
  const hit = blocked.find(
    (b) =>
      b &&
      typeof b === "object" &&
      (b as { dimension?: string }).dimension === dimension,
  ) as { reason?: string } | undefined;
  return typeof hit?.reason === "string" ? hit.reason : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

/**
 * Prefer persisted per-dimension confidence from dimensionDetails.
 * Do not reuse overall CharacterScore.confidence for every dimension.
 */
function readDimensionConfidence(
  details: Record<string, unknown> | null,
  key: "performance" | "utility" | "survival",
  score: number | null,
): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  const block = asRecord(details?.[key]);
  const direct = readFiniteNumber(block?.confidence);
  if (direct != null) return clamp01(direct);
  return null;
}

function readDimensionLimitations(
  details: Record<string, unknown> | null,
  key: "performance" | "utility" | "survival",
): string[] {
  const block = asRecord(details?.[key]);
  if (!block) return [];
  const topLevel = readStringList(block.limitations);
  if (topLevel.length > 0) return topLevel;
  const explanation = asRecord(block.explanation);
  if (key === "utility") {
    return readStringList(explanation?.confidenceReasons);
  }
  if (key === "survival") {
    return readStringList(explanation?.limitations);
  }
  return [];
}

function resolveExperienceFromRow(
  row: CharacterScoreReadRow,
  details: Record<string, unknown> | null,
): {
  score: number | null;
  available: boolean;
  reason: string | null;
  confidence: number | null;
  causes: string[];
} {
  const blocked = blockedReason(details, "EXPERIENCE");
  const experienceDetails = asRecord(details?.experience);
  const detailAvailable = experienceDetails?.available === true;
  const detailScore = readFiniteNumber(experienceDetails?.score);
  const detailReason =
    typeof experienceDetails?.reason === "string" ? experienceDetails.reason : null;
  const detailConfidence = readFiniteNumber(experienceDetails?.confidence);
  const detailCauses = readStringList(experienceDetails?.confidenceCauses);

  // Column is authoritative when present (including 0).
  // Confidence comes from persisted Experience Phase 1 details (legacy rows may omit it).
  if (row.experience != null && Number.isFinite(row.experience) && !blocked) {
    return {
      score: row.experience,
      available: true,
      reason: null,
      confidence: detailConfidence ?? 1,
      causes: detailCauses,
    };
  }

  if (detailAvailable && detailScore != null && !blocked) {
    return {
      score: detailScore,
      available: true,
      reason: null,
      confidence: detailConfidence ?? 1,
      causes: detailCauses,
    };
  }

  const unavailableReason = blocked ?? detailReason ?? "EXPERIENCE_UNAVAILABLE";
  return {
    score: null,
    available: false,
    reason: unavailableReason,
    confidence: null,
    causes: detailCauses.length > 0 ? detailCauses : [unavailableReason],
  };
}

function readPerformanceSummaryFromExplanation(
  explanation: unknown,
): PerformanceSummaryDTO | null {
  if (!explanation || typeof explanation !== "object") return null;
  const summary = (explanation as { performanceSummary?: unknown }).performanceSummary;
  if (!summary || typeof summary !== "object") return null;
  return summary as PerformanceSummaryDTO;
}

/**
 * Operational CharacterScore role-aware summary wins over stale published snapshot.
 * Selected-run links may be merged from the published snapshot when safe.
 */
export function resolveProfilePerformanceSummary(input: {
  productScoreSource: "character_score" | "published_snapshot" | "none";
  operationalExplanation: unknown;
  publishedExplanation: unknown;
}): PerformanceSummaryDTO | null {
  const published = readPerformanceSummaryFromExplanation(input.publishedExplanation);
  if (input.productScoreSource !== "character_score") {
    return published;
  }
  const operational = readPerformanceSummaryFromExplanation(input.operationalExplanation);
  if (operational?.roleAware) {
    return mergePublishedSelectedRunsIntoPerformanceSummary(operational, published);
  }
  if (operational) return operational;
  return published;
}

export function mapCharacterScoreToSnapshotDto(
  row: CharacterScoreReadRow,
  opts?: {
    modelKey?: string;
    modelVersion?: number;
    dimensionWeights?: {
      performance: number;
      survival: number;
      utility: number;
      experience: number;
    };
    gradeThresholds?: { S: number; A: number; B: number; C: number };
    minConfidenceForGrade?: number;
  },
): ScoreSnapshotDTO {
  const details =
    row.dimensionDetails && typeof row.dimensionDetails === "object"
      ? (row.dimensionDetails as Record<string, unknown>)
      : null;

  const perfReason = blockedReason(details, "PERFORMANCE");
  const utilReason = blockedReason(details, "UTILITY");
  const survReason = blockedReason(details, "SURVIVAL");
  const experience = resolveExperienceFromRow(row, details);

  const weights = opts?.dimensionWeights ?? defaultSkillDimensionWeights();
  const perfConfidence = readDimensionConfidence(details, "performance", row.performance);
  const survConfidence = readDimensionConfidence(details, "survival", row.survival);
  const utilConfidence = readDimensionConfidence(details, "utility", row.utility);
  const hasPersistedDimensionConfidence =
    perfConfidence != null || survConfidence != null || utilConfidence != null;
  const legacyOverallConfidence =
    row.confidence != null && Number.isFinite(row.confidence)
      ? clamp01(row.confidence)
      : null;

  const publicDimConfidence = (score: number | null, dimConf: number | null): number => {
    if (score == null || !Number.isFinite(score)) return 0;
    if (dimConf != null) return dimConf;
    // Legacy CharacterScore rows predate per-dimension confidence persistence.
    if (!hasPersistedDimensionConfidence && legacyOverallConfidence != null) {
      return legacyOverallConfidence;
    }
    return 0;
  };

  const partial = computePartialComposite(
    [
      {
        key: "performance",
        score: row.performance,
        available:
          row.performance != null && Number.isFinite(row.performance) && !perfReason,
        baseWeight: weights.performance,
        confidence: perfConfidence ?? (hasPersistedDimensionConfidence ? null : legacyOverallConfidence),
      },
      {
        key: "survival",
        score: row.survival,
        available: row.survival != null && Number.isFinite(row.survival) && !survReason,
        baseWeight: weights.survival,
        confidence: survConfidence ?? (hasPersistedDimensionConfidence ? null : legacyOverallConfidence),
      },
      {
        key: "utility",
        score: row.utility,
        available: row.utility != null && Number.isFinite(row.utility) && !utilReason,
        baseWeight: weights.utility,
        confidence: utilConfidence ?? (hasPersistedDimensionConfidence ? null : legacyOverallConfidence),
      },
      {
        key: "experience",
        score: experience.score,
        available: experience.available,
        baseWeight: weights.experience,
        confidence: experience.confidence,
      },
    ],
    {
      gradeThresholds: opts?.gradeThresholds ?? { S: 90, A: 80, B: 65, C: 50 },
      minConfidenceForGrade: opts?.minConfidenceForGrade ?? 0.35,
    },
  );

  // Soft-parse canonical explainability; malformed/unknown must not break profile reads.
  const canonical = tryParsePersistedScoreExplainability(details?.explainability);

  const dimensionProduct = (
    key: "PERFORMANCE" | "SURVIVAL" | "UTILITY" | "EXPERIENCE",
    legacyLimitations: readonly string[],
  ): Pick<DimensionScoreDTO, "contributors" | "explainability"> => {
    if (canonical) {
      const fields = productDimensionExplainabilityFields(canonical, key);
      return {
        contributors: fields.contributors,
        explainability: fields.explainability,
      };
    }
    // Legacy rows: empty scoreDrivers; confidence codes as data context only.
    return {
      contributors: contributorsFromLegacyConfidenceContext(legacyLimitations),
    };
  };

  const perfProduct = dimensionProduct(
    "PERFORMANCE",
    readDimensionLimitations(details, "performance"),
  );
  const utilProduct = dimensionProduct(
    "UTILITY",
    readDimensionLimitations(details, "utility"),
  );
  const survProduct = dimensionProduct(
    "SURVIVAL",
    readDimensionLimitations(details, "survival"),
  );
  const expProduct = dimensionProduct("EXPERIENCE", experience.causes);

  const dimensions: DimensionScoreDTO[] = [
    {
      dimension: "PERFORMANCE",
      score: row.performance,
      confidence: publicDimConfidence(row.performance, perfConfidence),
      weight: weights.performance,
      state: dimState(
        row.performance,
        publicDimConfidence(row.performance, perfConfidence) || null,
        perfReason,
      ),
      reason: perfReason,
      contributors: perfProduct.contributors,
      ...(perfProduct.explainability
        ? { explainability: perfProduct.explainability }
        : {}),
    },
    {
      dimension: "UTILITY",
      score: row.utility,
      confidence: publicDimConfidence(row.utility, utilConfidence),
      weight: weights.utility,
      state: dimState(
        row.utility,
        publicDimConfidence(row.utility, utilConfidence) || null,
        utilReason,
      ),
      reason: utilReason,
      contributors: utilProduct.contributors,
      ...(utilProduct.explainability
        ? { explainability: utilProduct.explainability }
        : {}),
    },
    {
      dimension: "SURVIVAL",
      score: row.survival,
      confidence: publicDimConfidence(row.survival, survConfidence),
      weight: weights.survival,
      state: dimState(
        row.survival,
        publicDimConfidence(row.survival, survConfidence) || null,
        survReason,
      ),
      reason: survReason,
      contributors: survProduct.contributors,
      ...(survProduct.explainability
        ? { explainability: survProduct.explainability }
        : {}),
    },
    {
      dimension: "EXPERIENCE",
      score: experience.score,
      confidence: experience.available ? clamp01(experience.confidence ?? 1) : 0,
      weight: weights.experience,
      state: dimState(experience.score, experience.confidence, experience.reason),
      reason: experience.reason,
      contributors: expProduct.contributors,
      ...(expProduct.explainability
        ? { explainability: expProduct.explainability }
        : {}),
    },
  ];

  const overallScore =
    row.composite != null && Number.isFinite(row.composite)
      ? row.composite
      : partial.composite ?? 0;
  const confidence =
    row.confidence != null && Number.isFinite(row.confidence)
      ? row.confidence
      : partial.confidence;
  // Always recompute letter grade from current partial-composite rules.
  // Persisted tier=U from the old confidence-floor path must not override a
  // calculable P/U/S composite on the product read path.
  const grade: Grade = partial.grade;

  const performanceSummary = projectPerformanceSummaryFromDimensionDetails(
    details,
    row.performance,
    perfConfidence,
  );

  return {
    characterId: row.characterId,
    seasonSlug: row.season?.slug ?? "",
    modelKey: opts?.modelKey ?? "character-score",
    modelVersion: opts?.modelVersion ?? 1,
    scopeType: "CHARACTER",
    scopeKey: null,
    overallScore,
    skillScore: overallScore,
    authenticityScore: 100,
    confidence,
    grade,
    overallState:
      partial.availableCount === 0
        ? "PROVISIONAL"
        : partial.availableCount < 4
          ? "PROVISIONAL"
          : "DEFINITIVE",
    provisionalReason:
      partial.availableCount === 0
        ? "NO_AVAILABLE_DIMENSIONS"
        : partial.availableCount < 4
          ? `PARTIAL_DIMENSIONS:${partial.explanation.unavailableKeys.join(",")}`
          : null,
    dimensions,
    calculatedAt: row.calculatedAt.toISOString(),
    inputFingerprint: `character-score:${row.id}`,
    redFlags: [],
    explanation: {
      scoringVersion: row.scoringVersion,
      characterScoreId: row.id,
      source: "character_score",
      composite: row.composite,
      experience: row.experience,
      experienceDetails: details?.experience ?? null,
      performance: row.performance,
      utility: row.utility,
      survival: row.survival,
      dimensionConfidence: {
        performance: perfConfidence,
        survival: survConfidence,
        utility: utilConfidence,
        experience: experience.confidence,
      },
      explainabilityFingerprint: canonical?.fingerprint ?? null,
      partialComposite: partial.explanation,
      availabilityCoverage: partial.availabilityCoverage,
      effectiveWeights: partial.effectiveWeights,
      missingDimensionsExcluded:
        "Unavailable dimensions are excluded; remaining weights are renormalized.",
      ...(performanceSummary ? { performanceSummary } : {}),
    },
  };
}
