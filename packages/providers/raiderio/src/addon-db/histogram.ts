import {
  characterMedianOfEightLevels,
  isCompleteEightDungeonLevels,
} from "@mplus/scoring";
import { decodeMythicPlusRecord, sliceRecord } from "./decode-record.js";
import {
  packedMythicPlusRecordSizeBytes,
  PACKED_DUNGEON_KEY_SATURATION_MIN,
  type MythicPlusPackedLayout,
} from "./packed-layout.js";
import { AddonDbFormatError } from "./types.js";

export function assertLookupCoversNamedOffsets(
  lookup: Uint8Array,
  namedOffsets: readonly { byteOffset: number }[],
  recordSizeBytes: number,
): void {
  if (lookup.length % recordSizeBytes !== 0) {
    throw new AddonDbFormatError(
      "LOOKUP_LENGTH",
      `Lookup length ${lookup.length} is not divisible by recordSizeInBytes ${recordSizeBytes}`,
    );
  }
  for (const row of namedOffsets) {
    if (!Number.isInteger(row.byteOffset) || row.byteOffset < 0) {
      throw new AddonDbFormatError("OFFSET", `Invalid record offset ${row.byteOffset}`);
    }
    if (row.byteOffset % recordSizeBytes !== 0) {
      throw new AddonDbFormatError(
        "OFFSET",
        `Record offset ${row.byteOffset} is not aligned to ${recordSizeBytes}`,
      );
    }
    if (row.byteOffset + recordSizeBytes > lookup.length) {
      throw new AddonDbFormatError(
        "LOOKUP_BOUNDS",
        `Record offset ${row.byteOffset} requires ${row.byteOffset + recordSizeBytes} bytes, lookup has ${lookup.length}`,
      );
    }
  }
}

export function accumulateEligibleMedianHistogram(
  lookup: Uint8Array,
  namedOffsets: readonly { byteOffset: number }[],
  layout: MythicPlusPackedLayout,
): { indexedCharacters: number; eligibleCharacters: number; histogram: Map<number, number> } {
  const recordSizeBytes = packedMythicPlusRecordSizeBytes(layout);
  assertLookupCoversNamedOffsets(lookup, namedOffsets, recordSizeBytes);
  const histogram = new Map<number, number>();
  let eligibleCharacters = 0;
  for (const row of namedOffsets) {
    const rec = decodeMythicPlusRecord(sliceRecord(lookup, row.byteOffset + 1, recordSizeBytes), layout);
    if (!isCompleteEightDungeonLevels(rec.dungeonLevels)) continue;
    if (rec.dungeonLevels.some((level) => level >= PACKED_DUNGEON_KEY_SATURATION_MIN)) {
      throw new AddonDbFormatError(
        "KEY_FIELD_SATURATION",
        `Decoded dungeon key ${Math.max(...rec.dungeonLevels)} sits in the ${PACKED_DUNGEON_KEY_SATURATION_MIN}–63 tail of the 6-bit packed field`,
      );
    }
    const median = characterMedianOfEightLevels(rec.dungeonLevels);
    histogram.set(median, (histogram.get(median) ?? 0) + 1);
    eligibleCharacters += 1;
  }
  return {
    indexedCharacters: namedOffsets.length,
    eligibleCharacters,
    histogram,
  };
}
