/**
 * In-memory Prisma-ish harness for active M+ season sync/resolve/transition.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ensurePersistedSeasonDungeonBindings,
  synchronizeActiveMplusSeasonCatalog,
} from "./active-mplus-season/synchronize.js";
import { resolveActiveMythicPlusSeason } from "./active-mplus-season/resolve.js";
import {
  createDefaultMplusZoneCatalogRegistry,
  registerMplusZoneCatalog,
  ZONE_47_MIDNIGHT_S1_CATALOG,
} from "./active-mplus-season/zone-catalog-registry.js";
import { SeasonDungeonBindingsMissingError } from "./active-mplus-season/types.js";
import { ensureSeasonDataReady } from "./active-mplus-season/ensure-season-data-ready.js";
import { evaluateSeasonCatalogReadiness } from "./active-mplus-season/catalog-readiness.js";

type SeasonRow = {
  id: string;
  regionId: string;
  slug: string;
  name: string;
  blizzardSeasonId: number | null;
  isCurrent: boolean;
  dungeonCount: number;
  metadata: Record<string, unknown>;
  startsAt: Date | null;
  endsAt: Date | null;
  updatedAt: Date;
};

type DungeonRow = {
  id: string;
  slug: string;
  name: string;
  wclZoneOrEncounterId: bigint | null;
};

type Binding = { seasonId: string; dungeonId: string; sortOrder: number };

function createFakePrisma() {
  const seasons = new Map<string, SeasonRow>();
  const dungeons = new Map<string, DungeonRow>();
  const bindings: Binding[] = [];
  let seq = 1;

  const prisma = {
    season: {
      async findFirst(args: {
        where: Record<string, unknown>;
        orderBy?: unknown;
      }) {
        const where = args.where;
        const rows = [...seasons.values()].filter((s) => {
          if (where.regionId && s.regionId !== where.regionId) return false;
          if (where.slug && s.slug !== where.slug) return false;
          if (where.blizzardSeasonId != null && s.blizzardSeasonId !== where.blizzardSeasonId) {
            return false;
          }
          if (where.isCurrent != null && s.isCurrent !== where.isCurrent) return false;
          if (where.id && s.id !== where.id) return false;
          if (where.NOT && typeof where.NOT === "object") {
            const not = where.NOT as { id?: string };
            if (not.id && s.id === not.id) return false;
          }
          return true;
        });
        return rows[0] ?? null;
      },
      async findUnique(args: { where: { id: string } }) {
        return seasons.get(args.where.id) ?? null;
      },
      async findMany(args: { where: Record<string, unknown>; orderBy?: unknown; select?: unknown }) {
        const where = args.where;
        return [...seasons.values()].filter((s) => {
          if (where.regionId && s.regionId !== where.regionId) return false;
          if (where.isCurrent != null && s.isCurrent !== where.isCurrent) return false;
          if (where.NOT && typeof where.NOT === "object") {
            const not = where.NOT as { id?: string };
            if (not.id && s.id === not.id) return false;
          }
          return true;
        });
      },
      async create(args: { data: Partial<SeasonRow> }) {
        const row: SeasonRow = {
          id: `season-${seq++}`,
          regionId: String(args.data.regionId),
          slug: String(args.data.slug),
          name: String(args.data.name ?? args.data.slug),
          blizzardSeasonId: (args.data.blizzardSeasonId as number | null) ?? null,
          isCurrent: Boolean(args.data.isCurrent),
          dungeonCount: Number(args.data.dungeonCount ?? 0),
          metadata: (args.data.metadata as Record<string, unknown>) ?? {},
          startsAt: null,
          endsAt: null,
          updatedAt: new Date(),
        };
        seasons.set(row.id, row);
        return row;
      },
      async update(args: { where: { id: string }; data: Partial<SeasonRow> }) {
        const row = seasons.get(args.where.id);
        if (!row) throw new Error("missing season");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      },
      async updateMany(args: {
        where: Record<string, unknown>;
        data: Partial<SeasonRow>;
      }) {
        let count = 0;
        for (const row of seasons.values()) {
          if (args.where.regionId && row.regionId !== args.where.regionId) continue;
          if (args.where.isCurrent != null && row.isCurrent !== args.where.isCurrent) {
            continue;
          }
          if (args.where.NOT && typeof args.where.NOT === "object") {
            const not = args.where.NOT as { id?: string };
            if (not.id && row.id === not.id) continue;
          }
          Object.assign(row, args.data);
          count += 1;
        }
        return { count };
      },
    },
    dungeon: {
      async upsert(args: {
        where: { slug: string };
        create: { slug: string; name: string };
        update: { name: string };
      }) {
        const existing = [...dungeons.values()].find((d) => d.slug === args.where.slug);
        if (existing) {
          existing.name = args.update.name;
          return existing;
        }
        const row: DungeonRow = {
          id: `dungeon-${seq++}`,
          slug: args.create.slug,
          name: args.create.name,
          wclZoneOrEncounterId: null,
        };
        dungeons.set(row.id, row);
        return row;
      },
      async update(args: {
        where: { id: string };
        data: { wclZoneOrEncounterId?: bigint };
      }) {
        const row = dungeons.get(args.where.id);
        if (!row) throw new Error("missing dungeon");
        if (args.data.wclZoneOrEncounterId !== undefined) {
          row.wclZoneOrEncounterId = args.data.wclZoneOrEncounterId;
        }
        return row;
      },
    },
    seasonDungeon: {
      async findUnique(args: {
        where: { seasonId_dungeonId: { seasonId: string; dungeonId: string } };
      }) {
        const key = args.where.seasonId_dungeonId;
        return (
          bindings.find(
            (b) => b.seasonId === key.seasonId && b.dungeonId === key.dungeonId,
          ) ?? null
        );
      },
      async findMany(args: {
        where: { seasonId: string };
        include?: { dungeon: boolean };
        orderBy?: unknown;
      }) {
        return bindings
          .filter((b) => b.seasonId === args.where.seasonId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((b) => ({
            ...b,
            dungeon: dungeons.get(b.dungeonId)!,
          }));
      },
      async create(args: { data: Binding }) {
        bindings.push({ ...args.data });
        return args.data;
      },
      async update(args: {
        where: { seasonId_dungeonId: { seasonId: string; dungeonId: string } };
        data: { sortOrder: number };
      }) {
        const key = args.where.seasonId_dungeonId;
        const row = bindings.find(
          (b) => b.seasonId === key.seasonId && b.dungeonId === key.dungeonId,
        );
        if (!row) throw new Error("missing binding");
        row.sortOrder = args.data.sortOrder;
        return row;
      },
      async count(args: { where: { seasonId: string } }) {
        return bindings.filter((b) => b.seasonId === args.where.seasonId).length;
      },
      async deleteMany(args: {
        where: { seasonId: string; dungeonId?: { notIn: string[] } };
      }) {
        const keep = args.where.dungeonId?.notIn;
        let removed = 0;
        for (let i = bindings.length - 1; i >= 0; i -= 1) {
          const b = bindings[i]!;
          if (b.seasonId !== args.where.seasonId) continue;
          if (keep && keep.includes(b.dungeonId)) continue;
          bindings.splice(i, 1);
          removed += 1;
        }
        return { count: removed };
      },
    },
    async $transaction(fn: (tx: typeof prisma) => Promise<unknown>) {
      return fn(prisma);
    },
    _seasons: seasons,
    _bindings: bindings,
    _dungeons: dungeons,
  };

  return prisma;
}

describe("active mplus season synchronize + resolve", () => {
  it("empty SeasonDungeon bindings fail closed on resolve", async () => {
    const prisma = createFakePrisma();
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-17",
        name: "S17",
        blizzardSeasonId: 17,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    await expect(
      resolveActiveMythicPlusSeason({
        prisma: prisma as never,
        regionCode: "EU",
        regionId: "region-eu",
        resolutionMode: "AUTO",
      }),
    ).rejects.toBeInstanceOf(SeasonDungeonBindingsMissingError);
  });

  it("AUTO resolves the synchronized validated season", async () => {
    const prisma = createFakePrisma();
    // Competing placeholder must not win.
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "placeholder-current",
        name: "placeholder",
        isCurrent: true,
        dungeonCount: 8,
        metadata: {},
      },
    });

    const sync = await synchronizeActiveMplusSeasonCatalog({
      prisma: prisma as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      activate: true,
    });
    expect(sync.activated).toBe(true);
    expect(sync.dungeonSlugs).toHaveLength(8);
    expect(sync.wclZoneId).toBe(47);

    const authority = await resolveActiveMythicPlusSeason({
      prisma: prisma as never,
      regionCode: "EU",
      regionId: "region-eu",
      resolutionMode: "AUTO",
      diagnosticExpectedZoneId: 47,
    });
    expect(authority.resolutionMode).toBe("AUTO");
    expect(authority.wclZoneId).toBe(47);
    expect(authority.activeDungeonSlugs).toHaveLength(8);
    expect(authority.expectedSlotCount).toBe(16);
    expect(authority.catalogSource).toBe("season_dungeon_bindings");
    expect(authority.diagnosticZoneMatch).toBe(true);
    expect(authority.lastKnownGood).toBe(true);

    const currents = [...prisma._seasons.values()].filter((s) => s.isCurrent);
    expect(currents).toHaveLength(1);
    expect(currents[0]?.slug).toBe("blizzard-season-17");
  });

  it("PINNED resolves the configured zone catalog", async () => {
    const prisma = createFakePrisma();
    await synchronizeActiveMplusSeasonCatalog({
      prisma: prisma as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      wclZoneId: 47,
      activate: true,
    });
    const authority = await resolveActiveMythicPlusSeason({
      prisma: prisma as never,
      regionCode: "EU",
      regionId: "region-eu",
      resolutionMode: "PINNED",
      pinnedWclZoneId: 47,
    });
    expect(authority.resolutionMode).toBe("PINNED");
    expect(authority.wclZoneId).toBe(47);
  });

  it("complete future mappings activate automatically; incomplete block", async () => {
    const prisma = createFakePrisma();
    const registry = createDefaultMplusZoneCatalogRegistry();
    registerMplusZoneCatalog(registry, {
      wclZoneId: 99,
      blizzardSeasonId: 18,
      expansionIdentity: "Future",
      displayName: "Future S2",
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

    await synchronizeActiveMplusSeasonCatalog({
      prisma: prisma as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      registry,
      activate: true,
    });

    // New season detected but incomplete registry for blizzard 19 → fail.
    await expect(
      synchronizeActiveMplusSeasonCatalog({
        prisma: prisma as never,
        regionId: "region-eu",
        regionCode: "EU",
        blizzardSeasonId: 19,
        registry,
        activate: true,
      }),
    ).rejects.toMatchObject({ code: "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE" });

    // Previous season remains current while unresolved.
    const stillCurrent = [...prisma._seasons.values()].filter((s) => s.isCurrent);
    expect(stillCurrent.map((s) => s.slug)).toEqual(["blizzard-season-17"]);

    const activated = await synchronizeActiveMplusSeasonCatalog({
      prisma: prisma as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 18,
      registry,
      activate: true,
    });
    expect(activated.operationalState).toBe("NEW_SEASON_ACTIVATED");
    expect(activated.dungeonSlugs).toHaveLength(9);

    const authority = await resolveActiveMythicPlusSeason({
      prisma: prisma as never,
      regionCode: "EU",
      regionId: "region-eu",
      resolutionMode: "AUTO",
    });
    expect(authority.wclZoneId).toBe(99);
    expect(authority.expectedSlotCount).toBe(18);
    expect(authority.blizzardSeasonId).toBe(18);

    const currents = [...prisma._seasons.values()].filter((s) => s.isCurrent);
    expect(currents).toHaveLength(1);
    expect(currents[0]?.slug).toBe("blizzard-season-18");
  });

  it("placeholder-current cannot outrank a validated season", async () => {
    const prisma = createFakePrisma();
    await synchronizeActiveMplusSeasonCatalog({
      prisma: prisma as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      activate: true,
    });
    // Re-introduce placeholder as isCurrent — resolve still prefers validated.
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "placeholder-current",
        name: "placeholder",
        isCurrent: true,
        dungeonCount: 8,
        metadata: {},
      },
    });
    // Two isCurrent: validated + placeholder. findCurrentValidatedSeasons filters placeholder.
    // But if both are isCurrent and only one validated, OK.
    // Force both isCurrent:
    for (const s of prisma._seasons.values()) {
      if (s.slug === "blizzard-season-17") s.isCurrent = true;
    }
    const authority = await resolveActiveMythicPlusSeason({
      prisma: prisma as never,
      regionCode: "EU",
      regionId: "region-eu",
      resolutionMode: "AUTO",
    });
    expect(authority.seasonSlug).toBe("blizzard-season-17");
  });
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("ensureSeasonDataReady", () => {
  it("hydrates empty historical Season 17 catalog without flipping isCurrent", async () => {
    const prisma = createFakePrisma();
    const current = await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-18",
        name: "S18",
        blizzardSeasonId: 18,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    const historical = await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-17",
        name: "S17",
        blizzardSeasonId: 17,
        isCurrent: false,
        dungeonCount: 0,
        metadata: {},
      },
    });
    expect(await prisma.seasonDungeon.count({ where: { seasonId: historical.id } })).toBe(0);

    const dist = vi.fn(async () => undefined);
    const first = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      selectionMode: "PINNED",
      requestDistributionRefresh: dist,
    });
    expect(first.catalogReadyBefore).toBe(false);
    expect(first.catalogReadyAfter).toBe(true);
    expect(first.activated).toBe(false);
    expect(first.dungeonCount).toBe(8);
    expect(first.expectedDungeonCount).toBe(8);
    expect(first.wclZoneId).toBe(47);
    expect(first.catalogSource).toBe("zone_catalog_registry");
    expect(first.status).toBe("ready");
    expect(dist).toHaveBeenCalledTimes(1);

    const readiness = await evaluateSeasonCatalogReadiness(
      prisma as never,
      prisma._seasons.get(historical.id)!,
    );
    expect(readiness.ready).toBe(true);
    expect(await prisma.seasonDungeon.count({ where: { seasonId: historical.id } })).toBe(8);
    expect(prisma._seasons.get(historical.id)?.isCurrent).toBe(false);
    expect(prisma._seasons.get(current.id)?.isCurrent).toBe(true);
    expect(prisma._seasons.get(historical.id)?.dungeonCount).toBe(8);

    const second = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      selectionMode: "PINNED",
      requestDistributionRefresh: dist,
    });
    expect(second.skippedReady).toBe(true);
    expect(second.catalogSynced).toBe(false);
    expect(await prisma.seasonDungeon.count({ where: { seasonId: historical.id } })).toBe(8);
    expect(prisma._dungeons.size).toBe(ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs.length);
  });

  it("repairs AUTO incomplete catalog from registry and requests distribution only after ready", async () => {
    const prisma = createFakePrisma();
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-17",
        name: "S17",
        blizzardSeasonId: 17,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    const dist = vi.fn(async () => undefined);
    const result = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      selectionMode: "AUTO",
      requestDistributionRefresh: dist,
    });
    expect(result.catalogReadyAfter).toBe(true);
    expect(result.dungeonCount).toBe(8);
    expect(dist).toHaveBeenCalledTimes(1);
  });

  it("does not request distribution when catalog cannot be resolved", async () => {
    const prisma = createFakePrisma();
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-99",
        name: "Future",
        blizzardSeasonId: 99,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    const dist = vi.fn(async () => undefined);
    const discoverer = vi.fn(async () => {
      throw new Error("should not be used for PINNED");
    });
    const result = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 99,
      selectionMode: "PINNED",
      discoverActiveMplusCatalog: discoverer,
      requestDistributionRefresh: dist,
    });
    expect(result.catalogReadyAfter).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.reasons.join(" ")).toMatch(/authoritative_catalog_unavailable|CATALOG_INCOMPLETE/);
    expect(discoverer).not.toHaveBeenCalled();
    expect(dist).not.toHaveBeenCalled();
    expect(await prisma.seasonDungeon.count({
      where: { seasonId: [...prisma._seasons.values()].find((s) => s.blizzardSeasonId === 99)!.id },
    })).toBe(0);
  });

  it("repairs stale AUTO S18 catalog copied from S17 and skips only when genuinely correct", async () => {
    const prisma = createFakePrisma();
    const s17Meta = {
      schemaVersion: "active-mplus-catalog-v1" as const,
      wclZoneId: 47,
      blizzardSeasonId: 17,
      expansionIdentity: "Midnight",
      dungeonPoolHash: "ignored-for-test",
      sourceMetadataHash: "src",
      catalogVersion: "v1",
      dungeonSlugs: [...ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs],
      synchronizedAt: "2026-08-01T00:00:00.000Z",
      validatedAt: "2026-08-01T00:00:00.000Z",
      lastKnownGood: true,
      authorityVersion: "active-mplus-season-authority-v1",
    };
    const s18 = await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-18",
        name: "S18",
        blizzardSeasonId: 18,
        isCurrent: true,
        dungeonCount: 8,
        metadata: {
          activeMplusCatalog: {
            ...s17Meta,
            blizzardSeasonId: 18,
          },
        },
      },
    });
    for (let i = 0; i < ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs.length; i++) {
      const slug = ZONE_47_MIDNIGHT_S1_CATALOG.dungeonSlugs[i]!;
      const d = await prisma.dungeon.upsert({
        where: { slug },
        create: { slug, name: slug },
        update: { name: slug },
      });
      await prisma.seasonDungeon.create({
        data: { seasonId: s18.id, dungeonId: d.id, sortOrder: i },
      });
    }

    const s18Slugs = [
      "altar-of-fangs",
      "den-of-nalorakk",
      "kings-rest",
      "murder-row",
      "ruby-life-pools",
      "temple-of-sethraliss",
      "the-blinding-vale",
      "voidscar-arena",
    ];
    const discoverer = vi.fn(async ({ blizzardSeasonId }: { blizzardSeasonId: number }) => ({
      wclZoneId: 55,
      blizzardSeasonId,
      expansionIdentity: "Midnight",
      displayName: "Midnight Season 2 Keystone",
      dungeonSlugs: s18Slugs,
      encounterIds: [12993, 12825, 61762, 12813, 112521, 61877, 12859, 12923],
    }));

    const first = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 18,
      selectionMode: "AUTO",
      discoverActiveMplusCatalog: discoverer,
    });
    expect(first.catalogReadyBefore).toBe(false);
    expect(first.skippedReady).toBe(false);
    expect(first.catalogSynced).toBe(true);
    expect(first.catalogReadyAfter).toBe(true);
    expect(first.wclZoneId).toBe(55);
    expect(first.dungeonCount).toBe(8);
    expect(await prisma.seasonDungeon.count({ where: { seasonId: s18.id } })).toBe(8);
    const slugsAfter = (
      await prisma.seasonDungeon.findMany({
        where: { seasonId: s18.id },
        include: { dungeon: true },
        orderBy: { sortOrder: "asc" },
      })
    ).map((b) => b.dungeon.slug);
    expect(slugsAfter).toEqual(s18Slugs);

    const second = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 18,
      selectionMode: "AUTO",
      discoverActiveMplusCatalog: discoverer,
    });
    expect(second.skippedReady).toBe(true);
    expect(second.catalogSynced).toBe(false);
    expect(discoverer.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("creates future-season bindings from an authoritative discovered catalog", async () => {
    const prisma = createFakePrisma();
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-99",
        name: "Future",
        blizzardSeasonId: 99,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    const result = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 99,
      selectionMode: "AUTO",
      discoverActiveMplusCatalog: async ({ blizzardSeasonId }) => ({
        wclZoneId: 200,
        blizzardSeasonId,
        expansionIdentity: "Future",
        displayName: "Future Keystone",
        dungeonSlugs: ["future-one", "future-two"],
        encounterIds: [9001, 9002],
      }),
    });
    expect(result.catalogReadyAfter).toBe(true);
    expect(result.dungeonCount).toBe(2);
    expect(result.wclZoneId).toBe(200);
    expect(result.catalogSource).toBe("warcraftlogs_world_data");
    const seasonId = [...prisma._seasons.values()].find((s) => s.blizzardSeasonId === 99)!.id;
    expect(await prisma.seasonDungeon.count({ where: { seasonId } })).toBe(2);
    const again = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 99,
      selectionMode: "AUTO",
    });
    expect(again.skippedReady).toBe(true);
    expect(await prisma.seasonDungeon.count({ where: { seasonId } })).toBe(2);
  });

  it("keeps a valid catalog when distribution refresh fails", async () => {
    const prisma = createFakePrisma();
    await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-17",
        name: "S17",
        blizzardSeasonId: 17,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    const result = await ensureSeasonDataReady({
      prisma: prisma as never,
      logger: silentLogger() as never,
      regionId: "region-eu",
      regionCode: "EU",
      blizzardSeasonId: 17,
      selectionMode: "AUTO",
      requestDistributionRefresh: async () => {
        throw new Error("addon ingest failed");
      },
    });
    expect(result.catalogReadyAfter).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.distributionError).toMatch(/addon ingest failed/);
    const seasonId = [...prisma._seasons.values()].find((s) => s.blizzardSeasonId === 17)!.id;
    expect(await prisma.seasonDungeon.count({ where: { seasonId } })).toBe(8);
  });

  it("ensurePersistedSeasonDungeonBindings does not activate historical seasons", async () => {
    const prisma = createFakePrisma();
    const current = await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-18",
        name: "S18",
        blizzardSeasonId: 18,
        isCurrent: true,
        dungeonCount: 0,
        metadata: {},
      },
    });
    const historical = await prisma.season.create({
      data: {
        regionId: "region-eu",
        slug: "blizzard-season-17",
        name: "S17",
        blizzardSeasonId: 17,
        isCurrent: false,
        dungeonCount: 0,
        metadata: {},
      },
    });
    await ensurePersistedSeasonDungeonBindings({
      prisma: prisma as never,
      regionId: "region-eu",
      regionCode: "EU",
      seasonId: historical.id,
      blizzardSeasonId: 17,
    });
    expect(prisma._seasons.get(historical.id)?.isCurrent).toBe(false);
    expect(prisma._seasons.get(current.id)?.isCurrent).toBe(true);
    expect(await prisma.seasonDungeon.count({ where: { seasonId: historical.id } })).toBe(8);
  });
});
