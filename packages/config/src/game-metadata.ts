/**
 * Versioned retail game metadata used by product policy (not env-tunable).
 * Bump the version when expansion max level or expansion id changes.
 */
export const ACTIVE_EXPANSION_METADATA_V1 = {
  version: "v1",
  /** Midnight — successor to The War Within (Raider.IO expansion id 12). */
  expansionId: 12,
  expansionName: "Midnight",
  maxCharacterLevel: 90,
} as const;

export type ActiveExpansionMetadataV1 = typeof ACTIVE_EXPANSION_METADATA_V1;
