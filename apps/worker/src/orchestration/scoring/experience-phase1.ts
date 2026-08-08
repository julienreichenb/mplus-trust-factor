/**
 * Experience Phase 1 — production evidence acquisition for refresh scoring.
 *
 * Builds an ExperiencePhase1Result from Blizzard previous-season rating +
 * persisted Season population policy + character achievements + optional
 * previous-season regional class rank (from the existing Raider.IO profile).
 * Never calls WCL or per-character season cutoffs. Failures degrade Experience only.
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
  type ExperiencePhase1PreviousEvidence,
  type ExperiencePhase1Result,
} from "@mplus/scoring";
import {
  acquirePreviousSeasonRatingEvidence,
  resolvePreviousMythicSeason,
  type ExperienceSeasonBindingCandidate,
  type PersistProviderResultFn,
  type PreviousSeasonRatingEvidence,
} from "./experience-previous-season-evidence.js";
import { readExperiencePopulationPolicyMetadata } from "./experience-season-population-policy-metadata.js";

export type ExperiencePhase1BlizzardPort = Pick<
  BlizzardProvider,
  "getMythicKeystoneSeasonProfile" | "getCharacterAchievements"
>;

export interface BuildExperiencePhase1Input {
  prisma: Pick<PrismaClient, "season">;
  identity: CharacterIdentityInput;
  /** Internal Season.id for the character's current scoring season. */
  currentSeasonId: string;
  regionCode: RegionCode;
  blizzard: ExperiencePhase1BlizzardPort;
  ctx: ProviderFetchContext;
  persistProviderResult: PersistProviderResultFn;
  /**
   * When false, skip all Blizzard Experience calls and return unavailable Experience
   * (unless elite/previous can be derived without network — they cannot).
   */
  allowProviderCalls: boolean;
  /**
   * Previous-season regional class rank from the already-fetched Raider.IO profile
   * (`previousRanks.classRank.region`). Not fetched here — no extra RIO call.
   */
  previousRegionalClassRank?: number | null;
}

export interface BuildExperiencePhase1Result {
  experience: ExperiencePhase1Result;
  /** Blizzard getMythicKeystoneSeasonProfile invocations (0 or 1). */
  previousSeasonProfileCalls: number;
  /** Blizzard getCharacterAchievements invocations (0 or 1). */
  achievementsCalls: number;
  /** Diagnostic reasons for degraded previous / elite paths. */
  diagnostics: {
    previousReason: string | null;
    eliteReason: string | null;
    bindingReason: string | null;
  };
}

function unavailableExperience(
  reason?: string,
  previousRegionalClassRank?: number | null,
): ExperiencePhase1Result {
  return calculateExperiencePhase1({
    previous: { state: "UNAVAILABLE", reason },
    elite: { confirmedCount: 0 },
    previousRegionalClassRank,
  });
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

/** Extract usable previous-season regional class rank from a RIO profile. */
export function previousRegionalClassRankFromRioProfile(
  profile:
    | {
        previousRanks?: Parameters<typeof usablePreviousRegionalClassRank>[0];
      }
    | null
    | undefined,
): number | null {
  if (profile == null) return null;
  return usablePreviousRegionalClassRank(profile.previousRanks ?? null);
}

/**
 * Acquire Experience Phase 1 evidence and compute the pure calculator result.
 * At most 1 previous-season profile + 1 achievements Blizzard call.
 * No WCL / no per-character season-cutoff. Class rank is caller-supplied from
 * the existing Raider.IO profile (no extra RIO call here).
 */
export async function buildExperiencePhase1Result(
  input: BuildExperiencePhase1Input,
): Promise<BuildExperiencePhase1Result> {
  const diagnostics = {
    previousReason: null as string | null,
    eliteReason: null as string | null,
    bindingReason: null as string | null,
  };
  const previousRegionalClassRank = input.previousRegionalClassRank ?? null;

  if (!input.allowProviderCalls) {
    return {
      experience: unavailableExperience(
        "PROVIDER_CALLS_DISABLED",
        previousRegionalClassRank,
      ),
      previousSeasonProfileCalls: 0,
      achievementsCalls: 0,
      diagnostics: {
        ...diagnostics,
        previousReason: "PROVIDER_CALLS_DISABLED",
        eliteReason: "PROVIDER_CALLS_DISABLED",
      },
    };
  }

  let previousSeasonProfileCalls = 0;
  let achievementsCalls = 0;
  let previous: ExperiencePhase1PreviousEvidence = {
    state: "UNAVAILABLE",
    reason: "NOT_ATTEMPTED",
  };
  let confirmedEliteCount = 0;

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

  if (!currentRow) {
    diagnostics.bindingReason = "CURRENT_SEASON_NOT_FOUND";
    diagnostics.previousReason = "CURRENT_SEASON_NOT_FOUND";
  } else {
    const regionSeasons = currentRow.regionId
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
      // No previous Blizzard call when binding cannot resolve safely.
    } else {
      previousSeasonProfileCalls = 1;
      const ratingEvidence = await acquirePreviousSeasonRatingEvidence({
        identity: input.identity,
        previousSeason: binding.season,
        blizzard: input.blizzard,
        ctx: input.ctx,
        persistProviderResult: input.persistProviderResult,
      });

      const previousRow = regionSeasons.find((s) => s.id === binding.season.id);
      const policyMetadata = readExperiencePopulationPolicyMetadata(
        previousRow?.metadata ?? null,
      );

      const mapped = mapPreviousEvidenceToPhase1Input({
        ratingEvidence,
        policyMetadata,
      });
      previous = mapped.previous;
      diagnostics.previousReason = mapped.reason;
    }
  }

  // Achievements: always attempt once when providers are allowed (independent of previous).
  achievementsCalls = 1;
  try {
    const achievementsResult: ProviderResult<BlizzardCharacterAchievementsDTO> =
      await input.blizzard.getCharacterAchievements(input.identity, input.ctx);
    await input.persistProviderResult(achievementsResult);
    const elite = extractEliteCutoffHistory(achievementsResult.data);
    confirmedEliteCount = elite.confirmedCount;
  } catch (cause) {
    diagnostics.eliteReason =
      cause instanceof Error ? cause.message : "GET_CHARACTER_ACHIEVEMENTS_FAILED";
    confirmedEliteCount = 0;
  }

  const experience = calculateExperiencePhase1({
    previous,
    elite: { confirmedCount: confirmedEliteCount },
    previousRegionalClassRank,
  });

  return {
    experience,
    previousSeasonProfileCalls,
    achievementsCalls,
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
