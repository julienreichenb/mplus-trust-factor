import { describe, expect, it } from "vitest";
import { inferFightBoundsFromCompactEvents } from "./build-participant-scoring-digest.js";

describe("inferFightBoundsFromCompactEvents", () => {
  it("uses min/max timestamps so mid-report fights are not inflated from 0", () => {
    const fightStart = 5_000_000;
    const fightEnd = 5_300_000;
    const bounds = inferFightBoundsFromCompactEvents([
      { timestampMs: fightStart + 1_000 },
      { timestampMs: fightStart + 150_000 },
      { timestampMs: fightEnd - 500 },
    ]);
    expect(bounds.fightStartMs).toBe(fightStart + 1_000);
    expect(bounds.fightEndMs).toBe(fightEnd - 500);
    expect((bounds.fightEndMs ?? 0) - bounds.fightStartMs).toBeLessThan(400_000);
  });

  it("returns null end when no events", () => {
    expect(inferFightBoundsFromCompactEvents([])).toEqual({
      fightStartMs: 0,
      fightEndMs: null,
    });
  });
});
