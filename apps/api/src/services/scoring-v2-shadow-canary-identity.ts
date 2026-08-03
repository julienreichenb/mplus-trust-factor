/**
 * API-side Shadow Canary identity freeze.
 * Mirrors worker class-spec freeze rules using Character + @mplus/abilities.
 * Never invents a fallback specialization.
 */
import {
  getAbilityCatalog,
  CURRENT_CATALOG_VERSION_ID,
  findSpecDefinition,
  normalizeCatalogSlug,
} from "@mplus/abilities";
import type { PrismaClient } from "@mplus/database";

export async function resolveShadowCanaryIdentity(input: {
  prisma: PrismaClient;
  regionCode: string;
  realmSlug: string;
  characterName: string;
}): Promise<
  | {
      characterId: string;
      regionCode: string;
      realmSlug: string;
      characterName: string;
      identity: {
        state: "KNOWN" | "UNKNOWN" | "INCOMPATIBLE";
        classSlug: string | null;
        specSlug: string | null;
        role: string;
        limitations: string[];
        catalogDependentFailClosed: boolean;
      };
      specializationId: string | null;
      catalogVersion: string | null;
      catalogSupportState: "supported" | "unsupported" | "unknown";
      catalogDependentFailClosed: boolean;
    }
  | { error: string; detail: string }
> {
  const region = await input.prisma.region.findFirst({
    where: { code: input.regionCode.toUpperCase() },
  });
  if (!region) {
    return { error: "REGION_UNRESOLVED", detail: `Unknown region ${input.regionCode}` };
  }

  const realm = await input.prisma.realm.findFirst({
    where: { regionId: region.id, slug: input.realmSlug.toLowerCase() },
  });
  if (!realm) {
    return {
      error: "REALM_UNRESOLVED",
      detail: `Unknown realm ${input.realmSlug} in ${input.regionCode}`,
    };
  }

  const character = await input.prisma.character.findUnique({
    where: {
      regionId_realmId_normalizedName: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName: input.characterName.trim().toLowerCase(),
      },
    },
    include: { gameClass: true, activeSpec: true },
  });
  if (!character) {
    return {
      error: "CHARACTER_NOT_FOUND",
      detail: `${input.regionCode}/${input.realmSlug}/${input.characterName}`,
    };
  }

  const classSlug = normalizeCatalogSlug(character.gameClass?.slug ?? null);
  const specSlug = normalizeCatalogSlug(character.activeSpec?.slug ?? null);
  const limitations: string[] = [];
  let state: "KNOWN" | "UNKNOWN" | "INCOMPATIBLE" = "UNKNOWN";
  let role = "UNKNOWN";
  let catalogDependentFailClosed = false;

  if (classSlug && specSlug) {
    const spec = findSpecDefinition(classSlug, specSlug);
    if (!spec) {
      state = "INCOMPATIBLE";
      catalogDependentFailClosed = true;
      limitations.push("class_spec_identity_unknown_to_catalog");
    } else {
      state = "KNOWN";
      role = spec.role;
    }
  } else {
    limitations.push("class_spec_identity_incomplete");
  }

  let catalogVersion: string | null = null;
  let catalogSupportState: "supported" | "unsupported" | "unknown" = "unknown";
  if (state === "KNOWN" && classSlug && specSlug) {
    const catalog = getAbilityCatalog({ classSlug, specSlug });
    catalogSupportState = catalog.supported ? "supported" : "unsupported";
    catalogVersion = catalog.supported
      ? catalog.catalogVersion || CURRENT_CATALOG_VERSION_ID
      : null;
    if (!catalog.supported) catalogDependentFailClosed = true;
  } else {
    catalogSupportState = "unsupported";
    catalogDependentFailClosed = true;
  }

  return {
    characterId: character.id,
    regionCode: region.code,
    realmSlug: realm.slug,
    characterName: character.displayName,
    identity: {
      state,
      classSlug,
      specSlug,
      role,
      limitations,
      catalogDependentFailClosed,
    },
    specializationId: character.activeSpecId,
    catalogVersion,
    catalogSupportState,
    catalogDependentFailClosed,
  };
}
