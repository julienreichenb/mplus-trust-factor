/**
 * Utility V2 — versioned model-config validation and fingerprinting.
 *
 * Nested sections are field-constructed after deep validation.
 * Never returns structuredClone(raw). Unknown nested keys are rejected.
 */

import {
  ModelConfigValidationError,
  isRecord,
  rejectUnknownKeys,
  requireNumber,
  requireObject,
  requireString,
  weightsSumToOne,
} from "../../model-config/validate.js";
import { stableSha256 } from "../../model-config/stable-hash.js";
import {
  UTILITY_V2_MODEL_CONFIG,
  UTILITY_V2_SCHEMA_VERSION,
  type UtilityV2ModelConfig,
  type UtilityV2SupportSemantic,
} from "./constants.js";

const ROOT_KEYS = new Set([
  "algorithmVersion",
  "modelLabel",
  "schemaVersion",
  "calibrationStatus",
  "domainWeights",
  "domainContributionCap",
  "scoreFloor",
  "interruptCredits",
  "unmatchedCreditShareCap",
  "unmatchedOnlyMaxDomainScore",
  "interruptMatchToleranceMs",
  "ccDedupeWindowMs",
  "supportSemanticCredit",
  "supportDiminishingExponent",
  "dispelPurgeEventCredit",
  "castStopsCurve",
  "supportCurve",
  "strategicCcCurve",
  "minHostileCastsPerHourForFullCredit",
  "activeCombatGapMs",
  "confidence",
  "scoreSemantics",
]);

const INTERRUPT_CREDIT_KEYS = [
  "CONFIRMED_SUCCESS",
  "VALID_OVERLAP",
  "MATCHED_FAILED",
  "UNMATCHED_ATTEMPT",
  "NOT_OBSERVABLE",
] as const;

const SUPPORT_SEMANTIC_KEYS: UtilityV2SupportSemantic[] = [
  "REACTIVE_SUPPORT",
  "STRATEGIC_SUPPORT",
  "EMERGENCY_SUPPORT",
  "ROUTINE_ROTATIONAL_SUPPORT",
  "PASSIVE_SUPPORT",
  "PERSONAL_MOBILITY",
  "UNVERIFIED_EXTERNAL",
];

const CONFIDENCE_KEYS = new Set([
  "expectedDungeons",
  "runSaturation",
  "combatHourSaturation",
  "attributableEventSaturation",
  "tinyRunThreshold",
  "maxWhenTinySample",
  "maxWhenPartialDungeons",
  "maxWhenZeroAttributable",
  "maxWhenNoHostileCasts",
  "maxWhenMechanicCatalogBelow",
  "weights",
  "minReliability",
]);

const CONFIDENCE_WEIGHT_KEYS = new Set([
  "dungeonCoverage",
  "runCoverage",
  "combatDuration",
  "attributableEvents",
  "mechanicCatalogCoverageObserved",
  "sourceCompleteness",
]);

const SCORE_SEMANTICS_KEYS = new Set([
  "mode",
  "phase",
  "opportunityMode",
  "scoreKind",
  "notes",
]);

const CALIBRATION_STATUSES = new Set([
  "CANDIDATE_DEFAULTS_UNCALIBRATED",
  "CALIBRATION_IN_PROGRESS",
  "CALIBRATED_SHADOW",
  "CALIBRATED_ACTIVE",
]);

export function fingerprintUtilityV2ModelConfig(config: UtilityV2ModelConfig): string {
  return stableSha256(config);
}

export const UTILITY_V2_DEFAULT_CONFIG_FINGERPRINT =
  fingerprintUtilityV2ModelConfig(UTILITY_V2_MODEL_CONFIG);

