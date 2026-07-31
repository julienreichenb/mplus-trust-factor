import { ACTIVE_EXPANSION_METADATA_V1 } from "./game-metadata.js";
import { getConfiguredMaxCharacterLevel } from "./character-refresh-eligibility.js";

/**
 * Centralized, versioned Account owned-character relevance policy.
 * maxCharacterLevel always resolves through getConfiguredMaxCharacterLevel —
 * expansion metadata supplies the default only, never an independent override.
 */
export interface OwnedCharacterRelevancePolicyV1 {
  version: string;
  minCurrentSeasonMythicRating: number;
  maxCharacterLevel: number;
  expansionMetadataVersion: string;
}

export function buildOwnedCharacterRelevancePolicy(
  runtimeMaxCharacterLevel?: number | null,
): OwnedCharacterRelevancePolicyV1 {
  return {
    version: "v1",
    /**
     * Minimum current-season Mythic+ rating for relevance when no other
     * qualifying signal exists. Chosen as V1 product default (1000) because no
     * prior owned-character relevance policy existed in this repo.
     */
    minCurrentSeasonMythicRating: 1000,
    maxCharacterLevel: getConfiguredMaxCharacterLevel(runtimeMaxCharacterLevel),
    expansionMetadataVersion: ACTIVE_EXPANSION_METADATA_V1.version,
  };
}

/** Default policy snapshot (max level = expansion metadata default). */
export const OWNED_CHARACTER_RELEVANCE_POLICY_V1: OwnedCharacterRelevancePolicyV1 =
  buildOwnedCharacterRelevancePolicy();

export type RelevanceReason =
  | "CURRENT_OWNERSHIP"
  | "MAX_LEVEL"
  | "BELOW_MAX_LEVEL"
  | "HISTORICAL_OR_INACTIVE"
  | "MYTHIC_RATING_THRESHOLD"
  | "BELOW_RATING_THRESHOLD"
  | "EXISTING_PUBLIC_SCORE"
  | "ACTIVE_OR_QUEUED_REFRESH"
  | "EXPLICIT_PRIMARY"
  | "RATING_UNAVAILABLE";

export interface OwnedCharacterRelevanceInput {
  ownershipStatus: "CURRENT" | "HISTORICAL" | "STALE" | "REVOKED" | string;
  characterLevel: number | null;
  currentSeasonMythicRating: number | null;
  hasValidPublicScore: boolean;
  hasActiveOrQueuedRefresh: boolean;
  isPrimary: boolean;
}

export interface OwnedCharacterRelevanceResult {
  policyVersion: string;
  eligible: boolean;
  reasons: RelevanceReason[];
}

/**
 * Pure V1 relevance evaluation. Callers supply already-fetched cheap signals;
 * this function never performs I/O.
 */
export function evaluateOwnedCharacterRelevanceV1(
  input: OwnedCharacterRelevanceInput,
  policy: OwnedCharacterRelevancePolicyV1 = OWNED_CHARACTER_RELEVANCE_POLICY_V1,
): OwnedCharacterRelevanceResult {
  const reasons: RelevanceReason[] = [];
  const maxCharacterLevel = getConfiguredMaxCharacterLevel(policy.maxCharacterLevel);

  if (input.ownershipStatus !== "CURRENT") {
    reasons.push("HISTORICAL_OR_INACTIVE");
    return { policyVersion: policy.version, eligible: false, reasons };
  }
  reasons.push("CURRENT_OWNERSHIP");

  const level = input.characterLevel ?? 0;
  if (level < maxCharacterLevel) {
    reasons.push("BELOW_MAX_LEVEL");
    return { policyVersion: policy.version, eligible: false, reasons };
  }
  reasons.push("MAX_LEVEL");

  if (input.isPrimary) {
    reasons.push("EXPLICIT_PRIMARY");
    return { policyVersion: policy.version, eligible: true, reasons };
  }

  if (input.hasValidPublicScore) {
    reasons.push("EXISTING_PUBLIC_SCORE");
    return { policyVersion: policy.version, eligible: true, reasons };
  }

  if (input.hasActiveOrQueuedRefresh) {
    reasons.push("ACTIVE_OR_QUEUED_REFRESH");
    return { policyVersion: policy.version, eligible: true, reasons };
  }

  if (input.currentSeasonMythicRating == null) {
    reasons.push("RATING_UNAVAILABLE");
    return { policyVersion: policy.version, eligible: false, reasons };
  }

  if (input.currentSeasonMythicRating >= policy.minCurrentSeasonMythicRating) {
    reasons.push("MYTHIC_RATING_THRESHOLD");
    return { policyVersion: policy.version, eligible: true, reasons };
  }

  reasons.push("BELOW_RATING_THRESHOLD");
  return { policyVersion: policy.version, eligible: false, reasons };
}

/**
 * Strict automatic refresh eligibility for Account discovery triggers.
 * Display relevance may still use primary / public-score / active-job signals;
 * those must never bypass this gate for enqueue decisions.
 */
export function evaluateOwnedCharacterAutoRefreshEligibilityV1(
  input: Pick<
    OwnedCharacterRelevanceInput,
    "ownershipStatus" | "characterLevel" | "currentSeasonMythicRating"
  >,
  policy: OwnedCharacterRelevancePolicyV1 = OWNED_CHARACTER_RELEVANCE_POLICY_V1,
): OwnedCharacterRelevanceResult {
  const reasons: RelevanceReason[] = [];
  const maxCharacterLevel = getConfiguredMaxCharacterLevel(policy.maxCharacterLevel);

  if (input.ownershipStatus !== "CURRENT") {
    reasons.push("HISTORICAL_OR_INACTIVE");
    return { policyVersion: policy.version, eligible: false, reasons };
  }
  reasons.push("CURRENT_OWNERSHIP");

  const level = input.characterLevel ?? 0;
  if (level < maxCharacterLevel) {
    reasons.push("BELOW_MAX_LEVEL");
    return { policyVersion: policy.version, eligible: false, reasons };
  }
  reasons.push("MAX_LEVEL");

  if (input.currentSeasonMythicRating == null) {
    reasons.push("RATING_UNAVAILABLE");
    return { policyVersion: policy.version, eligible: false, reasons };
  }

  if (input.currentSeasonMythicRating >= policy.minCurrentSeasonMythicRating) {
    reasons.push("MYTHIC_RATING_THRESHOLD");
    return { policyVersion: policy.version, eligible: true, reasons };
  }

  reasons.push("BELOW_RATING_THRESHOLD");
  return { policyVersion: policy.version, eligible: false, reasons };
}
