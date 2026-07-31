/**
 * Seed season-scoped refresh eligibility evidence for integration tests.
 * Required because the worker gate is fail-closed in every provider mode
 * (including fixture) and never calls providers to discover eligibility.
 */
import type { PrismaClient } from "@mplus/database";
import { getConfiguredMaxCharacterLevel } from "@mplus/config";
import { persistRefreshEligibilityEvidence } from "./orchestration/refresh-eligibility-gate.js";
import { requireVerifiedSeasonAuthority } from "./orchestration/season-authority.js";
import type { WorkerContainer } from "./container.js";

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function seedRefreshEligibilityEvidenceForTest(
  container: WorkerContainer,
  input: {
    region: string;
    realmSlug: string;
    name: string;
    level?: number;
    mythicRating?: number | null;
    /** Prefer false when Blizzard is disabled in the container under test. */
    allowProviderSync?: boolean;
  },
): Promise<{ characterId: string; seasonRowId: string }> {
  const identity = {
    region: input.region,
    realmSlug: input.realmSlug,
    name: input.name,
  };
  const character = await container.repositories.character.upsertCharacter(identity, {
    displayName: input.name,
    // Complete bootstrap metadata so exact-resolve repair does not overwrite
    // intentionally seeded ineligible levels with live/fixture Blizzard profiles.
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    blizzardCharacterId: String(
      1_000_000_000n + BigInt(Math.abs(hashString(input.name)) % 1_000_000_000),
    ),
  });
  const region = await container.prisma.region.findUniqueOrThrow({
    where: { id: character.regionId },
  });

  const allowProviderSync = input.allowProviderSync ?? true;
  let authority;
  try {
    authority = await requireVerifiedSeasonAuthority(
      {
        prisma: container.prisma,
        blizzard: container.providers.blizzard,
        logger: container.logger,
      },
      region.code,
      region.id,
      { allowProviderSync, correlationId: null },
    );
  } catch (firstError) {
    if (!allowProviderSync) throw firstError;
    authority = await requireVerifiedSeasonAuthority(
      {
        prisma: container.prisma,
        blizzard: container.providers.blizzard,
        logger: container.logger,
      },
      region.code,
      region.id,
      { allowProviderSync: false, correlationId: null },
    );
  }

  await persistRefreshEligibilityEvidence(container.prisma as PrismaClient, {
    characterId: character.id,
    level: input.level ?? getConfiguredMaxCharacterLevel(),
    mythicRating: input.mythicRating === undefined ? 2500 : input.mythicRating,
    authoritativeSeasonRowId: authority.seasonRowId,
  });
  return { characterId: character.id, seasonRowId: authority.seasonRowId };
}
