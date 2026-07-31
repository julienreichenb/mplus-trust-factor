/**
 * Versioned retail game metadata used by product policy.
 * Bump the version when expansion max level or expansion id changes.
 *
 * maxCharacterLevel here is the DEFAULT seed for AppEnv.MAX_CHARACTER_LEVEL only.
 * Runtime eligibility / relevance must resolve through getConfiguredMaxCharacterLevel
 * (or a policy built from it). This constant must never independently override
 * a configured MAX_CHARACTER_LEVEL value.
 */
export const ACTIVE_EXPANSION_METADATA_V1 = {
  version: "v1",
  /** Midnight — successor to The War Within (Raider.IO expansion id 12). */
  expansionId: 12,
  expansionName: "Midnight",
  /** Default for MAX_CHARACTER_LEVEL — not an independent runtime authority. */
  maxCharacterLevel: 90,
} as const;

export type ActiveExpansionMetadataV1 = typeof ACTIVE_EXPANSION_METADATA_V1;
