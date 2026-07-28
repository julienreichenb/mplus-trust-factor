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
  it("upserts index entries idempotently and keeps connected realms distinct", async () => {
    const upserts: string[] = [];
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
      upsertCatalogEntry: vi.fn(async (input: { slug: string }) => {
        upserts.push(input.slug);
        return {};
      }),
      markMissingInactive: vi.fn(async () => 0),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const first = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], forceDetails: true, requestedAt: new Date().toISOString() },
    );
    const second = await syncRealmCatalog(
      { blizzard: blizzard as never, realms: realms as never, logger: logger as never },
      { regions: ["EU"], forceDetails: true, requestedAt: new Date().toISOString() },
    );

    expect(first[0]?.upserted).toBe(2);
    expect(second[0]?.upserted).toBe(2);
    expect(upserts.filter((s) => s === "archimonde")).toHaveLength(2);
    expect(upserts).toContain("hyjal");
    expect(blizzard.getRealm).toHaveBeenCalled();
  });
});
