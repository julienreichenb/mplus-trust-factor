import { describe, expect, it } from "vitest";
import { queryAdminAbilityCatalog } from "./admin-query.js";

describe("queryAdminAbilityCatalog", () => {
  it("returns catalog summary and pagination", () => {
    const result = queryAdminAbilityCatalog({ limit: 10, page: 1 });
    expect(result.catalogSummary.canonicalRules).toBeGreaterThan(50);
    expect(result.entries.length).toBeLessThanOrEqual(10);
    expect(result.pagination.total).toBeGreaterThan(10);
    expect(result.validationSummary.errorCount).toBe(0);
  });

  it("filters by classSlug", () => {
    const result = queryAdminAbilityCatalog({ classSlug: "warlock", limit: 100 });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.rule.classSlug === "warlock")).toBe(true);
  });

  it("searches by spell id and alias", () => {
    const byId = queryAdminAbilityCatalog({ query: "19647", limit: 20 });
    expect(byId.entries.some((e) => e.rule.spellIds.includes(19647))).toBe(true);

    const byAlias = queryAdminAbilityCatalog({ query: "5512", limit: 20 });
    expect(byAlias.entries.some((e) => e.rule.aliases?.includes(5512))).toBe(true);
  });

  it("filters pet-dependent validation preset", () => {
    const result = queryAdminAbilityCatalog({ validationState: "pet", limit: 50 });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.badges.includes("pet-dependent"))).toBe(true);
  });

  it("includes shared consumable section", () => {
    const result = queryAdminAbilityCatalog({ query: "Healthstone", limit: 20 });
    expect(result.entries.some((e) => e.section === "shared-consumable")).toBe(true);
  });
});
