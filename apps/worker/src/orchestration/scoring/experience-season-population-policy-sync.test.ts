import { describe, expect, it, vi } from "vitest";
import type {
  ProviderFetchContext,
  ProviderResult,
  RaiderIoCutoffThreshold,
  RaiderIoSeasonCutoffs,
} from "@mplus/contracts";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  readExperiencePopulationPolicyMetadata,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";
import {
  synchronizeSeasonPopulationPolicy,
  type SeasonPopulationPolicyRaiderIoPort,
} from "./experience-season-population-policy-sync.js";

const ctx: ProviderFetchContext = {
  region: "EU",
  requestId: "test-req",
  correlationId: null,
  forceRefresh: true,
  now: "2026-08-08T00:00:00.000Z",
};

function threshold(
  score: number,
  quantile: RaiderIoCutoffThreshold["quantile"],
  label: RaiderIoCutoffThreshold["label"],
): RaiderIoCutoffThreshold {
  return { score, quantile, label };
}

function cutoffs(partial: Partial<RaiderIoSeasonCutoffs> = {}): RaiderIoSeasonCutoffs {
  return {
    region: "EU",
    seasonSlug: "season-tww-3",
    updatedAt: "2026-03-01T00:00:00.000Z",
    top0_1Percent: null,
    top1Percent: null,
    top10Percent: null,
    top25Percent: null,
    top40Percent: null,
    attribution: {
      provider: "raiderio",
      displayText: "Data from Raider.IO",
      homepageUrl: "https://raider.io",
      profileUrl: null,
      sourceUrl: null,
    },
    ...partial,
  };
}

const COMPLETE_CUTOFFS = cutoffs({
  top0_1Percent: threshold(3400, "p999", "top_0_1_percent"),
  top1Percent: threshold(3000, "p990", "top_1_percent"),
  top10Percent: threshold(2800, "p900", "top_10_percent"),
  top25Percent: threshold(2500, "p750", "top_25_percent"),
  top40Percent: threshold(2200, "p600", "top_40_percent"),
});

