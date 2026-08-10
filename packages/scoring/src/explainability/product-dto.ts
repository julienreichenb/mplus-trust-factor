/**
 * Shared product DTO helpers for fresh snapshot + CharacterScore API reads.
 * Keeps public projection and legacy contributor derivation in one place.
 */
import {
  safeParseScoreExplainabilityV1,
  type PublicDimensionExplainabilityV1,
  type ScoreExplainabilityV1,
} from "@mplus/contracts";
import { projectDimensionExplainabilityPublic } from "./project.js";

export type LegacyDimensionContributors = {
  limitations: string[];
  missing: Array<{ metricKey: string; available: false }>;
  positive: Array<{ metricKey: string; label: string }>;
  negative: Array<{ metricKey: string; label: string }>;
};

/**
 * Derive temporary UI contributors ONLY from public score drivers.
 * POSITIVE → positive; NEGATIVE → negative; NEUTRAL omitted (not a weakness).
 * Confidence reasons must never enter negative.
 */
export function contributorsFromPublicScoreDrivers(
  scoreDrivers: PublicDimensionExplainabilityV1["scoreDrivers"],
): LegacyDimensionContributors {
  const positive: LegacyDimensionContributors["positive"] = [];
  const negative: LegacyDimensionContributors["negative"] = [];
  for (const driver of scoreDrivers) {
    if (driver.direction === "POSITIVE") {
      positive.push({ metricKey: driver.code, label: driver.label });
    } else if (driver.direction === "NEGATIVE") {
      negative.push({ metricKey: driver.code, label: driver.label });
    }
  }
  return {
    limitations: [],
    missing: [],
    positive,
    negative,
  };
}

/**
 * Legacy CharacterScore rows without Score Explainability V1.
 * Keep confidence/data codes as context only — never as player weaknesses.
 */
export function contributorsFromLegacyConfidenceContext(
  limitations: readonly string[] | null | undefined,
): LegacyDimensionContributors {
  const keys = (limitations ?? []).filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  return {
    limitations: keys,
    missing: keys.map((metricKey) => ({ metricKey, available: false as const })),
    positive: [],
    negative: [],
  };
}

/** Soft-parse persisted canonical explainability; malformed → null (do not break reads). */
export function tryParsePersistedScoreExplainability(
  value: unknown,
): ScoreExplainabilityV1 | null {
  const parsed = safeParseScoreExplainabilityV1(value);
  return parsed.success ? parsed.data : null;
}

export function productDimensionExplainabilityFields(
  canonical: ScoreExplainabilityV1,
  dimension: keyof ScoreExplainabilityV1["dimensions"],
): {
  explainability: PublicDimensionExplainabilityV1;
  contributors: LegacyDimensionContributors;
} {
  const explainability = projectDimensionExplainabilityPublic(
    canonical.dimensions[dimension],
  );
  return {
    explainability,
    contributors: contributorsFromPublicScoreDrivers(explainability.scoreDrivers),
  };
}
