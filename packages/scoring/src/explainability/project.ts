import {
  type DimensionExplainabilityV1,
  type PublicDimensionExplainabilityV1,
  type PublicScoreExplainabilityV1,
  type ScoreExplainabilityV1,
} from "@mplus/contracts";
import {
  SCORE_EXPLAINABILITY_PRODUCT_MATERIALITY_FLOOR,
  resolveLabelEntry,
} from "./label-registry.js";

function isPublicSafeDriver(code: string): boolean {
  const entry = resolveLabelEntry("score", code);
  return entry != null && entry.visibility === "PUBLIC";
}

function isPublicSafeReason(code: string): boolean {
  const entry = resolveLabelEntry("confidence", code);
  // Dynamic families resolve to PUBLIC entries; unknown codes fail closed.
  return entry != null && entry.visibility === "PUBLIC";
}

export function projectDimensionExplainabilityPublic(
  dimension: DimensionExplainabilityV1,
): PublicDimensionExplainabilityV1 {
  // No authoritative score → never emit product strengths/weaknesses.
  if (
    dimension.score == null ||
    !Number.isFinite(dimension.score) ||
    dimension.availability === "UNAVAILABLE"
  ) {
    return {
      scoreDrivers: [],
      confidenceReasons: dimension.confidenceStory.reasons
        .filter((reason) => isPublicSafeReason(reason.code))
        .map((reason) => ({
          code: reason.code,
          labelKey: reason.labelKey,
          label: reason.label,
        })),
    };
  }

  const scoreDrivers = dimension.scoreStory.drivers
    .filter((driver) => isPublicSafeDriver(driver.code))
    .filter((driver) => {
      const materiality = Math.abs(driver.materiality ?? 0);
      // Always keep explicit NEUTRAL limiting context with materiality 0 when
      // it is an intentional zero-contribution utility domain (params flag).
      if (
        driver.direction === "NEUTRAL" &&
        driver.params.zeroObservedContribution === true
      ) {
        return true;
      }
      return materiality >= SCORE_EXPLAINABILITY_PRODUCT_MATERIALITY_FLOOR;
    })
    .map((driver) => ({
      code: driver.code,
      labelKey: driver.labelKey,
      label: driver.label,
      direction: driver.direction,
      value: driver.value,
    }));

  const confidenceReasons = dimension.confidenceStory.reasons
    .filter((reason) => isPublicSafeReason(reason.code))
    .map((reason) => ({
      code: reason.code,
      labelKey: reason.labelKey,
      label: reason.label,
    }));

  return { scoreDrivers, confidenceReasons };
}

/** Audit projection keeps the full canonical object (already evidence-bounded). */
export function projectScoreExplainabilityAudit(
  explainability: ScoreExplainabilityV1,
): ScoreExplainabilityV1 {
  return explainability;
}

export function projectScoreExplainabilityPublic(
  explainability: ScoreExplainabilityV1,
): PublicScoreExplainabilityV1 {
  return {
    schemaVersion: explainability.schemaVersion,
    labelCatalogVersion: explainability.labelCatalogVersion,
    fingerprint: explainability.fingerprint,
    dimensions: {
      PERFORMANCE: projectDimensionExplainabilityPublic(
        explainability.dimensions.PERFORMANCE,
      ),
      SURVIVAL: projectDimensionExplainabilityPublic(
        explainability.dimensions.SURVIVAL,
      ),
      UTILITY: projectDimensionExplainabilityPublic(
        explainability.dimensions.UTILITY,
      ),
      EXPERIENCE: projectDimensionExplainabilityPublic(
        explainability.dimensions.EXPERIENCE,
      ),
    },
    composite: {
      score: explainability.composite.score,
      confidence: explainability.composite.confidence,
      grade: explainability.composite.grade,
      availableDimensions: explainability.composite.availableDimensions,
      unavailableDimensions: explainability.composite.unavailableDimensions,
      availabilityCoverage: explainability.composite.availabilityCoverage,
    },
  };
}
