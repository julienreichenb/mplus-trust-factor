import { describe, expect, it } from "vitest";
import { normalizeName, normalizeRealmSlug, normalizeRegion, computeRunFingerprint } from "./index.js";

describe("domain identity normalization", () => {
  it("normalizes unicode confusables with NFKC", () => {
    expect(normalizeName("Ｔｅｓｔ")).toBe("test");
    expect(normalizeRealmSlug("Tarren-Mill")).toBe("tarren-mill");
    expect(normalizeRegion("eu")).toBe("EU");
  });

  it("produces stable run fingerprints", () => {
    const input = {
      region: "EU" as const,
      seasonKey: "season-midnight-s1",
      dungeonKey: "ara-kara",
      completedAtMs: 1_722_000_000_000,
      keyLevel: 12,
      durationMs: 1_980_000,
      rosterCanonicalKeys: ["eu|kazzak|playerb", "eu|tarren-mill|playera"],
    };
    const a = computeRunFingerprint(input);
    const b = computeRunFingerprint({
      ...input,
      rosterCanonicalKeys: ["eu|tarren-mill|playera", "eu|kazzak|playerb"],
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
