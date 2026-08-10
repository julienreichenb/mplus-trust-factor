/**
 * Canonical public-character resolve/discover/bootstrap.
 *
 * Production callers (API exact resolve, scoring smoke, future entry points) must
 * use this for unknown or incomplete public identities. The worker eligibility
 * gate stays provider-free and only reads persisted evidence.
 */
import { randomUUID } from "node:crypto";
import type { Character, PrismaClient } from "@mplus/database";
import type {
  BlizzardProvider,
  CanonicalCharacter,
  CharacterIdentityInput,
  ProviderFetchContext,
} from "@mplus/contracts";
import { ExternalApiError } from "@mplus/contracts";
import type { CharacterRepository } from "../persistence/character-repository.js";
import {
  loadCharacterRefreshEligibilitySignals,
  persistRefreshEligibilityEvidence,
  type CurrentSeasonMythicPersistEvidence,
} from "./refresh-eligibility-gate.js";
import type { VerifiedSeasonAuthority } from "./season-authority.js";
import { backfillCharacterRunDigestLinks } from "./character-run-digest-backfill.js";

/** Same completeness predicate as API exact-resolve repair (commit 4a7f176). */
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

/**
 * Authoritative current-season Mythic+ acquisition outcome.
 * Provider failure must NEVER collapse into confirmed no-score.
 */
export type CurrentSeasonMythicEvidence =
  | { state: "HAS_SCORE"; rating: number }
  | { state: "CONFIRMED_NO_SCORE" }
  | { state: "UNKNOWN"; error: ExternalApiError };

export const CURRENT_SEASON_EVIDENCE_REUSED = "CURRENT_SEASON_EVIDENCE_REUSED" as const;
export const CURRENT_SEASON_EVIDENCE_REPAIRED = "CURRENT_SEASON_EVIDENCE_REPAIRED" as const;
export const CURRENT_SEASON_CONFIRMED_NO_SCORE = "CURRENT_SEASON_CONFIRMED_NO_SCORE" as const;
export const CURRENT_SEASON_EVIDENCE_PROVIDER_FAILURE =
  "CURRENT_SEASON_EVIDENCE_PROVIDER_FAILURE" as const;

export type CurrentSeasonEvidenceOutcome =
  | typeof CURRENT_SEASON_EVIDENCE_REUSED
  | typeof CURRENT_SEASON_EVIDENCE_REPAIRED
  | typeof CURRENT_SEASON_CONFIRMED_NO_SCORE
  | typeof CURRENT_SEASON_EVIDENCE_PROVIDER_FAILURE;

export type BlizzardPublicBootstrapFetch =
  | {
      ok: true;
      profile: CanonicalCharacter;
      currentSeasonMythic: CurrentSeasonMythicEvidence;
      /** @deprecated Prefer currentSeasonMythic — finite rating only when HAS_SCORE. */
      mythicRating: number | null;
      providerCalls: number;
    }
  | { ok: false; error: ExternalApiError; providerCalls: number };

export function currentSeasonMythicToPersistEvidence(
  evidence: CurrentSeasonMythicEvidence,
): CurrentSeasonMythicPersistEvidence {
  if (evidence.state === "HAS_SCORE") {
    return { state: "HAS_SCORE", rating: evidence.rating };
  }
  if (evidence.state === "CONFIRMED_NO_SCORE") {
    return { state: "CONFIRMED_NO_SCORE" };
  }
  return { state: "UNKNOWN" };
}

function classifyKeystoneRating(rating: number | null | undefined): CurrentSeasonMythicEvidence {
  if (rating != null && Number.isFinite(rating) && rating > 0) {
    return { state: "HAS_SCORE", rating };
  }
  return { state: "CONFIRMED_NO_SCORE" };
}

/**
 * Bounded Blizzard profile + keystone reads (exact resolve / smoke bootstrap).
 * Does not invent eligibility evidence on NOT_FOUND.
 * Keystone failure is UNKNOWN — never collapsed to confirmed no-score.
 */
export async function fetchBlizzardPublicBootstrap(
  blizzard: BlizzardProvider,
  identity: CharacterIdentityInput,
  opts: { correlationId?: string | null; forceRefresh?: boolean } = {},
): Promise<BlizzardPublicBootstrapFetch> {
  const ctx: ProviderFetchContext = {
    region: identity.region,
    requestId: opts.correlationId ?? randomUUID(),
    correlationId: opts.correlationId ?? null,
    forceRefresh: opts.forceRefresh ?? true,
    now: new Date().toISOString(),
  };
  let providerCalls = 0;
  try {
    const profileResult = await blizzard.getCharacterProfile(identity, ctx);
    providerCalls += 1;
    let currentSeasonMythic: CurrentSeasonMythicEvidence;
    try {
      const keystone = await blizzard.getMythicKeystoneProfile(identity, ctx);
      providerCalls += 1;
      currentSeasonMythic = classifyKeystoneRating(keystone.data.currentMythicRating);
    } catch (error) {
      // Count the attempted keystone call even when it fails.
      providerCalls += 1;
      const apiError =
        error instanceof ExternalApiError
          ? error
          : new ExternalApiError({
              message: error instanceof Error ? error.message : "Blizzard keystone failed",
              code: "UNKNOWN",
              provider: "blizzard",
              retryable: true,
            });
      currentSeasonMythic = { state: "UNKNOWN", error: apiError };
    }
    return {
      ok: true,
      profile: profileResult.data,
      currentSeasonMythic,
      mythicRating:
        currentSeasonMythic.state === "HAS_SCORE" ? currentSeasonMythic.rating : null,
      providerCalls,
    };
  } catch (error) {
    if (error instanceof ExternalApiError) {
      return { ok: false, error, providerCalls };
    }
    return {
      ok: false,
      error: new ExternalApiError({
        message: error instanceof Error ? error.message : "Blizzard bootstrap failed",
        code: "UNKNOWN",
        provider: "blizzard",
        retryable: true,
      }),
      providerCalls,
    };
  }
}

