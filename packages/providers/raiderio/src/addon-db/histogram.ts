import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
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

function validateNamedOffset(lookup: Uint8Array, byteOffset: number, recordSizeBytes: number): void {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new AddonDbFormatError("OFFSET", `Invalid record offset ${byteOffset}`);
  }
  if (byteOffset % recordSizeBytes !== 0) {
    throw new AddonDbFormatError(
      "OFFSET",
      `Record offset ${byteOffset} is not aligned to ${recordSizeBytes}`,
    );
  }
  if (byteOffset + recordSizeBytes > lookup.length) {
    throw new AddonDbFormatError(
      "LOOKUP_BOUNDS",
      `Record offset ${byteOffset} requires ${byteOffset + recordSizeBytes} bytes, lookup has ${lookup.length}`,
    );
  }
}

/** Stream character offsets from disk and build the eligible median histogram without a full named corpus. */
export async function accumulateEligibleMedianHistogramFromCharactersFile(
  charactersLuaPath: string,
  lookup: Uint8Array,
  layout: MythicPlusPackedLayout,
  recordSizeInBytes: number,
): Promise<{ indexedCharacters: number; eligibleCharacters: number; histogram: Map<number, number> }> {
  const recordSizeBytes = packedMythicPlusRecordSizeBytes(layout);
  if (lookup.length % recordSizeBytes !== 0) {
    throw new AddonDbFormatError(
      "LOOKUP_LENGTH",
      `Lookup length ${lookup.length} is not divisible by recordSizeInBytes ${recordSizeBytes}`,
    );
  }

  const histogram = new Map<number, number>();
  let indexedCharacters = 0;
  let eligibleCharacters = 0;
  const stream = createReadStream(charactersLuaPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const m = line.match(/provider\.db\["((?:\\.|[^"\\])*)"\]=\{(\d+),(.+)\} end F\(\)/);
    if (!m) continue;
    const baseOffset = Number(m[2]);
    const namesPart = m[3] ?? "";
    const nameRe = /"((?:\\.|[^"\\])*)"/g;
    let nameIndex = 0;
    let nm: RegExpExecArray | null;
    while ((nm = nameRe.exec(namesPart))) {
      const byteOffset = baseOffset + nameIndex * recordSizeInBytes;
      validateNamedOffset(lookup, byteOffset, recordSizeBytes);
      indexedCharacters += 1;
      const rec = decodeMythicPlusRecord(
        sliceRecord(lookup, byteOffset + 1, recordSizeBytes),
        layout,
      );
      if (!isCompleteEightDungeonLevels(rec.dungeonLevels)) {
        nameIndex += 1;
        continue;
      }
      if (rec.dungeonLevels.some((level) => level >= PACKED_DUNGEON_KEY_SATURATION_MIN)) {
        throw new AddonDbFormatError(
          "KEY_FIELD_SATURATION",
          `Decoded dungeon key ${Math.max(...rec.dungeonLevels)} sits in the ${PACKED_DUNGEON_KEY_SATURATION_MIN}–63 tail of the 6-bit packed field`,
        );
      }
      const median = characterMedianOfEightLevels(rec.dungeonLevels);
      histogram.set(median, (histogram.get(median) ?? 0) + 1);
      eligibleCharacters += 1;
      nameIndex += 1;
    }
  }

  return { indexedCharacters, eligibleCharacters, histogram };
}