function parseCurve(
  raw: unknown,
  path: string,
  errors: string[],
): ReadonlyArray<{ perHour: number; score: number }> | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    errors.push(`${path} must be an array of at least 2 knots`);
    return null;
  }
  const points: Array<{ perHour: number; score: number }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const p = raw[i];
    if (!isRecord(p)) {
      errors.push(`${path}[${i}] must be an object`);
      continue;
    }
    rejectUnknownKeys(p, new Set(["perHour", "score"]), `${path}[${i}]`, errors);
    const perHour = requireNumber(p, "perHour", errors, { min: 0 });
    const score = requireNumber(p, "score", errors, { min: 0, max: 100 });
    if (perHour != null && score != null) points.push({ perHour, score });
  }
  return points.length >= 2 ? Object.freeze(points) : null;
}

function parseInterruptCredits(
  raw: Record<string, unknown> | null,
  errors: string[],
): UtilityV2ModelConfig["interruptCredits"] | null {
  if (!raw) return null;
  rejectUnknownKeys(raw, new Set(INTERRUPT_CREDIT_KEYS), "interruptCredits", errors);
  const out: Record<string, number> = {};
  for (const key of INTERRUPT_CREDIT_KEYS) {
    const v = requireNumber(raw, key, errors, { min: 0 });
    if (v != null) out[key] = v;
  }
  if (Object.keys(out).length !== INTERRUPT_CREDIT_KEYS.length) return null;
  return Object.freeze(out) as UtilityV2ModelConfig["interruptCredits"];
}

function parseSupportSemanticCredit(
  raw: Record<string, unknown> | null,
  errors: string[],
): UtilityV2ModelConfig["supportSemanticCredit"] | null {
  if (!raw) return null;
  rejectUnknownKeys(raw, new Set(SUPPORT_SEMANTIC_KEYS), "supportSemanticCredit", errors);
  const out = {} as Record<UtilityV2SupportSemantic, number>;
  for (const key of SUPPORT_SEMANTIC_KEYS) {
    const v = requireNumber(raw, key, errors, { min: 0 });
    if (v != null) out[key] = v;
  }
  if (Object.keys(out).length !== SUPPORT_SEMANTIC_KEYS.length) return null;
  return Object.freeze(out) as UtilityV2ModelConfig["supportSemanticCredit"];
}

