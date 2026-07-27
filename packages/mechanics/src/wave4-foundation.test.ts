import { describe, expect, it } from "vitest";
import {
  MIDNIGHT_S1_SEASON,
  estimateAvailableDefensiveUses,
  extractSurvivalCounts,
  extractUtilityCounts,
  hasAbilityCategory,
  isPlaceholderSeasonSlug,
  loadSeedAbilityCatalog,
  loadSeedScoringMechanicCatalog,
  resolveSeasonDungeonSet,
  validateAbilityCatalog,
  validateScoringMechanicCatalog,
} from "./index.js";

describe("wave4 ability + scoring mechanic catalogs", () => {
  it("validates seed ability catalog version", () => {
    const catalog = loadSeedAbilityCatalog();
    expect(validateAbilityCatalog(catalog)).toEqual([]);
    expect(catalog.catalogVersion).toMatch(/^ability-catalog-/);
    expect(catalog.rules.some((r) => r.categories.includes("interrupt"))).toBe(true);
  });

  it("validates seed scoring mechanic catalog version", () => {
    const catalog = loadSeedScoringMechanicCatalog();
    expect(validateScoringMechanicCatalog(catalog)).toEqual([]);
    expect(catalog.catalogVersion).toMatch(/^scoring-mechanic-catalog-/);
    expect(catalog.rules.length).toBeGreaterThan(5);
  });

  it("estimates warlock demo defensive capacity from duration", () => {
    const catalog = loadSeedAbilityCatalog();
    expect(hasAbilityCategory(catalog, "personal_defensive", "warlock", "demonology")).toBe(
      true,
    );
    const uses = estimateAvailableDefensiveUses({
      abilityCatalog: catalog,
      durationMs: 180_000,
      classSlug: "warlock",
      specSlug: "demonology",
    });
    // Unending Resolve 180s → 1; Dark Pact 60s → 3
    expect(uses).toBe(4);
  });

  it("rejects invalid ability catalog versions / rules", () => {
    expect(
      validateAbilityCatalog({
        catalogVersion: "",
        seasonSlug: null,
        rules: [{ spellId: -1, classSlug: "", categories: ["nope" as "interrupt"] }],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe("season dungeon resolution", () => {
  it("resolves eight unique midnight dungeons", () => {
    const season = resolveSeasonDungeonSet({ seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug });
    expect(season.expectedDungeonCount).toBe(8);
    expect(new Set(season.dungeonSlugs).size).toBe(8);
    expect(isPlaceholderSeasonSlug(season.seasonSlug)).toBe(false);
  });

  it("refuses placeholder-current for live selection", () => {
    expect(() => resolveSeasonDungeonSet({ seasonSlug: "placeholder-current" })).toThrow(
      /placeholder/i,
    );
  });
});

describe("raw fact extraction + pet attribution", () => {
  const abilityCatalog = loadSeedAbilityCatalog();
  const mechanicCatalog = loadSeedScoringMechanicCatalog();

  it("attributes pet kick casts to the player set", () => {
    const playerId = 10;
    const petId = 55;
    const attributed = new Set([playerId, petId]);
    const utility = extractUtilityCounts({
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "skyreach",
      targetSourceId: playerId,
      attributedSourceIds: attributed,
      maxHealth: 500_000,
      abilityCatalog,
      mechanicCatalog,
      casts: [
        { abilityGameId: 19647, sourceId: petId, targetId: 99 },
        { abilityGameId: 30283, sourceId: playerId, targetId: 100 },
        { abilityGameId: 30283, sourceId: playerId, targetId: 100 },
      ],
      interrupts: [{ abilityGameId: 19647, sourceId: petId }],
      deaths: [],
      damageTaken: [],
      healing: [],
      dispels: [],
      classSlug: "warlock",
      specSlug: "demonology",
    });
    expect(utility.kickCasts).toBe(1);
    expect(utility.successfulInterrupts).toBe(1);
    expect(utility.effectiveKickCooldownMs).toBe(24_000);
    expect(utility.distinctCcTargets).toBe(1);
  });

  it("never treats unknown damage as avoidable", () => {
    const survival = extractSurvivalCounts({
      seasonSlug: "season-midnight-s1",
      dungeonSlug: "skyreach",
      targetSourceId: 1,
      attributedSourceIds: new Set([1]),
      maxHealth: null,
      abilityCatalog,
      mechanicCatalog,
      casts: [],
      interrupts: [],
      deaths: [{ targetId: 1 }],
      damageTaken: [
        { targetId: 1, abilityGameId: 999999, amount: 10_000 },
        { targetId: 1, abilityGameId: 400001, amount: 5_000 },
        { targetId: 1, abilityGameId: 400002, amount: 8_000 },
      ],
      healing: [],
      dispels: [],
    });
    expect(survival.deaths).toBe(1);
    expect(survival.totalDamageTaken).toBe(23_000);
    expect(survival.avoidableDamageTaken).toBe(5_000);
  });
});
