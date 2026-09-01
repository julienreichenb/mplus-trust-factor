import { readBits } from "./packed-bits.js";
import {
  assertPackedLayoutMatchesRecordSize,
  ENCODER_MYTHICPLUS_FIELDS,
  LEGACY_MYTHICPLUS_LAYOUT,
  mythicPlusFieldBitWidth,
  packedMythicPlusRecordSizeBytes,
  PACKED_DUNGEON_CHEST_FIELD_BITS,
  PACKED_DUNGEON_KEY_FIELD_BITS,
  PACKED_DUNGEON_KEY_FIELD_MAX,
  type MythicPlusPackedLayout,
} from "./packed-layout.js";
import { AddonDbFormatError, MYTHICPLUS_RECORD_SIZE_BYTES, type PackedMythicPlusRecord } from "./types.js";

export function decodeMythicPlusRecord(
  record: Uint8Array,
  layout: MythicPlusPackedLayout = LEGACY_MYTHICPLUS_LAYOUT,
): PackedMythicPlusRecord {
  const recordSize = packedMythicPlusRecordSizeBytes(layout);
  assertPackedLayoutMatchesRecordSize(layout, recordSize);
  if (record.length !== recordSize) {
    throw new AddonDbFormatError("RECORD_SIZE", `Expected ${recordSize}-byte record, got ${record.length}`);
  }
  let bitOffset = 0;
  let currentScore = 0;
  let dungeonLevels: number[] = [];
  let dungeonChests: number[] = [];
  let warbandDungeonLevels: number[] = [];
  for (const field of layout.encodingOrder) {
    if (field === ENCODER_MYTHICPLUS_FIELDS.CURRENT_SCORE) {
      const score = readBits(record, bitOffset, 13);
      currentScore = score.value;
      bitOffset = score.bitOffset;
      continue;
    }
    if (field === ENCODER_MYTHICPLUS_FIELDS.DUNGEON_LEVELS) {
      const decoded = readDungeonSlots(record, bitOffset, layout.dungeonCount);
      dungeonLevels = decoded.levels;
      dungeonChests = decoded.chests;
      bitOffset = decoded.bitOffset;
      continue;
    }
    if (field === ENCODER_MYTHICPLUS_FIELDS.WARBAND_DUNGEON_LEVELS) {
      const decoded = readDungeonSlots(record, bitOffset, layout.dungeonCount);
      warbandDungeonLevels = decoded.levels;
      bitOffset = decoded.bitOffset;
      continue;
    }
    bitOffset += mythicPlusFieldBitWidth(field, layout);
  }
  if (Math.ceil(bitOffset / 8) > recordSize) {
    throw new AddonDbFormatError("BIT_OVERRUN", "Packed record bit decode exceeded record size");
  }
  if (dungeonLevels.length !== layout.dungeonCount) {
    throw new AddonDbFormatError("ENCODING_ORDER", "encodingOrder did not include dungeon levels (field 10)");
  }
  return {
    currentScore,
    dungeonLevels,
    dungeonChests,
    warbandDungeonLevels,
  };
}

export function sliceRecord(
  lookup: Uint8Array,
  oneBasedByteOffset: number,
  recordSizeBytes: number = MYTHICPLUS_RECORD_SIZE_BYTES,
): Uint8Array {
  const start = oneBasedByteOffset - 1;
  if (start < 0 || start + recordSizeBytes > lookup.length) {
    throw new AddonDbFormatError(
      "LOOKUP_BOUNDS",
      `Record offset ${oneBasedByteOffset} is outside lookup (${lookup.length} bytes)`,
    );
  }
  return lookup.subarray(start, start + recordSizeBytes);
}

function readDungeonSlots(
  record: Uint8Array,
  bitOffset: number,
  dungeonCount: number,
): { levels: number[]; chests: number[]; bitOffset: number } {
  const levels: number[] = [];
  const chests: number[] = [];
  let offset = bitOffset;
  for (let i = 0; i < dungeonCount; i++) {
    const level = readBits(record, offset, PACKED_DUNGEON_KEY_FIELD_BITS);
    const chest = readBits(record, level.bitOffset, PACKED_DUNGEON_CHEST_FIELD_BITS);
    if (level.value > PACKED_DUNGEON_KEY_FIELD_MAX) {
      throw new AddonDbFormatError(
        "KEY_LEVEL_RANGE",
        `Key level ${level.value} exceeds ${PACKED_DUNGEON_KEY_FIELD_MAX}`,
      );
    }
    levels.push(level.value);
    chests.push(chest.value);
    offset = chest.bitOffset;
  }
  return { levels, chests, bitOffset: offset };
}