function parseConfidence(
  raw: Record<string, unknown> | null,
  errors: string[],
): UtilityV2ModelConfig["confidence"] | null {
  if (!raw) return null;
  rejectUnknownKeys(raw, CONFIDENCE_KEYS, "confidence", errors);

  const expectedDungeons = requireNumber(raw, "expectedDungeons", errors, { min: 0 });
  const runSaturation = requireNumber(raw, "runSaturation", errors, { min: 0 });
  const combatHourSaturation = requireNumber(raw, "combatHourSaturation", errors, {
    min: 0,
  });
  const attributableEventSaturation = requireNumber(
    raw,
    "attributableEventSaturation",
    errors,
    { min: 0 },
  );
  const tinyRunThreshold = requireNumber(raw, "tinyRunThreshold", errors, { min: 0 });
  const maxWhenTinySample = requireNumber(raw, "maxWhenTinySample", errors, {
    min: 0,
    max: 100,
  });
  const maxWhenPartialDungeons = requireNumber(raw, "maxWhenPartialDungeons", errors, {
    min: 0,
    max: 100,
  });
  const maxWhenZeroAttributable = requireNumber(raw, "maxWhenZeroAttributable", errors, {
    min: 0,
    max: 100,
  });
  const maxWhenNoHostileCasts = requireNumber(raw, "maxWhenNoHostileCasts", errors, {
    min: 0,
    max: 100,
  });
  const minReliability = requireNumber(raw, "minReliability", errors, { min: 0, max: 1 });

  const catalogRaw = raw.maxWhenMechanicCatalogBelow;
  if (!Array.isArray(catalogRaw) || catalogRaw.length === 0) {
    errors.push("confidence.maxWhenMechanicCatalogBelow must be a non-empty array");
  }
  const catalog: Array<{ below: number; maxConfidence: number }> = [];
  if (Array.isArray(catalogRaw)) {
    for (let i = 0; i < catalogRaw.length; i += 1) {
      const row = catalogRaw[i];
      if (!isRecord(row)) {
        errors.push(`confidence.maxWhenMechanicCatalogBelow[${i}] must be an object`);
        continue;
      }
      rejectUnknownKeys(
        row,
        new Set(["below", "maxConfidence"]),
        `confidence.maxWhenMechanicCatalogBelow[${i}]`,
        errors,
      );
      const below = requireNumber(row, "below", errors, { min: 0, max: 1 });
      const maxConfidence = requireNumber(row, "maxConfidence", errors, {
        min: 0,
        max: 100,
      });
      if (below != null && maxConfidence != null) {
        catalog.push({ below, maxConfidence });
      }
    }
  }

  const weightsRaw = requireObject(raw, "weights", errors);
  let weights: UtilityV2ModelConfig["confidence"]["weights"] | null = null;
  if (weightsRaw) {
    rejectUnknownKeys(weightsRaw, CONFIDENCE_WEIGHT_KEYS, "confidence.weights", errors);
    const dungeonCoverage = requireNumber(weightsRaw, "dungeonCoverage", errors, {
      min: 0,
      max: 1,
    });
    const runCoverage = requireNumber(weightsRaw, "runCoverage", errors, {
      min: 0,
      max: 1,
    });
    const combatDuration = requireNumber(weightsRaw, "combatDuration", errors, {
      min: 0,
      max: 1,
    });
    const attributableEvents = requireNumber(weightsRaw, "attributableEvents", errors, {
      min: 0,
      max: 1,
    });
    const mechanicCatalogCoverageObserved = requireNumber(
      weightsRaw,
      "mechanicCatalogCoverageObserved",
      errors,
      { min: 0, max: 1 },
    );
    const sourceCompleteness = requireNumber(weightsRaw, "sourceCompleteness", errors, {
      min: 0,
      max: 1,
    });
    if (
      dungeonCoverage != null &&
      runCoverage != null &&
      combatDuration != null &&
      attributableEvents != null &&
      mechanicCatalogCoverageObserved != null &&
      sourceCompleteness != null
    ) {
      weights = Object.freeze({
        dungeonCoverage,
        runCoverage,
        combatDuration,
        attributableEvents,
        mechanicCatalogCoverageObserved,
        sourceCompleteness,
      });
      weightsSumToOne(weights, "confidence.weights", errors);
    }
  }

  if (
    expectedDungeons == null ||
    runSaturation == null ||
    combatHourSaturation == null ||
    attributableEventSaturation == null ||
    tinyRunThreshold == null ||
    maxWhenTinySample == null ||
    maxWhenPartialDungeons == null ||
    maxWhenZeroAttributable == null ||
    maxWhenNoHostileCasts == null ||
    minReliability == null ||
    weights == null ||
    catalog.length === 0
  ) {
    return null;
  }

  return Object.freeze({
    expectedDungeons,
    runSaturation,
    combatHourSaturation,
    attributableEventSaturation,
    tinyRunThreshold,
    maxWhenTinySample,
    maxWhenPartialDungeons,
    maxWhenZeroAttributable,
    maxWhenNoHostileCasts,
    maxWhenMechanicCatalogBelow: Object.freeze(catalog),
    weights,
    minReliability,
  }) as UtilityV2ModelConfig["confidence"];
}

