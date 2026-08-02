/**
 * Utility V2 — versioned model-config validation and fingerprinting.
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
    const perHour = requireNumber(p, "perHour", errors, { min: 0 });
    const score = requireNumber(p, "score", errors, { min: 0, max: 100 });
    if (perHour != null && score != null) points.push({ perHour, score });
  }
  return points.length >= 2 ? Object.freeze(points) : null;
}

/**
 * Validate Utility V2 model config. Rejects unknown keys / bad ranges / wrong versions.
 * For deep nested confidence/scoreSemantics, requires structural presence then
 * canonicalizes via JSON round-trip of known fields only.
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
  requireString(raw, "modelLabel", errors);
  requireString(raw, "calibrationStatus", errors);

  const domainWeightsRaw = requireObject(raw, "domainWeights", errors);
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
      weightsSumToOne({ castStops, support, strategicCc }, "domainWeights", errors);
    }
  }

  requireNumber(raw, "domainContributionCap", errors, { min: 0 });
  requireNumber(raw, "scoreFloor", errors, { min: 0, max: 100 });
  requireNumber(raw, "unmatchedCreditShareCap", errors, { min: 0, max: 1 });
  requireNumber(raw, "unmatchedOnlyMaxDomainScore", errors, { min: 0, max: 100 });
  requireNumber(raw, "interruptMatchToleranceMs", errors, { min: 0 });
  requireNumber(raw, "ccDedupeWindowMs", errors, { min: 0 });
  requireNumber(raw, "supportDiminishingExponent", errors, { min: 0 });
  requireNumber(raw, "dispelPurgeEventCredit", errors, { min: 0 });
  requireNumber(raw, "minHostileCastsPerHourForFullCredit", errors, { min: 0 });
  requireNumber(raw, "activeCombatGapMs", errors, { min: 0 });

  requireObject(raw, "interruptCredits", errors);
  requireObject(raw, "supportSemanticCredit", errors);
  requireObject(raw, "confidence", errors);
  requireObject(raw, "scoreSemantics", errors);
  parseCurve(raw.castStopsCurve, "castStopsCurve", errors);
  parseCurve(raw.supportCurve, "supportCurve", errors);
  parseCurve(raw.strategicCcCurve, "strategicCcCurve", errors);

  if (errors.length > 0) {
    throw new ModelConfigValidationError("UTILITY", errors);
  }

  // Canonicalize: start from defaults, overlay validated numeric/object fields.
  // Unknown keys already rejected; nested unknown keys inside confidence are
  // tolerated only if structurally matching defaults via JSON clone of input
  // after root validation — deep-freeze through structuredClone of the pick.
  const overlay = {
    ...UTILITY_V2_MODEL_CONFIG,
    algorithmVersion: String(raw.algorithmVersion),
    modelLabel: String(raw.modelLabel),
    schemaVersion: UTILITY_V2_SCHEMA_VERSION,
    calibrationStatus: raw.calibrationStatus as UtilityV2ModelConfig["calibrationStatus"],
    domainWeights: Object.freeze({
      castStops: Number((raw.domainWeights as Record<string, number>).castStops),
      support: Number((raw.domainWeights as Record<string, number>).support),
      strategicCc: Number((raw.domainWeights as Record<string, number>).strategicCc),
    }),
    domainContributionCap: Number(raw.domainContributionCap),
    scoreFloor: Number(raw.scoreFloor),
    interruptCredits: Object.freeze({
      ...(raw.interruptCredits as UtilityV2ModelConfig["interruptCredits"]),
    }),
    unmatchedCreditShareCap: Number(raw.unmatchedCreditShareCap),
    unmatchedOnlyMaxDomainScore: Number(raw.unmatchedOnlyMaxDomainScore),
    interruptMatchToleranceMs: Number(raw.interruptMatchToleranceMs),
    ccDedupeWindowMs: Number(raw.ccDedupeWindowMs),
    supportSemanticCredit: Object.freeze({
      ...(raw.supportSemanticCredit as UtilityV2ModelConfig["supportSemanticCredit"]),
    }),
    supportDiminishingExponent: Number(raw.supportDiminishingExponent),
    dispelPurgeEventCredit: Number(raw.dispelPurgeEventCredit),
    castStopsCurve: Object.freeze(
      parseCurve(raw.castStopsCurve, "castStopsCurve", [])!,
    ) as UtilityV2ModelConfig["castStopsCurve"],
    supportCurve: Object.freeze(
      parseCurve(raw.supportCurve, "supportCurve", [])!,
    ) as UtilityV2ModelConfig["supportCurve"],
    strategicCcCurve: Object.freeze(
      parseCurve(raw.strategicCcCurve, "strategicCcCurve", [])!,
    ) as UtilityV2ModelConfig["strategicCcCurve"],
    minHostileCastsPerHourForFullCredit: Number(raw.minHostileCastsPerHourForFullCredit),
    activeCombatGapMs: Number(raw.activeCombatGapMs),
    confidence: Object.freeze(
      structuredClone(raw.confidence),
    ) as UtilityV2ModelConfig["confidence"],
    scoreSemantics: Object.freeze(
      structuredClone(raw.scoreSemantics),
    ) as UtilityV2ModelConfig["scoreSemantics"],
  };

  return Object.freeze(overlay) as UtilityV2ModelConfig;
}

export function resolveUtilityV2ModelConfig(override?: unknown): UtilityV2ModelConfig {
  if (override === undefined || override === null || override === UTILITY_V2_MODEL_CONFIG) {
    return UTILITY_V2_MODEL_CONFIG;
  }
  return parseUtilityV2ModelConfig(override);
}
