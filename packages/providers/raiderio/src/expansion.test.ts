import { describe, expect, it } from "vitest";
import { buildExpansionResolution, candidateExpansionIds, selectValidatedExpansionId } from "./expansion.js";

describe("expansion resolution", () => {
  it("prefers override then documented current id", () => {
    expect(candidateExpansionIds(99)[0]).toBe(99);
    expect(candidateExpansionIds()[0]).toBe(11);
  });

  it("validates against probed static data", async () => {
    const resolution = await selectValidatedExpansionId({
      nowMs: Date.parse("2026-07-27T10:00:00.000Z"),
      probe: async (id) => (id === 11 ? { seasons: [{ slug: "season-mn-1", is_current: true }] } : null),
    });
    expect(resolution.expansionId).toBe(11);
    expect(resolution.source).toBe("documented_current");
  });

  it("marks old pins as stale", () => {
    const resolution = buildExpansionResolution(11, "documented_current", Date.parse("2027-01-01T00:00:00.000Z"));
    expect(resolution.pinStale).toBe(true);
    expect(resolution.warning).toMatch(/re-verify/i);
  });
});
