/**
 * In-memory Prisma-ish harness for active M+ season sync/resolve/transition.
 */
import { describe, expect, it } from "vitest";
import {
  synchronizeActiveMplusSeasonCatalog,
} from "./active-mplus-season/synchronize.js";
import { resolveActiveMythicPlusSeason } from "./active-mplus-season/resolve.js";
import {
  createDefaultMplusZoneCatalogRegistry,
  registerMplusZoneCatalog,
} from "./active-mplus-season/zone-catalog-registry.js";
import { SeasonDungeonBindingsMissingError } from "./active-mplus-season/types.js";

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
    },
    async $transaction(fn: (tx: typeof prisma) => Promise<unknown>) {
      return fn(prisma);
    },
    _seasons: seasons,
    _bindings: bindings,
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
