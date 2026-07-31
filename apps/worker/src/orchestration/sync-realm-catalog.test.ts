import { describe, expect, it, vi } from "vitest";
import { syncRealmCatalog } from "./sync-realm-catalog.js";

function realmDto(partial: {
  slug: string;
  name: string;
  id: number;
  connectedRealmId?: number | null;
  isTournament?: boolean;
}) {
  return {
    blizzardRealmId: partial.id,
    slug: partial.slug,
    name: partial.name,
    region: "EU" as const,
    locale: "en_GB",
    timezone: "Europe/Paris",
    connectedRealmId: partial.connectedRealmId === undefined ? partial.id : partial.connectedRealmId,
    category: "English",
    isTournament: partial.isTournament === true,
  };
}

describe("syncRealmCatalog", () => {
  it("activates only eligible realms and deactivates internal index entries", async () => {
    const catalog = new Map<string, { isActive: boolean; blizzardRealmId: number; connectedRealmId: number | null; isTournament: boolean }>();
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [
          { blizzardRealmId: 1, slug: "argent-dawn", name: "Argent Dawn" },
          { blizzardRealmId: 2, slug: "kazzak", name: "Kazzak" },
          { blizzardRealmId: 3, slug: "eu1a1inst", name: "EU1A1-INST" },
          { blizzardRealmId: 4, slug: "eu1a-account-realm", name: "EU1A Account Realm" },
          { blizzardRealmId: 5, slug: "eu-arena-pass-csbg", name: "EU Arena Pass CSBG" },
          { blizzardRealmId: 6, slug: "tourney", name: "Tourney Fake" },
        ],
      })),
      getRealm: vi.fn(async (slug: string) => {
        if (slug === "tourney") {
          return { data: realmDto({ slug, name: "Tourney Fake", id: 6, isTournament: true }) };
        }
        if (slug === "argent-dawn") {
          return { data: realmDto({ slug, name: "Argent Dawn", id: 1, connectedRealmId: 100 }) };
        }
        if (slug === "kazzak") {
          return { data: realmDto({ slug, name: "Kazzak", id: 2, connectedRealmId: 200 }) };
        }
        throw new Error(`unexpected detail ${slug}`);
      }),
    };
    const realms = {
      findCatalogBySlug: vi.fn(async (_region: string, slug: string) => {
        const row = catalog.get(slug);
        if (!row) return null;
        return {
          isActive: row.isActive,
          blizzardRealmId: BigInt(row.blizzardRealmId),
          connectedRealmId: row.connectedRealmId == null ? null : BigInt(row.connectedRealmId),
          isTournament: row.isTournament,
          locale: null,
          timezone: null,
          category: null,
        };
      }),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async (input: {
        slug: string;
        isActive?: boolean;
        blizzardRealmId: number;
        connectedRealmId: number | null;
        isTournament: boolean;
      }) => {
        catalog.set(input.slug, {
          isActive: input.isActive !== false,
          blizzardRealmId: input.blizzardRealmId,
          connectedRealmId: input.connectedRealmId,
          isTournament: input.isTournament,
        });
        return {};
      }),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () =>
        [...catalog.values()].filter((r) => r.isActive && !r.isTournament).length,
      ),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const [result] = await syncRealmCatalog(
      {
        blizzard: blizzard as never,
        realms: realms as never,
        logger: logger as never,
        detailConcurrency: 2,
      },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(result?.indexEntries).toBe(6);
    expect(result?.rejectedAtIndex).toBe(3); // INST, Account, Arena Pass
    expect(result?.eligible).toBe(2);
    expect(result?.rejectedTournament).toBe(1);
    expect(blizzard.getRealm).toHaveBeenCalledTimes(3); // only non-early-rejected
    expect(catalog.get("argent-dawn")?.isActive).toBe(true);
    expect(catalog.get("kazzak")?.isActive).toBe(true);
    expect(catalog.get("eu1a1inst")?.isActive).toBe(false);
    expect(catalog.get("eu1a-account-realm")?.isActive).toBe(false);
    expect(catalog.get("tourney")?.isActive).toBe(false);
  });

  it("retains last-known-good when detail fails for a previously validated realm", async () => {
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [
          { blizzardRealmId: 1, slug: "silvermoon", name: "Silvermoon" },
          { blizzardRealmId: 2, slug: "tarren-mill", name: "Tarren Mill" },
          { blizzardRealmId: 3, slug: "kazzak", name: "Kazzak" },
          { blizzardRealmId: 4, slug: "twisting-nether", name: "Twisting Nether" },
          { blizzardRealmId: 5, slug: "dentarg", name: "Dentarg" },
        ],
      })),
      getRealm: vi.fn(async (slug: string) => {
        if (slug === "silvermoon") throw new Error("transient");
        return {
          data: realmDto({
            slug,
            name: slug,
            id: slug === "tarren-mill" ? 2 : 3,
            connectedRealmId: 10,
          }),
        };
      }),
    };
    const realms = {
      findCatalogBySlug: vi.fn(async (_r: string, slug: string) => {
        if (slug === "silvermoon") {
          return {
            isActive: true,
            blizzardRealmId: 1n,
            connectedRealmId: 10n,
            isTournament: false,
            locale: "en_GB",
            timezone: null,
            category: null,
          };
        }
        return null;
      }),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 4),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const [result] = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(result?.detailFailures).toBe(1);
    expect(result?.retainedLastKnownGood).toBe(1);
    expect(realms.upsertCatalogIndexEntry).not.toHaveBeenCalledWith(
      expect.objectContaining({ slug: "silvermoon" }),
    );
  });

  it("does not activate a new realm when detail fetch fails", async () => {
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [
          { blizzardRealmId: 1, slug: "brand-new", name: "Brand New" },
          { blizzardRealmId: 2, slug: "kazzak", name: "Kazzak" },
          { blizzardRealmId: 3, slug: "silvermoon", name: "Silvermoon" },
          { blizzardRealmId: 4, slug: "tarren-mill", name: "Tarren Mill" },
          { blizzardRealmId: 5, slug: "dentarg", name: "Dentarg" },
        ],
      })),
      getRealm: vi.fn(async (slug: string) => {
        if (slug === "brand-new") throw new Error("404");
        return { data: realmDto({ slug, name: slug, id: 2, connectedRealmId: 2 }) };
      }),
    };
    const realms = {
      findCatalogBySlug: vi.fn(async () => null),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 4),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const [result] = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(result?.detailFailures).toBe(1);
    expect(realms.upsertCatalogIndexEntry).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "brand-new" }),
    );
  });

  it("skips visibility changes when the index response is not plausible", async () => {
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: [{ blizzardRealmId: 1, slug: "only-one", name: "Only One" }],
      })),
      getRealm: vi.fn(),
    };
    const realms = {
      findCatalogBySlug: vi.fn(),
      upsertCatalogIndexEntry: vi.fn(),
      upsertCatalogEntry: vi.fn(),
      markMissingInactive: vi.fn(),
      countActiveByRegion: vi.fn(async () => 42),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const [result] = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(result?.activeCatalogCount).toBe(42);
    expect(blizzard.getRealm).not.toHaveBeenCalled();
    expect(realms.upsertCatalogEntry).not.toHaveBeenCalled();
  });

  it("respects bounded detail concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slugs = ["a", "b", "c", "d", "e", "f"];
    const blizzard = {
      getRealmIndex: vi.fn(async () => ({
        data: slugs.map((slug, i) => ({
          blizzardRealmId: i + 1,
          slug,
          name: slug.toUpperCase(),
        })),
      })),
      getRealm: vi.fn(async (slug: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return {
          data: realmDto({
            slug,
            name: slug,
            id: slugs.indexOf(slug) + 1,
            connectedRealmId: 1,
          }),
        };
      }),
    };
    const realms = {
      findCatalogBySlug: vi.fn(async () => null),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 6),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await syncRealmCatalog(
      {
        blizzard: blizzard as never,
        realms: realms as never,
        logger: logger as never,
        detailConcurrency: 2,
      },
      { regions: ["EU"], requestedAt: new Date().toISOString() },
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(blizzard.getRealm).toHaveBeenCalledTimes(6);
  });

  it("syncs all retail regions and is idempotent on repeat", async () => {
    const makeIndex = (prefix: string) =>
      [1, 2, 3, 4, 5].map((n) => ({
        blizzardRealmId: n,
        slug: `${prefix}-realm-${n}`,
        name: `${prefix} Realm ${n}`,
      }));
    const blizzard = {
      getRealmIndex: vi.fn(async (ctx: { region: string }) => ({
        data: makeIndex(String(ctx.region).toLowerCase()),
      })),
      getRealm: vi.fn(async (slug: string, ctx: { region: string }) => ({
        data: {
          ...realmDto({
            slug,
            name: slug,
            id: Number(slug.split("-").pop()),
            connectedRealmId: 10,
          }),
          region: ctx.region,
        },
      })),
    };
    const realms = {
      findCatalogBySlug: vi.fn(async () => null),
      upsertCatalogIndexEntry: vi.fn(async () => ({})),
      upsertCatalogEntry: vi.fn(async () => ({})),
      markMissingInactive: vi.fn(async () => 0),
      countActiveByRegion: vi.fn(async () => 5),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const deps = {
      blizzard: blizzard as never,
      realms: realms as never,
      logger: logger as never,
    };

    const first = await syncRealmCatalog(deps, {
      regions: ["EU", "US", "KR", "TW"],
      requestedAt: new Date().toISOString(),
    });
    const second = await syncRealmCatalog(deps, {
      regions: ["EU", "US", "KR", "TW"],
      requestedAt: new Date().toISOString(),
    });

    expect(first.map((r) => r.region)).toEqual(["EU", "US", "KR", "TW"]);
    expect(first.every((r) => r.eligible === 5)).toBe(true);
    expect(second.every((r) => r.eligible === 5)).toBe(true);
    expect(blizzard.getRealmIndex).toHaveBeenCalledTimes(8);
  });
});
