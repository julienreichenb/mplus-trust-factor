/**
 * Phase 3B.4 — ALS catalog context seam (one context per analysis).
 */

import { describe, expect, it } from "vitest";
import {
  createStaticAbilityCatalogContext,
  getAbilityCatalog,
  getActiveAbilityCatalogContext,
  resolveAbilityCatalog,
} from "./index.js";
import { runWithAbilityCatalogContext } from "./execution-context.js";

describe("ability catalog execution ALS seam", () => {
  it("outside ALS, registry uses static path", () => {
    expect(getActiveAbilityCatalogContext()).toBeNull();
    const cat = resolveAbilityCatalog({ classSlug: "mage", specSlug: "fire" });
    expect(cat.ok).toBe(true);
  });

  it("inside ALS with static context, registry remains usable (no recursion)", () => {
    const ctx = createStaticAbilityCatalogContext();
    runWithAbilityCatalogContext(ctx, () => {
      expect(getActiveAbilityCatalogContext()).toBe(ctx);
      const catalog = getAbilityCatalog({ classSlug: "deathknight", specSlug: "blood" });
      expect(catalog.supported).toBe(true);
    });
    expect(getActiveAbilityCatalogContext()).toBeNull();
  });
});
