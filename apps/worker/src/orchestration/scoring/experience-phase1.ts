/**
 * Experience Phase 1 — production evidence acquisition for refresh scoring.
 *
 * Historical standing (Agent 03C):
 *   Reuses 03B Blizzard HistoricalSeasonRating evidence + 03A COMPLETE
 *   population policies. MAX of contextualized native-band scores.
 *   Does NOT call Blizzard Season Details or Raider.IO character historical
 *   ratings (03B is the sole historical-rating acquisition path).
 *
 * Elite titles still use Blizzard achievements (cached).
 * Failures degrade Experience only.
 */

import type {
  BlizzardCharacterAchievementsDTO,
  BlizzardProvider,
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoExactSeasonHistoricalRating,
  RegionCode,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import {
  calculateExperiencePhase1,
  computeHistoricalStanding,
  estimatePreviousSeasonStanding,
  extractEliteCutoffHistory,
  usablePreviousRegionalClassRank,
  ELITE_CUTOFF_CATALOG_VERSION,
  type ExperiencePhase1PreviousEvidence,
  type ExperiencePhase1Result,
  type ExperiencePhase1StandingProvenance,
  type HistoricalStandingProof,
  type NativeCutoffBand,
  type NativeCutoffQuantile,
  type SeasonPopulationPolicy,
} from "@mplus/scoring";
import {
  exactSeasonScoreFromRioProfile,
  type CanonicalPreviousSeasonBinding,
  type PersistProviderResultFn,
  type PreviousSeasonRatingEvidence,
  type RioExactSeasonScoreEvidence,
  type RioPreviousSeasonCorroboration,
} from "./experience-previous-season-evidence.js";
import { readExperiencePopulationPolicyMetadata } from "./experience-season-population-policy-metadata.js";
import {
  EXPERIENCE_EVIDENCE_KIND,
  buildEliteCutoffHistoryPersistInput,
  parsePersistedEliteCutoffHistoryPayload,
  type ExperienceEvidenceStore,
} from "./experience-evidence-persist.js";
import {
  listHistoricalSeasonRatingsFromStore,
  type HistoricalSeasonRating,
} from "./experience-blizzard-season-history.js";

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
   * Optional already-resolved exact-season RIO evidence (legacy seam; unused for
   * historical standing after Agent 03C).
   */
  rioExactSeasonFallback?: RioExactSeasonScoreEvidence | null;
  /**
   * @deprecated Prefer dedicated raiderIoExactSeason acquisition.
   */
  rioPreviousSeasonCorroboration?: RioPreviousSeasonCorroboration | null;
  /**
   * Optional pre-resolved canonical previous binding (legacy; unused for standing).
   */
  canonicalPreviousBinding?: CanonicalPreviousSeasonBinding | null;
  /**
   * Bound previous Raider.IO season slug — unused for historical standing.
   */
  boundPreviousRaiderIoSlug?: string | null;
  /**
   * Dedicated exact-season RIO historical rating port.
   * Unused for 03C historical standing (zero RIO character historical calls).
   */
  raiderIoExactSeason?: ExperiencePhase1RaiderIoExactSeasonPort | null;
  /**
   * Optional preloaded historical ratings (tests). When omitted, loaded from store.
   */
  historicalRatingsOverride?: HistoricalSeasonRating[] | null;
}

export type ExperiencePhase1RaiderIoExactSeasonPort = {
  getCharacterExactSeasonHistoricalRating: (
    identity: CharacterIdentityInput,
    seasonSlug: string,
    ctx: ProviderFetchContext,
  ) => Promise<ProviderResult<RaiderIoExactSeasonHistoricalRating>>;
};

export interface BuildExperiencePhase1Result {
  experience: ExperiencePhase1Result;
  /**
   * Legacy counter — always 0 after Agent 03C (03B owns Season Details).
   * Kept so callers/tests can assert no duplicate previous-season fetch.
   */
  previousSeasonProfileCalls: number;
  /** Blizzard getCharacterAchievements invocations (0 or 1). */
  achievementsCalls: number;
  /** Always 0 for historical standing (Agent 03C). */
  raiderIoHistoricalRatingCalls: number;
  /** True when historical standing came from durable evidence. */
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
    thresholdsUsed: Array<{ quantile: NativeCutoffQuantile; score: number }> | null;
    contextualizedHistoricalSeasonCount: number;
    uncontextualizedHistoricalSeasonCount: number;
    winningHistoricalProof: HistoricalStandingProof | null;
  };
}

/**
 * Map Agent 03 rating evidence + persisted population policy into calculator previous input.
 * Provider failure / missing policy / estimate failure → UNAVAILABLE (never score 0).
 * @deprecated Prefer computeHistoricalStanding for multi-season Experience (03C).
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

/** Build RIO corroboration/fallback input from an already-fetched profile (no extra call). */
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

