import { describe, expect, it, vi } from "vitest";
import type {
  ProviderFetchContext,
  ProviderResult,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticData,
  RaiderIoStaticSeason,
} from "@mplus/contracts";
import {
  catalogEntryFromSeasonCutoffs,
  collectExperienceSeasonCutoffs,
  isClosedRaiderIoSeasonForCatalog,
  selectClosedMainSeasonsForCatalog,
} from "./experience-cutoffs-collect.js";

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "cutoffs-collect-test",
  correlationId: null,
  forceRefresh: true,
  now: "2026-08-10T00:00:00.000Z",
};

function season(partial: Partial<RaiderIoStaticSeason> & Pick<RaiderIoStaticSeason, "slug">): RaiderIoStaticSeason {
  return {
    name: partial.name ?? partial.slug,
    startsAt: partial.startsAt ?? "2024-01-01T00:00:00.000Z",
    endsAt: partial.endsAt ?? "2024-06-01T00:00:00.000Z",
    isCurrent: partial.isCurrent ?? false,
    isMainSeason: partial.isMainSeason ?? true,
    blizzardSeasonId: partial.blizzardSeasonId ?? 10,
    dungeonSlugs: partial.dungeonSlugs ?? [],
    slug: partial.slug,
  };
}

function providerResult<T>(data: T): ProviderResult<T> {
  return {
    data,
    provenance: {
      provider: "raiderio",
      externalRequestId: null,
      sourcePayloadId: null,
      sourceUrl: "https://raider.io/api",
      fetchedAt: ctx.now,
      schemaVersion: "test",
    },
    freshness: { fetchedAt: ctx.now, expiresAt: null, stale: false },
    metadata: {
      provider: "raiderio",
      endpointKey: "test",
      requestFingerprint: "fp",
      requestedAt: ctx.now,
      completedAt: ctx.now,
      statusCode: 200,
      cacheHit: false,
      retryCount: 0,
      costUnits: 1,
      etag: null,
      expiresAt: null,
    },
  };
}

describe("selectClosedMainSeasonsForCatalog", () => {
  const nowMs = Date.parse("2026-08-10T00:00:00.000Z");

  it("accepts closed real main seasons and rejects event/non-main", () => {
    const { selected, skippedCurrent, skippedNonMain } = selectClosedMainSeasonsForCatalog(
      [
        season({ slug: "season-df-1", blizzardSeasonId: 11 }),
        season({
          slug: "season-tww-1-post",
          isMainSeason: false,
          blizzardSeasonId: 13,
        }),
        season({
          slug: "season-mn-1",
          isCurrent: true,
          endsAt: "2026-12-01T00:00:00.000Z",
          blizzardSeasonId: 17,
        }),
        season({
          slug: "season-event-1",
          isMainSeason: false,
        }),
      ],
      nowMs,
    );
    expect(selected.map((s) => s.slug)).toEqual(["season-df-1"]);
    expect(skippedCurrent.some((s) => s.slug === "season-mn-1")).toBe(true);
    expect(skippedNonMain.length).toBeGreaterThanOrEqual(2);
  });

  it("fail-closed when endsAt missing", () => {
    expect(
      isClosedRaiderIoSeasonForCatalog(
        { isCurrent: false, endsAt: null },
        nowMs,
      ),
    ).toBe(false);
  });
});

