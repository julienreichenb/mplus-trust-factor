/**
 * Fail-fast character refresh eligibility barrier.
 *
 * Runs after contract preflight and before any provider calls, provider-state
 * mutation, run ingestion, metric writes, or WCL budget use.
 *
 * Uses only persisted authoritative character data — never calls external providers
 * merely to discover whether the refresh should have been blocked.
 *
 * Evidence sources (season-scoped only):
 * - verified_character_ownerships.current_season_mythic_rating
 *   where current_season_mythic_season_id = authoritative Season.id
 * - metric_observations.raw_value for experience.mythic_rating
 *   where season_id = authoritative Season.id
 * - character_snapshots.mythic_rating where raw_summary.eligibility.authoritativeSeasonId
 *   equals authoritative Season.id
 *
 * Unscoped CharacterSnapshot.mythicRating alone never qualifies.
 * Behavior is identical for live / fixture / mock / inline / BullMQ.
 */
import type { Logger } from "@mplus/observability";
import type { PrismaClient } from "@mplus/database";
import {
  buildCharacterRefreshEligibilityPolicy,
  evaluateCharacterRefreshEligibility,
  getConfiguredMaxCharacterLevel,
  type CharacterRefreshEligibilityCode,
  type CharacterRefreshEligibilityResult,
} from "@mplus/config";
import type { VerifiedSeasonAuthority } from "./season-authority.js";

export const REFRESH_ELIGIBILITY_GATE_EVENT = "refresh_eligibility_gate";

/** Persisted on CharacterSnapshot.rawSummary when season identity is known. */
export const SNAPSHOT_ELIGIBILITY_SEASON_KEY = "eligibility" as const;

export class RefreshEligibilityError extends Error {
  readonly code: CharacterRefreshEligibilityCode;
  readonly retryable = false;
  readonly providerFailure = false;
  readonly stage = "eligibility" as const;
  readonly providerCalls = 0;
  readonly result: CharacterRefreshEligibilityResult;

  constructor(result: CharacterRefreshEligibilityResult) {
    super(result.message ?? "Character is not refresh-eligible");
    this.name = "RefreshEligibilityError";
    this.code = result.code ?? "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN";
    this.result = result;
  }

  toJobError(): {
    code: CharacterRefreshEligibilityCode;
    message: string;
    retryable: false;
    providerFailure: false;
    stage: "eligibility";
    maxCharacterLevel: number;
    policyVersion: string;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: false,
      providerFailure: false,
      stage: "eligibility",
      maxCharacterLevel: this.result.maxCharacterLevel,
      policyVersion: this.result.policyVersion,
    };
  }
}

export function isRefreshEligibilityError(error: unknown): error is RefreshEligibilityError {
  if (error instanceof RefreshEligibilityError) return true;
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === "CHARACTER_BELOW_MAX_LEVEL" ||
    code === "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE" ||
    code === "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN"
  );
}

export interface RefreshEligibilityGateDeps {
  prisma: PrismaClient;
  logger: Logger;
  /** Optional AppEnv.MAX_CHARACTER_LEVEL override. */
  maxCharacterLevel?: number;
}

function readSeasonTaggedSnapshotEvidence(
  rawSummary: unknown,
  mythicRating: number | null,
  authoritativeSeasonRowId: string,
): "HAS_SCORE" | "CONFIRMED_NO_SCORE" | null {
  if (mythicRating == null || !Number.isFinite(mythicRating)) return null;
  if (!rawSummary || typeof rawSummary !== "object" || Array.isArray(rawSummary)) return null;
  const eligibility = (rawSummary as Record<string, unknown>)[SNAPSHOT_ELIGIBILITY_SEASON_KEY];
  if (!eligibility || typeof eligibility !== "object" || Array.isArray(eligibility)) return null;
  const seasonId = (eligibility as { authoritativeSeasonId?: unknown }).authoritativeSeasonId;
  if (typeof seasonId !== "string" || seasonId !== authoritativeSeasonRowId) return null;
  const confirmedNoScore = (eligibility as { confirmedNoScore?: unknown }).confirmedNoScore === true;
  if (confirmedNoScore || mythicRating <= 0) return "CONFIRMED_NO_SCORE";
  return "HAS_SCORE";
}