function parseScoreSemantics(
  raw: Record<string, unknown> | null,
  errors: string[],
): UtilityV2ModelConfig["scoreSemantics"] | null {
  if (!raw) return null;
  rejectUnknownKeys(raw, SCORE_SEMANTICS_KEYS, "scoreSemantics", errors);

  const mode = requireString(raw, "mode", errors);
  if (mode != null && mode !== "OBSERVED_CONTRIBUTION") {
    errors.push(`scoreSemantics.mode must be "OBSERVED_CONTRIBUTION"`);
  }
  const phase = requireNumber(raw, "phase", errors, { min: 1, max: 1 });
  const opportunityMode = requireString(raw, "opportunityMode", errors);
  if (opportunityMode != null && opportunityMode !== "off") {
    errors.push(`scoreSemantics.opportunityMode must be "off" (Phase 1)`);
  }
  const scoreKind = requireString(raw, "scoreKind", errors);

  if (!Array.isArray(raw.notes) || raw.notes.length === 0) {
    errors.push("scoreSemantics.notes must be a non-empty string array");
    return null;
  }
  const notes: string[] = [];
  for (let i = 0; i < raw.notes.length; i += 1) {
    const n = raw.notes[i];
    if (typeof n !== "string" || n.trim().length === 0) {
      errors.push(`scoreSemantics.notes[${i}] must be a non-empty string`);
    } else {
      notes.push(n);
    }
  }

  if (
    mode !== "OBSERVED_CONTRIBUTION" ||
    phase !== 1 ||
    opportunityMode !== "off" ||
    scoreKind == null ||
    notes.length === 0
  ) {
    return null;
  }

  return Object.freeze({
    mode: "OBSERVED_CONTRIBUTION" as const,
    phase: 1 as const,
    opportunityMode: "off" as const,
    scoreKind,
    notes: Object.freeze(notes),
  }) as UtilityV2ModelConfig["scoreSemantics"];
}

/**
 * Validate Utility V2 model config. Rejects unknown keys / bad ranges / wrong versions.
 * Nested confidence and scoreSemantics are field-constructed — never cloned from raw.
 */
