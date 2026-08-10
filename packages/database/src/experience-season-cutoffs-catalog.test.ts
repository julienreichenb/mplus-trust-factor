import { describe, expect, it } from "vitest";
import {
  emptyExperienceSeasonCutoffsCatalog,
  serializeExperienceSeasonCutoffsCatalog,
  sortCatalogEntries,
  validateExperienceSeasonCutoffsCatalog,
  type ExperienceSeasonCutoffsCatalog,
  type ExperienceSeasonCutoffsCatalogEntry,
} from "./experience-season-cutoffs-catalog.js";
import {
  catalogEntryToRaiderIoSeasonCutoffs,
  seedExperienceSeasonCutoffsFromCatalog,
} from "./seed-experience-season-cutoffs.js";

const EXPERIENCE_POPULATION_POLICY_METADATA_KEY = "experiencePopulationPolicy";

function entry(
  partial: Partial<ExperienceSeasonCutoffsCatalogEntry> &
    Pick<ExperienceSeasonCutoffsCatalogEntry, "region" | "raiderIoSeasonSlug">,
): ExperienceSeasonCutoffsCatalogEntry {
  return {
    blizzardSeasonId: partial.blizzardSeasonId ?? 14,
    name: partial.name ?? "Test Season",
    startsAt: partial.startsAt ?? "2025-01-01T00:00:00.000Z",
    endsAt: partial.endsAt ?? "2025-06-01T00:00:00.000Z",
    closed: true,
    cutoffs: partial.cutoffs ?? {
      p999: 3400,
      p990: 3000,
      p900: 2800,
      p750: 2500,
      p600: 2200,
    },
    totalPopulation: partial.totalPopulation ?? 100_000,
    sourceUpdatedAt: partial.sourceUpdatedAt ?? "2025-06-01T00:00:00.000Z",
    isRemappedSeason: partial.isRemappedSeason ?? false,
    source: partial.source ?? {
      provider: "raiderio",
      schemaVersion: "test",
      collectedAt: "2026-08-10T00:00:00.000Z",
    },
    region: partial.region,
    raiderIoSeasonSlug: partial.raiderIoSeasonSlug,
  };
}

function catalog(
  entries: ExperienceSeasonCutoffsCatalogEntry[],
  catalogVersion = 1,
): ExperienceSeasonCutoffsCatalog {
  return {
    schemaVersion: "experience-season-cutoffs-catalog-v1",
    catalogVersion,
    generatedAt: "2026-08-10T00:00:00.000Z",
    entries,
  };
}

describe("experience season cutoffs catalog validation", () => {
  it("accepts closed real seasons with official quantiles only", () => {
    const validated = validateExperienceSeasonCutoffsCatalog(
      catalog([
        entry({ region: "EU", raiderIoSeasonSlug: "season-df-1", blizzardSeasonId: 11 }),
        entry({ region: "US", raiderIoSeasonSlug: "season-tww-3", blizzardSeasonId: 15 }),
      ]),
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.catalog.entries).toHaveLength(2);
    expect(validated.catalog.entries[0]!.raiderIoSeasonSlug).toBe("season-df-1");
  });

  it("rejects event/non-main season slugs", () => {
    const validated = validateExperienceSeasonCutoffsCatalog(
      catalog([entry({ region: "EU", raiderIoSeasonSlug: "season-tww-1-post" })]),
    );
    expect(validated.ok).toBe(false);
  });

  it("rejects remix/event slug tokens", () => {
    const validated = validateExperienceSeasonCutoffsCatalog(
      catalog([entry({ region: "EU", raiderIoSeasonSlug: "season-remix-1" })]),
    );
    expect(validated.ok).toBe(false);
  });

  it("rejects unknown interpolated quantiles", () => {
    const validated = validateExperienceSeasonCutoffsCatalog(
      catalog([
        entry({
          region: "EU",
          raiderIoSeasonSlug: "season-df-2",
          cutoffs: { p999: 1, p990: 1, p900: 1, p750: 1, p600: 1, p500: 1 } as never,
        }),
      ]),
    );
    expect(validated.ok).toBe(false);
  });

  it("rejects non-monotonic cutoff scores (no interpolation fix-up)", () => {
    const validated = validateExperienceSeasonCutoffsCatalog(
      catalog([
        entry({
          region: "EU",
          raiderIoSeasonSlug: "season-df-3",
          cutoffs: { p999: 2000, p990: 3000 },
        }),
      ]),
    );
    expect(validated.ok).toBe(false);
  });

  it("serializes with deterministic ordering", () => {
    const a = catalog([
      entry({ region: "US", raiderIoSeasonSlug: "season-tww-2" }),
      entry({ region: "EU", raiderIoSeasonSlug: "season-tww-3" }),
      entry({ region: "EU", raiderIoSeasonSlug: "season-df-1" }),
    ]);
    const b = catalog([
      entry({ region: "EU", raiderIoSeasonSlug: "season-df-1" }),
      entry({ region: "EU", raiderIoSeasonSlug: "season-tww-3" }),
      entry({ region: "US", raiderIoSeasonSlug: "season-tww-2" }),
    ]);
    expect(serializeExperienceSeasonCutoffsCatalog(a)).toBe(
      serializeExperienceSeasonCutoffsCatalog(b),
    );
    expect(sortCatalogEntries(a.entries).map((e) => `${e.region}:${e.raiderIoSeasonSlug}`)).toEqual([
      "EU:season-df-1",
      "EU:season-tww-3",
      "US:season-tww-2",
    ]);
  });

  it("preserves p999/p990/p900/p750/p600 semantics into Raider.IO cutoffs DTO", () => {
    const cutoffs = catalogEntryToRaiderIoSeasonCutoffs(
      entry({
        region: "KR",
        raiderIoSeasonSlug: "season-sl-4",
        cutoffs: { p999: 5, p990: 4, p900: 3, p750: 2, p600: 1 },
      }),
    );
    expect(cutoffs.top0_1Percent?.quantile).toBe("p999");
    expect(cutoffs.top1Percent?.quantile).toBe("p990");
    expect(cutoffs.top10Percent?.quantile).toBe("p900");
    expect(cutoffs.top25Percent?.quantile).toBe("p750");
    expect(cutoffs.top40Percent?.quantile).toBe("p600");
    expect(cutoffs.top0_1Percent?.label).toBe("top_0_1_percent");
  });

  it("empty catalog validates", () => {
    expect(validateExperienceSeasonCutoffsCatalog(emptyExperienceSeasonCutoffsCatalog()).ok).toBe(
      true,
    );
  });
});

