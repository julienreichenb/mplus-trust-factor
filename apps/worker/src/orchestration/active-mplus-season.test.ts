/**
 * Active Mythic+ season authority — AUTO/PINNED, sync, future transition.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  computeDungeonPoolHash,
  expectedSlotsForDungeonCount,
  evaluateScoreModelSeasonShapeCompatibility,
  SCORE_MODEL_V6_MAX_EVIDENCE_SLOTS,
  SeasonDungeonBindingsMissingError,
} from "./active-mplus-season/types.js";
import {
  createDefaultMplusZoneCatalogRegistry,
  createFixtureMplusZoneCatalogRegistry,
  createProductionMplusZoneCatalogRegistry,
  lookupZoneCatalogByBlizzardSeasonId,
  registerMplusZoneCatalog,
  ZONE_47_MIDNIGHT_S1_CATALOG,
  OBSOLETE_TWW_DUNGEON_SLUGS,
} from "./active-mplus-season/zone-catalog-registry.js";
import {
  mergeActiveMplusCatalogMetadata,
  readActiveMplusCatalogMetadata,
} from "./active-mplus-season/catalog-metadata.js";
import { evaluatePublicationEligibility } from "./scoring/run-orchestration/publication-eligibility.js";

describe("active mplus season authority primitives", () => {
  it("derives expected slots as dungeonCount × 2", () => {
    expect(expectedSlotsForDungeonCount(8)).toBe(16);
    expect(expectedSlotsForDungeonCount(9)).toBe(18);
    expect(expectedSlotsForDungeonCount(0)).toBe(0);
  });

  it("blocks publication when score model cannot fit season shape", () => {
    const incompatible = evaluateScoreModelSeasonShapeCompatibility({
      expectedSlotCount: 18,
      maxSupportedEvidenceSlots: SCORE_MODEL_V6_MAX_EVIDENCE_SLOTS,
    });
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) {
      expect(incompatible.code).toBe("SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE");
    }
    expect(
      evaluateScoreModelSeasonShapeCompatibility({ expectedSlotCount: 16 }).ok,
    ).toBe(true);

    const decision = evaluatePublicationEligibility({
      result: {
        expectedSlotCount: 18,
        selectedSlotCount: 18,
        incomplete: false,
        characterDigests: new Array(18).fill({}),
        cacheMisses: [],
        fightFailures: [],
        dimensions: {
          performance: {},
          utility: {},
          survival: {},
          blocked: [],
        },
        manifest: { activeDungeonSlugs: new Array(9).fill("d") },
      } as never,
      scoringModelId: "m",
      scoringPublicationEnabled: false,
      expectedSlotCountFromSeason: 18,
      scoreModelMaxEvidenceSlots: 16,
    });
    expect(decision.reasons).toContain("SCORE_MODEL_SEASON_SHAPE_INCOMPATIBLE");
    expect(decision.eligible).toBe(false);
  });

  it("Midnight zone 47 regression catalog matches expected eight", () => {
    expect(ZONE_47_MIDNIGHT_S1_CATALOG.wclZoneId).toBe(47);
    expect(ZONE_47_MIDNIGHT_S1_CATALOG.blizzardSeasonId).toBe(17);
    expect([...ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs].sort()).toEqual([
      "algethar-academy",
      "magisters-terrace",
      "maisara-caverns",
      "nexus-point-xenas",
      "pit-of-saron",
      "seat-of-the-triumvirate",
      "skyreach",
      "windrunner-spire",
    ]);
    const obsolete = new Set(OBSOLETE_TWW_DUNGEON_SLUGS);
    for (const slug of ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs) {
      expect(obsolete.has(slug)).toBe(false);
    }
  });

  it("deterministic dungeon-pool hash is order-sensitive via joined list", () => {
    const a = computeDungeonPoolHash(["skyreach", "pit-of-saron"]);
    const b = computeDungeonPoolHash(["skyreach", "pit-of-saron"]);
    const c = computeDungeonPoolHash(["pit-of-saron", "skyreach"]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("future season registry + metadata", () => {
  it("registers a future 9-dungeon season without replacing Midnight", () => {
    const registry = createDefaultMplusZoneCatalogRegistry();
    registerMplusZoneCatalog(registry, {
      wclZoneId: 99,
      blizzardSeasonId: 18,
      expansionIdentity: "Future",
      displayName: "Future Season Fixture",
      encounterIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      dungeonSlugs: [
        "future-a",
        "future-b",
        "future-c",
        "future-d",
        "future-e",
        "future-f",
        "future-g",
        "future-h",
        "future-i",
      ],
    });
    expect(registry.get(47)?.dungeonSlugs).toHaveLength(8);
    expect(registry.get(99)?.dungeonSlugs).toHaveLength(9);
    expect(expectedSlotsForDungeonCount(registry.get(99)!.dungeonSlugs.length)).toBe(
      18,
    );
  });

  it("persists and reloads active mplus catalog metadata", () => {
    const slugs = [...ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs];
    const pool = computeDungeonPoolHash(slugs);
    const merged = mergeActiveMplusCatalogMetadata(
      { authoritySource: "season_index.current_season" },
      {
        schemaVersion: "active-mplus-catalog-v1",
        wclZoneId: 47,
        blizzardSeasonId: 17,
        expansionIdentity: "Midnight",
        dungeonPoolHash: pool,
        sourceMetadataHash: "abc",
        catalogVersion: `${ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION}:zone-47`,
        dungeonSlugs: slugs,
        synchronizedAt: new Date().toISOString(),
        validatedAt: new Date().toISOString(),
        lastKnownGood: true,
        authorityVersion: ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
      },
    );
    const read = readActiveMplusCatalogMetadata(merged);
    expect(read?.wclZoneId).toBe(47);
    expect(read?.lastKnownGood).toBe(true);
    expect(read?.dungeonSlugs).toEqual(slugs);
  });
});

describe("production hardcode removal guards", () => {
  it("refresh-pipeline no longer references CURRENT_MPLUS_ZONE_DUNGEON_SLUGS as a value", () => {
    const src = readFileSync(
      join(
        import.meta.dirname,
        "refresh-pipeline.ts",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/raiderioDungeonSlugs:\s*CURRENT_MPLUS_ZONE_DUNGEON_SLUGS/);
    expect(src).not.toMatch(
      /allowedDungeonSlugs:\s*CURRENT_MPLUS_ZONE_DUNGEON_SLUGS/,
    );
    expect(src).toMatch(/SEASON_DUNGEON_BINDINGS_MISSING/);
  });

  it("canary-season does not prefer blizzard-season-17", () => {
    const src = readFileSync(
      join(
        import.meta.dirname,
        "scoring/canary/canary-season.ts",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/blizzardSeasonId:\s*17/);
    expect(src).not.toMatch(/slug:\s*"blizzard-season-17"/);
    expect(src).not.toMatch(/raiderioDungeonSlugs:\s*CURRENT/);
    expect(src).toMatch(/peekEffectiveScoringSeasonRow/);
  });

  it("SeasonDungeonBindingsMissingError fails closed", () => {
    const err = new SeasonDungeonBindingsMissingError("empty");
    expect(err.code).toBe("SEASON_DUNGEON_BINDINGS_MISSING");
  });

  it("N: production registry does not resolve fixture Blizzard 13 / WCL 45", () => {
    const production = createProductionMplusZoneCatalogRegistry();
    expect(lookupZoneCatalogByBlizzardSeasonId(production, 13)).toEqual([]);
    expect(production.get(45)).toBeUndefined();
    const fixture = createFixtureMplusZoneCatalogRegistry();
    expect(lookupZoneCatalogByBlizzardSeasonId(fixture, 13)).toHaveLength(1);
    expect(createDefaultMplusZoneCatalogRegistry().get(45)).toBeUndefined();
  });
});
