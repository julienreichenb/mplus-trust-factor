import type { Character } from "@mplus/database";
import {
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
  extractJobErrorCode,
} from "@mplus/config";

/**
 * Persisted bootstrap evidence required before the fail-closed refresh
 * eligibility gate can make a non-UNKNOWN decision from local data alone.
 *
 * Provider-assisted repair is allowed only from exact resolve / forceRetry
 * (and authorized manual repair that reuses the same path) — never from
 * GET profile, polling, scheduled refresh, bulk, or admin job rerun.
 */
export function characterLacksBootstrapEvidence(
  character: Pick<
    Character,
    "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
  >,
): boolean {
  if (character.level == null) return true;
  if (character.blizzardCharacterId == null) return true;
  if (character.classId == null) return true;
  if (character.activeSpecId == null) return true;
  if (character.role == null) return true;
  return false;
}

export function latestJobIsEligibilityUnknown(latestJob: {
  status: string;
  error?: unknown;
} | null): boolean {
  if (!latestJob || latestJob.status !== "FAILED") return false;
  return extractJobErrorCode(latestJob.error) === CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN;
}

/**
 * Decide whether exact resolve may perform a bounded Blizzard bootstrap repair.
 * Complete, successful characters must not incur new provider calls.
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
  // Explicit retry may refresh season-scoped Mythic+ evidence when still missing.
  if (input.forceRetry && input.missingSeasonMythicEvidence) return true;
  return false;
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