/** Persist profile metadata + season-tagged Mythic+ evidence (resolve / smoke). */
export async function persistPublicCharacterBootstrap(input: {
  prisma: PrismaClient;
  characterRepository: Pick<CharacterRepository, "applyProviderProfile" | "findById">;
  character: Character;
  profile: CanonicalCharacter;
  currentSeasonMythic: CurrentSeasonMythicEvidence;
  /** @deprecated Prefer currentSeasonMythic. */
  mythicRating?: number | null;
  authority: VerifiedSeasonAuthority;
}): Promise<Character> {
  const updated = await input.characterRepository.applyProviderProfile(
    input.character.id,
    input.profile,
  );
  await persistRefreshEligibilityEvidence(input.prisma, {
    characterId: updated.id,
    level: input.profile.level ?? updated.level ?? null,
    currentSeasonMythic: currentSeasonMythicToPersistEvidence(input.currentSeasonMythic),
    authoritativeSeasonRowId: input.authority.seasonRowId,
  });
  const character =
    (await input.characterRepository.findById(updated.id)) ?? updated;
  // After bootstrap evidence is durable, associate any companion digests that
  // already exist for this provider-native identity (no Blizzard companion fan-out).
  await backfillCharacterRunDigestLinks({
    prisma: input.prisma,
    characterId: character.id,
  });
  return character;
}

export type ResolveOrDiscoverPublicCharacterResult = {
  character: Character;
  bootstrapPerformed: boolean;
  providerCalls: number;
  reason: "created" | "repaired" | "already_complete";
  currentSeasonEvidenceOutcome?: CurrentSeasonEvidenceOutcome;
};

/**
 * Canonical production operation:
 * lookup Character → reuse when complete + season evidence known →
 * Blizzard discover/repair when absent/incomplete/missing season evidence.
 *
 * Never creates an empty shell before Blizzard succeeds. On failure after a fresh
 * create, compensates by deleting an unreferenced shell when possible.
 */
export async function resolveOrDiscoverPublicCharacter(input: {
  prisma: PrismaClient;
  characterRepository: CharacterRepository;
  blizzard: BlizzardProvider;
  identity: CharacterIdentityInput;
  authority: VerifiedSeasonAuthority;
  correlationId?: string | null;
}): Promise<ResolveOrDiscoverPublicCharacterResult> {
  const existing = await input.characterRepository.findByIdentity(input.identity);

  if (existing && !characterLacksBootstrapEvidence(existing)) {
    const signals = await loadCharacterRefreshEligibilitySignals(input.prisma, {
      characterId: existing.id,
      authority: input.authority,
    });
    // undefined = season evidence never acquired → must repair.
    // null = confirmed absence; number = has score → reuse.
    if (signals.currentSeasonMythicScore !== undefined) {
      await backfillCharacterRunDigestLinks({
        prisma: input.prisma,
        characterId: existing.id,
      });
      return {
        character: existing,
        bootstrapPerformed: false,
        providerCalls: 0,
        reason: "already_complete",
        currentSeasonEvidenceOutcome: CURRENT_SEASON_EVIDENCE_REUSED,
      };
    }
  }

  const fetched = await fetchBlizzardPublicBootstrap(input.blizzard, input.identity, {
    correlationId: input.correlationId,
    forceRefresh: true,
  });
  if (!fetched.ok) {
    throw fetched.error;
  }
  if (fetched.currentSeasonMythic.state === "UNKNOWN") {
    throw fetched.currentSeasonMythic.error;
  }

  let character = existing;
  const createdFresh = !character;
  const reason: "created" | "repaired" = existing ? "repaired" : "created";
  if (!character) {
    character = await input.characterRepository.upsertCharacter(input.identity, {
      displayName: fetched.profile.displayName || input.identity.name,
      classSlug: fetched.profile.classSlug,
      specSlug: fetched.profile.specSlug,
      role: fetched.profile.role,
      level: fetched.profile.level ?? null,
      faction: fetched.profile.faction ?? null,
      blizzardCharacterId: fetched.profile.blizzardCharacterId,
    });
  }

  try {
    character = await persistPublicCharacterBootstrap({
      prisma: input.prisma,
      characterRepository: input.characterRepository,
      character,
      profile: fetched.profile,
      currentSeasonMythic: fetched.currentSeasonMythic,
      authority: input.authority,
    });
  } catch (error) {
    if (createdFresh) {
      try {
        await input.characterRepository.deleteUnreferencedBootstrapShell(character.id);
      } catch {
        /* best-effort compensate */
      }
    }
    throw error;
  }

  return {
    character,
    bootstrapPerformed: true,
    providerCalls: fetched.providerCalls,
    reason,
    currentSeasonEvidenceOutcome:
      fetched.currentSeasonMythic.state === "CONFIRMED_NO_SCORE"
        ? CURRENT_SEASON_CONFIRMED_NO_SCORE
        : CURRENT_SEASON_EVIDENCE_REPAIRED,
  };
}

/** @deprecated Prefer resolveOrDiscoverPublicCharacter */
export const ensurePublicCharacterBootstrap = resolveOrDiscoverPublicCharacter;