describe("catalogEntryFromSeasonCutoffs", () => {
  it("maps official quantiles without inventing others", () => {
    const cutoffs: RaiderIoSeasonCutoffs = {
      region: "EU",
      seasonSlug: "season-tww-3",
      updatedAt: "2026-01-01T00:00:00.000Z",
      isRemappedSeason: true,
      top0_1Percent: {
        score: 3800,
        quantile: "p999",
        label: "top_0_1_percent",
        quantilePopulationCount: 10,
        totalPopulationCount: 50_000,
      },
      top1Percent: {
        score: 3500,
        quantile: "p990",
        label: "top_1_percent",
        quantilePopulationCount: 100,
        totalPopulationCount: 50_000,
      },
      top10Percent: {
        score: 3000,
        quantile: "p900",
        label: "top_10_percent",
        quantilePopulationCount: null,
        totalPopulationCount: 50_000,
      },
      top25Percent: {
        score: 2700,
        quantile: "p750",
        label: "top_25_percent",
        quantilePopulationCount: null,
        totalPopulationCount: 50_000,
      },
      top40Percent: {
        score: 2400,
        quantile: "p600",
        label: "top_40_percent",
        quantilePopulationCount: null,
        totalPopulationCount: 50_000,
      },
      attribution: {
        provider: "raiderio",
        displayText: "Data from Raider.IO",
        homepageUrl: "https://raider.io",
        profileUrl: null,
        sourceUrl: null,
      },
    };
    const entry = catalogEntryFromSeasonCutoffs({
      region: "EU",
      season: season({ slug: "season-tww-3", blizzardSeasonId: 15 }),
      cutoffs,
      collectedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(entry.cutoffs).toEqual({
      p999: 3800,
      p990: 3500,
      p900: 3000,
      p750: 2700,
      p600: 2400,
    });
    expect(entry.totalPopulation).toBe(50_000);
    expect(entry.blizzardSeasonId).toBe(15);
    expect(Object.keys(entry.cutoffs)).toEqual(["p999", "p990", "p900", "p750", "p600"]);
  });
});

describe("collectExperienceSeasonCutoffs", () => {
  it("collects closed seasons only and supports dry-run", async () => {
    const getStaticData = vi.fn(async (_ctx: ProviderFetchContext, options?: { expansionId?: number }) => {
      const expansionId = options?.expansionId ?? 0;
      const seasons =
        expansionId === 9
          ? [
              season({ slug: "season-df-1", blizzardSeasonId: 11 }),
              season({
                slug: "season-df-4",
                isCurrent: true,
                endsAt: "2026-12-01T00:00:00.000Z",
                blizzardSeasonId: 14,
              }),
            ]
          : expansionId === 10
            ? [season({ slug: "season-tww-3", blizzardSeasonId: 15 })]
            : [];
      return providerResult<RaiderIoStaticData>({
        expansionId,
        seasons,
        dungeons: [],
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: null,
          sourceUrl: null,
        },
      });
    });

    const getSeasonCutoffs = vi.fn(async (region: string, seasonSlug: string) =>
      providerResult<RaiderIoSeasonCutoffs>({
        region: region as "EU",
        seasonSlug,
        updatedAt: "2026-01-01T00:00:00.000Z",
        isRemappedSeason: false,
        top0_1Percent: {
          score: 3000,
          quantile: "p999",
          label: "top_0_1_percent",
          quantilePopulationCount: null,
          totalPopulationCount: 1000,
        },
        top1Percent: {
          score: 2800,
          quantile: "p990",
          label: "top_1_percent",
          quantilePopulationCount: null,
          totalPopulationCount: 1000,
        },
        top10Percent: {
          score: 2500,
          quantile: "p900",
          label: "top_10_percent",
          quantilePopulationCount: null,
          totalPopulationCount: 1000,
        },
        top25Percent: {
          score: 2200,
          quantile: "p750",
          label: "top_25_percent",
          quantilePopulationCount: null,
          totalPopulationCount: 1000,
        },
        top40Percent: {
          score: 2000,
          quantile: "p600",
          label: "top_40_percent",
          quantilePopulationCount: null,
          totalPopulationCount: 1000,
        },
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: null,
          sourceUrl: null,
        },
      }),
    );

    const result = await collectExperienceSeasonCutoffs({
      raiderIo: { getStaticData, getSeasonCutoffs },
      ctx,
      options: {
        dryRun: true,
        fresh: true,
        regions: ["EU"],
        now: new Date("2026-08-10T00:00:00.000Z"),
      },
    });

    expect(result.wrote).toBe(false);
    expect(result.failed).toBe(0);
    expect(result.catalog.entries.map((e) => e.raiderIoSeasonSlug).sort()).toEqual([
      "season-df-1",
      "season-tww-3",
    ]);
    expect(result.lines.some((l) => l.status === "SKIPPED_CURRENT")).toBe(true);
    expect(getSeasonCutoffs).toHaveBeenCalled();
    expect(
      getSeasonCutoffs.mock.calls.every((c) => c[1] !== "season-df-4"),
    ).toBe(true);
  });
});
