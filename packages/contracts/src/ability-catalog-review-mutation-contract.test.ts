import { describe, expect, it } from "vitest";
import {
  decideAbilityCatalogReviewItemRequestSchema,
  updateAbilityCatalogDraftRequestSchema,
  validateAbilityCatalogDraftRequestSchema,
} from "./ability-catalog-review.js";

const sourceFieldPayloads = [
  { cooldownSeconds: 60 },
  { spellIds: [1] },
  { bindings: [{ spellId: 1, role: "PRIMARY_ACTIVATION" }] },
  { provenance: { source: "SIMULATIONCRAFT" } },
  { canonicalKey: "priest.shadow.vampiric-embrace" },
];

describe("ability catalog review mutation schemas", () => {
  it("decide rejects source-owned fields in businessMetadata", () => {
    for (const extra of sourceFieldPayloads) {
      const parsed = decideAbilityCatalogReviewItemRequestSchema.safeParse({
        expectedVersion: 1,
        action: "ACCEPT",
        businessMetadata: { category: "OFFENSIVE_MAJOR", ...extra },
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("decide rejects legacy draft payloads", () => {
    const parsed = decideAbilityCatalogReviewItemRequestSchema.safeParse({
      expectedVersion: 1,
      action: "ACCEPT",
      draft: { category: "OFFENSIVE_MAJOR", spellIds: [1] },
    });
    expect(parsed.success).toBe(false);
  });

  it("updateDraft rejects source-owned fields", () => {
    for (const extra of sourceFieldPayloads) {
      const parsed = updateAbilityCatalogDraftRequestSchema.safeParse({
        expectedVersion: 1,
        businessMetadata: { category: "OFFENSIVE_MAJOR", ...extra },
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("validateDraft rejects broad draft payloads", () => {
    const parsed = validateAbilityCatalogDraftRequestSchema.safeParse({
      draft: { category: "OFFENSIVE_MAJOR", cooldownSeconds: 60 },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts business metadata only", () => {
    expect(
      decideAbilityCatalogReviewItemRequestSchema.safeParse({
        expectedVersion: 1,
        action: "ACCEPT",
        businessMetadata: { category: "OFFENSIVE_MAJOR", availability: "BASELINE" },
      }).success,
    ).toBe(true);
    expect(
      updateAbilityCatalogDraftRequestSchema.safeParse({
        expectedVersion: 1,
        businessMetadata: { category: "OFFENSIVE_MAJOR" },
      }).success,
    ).toBe(true);
    expect(
      validateAbilityCatalogDraftRequestSchema.safeParse({
        businessMetadata: { availability: "TALENT" },
      }).success,
    ).toBe(true);
  });
});
