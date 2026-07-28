import { describe, expect, it } from "vitest";
import {
  getAbilityCatalog,
  getCatalogByVersion,
  getRetailClassMatrix,
  resolveAbilityRule,
  WARLOCK_DEMONOLOGY_CATALOG,
} from "./registry.js";
import { RETAIL_CLASS_MATRIX } from "./catalog/classes-matrix.js";
import {
  CATALOG_GAME_VERSION,
  CURRENT_CATALOG_VERSION,
  CURRENT_CATALOG_VERSION_ID,
} from "./version.js";
import type { CatalogSupportState } from "./types.js";
import {
  effectiveKickCooldownMs,
  rulesForCategory,
  rulesForSpell,
  spellIdsForCategory,
} from "./match.js";
import { buildCoverageReport } from "./coverage.js";

const VALID_SUPPORT_STATES = new Set<CatalogSupportState>([
  "SUPPORTED",
  "PARTIAL",
  "UNSUPPORTED",
  "UNCERTAIN",
]);

describe("registry / getAbilityCatalog", () => {
  it("every Retail class and spec declares an explicit supportState", () => {
    for (const cls of RETAIL_CLASS_MATRIX) {
      expect(VALID_SUPPORT_STATES.has(cls.supportState), `${cls.slug} class`).toBe(true);
      for (const spec of cls.specs) {
        expect(VALID_SUPPORT_STATES.has(spec.supportState), `${cls.slug}/${spec.slug}`).toBe(true);
      }
    }
  });

  it("getRetailClassMatrix returns the same matrix as RETAIL_CLASS_MATRIX", () => {
    expect(getRetailClassMatrix()).toBe(RETAIL_CLASS_MATRIX);
  });

  it.each([
    ["warlock", "demonology", "DPS"],
    ["warrior", "arms", "DPS"],
    ["priest", "holy", "HEALER"],
  ] as const)("resolves catalog for %s/%s (%s)", (classSlug, specSlug, role) => {
    const result = getAbilityCatalog({ classSlug, specSlug, role });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.rules.length).toBeGreaterThan(0);
    expect(result.catalog.version.gameVersion).toBe(CATALOG_GAME_VERSION);
  });

  it("warlock demonology backward-compatible export matches live lookup", () => {
    const live = getAbilityCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      includeShared: true,
    });
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(WARLOCK_DEMONOLOGY_CATALOG.catalogVersion).toBe(live.catalog.catalogVersion);
    expect(WARLOCK_DEMONOLOGY_CATALOG.rules.map((r) => r.canonicalKey).sort()).toEqual(
      live.catalog.rules.map((r) => r.canonicalKey).sort(),
    );
  });

  it("role-aware lookup excludes tank-only defensives for warrior DPS", () => {
    const dps = getAbilityCatalog({ classSlug: "warrior", specSlug: "arms", role: "DPS" });
    const tank = getAbilityCatalog({
      classSlug: "warrior",
      specSlug: "protection",
      role: "TANK",
    });
    expect(dps.ok).toBe(true);
    expect(tank.ok).toBe(true);
    if (!dps.ok || !tank.ok) return;

    const dpsKeys = new Set(dps.catalog.rules.map((r) => r.canonicalKey));
    const tankKeys = new Set(tank.catalog.rules.map((r) => r.canonicalKey));

    expect(dpsKeys.has("warrior.defensive-major.die-by-the-sword")).toBe(true);
    expect(dpsKeys.has("warrior.defensive-major.shield-wall")).toBe(false);
    expect(tankKeys.has("warrior.defensive-major.shield-wall")).toBe(true);
    expect(tankKeys.has("warrior.defensive-major.die-by-the-sword")).toBe(false);
  });

  it("returns UNKNOWN_SPEC for invalid spec without warlock fallback", () => {
    const result = getAbilityCatalog({
      classSlug: "warlock",
      specSlug: "not-a-real-spec",
      role: "DPS",
    });
    expect(result).toEqual({
      ok: false,
      reason: "UNKNOWN_SPEC",
      classSlug: "warlock",
      specSlug: "not-a-real-spec",
      role: "DPS",
    });
    if (result.ok) return;
    expect(result.reason).not.toBe("UNSUPPORTED_VERSION");
  });

  it("returns UNKNOWN_CLASS for invalid class", () => {
    const result = getAbilityCatalog({
      classSlug: "not-a-class",
      specSlug: "demonology",
      role: "DPS",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("UNKNOWN_CLASS");
  });

  it("returns UNSUPPORTED_VERSION for unknown game version pin", () => {
    const result = getAbilityCatalog({
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      gameVersion: "9.0.0",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("UNSUPPORTED_VERSION");
    expect(result.gameVersion).toBe("9.0.0");
  });

  it("mage catalog never includes warlock class rules", () => {
    const result = getAbilityCatalog({ classSlug: "mage", specSlug: "fire", role: "DPS" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const rule of result.catalog.rules) {
      expect(rule.classSlug).not.toBe("warlock");
      expect(rule.canonicalKey.startsWith("warlock.")).toBe(false);
    }
  });

  it("includeRacials toggles shared racial rules", () => {
    const without = getAbilityCatalog({
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      includeRacials: false,
    });
    const withRacials = getAbilityCatalog({
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      includeRacials: true,
    });
    expect(without.ok).toBe(true);
    expect(withRacials.ok).toBe(true);
    if (!without.ok || !withRacials.ok) return;

    const racialCount = (catalog: typeof without.catalog) =>
      catalog.rules.filter((r) => r.canonicalKey.startsWith("shared.racial.")).length;

    expect(racialCount(without.catalog)).toBe(0);
    expect(racialCount(withRacials.catalog)).toBeGreaterThan(0);
  });
});

describe("registry / resolveAbilityRule and match helpers", () => {
  it("resolveAbilityRule finds pummel by spell id", () => {
    const matches = resolveAbilityRule({ spellId: 6552, classSlug: "warrior" });
    expect(matches.some((r) => r.canonicalKey === "warrior.interrupt.pummel")).toBe(true);
  });

  it("rulesForSpell and spellIdsForCategory work on resolved catalog", () => {
    const resolved = getAbilityCatalog({ classSlug: "mage", specSlug: "fire", role: "DPS" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const counterspell = rulesForSpell(resolved.catalog, 2139);
    expect(counterspell.some((r) => r.canonicalKey === "mage.interrupt.counterspell")).toBe(true);

    const interruptIds = spellIdsForCategory(resolved.catalog, "INTERRUPT", {
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(interruptIds.has(2139)).toBe(true);
  });

  it("effectiveKickCooldownMs returns minimum interrupt cooldown", () => {
    const resolved = getAbilityCatalog({ classSlug: "warrior", specSlug: "arms", role: "DPS" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const ms = effectiveKickCooldownMs(resolved.catalog, "warrior", "arms");
    expect(ms).toBe(15_000);

    const interrupts = rulesForCategory(resolved.catalog, "interrupt", {
      classSlug: "warrior",
      specSlug: "arms",
    });
    expect(interrupts.length).toBeGreaterThan(0);
  });

  it("getCatalogByVersion resolves current and historical pins", () => {
    expect(getCatalogByVersion(CATALOG_GAME_VERSION)?.catalogVersion).toBe(
      CURRENT_CATALOG_VERSION_ID,
    );
    expect(getCatalogByVersion(CATALOG_GAME_VERSION)?.version).toEqual(CURRENT_CATALOG_VERSION);

    const historical = getCatalogByVersion("11.1.0");
    expect(historical).not.toBeNull();
    expect(historical!.version.gameVersion).toBe("11.1.0");
    expect(historical!.rules.some((r) => r.classSlug === "warlock")).toBe(true);

    expect(getCatalogByVersion("0.0.0")).toBeNull();
  });

  it("buildCoverageReport covers every matrix spec", () => {
    const report = buildCoverageReport();
    const matrixSpecCount = RETAIL_CLASS_MATRIX.reduce((n, c) => n + c.specs.length, 0);
    expect(report.specs.length).toBe(matrixSpecCount);
    expect(report.totals.canonicalRules).toBeGreaterThan(0);
  });
});
