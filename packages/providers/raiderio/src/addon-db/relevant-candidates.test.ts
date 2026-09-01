import { describe, expect, it } from "vitest";
import { encodeCurrentMythicPlusRecord, encodeMythicPlusRecord } from "./fixture.js";
import {
  CURRENT_MYTHICPLUS_LAYOUT,
  LEGACY_MYTHICPLUS_LAYOUT,
  packedMythicPlusRecordSizeBytes,
} from "./packed-layout.js";
import { selectRelevantCandidatesFromAddonSnapshot } from "./relevant-candidates.js";

describe("selectRelevantCandidatesFromAddonSnapshot", () => {
  it("returns upper-percentile characters from one lookup pass (legacy layout)", () => {
    const size = packedMythicPlusRecordSizeBytes(LEGACY_MYTHICPLUS_LAYOUT);
    const low = encodeMythicPlusRecord({
      currentScore: 1000,
      dungeonLevels: [10, 10, 10, 10, 10, 10, 10, 10],
    });
    const high = encodeMythicPlusRecord({
      currentScore: 3200,
      dungeonLevels: [18, 18, 18, 18, 18, 18, 18, 18],
    });
    const lookup = new Uint8Array(size * 2);
    lookup.set(low, 0);
    lookup.set(high, size);
    const named = [
      { realm: "tarren-mill", name: "LowPlayer", byteOffset: 0 },
      { realm: "tarren-mill", name: "TopPlayer", byteOffset: size },
    ];
    const result = selectRelevantCandidatesFromAddonSnapshot({
      lookup,
      named,
      percentileBps: 7500,
      layout: LEGACY_MYTHICPLUS_LAYOUT,
      maxCandidates: 10,
    });
    expect(result.candidates.some((c) => c.name === "TopPlayer")).toBe(true);
    expect(result.candidates.every((c) => c.name !== "LowPlayer")).toBe(true);
  });

  it("decodes current 38-byte packed layout without 57–63 saturation garbage", () => {
    const size = packedMythicPlusRecordSizeBytes(CURRENT_MYTHICPLUS_LAYOUT);
    expect(size).toBe(38);
    const high = encodeCurrentMythicPlusRecord({
      currentScore: 3200,
      dungeonLevels: [18, 18, 18, 18, 18, 18, 18, 18],
    });
    const lookup = new Uint8Array(size);
    lookup.set(high, 0);
    const result = selectRelevantCandidatesFromAddonSnapshot({
      lookup,
      named: [{ realm: "tarren-mill", name: "TopPlayer", byteOffset: 0 }],
      percentileBps: 5000,
      layout: CURRENT_MYTHICPLUS_LAYOUT,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.medianKey).toBe(18);
    expect(result.candidates[0]!.medianKey).toBeLessThan(57);
  });

  it("fail-closes when legacy layout is applied to current 38-byte records", () => {
    const size = packedMythicPlusRecordSizeBytes(CURRENT_MYTHICPLUS_LAYOUT);
    const high = encodeCurrentMythicPlusRecord({
      currentScore: 3200,
      dungeonLevels: [18, 18, 18, 18, 18, 18, 18, 18],
    });
    const lookup = new Uint8Array(size);
    lookup.set(high, 0);
    expect(() =>
      selectRelevantCandidatesFromAddonSnapshot({
        lookup,
        named: [{ realm: "tarren-mill", name: "TopPlayer", byteOffset: 0 }],
        percentileBps: 5000,
        layout: LEGACY_MYTHICPLUS_LAYOUT,
      }),
    ).toThrow(/divisible by recordSizeInBytes|LOOKUP_LENGTH|OFFSET/);
  });
});
