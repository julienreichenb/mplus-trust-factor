import { describe, expect, it, vi } from "vitest";
import { syncRealmCatalog } from "./sync-realm-catalog.js";

function realmDto(partial: {
  slug: string;
  name: string;
  id: number;
  connectedRealmId?: number;
  isTournament?: boolean;
}) {
  return {
    blizzardRealmId: partial.id,
    slug: partial.slug,
    name: partial.name,
    region: "EU" as const,
    locale: "fr_FR",
    timezone: "Europe/Paris",
    connectedRealmId: partial.connectedRealmId ?? partial.id,
    category: "French",
    isTournament: partial.isTournament === true,
  };
}

describe("syncRealmCatalog", () => {
  it("upserts every index entry without detail calls by default", async () => {
    const indexUpserts: string[] = [];
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [
          { blizzardRealmId: 1, slug: "archimonde", name: "Archimonde" },
          { blizzardRealmId: 2, slug: "hyjal", name: "Hyjal" },
        ],
      })),
      getRealm: vi.fn(async (slug: string) => ({
        data: realmDto({
          slug,
          name: slug === "archimonde" ? "Archimonde" : "Hyjal",
          id: slug === "archimonde" ? 1 : 2,
          connectedRealmId: 1082,
        }),
      })),
    };
    const realms = {
      findCatalogBySlug: vi.fn(async () => null),
      upsertCatalogIndexEntry: vi.fn(async (input: { slug: string }) => {
        indexUpserts.push(input.slug);
        return {};
      }),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 2),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const first = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(first[0]?.indexed).toBe(2);
    expect(first[0]?.minimallyUpserted).toBe(2);
    expect(first[0]?.enriched).toBe(0);
    expect(first[0]?.activeCatalogCount).toBe(2);
    expect(indexUpserts).toEqual(["archimonde", "hyjal"]);
    expect(blizzard.getRealm).not.toHaveBeenCalled();
    expect(realms.upsertCatalogEntry).not.toHaveBeenCalled();
  });

  it("keeps minimal rows when detail enrichment fails under forceDetails", async () => {
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [
          { blizzardRealmId: 1, slug: "archimonde", name: "Archimonde" },
          { blizzardRealmId: 2, slug: "hyjal", name: "Hyjal" },
        ],
      })),
      getRealm: vi.fn(async (slug: string) => {
        if (slug === "hyjal") throw new Error("detail unavailable");
        return {
          data: realmDto({ slug: "archimonde", name: "Archimonde", id: 1, connectedRealmId: 1082 }),
        };
      }),
    };
    const realms = {
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 2),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await syncRealmCatalog(
      {
        blizzard: blizzard as never,
        realms: realms as never,
        logger: logger as never,
        detailConcurrency: 2,
      },
      { regions: ["EU"], forceDetails: true, requestedAt: new Date().toISOString() },
    );

    expect(result[0]?.minimallyUpserted).toBe(2);
    expect(result[0]?.enriched).toBe(1);
    expect(result[0]?.enrichmentFailures).toBe(1);
    expect(realms.upsertCatalogIndexEntry).toHaveBeenCalledTimes(2);
    expect(realms.upsertCatalogEntry).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across repeated index-only syncs", async () => {
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [{ blizzardRealmId: 1, slug: "archimonde", name: "Archimonde" }],
      })),
      getRealm: vi.fn(),
    };
    const realms = {
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 1),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const first = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );
    const second = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(first[0]?.minimallyUpserted).toBe(1);
    expect(second[0]?.minimallyUpserted).toBe(1);
    expect(realms.upsertCatalogIndexEntry).toHaveBeenCalledTimes(2);
    expect(blizzard.getRealm).not.toHaveBeenCalled();
  });

  it("does not hard-delete when markMissingInactive is a no-op", async () => {
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [{ blizzardRealmId: 1, slug: "archimonde", name: "Archimonde" }],
      })),
      getRealm: vi.fn(),
    };
    const realms = {
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 5),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(realms.markMissingInactive).toHaveBeenCalledWith("EU", ["archimonde"], expect.any(Date));
    expect(result[0]?.activeCatalogCount).toBe(5);
  });
});
