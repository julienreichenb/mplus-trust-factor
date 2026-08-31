import {
  characterMedianOfEightLevels,
  isCompleteEightDungeonLevels,
} from "@mplus/scoring";
import { decodeMythicPlusRecord, sliceRecord } from "./decode-record.js";
import { AddonDbFormatError, MYTHICPLUS_RECORD_SIZE_BYTES } from "./types.js";

/** Live Raider.IO lookup blobs prefix one byte before the first packed record row. */
export function lookupRecordDataOffset(lookup: Uint8Array): number {
  return lookup.length % MYTHICPLUS_RECORD_SIZE_BYTES === 0 ? 0 : 1;
}

export function oneBasedRecordSliceOffset(storedOffset: number, lookupDataOffset: number): number {
  if (!Number.isInteger(storedOffset) || storedOffset < 0) {
    throw new AddonDbFormatError("OFFSET", `Invalid record offset ${storedOffset}`);
  }
  if (lookupDataOffset !== 0 && lookupDataOffset !== 1) {
    throw new AddonDbFormatError("OFFSET", `Invalid lookup data offset ${lookupDataOffset}`);
  }
  return storedOffset + lookupDataOffset + 1;
}

export function assertLookupCoversNamedOffsets(
  lookup: Uint8Array,
  namedOffsets: readonly { byteOffset: number }[],
): void {
  const lookupDataOffset = lookupRecordDataOffset(lookup);
  for (const row of namedOffsets) {
    const oneBased = oneBasedRecordSliceOffset(row.byteOffset, lookupDataOffset);
    if (oneBased - 1 + MYTHICPLUS_RECORD_SIZE_BYTES > lookup.length) {
      throw new AddonDbFormatError(
        "LOOKUP_BOUNDS",
        `Record offset ${row.byteOffset} requires ${oneBased - 1 + MYTHICPLUS_RECORD_SIZE_BYTES} bytes, lookup has ${lookup.length}`,
      );
    }
  }
}

export function accumulateEligibleMedianHistogram(
  lookup: Uint8Array,
  namedOffsets: readonly { byteOffset: number }[],
): { indexedCharacters: number; eligibleCharacters: number; histogram: Map<number, number> } {
  const lookupDataOffset = lookupRecordDataOffset(lookup);
  assertLookupCoversNamedOffsets(lookup, namedOffsets);
  const histogram = new Map<number, number>();
  let eligibleCharacters = 0;
  for (const row of namedOffsets) {
    const oneBased = oneBasedRecordSliceOffset(row.byteOffset, lookupDataOffset);
    const rec = decodeMythicPlusRecord(sliceRecord(lookup, oneBased));
    if (!isCompleteEightDungeonLevels(rec.dungeonLevels)) continue;
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
