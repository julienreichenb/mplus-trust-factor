/**
 * Select competitive Mythic+ characters from a Raider.IO addon-db snapshot.
 *
 * Strategy: one local addon-db pass yields many candidates — no /mythic-plus/runs crawl.
 * Characters with complete 8/8 dungeon medians at or above the empirical percentile cutoff
 * approximate the upper competitive population (default top 10%).
 *
 * Must use the same packed-layout decoder as Key distribution ingest (header-driven
 * recordSizeInBytes + encodingOrder). Never assume the legacy 30-byte layout.
 */
import { characterMedianOfEightLevels, empiricalCdfQuantile, isCompleteEightDungeonLevels } from "@mplus/scoring";
import { decodeMythicPlusRecord, sliceRecord } from "./decode-record.js";
import { assertLookupCoversNamedOffsets } from "./histogram.js";
import {
  packedMythicPlusRecordSizeBytes,
  PACKED_DUNGEON_KEY_SATURATION_MIN,
  type MythicPlusPackedLayout,
} from "./packed-layout.js";
import { AddonDbFormatError } from "./types.js";

export interface RelevantAddonCandidate {
  realm: string;
  name: string;
  medianKey: number;
  rioScore: number;
}

export function selectRelevantCandidatesFromAddonSnapshot(input: {
  lookup: Uint8Array;
  named: readonly { realm: string; name: string; byteOffset: number }[];
  percentileBps: number;
  layout: MythicPlusPackedLayout;
  maxCandidates?: number;
}): {
  candidates: RelevantAddonCandidate[];
  thresholdMedianKey: number;
  scanned: number;
  eligible: number;
} {
  const recordSizeBytes = packedMythicPlusRecordSizeBytes(input.layout);
  assertLookupCoversNamedOffsets(
    input.lookup,
    input.named.map((n) => ({ byteOffset: n.byteOffset })),
    recordSizeBytes,
  );

  const histogram = new Map<number, number>();
  const decoded: Array<{ realm: string; name: string; medianKey: number; rioScore: number }> = [];

  for (const row of input.named) {
    const rec = decodeMythicPlusRecord(
      sliceRecord(input.lookup, row.byteOffset + 1, recordSizeBytes),
      input.layout,
    );
    if (!isCompleteEightDungeonLevels(rec.dungeonLevels)) continue;
    if (rec.dungeonLevels.some((level) => level >= PACKED_DUNGEON_KEY_SATURATION_MIN)) {
      throw new AddonDbFormatError(
        "KEY_FIELD_SATURATION",
        `Decoded dungeon key ${Math.max(...rec.dungeonLevels)} sits in the ${PACKED_DUNGEON_KEY_SATURATION_MIN}–63 tail of the 6-bit packed field`,
      );
    }
    const medianKey = characterMedianOfEightLevels(rec.dungeonLevels);
    histogram.set(medianKey, (histogram.get(medianKey) ?? 0) + 1);
    decoded.push({
      realm: row.realm,
      name: row.name,
      medianKey,
      rioScore: rec.currentScore,
    });
  }

  if (decoded.length === 0) {
    return { candidates: [], thresholdMedianKey: 0, scanned: input.named.length, eligible: 0 };
  }

  const thresholdMedianKey = empiricalCdfQuantile(histogram, input.percentileBps);
  const relevant = decoded
    .filter((row) => row.medianKey + 1e-12 >= thresholdMedianKey)
    .sort((a, b) => b.rioScore - a.rioScore || b.medianKey - a.medianKey);

  const max = input.maxCandidates ?? relevant.length;
  return {
    candidates: relevant.slice(0, max),
    thresholdMedianKey,
    scanned: input.named.length,
    eligible: relevant.length,
  };
}
