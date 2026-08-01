import type { Character } from "@mplus/database";
import {
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
  extractJobErrorCode,
  isEligibilityFailureCode,
} from "@mplus/config";

/** Public profile warning when persisted Blizzard bootstrap evidence is incomplete. */
export const CHARACTER_BOOTSTRAP_INCOMPLETE = "CHARACTER_BOOTSTRAP_INCOMPLETE" as const;

/**
 * Persisted bootstrap evidence required before the fail-closed refresh
 * eligibility gate can make a non-UNKNOWN decision from local data alone.
 *
 * Authoritative fields (minimum):
 * - level
 * - Blizzard character ID
 * - class
 * - active spec
 * - role
 *
 * Faction / realm presentation fields are not required here: Blizzard may omit
 * faction, and realm identity is enforced separately via catalog reconciliation.
 *
 * Provider-assisted repair is allowed only from exact resolve / forceRetry
 * (and authorized admin repair that reuses the same path) — never from
 * GET profile, polling, scheduled refresh, bulk, or generic admin job rerun.
 *
 * Concurrent exact-resolve / admin-repair for the same identity is serialized
 * in-process (`withResolveIdentityLock`). Active refresh jobs are always reused
 * (including under forceRetry). Post-repair enqueue uses forceRefresh:true so the
 * prior FAILED IngestionJob row remains historical under a distinct dedupe key.
 *
 * Cross-process guarantees (lock does not span API replicas):
 * - Character `@@unique([regionId, realmId, normalizedName])` + upsert: one canonical row.
 * - Blizzard-ID collision remains a visible 409 (no silent merge).
 * - IngestionJob `dedupeKey` is `@unique`; stable (non-force) enqueues collapse on that key.
 * - forceRefresh enqueues use unique keys (requestedAt) to preserve FAILED history; after
 *   publish, `collapseSupersededActiveRefreshJobs` keeps the earliest active refresh and
 *   terminalizes extras (`REFRESH_SUPERSEDED_DEDUPED`). Duplicate Blizzard metadata fetches
 *   across replicas are bounded but possible without a distributed lock.
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
 * Canonical signal for UI/admin: exact resolve with forceRetry can repair this row.
 * Shared by profile, refresh-status, requestRefresh conflict details, and admin actions.
 */
export function isBootstrapRepairRequired(input: {
  character: Pick<
    Character,
    "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
  >;
  latestJob: { status: string; error?: unknown } | null;
}): boolean {
  if (characterLacksBootstrapEvidence(input.character)) return true;
  return latestJobIsEligibilityUnknown(input.latestJob);
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

/** True when a refresh/rerun conflict should advertise the resolve repair path. */
export function eligibilityConflictNeedsBootstrapRepair(input: {
  character: Pick<
    Character,
    "level" | "blizzardCharacterId" | "classId" | "activeSpecId" | "role"
  >;
  eligibilityCode: string | null | undefined;
}): boolean {
  if (characterLacksBootstrapEvidence(input.character)) return true;
  return input.eligibilityCode === CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN;
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
