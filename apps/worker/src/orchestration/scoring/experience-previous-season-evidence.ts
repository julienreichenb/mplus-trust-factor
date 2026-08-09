/**
 * Isolated Experience Phase 1 building block:
 * - deterministic previous Mythic+ season binding (catalog timestamps, not Blizzard ID arithmetic)
 * - acquisition + persistence of official previous-season Blizzard Mythic+ rating evidence
 *
 * Not wired into scoreCharacter / refresh / experience-history-loader.
 */

import type {
  BlizzardMythicKeystoneProfileDTO,
  BlizzardProvider,
  CharacterIdentityInput,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
} from "@mplus/contracts";

/** Minimal season row shape for pure previous-season binding (no Prisma dependency). */
export interface ExperienceSeasonBindingCandidate {
  id: string;
  regionId: string | null;
  slug: string;
  blizzardSeasonId: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export type PreviousSeasonBindingUnresolvedReason =
  | "CURRENT_REGION_MISSING"
  | "CURRENT_START_MISSING"
  | "NO_PREVIOUS_SEASON";

export type PreviousSeasonBindingResult =
  | {
      ok: true;
      season: ExperienceSeasonBindingCandidate;
    }
  | {
      ok: false;
      reason: PreviousSeasonBindingUnresolvedReason;
    };

/**
 * Neutral previous-season Blizzard rating evidence (no percentile / Experience score).
 */
export type PreviousSeasonRatingEvidence =
  | {
      state: "HAS_VALUE";
      internalSeasonId: string;
      seasonSlug: string;
      blizzardSeasonId: number;
      rating: number;
      fetchedAt: string;
      providerPayloadId: string | null;
    }
  | {
      state: "CONFIRMED_NO_ACTIVITY";
      internalSeasonId: string;
      seasonSlug: string;
      blizzardSeasonId: number;
      rating: null;
      fetchedAt: string;
      providerPayloadId: string | null;
    }
  | {
      state: "UNRESOLVED";
      reason: string;
    }
  | {
      state: "PROVIDER_FAILURE";
      reason: string;
      cause: unknown;
    }
  | {
      state: "CONTRADICTORY_PAYLOAD";
      reason: string;
      internalSeasonId: string;
      seasonSlug: string;
      blizzardSeasonId: number;
      fetchedAt: string;
      providerPayloadId: string | null;
    };

export type PreviousSeasonBlizzardPort = Pick<
  BlizzardProvider,
  "getMythicKeystoneSeasonProfile"
>;

export type PersistProviderResultFn = (
  result: ProviderResult<unknown>,
) => Promise<string | null>;

function timeMs(value: Date | null): number | null {
  if (value == null) return null;
  const ms = value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compare candidates for "closest preceding" selection (descending chronological preference).
 * After filtering to eligible predecessors, the first element of a sort with this comparator wins.
 */
function comparePreviousSeasonCandidates(
  a: ExperienceSeasonBindingCandidate,
  b: ExperienceSeasonBindingCandidate,
): number {
  const aStart = timeMs(a.startsAt) ?? Number.NEGATIVE_INFINITY;
  const bStart = timeMs(b.startsAt) ?? Number.NEGATIVE_INFINITY;
  if (aStart !== bStart) return bStart - aStart; // later start first
  const aEnd = timeMs(a.endsAt) ?? Number.NEGATIVE_INFINITY;
  const bEnd = timeMs(b.endsAt) ?? Number.NEGATIVE_INFINITY;
  if (aEnd !== bEnd) return bEnd - aEnd;
  const slugCmp = a.slug.localeCompare(b.slug);
  if (slugCmp !== 0) return slugCmp;
  return a.id.localeCompare(b.id);
}

/**
 * Resolve the immediately previous Mythic+ season for a current season.
 *
 * Authority: same regionId + temporal precedence via startsAt (not Blizzard ID − 1).
 * Eligible candidate: same region, distinct id, non-null blizzardSeasonId, startsAt < current.startsAt.
 */
export function resolvePreviousMythicSeason(
  current: ExperienceSeasonBindingCandidate,
  candidates: readonly ExperienceSeasonBindingCandidate[],
): PreviousSeasonBindingResult {
  if (current.regionId == null || current.regionId.length === 0) {
    return { ok: false, reason: "CURRENT_REGION_MISSING" };
  }
  const currentStart = timeMs(current.startsAt);
  if (currentStart == null) {
    return { ok: false, reason: "CURRENT_START_MISSING" };
  }

  const eligible = candidates.filter((c) => {
    if (c.id === current.id) return false;
    if (c.regionId == null || c.regionId !== current.regionId) return false;
    if (c.blizzardSeasonId == null || !Number.isFinite(c.blizzardSeasonId)) return false;
    const start = timeMs(c.startsAt);
    if (start == null) return false;
    // Must demonstrably precede current by start time.
    if (!(start < currentStart)) return false;
    // Reject obviously impossible ordering: ends after current start while claiming earlier start
    // is still allowed (overlap); only reject when endsAt proves the season started after current.
    const end = timeMs(c.endsAt);
    if (end != null && end < start) {
      // Corrupt ends-before-start: still allow start-based precedence (documented conservative).
      return true;
    }
    return true;
  });

  if (eligible.length === 0) {
    return { ok: false, reason: "NO_PREVIOUS_SEASON" };
  }

  const sorted = [...eligible].sort(comparePreviousSeasonCandidates);
  return { ok: true, season: sorted[0]! };
}

function fetchedAtFromResult(
  result: ProviderResult<{ profile: BlizzardMythicKeystoneProfileDTO; runs: MythicRunDTO[] }>,
): string {
  return result.provenance.fetchedAt || result.metadata.completedAt || result.metadata.requestedAt;
}

/**
 * Confirmed no-activity rule (tested):
 * provider succeeded AND rating is null AND runs is empty → CONFIRMED_NO_ACTIVITY.
 * rating null with any runs → CONTRADICTORY_PAYLOAD (not inactivity).
 * non-finite rating → UNRESOLVED.
 */
export function mapSeasonProfileToPreviousSeasonRatingEvidence(input: {
  binding: ExperienceSeasonBindingCandidate;
  result: ProviderResult<{ profile: BlizzardMythicKeystoneProfileDTO; runs: MythicRunDTO[] }>;
  providerPayloadId: string | null;
}): PreviousSeasonRatingEvidence {
  const blizzardSeasonId = input.binding.blizzardSeasonId;
  if (blizzardSeasonId == null || !Number.isFinite(blizzardSeasonId)) {
    return { state: "UNRESOLVED", reason: "BINDING_MISSING_BLIZZARD_SEASON_ID" };
  }

  const rating = input.result.data.profile.currentMythicRating;
  const runs = input.result.data.runs ?? [];
  const fetchedAt = fetchedAtFromResult(input.result);
  const base = {
    internalSeasonId: input.binding.id,
    seasonSlug: input.binding.slug,
    blizzardSeasonId,
    fetchedAt,
    providerPayloadId: input.providerPayloadId,
  };

  if (rating == null) {
    if (runs.length === 0) {
      return { state: "CONFIRMED_NO_ACTIVITY", rating: null, ...base };
    }
    return {
      state: "CONTRADICTORY_PAYLOAD",
      reason: "NULL_RATING_WITH_RUNS",
      ...base,
    };
  }

  if (!Number.isFinite(rating)) {
    return { state: "UNRESOLVED", reason: "NON_FINITE_RATING" };
  }

  return { state: "HAS_VALUE", rating, ...base };
}

/**
 * Acquire official previous-season Blizzard Mythic+ rating evidence.
 * Exactly one `getMythicKeystoneSeasonProfile` call; persists that ProviderResult via callback.
 * Not invoked by production scoring in this chantier.
 */
export async function acquirePreviousSeasonRatingEvidence(input: {
  identity: CharacterIdentityInput;
  previousSeason: ExperienceSeasonBindingCandidate;
  blizzard: PreviousSeasonBlizzardPort;
  ctx: ProviderFetchContext;
  persistProviderResult: PersistProviderResultFn;
}): Promise<PreviousSeasonRatingEvidence> {
  const blizzardSeasonId = input.previousSeason.blizzardSeasonId;
  if (blizzardSeasonId == null || !Number.isFinite(blizzardSeasonId)) {
    return { state: "UNRESOLVED", reason: "BINDING_MISSING_BLIZZARD_SEASON_ID" };
  }

  let result: ProviderResult<{
    profile: BlizzardMythicKeystoneProfileDTO;
    runs: MythicRunDTO[];
  }>;
  try {
    result = await input.blizzard.getMythicKeystoneSeasonProfile(
      input.identity,
      blizzardSeasonId,
      input.ctx,
    );
  } catch (cause) {
    return {
      state: "PROVIDER_FAILURE",
      reason: "MYTHIC_KEYSTONE_SEASON_PROFILE_FAILED",
      cause,
    };
  }

  const providerPayloadId = await input.persistProviderResult(result);
  return mapSeasonProfileToPreviousSeasonRatingEvidence({
    binding: input.previousSeason,
    result,
    providerPayloadId,
  });
}

/** True when Blizzard season-profile failure is an ambiguous HTTP 404 / profile-unavailable. */
export function isAmbiguousBlizzardSeasonProfileNotFound(cause: unknown): boolean {
  if (cause == null || typeof cause !== "object") return false;
  const err = cause as {
    statusCode?: number | null;
    code?: string;
    details?: { reason?: string };
  };
  if (err.statusCode === 404) return true;
  if (err.code === "NOT_FOUND") return true;
  const reason = err.details?.reason;
  return reason === "NOT_FOUND" || reason === "PROFILE_UNAVAILABLE";
}

export type RioPreviousSeasonCorroboration = {
  /** Raider.IO profile fetch succeeded for this character. */
  profileFetched: boolean;
  /** Previous-season overall score when RIO reported one; null when absent/zero. */
  previousSeasonScore: number | null;
  /**
   * True when the profile previous alias was proven to match the bound previous RIO slug.
   * When false/undefined, score must not corroborate (fail closed on unbound alias).
   */
  seasonBound?: boolean;
};

/**
 * Corroborate ambiguous Blizzard previous-season 404 with Raider.IO.
 * Does NOT replace Blizzard as the official previous-season score source.
 * Only reclassifies PROVIDER_FAILURE → CONFIRMED_NO_ACTIVITY when RIO also
 * shows no previous-season score. When RIO has a positive score, keep failure
 * (contradiction / provider issue).
 */
export function corroboratePreviousSeasonBlizzardNotFound(input: {
  binding: ExperienceSeasonBindingCandidate;
  ratingEvidence: PreviousSeasonRatingEvidence;
  rio: RioPreviousSeasonCorroboration | null;
  fetchedAt?: string;
}): PreviousSeasonRatingEvidence {
  const { ratingEvidence, binding, rio } = input;
  if (ratingEvidence.state !== "PROVIDER_FAILURE") return ratingEvidence;
  if (!isAmbiguousBlizzardSeasonProfileNotFound(ratingEvidence.cause)) {
    return ratingEvidence;
  }
  if (rio == null || !rio.profileFetched) {
    return {
      ...ratingEvidence,
      reason: "BLIZZARD_404_UNCORROBORATED",
    };
  }
  if (rio.seasonBound !== true) {
    return {
      ...ratingEvidence,
      reason: "BLIZZARD_404_UNCORROBORATED_UNBOUND_RIO_PREVIOUS",
    };
  }
  const rioScore = rio.previousSeasonScore;
  if (rioScore != null && Number.isFinite(rioScore) && rioScore > 0) {
    return {
      ...ratingEvidence,
      reason: "BLIZZARD_404_CONTRADICTED_BY_RAIDERIO",
    };
  }
  const blizzardSeasonId = binding.blizzardSeasonId;
  if (blizzardSeasonId == null || !Number.isFinite(blizzardSeasonId)) {
    return ratingEvidence;
  }
  return {
    state: "CONFIRMED_NO_ACTIVITY",
    internalSeasonId: binding.id,
    seasonSlug: binding.slug,
    blizzardSeasonId,
    rating: null,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    providerPayloadId: null,
  };
}
