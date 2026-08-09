/**
 * Experience Phase 1 — production evidence acquisition for refresh scoring.
 *
 * Builds an ExperiencePhase1Result from Blizzard previous-season rating +
 * persisted Season population policy + character achievements + optional
 * previous-season regional class rank (from the existing Raider.IO profile).
 * Never calls WCL or per-character season cutoffs. Failures degrade Experience only.
 *
 * Successful closed-season evidence is persisted and reused (no TTL).
 */

import type {
  BlizzardCharacterAchievementsDTO,
  BlizzardProvider,
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RegionCode,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import {
  calculateExperiencePhase1,
  estimatePreviousSeasonStanding,
  extractEliteCutoffHistory,
  usablePreviousRegionalClassRank,
  ELITE_CUTOFF_CATALOG_VERSION,
  type ExperiencePhase1PreviousEvidence,
  type ExperiencePhase1Result,
  type ExperiencePhase1StandingProvenance,
  type NativeCutoffBand,
} from "@mplus/scoring";
import {
  acquirePreviousSeasonRatingEvidence,
  applyExactSeasonRioRatingFallback,
  exactSeasonScoreFromRioProfile,
  resolvePreviousMythicSeason,
  type ExperienceSeasonBindingCandidate,
  type PersistProviderResultFn,
  type PreviousSeasonRatingEvidence,
  type RioExactSeasonScoreEvidence,
  type RioPreviousSeasonCorroboration,
} from "./experience-previous-season-evidence.js";
import { readExperiencePopulationPolicyMetadata } from "./experience-season-population-policy-metadata.js";
import {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  buildEliteCutoffHistoryPersistInput,
  buildPreviousSeasonRatingPersistInput,
  parsePersistedEliteCutoffHistoryPayload,
  ratingEvidenceFromPersistedRow,
  type ExperienceEvidenceStore,
} from "./experience-evidence-persist.js";

export type ExperiencePhase1BlizzardPort = Pick<
  BlizzardProvider,
  "getMythicKeystoneSeasonProfile" | "getCharacterAchievements"
>;

export interface BuildExperiencePhase1Input {
  prisma: Pick<PrismaClient, "season">;
  /** Stable internal character id — required for durable evidence keys. */
  characterId: string;
  identity: CharacterIdentityInput;
  /** Internal Season.id for the character's current scoring season. */
  currentSeasonId: string;
  regionCode: RegionCode;
  blizzard: ExperiencePhase1BlizzardPort;
  ctx: ProviderFetchContext;
  persistProviderResult: PersistProviderResultFn;
  /**
   * When false, skip provider calls and reconstruct from durable evidence only
   * (provider-free replay). Miss → unavailable.
   */
  allowProviderCalls: boolean;
  /** Durable Experience evidence store (DB or in-memory test double). */
  evidenceStore?: ExperienceEvidenceStore | null;
  /**
   * Previous-season regional class rank from the already-fetched Raider.IO profile
   * (`previousRanks.classRank.region`). Not fetched here — no extra RIO call.
   * Only applied when exact-season identity was proven by the caller.
   */
  previousRegionalClassRank?: number | null;
  /**
   * Optional already-resolved exact-season RIO evidence (rare test seam).
   * Production uses raiderIoExactSeason port / dedicated HTTP on Blizzard failure.
   */
  rioExactSeasonFallback?: RioExactSeasonScoreEvidence | null;
  /**
   * @deprecated Prefer dedicated raiderIoExactSeason acquisition.
   */
  rioPreviousSeasonCorroboration?: RioPreviousSeasonCorroboration | null;
  /** Bound previous Raider.IO season slug from Season.providerSeasonId. */
  boundPreviousRaiderIoSlug?: string | null;
  /**
   * Dedicated exact-season RIO historical rating port.
   * Required for production fallback when no compatible preloaded profile exists.
   */
  raiderIoExactSeason?: ExperiencePhase1RaiderIoExactSeasonPort | null;
}

export type ExperiencePhase1RaiderIoExactSeasonPort = {
  getCharacterExactSeasonHistoricalRating: (
    identity: CharacterIdentityInput,
    seasonSlug: string,
    ctx: ProviderFetchContext,
  ) => Promise<ProviderResult<import("@mplus/contracts").RaiderIoExactSeasonHistoricalRating>>;
};

export interface BuildExperiencePhase1Result {
  experience: ExperiencePhase1Result;
  /** Blizzard getMythicKeystoneSeasonProfile invocations (0 or 1). */
  previousSeasonProfileCalls: number;
  /** Blizzard getCharacterAchievements invocations (0 or 1). */
  achievementsCalls: number;
  /** Dedicated Raider.IO historical rating fallback invocations (profile reuse = 0). */
  raiderIoHistoricalRatingCalls: number;
  /** True when previous-season rating came from durable evidence. */
  previousSeasonRatingFromCache: boolean;
  /** True when elite evidence came from durable evidence. */
  eliteFromCache: boolean;
  /** Diagnostic reasons for degraded previous / elite paths. */
  diagnostics: {
    previousReason: string | null;
    eliteReason: string | null;
    bindingReason: string | null;
    ratingSource: "BLIZZARD" | "RAIDERIO_FALLBACK" | "PERSISTED" | null;
    historicalRating: number | null;
    exactHistoricalSeasonSlug: string | null;
    populationPolicyVersion: string | null;
    matchedNativeBand: string | null;
    thresholdsUsed: Array<{ quantile: string; score: number }> | null;
  };
}

function toBindingCandidate(row: {
  id: string;
  regionId: string | null;
  slug: string;
  blizzardSeasonId: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
}): ExperienceSeasonBindingCandidate {
  return {
    id: row.id,
    regionId: row.regionId,
    slug: row.slug,
    blizzardSeasonId: row.blizzardSeasonId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

/**
 * Map Agent 03 rating evidence + persisted population policy into calculator previous input.
 * Provider failure / missing policy / estimate failure → UNAVAILABLE (never score 0).
 */
export function mapPreviousEvidenceToPhase1Input(input: {
  ratingEvidence: PreviousSeasonRatingEvidence;
  policyMetadata: ReturnType<typeof readExperiencePopulationPolicyMetadata>;
}): { previous: ExperiencePhase1PreviousEvidence; reason: string | null } {
  const { ratingEvidence, policyMetadata } = input;

  if (ratingEvidence.state === "CONFIRMED_NO_ACTIVITY") {
    return { previous: { state: "CONFIRMED_NO_ACTIVITY" }, reason: null };
  }

  if (ratingEvidence.state === "PROVIDER_FAILURE") {
    return {
      previous: { state: "UNAVAILABLE", reason: ratingEvidence.reason },
      reason: ratingEvidence.reason,
    };
  }

  if (ratingEvidence.state === "UNRESOLVED" || ratingEvidence.state === "CONTRADICTORY_PAYLOAD") {
    return {
      previous: { state: "UNAVAILABLE", reason: ratingEvidence.reason },
      reason: ratingEvidence.reason,
    };
  }

  // HAS_VALUE
  if (!policyMetadata) {
    return {
      previous: { state: "UNAVAILABLE", reason: "MISSING_POPULATION_POLICY" },
      reason: "MISSING_POPULATION_POLICY",
    };
  }

  const standing = estimatePreviousSeasonStanding(
    ratingEvidence.rating,
    policyMetadata.policy,
  );
  if (!standing.ok) {
    return {
      previous: { state: "UNAVAILABLE", reason: standing.reason },
      reason: standing.reason,
    };
  }

  return {
    previous: { state: "STANDING", standing: standing.standing },
    reason: null,
  };
}

/** Extract usable previous-season regional class rank from a RIO profile.
 *
 * `previous_mythic_plus_ranks` carries no season identity in the provider contract.
 * Exact-season identity must be proven by the caller; otherwise fail closed (null).
 */
export function previousRegionalClassRankFromRioProfile(
  profile:
    | {
        previousRanks?: Parameters<typeof usablePreviousRegionalClassRank>[0];
      }
    | null
    | undefined,
  opts?: {
    /** Set only when rank is proven for the bound previous real Mythic+ season. */
    exactSeasonProven?: boolean;
  },
): number | null {
  if (profile == null) return null;
  if (opts?.exactSeasonProven !== true) return null;
  return usablePreviousRegionalClassRank(profile.previousRanks ?? null);
}

/** Build RIO corroboration/fallback input from an already-fetched profile (no extra call).
 *
 * Exact season slug must match bound previous RIO slug on currentSeason or previousSeason.
 * Missing profile → null (do not assume refresh always supplies it).
 */
export function rioPreviousSeasonCorroborationFromProfile(
  profile:
    | {
        previousSeason?: {
          seasonSlug?: string | null;
          scores?: { all?: number | null } | null;
        } | null;
        currentSeason?: {
          seasonSlug?: string | null;
          scores?: { all?: number | null } | null;
        } | null;
      }
    | null
    | undefined,
  opts?: {
    boundPreviousRaiderIoSlug?: string | null;
  },
): RioPreviousSeasonCorroboration | null {
  if (profile == null) return null;
  const boundSlug = opts?.boundPreviousRaiderIoSlug?.trim() || null;
  if (!boundSlug) {
    return { profileFetched: true, previousSeasonScore: null, seasonBound: false };
  }
  const exact = exactSeasonScoreFromRioProfile(profile, boundSlug);
  if (exact === undefined) {
    return {
      profileFetched: true,
      previousSeasonScore: null,
      seasonBound: false,
      exactSeasonSlug: boundSlug,
    };
  }
  const previousSeasonScore =
    typeof exact === "number" && Number.isFinite(exact) && exact > 0 ? exact : null;
  return {
    profileFetched: true,
    previousSeasonScore,
    seasonBound: true,
    exactSeasonSlug: boundSlug,
  };
}

function resolvePreloadedRioExactSeasonFallback(
  input: BuildExperiencePhase1Input,
): RioExactSeasonScoreEvidence | null {
  if (input.rioExactSeasonFallback) return input.rioExactSeasonFallback;
  const legacy = input.rioPreviousSeasonCorroboration;
  if (
    legacy != null &&
    legacy.seasonBound === true &&
    legacy.exactSeasonSlug?.trim()
  ) {
    const score = legacy.previousSeasonScore;
    // Positive exact-season score may be reused without a dedicated HTTP call.
    // Zero/null cannot prove absence without dungeon run counts → treat as not reusable.
    if (score != null && Number.isFinite(score) && score > 0) {
      return {
        profileFetched: legacy.profileFetched,
        exactSeasonSlug: legacy.exactSeasonSlug,
        exactSeasonScore: score,
        activityProof: "UNKNOWN",
      };
    }
  }
  return null;
}

function rioEvidenceFromDedicatedResult(input: {
  seasonSlug: string;
  result: ProviderResult<import("@mplus/contracts").RaiderIoExactSeasonHistoricalRating>;
  providerPayloadId: string | null;
}): RioExactSeasonScoreEvidence {
  const data = input.result.data;
  if (!data.seasonFound) {
    return {
      profileFetched: true,
      exactSeasonSlug: input.seasonSlug,
      exactSeasonScore: undefined,
      activityProof: "UNKNOWN",
      providerPayloadId: input.providerPayloadId,
      fetchedAt: input.result.provenance.fetchedAt,
    };
  }
  return {
    profileFetched: true,
    exactSeasonSlug: input.seasonSlug,
    exactSeasonScore: data.scoreAll,
    activityProof: data.activityProof,
    providerPayloadId: input.providerPayloadId,
    fetchedAt: input.result.provenance.fetchedAt,
  };
}

/**
 * Acquire Experience Phase 1 evidence and compute the pure calculator result.
 *
 * Cold: at most 1 previous-season Blizzard profile + optional exact-season RIO
 * fallback + 1 achievements call. Warm/replay: durable evidence only (0 providers).
 */
export async function buildExperiencePhase1Result(
  input: BuildExperiencePhase1Input,
): Promise<BuildExperiencePhase1Result> {
  const diagnostics = {
    previousReason: null as string | null,
    eliteReason: null as string | null,
    bindingReason: null as string | null,
    ratingSource: null as "BLIZZARD" | "RAIDERIO_FALLBACK" | "PERSISTED" | null,
    historicalRating: null as number | null,
    exactHistoricalSeasonSlug: null as string | null,
    populationPolicyVersion: null as string | null,
    matchedNativeBand: null as string | null,
    thresholdsUsed: null as Array<{ quantile: string; score: number }> | null,
  };
  const previousRegionalClassRank = input.previousRegionalClassRank ?? null;
  const store = input.evidenceStore ?? null;

  let previousSeasonProfileCalls = 0;
  let achievementsCalls = 0;
  let raiderIoHistoricalRatingCalls = 0;
  let previousSeasonRatingFromCache = false;
  let eliteFromCache = false;
  let ratingEvidenceOriginalSource: "BLIZZARD" | "RAIDERIO_FALLBACK" | null = null;
  let previous: ExperiencePhase1PreviousEvidence = {
    state: "UNAVAILABLE",
    reason: "NOT_ATTEMPTED",
  };
  let elite: { state: "OK"; confirmedCount: number } | { state: "UNAVAILABLE"; reason: string } = {
    state: "UNAVAILABLE",
    reason: "NOT_ATTEMPTED",
  };

  const currentRow = await input.prisma.season.findUnique({
    where: { id: input.currentSeasonId },
    select: {
      id: true,
      regionId: true,
      slug: true,
      blizzardSeasonId: true,
      startsAt: true,
      endsAt: true,
    },
  });

  let regionSeasons: Array<{
    id: string;
    regionId: string | null;
    slug: string;
    blizzardSeasonId: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    metadata: unknown;
    providerSeasonId?: string | null;
  }> = [];
  let previousBinding: ExperienceSeasonBindingCandidate | null = null;

  if (!currentRow) {
    diagnostics.bindingReason = "CURRENT_SEASON_NOT_FOUND";
    diagnostics.previousReason = "CURRENT_SEASON_NOT_FOUND";
    previous = { state: "UNAVAILABLE", reason: "CURRENT_SEASON_NOT_FOUND" };
  } else {
    regionSeasons = currentRow.regionId
      ? await input.prisma.season.findMany({
          where: { regionId: currentRow.regionId },
          select: {
            id: true,
            regionId: true,
            slug: true,
            blizzardSeasonId: true,
            startsAt: true,
            endsAt: true,
            metadata: true,
            providerSeasonId: true,
          },
        })
      : [];

    const binding = resolvePreviousMythicSeason(
      toBindingCandidate(currentRow),
      regionSeasons.map(toBindingCandidate),
    );

    if (!binding.ok) {
      diagnostics.bindingReason = binding.reason;
      diagnostics.previousReason = binding.reason;
      previous = { state: "UNAVAILABLE", reason: binding.reason };
    } else {
      previousBinding = binding.season;
    }
  }

  if (previousBinding) {
    const previousRow = regionSeasons.find((s) => s.id === previousBinding!.id);
    const policyMetadata = readExperiencePopulationPolicyMetadata(
      previousRow?.metadata ?? null,
    );
    const boundRioSlug =
      input.boundPreviousRaiderIoSlug?.trim() ||
      previousRow?.providerSeasonId?.trim() ||
      null;

    let ratingEvidence: PreviousSeasonRatingEvidence | null = null;

    if (store) {
      const cached = await store.find({
        characterId: input.characterId,
        seasonId: previousBinding.id,
        evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
        compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
      });
      if (cached) {
        ratingEvidence = ratingEvidenceFromPersistedRow(cached);
        if (ratingEvidence) {
          previousSeasonRatingFromCache = true;
          diagnostics.ratingSource = "PERSISTED";
          if (
            ratingEvidence.state === "HAS_VALUE" ||
            ratingEvidence.state === "CONFIRMED_NO_ACTIVITY"
          ) {
            ratingEvidenceOriginalSource = ratingEvidence.ratingSource;
          }
        }
      }
    }

    if (!ratingEvidence && input.allowProviderCalls) {
      previousSeasonProfileCalls = 1;
      ratingEvidence = await acquirePreviousSeasonRatingEvidence({
        identity: input.identity,
        previousSeason: previousBinding,
        blizzard: input.blizzard,
        ctx: input.ctx,
        persistProviderResult: input.persistProviderResult,
      });

      if (ratingEvidence.state === "PROVIDER_FAILURE") {
        let rioFallback = resolvePreloadedRioExactSeasonFallback(input);

        // Dedicated exact-season RIO HTTP when no reusable positive preloaded evidence.
        if (
          rioFallback == null &&
          boundRioSlug &&
          input.raiderIoExactSeason &&
          input.allowProviderCalls
        ) {
          try {
            raiderIoHistoricalRatingCalls = 1;
            const rioResult =
              await input.raiderIoExactSeason.getCharacterExactSeasonHistoricalRating(
                input.identity,
                boundRioSlug,
                input.ctx,
              );
            const payloadId = await input.persistProviderResult(rioResult);
            rioFallback = rioEvidenceFromDedicatedResult({
              seasonSlug: boundRioSlug,
              result: rioResult,
              providerPayloadId: payloadId,
            });
          } catch (cause) {
            rioFallback = null;
            diagnostics.previousReason =
              cause instanceof Error
                ? `RIO_EXACT_SEASON_FETCH_FAILED:${cause.message}`
                : "RIO_EXACT_SEASON_FETCH_FAILED";
          }
        } else if (rioFallback == null && !boundRioSlug) {
          diagnostics.previousReason = "BLIZZARD_FAILURE_UNBOUND_RIO_SEASON";
        } else if (
          rioFallback == null &&
          boundRioSlug &&
          !input.raiderIoExactSeason
        ) {
          diagnostics.previousReason = "RIO_EXACT_SEASON_PORT_UNAVAILABLE";
        }

        ratingEvidence = applyExactSeasonRioRatingFallback({
          binding: previousBinding,
          ratingEvidence,
          rio: rioFallback,
        });
        if (
          ratingEvidence.state === "HAS_VALUE" ||
          ratingEvidence.state === "CONFIRMED_NO_ACTIVITY"
        ) {
          diagnostics.ratingSource = ratingEvidence.ratingSource;
          ratingEvidenceOriginalSource = ratingEvidence.ratingSource;
        }
      } else if (
        ratingEvidence.state === "HAS_VALUE" ||
        ratingEvidence.state === "CONFIRMED_NO_ACTIVITY"
      ) {
        diagnostics.ratingSource = ratingEvidence.ratingSource;
        ratingEvidenceOriginalSource = ratingEvidence.ratingSource;
      }

      if (
        store &&
        (ratingEvidence.state === "HAS_VALUE" ||
          ratingEvidence.state === "CONFIRMED_NO_ACTIVITY")
      ) {
        const persistInput = buildPreviousSeasonRatingPersistInput({
          characterId: input.characterId,
          evidence: ratingEvidence,
          raiderIoSeasonSlug:
            boundRioSlug ??
            input.rioExactSeasonFallback?.exactSeasonSlug ??
            input.rioPreviousSeasonCorroboration?.exactSeasonSlug ??
            null,
        });
        if (persistInput) {
          await store.upsertImmutable(persistInput);
        }
      }
    } else if (!ratingEvidence) {
      ratingEvidence = {
        state: "UNRESOLVED",
        reason: input.allowProviderCalls
          ? "PREVIOUS_RATING_UNAVAILABLE"
          : "PREVIOUS_RATING_NOT_PERSISTED",
      };
    }

    const mapped = mapPreviousEvidenceToPhase1Input({
      ratingEvidence,
      policyMetadata,
    });
    previous = mapped.previous;
    diagnostics.previousReason = mapped.reason;
    if (
      !diagnostics.ratingSource &&
      (ratingEvidence.state === "HAS_VALUE" ||
        ratingEvidence.state === "CONFIRMED_NO_ACTIVITY")
    ) {
      diagnostics.ratingSource = ratingEvidence.ratingSource;
      ratingEvidenceOriginalSource = ratingEvidence.ratingSource;
    }

    if (ratingEvidence.state === "HAS_VALUE") {
      diagnostics.historicalRating = ratingEvidence.rating;
      diagnostics.exactHistoricalSeasonSlug = ratingEvidence.seasonSlug;
    } else if (ratingEvidence.state === "CONFIRMED_NO_ACTIVITY") {
      diagnostics.historicalRating = ratingEvidence.rating;
      diagnostics.exactHistoricalSeasonSlug = ratingEvidence.seasonSlug;
    }

    if (policyMetadata) {
      diagnostics.populationPolicyVersion = policyMetadata.policy.version;
    }
    if (previous.state === "STANDING") {
      diagnostics.matchedNativeBand = previous.standing.nativeBand;
      diagnostics.thresholdsUsed = previous.standing.thresholdsUsed;
      diagnostics.populationPolicyVersion = previous.standing.policyVersion;
      diagnostics.exactHistoricalSeasonSlug =
        diagnostics.exactHistoricalSeasonSlug ?? previous.standing.seasonSlug;
    }
  }

  if (store) {
    const cachedElite = await store.find({
      characterId: input.characterId,
      seasonId: input.currentSeasonId,
      evidenceKind: EXPERIENCE_EVIDENCE_KIND.ELITE_CUTOFF_HISTORY,
      compatibilityVersion: ELITE_CUTOFF_CATALOG_VERSION,
    });
    if (cachedElite) {
      const payload = parsePersistedEliteCutoffHistoryPayload(cachedElite.payload);
      if (payload) {
        elite = { state: "OK", confirmedCount: payload.confirmedCount };
        eliteFromCache = true;
      }
    }
  }

  if (!eliteFromCache) {
    if (!input.allowProviderCalls) {
      diagnostics.eliteReason = "ELITE_NOT_PERSISTED";
      elite = { state: "UNAVAILABLE", reason: "ELITE_NOT_PERSISTED" };
    } else {
      achievementsCalls = 1;
      try {
        const achievementsResult: ProviderResult<BlizzardCharacterAchievementsDTO> =
          await input.blizzard.getCharacterAchievements(input.identity, input.ctx);
        const payloadId = await input.persistProviderResult(achievementsResult);
        const eliteHistory = extractEliteCutoffHistory(achievementsResult.data);
        elite = { state: "OK", confirmedCount: eliteHistory.confirmedCount };
        if (store) {
          await store.upsertImmutable(
            buildEliteCutoffHistoryPersistInput({
              characterId: input.characterId,
              currentSeasonId: input.currentSeasonId,
              confirmedCount: eliteHistory.confirmedCount,
              confirmed: eliteHistory.confirmed,
              sourcePayloadId: payloadId,
              sourceRequestFingerprint:
                achievementsResult.metadata.requestFingerprint ?? null,
              fetchedAt:
                achievementsResult.provenance.fetchedAt ||
                achievementsResult.metadata.completedAt ||
                input.ctx.now,
            }),
          );
        }
      } catch (cause) {
        diagnostics.eliteReason =
          cause instanceof Error ? cause.message : "GET_CHARACTER_ACHIEVEMENTS_FAILED";
        elite = {
          state: "UNAVAILABLE",
          reason: diagnostics.eliteReason,
        };
      }
    }
  }

  const experienceBase = calculateExperiencePhase1({
    previous,
    elite,
    previousRegionalClassRank,
  });

  const standingProvenance: ExperiencePhase1StandingProvenance = {
    historicalRating: diagnostics.historicalRating,
    ratingSource:
      diagnostics.ratingSource === "BLIZZARD" ||
      diagnostics.ratingSource === "RAIDERIO_FALLBACK"
        ? diagnostics.ratingSource
        : ratingEvidenceOriginalSource,
    exactHistoricalSeasonSlug: diagnostics.exactHistoricalSeasonSlug,
    populationPolicyVersion: diagnostics.populationPolicyVersion,
    matchedNativeBand: (diagnostics.matchedNativeBand as NativeCutoffBand | null) ?? null,
    thresholdsUsed: diagnostics.thresholdsUsed,
  };

  const experience: ExperiencePhase1Result = {
    ...experienceBase,
    standingProvenance,
  };

  return {
    experience,
    previousSeasonProfileCalls,
    achievementsCalls,
    raiderIoHistoricalRatingCalls,
    previousSeasonRatingFromCache,
    eliteFromCache,
    diagnostics,
  };
}

/** Live/fixture Blizzard permission for Experience — not gated on WCL_ENABLED. */
export function allowExperienceBlizzardProviderCalls(env: {
  ALLOW_LIVE_PROVIDER_CALLS?: boolean;
  PROVIDER_MODE?: string;
  BLIZZARD_ENABLED?: boolean;
}): boolean {
  if (env.BLIZZARD_ENABLED === false) return false;
  if (env.ALLOW_LIVE_PROVIDER_CALLS !== true) return false;
  return env.PROVIDER_MODE === "live" || env.PROVIDER_MODE === "fixture";
}
