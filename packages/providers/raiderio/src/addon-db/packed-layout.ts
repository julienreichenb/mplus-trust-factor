import { AddonDbFormatError } from "./types.js";

/** Field IDs from Raider.IO `ENCODER_MYTHICPLUS_FIELDS` in core.lua. */
export const ENCODER_MYTHICPLUS_FIELDS = {
  CURRENT_SCORE: 1,
  CURRENT_ROLES: 2,
  PREVIOUS_SCORE: 3,
  PREVIOUS_ROLES: 4,
  MAIN_CURRENT_SCORE: 5,
  MAIN_CURRENT_ROLES: 6,
  MAIN_PREVIOUS_SCORE: 7,
  MAIN_PREVIOUS_ROLES: 8,
  DUNGEON_RUN_COUNTS: 9,
  DUNGEON_LEVELS: 10,
  DUNGEON_BEST_INDEX: 11,
  WARBAND_CURRENT_SCORE: 12,
  WARBAND_PREVIOUS_SCORE: 13,
  WARBAND_DUNGEON_LEVELS: 14,
  WARBAND_CURRENT_ROLES: 15,
  WARBAND_PREVIOUS_ROLES: 16,
} as const;

/** Packed dungeon key level width in Raider.IO `ReadDungeonLevelStats`. */
export const PACKED_DUNGEON_KEY_FIELD_BITS = 6;
export const PACKED_DUNGEON_CHEST_FIELD_BITS = 2;
export const PACKED_DUNGEON_KEY_FIELD_MAX = (1 << PACKED_DUNGEON_KEY_FIELD_BITS) - 1;

/**
 * Values in the saturated tail of the 6-bit key field (57–63) are the
 * misalignment signature of decoding with the pre-S18 30-byte layout.
 */
export const PACKED_DUNGEON_KEY_SATURATION_MIN = PACKED_DUNGEON_KEY_FIELD_MAX - 6;

export interface MythicPlusPackedLayout {
  encodingOrder: readonly number[];
  milestoneCount: number;
  dungeonCount: number;
}

/** Pre-S18 addon packing used by older fixtures / relevant-candidate tests. */
export const LEGACY_MYTHICPLUS_LAYOUT: MythicPlusPackedLayout = {
  encodingOrder: [1, 2, 5, 6, 9, 10, 11, 12, 14, 15],
  milestoneCount: 6,
  dungeonCount: 8,
};

/**
 * Current Raider.IO mythicplus packing (v202608310600+):
 * `recordSizeInBytes=38`,
 * `encodingOrder={1,2,3,4,5,6,7,8,9,10,11,12,14,15,13,16}`.
 */
export const CURRENT_MYTHICPLUS_LAYOUT: MythicPlusPackedLayout = {
  encodingOrder: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 13, 16],
  milestoneCount: 6,
  dungeonCount: 8,
};

export function mythicPlusFieldBitWidth(field: number, layout: MythicPlusPackedLayout): number {
  const dungeons = layout.dungeonCount * (PACKED_DUNGEON_KEY_FIELD_BITS + PACKED_DUNGEON_CHEST_FIELD_BITS);
  switch (field) {
    case ENCODER_MYTHICPLUS_FIELDS.CURRENT_SCORE:
    case ENCODER_MYTHICPLUS_FIELDS.MAIN_CURRENT_SCORE:
    case ENCODER_MYTHICPLUS_FIELDS.WARBAND_CURRENT_SCORE:
      return 13;
    case ENCODER_MYTHICPLUS_FIELDS.CURRENT_ROLES:
    case ENCODER_MYTHICPLUS_FIELDS.PREVIOUS_ROLES:
    case ENCODER_MYTHICPLUS_FIELDS.MAIN_CURRENT_ROLES:
    case ENCODER_MYTHICPLUS_FIELDS.MAIN_PREVIOUS_ROLES:
    case ENCODER_MYTHICPLUS_FIELDS.WARBAND_CURRENT_ROLES:
    case ENCODER_MYTHICPLUS_FIELDS.WARBAND_PREVIOUS_ROLES:
      return 7;
    case ENCODER_MYTHICPLUS_FIELDS.PREVIOUS_SCORE:
    case ENCODER_MYTHICPLUS_FIELDS.WARBAND_PREVIOUS_SCORE:
      return 15;
    case ENCODER_MYTHICPLUS_FIELDS.MAIN_PREVIOUS_SCORE:
      return 12;
    case ENCODER_MYTHICPLUS_FIELDS.DUNGEON_RUN_COUNTS:
      return layout.milestoneCount * 8;
    case ENCODER_MYTHICPLUS_FIELDS.DUNGEON_LEVELS:
    case ENCODER_MYTHICPLUS_FIELDS.WARBAND_DUNGEON_LEVELS:
      return dungeons;
    case ENCODER_MYTHICPLUS_FIELDS.DUNGEON_BEST_INDEX:
      return 4;
    default:
      throw new AddonDbFormatError("ENCODING_ORDER", `Unknown Mythic+ packed field id ${field}`);
  }
}

export function packedMythicPlusBitLength(layout: MythicPlusPackedLayout): number {
  return layout.encodingOrder.reduce((sum, field) => sum + mythicPlusFieldBitWidth(field, layout), 0);
}

export function packedMythicPlusRecordSizeBytes(layout: MythicPlusPackedLayout): number {
  return Math.ceil(packedMythicPlusBitLength(layout) / 8);
}

export function layoutFromProviderHeader(header: {
  encodingOrder: readonly number[];
  keystoneMilestoneLevels: readonly number[];
  dungeonCount?: number;
}): MythicPlusPackedLayout {
  return {
    encodingOrder: [...header.encodingOrder],
    milestoneCount: header.keystoneMilestoneLevels.length,
    dungeonCount: header.dungeonCount ?? 8,
  };
}

export function assertPackedLayoutMatchesRecordSize(
  layout: MythicPlusPackedLayout,
  recordSizeInBytes: number,
): void {
  if (!Number.isInteger(recordSizeInBytes) || recordSizeInBytes <= 0) {
    throw new AddonDbFormatError("RECORD_SIZE", `Invalid recordSizeInBytes ${recordSizeInBytes}`);
  }
  if (layout.encodingOrder.length === 0) {
    throw new AddonDbFormatError("ENCODING_ORDER", "encodingOrder is missing from the addon provider header");
  }
  if (layout.milestoneCount <= 0) {
    throw new AddonDbFormatError("ENCODING_ORDER", "keystoneMilestoneLevels is empty");
  }
  if (layout.dungeonCount !== 8) {
    throw new AddonDbFormatError("DUNGEON_COUNT", `Expected 8 dungeon slots, found ${layout.dungeonCount}`);
  }
  const bits = packedMythicPlusBitLength(layout);
  const expectedBytes = Math.ceil(bits / 8);
  if (expectedBytes !== recordSizeInBytes) {
    throw new AddonDbFormatError(
      "RECORD_SIZE",
      `encodingOrder packs ${bits} bits (${expectedBytes} bytes) but recordSizeInBytes is ${recordSizeInBytes}`,
    );
  }
}
