import { describe, expect, it } from "vitest";
import { saveManualCatalogEditRequestSchema } from "./ability-catalog-review.js";

describe("saveManualCatalogEditRequestSchema", () => {
  it("accepts business metadata only", () => {
    const parsed = saveManualCatalogEditRequestSchema.safeParse({
      draft: { category: "OFFENSIVE_MAJOR" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects source-owned fields in draft", () => {
    for (const draft of [
      { category: "OFFENSIVE_MAJOR", cooldownSeconds: 60 },
      { category: "OFFENSIVE_MAJOR", charges: 2 },
      { category: "OFFENSIVE_MAJOR", spellIds: [1] },
      { category: "OFFENSIVE_MAJOR", name: "Fake" },
      { category: "OFFENSIVE_MAJOR", provenance: { source: "SIMULATIONCRAFT" } },
      { category: "OFFENSIVE_MAJOR", classSlug: "mage" },
      { category: "OFFENSIVE_MAJOR", availability: "BASELINE" },
    ]) {
      const parsed = saveManualCatalogEditRequestSchema.safeParse({ draft });
      expect(parsed.success).toBe(false);
    }
  });
});
