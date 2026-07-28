import { describe, expect, it } from "vitest";
import {
  buildCatalogCoverageDiagnostics,
  getAbilityCatalog,
  listSupportedCatalogs,
  spellIdsForCategory,
} from "./index.js";

describe("getAbilityCatalog", () => {
  it("resolves Demonology Warlock with pet interrupt ownership", () => {
    const catalog = getAbilityCatalog({ classSlug: "warlock", specSlug: "demonology", role: "DPS" });
    expect(catalog.supported).toBe(true);
    const interrupts = catalog.rules.filter((r) => r.category === "INTERRUPT");
    expect(interrupts.some((r) => r.sourceOwnership === "PET")).toBe(true);
    expect(spellIdsForCategory(catalog, "INTERRUPT").has(19647)).toBe(true);
  });

  it("resolves melee Warrior Arms interrupt", () => {
    const catalog = getAbilityCatalog({ classSlug: "warrior", specSlug: "arms", role: "DPS" });
    expect(catalog.supported).toBe(true);
    expect(spellIdsForCategory(catalog, "INTERRUPT").has(6552)).toBe(true);
  });

  it("resolves tank Warrior Protection defensives", () => {
    const catalog = getAbilityCatalog({ classSlug: "warrior", specSlug: "protection", role: "TANK" });
    expect(catalog.supported).toBe(true);
    expect(spellIdsForCategory(catalog, "DEFENSIVE_MAJOR").has(871)).toBe(true);
  });

  it("resolves healer Priest Holy dispel without inventing an interrupt", () => {
    const catalog = getAbilityCatalog({ classSlug: "priest", specSlug: "holy", role: "HEALER" });
    expect(catalog.supported).toBe(true);
    expect(spellIdsForCategory(catalog, "DISPEL").has(527)).toBe(true);
    expect(spellIdsForCategory(catalog, "INTERRUPT").size).toBe(0);
  });

  it("returns ABILITY_CATALOG_UNSUPPORTED for unregistered specs (never Warlock fallback)", () => {
    const catalog = getAbilityCatalog({ classSlug: "mage", specSlug: "frost", role: "DPS" });
    expect(catalog.supported).toBe(false);
    expect(catalog.unsupportedReason).toBe("ABILITY_CATALOG_UNSUPPORTED");
    expect(catalog.rules.every((r) => r.classSlug == null)).toBe(true);
    expect(spellIdsForCategory(catalog, "INTERRUPT").size).toBe(0);
  });

  it("exposes catalog coverage diagnostics", () => {
    const diag = buildCatalogCoverageDiagnostics({ classSlug: "warlock", specSlug: "demonology" });
    expect(diag.supported).toBe(true);
    expect(diag.categoryCoverage.INTERRUPT).toBeGreaterThan(0);
    expect(diag.registeredClassSpecs).toEqual(
      expect.arrayContaining(["priest/holy", "warlock/demonology", "warrior/arms", "warrior/protection"]),
    );
    expect(listSupportedCatalogs().length).toBe(4);
  });
});
