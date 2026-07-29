/**
 * Versioned retail game metadata used by product policy (not env-tunable).
 * Bump the version when expansion max level or expansion id changes.
 */
export const ACTIVE_EXPANSION_METADATA_V1 = {
  version: "v1",
  /** The War Within — matches Raider.IO documented expansion id. */
  expansionId: 11,
  expansionName: "The War Within",
  maxCharacterLevel: 80,
} as const;

export type ActiveExpansionMetadataV1 = typeof ACTIVE_EXPANSION_METADATA_V1;