async function loadPoliciesForHistoricalSeasons(input: {
  prisma: Pick<PrismaClient, "season">;
  ratings: HistoricalSeasonRating[];
}): Promise<Map<string, SeasonPopulationPolicy | null>> {
  const policyBySeasonId = new Map<string, SeasonPopulationPolicy | null>();
  const ids = [...new Set(input.ratings.map((r) => r.seasonId))];
  if (ids.length === 0) return policyBySeasonId;

  const rows = await input.prisma.season.findMany({
    where: { id: { in: ids } },
    select: { id: true, metadata: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const meta = readExperiencePopulationPolicyMetadata(byId.get(id)?.metadata ?? null);
    policyBySeasonId.set(id, meta?.policy ?? null);
  }
  return policyBySeasonId;
}

function previousFromHistoricalStanding(computation: ReturnType<typeof computeHistoricalStanding>): {
  previous: ExperiencePhase1PreviousEvidence;
  reason: string | null;
  winning: HistoricalStandingProof | null;
} {
  if (computation.winning) {
    return {
      previous: { state: "STANDING", standing: computation.winning.standing },
      reason: null,
      winning: computation.winning,
    };
  }
  // Season-level CONFIRMED_NO_ACTIVITY rows are neutral facts only — they do NOT
  // prove whole-history absence (03B: index absence = UNKNOWN). Without HAS_VALUE
  // + COMPLETE policy proofs, historical standing is unavailable (not E=0).
  if (computation.uncontextualized.length > 0) {
    return {
      previous: {
        state: "UNAVAILABLE",
        reason: "NO_CONTEXTUALIZED_HISTORICAL_STANDING",
      },
      reason: "NO_CONTEXTUALIZED_HISTORICAL_STANDING",
      winning: null,
    };
  }
  if (computation.confirmedNoActivityOnly) {
    return {
      previous: {
        state: "UNAVAILABLE",
        reason: "NO_SCOREABLE_HISTORICAL_STANDING",
      },
      reason: "NO_SCOREABLE_HISTORICAL_STANDING",
      winning: null,
    };
  }
  return {
    previous: { state: "UNAVAILABLE", reason: "NO_HISTORICAL_RATING_EVIDENCE" },
    reason: "NO_HISTORICAL_RATING_EVIDENCE",
    winning: null,
  };
}

/**
 * Acquire Experience Phase 1 evidence and compute the pure calculator result.
 *
 * Historical standing: durable 03B evidence only (0 Season Details / 0 RIO
 * character historical calls from this function).
 * Elite: at most 1 achievements call when not cached.
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
    thresholdsUsed: null as Array<{ quantile: NativeCutoffQuantile; score: number }> | null,
    contextualizedHistoricalSeasonCount: 0,
    uncontextualizedHistoricalSeasonCount: 0,
    winningHistoricalProof: null as HistoricalStandingProof | null,
  };
  const previousRegionalClassRank = input.previousRegionalClassRank ?? null;
  const store = input.evidenceStore ?? null;

  const previousSeasonProfileCalls = 0;
  let achievementsCalls = 0;
  const raiderIoHistoricalRatingCalls = 0;
  let previousSeasonRatingFromCache = false;
  let eliteFromCache = false;
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
    select: { id: true, regionId: true },
  });

  if (!currentRow) {
    diagnostics.bindingReason = "CURRENT_SEASON_NOT_FOUND";
    diagnostics.previousReason = "CURRENT_SEASON_NOT_FOUND";
    previous = { state: "UNAVAILABLE", reason: "CURRENT_SEASON_NOT_FOUND" };
  } else {
    const ratings =
      input.historicalRatingsOverride ??
      (store
        ? await listHistoricalSeasonRatingsFromStore(store, input.characterId, {
            prisma: input.prisma,
          })
        : []);

    if (ratings.length > 0) {
      previousSeasonRatingFromCache = true;
      diagnostics.ratingSource = "PERSISTED";
    }

    const policyBySeasonId = await loadPoliciesForHistoricalSeasons({
      prisma: input.prisma,
      ratings,
    });
    const computation = computeHistoricalStanding({
      ratings,
      policyBySeasonId,
      regionCode: input.regionCode,
    });
    diagnostics.contextualizedHistoricalSeasonCount = computation.proofs.length;
    diagnostics.uncontextualizedHistoricalSeasonCount =
      computation.uncontextualized.length;

    const mapped = previousFromHistoricalStanding(computation);
    previous = mapped.previous;
    diagnostics.previousReason = mapped.reason;
    diagnostics.winningHistoricalProof = mapped.winning;

    if (mapped.winning) {
      diagnostics.historicalRating = mapped.winning.rating;
      diagnostics.exactHistoricalSeasonSlug =
        mapped.winning.policySeasonSlug || mapped.winning.seasonSlug;
      diagnostics.populationPolicyVersion = mapped.winning.populationPolicyVersion;
      diagnostics.matchedNativeBand = mapped.winning.nativeBand;
      diagnostics.thresholdsUsed = mapped.winning.thresholdsUsed;
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
    winningHistoricalProof: diagnostics.winningHistoricalProof,
    contextualizedHistoricalSeasonCount:
      diagnostics.contextualizedHistoricalSeasonCount,
  });

  const standingProvenance: ExperiencePhase1StandingProvenance = {
    historicalRating: diagnostics.historicalRating,
    ratingSource: "BLIZZARD",
    exactHistoricalSeasonSlug: diagnostics.exactHistoricalSeasonSlug,
    populationPolicyVersion: diagnostics.populationPolicyVersion,
    matchedNativeBand: (diagnostics.matchedNativeBand as NativeCutoffBand | null) ?? null,
    thresholdsUsed: diagnostics.thresholdsUsed,
    acquisitionReason: diagnostics.previousReason,
    winningSeasonId: diagnostics.winningHistoricalProof?.seasonId ?? null,
    winningSeasonSlug:
      diagnostics.winningHistoricalProof?.policySeasonSlug ??
      diagnostics.winningHistoricalProof?.seasonSlug ??
      null,
    winningBlizzardSeasonId:
      diagnostics.winningHistoricalProof?.blizzardSeasonId ?? null,
    contextualizedHistoricalSeasonCount:
      diagnostics.contextualizedHistoricalSeasonCount,
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