/**
 * Load persisted eligibility signals for a character against verified season authority.
 * Never contacts Blizzard / Raider.IO / WCL.
 *
 * Tri-state current-season Mythic+ evidence (Problem 1 / scoring-stabilization):
 * - positive finite rating → number (HAS_SCORE)
 * - season-tagged confirmed absence (0 / confirmedNoScore) → null (CONFIRMED_NO_SCORE)
 * - no season-scoped evidence row → undefined (UNKNOWN / repairable)
 */
export async function loadCharacterRefreshEligibilitySignals(
  prisma: PrismaClient,
  input: {
    characterId: string | null | undefined;
    authority: VerifiedSeasonAuthority | null;
  },
): Promise<{
  characterLevel: number | null;
  currentSeasonMythicScore: number | null | undefined;
  authoritativeSeasonKnown: boolean;
  evidenceSource: "ownership" | "metric_observation" | "season_tagged_snapshot" | null;
}> {
  if (!input.characterId) {
    return {
      characterLevel: null,
      currentSeasonMythicScore: undefined,
      authoritativeSeasonKnown: Boolean(input.authority),
      evidenceSource: null,
    };
  }

  const character = await prisma.character.findUnique({
    where: { id: input.characterId },
    select: { id: true, level: true, regionId: true },
  });

  if (!character) {
    return {
      characterLevel: null,
      currentSeasonMythicScore: undefined,
      authoritativeSeasonKnown: Boolean(input.authority),
      evidenceSource: null,
    };
  }

  const authority = input.authority;
  if (!authority) {
    return {
      characterLevel: character.level,
      currentSeasonMythicScore: undefined,
      authoritativeSeasonKnown: false,
      evidenceSource: null,
    };
  }

  const ownership = await prisma.verifiedCharacterOwnership.findFirst({
    where: {
      characterId: character.id,
      currentSeasonMythicSeasonId: authority.seasonRowId,
      currentSeasonMythicRating: { not: null },
    },
    orderBy: { currentSeasonMythicFetchedAt: "desc" },
    select: {
      currentSeasonMythicRating: true,
      currentSeasonMythicSeasonId: true,
    },
  });

  if (ownership?.currentSeasonMythicRating != null) {
    const rating = ownership.currentSeasonMythicRating;
    return {
      characterLevel: character.level,
      // 0 is explicit confirmed absence for this season; positive is HAS_SCORE.
      currentSeasonMythicScore: rating > 0 ? rating : null,
      authoritativeSeasonKnown: true,
      evidenceSource: "ownership",
    };
  }

  const observation = await prisma.metricObservation.findFirst({
    where: {
      characterId: character.id,
      seasonId: authority.seasonRowId,
      metricDefinition: { key: "experience.mythic_rating" },
      rawValue: { not: null },
    },
    orderBy: { observedAt: "desc" },
    select: { rawValue: true },
  });

  if (observation?.rawValue != null) {
    const rating = Number(observation.rawValue);
    return {
      characterLevel: character.level,
      currentSeasonMythicScore: rating > 0 ? rating : null,
      authoritativeSeasonKnown: true,
      evidenceSource: "metric_observation",
    };
  }

  const snapshots = await prisma.characterSnapshot.findMany({
    where: { characterId: character.id, mythicRating: { not: null } },
    orderBy: { capturedAt: "desc" },
    take: 20,
    select: { mythicRating: true, rawSummary: true },
  });
  for (const snap of snapshots) {
    const tagged = readSeasonTaggedSnapshotEvidence(
      snap.rawSummary,
      snap.mythicRating,
      authority.seasonRowId,
    );
    if (tagged === "HAS_SCORE") {
      return {
        characterLevel: character.level,
        currentSeasonMythicScore: snap.mythicRating!,
        authoritativeSeasonKnown: true,
        evidenceSource: "season_tagged_snapshot",
      };
    }
    if (tagged === "CONFIRMED_NO_SCORE") {
      return {
        characterLevel: character.level,
        currentSeasonMythicScore: null,
        authoritativeSeasonKnown: true,
        evidenceSource: "season_tagged_snapshot",
      };
    }
  }

  // No season-scoped evidence → UNKNOWN (repairable). Never invent confirmed absence.
  return {
    characterLevel: character.level,
    currentSeasonMythicScore: undefined,
    authoritativeSeasonKnown: true,
    evidenceSource: null,
  };
}

