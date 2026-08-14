import { describe, expect, it, vi } from "vitest";
import { ensureBlizzardCurrentSeason } from "./run-repository.js";

describe("ensureBlizzardCurrentSeason", () => {
  it("persists blizzardSeasonId on create", async () => {
    const created: Record<string, unknown>[] = [];
    const client = {
      season: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "new", ...data };
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "new",
          slug: "blizzard-season-17",
          blizzardSeasonId: 17,
          ...data,
        })),
      },
    };

    const season = await ensureBlizzardCurrentSeason(client as never, "region-eu", 17);
    expect(season.blizzardSeasonId).toBe(17);
    expect(created[0]?.blizzardSeasonId).toBe(17);
    expect(created[0]?.slug).toBe("blizzard-season-17");
    expect(created[0]?.isCurrent).toBe(true);
  });

  it("persists blizzardSeasonId on update without clearing dungeon metadata", async () => {
    const client = {
      season: {
        findFirst: vi.fn(async () => ({
          id: "existing",
          slug: "blizzard-season-17",
          regionId: "region-eu",
          metadata: { dungeonSlugs: ["ara-kara"], source: "blizzard" },
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const base = {
            id: "existing",
            slug: "blizzard-season-17",
            regionId: "region-eu",
            metadata: { dungeonSlugs: ["ara-kara"], source: "blizzard" } as Record<string, unknown>,
          };
          return {
            ...base,
            ...data,
            metadata: (data.metadata as Record<string, unknown> | undefined) ?? base.metadata,
          };
        }),
        create: vi.fn(),
      },
    };

    const season = await ensureBlizzardCurrentSeason(client as never, "region-eu", 17);
    expect(client.season.create).not.toHaveBeenCalled();
    expect(client.season.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          blizzardSeasonId: 17,
          isCurrent: true,
          metadata: expect.objectContaining({
            blizzardSeasonId: 17,
            dungeonSlugs: ["ara-kara"],
          }),
        }),
      }),
    );
    expect(season.blizzardSeasonId).toBe(17);
  });

  it("never lets season 3 replace authoritative season 17 across concurrent updates", async () => {
    let currentSlug = "blizzard-season-17";
    const seasons = new Map([
      [
        "blizzard-season-17",
        {
          id: "s17",
          slug: "blizzard-season-17",
          regionId: "region-eu",
          blizzardSeasonId: 17,
          isCurrent: true,
          metadata: {},
        },
      ],
      [
        "blizzard-season-3",
        {
          id: "s3",
          slug: "blizzard-season-3",
          regionId: "region-eu",
          blizzardSeasonId: 3,
          isCurrent: false,
          metadata: {},
        },
      ],
    ]);

    const client = {
      season: {
        findFirst: vi.fn(async ({ where }: { where: { slug?: string; blizzardSeasonId?: number } }) => {
          if (where.blizzardSeasonId != null) {
            for (const row of seasons.values()) {
              if (row.blizzardSeasonId === where.blizzardSeasonId) return row;
            }
          }
          if (where.slug) return seasons.get(where.slug) ?? null;
          return null;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { NOT: { blizzardSeasonId?: number; slug?: string } }; data: { isCurrent: boolean } }) => {
          for (const [slug, row] of seasons) {
            const keep =
              where.NOT.blizzardSeasonId != null
                ? row.blizzardSeasonId === where.NOT.blizzardSeasonId
                : slug === where.NOT.slug;
            if (!keep) {
              seasons.set(slug, { ...row, isCurrent: data.isCurrent });
            }
          }
          return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [slug, row] of seasons) {
            if (row.id === where.id) {
              const next = { ...row, ...data, metadata: data.metadata ?? row.metadata };
              seasons.set(slug, next as typeof row);
              if (data.isCurrent) currentSlug = slug;
              return next;
            }
          }
          return null;
        }),
        create: vi.fn(),
      },
    };

    // Concurrent refreshes all pass authoritative 17 — never character-derived 3.
    await Promise.all([
      ensureBlizzardCurrentSeason(client as never, "region-eu", 17),
      ensureBlizzardCurrentSeason(client as never, "region-eu", 17),
      ensureBlizzardCurrentSeason(client as never, "region-eu", 17),
    ]);

    expect(currentSlug).toBe("blizzard-season-17");
    expect(seasons.get("blizzard-season-17")?.isCurrent).toBe(true);
    expect(seasons.get("blizzard-season-3")?.isCurrent).toBe(false);
  });
});
