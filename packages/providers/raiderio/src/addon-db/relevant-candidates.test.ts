import { describe, expect, it } from "vitest";
import { encodeMythicPlusRecord } from "./fixture.js";
import { selectRelevantCandidatesFromAddonSnapshot } from "./relevant-candidates.js";
import { MYTHICPLUS_RECORD_SIZE_BYTES } from "./types.js";

describe("selectRelevantCandidatesFromAddonSnapshot", () => {
  it("returns upper-percentile characters from one lookup pass", () => {
    const low = encodeMythicPlusRecord({
      currentScore: 1000,
      dungeonLevels: [10, 10, 10, 10, 10, 10, 10, 10],
    });
    const high = encodeMythicPlusRecord({
      currentScore: 3200,
      dungeonLevels: [18, 18, 18, 18, 18, 18, 18, 18],
    });
    const lookup = new Uint8Array(MYTHICPLUS_RECORD_SIZE_BYTES * 2);
    lookup.set(low, 0);
    lookup.set(high, MYTHICPLUS_RECORD_SIZE_BYTES);
    const named = [
      { realm: "tarren-mill", name: "LowPlayer", byteOffset: 1 },
      { realm: "tarren-mill", name: "TopPlayer", byteOffset: MYTHICPLUS_RECORD_SIZE_BYTES + 1 },
    ];
    const result = selectRelevantCandidatesFromAddonSnapshot({
      lookup,
      named,
      percentileBps: 7500,
      maxCandidates: 10,
    });
    expect(result.candidates.some((c) => c.name === "TopPlayer")).toBe(true);
    expect(result.candidates.every((c) => c.name !== "LowPlayer")).toBe(true);
  });
});
