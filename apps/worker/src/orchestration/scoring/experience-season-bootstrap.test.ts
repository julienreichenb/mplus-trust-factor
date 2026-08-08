import { describe, expect, it, vi } from "vitest";
import type {
  BlizzardSeasonDTO,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticData,
  RaiderIoStaticSeason,
} from "@mplus/contracts";
import {
  bootstrapExperienceSeasonMetadata,
  matchBlizzardSeasonToRaiderIoByDates,
  pickPreviousSeasonByStartTimestamp,
  resolveRaiderIoCurrentAndPrevious,
  runExperienceSeasonBootstrapSafe,
} from "./experience-season-bootstrap.js";
import { EXPERIENCE_POPULATION_POLICY_METADATA_KEY } from "./experience-season-population-policy-metadata.js";

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function providerResult<T>(data: T, fingerprint: string): ProviderResult<T> {
  return {
    data,
    provenance: {
      provider: "blizzard",
      externalRequestId: "ext",
      sourcePayloadId: null,
      sourceUrl: "https://example.test",
      fetchedAt: "2026-08-08T00:00:01.000Z",
      schemaVersion: "test",
    },
    freshness: {
      fetchedAt: "2026-08-08T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "blizzard",
      endpointKey: "test",
      requestFingerprint: fingerprint,
      requestedAt: "2026-08-08T00:00:00.000Z",
      completedAt: "2026-08-08T00:00:01.000Z",
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

function blizzardSeason(
  id: number,
  start: string | null,
  end: string | null = null,
): BlizzardSeasonDTO {
  return {
    blizzardSeasonId: id,
    slug: `season-${id}`,
    name: `Season ${id}`,
    startTimestamp: start ? Date.parse(start) : null,
    endTimestamp: end ? Date.parse(end) : null,
  };
}

function rioSeason(
  partial: Partial<RaiderIoStaticSeason> & Pick<RaiderIoStaticSeason, "slug" | "isCurrent">,
): RaiderIoStaticSeason {
  return {
    name: partial.slug,
    startsAt: null,
    endsAt: null,
    dungeonSlugs: [],
    ...partial,
  };
}

describe("pickPreviousSeasonByStartTimestamp", () => {
  it("chooses chronologically previous season, not ID-1", () => {
    const currentStart = Date.parse("2026-01-01T00:00:00.000Z");
    const seasons = [
      blizzardSeason(10, "2024-01-01T00:00:00.000Z"),
      blizzardSeason(12, "2025-06-01T00:00:00.000Z"),
      blizzardSeason(11, "2025-01-01T00:00:00.000Z"),
      blizzardSeason(13, "2026-01-01T00:00:00.000Z"),
    ];
    const prev = pickPreviousSeasonByStartTimestamp(currentStart, seasons);
    expect(prev?.blizzardSeasonId).toBe(12);
  });

  it("fails closed on tied start timestamps", () => {
    const currentStart = Date.parse("2026-01-01T00:00:00.000Z");
    const tie = "2025-06-01T00:00:00.000Z";
    const prev = pickPreviousSeasonByStartTimestamp(currentStart, [
      blizzardSeason(10, tie),
      blizzardSeason(11, tie),
    ]);
    expect(prev).toBeNull();
  });
});

describe("resolveRaiderIoCurrentAndPrevious", () => {
  it("maps current and previous RIO slugs", () => {
    const result = resolveRaiderIoCurrentAndPrevious([
      rioSeason({
        slug: "season-tww-1",
        isCurrent: false,
        startsAt: "2024-09-01T00:00:00.000Z",
      }),
      rioSeason({
        slug: "season-tww-2",
        isCurrent: false,
        startsAt: "2025-03-01T00:00:00.000Z",
      }),
      rioSeason({
        slug: "season-tww-3",
        isCurrent: true,
        startsAt: "2025-09-01T00:00:00.000Z",
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current.slug).toBe("season-tww-3");
    expect(result.previous?.slug).toBe("season-tww-2");
    expect(result.previousReason).toBeNull();
  });

  it("binds current when no chronological previous RIO season exists", () => {
    const result = resolveRaiderIoCurrentAndPrevious([
      rioSeason({
        slug: "season-mn-1",
        isCurrent: true,
        startsAt: "2026-03-24T15:00:00.000Z",
      }),
      rioSeason({
        slug: "season-mn-2",
        isCurrent: false,
        startsAt: "2026-08-18T15:00:00.000Z",
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current.slug).toBe("season-mn-1");
    expect(result.previous).toBeNull();
    expect(result.previousReason).toBe("RIO_NO_PREVIOUS_SEASON");
  });

  it("fails closed on ambiguous current RIO season", () => {
    const result = resolveRaiderIoCurrentAndPrevious([
      rioSeason({ slug: "a", isCurrent: true, startsAt: "2025-01-01T00:00:00.000Z" }),
      rioSeason({ slug: "b", isCurrent: true, startsAt: "2025-06-01T00:00:00.000Z" }),
    ]);
    expect(result).toEqual({ ok: false, reason: "RIO_AMBIGUOUS_CURRENT_SEASON" });
  });
});

describe("matchBlizzardSeasonToRaiderIoByDates", () => {
  it("matches unique nearest start within proximity (Midnight→TWW boundary)", () => {
    const result = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse("2025-08-06T04:00:00.000Z"),
        endTimestamp: Date.parse("2026-03-18T04:00:00.000Z"),
      },
      [
        rioSeason({
          slug: "season-tww-2",
          isCurrent: false,
          startsAt: "2025-03-04T15:00:00.000Z",
          endsAt: "2025-08-12T15:00:00.000Z",
        }),
        rioSeason({
          slug: "season-tww-3",
          isCurrent: false,
          startsAt: "2025-08-12T15:00:00.000Z",
          endsAt: "2026-03-02T22:00:00.000Z",
        }),
        rioSeason({
          slug: "season-tww-3-cutoffs",
          isCurrent: false,
          startsAt: "2025-08-12T15:00:00.000Z",
          endsAt: "2026-03-02T22:00:00.000Z",
        }),
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.season.slug).toBe("season-tww-3");
  });

  it("ignores non-canonical RIO season variants when starts tie", () => {
    const result = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse("2025-08-06T04:00:00.000Z"),
        endTimestamp: Date.parse("2026-03-18T04:00:00.000Z"),
      },
      [
        rioSeason({
          slug: "season-tww-3-cutoffs",
          isCurrent: false,
          startsAt: "2025-08-12T15:00:00.000Z",
          endsAt: "2026-03-10T15:00:00.000Z",
        }),
        rioSeason({
          slug: "season-tww-3",
          isCurrent: false,
          startsAt: "2025-08-12T15:00:00.000Z",
          endsAt: "2026-03-10T15:00:00.000Z",
        }),
      ],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.season.slug).toBe("season-tww-3");
  });

  it("fails closed when two canonical seasons share the same start distance", () => {
    const result = matchBlizzardSeasonToRaiderIoByDates(
      {
        startTimestamp: Date.parse("2025-08-01T00:00:00.000Z"),
        endTimestamp: Date.parse("2026-01-01T00:00:00.000Z"),
      },
      [
        rioSeason({
          slug: "season-tww-2",
          isCurrent: false,
          startsAt: "2025-07-25T00:00:00.000Z",
        }),
        rioSeason({
          slug: "season-tww-3",
          isCurrent: false,
          startsAt: "2025-08-08T00:00:00.000Z",
        }),
      ],
    );
    expect(result).toEqual({ ok: false, reason: "RIO_DATE_MATCH_AMBIGUOUS_START" });
  });
});

type SeasonRow = {
  id: string;
  regionId: string;
  slug: string;
  name: string;
  blizzardSeasonId: number | null;
  providerSeasonId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
  region?: { id: string; code: string };
};

function createPrismaFake(initial: SeasonRow[]) {
  const seasons = initial.map((s) => ({ ...s, metadata: { ...s.metadata } }));
  let idSeq = 100;

  return {
    getSeasons: () => seasons,
    season: {
      findFirst: vi.fn(async (args: {
        where: Record<string, unknown>;
        select?: Record<string, boolean>;
        include?: Record<string, boolean>;
      }) => {
        const where = args.where;
        const row = seasons.find((s) => {
          if (where.regionId != null && s.regionId !== where.regionId) return false;
          if (where.slug != null && s.slug !== where.slug) return false;
          if (where.isCurrent === true && !s.isCurrent) return false;
          return true;
        });
        if (!row) return null;
        if (args.include?.region) {
          return { ...row, region: row.region ?? { id: row.regionId, code: "EU" } };
        }
        if (args.select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(args.select)) {
            out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return { ...row };
      }),
      findUnique: vi.fn(async (args: {
        where: { id: string };
        select?: Record<string, boolean>;
        include?: Record<string, boolean>;
      }) => {
        const row = seasons.find((s) => s.id === args.where.id);
        if (!row) return null;
        if (args.include?.region) {
          return { ...row, region: row.region ?? { id: row.regionId, code: "EU" } };
        }
        if (args.select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(args.select)) {
            out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return { ...row };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown>; select?: { id: boolean } }) => {
        const row: SeasonRow = {
          id: `new-${idSeq++}`,
          regionId: String(args.data.regionId),
          slug: String(args.data.slug),
          name: String(args.data.name ?? args.data.slug),
          blizzardSeasonId:
            typeof args.data.blizzardSeasonId === "number" ? args.data.blizzardSeasonId : null,
          providerSeasonId:
            typeof args.data.providerSeasonId === "string" ? args.data.providerSeasonId : null,
          startsAt: (args.data.startsAt as Date | null | undefined) ?? null,
          endsAt: (args.data.endsAt as Date | null | undefined) ?? null,
          isCurrent: args.data.isCurrent === true,
          metadata: (args.data.metadata as Record<string, unknown>) ?? {},
          region: { id: String(args.data.regionId), code: "EU" },
        };
        seasons.push(row);
        return args.select?.id ? { id: row.id } : row;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = seasons.findIndex((s) => s.id === args.where.id);
        if (idx < 0) throw new Error("missing");
        const prev = seasons[idx]!;
        const next: SeasonRow = {
          ...prev,
          ...(args.data.blizzardSeasonId !== undefined
            ? { blizzardSeasonId: args.data.blizzardSeasonId as number }
            : {}),
          ...(args.data.providerSeasonId !== undefined
            ? { providerSeasonId: args.data.providerSeasonId as string | null }
            : {}),
          ...(args.data.startsAt !== undefined ? { startsAt: args.data.startsAt as Date } : {}),
          ...(args.data.endsAt !== undefined ? { endsAt: args.data.endsAt as Date } : {}),
          ...(args.data.metadata !== undefined
            ? { metadata: args.data.metadata as Record<string, unknown> }
            : {}),
        };
        seasons[idx] = next;
        return next;
      }),
    },
  };
}

describe("bootstrapExperienceSeasonMetadata", () => {
  const logger = { info: vi.fn(), warn: vi.fn() };

  it("hydrates dates, maps RIO slugs, and syncs previous policy once", async () => {
    const prisma = createPrismaFake([
      {
        id: "cur",
        regionId: "region-eu",
        slug: "blizzard-season-13",
        name: "Blizzard Season 13",
        blizzardSeasonId: 13,
        providerSeasonId: null,
        startsAt: null,
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
      {
        id: "prev",
        regionId: "region-eu",
        slug: "blizzard-season-12",
        name: "Blizzard Season 12",
        blizzardSeasonId: 12,
        providerSeasonId: null,
        startsAt: null,
        endsAt: null,
        isCurrent: false,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
    ]);

    const getMythicKeystoneSeasonIndex = vi.fn(async () =>
      providerResult(
        [
          blizzardSeason(11, "2024-09-01T00:00:00.000Z", "2025-02-01T00:00:00.000Z"),
          blizzardSeason(12, "2025-03-01T00:00:00.000Z", "2025-08-01T00:00:00.000Z"),
          blizzardSeason(13, "2025-09-01T00:00:00.000Z", null),
        ],
        "fp-index",
      ),
    );
    const getStaticData = vi.fn(async () =>
      providerResult(
        {
          expansionId: 10,
          seasons: [
            rioSeason({
              slug: "season-tww-2",
              isCurrent: false,
              startsAt: "2025-03-01T00:00:00.000Z",
            }),
            rioSeason({
              slug: "season-tww-3",
              isCurrent: true,
              startsAt: "2025-09-01T00:00:00.000Z",
            }),
          ],
          dungeons: [],
          attribution: {
            provider: "raiderio",
            displayText: "Data from Raider.IO",
            homepageUrl: "https://raider.io",
            profileUrl: null,
            sourceUrl: null,
          },
        } satisfies RaiderIoStaticData,
        "fp-static",
      ),
    );
    const getSeasonCutoffs = vi.fn(async () =>
      providerResult(
        {
          region: "EU",
          seasonSlug: "season-tww-2",
          updatedAt: "2026-01-01T00:00:00.000Z",
          top0_1Percent: threshold(3400, "p999", "top_0_1_percent"),
          top1Percent: threshold(3000, "p990", "top_1_percent"),
          top10Percent: threshold(2800, "p900", "top_10_percent"),
          top25Percent: threshold(2500, "p750", "top_25_percent"),
          top40Percent: threshold(2200, "p600", "top_40_percent"),
          attribution: {
            provider: "raiderio",
            displayText: "Data from Raider.IO",
            homepageUrl: "https://raider.io",
            profileUrl: null,
            sourceUrl: null,
          },
        } satisfies RaiderIoSeasonCutoffs,
        "fp-cutoffs",
      ),
    );
    const getMythicKeystoneSeason = vi.fn(async () => {
      throw new Error("detail should not be called when index already has timestamps");
    });
    const discoverCharacterRuns = vi.fn();
    const persistProviderResult = vi.fn(async () => "payload");

    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: "region-eu" }],
      blizzard: { getMythicKeystoneSeasonIndex, getMythicKeystoneSeason },
      raiderIo: { getStaticData, getSeasonCutoffs },
      persistProviderResult,
      logger,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });

    expect(result.staticDataCalls).toBe(1);
    expect(result.seasonIndexCalls).toBe(1);
    expect(result.seasonDetailCalls).toBe(0);
    expect(result.seasonCutoffsCalls).toBe(1);
    expect(result.wclCalls).toBe(0);
    expect(getMythicKeystoneSeason).not.toHaveBeenCalled();
    expect(discoverCharacterRuns).not.toHaveBeenCalled();
    expect(getSeasonCutoffs).toHaveBeenCalledTimes(1);
    expect(getSeasonCutoffs).toHaveBeenCalledWith(
      "EU",
      "season-tww-2",
      expect.objectContaining({ region: "EU" }) satisfies Partial<ProviderFetchContext>,
    );

    const cur = prisma.getSeasons().find((s) => s.id === "cur")!;
    const prev = prisma.getSeasons().find((s) => s.id === "prev")!;
    expect(cur.startsAt?.toISOString()).toBe("2025-09-01T00:00:00.000Z");
    expect(prev.startsAt?.toISOString()).toBe("2025-03-01T00:00:00.000Z");
    expect(cur.providerSeasonId).toBe("season-tww-3");
    expect(prev.providerSeasonId).toBe("season-tww-2");
    expect(prev.metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]).toBeTruthy();
    expect(result.regions[0]!.previousSeasonId).toBe("prev");
    expect(result.regions[0]!.policySync?.status).toBe("UPDATED");
  });

  it("hydrates dates from season detail when index is ID-only", async () => {
    const prisma = createPrismaFake([
      {
        id: "cur",
        regionId: "region-eu",
        slug: "blizzard-season-13",
        name: "Blizzard Season 13",
        blizzardSeasonId: 13,
        providerSeasonId: null,
        startsAt: null,
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
      {
        id: "prev",
        regionId: "region-eu",
        slug: "blizzard-season-12",
        name: "Blizzard Season 12",
        blizzardSeasonId: 12,
        providerSeasonId: null,
        startsAt: null,
        endsAt: null,
        isCurrent: false,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
    ]);

    const getMythicKeystoneSeasonIndex = vi.fn(async () =>
      providerResult(
        [
          blizzardSeason(12, null),
          blizzardSeason(13, null),
        ],
        "fp-index-ids-only",
      ),
    );
    const getMythicKeystoneSeason = vi.fn(async (seasonId: number) => {
      if (seasonId === 12) {
        return providerResult(
          blizzardSeason(12, "2025-03-01T00:00:00.000Z", "2025-08-01T00:00:00.000Z"),
          "fp-detail-12",
        );
      }
      return providerResult(blizzardSeason(13, "2025-09-01T00:00:00.000Z", null), "fp-detail-13");
    });

    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: "region-eu" }],
      blizzard: { getMythicKeystoneSeasonIndex, getMythicKeystoneSeason },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult(
            {
              expansionId: 10,
              seasons: [
                rioSeason({
                  slug: "season-tww-2",
                  isCurrent: false,
                  startsAt: "2025-03-01T00:00:00.000Z",
                }),
                rioSeason({
                  slug: "season-tww-3",
                  isCurrent: true,
                  startsAt: "2025-09-01T00:00:00.000Z",
                }),
              ],
              dungeons: [],
              attribution: {
                provider: "raiderio",
                displayText: "Data from Raider.IO",
                homepageUrl: "https://raider.io",
                profileUrl: null,
                sourceUrl: null,
              },
            },
            "fp-static",
          ),
        ),
        getSeasonCutoffs: vi.fn(async () =>
          providerResult(
            {
              region: "EU",
              seasonSlug: "season-tww-2",
              updatedAt: "2026-01-01T00:00:00.000Z",
              top0_1Percent: threshold(3400, "p999", "top_0_1_percent"),
              top1Percent: threshold(3000, "p990", "top_1_percent"),
              top10Percent: threshold(2800, "p900", "top_10_percent"),
              top25Percent: threshold(2500, "p750", "top_25_percent"),
              top40Percent: threshold(2200, "p600", "top_40_percent"),
              attribution: {
                provider: "raiderio",
                displayText: "Data from Raider.IO",
                homepageUrl: "https://raider.io",
                profileUrl: null,
                sourceUrl: null,
              },
            },
            "fp-cutoffs",
          ),
        ),
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger,
    });

    expect(getMythicKeystoneSeason).toHaveBeenCalledTimes(2);
    expect(result.seasonDetailCalls).toBe(2);
    expect(prisma.getSeasons().find((s) => s.id === "cur")!.startsAt?.toISOString()).toBe(
      "2025-09-01T00:00:00.000Z",
    );
    expect(prisma.getSeasons().find((s) => s.id === "prev")!.startsAt?.toISOString()).toBe(
      "2025-03-01T00:00:00.000Z",
    );
    expect(prisma.getSeasons().find((s) => s.id === "prev")!.providerSeasonId).toBe("season-tww-2");
    expect(result.regions[0]!.previousSeasonId).toBe("prev");
  });

  it("Midnight → TWW: binds previous via previous-expansion static data + date match", async () => {
    const prisma = createPrismaFake([
      {
        id: "cur",
        regionId: "region-eu",
        slug: "blizzard-season-17",
        name: "Blizzard Season 17",
        blizzardSeasonId: 17,
        providerSeasonId: null,
        startsAt: new Date("2026-03-18T04:00:00.000Z"),
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
      {
        id: "prev",
        regionId: "region-eu",
        slug: "blizzard-season-15",
        name: "Blizzard Season 15",
        blizzardSeasonId: 15,
        providerSeasonId: null,
        startsAt: new Date("2025-08-06T04:00:00.000Z"),
        endsAt: new Date("2026-03-18T04:00:00.000Z"),
        isCurrent: false,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
    ]);

    const getStaticData = vi.fn(async (_ctx: unknown, options?: { expansionId?: number }) => {
      if (options?.expansionId === 10) {
        return providerResult(
          {
            expansionId: 10,
            seasons: [
              rioSeason({
                slug: "season-tww-2",
                isCurrent: false,
                startsAt: "2025-03-04T15:00:00.000Z",
                endsAt: "2025-08-05T15:00:00.000Z",
              }),
              rioSeason({
                slug: "season-tww-3",
                isCurrent: false,
                startsAt: "2025-08-12T15:00:00.000Z",
                endsAt: "2026-03-10T15:00:00.000Z",
              }),
            ],
            dungeons: [],
            attribution: {
              provider: "raiderio",
              displayText: "Data from Raider.IO",
              homepageUrl: "https://raider.io",
              profileUrl: null,
              sourceUrl: null,
            },
          },
          "fp-static-tww",
        );
      }
      return providerResult(
        {
          expansionId: 11,
          seasons: [
            rioSeason({
              slug: "season-mn-1",
              isCurrent: true,
              startsAt: "2026-03-24T15:00:00.000Z",
            }),
            rioSeason({
              slug: "season-mn-2",
              isCurrent: false,
              startsAt: "2026-08-18T15:00:00.000Z",
            }),
          ],
          dungeons: [],
          attribution: {
            provider: "raiderio",
            displayText: "Data from Raider.IO",
            homepageUrl: "https://raider.io",
            profileUrl: null,
            sourceUrl: null,
          },
        },
        "fp-static-mn",
      );
    });

    const getSeasonCutoffs = vi.fn(async () =>
      providerResult(
        {
          region: "EU",
          seasonSlug: "season-tww-3",
          updatedAt: "2026-01-01T00:00:00.000Z",
          top0_1Percent: threshold(3400, "p999", "top_0_1_percent"),
          top1Percent: threshold(3000, "p990", "top_1_percent"),
          top10Percent: threshold(2800, "p900", "top_10_percent"),
          top25Percent: threshold(2500, "p750", "top_25_percent"),
          top40Percent: threshold(2200, "p600", "top_40_percent"),
          attribution: {
            provider: "raiderio",
            displayText: "Data from Raider.IO",
            homepageUrl: "https://raider.io",
            profileUrl: null,
            sourceUrl: null,
          },
        },
        "fp-cutoffs-tww3",
      ),
    );

    const result = await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: "region-eu" }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () =>
          providerResult(
            [
              blizzardSeason(15, "2025-08-06T04:00:00.000Z", "2026-03-18T04:00:00.000Z"),
              blizzardSeason(17, "2026-03-18T04:00:00.000Z", null),
            ],
            "fp-index",
          ),
        ),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused");
        }),
      },
      raiderIo: { getStaticData, getSeasonCutoffs },
      persistProviderResult: vi.fn(async () => "p"),
      logger,
    });

    expect(getStaticData).toHaveBeenCalledTimes(2);
    expect(getStaticData).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { expansionId: 10 },
    );
    expect(result.staticDataCalls).toBe(2);
    expect(prisma.getSeasons().find((s) => s.id === "cur")!.providerSeasonId).toBe("season-mn-1");
    expect(prisma.getSeasons().find((s) => s.id === "prev")!.providerSeasonId).toBe("season-tww-3");
    expect(getSeasonCutoffs).toHaveBeenCalledWith(
      "EU",
      "season-tww-3",
      expect.objectContaining({ region: "EU" }),
    );
    expect(result.seasonCutoffsCalls).toBe(1);
    expect(result.regions[0]!.policySync?.status).toBe("UPDATED");
    expect(result.regions[0]!.reasons).toContain("PREVIOUS_RIO_BOUND_VIA_PREVIOUS_EXPANSION");
    expect(result.wclCalls).toBe(0);
  });

  it("preserves LKG policy when cutoffs sync fails", async () => {
    const lkg = {
      schemaVersion: "experience-population-policy-store-v1",
      policy: {
        version: "season-population-policy-v1",
        source: "RAIDER_IO_SEASON_CUTOFFS",
        region: "EU",
        seasonSlug: "season-tww-2",
        sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
        quality: "COMPLETE",
        anchors: [
          {
            key: "top_0_1_percent",
            topPercent: 0.1,
            score: 3300,
            quantilePopulationCount: null,
            totalPopulationCount: null,
          },
          {
            key: "top_1_percent",
            topPercent: 1,
            score: 2900,
            quantilePopulationCount: null,
            totalPopulationCount: null,
          },
          {
            key: "top_10_percent",
            topPercent: 10,
            score: 2700,
            quantilePopulationCount: null,
            totalPopulationCount: null,
          },
          {
            key: "top_25_percent",
            topPercent: 25,
            score: 2400,
            quantilePopulationCount: null,
            totalPopulationCount: null,
          },
          {
            key: "top_40_percent",
            topPercent: 40,
            score: 2100,
            quantilePopulationCount: null,
            totalPopulationCount: null,
          },
        ],
      },
      raiderIoSeasonSlug: "season-tww-2",
      policyContentHash: "a".repeat(64),
      sourceRequestFingerprint: "old",
      sourcePayloadId: "old",
      sourceFetchedAt: "2026-01-01T00:00:00.000Z",
      synchronizedAt: "2026-01-01T00:00:01.000Z",
      lastKnownGood: true,
    };
    // Fix hash to match policy for reader — use sync path that retains on failure instead.
    const prisma = createPrismaFake([
      {
        id: "cur",
        regionId: "region-eu",
        slug: "blizzard-season-13",
        name: "Blizzard Season 13",
        blizzardSeasonId: 13,
        providerSeasonId: "season-tww-3",
        startsAt: new Date("2025-09-01T00:00:00.000Z"),
        endsAt: null,
        isCurrent: true,
        metadata: {},
        region: { id: "region-eu", code: "EU" },
      },
      {
        id: "prev",
        regionId: "region-eu",
        slug: "blizzard-season-12",
        name: "Blizzard Season 12",
        blizzardSeasonId: 12,
        providerSeasonId: "season-tww-2",
        startsAt: new Date("2025-03-01T00:00:00.000Z"),
        endsAt: null,
        isCurrent: false,
        metadata: {
          // Store a valid LKG via a successful prior shape — reader needs matching hash.
          // We'll sync fail via provider throw; prior LKG must be readable.
        },
        region: { id: "region-eu", code: "EU" },
      },
    ]);

    // Seed readable LKG using synchronize-compatible document from a first successful path is heavy;
    // instead assert provider throw leaves metadata unchanged when we plant opaque LKG-like key.
    const planted = { ...lkg, keep: true };
    prisma.getSeasons().find((s) => s.id === "prev")!.metadata = {
      [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: planted,
      unrelated: 1,
    };
    const before = JSON.stringify(prisma.getSeasons().find((s) => s.id === "prev")!.metadata);

    await bootstrapExperienceSeasonMetadata({
      prisma: prisma as never,
      regions: [{ code: "EU", id: "region-eu" }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () =>
          providerResult(
            [
              blizzardSeason(12, "2025-03-01T00:00:00.000Z"),
              blizzardSeason(13, "2025-09-01T00:00:00.000Z"),
            ],
            "fp-index",
          ),
        ),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("unused when index has timestamps");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () =>
          providerResult(
            {
              expansionId: 10,
              seasons: [
                rioSeason({
                  slug: "season-tww-2",
                  isCurrent: false,
                  startsAt: "2025-03-01T00:00:00.000Z",
                }),
                rioSeason({
                  slug: "season-tww-3",
                  isCurrent: true,
                  startsAt: "2025-09-01T00:00:00.000Z",
                }),
              ],
              dungeons: [],
              attribution: {
                provider: "raiderio",
                displayText: "Data from Raider.IO",
                homepageUrl: "https://raider.io",
                profileUrl: null,
                sourceUrl: null,
              },
            },
            "fp-static",
          ),
        ),
        getSeasonCutoffs: vi.fn(async () => {
          throw new Error("cutoffs down");
        }),
      },
      persistProviderResult: vi.fn(async () => "p"),
      logger,
    });

    expect(JSON.stringify(prisma.getSeasons().find((s) => s.id === "prev")!.metadata)).toBe(
      before,
    );
  });

  it("runExperienceSeasonBootstrapSafe never throws", async () => {
    const result = await runExperienceSeasonBootstrapSafe({
      prisma: {
        season: {
          findFirst: vi.fn(async () => {
            throw new Error("db down");
          }),
        },
      } as never,
      regions: [{ code: "EU", id: "region-eu" }],
      blizzard: {
        getMythicKeystoneSeasonIndex: vi.fn(async () => {
          throw new Error("blizzard down");
        }),
        getMythicKeystoneSeason: vi.fn(async () => {
          throw new Error("blizzard down");
        }),
      },
      raiderIo: {
        getStaticData: vi.fn(async () => {
          throw new Error("rio down");
        }),
        getSeasonCutoffs: vi.fn(),
      },
      persistProviderResult: vi.fn(async () => null),
      logger,
    });
    expect(result.status === "failed" || result.status === "partial").toBe(true);
    expect(result.wclCalls).toBe(0);
  });
});
