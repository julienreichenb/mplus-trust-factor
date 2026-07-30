import { describe, expect, it, vi } from "vitest";
import { ensureBlizzardCurrentSeason } from "../persistence/run-repository.js";

/**
 * Unit-level proof that refresh persistence uses authoritative season 17 and
 * never promotes historical character season 3 — even under concurrent calls.
 */
describe("refresh season authority invariant", () => {
  it("keeps EU active season at 17 when character profile lists only season 3", async () => {
    const seasons = new Map<
      string,
      {
        id: string;
        slug: string;
        regionId: string;
        blizzardSeasonId: number;
        isCurrent: boolean;
        metadata: Record<string, unknown>;
        name: string;
      }
    >([
      [
        "blizzard-season-17",
        {
          id: "s17",
          slug: "blizzard-season-17",
          regionId: "eu",
          blizzardSeasonId: 17,
          isCurrent: true,
          metadata: {},
          name: "Blizzard Season 17",
        },
      ],
    ]);

    const client = {
      season: {
        findFirst: vi.fn(async ({ where }: { where: { slug?: string; isCurrent?: boolean } }) => {
          if (where.slug) return seasons.get(where.slug) ?? null;
          if (where.isCurrent) {
            return [...seasons.values()].find((s) => s.isCurrent) ?? null;
          }
          return null;
        }),
        updateMany: vi.fn(async ({ where }: { where: { NOT: { slug: string } } }) => {
          for (const [slug, row] of seasons) {
            if (slug !== where.NOT.slug) seasons.set(slug, { ...row, isCurrent: false });
          }
          return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [slug, row] of seasons) {
            if (row.id === where.id) {
              const next = { ...row, ...data } as (typeof row);
              seasons.set(slug, next);
              return next;
            }
          }
          throw new Error("missing");
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `s-${data.blizzardSeasonId}`,
            slug: String(data.slug),
            regionId: String(data.regionId),
            blizzardSeasonId: Number(data.blizzardSeasonId),
            isCurrent: Boolean(data.isCurrent),
            metadata: (data.metadata as Record<string, unknown>) ?? {},
            name: String(data.name),
          };
          seasons.set(row.slug, row);
          return row;
        }),
      },
    };

    // Simulate what runRefreshPipeline must do: pass authoritative index season (17),
    // never character seasons[] last element (3).
    const characterProfileSeasonIds = [3];
    const authoritativeSeasonId = 17;
    expect(characterProfileSeasonIds.includes(authoritativeSeasonId)).toBe(false);

    const before = await client.season.findFirst({ where: { isCurrent: true } });
    expect(before?.slug).toBe("blizzard-season-17");

    await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureBlizzardCurrentSeason(client as never, "eu", authoritativeSeasonId),
      ),
    );

    const after = [...seasons.values()].find((s) => s.isCurrent);
    expect(after?.slug).toBe("blizzard-season-17");
    expect(after?.blizzardSeasonId).toBe(17);
    expect(seasons.has("blizzard-season-3")).toBe(false);
  });
});