describe("seedExperienceSeasonCutoffsFromCatalog", () => {
  function createPrismaFake() {
    const regions = [
      { id: "reg-eu", code: "EU" },
      { id: "reg-us", code: "US" },
    ];
    const seasons: Array<{
      id: string;
      regionId: string;
      slug: string;
      blizzardSeasonId: number | null;
      providerSeasonId: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      metadata: Record<string, unknown>;
    }> = [];
    let idSeq = 0;

    return {
      region: {
        findMany: async () => regions,
      },
      season: {
        findFirst: async ({
          where,
        }: {
          where: {
            regionId: string;
            blizzardSeasonId?: number;
            providerSeasonId?: string;
            slug?: string;
          };
        }) => {
          return (
            seasons.find((s) => {
              if (s.regionId !== where.regionId) return false;
              if (where.blizzardSeasonId != null) {
                return s.blizzardSeasonId === where.blizzardSeasonId;
              }
              if (where.providerSeasonId != null) {
                return s.providerSeasonId === where.providerSeasonId;
              }
              if (where.slug != null) return s.slug === where.slug;
              return false;
            }) ?? null
          );
        },
        findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
          const row = seasons.find((s) => s.id === where.id);
          if (!row) throw new Error("missing");
          return { id: row.id, metadata: row.metadata };
        },
        create: async ({
          data,
        }: {
          data: {
            regionId: string;
            slug: string;
            blizzardSeasonId: number | null;
            providerSeasonId: string;
            metadata: Record<string, unknown>;
            startsAt?: Date;
            endsAt?: Date;
          };
        }) => {
          const row = {
            id: `season-${++idSeq}`,
            regionId: data.regionId,
            slug: data.slug,
            blizzardSeasonId: data.blizzardSeasonId,
            providerSeasonId: data.providerSeasonId,
            startsAt: data.startsAt ?? null,
            endsAt: data.endsAt ?? null,
            metadata: data.metadata ?? {},
          };
          seasons.push(row);
          return { id: row.id, metadata: row.metadata };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = seasons.find((s) => s.id === where.id);
          if (!row) throw new Error("missing");
          Object.assign(row, data);
          if (data.metadata) row.metadata = data.metadata as Record<string, unknown>;
          return row;
        },
      },
      _seasons: seasons,
    };
  }

  it("applies catalog idempotently with exact season+region binding", async () => {
    const prisma = createPrismaFake();
    const doc = catalog([
      entry({
        region: "EU",
        raiderIoSeasonSlug: "season-df-1",
        blizzardSeasonId: 11,
      }),
      entry({
        region: "US",
        raiderIoSeasonSlug: "season-tww-3",
        blizzardSeasonId: 15,
      }),
    ]);

    const first = await seedExperienceSeasonCutoffsFromCatalog(prisma as never, {
      catalog: doc,
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    expect(first.results.every((r) => r.status === "APPLIED")).toBe(true);
    expect(prisma._seasons).toHaveLength(2);
    expect(prisma._seasons[0]!.providerSeasonId).toBe("season-df-1");
    expect(prisma._seasons[0]!.blizzardSeasonId).toBe(11);
    expect(prisma._seasons[0]!.metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]).toBeTruthy();

    const second = await seedExperienceSeasonCutoffsFromCatalog(prisma as never, {
      catalog: doc,
      now: new Date("2026-08-10T13:00:00.000Z"),
    });
    expect(second.results.every((r) => r.status === "UNCHANGED")).toBe(true);
    expect(prisma._seasons).toHaveLength(2);
  });

  it("supports cross-expansion entries and refuses older catalog overwrite", async () => {
    const prisma = createPrismaFake();
    const v2 = catalog(
      [
        entry({ region: "EU", raiderIoSeasonSlug: "season-sl-1", blizzardSeasonId: 5 }),
        entry({ region: "EU", raiderIoSeasonSlug: "season-df-1", blizzardSeasonId: 11 }),
        entry({ region: "EU", raiderIoSeasonSlug: "season-tww-3", blizzardSeasonId: 15 }),
      ],
      2,
    );
    await seedExperienceSeasonCutoffsFromCatalog(prisma as never, { catalog: v2 });

    const v1 = catalog(
      [entry({ region: "EU", raiderIoSeasonSlug: "season-tww-3", blizzardSeasonId: 15 })],
      1,
    );
    const older = await seedExperienceSeasonCutoffsFromCatalog(prisma as never, { catalog: v1 });
    expect(older.results[0]?.status).toBe("SKIPPED_OLDER_CATALOG");
  });
});
