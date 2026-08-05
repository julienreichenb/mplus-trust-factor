/**
 * Persisted Active M+ season catalog metadata on Season.metadata.
 */
export const ACTIVE_MPLUS_METADATA_KEY = "activeMplusCatalog" as const;

export interface PersistedActiveMplusCatalogMetadata {
  schemaVersion: "active-mplus-catalog-v1";
  wclZoneId: number;
  blizzardSeasonId: number | null;
  expansionIdentity: string | null;
  dungeonPoolHash: string;
  sourceMetadataHash: string;
  catalogVersion: string;
  dungeonSlugs: string[];
  synchronizedAt: string;
  validatedAt: string;
  lastKnownGood: boolean;
  authorityVersion: string;
}

export function readActiveMplusCatalogMetadata(
  metadata: unknown,
): PersistedActiveMplusCatalogMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const raw = root[ACTIVE_MPLUS_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== "active-mplus-catalog-v1") return null;
  if (typeof doc.wclZoneId !== "number" || !Number.isInteger(doc.wclZoneId) || doc.wclZoneId <= 0) {
    return null;
  }
  if (typeof doc.dungeonPoolHash !== "string" || !doc.dungeonPoolHash) return null;
  if (!Array.isArray(doc.dungeonSlugs)) return null;
  return {
    schemaVersion: "active-mplus-catalog-v1",
    wclZoneId: doc.wclZoneId,
    blizzardSeasonId:
      typeof doc.blizzardSeasonId === "number" ? doc.blizzardSeasonId : null,
    expansionIdentity:
      typeof doc.expansionIdentity === "string" ? doc.expansionIdentity : null,
    dungeonPoolHash: doc.dungeonPoolHash,
    sourceMetadataHash:
      typeof doc.sourceMetadataHash === "string" ? doc.sourceMetadataHash : "",
    catalogVersion:
      typeof doc.catalogVersion === "string" ? doc.catalogVersion : "",
    dungeonSlugs: doc.dungeonSlugs.filter((s): s is string => typeof s === "string"),
    synchronizedAt:
      typeof doc.synchronizedAt === "string" ? doc.synchronizedAt : "",
    validatedAt: typeof doc.validatedAt === "string" ? doc.validatedAt : "",
    lastKnownGood: doc.lastKnownGood === true,
    authorityVersion:
      typeof doc.authorityVersion === "string" ? doc.authorityVersion : "",
  };
}

export function mergeActiveMplusCatalogMetadata(
  existing: unknown,
  catalog: PersistedActiveMplusCatalogMetadata,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return {
    ...base,
    [ACTIVE_MPLUS_METADATA_KEY]: catalog,
    // Keep legacy keys for readers that still look for dungeonSlugs.
    dungeonSlugs: catalog.dungeonSlugs,
    wclMplusZoneId: catalog.wclZoneId,
  };
}