function providerResult(
  data: RaiderIoSeasonCutoffs,
  fingerprint = "fp-cutoffs-1",
): ProviderResult<RaiderIoSeasonCutoffs> {
  return {
    data,
    provenance: {
      provider: "raiderio",
      externalRequestId: "ext",
      sourcePayloadId: null,
      sourceUrl: "https://raider.io/api/v1/mythic-plus/season-cutoffs",
      fetchedAt: "2026-08-08T00:00:01.000Z",
      schemaVersion: "0.62.5+cutoffs-v2",
    },
    freshness: {
      fetchedAt: "2026-08-08T00:00:01.000Z",
      expiresAt: null,
      stale: false,
    },
    metadata: {
      provider: "raiderio",
      endpointKey: "season.cutoffs",
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

type SeasonRow = {
  id: string;
  regionId: string | null;
  slug: string;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
  region: { id: string; code: string } | null;
};

function createPrismaFake(initial: SeasonRow) {
  let season: SeasonRow = {
    ...initial,
    metadata: { ...initial.metadata },
    region: initial.region ? { ...initial.region } : null,
  };
  let updateCount = 0;

  return {
    updateCount: () => updateCount,
    getSeason: () => season,
    season: {
      findUnique: vi.fn(async (args: { where: { id: string }; include?: unknown; select?: unknown }) => {
        if (args.where.id !== season.id) return null;
        if (args.select) {
          return { metadata: season.metadata };
        }
        return {
          ...season,
          metadata: season.metadata,
          region: season.region,
        };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { metadata: unknown } }) => {
        if (args.where.id !== season.id) throw new Error("not found");
        updateCount += 1;
        const metadata =
          args.data.metadata && typeof args.data.metadata === "object"
            ? (JSON.parse(JSON.stringify(args.data.metadata)) as Record<string, unknown>)
            : {};
        season = { ...season, metadata };
        return season;
      }),
    },
  };
}

function lkgDocument(
  overrides: Partial<PersistedExperiencePopulationPolicyMetadata> = {},
): PersistedExperiencePopulationPolicyMetadata {
  const policy = {
    version: "season-population-policy-v1" as const,
    source: "RAIDER_IO_SEASON_CUTOFFS" as const,
    region: "EU",
    seasonSlug: "season-tww-3",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    quality: "COMPLETE" as const,
    anchors: [
      {
        key: "top_0_1_percent" as const,
        topPercent: 0.1,
        score: 3300,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
      {
        key: "top_1_percent" as const,
        topPercent: 1,
        score: 2900,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
      {
        key: "top_10_percent" as const,
        topPercent: 10,
        score: 2700,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
      {
        key: "top_25_percent" as const,
        topPercent: 25,
        score: 2400,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
      {
        key: "top_40_percent" as const,
        topPercent: 40,
        score: 2100,
        quantilePopulationCount: null,
        totalPopulationCount: null,
      },
    ],
  };
  const {
    policy: policyOverride,
    policyContentHash: hashOverride,
    ...rest
  } = overrides;
  const resolvedPolicy = policyOverride ?? policy;
  return {
    schemaVersion: "experience-population-policy-store-v1",
    raiderIoSeasonSlug: "season-tww-3",
    sourceRequestFingerprint: "fp-old",
    sourcePayloadId: "payload-old",
    sourceFetchedAt: "2026-01-01T00:00:00.000Z",
    synchronizedAt: "2026-01-01T00:00:01.000Z",
    lastKnownGood: true,
    ...rest,
    policy: resolvedPolicy,
    policyContentHash:
      hashOverride ?? hashSeasonPopulationPolicyContent(resolvedPolicy),
  };
}

describe("synchronizeSeasonPopulationPolicy", () => {
  it("stores a COMPLETE policy with one cutoff call and one provider persist", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {
        activeMplusCatalog: { schemaVersion: "active-mplus-catalog-v1", wclZoneId: 42 },
        dungeonSlugs: ["ara-kara"],
        someFutureField: 1,
      },
      region: { id: "region-eu", code: "EU" },
    });
    const getSeasonCutoffs = vi.fn(async () => providerResult(COMPLETE_CUTOFFS));
    const persistProviderResult = vi.fn(async () => "payload-new");
    const raiderIo: SeasonPopulationPolicyRaiderIoPort = { getSeasonCutoffs };

    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo,
      ctx,
      persistProviderResult,
      now: new Date("2026-08-08T00:00:02.000Z"),
    });

    expect(result.status).toBe("UPDATED");
    expect(getSeasonCutoffs).toHaveBeenCalledTimes(1);
    expect(getSeasonCutoffs).toHaveBeenCalledWith("EU", "season-tww-3", ctx);
    expect(persistProviderResult).toHaveBeenCalledTimes(1);
    expect(prisma.updateCount()).toBe(1);

    const stored = readExperiencePopulationPolicyMetadata(prisma.getSeason().metadata);
    expect(stored?.policy.quality).toBe("COMPLETE");
    expect(stored?.policy.anchors).toHaveLength(5);
    expect(stored?.sourcePayloadId).toBe("payload-new");
    expect(prisma.getSeason().metadata.activeMplusCatalog).toEqual({
      schemaVersion: "active-mplus-catalog-v1",
      wclZoneId: 42,
    });
    expect(prisma.getSeason().metadata.dungeonSlugs).toEqual(["ara-kara"]);
    expect(prisma.getSeason().metadata.someFutureField).toBe(1);
  });

  it("stores a PARTIAL useful policy", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-14",
      isCurrent: false,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const partial = cutoffs({
      top1Percent: threshold(3000, "p990", "top_1_percent"),
      top25Percent: threshold(2500, "p750", "top_25_percent"),
      top40Percent: threshold(2200, "p600", "top_40_percent"),
    });
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-2",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(partial)) },
      ctx,
      persistProviderResult: vi.fn(async () => "payload-partial"),
    });
    expect(result.status).toBe("UPDATED");
    if (result.status === "UPDATED") {
      expect(result.policy.quality).toBe("PARTIAL");
      expect(result.policy.anchors).toHaveLength(3);
    }
  });

  it("returns NO_USABLE_POLICY for INSUFFICIENT without prior LKG and does not write policy", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: { dungeonSlugs: ["ara-kara"] },
      region: { id: "region-eu", code: "EU" },
    });
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: {
        getSeasonCutoffs: vi.fn(async () =>
          providerResult(cutoffs({ top10Percent: threshold(2800, "p900", "top_10_percent") })),
        ),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "payload-insufficient"),
    });
    expect(result).toMatchObject({
      status: "NO_USABLE_POLICY",
      reason: "INSUFFICIENT_POLICY",
    });
    expect(prisma.updateCount()).toBe(0);
    expect(prisma.getSeason().metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]).toBeUndefined();
    expect(prisma.getSeason().metadata.dungeonSlugs).toEqual(["ara-kara"]);
  });

  it("retains LKG when new evidence is INSUFFICIENT", async () => {
    const prior = lkgDocument();
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: prior },
      region: { id: "region-eu", code: "EU" },
    });
    const before = JSON.stringify(prisma.getSeason().metadata);
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: {
        getSeasonCutoffs: vi.fn(async () => providerResult(cutoffs())),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "payload-empty"),
    });
    expect(result.status).toBe("RETAINED_LAST_KNOWN_GOOD");
    if (result.status === "RETAINED_LAST_KNOWN_GOOD") {
      expect(result.retainedPolicyContentHash).toBe(prior.policyContentHash);
    }
    expect(prisma.updateCount()).toBe(0);
    expect(JSON.stringify(prisma.getSeason().metadata)).toBe(before);
  });

  it("retains LKG on non-monotonic provider evidence", async () => {
    const prior = lkgDocument();
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: false,
      metadata: { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: prior },
      region: { id: "region-eu", code: "EU" },
    });
    const inverted = cutoffs({
      top0_1Percent: threshold(3000, "p999", "top_0_1_percent"),
      top1Percent: threshold(3100, "p990", "top_1_percent"),
      top10Percent: threshold(2800, "p900", "top_10_percent"),
    });
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(inverted)) },
      ctx,
      persistProviderResult: vi.fn(async () => "payload-bad"),
    });
    expect(result).toMatchObject({
      status: "RETAINED_LAST_KNOWN_GOOD",
      reason: "NON_MONOTONIC_THRESHOLDS",
    });
    expect(prisma.updateCount()).toBe(0);
  });

  it("propagates provider throw without writing metadata", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: {
        getSeasonCutoffs: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
      ctx,
      persistProviderResult: vi.fn(async () => "should-not-run"),
    });
    expect(result.status).toBe("PROVIDER_FAILURE");
    expect(prisma.updateCount()).toBe(0);
    expect(prisma.getSeason().metadata[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]).toBeUndefined();
  });

  it("fails closed when provider persistence callback fails", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(COMPLETE_CUTOFFS)) },
      ctx,
      persistProviderResult: vi.fn(async () => {
        throw new Error("db write failed");
      }),
    });
    expect(result.status).toBe("PROVIDER_PERSISTENCE_FAILED");
    expect(prisma.updateCount()).toBe(0);
  });

  it("rejects region mismatch before any provider call", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const getSeasonCutoffs = vi.fn(async () => providerResult(COMPLETE_CUTOFFS));
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "US",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs },
      ctx,
      persistProviderResult: vi.fn(async () => "x"),
    });
    expect(result).toEqual({
      status: "VALIDATION_FAILED",
      seasonId: "season-1",
      reason: "REGION_MISMATCH",
    });
    expect(getSeasonCutoffs).not.toHaveBeenCalled();
    expect(prisma.updateCount()).toBe(0);
  });

  it("rejects missing season before provider call", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const getSeasonCutoffs = vi.fn(async () => providerResult(COMPLETE_CUTOFFS));
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "missing",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs },
      ctx,
      persistProviderResult: vi.fn(async () => "x"),
    });
    expect(result.reason).toBe("SEASON_NOT_FOUND");
    expect(getSeasonCutoffs).not.toHaveBeenCalled();
  });

  it("rejects blank Raider.IO season slug before provider call", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const getSeasonCutoffs = vi.fn(async () => providerResult(COMPLETE_CUTOFFS));
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "   ",
      raiderIo: { getSeasonCutoffs },
      ctx,
      persistProviderResult: vi.fn(async () => "x"),
    });
    expect(result.reason).toBe("BLANK_RAIDER_IO_SEASON_SLUG");
    expect(getSeasonCutoffs).not.toHaveBeenCalled();
  });

  it("allows historical seasons where isCurrent is false", async () => {
    const prisma = createPrismaFake({
      id: "season-hist",
      regionId: "region-eu",
      slug: "blizzard-season-14",
      isCurrent: false,
      metadata: {},
      region: { id: "region-eu", code: "EU" },
    });
    const result = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-hist",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-2",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(COMPLETE_CUTOFFS)) },
      ctx,
      persistProviderResult: vi.fn(async () => "payload"),
    });
    expect(result.status).toBe("UPDATED");
    expect(prisma.getSeason().isCurrent).toBe(false);
  });

  it("idempotent equivalent policy leaves a single dedicated metadata document", async () => {
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: true,
      metadata: {
        activeMplusCatalog: { keep: true },
        authoritySource: "blizzard",
      },
      region: { id: "region-eu", code: "EU" },
    });
    const raiderIo = {
      getSeasonCutoffs: vi.fn(async () => providerResult(COMPLETE_CUTOFFS)),
    };
    const persistProviderResult = vi.fn(async () => "payload");

    const first = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo,
      ctx,
      persistProviderResult,
      now: new Date("2026-08-08T00:00:02.000Z"),
    });
    const second = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo,
      ctx,
      persistProviderResult,
      now: new Date("2026-08-08T01:00:00.000Z"),
    });

    expect(first.status).toBe("UPDATED");
    expect(second.status).toBe("UPDATED");
    if (first.status === "UPDATED" && second.status === "UPDATED") {
      expect(first.policyContentHash).toBe(second.policyContentHash);
    }
    expect(raiderIo.getSeasonCutoffs).toHaveBeenCalledTimes(2);
    expect(prisma.updateCount()).toBe(2);

    const keys = Object.keys(prisma.getSeason().metadata).filter(
      (k) => k === EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
    );
    expect(keys).toHaveLength(1);
    expect(prisma.getSeason().metadata.activeMplusCatalog).toEqual({ keep: true });
    expect(prisma.getSeason().metadata.authoritySource).toBe("blizzard");

    const stored = readExperiencePopulationPolicyMetadata(prisma.getSeason().metadata);
    expect(stored?.synchronizedAt).toBe("2026-08-08T01:00:00.000Z");
  });

  it("refuses remapped cutoffs as LKG unless exact target-season equivalence is proven", async () => {
    const prior = lkgDocument();
    const prisma = createPrismaFake({
      id: "season-1",
      regionId: "region-eu",
      slug: "blizzard-season-15",
      isCurrent: false,
      metadata: { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: prior },
      region: { id: "region-eu", code: "EU" },
    });
    const remapped = cutoffs({
      ...COMPLETE_CUTOFFS,
      isRemappedSeason: true,
    });
    const refused = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(remapped)) },
      ctx,
      persistProviderResult: vi.fn(async () => "payload-remapped"),
    });
    expect(refused).toMatchObject({
      status: "RETAINED_LAST_KNOWN_GOOD",
      reason: "REMAPPED_CUTOFFS_UNPROVEN_TARGET_SEASON_EQUIVALENCE",
    });
    expect(prisma.updateCount()).toBe(0);

    const accepted = await synchronizeSeasonPopulationPolicy({
      prisma: prisma as never,
      seasonId: "season-1",
      regionCode: "EU",
      raiderIoSeasonSlug: "season-tww-3",
      raiderIo: { getSeasonCutoffs: vi.fn(async () => providerResult(remapped)) },
      ctx,
      persistProviderResult: vi.fn(async () => "payload-remapped-ok"),
      exactTargetSeasonEquivalenceProven: true,
    });
    expect(accepted.status).toBe("UPDATED");
    expect(prisma.updateCount()).toBe(1);
  });
});
