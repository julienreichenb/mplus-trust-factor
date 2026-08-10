import type { Character } from "@mplus/database";
import {
  CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE,
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
  extractJobErrorCode,
  isEligibilityFailureCode,
} from "@mplus/config";
import { characterLacksBootstrapEvidence } from "@mplus/worker";

export { characterLacksBootstrapEvidence } from "@mplus/worker";

/** Public profile warning when persisted Blizzard bootstrap evidence is incomplete. */
export const CHARACTER_BOOTSTRAP_INCOMPLETE = "CHARACTER_BOOTSTRAP_INCOMPLETE" as const;

/**
 * Persisted bootstrap evidence required before the fail-closed refresh
 * eligibility gate can make a non-UNKNOWN decision from local data alone.
 *
 * Authoritative fields (minimum): level, Blizzard character ID, class, active spec, role.
 * Provider-assisted repair remains exact resolve (and forceRetry) — see worker
 * `ensurePublicCharacterBootstrap` / `persistPublicCharacterBootstrap` /
 * `resolveOrDiscoverPublicCharacter`.
 *
 * Missing authoritative current-season Mythic+ evidence is also repairable on
 * normal exact resolve (does not require forceRetry).
 */
export function latestJobIsEligibilityUnknown(latestJob: {
  status: string;
  error?: unknown;
} | null): boolean {
  if (!latestJob || latestJob.status !== "FAILED") return false;
  return extractJobErrorCode(latestJob.error) === CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN;
}

/**
 * Canonical signal for UI/admin: exact resolve can repair this row.
 * Shared by profile, refresh-status, requestRefresh conflict details, and admin actions.
 *
 * Repairable when:
 * - shell bootstrap fields incomplete, or
 * - prior fail-closed UNKNOWN job, or
 * - authoritative current-season Mythic+ evidence was never acquired (missing).
 *
 * Confirmed no-score (CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE after successful
 * provider proof) is NOT a bootstrap repair problem.
 */
export function isBootstrapRepairRequired(input: {
  character: Pick<
    Character,
    "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
  >;
  latestJob: { status: string; error?: unknown } | null;
  /** When true, season-scoped Mythic+ evidence has never been authoritatively acquired. */
  missingSeasonMythicEvidence?: boolean;
}): boolean {
  if (characterLacksBootstrapEvidence(input.character)) return true;
  if (latestJobIsEligibilityUnknown(input.latestJob)) return true;
  if (input.missingSeasonMythicEvidence === true) return true;
  return false;
}

/**
 * Decide whether exact resolve may perform a bounded Blizzard bootstrap repair.
 * Complete characters with valid season evidence must not incur new provider calls.
 */
export function shouldRepairCharacterBootstrap(input: {
  character: Pick<
    Character,
    "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
  >;
  latestJob: { status: string; error?: unknown } | null;
  forceRetry: boolean;
  /** True when no season-scoped Mythic+ rating evidence exists for the authoritative season. */
  missingSeasonMythicEvidence: boolean;
}): boolean {
  const lacksBootstrap = characterLacksBootstrapEvidence(input.character);
  const unknownFailure = latestJobIsEligibilityUnknown(input.latestJob);

  // Incomplete persisted shell — exact resolve may repair via Blizzard.
  if (lacksBootstrap) return true;
  // Prior fail-closed UNKNOWN must not permanently strand the character.
  if (unknownFailure) return true;
  // Missing authoritative current-season Mythic+ evidence — repair on normal resolve.
  // Valid persisted evidence ⇒ caller must pass missingSeasonMythicEvidence=false.
  if (input.missingSeasonMythicEvidence) return true;
  void input.forceRetry;
  return false;
}

/** True when a refresh/rerun conflict should advertise the resolve repair path. */
export function eligibilityConflictNeedsBootstrapRepair(input: {
  character: Pick<
    Character,
    "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
  >;
  eligibilityCode: string | null | undefined;
  /** When known, missing (never acquired) season evidence is repairable. */
  missingSeasonMythicEvidence?: boolean;
}): boolean {
  if (characterLacksBootstrapEvidence(input.character)) return true;
  if (input.eligibilityCode === CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN) return true;
  if (input.missingSeasonMythicEvidence === true) return true;
  // Confirmed authoritative no-score is not repairable via bootstrap.
  if (input.eligibilityCode === CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE) return false;
  return false;
}

export function isNonRetryableEligibilityErrorCode(code: string | null | undefined): boolean {
  return isEligibilityFailureCode(code);
}

export const CHARACTER_IDENTITY_COLLISION = "CHARACTER_IDENTITY_COLLISION" as const;

export function formatIdentityCollisionMessage(input: {
  existingCharacterId: string;
  conflictingCharacterId: string;
  blizzardCharacterId: string;
}): string {
  return (
    `${CHARACTER_IDENTITY_COLLISION}: Blizzard character ${input.blizzardCharacterId} ` +
    `is already bound to character ${input.conflictingCharacterId} ` +
    `(resolve target ${input.existingCharacterId}). Manual remediation required — refusing silent merge.`
  );
}
