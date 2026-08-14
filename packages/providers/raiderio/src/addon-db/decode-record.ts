import { readBits } from "./packed-bits.js";
import {
  AddonDbFormatError,
  MAX_KEY_LEVEL,
  MYTHICPLUS_DUNGEON_SLOTS,
  MYTHICPLUS_MILESTONES,
  MYTHICPLUS_RECORD_SIZE_BYTES,
  type PackedMythicPlusRecord,
} from "./types.js";

export function decodeMythicPlusRecord(record: Uint8Array): PackedMythicPlusRecord {
  if (record.length !== MYTHICPLUS_RECORD_SIZE_BYTES) {
    throw new AddonDbFormatError(
      "RECORD_SIZE",
      `Expected ${MYTHICPLUS_RECORD_SIZE_BYTES}-byte record, got ${record.length}`,
    );
  }
  let bitOffset = 0;
  const currentScore = readField(record, bitOffset, 13);
  bitOffset = currentScore.bitOffset;
  bitOffset = readField(record, bitOffset, 7).bitOffset;
  bitOffset = readField(record, bitOffset, 13).bitOffset;
  bitOffset = readField(record, bitOffset, 7).bitOffset;
  for (let i = 0; i < MYTHICPLUS_MILESTONES.length; i++) {
    bitOffset = readField(record, bitOffset, 8).bitOffset;
  }
  const dungeonLevels: number[] = [];
  const dungeonChests: number[] = [];
  for (let i = 0; i < MYTHICPLUS_DUNGEON_SLOTS; i++) {
    const level = readField(record, bitOffset, 6);
    bitOffset = level.bitOffset;
    const chests = readField(record, bitOffset, 2);
    bitOffset = chests.bitOffset;
    if (level.value > MAX_KEY_LEVEL) {
      throw new AddonDbFormatError("KEY_LEVEL_RANGE", `Key level ${level.value} exceeds ${MAX_KEY_LEVEL}`);
    }
    dungeonLevels.push(level.value);
    dungeonChests.push(chests.value);
  }
  bitOffset = readField(record, bitOffset, 4).bitOffset;
  bitOffset = readField(record, bitOffset, 13).bitOffset;
  const warbandDungeonLevels: number[] = [];
  for (let i = 0; i < MYTHICPLUS_DUNGEON_SLOTS; i++) {
    const level = readField(record, bitOffset, 6);
    bitOffset = level.bitOffset;
    bitOffset = readField(record, bitOffset, 2).bitOffset;
    warbandDungeonLevels.push(level.value);
  }
  bitOffset = readField(record, bitOffset, 7).bitOffset;
  if (Math.ceil(bitOffset / 8) > MYTHICPLUS_RECORD_SIZE_BYTES) {
    throw new AddonDbFormatError("BIT_OVERRUN", "Packed record bit decode exceeded record size");
  }
  return {
    currentScore: currentScore.value,
    dungeonLevels,
    dungeonChests,
    warbandDungeonLevels,
  };
}

function readField(buf: Uint8Array, bitOffset: number, length: number) {
  return readBits(buf, bitOffset, length);
}

export function sliceRecord(lookup: Uint8Array, oneBasedByteOffset: number): Uint8Array {
  const start = oneBasedByteOffset - 1;
  if (start < 0 || start + MYTHICPLUS_RECORD_SIZE_BYTES > lookup.length) {
    throw new AddonDbFormatError(
      "LOOKUP_BOUNDS",
      `Record offset ${oneBasedByteOffset} is outside lookup (${lookup.length} bytes)`,
    );
  }
  if (lookup.length % MYTHICPLUS_RECORD_SIZE_BYTES !== 0) {
    throw new AddonDbFormatError(
      "LOOKUP_LENGTH",
      `Lookup length ${lookup.length} is not divisible by ${MYTHICPLUS_RECORD_SIZE_BYTES}`,
    );
  }
  return lookup.subarray(start, start + MYTHICPLUS_RECORD_SIZE_BYTES);
}
