/**
 * Shadow Canary frozen identity — reuses production class-spec freeze + @mplus/abilities.
 * Never invents a fallback specialization; fail-closed when identity is incomplete.
 */
import {
  getAbilityCatalog,
  CURRENT_CATALOG_VERSION_ID,
  type AbilityCatalog,
} from "@mplus/abilities";
import type { EvidenceRole } from "@mplus/contracts";
import type { PrismaClient } from "@prisma/client";
import {
  resolveFrozenCharacterIdentity,
  type FrozenCharacterIdentity,
} from "../class-spec-identity.js";

export interface ShadowCanaryFrozenIdentity {
  characterId: string;
  regionCode: string;
  realmSlug: string;
  characterName: string;
  identity: FrozenCharacterIdentity;
  specializationId: string | null;
  catalogVersion: string | null;
  catalogSupportState: "supported" | "unsupported" | "unknown";
  catalog: AbilityCatalog | null;
  /** True when Survival/Utility must fail closed (incomplete/incompatible identity). */
  catalogDependentFailClosed: boolean;
}

export async function resolveShadowCanaryIdentity(input: {
  prisma: PrismaClient;
  regionCode: string;
  realmSlug: string;
  characterName: string;
}): Promise<ShadowCanaryFrozenIdentity | { error: string; detail: string }> {
  const region = await input.prisma.region.findFirst({
    where: { code: input.regionCode.toUpperCase() },
  });
  if (!region) {
    return { error: "REGION_UNRESOLVED", detail: `Unknown region ${input.regionCode}` };
  }

  const realm = await input.prisma.realm.findFirst({
    where: {
      regionId: region.id,
      slug: input.realmSlug.toLowerCase(),
    },
  });
  if (!realm) {
    return {
      error: "REALM_UNRESOLVED",
      detail: `Unknown realm ${input.realmSlug} in ${input.regionCode}`,
    };
  }

  const normalizedName = input.characterName.trim().toLowerCase();
  const character = await input.prisma.character.findUnique({
    where: {
      regionId_realmId_normalizedName: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName,
      },
    },
    include: {
      gameClass: true,
      activeSpec: true,
    },
  });

  if (!character) {
    return {
      error: "CHARACTER_NOT_FOUND",
      detail: `${input.regionCode}/${input.realmSlug}/${input.characterName}`,
    };
  }

  const classSlug = character.gameClass?.slug ?? null;
  const specSlug = character.activeSpec?.slug ?? null;
  // Prefer coherent Blizzard-shaped tuple from persisted Character fields.
  // Mutable Character.role is never the sole identity source when class/spec exist.
  const identity = resolveFrozenCharacterIdentity({
    blizzard: {
      classSlug,
      specSlug,
      role: character.activeSpec?.role ?? character.role ?? null,
    },
    raiderIo: null,
    persistedClassSlug: classSlug,
    persistedSpecSlug: specSlug,
  });

  let catalog: AbilityCatalog | null = null;
  let catalogVersion: string | null = null;
  let catalogSupportState: ShadowCanaryFrozenIdentity["catalogSupportState"] = "unknown";

  if (identity.classSlug && identity.specSlug && identity.state === "KNOWN") {
    catalog = getAbilityCatalog({
      classSlug: identity.classSlug,
      specSlug: identity.specSlug,
    });
    catalogVersion = catalog.supported
      ? catalog.catalogVersion || CURRENT_CATALOG_VERSION_ID
      : null;
    catalogSupportState = catalog.supported ? "supported" : "unsupported";
  } else if (!identity.classSlug || !identity.specSlug) {
    catalogSupportState = "unsupported";
  }

  return {
    characterId: character.id,
    regionCode: region.code,
    realmSlug: realm.slug,
    characterName: character.displayName,
    identity,
    specializationId: character.activeSpecId,
    catalogVersion,
    catalogSupportState,
    catalog,
    catalogDependentFailClosed:
      identity.catalogDependentFailClosed ||
      identity.state !== "KNOWN" ||
      !identity.specSlug ||
      catalogSupportState !== "supported",
  };
}

export function shadowCanaryRoleOrUnknown(
  identity: FrozenCharacterIdentity,
): EvidenceRole {
  return identity.role;
}
