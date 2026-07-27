import { describe, expect, it } from "vitest";
import { lookupGrade, renderAddonLua, type AddonLuaShard } from "./generate-lua.js";

const shard: AddonLuaShard = {
  formatVersion: "v1",
  generatedAt: "2026-07-27T10:00:00.000Z",
  region: "EU",
  seasonSlug: "placeholder-current",
  modelKey: "default",
  modelVersion: 1,
  checksum: "abc",
  entries: [
    { region: "EU", realmSlug: "tarren-mill", normalizedName: "aleria", grade: "A", overallScore: 88, confidence: 0.78 },
  ],
};

describe("addon lua exporter", () => {
  it("renders a lookup table with grade only", () => {
    const lua = renderAddonLua(shard);
    expect(lua).toContain('MPlusTrustDB.grades');
    expect(lua).toContain('grade = "A"');
    expect(lua).not.toContain("BLIZZARD");
  });

  it("looks up grades by identity", () => {
    const hit = lookupGrade(shard, "EU", "tarren-mill", "Aleria");
    expect(hit?.grade).toBe("A");
    expect(lookupGrade(shard, "EU", "tarren-mill", "missing")).toBeNull();
  });
});
