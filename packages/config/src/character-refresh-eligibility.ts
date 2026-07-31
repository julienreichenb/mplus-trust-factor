import { ACTIVE_EXPANSION_METADATA_V1 } from "./game-metadata.js";

/**
 * Canonical config key for the maximum character level.
 * Runtime authority is AppEnv.MAX_CHARACTER_LEVEL (this key).
 * ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel is the default seed only —
 * it must never independently override a configured runtime value.
 */
export const MAX_CHARACTER_LEVEL_CONFIG_KEY = "MAX_CHARACTER_LEVEL" as const;

export interface CharacterRefreshEligibilityPolicyV1 {
  version: string;
  maxCharacterLevel: number;
  expansionMetadataVersion: string;
  minCurrentSeasonMythicScoreExclusive: number;
}

/**
 * Validate and return the configured max character level.
 * Pass AppEnv.MAX_CHARACTER_LEVEL (or any resolved runtime value) as `runtimeLevel`.
 * When omitted, falls back to ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel (default only).
 */
export function getConfiguredMaxCharacterLevel(runtimeLevel?: number | null): number {
  const level =
    runtimeLevel != null && Number.isFinite(runtimeLevel)
      ? runtimeLevel
      : ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel;
  if (!Number.isInteger(level) || level < 1 || level > 120) {
    throw new Error(`Invalid ${MAX_CHARACTER_LEVEL_CONFIG_KEY} (${String(level)})`);
  }
  return level;
}

/**
 * Build the eligibility policy from the single runtime max-level authority.
 * Always resolve maxCharacterLevel through getConfiguredMaxCharacterLevel.
 */
export function buildCharacterRefreshEligibilityPolicy(
  runtimeMaxCharacterLevel?: number | null,
): CharacterRefreshEligibilityPolicyV1 {
  return {
    version: "v1",
    maxCharacterLevel: getConfiguredMaxCharacterLevel(runtimeMaxCharacterLevel),
    expansionMetadataVersion: ACTIVE_EXPANSION_METADATA_V1.version,
    minCurrentSeasonMythicScoreExclusive: 0,
  };
}

/**
 * Default policy snapshot (max level = expansion metadata default).
 * Prefer buildCharacterRefreshEligibilityPolicy(env.MAX_CHARACTER_LEVEL) at runtime.
 */
export const CHARACTER_REFRESH_ELIGIBILITY_POLICY_V1: CharacterRefreshEligibilityPolicyV1 =
  buildCharacterRefreshEligibilityPolicy();

export const CHARACTER_BELOW_MAX_LEVEL = "CHARACTER_BELOW_MAX_LEVEL" as const;
export const CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE =
  "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE" as const;
export const CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN =
  "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN" as const;

export type CharacterRefreshEligibilityCode =
  | typeof CHARACTER_BELOW_MAX_LEVEL
  | typeof CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE
  | typeof CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN;

export const CHARACTER_REFRESH_ELIGIBILITY_CODES: ReadonlySet<string> = new Set([
  CHARACTER_BELOW_MAX_LEVEL,
  CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE,
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
]);

export function isCharacterRefreshEligibilityCode(
  code: string | null | undefined,
): code is CharacterRefreshEligibilityCode {
  return typeof code === "string" && CHARACTER_REFRESH_ELIGIBILITY_CODES.has(code);
}

export interface CharacterRefreshEligibilityInput {
  /** Persisted Character.level — null/undefined means unknown. */
  characterLevel: number | null | undefined;
  /**
   * Mythic+ rating proven for the authoritative current season
   * (ownership season match and/or season-scoped metric observation /
   * season-tagged snapshot metadata).
   * null = no proven current-season score; undefined = could not evaluate.
   */
  currentSeasonMythicScore: number | null | undefined;
  /** When false, season identity required for score proof is missing. */
  authoritativeSeasonKnown: boolean;
}

export interface CharacterRefreshEligibilityResult {
  eligible: boolean;
  code: CharacterRefreshEligibilityCode | null;
  message: string | null;
  maxCharacterLevel: number;
  policyVersion: string;
}

/**
 * Pure fail-closed eligibility evaluation. Never performs I/O.
 * Synchronous, provider-free, WCL-budget-free, DB/queue-write-free.
 * Identical decisions for every provider mode / queue mode.
 */
export function evaluateCharacterRefreshEligibility(
  input: CharacterRefreshEligibilityInput,
  policy: CharacterRefreshEligibilityPolicyV1 = CHARACTER_REFRESH_ELIGIBILITY_POLICY_V1,
): CharacterRefreshEligibilityResult {
  const maxCharacterLevel = getConfiguredMaxCharacterLevel(policy.maxCharacterLevel);

  if (input.characterLevel == null || !Number.isFinite(input.characterLevel)) {
    return {
      eligible: false,
      code: CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
      message: "Character level is missing — refusing refresh (fail closed)",
      maxCharacterLevel,
      policyVersion: policy.version,
    };
  }

  if (input.characterLevel < maxCharacterLevel) {
    return {
      eligible: false,
      code: CHARACTER_BELOW_MAX_LEVEL,
      message: `Character level ${input.characterLevel} is below max level ${maxCharacterLevel}`,
      maxCharacterLevel,
      policyVersion: policy.version,
    };
  }

  if (!input.authoritativeSeasonKnown) {
    return {
      eligible: false,
      code: CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
      message: "Authoritative current season is unknown — refusing refresh (fail closed)",
      maxCharacterLevel,
      policyVersion: policy.version,
    };
  }

  if (input.currentSeasonMythicScore === undefined) {
    return {
      eligible: false,
      code: CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
      message: "Current-season Mythic+ score could not be evaluated — refusing refresh (fail closed)",
      maxCharacterLevel,
      policyVersion: policy.version,
    };
  }

  if (
    input.currentSeasonMythicScore == null ||
    !(input.currentSeasonMythicScore > policy.minCurrentSeasonMythicScoreExclusive)
  ) {
    return {
      eligible: false,
      code: CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE,
      message: "Character has no Mythic+ score for the authoritative current season",
      maxCharacterLevel,
      policyVersion: policy.version,
    };
  }

  return {
    eligible: true,
    code: null,
    message: null,
    maxCharacterLevel,
    policyVersion: policy.version,
  };
}