export function parseUtilityV2ModelConfig(raw: unknown): UtilityV2ModelConfig {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    throw new ModelConfigValidationError("UTILITY", ["config must be an object"]);
  }
  rejectUnknownKeys(raw, ROOT_KEYS, "utility", errors);

  const schemaVersion = requireString(raw, "schemaVersion", errors);
  if (schemaVersion != null && schemaVersion !== UTILITY_V2_SCHEMA_VERSION) {
    errors.push(
      `incompatible schemaVersion "${schemaVersion}" (expected ${UTILITY_V2_SCHEMA_VERSION})`,
    );
  }
  const algorithmVersion = requireString(raw, "algorithmVersion", errors);
  if (algorithmVersion != null && !algorithmVersion.startsWith("utility-v2")) {
    errors.push(
      `incompatible algorithmVersion "${algorithmVersion}" (expected utility-v2*)`,
    );
  }
  const modelLabel = requireString(raw, "modelLabel", errors);
  const calibrationStatus = requireString(raw, "calibrationStatus", errors);
  if (calibrationStatus != null && !CALIBRATION_STATUSES.has(calibrationStatus)) {
    errors.push(`invalid calibrationStatus "${calibrationStatus}"`);
  }

  const domainWeightsRaw = requireObject(raw, "domainWeights", errors);
  let domainWeights: UtilityV2ModelConfig["domainWeights"] | null = null;
  if (domainWeightsRaw) {
    rejectUnknownKeys(
      domainWeightsRaw,
      new Set(["castStops", "support", "strategicCc"]),
      "domainWeights",
      errors,
    );
    const castStops = requireNumber(domainWeightsRaw, "castStops", errors, {
      min: 0,
      max: 1,
    });
    const support = requireNumber(domainWeightsRaw, "support", errors, { min: 0, max: 1 });
    const strategicCc = requireNumber(domainWeightsRaw, "strategicCc", errors, {
      min: 0,
      max: 1,
    });
    if (castStops != null && support != null && strategicCc != null) {
      domainWeights = Object.freeze({ castStops, support, strategicCc });
      weightsSumToOne(domainWeights, "domainWeights", errors);
    }
  }

  const domainContributionCap = requireNumber(raw, "domainContributionCap", errors, {
    min: 0,
  });
  const scoreFloor = requireNumber(raw, "scoreFloor", errors, { min: 0, max: 100 });
  const unmatchedCreditShareCap = requireNumber(raw, "unmatchedCreditShareCap", errors, {
    min: 0,
    max: 1,
  });
  const unmatchedOnlyMaxDomainScore = requireNumber(
    raw,
    "unmatchedOnlyMaxDomainScore",
    errors,
    { min: 0, max: 100 },
  );
  const interruptMatchToleranceMs = requireNumber(raw, "interruptMatchToleranceMs", errors, {
    min: 0,
  });
  const ccDedupeWindowMs = requireNumber(raw, "ccDedupeWindowMs", errors, { min: 0 });
  const supportDiminishingExponent = requireNumber(
    raw,
    "supportDiminishingExponent",
    errors,
    { min: 0 },
  );
  const dispelPurgeEventCredit = requireNumber(raw, "dispelPurgeEventCredit", errors, {
    min: 0,
  });
  const minHostileCastsPerHourForFullCredit = requireNumber(
    raw,
    "minHostileCastsPerHourForFullCredit",
    errors,
    { min: 0 },
  );
  const activeCombatGapMs = requireNumber(raw, "activeCombatGapMs", errors, { min: 0 });

  const interruptCredits = parseInterruptCredits(
    requireObject(raw, "interruptCredits", errors),
    errors,
  );
  const supportSemanticCredit = parseSupportSemanticCredit(
    requireObject(raw, "supportSemanticCredit", errors),
    errors,
  );
  const confidence = parseConfidence(requireObject(raw, "confidence", errors), errors);
  const scoreSemantics = parseScoreSemantics(
    requireObject(raw, "scoreSemantics", errors),
    errors,
  );
  const castStopsCurve = parseCurve(raw.castStopsCurve, "castStopsCurve", errors);
  const supportCurve = parseCurve(raw.supportCurve, "supportCurve", errors);
  const strategicCcCurve = parseCurve(raw.strategicCcCurve, "strategicCcCurve", errors);

  if (errors.length > 0) {
    throw new ModelConfigValidationError("UTILITY", errors);
  }

  if (
    algorithmVersion == null ||
    modelLabel == null ||
    calibrationStatus == null ||
    domainWeights == null ||
    domainContributionCap == null ||
    scoreFloor == null ||
    unmatchedCreditShareCap == null ||
    unmatchedOnlyMaxDomainScore == null ||
    interruptMatchToleranceMs == null ||
    ccDedupeWindowMs == null ||
    supportDiminishingExponent == null ||
    dispelPurgeEventCredit == null ||
    minHostileCastsPerHourForFullCredit == null ||
    activeCombatGapMs == null ||
    interruptCredits == null ||
    supportSemanticCredit == null ||
    confidence == null ||
    scoreSemantics == null ||
    castStopsCurve == null ||
    supportCurve == null ||
    strategicCcCurve == null
  ) {
    throw new ModelConfigValidationError("UTILITY", ["incomplete validated Utility config"]);
  }

  return Object.freeze({
    algorithmVersion,
    modelLabel,
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    calibrationStatus: calibrationStatus as UtilityV2ModelConfig["calibrationStatus"],
    domainWeights,
    domainContributionCap,
    scoreFloor,
    interruptCredits,
    unmatchedCreditShareCap,
    unmatchedOnlyMaxDomainScore,
    interruptMatchToleranceMs,
    ccDedupeWindowMs,
    supportSemanticCredit,
    supportDiminishingExponent,
    dispelPurgeEventCredit,
    castStopsCurve,
    supportCurve,
    strategicCcCurve,
    minHostileCastsPerHourForFullCredit,
    activeCombatGapMs,
    confidence,
    scoreSemantics,
  });
}

export function resolveUtilityV2ModelConfig(override?: unknown): UtilityV2ModelConfig {
  if (override === undefined || override === null || override === UTILITY_V2_MODEL_CONFIG) {
    return UTILITY_V2_MODEL_CONFIG;
  }
  return parseUtilityV2ModelConfig(override);
}
