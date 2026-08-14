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

export type BlizzardPublicBootstrapFetch =
  | { ok: true; profile: CanonicalCharacter; mythicRating: number | null; providerCalls: number }
  | { ok: false; error: ExternalApiError; providerCalls: number };

/**
 * Bounded Blizzard profile + authoritative-season keystone reads (exact resolve / smoke).
 * Does not invent eligibility evidence on NOT_FOUND.
 *
 * Keystone MUST use the eligibility season (`blizzardSeasonId`), not Blizzard's live
 * "current" index — PINNED/effective seasons can diverge from the live current season.
 */
export async function fetchBlizzardPublicBootstrap(
  blizzard: BlizzardProvider,
  identity: CharacterIdentityInput,
  opts: {
    correlationId?: string | null;
    forceRefresh?: boolean;
    /** Effective / PINNED Blizzard season id used by eligibility. */
    blizzardSeasonId: number;
  },
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
    try {
      const keystone = await blizzard.getMythicKeystoneSeasonProfile(
        identity,
        opts.blizzardSeasonId,
        ctx,
      );
      providerCalls += 1;
      return {
        ok: true,
        profile: profileResult.data,
        mythicRating: keystone.data.profile.currentMythicRating ?? null,
        providerCalls,
      };
    } catch (error) {
      // Provider failure must not collapse into "no Mythic+ score".
      providerCalls += 1;
      if (error instanceof ExternalApiError) {
        return { ok: false, error, providerCalls };
      }
      return {
        ok: false,
        error: new ExternalApiError({
          message: error instanceof Error ? error.message : "Blizzard keystone failed",
          code: "UNKNOWN",
          provider: "blizzard",
          retryable: true,
        }),
        providerCalls,
      };
    }
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
  mythicRating: number | null;
  authority: VerifiedSeasonAuthority;
}): Promise<Character> {
  const updated = await input.characterRepository.applyProviderProfile(
    input.character.id,
    input.profile,
  );
  await persistRefreshEligibilityEvidence(input.prisma, {
    characterId: updated.id,
    level: input.profile.level ?? updated.level ?? null,
    mythicRating: input.mythicRating,
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
};

/**
 * Canonical production operation:
 * lookup Character → reuse when complete + current-season evidence known →
 * Blizzard discover/fetch when absent/incomplete/evidence UNKNOWN.
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
    // HAS_SCORE or CONFIRMED_NO_SCORE → reuse (zero Blizzard Mythic+ calls).
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
      };
    }
    // Evidence UNKNOWN → fall through and fetch Blizzard once.
  }

  const fetched = await fetchBlizzardPublicBootstrap(input.blizzard, input.identity, {
    correlationId: input.correlationId,
    forceRefresh: true,
    blizzardSeasonId: input.authority.blizzardSeasonId,
  });
  if (!fetched.ok) {
    throw fetched.error;
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
      mythicRating: fetched.mythicRating,
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
  };
}

/** @deprecated Prefer resolveOrDiscoverPublicCharacter */
export const ensurePublicCharacterBootstrap = resolveOrDiscoverPublicCharacter;
