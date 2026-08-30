import { describe, expect, it } from "vitest";
import { evaluateSeasonCatalogReadiness } from "./catalog-readiness.js";
import {
  mergeActiveMplusCatalogMetadata,
  type PersistedActiveMplusCatalogMetadata,
} from "./catalog-metadata.js";
import {
  ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  computeDungeonPoolHash,
  computeSourceMetadataHash,
} from "./types.js";
import { ZONE_47_MIDNIGHT_S1_CATALOG } from "./zone-catalog-registry.js";

const S17_SLUGS = [...ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs];
const S18_SLUGS = [
  "altar-of-fangs",
  "den-of-nalorakk",
  "kings-rest",
  "murder-row",
  "ruby-life-pools",
  "temple-of-sethraliss",
  "the-blinding-vale",
  "voidscar-arena",
] as const;

function catalogMeta(input: {
  blizzardSeasonId: number;
  wclZoneId: number;
  dungeonSlugs: readonly string[];
}): PersistedActiveMplusCatalogMetadata {
  const dungeonPoolHash = computeDungeonPoolHash([...input.dungeonSlugs]);
  const catalogVersion = `${ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION}:zone-${input.wclZoneId}:pool-${dungeonPoolHash.slice(0, 12)}`;
  return {
    schemaVersion: "active-mplus-catalog-v1",
    wclZoneId: input.wclZoneId,
    blizzardSeasonId: input.blizzardSeasonId,
    expansionIdentity: "Midnight",
    dungeonPoolHash,
    sourceMetadataHash: computeSourceMetadataHash({
      blizzardSeasonId: input.blizzardSeasonId,
      wclZoneId: input.wclZoneId,
      dungeonPoolHash,
      catalogVersion,
    }),
    catalogVersion,
    dungeonSlugs: [...input.dungeonSlugs],
    synchronizedAt: "2026-08-12T00:00:00.000Z",
    validatedAt: "2026-08-12T00:00:00.000Z",
    lastKnownGood: true,
    authorityVersion: ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  };
}

function createFakePrisma(bindings: Array<{ slug: string; wclEncounterId: number | null }>) {
  const dungeons = new Map(
    bindings.map((b, i) => [
      `dungeon-${i}`,
      { id: `dungeon-${i}`, slug: b.slug, wclZoneOrEncounterId: b.wclEncounterId },
    ]),
  );
  return {
    seasonDungeon: {
      async findMany(_args: { where: { seasonId: string }; orderBy?: unknown; include?: unknown }) {
        return bindings.map((b, sortOrder) => {
          const id = `dungeon-${sortOrder}`;
          return {
            sortOrder,
            dungeon: dungeons.get(id)!,
          };
        });
      },
    },
  };
}

describe("evaluateSeasonCatalogReadiness", () => {
  it("SAME COUNT, WRONG SEASON: S18 row with S17 zone/pool is not ready", async () => {
    const meta = catalogMeta({
      blizzardSeasonId: 18,
      wclZoneId: 47,
      dungeonSlugs: S17_SLUGS,
    });
    const season = {
      id: "season-18",
      slug: "blizzard-season-18",
      blizzardSeasonId: 18,
      dungeonCount: 8,
      metadata: mergeActiveMplusCatalogMetadata({}, meta),
    };
    const prisma = createFakePrisma(
      S17_SLUGS.map((slug, i) => ({
        slug,
        wclEncounterId: ZONE_47_MIDNIGHT_S1_CATALOG.encounterIds[i] ?? null,
      })),
    );
    const result = await evaluateSeasonCatalogReadiness(prisma as never, season);
    expect(result.ready).toBe(false);
    expect(result.dungeonCount).toBe(8);
    expect(result.expectedDungeonCount).toBe(8);
    expect(result.reasons.join(" ")).toMatch(/wcl_zone_season_mismatch/);
  });

  it("AUTO authority: stale persisted pool fails when authoritative S18 catalog differs", async () => {
    const meta = catalogMeta({
      blizzardSeasonId: 18,
      wclZoneId: 47,
      dungeonSlugs: S17_SLUGS,
    });
    const season = {
      id: "season-18",
      slug: "blizzard-season-18",
      blizzardSeasonId: 18,
      dungeonCount: 8,
      metadata: mergeActiveMplusCatalogMetadata({}, meta),
    };
    const prisma = createFakePrisma(
      S17_SLUGS.map((slug, i) => ({
        slug,
        wclEncounterId: ZONE_47_MIDNIGHT_S1_CATALOG.encounterIds[i] ?? null,
      })),
    );
    const result = await evaluateSeasonCatalogReadiness(prisma as never, season, {
      authoritativeCatalog: { wclZoneId: 55, dungeonSlugs: [...S18_SLUGS] },
    });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/authoritative_wcl_zone_mismatch/);
    expect(result.reasons.join(" ")).toMatch(/authoritative_dungeon_slugs_mismatch/);
  });

  it("genuinely correct S18 catalog with matching authority is ready", async () => {
    const meta = catalogMeta({
      blizzardSeasonId: 18,
      wclZoneId: 55,
      dungeonSlugs: S18_SLUGS,
    });
    const season = {
      id: "season-18",
      slug: "blizzard-season-18",
      blizzardSeasonId: 18,
      dungeonCount: 8,
      metadata: mergeActiveMplusCatalogMetadata({}, meta),
    };
    const prisma = createFakePrisma(
      S18_SLUGS.map((slug, i) => ({
        slug,
        wclEncounterId: [12993, 12825, 61762, 12813, 112521, 61877, 12859, 12923][i] ?? null,
      })),
    );
    const result = await evaluateSeasonCatalogReadiness(prisma as never, season, {
      authoritativeCatalog: { wclZoneId: 55, dungeonSlugs: [...S18_SLUGS] },
    });
    expect(result.ready).toBe(true);
    expect(result.dungeonCount).toBe(8);
  });

  it("PINNED S17 historical catalog with zone 47 remains ready without authority", async () => {
    const meta = catalogMeta({
      blizzardSeasonId: 17,
      wclZoneId: 47,
      dungeonSlugs: S17_SLUGS,
    });
    const season = {
      id: "season-17",
      slug: "blizzard-season-17",
      blizzardSeasonId: 17,
      dungeonCount: 8,
      metadata: mergeActiveMplusCatalogMetadata({}, meta),
    };
    const prisma = createFakePrisma(
      S17_SLUGS.map((slug, i) => ({
        slug,
        wclEncounterId: ZONE_47_MIDNIGHT_S1_CATALOG.encounterIds[i] ?? null,
      })),
    );
    const result = await evaluateSeasonCatalogReadiness(prisma as never, season);
    expect(result.ready).toBe(true);
  });
});