/**
 * Persist cheap season-scoped eligibility evidence (API/resolve/discovery — not the worker gate).
 *
 * UNKNOWN must not write a rating row (preserves prior evidence).
 * CONFIRMED_NO_SCORE writes season-tagged 0 + confirmedNoScore.
 * HAS_SCORE writes a positive season-tagged snapshot.
 */
export async function persistRefreshEligibilityEvidence(
  prisma: PrismaClient,
  input: {
    characterId: string;
    level: number | null;
    /** Successful bootstrap rating; null = provider proved no score for the season. */
    mythicRating: number | null;
    authoritativeSeasonRowId: string;
    /**
     * When true, this call is UNKNOWN (provider failure) — do not persist absence.
     * Prefer omitting the persist call entirely for UNKNOWN; this flag is defense-in-depth.
     */
    unknown?: boolean;
  },
): Promise<void> {
  if (input.level != null) {
    await prisma.character.update({
      where: { id: input.characterId },
      data: { level: input.level },
    });
  }
  if (input.unknown) return;

  const hasScore =
    input.mythicRating != null &&
    Number.isFinite(input.mythicRating) &&
    input.mythicRating > 0;

  await prisma.characterSnapshot.create({
    data: {
      characterId: input.characterId,
      capturedAt: new Date(),
      mythicRating: hasScore ? input.mythicRating : 0,
      rawSummary: {
        [SNAPSHOT_ELIGIBILITY_SEASON_KEY]: {
          authoritativeSeasonId: input.authoritativeSeasonRowId,
          confirmedNoScore: !hasScore,
        },
      },
    },
  });
}

/**
 * Evaluate eligibility after contract preflight. Throws RefreshEligibilityError on block.
 * Identical fail-closed behavior for every provider / queue mode — no UNKNOWN bypass.
 */
export async function runRefreshEligibilityGate(
  deps: RefreshEligibilityGateDeps,
  input: {
    characterId: string | null | undefined;
    authority: VerifiedSeasonAuthority | null;
    jobId: string;
    triggerSource?: string | null;
  },
): Promise<CharacterRefreshEligibilityResult> {
  if (!input.authority) {
    const maxCharacterLevel = getConfiguredMaxCharacterLevel(deps.maxCharacterLevel);
    const policy = buildCharacterRefreshEligibilityPolicy(deps.maxCharacterLevel);
    const result: CharacterRefreshEligibilityResult = {
      eligible: false,
      code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
      message: "Authoritative current season is unknown — refusing refresh (fail closed)",
      maxCharacterLevel,
      policyVersion: policy.version,
    };
    deps.logger.info(
      {
        event: REFRESH_ELIGIBILITY_GATE_EVENT,
        stage: "eligibility",
        jobId: input.jobId,
        characterId: input.characterId ?? null,
        eligible: false,
        code: result.code,
        providerCalls: 0,
      },
      "refresh eligibility gate blocked — missing season authority",
    );
    throw new RefreshEligibilityError(result);
  }

  const signals = await loadCharacterRefreshEligibilitySignals(deps.prisma, {
    characterId: input.characterId,
    authority: input.authority,
  });

  const policy = buildCharacterRefreshEligibilityPolicy(deps.maxCharacterLevel);
  const result = evaluateCharacterRefreshEligibility(signals, policy);

  deps.logger.info(
    {
      event: REFRESH_ELIGIBILITY_GATE_EVENT,
      stage: "eligibility",
      jobId: input.jobId,
      characterId: input.characterId ?? null,
      triggerSource: input.triggerSource ?? "UNKNOWN",
      eligible: result.eligible,
      code: result.code,
      characterLevel: signals.characterLevel,
      currentSeasonMythicScore: signals.currentSeasonMythicScore ?? null,
      maxCharacterLevel: result.maxCharacterLevel,
      authoritativeSeasonSlug: input.authority.slug,
      evidenceSource: signals.evidenceSource,
      providerCalls: 0,
    },
    result.eligible ? "refresh eligibility gate ok" : "refresh eligibility gate blocked",
  );

  if (!result.eligible) {
    throw new RefreshEligibilityError(result);
  }

  return result;
}
