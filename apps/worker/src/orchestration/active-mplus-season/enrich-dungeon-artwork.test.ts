import { describe, expect, it, vi } from "vitest";
import type { BlizzardProvider, ProviderFetchContext } from "@mplus/contracts";
import {
  dungeonNeedsArtworkEnrichment,
  enrichSeasonDungeonArtwork,
  mergeDungeonBlizzardArtMetadata,
  readDungeonTileUrl,
} from "./enrich-dungeon-artwork.js";

describe("dungeon artwork metadata helpers", () => {
  it("merges blizzard art without wiping unrelated metadata", () => {
    const merged = mergeDungeonBlizzardArtMetadata(
      { keep: true, blizzard: { prior: 1 } },
      {
        journalInstanceId: 1041,
        tileUrl: "https://render.worldofwarcraft.com/eu/zones/kings-rest-small.jpg",
        mediaFetchedAt: "2026-08-30T00:00:00.000Z",
        mediaSource: "journal-instance-media",
      },
    );
    expect(merged.keep).toBe(true);
    expect((merged.blizzard as Record<string, unknown>).prior).toBe(1);
    expect((merged.blizzard as Record<string, unknown>).journalInstanceId).toBe(1041);
    expect(readDungeonTileUrl(merged)).toBe(
      "https://render.worldofwarcraft.com/eu/zones/kings-rest-small.jpg",
    );
  });

  it("treats attempted enrichment as complete even when tile is null", () => {
    expect(dungeonNeedsArtworkEnrichment({})).toBe(true);
    expect(
      dungeonNeedsArtworkEnrichment({
        blizzard: { mediaFetchedAt: "2026-08-30T00:00:00.000Z", tileUrl: null },
      }),
    ).toBe(false);
  });
});

describe("enrichSeasonDungeonArtwork", () => {
  it("enriches arbitrary future dungeon slugs from mocked journal data", async () => {
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const prisma = {
      seasonDungeon: {
        findMany: async () => [
          {
            dungeon: {
              id: "d1",
              slug: "future-hollow-spire",
              name: "Future Hollow Spire",
              blizzardDungeonId: null,
              mapId: null,
              metadata: { keepMe: true },
            },
          },
          {
            dungeon: {
              id: "d2",
              slug: "already-done",
              name: "Already Done",
              blizzardDungeonId: 1n,
              mapId: 1,
              metadata: {
                blizzard: {
                  journalInstanceId: 1,
                  tileUrl: "https://render.worldofwarcraft.com/eu/zones/already-done-small.jpg",
                  mediaFetchedAt: "2026-01-01T00:00:00.000Z",
                  mediaSource: "journal-instance-media",
                },
              },
            },
          },
        ],
      },
      dungeon: {
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: args.where.id, data: args.data });
          return args.data;
        },
      },
    };

    const blizzard: BlizzardProvider = {
      name: "blizzard",
      getJournalInstanceIndex: async () =>
        ({
          data: [
            {
              journalInstanceId: 9999,
              name: "Future Hollow Spire",
              slug: "future-hollow-spire",
            },
          ],
        }) as never,
      getMythicKeystoneDungeonIndex: async () =>
        ({
          data: [
            {
              blizzardDungeonId: 777,
              slug: "future-hollow-spire",
              name: "Future Hollow Spire",
              mapId: 4242,
            },
          ],
        }) as never,
      getJournalInstanceMedia: async () =>
        ({
          data: {
            journalInstanceId: 9999,
            tileUrl: "https://render.worldofwarcraft.com/eu/zones/future-hollow-spire-small.jpg",
            assets: [
              {
                key: "tile",
                url: "https://render.worldofwarcraft.com/eu/zones/future-hollow-spire-small.jpg",
              },
            ],
          },
        }) as never,
    } as BlizzardProvider;

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const result = await enrichSeasonDungeonArtwork({
      prisma: prisma as never,
      blizzard,
      logger: logger as never,
      seasonId: "season-1",
      regionCode: "EU",
      now: new Date("2026-08-30T12:00:00.000Z"),
    });

    expect(result.enriched).toBe(1);
    expect(result.skipped).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("d1");
    const metadata = updates[0]?.data.metadata as Record<string, unknown>;
    expect(metadata.keepMe).toBe(true);
    expect((metadata.blizzard as Record<string, unknown>).journalInstanceId).toBe(9999);
    expect((metadata.blizzard as Record<string, unknown>).tileUrl).toBe(
      "https://render.worldofwarcraft.com/eu/zones/future-hollow-spire-small.jpg",
    );
    expect(updates[0]?.data.blizzardDungeonId).toBe(777n);
    expect(updates[0]?.data.mapId).toBe(4242);
  });

  it("persists null tile without throwing when media has no assets", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      seasonDungeon: {
        findMany: async () => [
          {
            dungeon: {
              id: "d1",
              slug: "future-hollow-spire",
              name: "Future Hollow Spire",
              blizzardDungeonId: null,
              mapId: null,
              metadata: {},
            },
          },
        ],
      },
      dungeon: {
        update: async (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return args.data;
        },
      },
    };
    const blizzard = {
      name: "blizzard" as const,
      getJournalInstanceIndex: async (_ctx: ProviderFetchContext) =>
        ({
          data: [{ journalInstanceId: 9999, name: "Future Hollow Spire", slug: "future-hollow-spire" }],
        }) as never,
      getMythicKeystoneDungeonIndex: async () => ({ data: [] }) as never,
      getJournalInstanceMedia: async () =>
        ({
          data: { journalInstanceId: 9999, tileUrl: null, assets: [] },
        }) as never,
    } as unknown as BlizzardProvider;

    const result = await enrichSeasonDungeonArtwork({
      prisma: prisma as never,
      blizzard,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      seasonId: "s",
      regionCode: "EU",
    });
    expect(result.enriched).toBe(1);
    expect((updates[0]?.metadata as { blizzard: { tileUrl: null } }).blizzard.tileUrl).toBeNull();
  });
});
