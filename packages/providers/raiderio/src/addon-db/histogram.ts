import {
  characterMedianOfEightLevels,
  isCompleteEightDungeonLevels,
} from "@mplus/scoring";
import { decodeMythicPlusRecord, sliceRecord } from "./decode-record.js";
import { AddonDbFormatError, MYTHICPLUS_RECORD_SIZE_BYTES } from "./types.js";

export function normalizeRecordByteOffset(offset: number): number {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AddonDbFormatError("OFFSET", `Invalid record offset ${offset}`);
  }
  if (offset % MYTHICPLUS_RECORD_SIZE_BYTES === 0) return offset;
  if (offset % MYTHICPLUS_RECORD_SIZE_BYTES === 1) return offset - 1;
  throw new AddonDbFormatError("OFFSET", `Record offset ${offset} is not aligned to ${MYTHICPLUS_RECORD_SIZE_BYTES}`);
}

export function accumulateEligibleMedianHistogram(
  lookup: Uint8Array,
  namedOffsets: readonly { byteOffset: number }[],
): { indexedCharacters: number; eligibleCharacters: number; histogram: Map<number, number> } {
  if (lookup.length % MYTHICPLUS_RECORD_SIZE_BYTES !== 0) {
    throw new AddonDbFormatError(
      "LOOKUP_LENGTH",
      `Lookup length ${lookup.length} is not divisible by ${MYTHICPLUS_RECORD_SIZE_BYTES}`,
    );
  }
  const histogram = new Map<number, number>();
  let eligibleCharacters = 0;
  for (const row of namedOffsets) {
    const start = normalizeRecordByteOffset(row.byteOffset);
    const rec = decodeMythicPlusRecord(sliceRecord(lookup, start + 1));
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
