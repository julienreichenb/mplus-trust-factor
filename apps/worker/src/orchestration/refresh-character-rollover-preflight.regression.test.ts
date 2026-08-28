/**
 * Real refresh-character preflight rollover regressions.
 *
 * Covers the queue path that previously missed publication TOCTOU zoneId and
 * would fail with "Refresh contract zoneId is required" after successful cold
 * catalog bootstrap.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  ActiveMplusSeasonCatalogIncompleteError,
  computeDungeonPoolHash,
  computeSourceMetadataHash,
  mergeActiveMplusCatalogMetadata,
  updateScoringSeasonSelection,
  type PersistedActiveMplusCatalogMetadata,
} from "./active-mplus-season/index.js";
import { BOOTSTRAP_TEST_RELEASE_PIN } from "@mplus/test-utils";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import {
  assertPublicationContractMatchesJob,
  resolvePublicationRefreshContract,
  runRefreshContractPreflight,
} from "./refresh-contract-preflight.js";
import { createMemoryOrchestrationPorts } from "./scoring/run-orchestration/memory-ports.js";
import { scoreCharacter } from "./scoring/score-character.js";
import { clearSeasonAuthorityCacheForTests } from "./season-authority.js";
import type { RefreshCharacterJob } from "@mplus/contracts";

const ZONE_MISSING_MSG =
  "Refresh contract zoneId is required (effective scoring season catalog)";

function catalogMeta(input: {
  wclZoneId: number;
  blizzardSeasonId: number;
  dungeonSlugs: string[];
}): PersistedActiveMplusCatalogMetadata {
  const dungeonPoolHash = computeDungeonPoolHash(input.dungeonSlugs);
  const catalogVersion = `${ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION}:zone-${input.wclZoneId}:pool-${dungeonPoolHash.slice(0, 12)}`;
  return {
    schemaVersion: "active-mplus-catalog-v1",
    wclZoneId: input.wclZoneId,
    blizzardSeasonId: input.blizzardSeasonId,
    expansionIdentity: "Test",
    dungeonPoolHash,
    sourceMetadataHash: computeSourceMetadataHash({
      blizzardSeasonId: input.blizzardSeasonId,
      wclZoneId: input.wclZoneId,
      dungeonPoolHash,
      catalogVersion,
    }),
    catalogVersion,
    dungeonSlugs: input.dungeonSlugs,
    synchronizedAt: new Date().toISOString(),
    validatedAt: new Date().toISOString(),
    lastKnownGood: true,
    authorityVersion: ACTIVE_MPLUS_SEASON_AUTHORITY_VERSION,
  };
}

function makePrisma(seed: {
  seasons: Array<{
    id: string;
    slug: string;
    name: string;
    blizzardSeasonId: number;
    isCurrent: boolean;
    metadata: unknown;
    dungeonSlugs: string[];
    encounterIds: number[];
  }>;
  runtimeSetting?: { value: unknown; version: number } | null;
}) {
  const seasons = new Map(
    seed.seasons.map((s) => [s.id, { ...s, regionId: "region-eu", dungeonCount: s.dungeonSlugs.length }]),
  );
  const dungeons = new Map<string, { id: string; slug: string; wclZoneOrEncounterId: bigint | null }>();
  const bindings = new Map<string, { seasonId: string; dungeonId: string; sortOrder: number }>();

  for (const s of seed.seasons) {
    s.dungeonSlugs.forEach((slug, i) => {
      const dungeonId = `dungeon-${slug}`;
      dungeons.set(dungeonId, {
        id: dungeonId,
        slug,
        wclZoneOrEncounterId: BigInt(s.encounterIds[i] ?? 1000 + i),
      });
      bindings.set(`${s.id}:${dungeonId}`, {
        seasonId: s.id,
        dungeonId,
        sortOrder: i,
      });
    });
  }

  let runtimeSetting = seed.runtimeSetting
    ? {
        key: "scoring_season_selection",
        value: seed.runtimeSetting.value,
        version: seed.runtimeSetting.version,
        updatedAt: new Date(),
        updatedByUserId: null as string | null,
      }
    : null;

  const regionRow = {
    id: "region-eu",
    code: "EU",
    apiHost: "https://eu.api.blizzard.com",
    localeDefault: "en_GB",
    enabled: true,
  };

  const prisma: Record<string, unknown> = {
    region: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) => {
        if (where.code === "EU" || where.id === "region-eu") return regionRow;
        return null;
      },
      findFirst: async () => regionRow,
      create: async () => regionRow,
    },
    runtimeSetting: {
      findUnique: async () => runtimeSetting,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        runtimeSetting = {
          key: String(data.key),
          value: data.value,
          version: Number(data.version ?? 1),
          updatedAt: new Date(),
          updatedByUserId: (data.updatedByUserId as string | null) ?? null,
        };
        return runtimeSetting;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { version?: number };
        data: { value: unknown; version: { increment: number }; updatedByUserId: string | null };
      }) => {
        if (!runtimeSetting || (where.version != null && runtimeSetting.version !== where.version)) {
          return { count: 0 };
        }
        runtimeSetting = {
          ...runtimeSetting,
          value: data.value,
          version: runtimeSetting.version + data.version.increment,
          updatedByUserId: data.updatedByUserId,
          updatedAt: new Date(),
        };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => {
        if (!runtimeSetting) throw new Error("missing");
        return runtimeSetting;
      },
    },
    season: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        let rows = [...seasons.values()];
        if (where?.regionId) rows = rows.filter((s) => s.regionId === where.regionId);
        if (where?.isCurrent === true) rows = rows.filter((s) => s.isCurrent);
        if (where?.blizzardSeasonId != null) {
          rows = rows.filter((s) => s.blizzardSeasonId === where.blizzardSeasonId);
        }
        return rows;
      },
      findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        let rows = [...seasons.values()];
        if (where?.regionId) rows = rows.filter((s) => s.regionId === where.regionId);
        if (where?.isCurrent === true) rows = rows.filter((s) => s.isCurrent);
        if (where?.blizzardSeasonId != null) {
          rows = rows.filter((s) => s.blizzardSeasonId === where.blizzardSeasonId);
        }
        if (where?.slug) return rows.find((s) => s.slug === where.slug) ?? null;
        if (where?.id) return rows.find((s) => s.id === where.id) ?? null;
        return rows[0] ?? null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => seasons.get(where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `season-${data.slug}`,
          regionId: String(data.regionId),
          slug: String(data.slug),
          name: String(data.name),
          blizzardSeasonId: Number(data.blizzardSeasonId),
          isCurrent: Boolean(data.isCurrent),
          dungeonCount: Number(data.dungeonCount ?? 0),
          metadata: data.metadata ?? {},
          dungeonSlugs: [] as string[],
          encounterIds: [] as number[],
        };
        seasons.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = seasons.get(where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async () => ({ count: 0 }),
    },
    seasonDungeon: {
      findMany: async ({ where }: { where: { seasonId: string } }) => {
        return [...bindings.values()]
          .filter((b) => b.seasonId === where.seasonId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((b) => ({
            ...b,
            dungeon: dungeons.get(b.dungeonId)!,
          }));
      },
      findUnique: async ({
        where,
      }: {
        where: { seasonId_dungeonId: { seasonId: string; dungeonId: string } };
      }) => {
        const key = `${where.seasonId_dungeonId.seasonId}:${where.seasonId_dungeonId.dungeonId}`;
        return bindings.get(key) ?? null;
      },
      create: async ({ data }: { data: { seasonId: string; dungeonId: string; sortOrder: number } }) => {
        const key = `${data.seasonId}:${data.dungeonId}`;
        bindings.set(key, data);
        return data;
      },
      update: async () => ({}),
    },
    dungeon: {
      upsert: async ({
        where,
        create,
      }: {
        where: { slug: string };
        create: { slug: string; name: string };
      }) => {
        const existing = [...dungeons.values()].find((d) => d.slug === where.slug);
        if (existing) return existing;
        const row = {
          id: `dungeon-${create.slug}`,
          slug: create.slug,
          wclZoneOrEncounterId: null as bigint | null,
        };
        dungeons.set(row.id, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { wclZoneOrEncounterId: bigint };
      }) => {
        const d = dungeons.get(where.id)!;
        d.wclZoneOrEncounterId = data.wclZoneOrEncounterId;
        return d;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  const findManySeasons = async ({ where }: { where?: Record<string, unknown> } = {}) => {
    let rows = [...seasons.values()];
    if (where?.regionId) rows = rows.filter((s) => s.regionId === where.regionId);
    if (where?.isCurrent === true) rows = rows.filter((s) => s.isCurrent);
    if (where?.blizzardSeasonId != null) {
      rows = rows.filter((s) => s.blizzardSeasonId === where.blizzardSeasonId);
    }
    if (where?.NOT && typeof where.NOT === "object" && where.NOT !== null && "id" in where.NOT) {
      rows = rows.filter((s) => s.id !== (where.NOT as { id: string }).id);
    }
    return rows;
  };
  (prisma.season as { findMany: typeof findManySeasons }).findMany = findManySeasons;

  return { prisma: prisma as never, seasons, bindings, dungeons };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function coldSeasonSeed(blizzardSeasonId: number) {
  return {
    id: `s${blizzardSeasonId}`,
    slug: `blizzard-season-${blizzardSeasonId}`,
    name: `Season ${blizzardSeasonId}`,
    blizzardSeasonId,
    isCurrent: true,
    metadata: {
      authoritySource: "season_index.current_season",
      authorityVerifiedAt: new Date().toISOString(),
      blizzardSeasonId,
    },
    dungeonSlugs: [] as string[],
    encounterIds: [] as number[],
  };
}

function buildJob(hash: string, seasonId: number, slug: string): RefreshCharacterJob {
  return {
    characterId: "11111111-1111-4111-8111-111111111111",
    region: "EU",
    realmSlug: "tarren-mill",
    name: "Rolloverchar",
    priority: "normal",
    forceRefresh: false,
    requestedAt: "2026-08-13T00:00:00.000Z",
    refreshContractHash: hash,
    triggerSource: "PROFILE_READ",
    authoritativeSeasonId: seasonId,
    authoritativeSeasonSlug: slug,
    abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
  } as RefreshCharacterJob;
}

describe("refresh-character rollover preflight (real queue path)", () => {
  const previousMode = process.env.PROVIDER_MODE;

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    process.env.PROVIDER_MODE = "live";
    delete process.env.WCL_MPLUS_ZONE_ID;
    delete process.env.WCL_MPLUS_ZONE_MODE;
    delete process.env.WCL_MPLUS_ZONE_EXPIRES_AT;
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.PROVIDER_MODE;
    else process.env.PROVIDER_MODE = previousMode;
  });

  it("source guard: publication TOCTOU freshly resolves Effective Scoring Season", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "refresh-pipeline.ts"), "utf8");
    const publicationIdx = src.indexOf("Final publication / TOCTOU");
    expect(publicationIdx).toBeGreaterThan(0);
    const publicationSrc = src.slice(publicationIdx);
    const scoringIdx = publicationSrc.indexOf("runAuthoritativeScoring");
    expect(scoringIdx).toBeGreaterThan(0);
    const barrierSrc = publicationSrc.slice(0, scoringIdx);
    expect(barrierSrc).toMatch(/resolvePublicationRefreshContract/);
    expect(barrierSrc).toMatch(/publicationEffective/);
    expect(barrierSrc).not.toMatch(/zoneId:\s*preflightEffective\.wclZoneId/);
    expect(publicationSrc).toMatch(/beforeCharacterScorePersist/);
    expect(publicationSrc).toMatch(/assertPublicationContractMatchesJob/);
  });

  it("COLD AUTO: missing catalog bootstraps once, preflight builds contract with discovered zone", async () => {
    const { prisma, seasons, bindings } = makePrisma({
      seasons: [coldSeasonSeed(99)],
      runtimeSetting: null,
    });

    let discoverCalls = 0;
    const discoverActiveMplusCatalog = vi.fn(async ({ blizzardSeasonId }: { blizzardSeasonId: number }) => {
      discoverCalls += 1;
      return {
        wclZoneId: 200,
        blizzardSeasonId,
        expansionIdentity: "Future",
        displayName: "Future Keystone",
        dungeonSlugs: ["future-one", "future-two"],
        encounterIds: [9001, 9002],
      };
    });

    const expectedHash = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: "blizzard-season-99",
      providerMode: "live",
      abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      zoneId: 200,
    }).hash;

    const result = await runRefreshContractPreflight(
      {
        prisma,
        blizzard: {
          getMythicKeystoneSeasonIndex: async () => ({
            data: { current_season: { id: 99 } },
          }),
        } as never,
        logger: makeLogger() as never,
        env: {
          PROVIDER_MODE: "live",
          ACTIVE_SCORE_MODEL_KEY: "default",
          ACTIVE_SCORE_MODEL_VERSION: 6,
        },
        getActiveModel: async () => ({ key: "default", version: 6 }),
        discoverActiveMplusCatalog,
      },
      buildJob(expectedHash, 99, "blizzard-season-99"),
      { jobId: "job-cold-auto" },
    );

    expect(result.contract.zoneId).toBe(200);
    expect(result.hash).toBe(expectedHash);
    expect(result.effective.wclZoneId).toBe(200);
    expect(result.effective.blizzardSeasonId).toBe(99);
    expect(result.effective.bootstrapped).toBe(true);
    expect(discoverCalls).toBe(1);
    expect(seasons.get("s99")?.metadata).toMatchObject({
      activeMplusCatalog: expect.objectContaining({ wclZoneId: 200 }),
    });
    expect([...bindings.values()].filter((b) => b.seasonId === "s99")).toHaveLength(2);

    // Warm: second preflight reuses persisted catalog — zero additional WorldData.
    const warm = await runRefreshContractPreflight(
      {
        prisma,
        blizzard: {
          getMythicKeystoneSeasonIndex: async () => ({
            data: { current_season: { id: 99 } },
          }),
        } as never,
        logger: makeLogger() as never,
        env: {
          PROVIDER_MODE: "live",
          ACTIVE_SCORE_MODEL_KEY: "default",
          ACTIVE_SCORE_MODEL_VERSION: 6,
        },
        getActiveModel: async () => ({ key: "default", version: 6 }),
        discoverActiveMplusCatalog,
      },
      buildJob(expectedHash, 99, "blizzard-season-99"),
      { jobId: "job-warm-auto" },
    );

    expect(discoverCalls).toBe(1);
    expect(warm.effective.wclZoneId).toBe(200);
    expect(warm.effective.bootstrapped).toBe(false);
    expect(warm.effective.applicationSeasonId).toBe(result.effective.applicationSeasonId);
    expect(warm.contract.zoneId).toBe(200);
    expect(warm.hash).toBe(expectedHash);
  });

  it("PINNED: zone from pinned season 17 catalog; no discovery for detected 18", async () => {
    const slugs17 = ["a", "b"];
    const meta17 = catalogMeta({ wclZoneId: 47, blizzardSeasonId: 17, dungeonSlugs: slugs17 });
    const { prisma, seasons } = makePrisma({
      seasons: [
        {
          id: "s17",
          slug: "blizzard-season-17",
          name: "Season 17",
          blizzardSeasonId: 17,
          isCurrent: false,
          metadata: mergeActiveMplusCatalogMetadata(
            {
              authoritySource: "season_index.current_season",
              authorityVerifiedAt: new Date().toISOString(),
              blizzardSeasonId: 17,
            },
            meta17,
          ),
          dungeonSlugs: slugs17,
          encounterIds: [1, 2],
        },
        {
          id: "s18",
          slug: "blizzard-season-18",
          name: "Season 18",
          blizzardSeasonId: 18,
          isCurrent: true,
          metadata: {
            authoritySource: "season_index.current_season",
            authorityVerifiedAt: new Date().toISOString(),
            blizzardSeasonId: 18,
          },
          dungeonSlugs: [],
          encounterIds: [],
        },
      ],
      runtimeSetting: { value: { mode: "PINNED", blizzardSeasonId: 17 }, version: 1 },
    });

    let discoverCalls = 0;
    const expectedHash = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: "blizzard-season-17",
      providerMode: "live",
      abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      zoneId: 47,
    }).hash;

    const result = await runRefreshContractPreflight(
      {
        prisma,
        blizzard: {
          getMythicKeystoneSeasonIndex: async () => ({
            data: { current_season: { id: 18 } },
          }),
        } as never,
        logger: makeLogger() as never,
        env: {
          PROVIDER_MODE: "live",
          ACTIVE_SCORE_MODEL_KEY: "default",
          ACTIVE_SCORE_MODEL_VERSION: 6,
        },
        getActiveModel: async () => ({ key: "default", version: 6 }),
        discoverActiveMplusCatalog: async () => {
          discoverCalls += 1;
          throw new Error("should not discover when PINNED");
        },
      },
      buildJob(expectedHash, 17, "blizzard-season-17"),
      { jobId: "job-pinned" },
    );

    expect(discoverCalls).toBe(0);
    expect(result.effective.selectionMode).toBe("PINNED");
    expect(result.effective.blizzardSeasonId).toBe(17);
    expect(result.effective.detected.blizzardSeasonId).toBe(18);
    expect(result.effective.wclZoneId).toBe(47);
    expect(result.contract.zoneId).toBe(47);
    expect(result.contract.activeSeasonId).toBe("blizzard-season-17");
    expect(seasons.get("s18")?.isCurrent).toBe(true);
  });

  it("FAIL-CLOSED: unavailable WorldData does not surface generic zoneId-required", async () => {
    const { prisma } = makePrisma({
      seasons: [coldSeasonSeed(99)],
      runtimeSetting: null,
    });

    await expect(
      runRefreshContractPreflight(
        {
          prisma,
          blizzard: {
            getMythicKeystoneSeasonIndex: async () => ({
              data: { current_season: { id: 99 } },
            }),
          } as never,
          logger: makeLogger() as never,
          env: {
            PROVIDER_MODE: "live",
            ACTIVE_SCORE_MODEL_KEY: "default",
            ACTIVE_SCORE_MODEL_VERSION: 6,
          },
          getActiveModel: async () => ({ key: "default", version: 6 }),
          discoverActiveMplusCatalog: async () => {
            throw new ActiveMplusSeasonCatalogIncompleteError(
              "ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE: no active Mythic+ WCL zone",
            );
          },
        },
        buildJob("deadbeef", 99, "blizzard-season-99"),
        { jobId: "job-fail-closed" },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(ZONE_MISSING_MSG);
      expect(message).toMatch(/ACTIVE_MPLUS_SEASON_CATALOG_INCOMPLETE/);
      return true;
    });
  });

  it("FAIL-CLOSED: ambiguous WorldData does not surface generic zoneId-required", async () => {
    const { prisma } = makePrisma({
      seasons: [coldSeasonSeed(99)],
      runtimeSetting: null,
    });

    await expect(
      runRefreshContractPreflight(
        {
          prisma,
          blizzard: {
            getMythicKeystoneSeasonIndex: async () => ({
              data: { current_season: { id: 99 } },
            }),
          } as never,
          logger: makeLogger() as never,
          env: {
            PROVIDER_MODE: "live",
            ACTIVE_SCORE_MODEL_KEY: "default",
            ACTIVE_SCORE_MODEL_VERSION: 6,
          },
          getActiveModel: async () => ({ key: "default", version: 6 }),
          discoverActiveMplusCatalog: async () => {
            throw Object.assign(
              new Error("ACTIVE_MPLUS_SEASON_AMBIGUOUS: multiple Keystone zones"),
              { code: "ACTIVE_MPLUS_SEASON_AMBIGUOUS" },
            );
          },
        },
        buildJob("deadbeef", 99, "blizzard-season-99"),
        { jobId: "job-ambiguous" },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(ZONE_MISSING_MSG);
      expect(message).toMatch(/ACTIVE_MPLUS_SEASON_AMBIGUOUS|AMBIGUOUS/);
      return true;
    });
  });

  it("programming invariant: live contract without zoneId still throws zoneId-required", () => {
    expect(() =>
      resolveActiveRefreshContract({
        scoringModelKey: "default",
        scoringModelVersion: 6,
        activeSeasonId: "blizzard-season-99",
        providerMode: "live",
        zoneId: undefined,
        abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      }),
    ).toThrow(ZONE_MISSING_MSG);
  });
});

function readySeason(input: {
  blizzardSeasonId: number;
  isCurrent: boolean;
  wclZoneId: number;
  dungeonSlugs: string[];
}) {
  const meta = catalogMeta({
    wclZoneId: input.wclZoneId,
    blizzardSeasonId: input.blizzardSeasonId,
    dungeonSlugs: input.dungeonSlugs,
  });
  return {
    id: `s${input.blizzardSeasonId}`,
    slug: `blizzard-season-${input.blizzardSeasonId}`,
    name: `Season ${input.blizzardSeasonId}`,
    blizzardSeasonId: input.blizzardSeasonId,
    isCurrent: input.isCurrent,
    metadata: mergeActiveMplusCatalogMetadata(
      {
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: new Date().toISOString(),
        blizzardSeasonId: input.blizzardSeasonId,
      },
      meta,
    ),
    dungeonSlugs: input.dungeonSlugs,
    encounterIds: input.dungeonSlugs.map((_, i) => i + 1),
  };
}

function livePreflightDeps(
  prisma: never,
  discoverActiveMplusCatalog: () => Promise<never>,
) {
  return {
    prisma,
    blizzard: {
      getMythicKeystoneSeasonIndex: async () => ({
        data: { current_season: { id: 18 } },
      }),
    } as never,
    logger: makeLogger() as never,
    env: {
      PROVIDER_MODE: "live" as const,
      ACTIVE_SCORE_MODEL_KEY: "default",
      ACTIVE_SCORE_MODEL_VERSION: 6,
    },
    getActiveModel: async () => ({ key: "default", version: 6 }),
    discoverActiveMplusCatalog,
  };
}

describe("refresh-character publication TOCTOU (fresh Effective Scoring Season)", () => {
  const previousMode = process.env.PROVIDER_MODE;
  const slugs17 = ["a", "b"] as const;
  const slugs18 = ["c", "d"] as const;
  const Z17 = 47;
  const Z18 = 48;

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    process.env.PROVIDER_MODE = "live";
    delete process.env.WCL_MPLUS_ZONE_ID;
    delete process.env.WCL_MPLUS_ZONE_MODE;
    delete process.env.WCL_MPLUS_ZONE_EXPIRES_AT;
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.PROVIDER_MODE;
    else process.env.PROVIDER_MODE = previousMode;
  });

  function dualSeasonPrisma(selection: { mode: "AUTO" } | { mode: "PINNED"; blizzardSeasonId: number }) {
    return makePrisma({
      seasons: [
        readySeason({
          blizzardSeasonId: 17,
          isCurrent: false,
          wclZoneId: Z17,
          dungeonSlugs: [...slugs17],
        }),
        readySeason({
          blizzardSeasonId: 18,
          isCurrent: true,
          wclZoneId: Z18,
          dungeonSlugs: [...slugs18],
        }),
      ],
      runtimeSetting: { value: selection, version: 1 },
    });
  }

  it("PINNED 17 → AUTO 18 during in-flight job: late contract uses 18/Z18 and publication is refused", async () => {
    const { prisma } = dualSeasonPrisma({ mode: "PINNED", blizzardSeasonId: 17 });
    const discover = vi.fn(async () => {
      throw new Error("catalog already ready — WorldData must not run");
    });
    const deps = livePreflightDeps(prisma, discover);

    const startHash = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: "blizzard-season-17",
      providerMode: "live",
      abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      zoneId: Z17,
    }).hash;

    const preflight = await runRefreshContractPreflight(
      deps,
      buildJob(startHash, 17, "blizzard-season-17"),
      { jobId: "job-pin-to-auto-start" },
    );
    expect(preflight.effective.blizzardSeasonId).toBe(17);
    expect(preflight.effective.wclZoneId).toBe(Z17);
    expect(preflight.hash).toBe(startHash);

    await updateScoringSeasonSelection(prisma, { mode: "AUTO", expectedVersion: 1 }, null);

    const publication = await resolvePublicationRefreshContract(deps, buildJob(startHash, 17, "blizzard-season-17"), {
      scoringModelKey: "default",
      scoringModelVersion: 6,
    });

    expect(publication.effective.selectionMode).toBe("AUTO");
    expect(publication.effective.blizzardSeasonId).toBe(18);
    expect(publication.effective.wclZoneId).toBe(Z18);
    expect(publication.contract.activeSeasonId).toBe("blizzard-season-18");
    expect(publication.contract.zoneId).toBe(Z18);
    expect(publication.hash).not.toBe(preflight.hash);
    expect(discover).not.toHaveBeenCalled();
    // Pipeline refuse condition: requested job hash !== freshly resolved late hash.
    expect(Boolean(startHash && startHash !== publication.hash)).toBe(true);
  });

  it("AUTO 18 → PINNED 17 during in-flight job: late contract uses 17/Z17 and publication is refused", async () => {
    const { prisma } = dualSeasonPrisma({ mode: "AUTO" });
    const discover = vi.fn(async () => {
      throw new Error("catalog already ready — WorldData must not run");
    });
    const deps = livePreflightDeps(prisma, discover);

    const startHash = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: "blizzard-season-18",
      providerMode: "live",
      abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      zoneId: Z18,
    }).hash;

    const preflight = await runRefreshContractPreflight(
      deps,
      buildJob(startHash, 18, "blizzard-season-18"),
      { jobId: "job-auto-to-pin-start" },
    );
    expect(preflight.effective.blizzardSeasonId).toBe(18);
    expect(preflight.effective.wclZoneId).toBe(Z18);
    expect(preflight.hash).toBe(startHash);

    await updateScoringSeasonSelection(
      prisma,
      { mode: "PINNED", blizzardSeasonId: 17, expectedVersion: 1 },
      null,
    );

    const publication = await resolvePublicationRefreshContract(deps, buildJob(startHash, 18, "blizzard-season-18"), {
      scoringModelKey: "default",
      scoringModelVersion: 6,
    });

    expect(publication.effective.selectionMode).toBe("PINNED");
    expect(publication.effective.blizzardSeasonId).toBe(17);
    expect(publication.effective.wclZoneId).toBe(Z17);
    expect(publication.contract.activeSeasonId).toBe("blizzard-season-17");
    expect(publication.contract.zoneId).toBe(Z17);
    expect(publication.hash).not.toBe(preflight.hash);
    expect(discover).not.toHaveBeenCalled();
    expect(Boolean(startHash && startHash !== publication.hash)).toBe(true);
  });

  it("PINNED 17 remains PINNED 17: late contract matches job-start and publication succeeds", async () => {
    const { prisma } = dualSeasonPrisma({ mode: "PINNED", blizzardSeasonId: 17 });
    const discover = vi.fn(async () => {
      throw new Error("catalog already ready — WorldData must not run");
    });
    const deps = livePreflightDeps(prisma, discover);

    const startHash = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: "blizzard-season-17",
      providerMode: "live",
      abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      zoneId: Z17,
    }).hash;

    const preflight = await runRefreshContractPreflight(
      deps,
      buildJob(startHash, 17, "blizzard-season-17"),
      { jobId: "job-stable-pin-start" },
    );
    expect(preflight.effective.blizzardSeasonId).toBe(17);
    expect(preflight.effective.wclZoneId).toBe(Z17);

    const publication = await resolvePublicationRefreshContract(deps, buildJob(startHash, 17, "blizzard-season-17"), {
      scoringModelKey: "default",
      scoringModelVersion: 6,
    });

    expect(publication.effective.selectionMode).toBe("PINNED");
    expect(publication.effective.blizzardSeasonId).toBe(17);
    expect(publication.effective.wclZoneId).toBe(Z17);
    expect(publication.contract.zoneId).toBe(Z17);
    expect(publication.hash).toBe(preflight.hash);
    expect(publication.hash).toBe(startHash);
    expect(discover).not.toHaveBeenCalled();
    expect(startHash === publication.hash).toBe(true);
  });
});

function scoringPersistPrisma(saved: Array<Record<string, unknown>> = []) {
  return {
    scoreWrites: () => saved.length,
    scoreModel: {
      findUnique: async () => ({ config: {} }),
    },
    characterScore: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const row = { id: `score-${saved.length + 1}`, ...create };
        saved.push(row);
        return row;
      },
    },
  } as never & { scoreWrites: () => number };
}

function persistAfterBarrierInput(
  prisma: never,
  beforeCharacterScorePersist: () => Promise<void>,
) {
  return {
    identity: {
      characterId: "11111111-1111-4111-8111-111111111111",
      region: "EU" as const,
      realm: "tarren-mill",
      characterName: "Rolloverchar",
    },
    seasonId: "s17",
    seasonSlug: "blizzard-season-17",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    activeDungeonSlugs: ["a", "b"],
    candidates: [],
    evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
    highKeyPolicyId: "policy-1",
    scoringModelId: "model-1",
    allowProviderCalls: false,
    zoneId: 47,
    persistCharacterScore: true,
    beforeCharacterScorePersist,
    ports: createMemoryOrchestrationPorts(),
    artifacts: {} as never,
    evidence: {} as never,
    prisma,
    ensurePerformanceAggregate: async () => ({
      state: "UNAVAILABLE" as const,
      data: null,
      reason: "test",
      cache: "MISS" as const,
      providerCalls: 0,
      created: false as const,
      updated: false as const,
      aggregateRowId: null,
      contentHash: null,
    }),
  };
}

describe("CharacterScore persist barrier after publication TOCTOU", () => {
  const previousMode = process.env.PROVIDER_MODE;
  const slugs17 = ["a", "b"] as const;
  const slugs18 = ["c", "d"] as const;
  const Z17 = 47;
  const Z18 = 48;

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    process.env.PROVIDER_MODE = "live";
    delete process.env.WCL_MPLUS_ZONE_ID;
    delete process.env.WCL_MPLUS_ZONE_MODE;
    delete process.env.WCL_MPLUS_ZONE_EXPIRES_AT;
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.PROVIDER_MODE;
    else process.env.PROVIDER_MODE = previousMode;
  });

  function dualSeasonPrisma(selection: { mode: "AUTO" } | { mode: "PINNED"; blizzardSeasonId: number }) {
    return makePrisma({
      seasons: [
        readySeason({
          blizzardSeasonId: 17,
          isCurrent: false,
          wclZoneId: Z17,
          dungeonSlugs: [...slugs17],
        }),
        readySeason({
          blizzardSeasonId: 18,
          isCurrent: true,
          wclZoneId: Z18,
          dungeonSlugs: [...slugs18],
        }),
      ],
      runtimeSetting: { value: selection, version: 1 },
    });
  }

  it("A: PINNED17 → AUTO18 after barrier/before write does not persist CharacterScore", async () => {
    const { prisma } = dualSeasonPrisma({ mode: "PINNED", blizzardSeasonId: 17 });
    const deps = livePreflightDeps(prisma, async () => {
      throw new Error("catalog already ready — WorldData must not run");
    });
    const job = buildJob(
      resolveActiveRefreshContract({
        scoringModelKey: "default",
        scoringModelVersion: 6,
        activeSeasonId: "blizzard-season-17",
        providerMode: "live",
        zoneId: Z17,
        abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      }).hash,
      17,
      "blizzard-season-17",
    );

    const barrier = await resolvePublicationRefreshContract(deps, job, {
      scoringModelKey: "default",
      scoringModelVersion: 6,
    });
    expect(barrier.effective.blizzardSeasonId).toBe(17);
    expect(barrier.hash).toBe(job.refreshContractHash);

    await updateScoringSeasonSelection(prisma, { mode: "AUTO", expectedVersion: 1 }, null);

    const saved: Array<Record<string, unknown>> = [];
    const scoringPrisma = scoringPersistPrisma(saved);
    await expect(
      scoreCharacter(
        persistAfterBarrierInput(scoringPrisma, async () => {
          await assertPublicationContractMatchesJob(deps, job, {
            expectedHash: barrier.hash,
            scoringModelKey: "default",
            scoringModelVersion: 6,
          });
        }),
      ),
    ).rejects.toMatchObject({ code: "REFRESH_CONTRACT_HASH_MISMATCH" });
    expect(saved).toHaveLength(0);
  });

  it("B: AUTO18 → PINNED17 after barrier/before write does not persist CharacterScore", async () => {
    const { prisma } = dualSeasonPrisma({ mode: "AUTO" });
    const deps = livePreflightDeps(prisma, async () => {
      throw new Error("catalog already ready — WorldData must not run");
    });
    const job = buildJob(
      resolveActiveRefreshContract({
        scoringModelKey: "default",
        scoringModelVersion: 6,
        activeSeasonId: "blizzard-season-18",
        providerMode: "live",
        zoneId: Z18,
        abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      }).hash,
      18,
      "blizzard-season-18",
    );

    const barrier = await resolvePublicationRefreshContract(deps, job, {
      scoringModelKey: "default",
      scoringModelVersion: 6,
    });
    expect(barrier.effective.blizzardSeasonId).toBe(18);
    expect(barrier.hash).toBe(job.refreshContractHash);

    await updateScoringSeasonSelection(
      prisma,
      { mode: "PINNED", blizzardSeasonId: 17, expectedVersion: 1 },
      null,
    );

    const saved: Array<Record<string, unknown>> = [];
    const scoringPrisma = scoringPersistPrisma(saved);
    await expect(
      scoreCharacter(
        persistAfterBarrierInput(scoringPrisma, async () => {
          await assertPublicationContractMatchesJob(deps, job, {
            expectedHash: barrier.hash,
            scoringModelKey: "default",
            scoringModelVersion: 6,
          });
        }),
      ),
    ).rejects.toMatchObject({ code: "REFRESH_CONTRACT_HASH_MISMATCH" });
    expect(saved).toHaveLength(0);
  });

  it("C: no setting change persists CharacterScore exactly once", async () => {
    const { prisma } = dualSeasonPrisma({ mode: "PINNED", blizzardSeasonId: 17 });
    const deps = livePreflightDeps(prisma, async () => {
      throw new Error("catalog already ready — WorldData must not run");
    });
    const job = buildJob(
      resolveActiveRefreshContract({
        scoringModelKey: "default",
        scoringModelVersion: 6,
        activeSeasonId: "blizzard-season-17",
        providerMode: "live",
        zoneId: Z17,
        abilityCatalogExecutionPin: BOOTSTRAP_TEST_RELEASE_PIN,
      }).hash,
      17,
      "blizzard-season-17",
    );

    const barrier = await resolvePublicationRefreshContract(deps, job, {
      scoringModelKey: "default",
      scoringModelVersion: 6,
    });
    expect(barrier.effective.blizzardSeasonId).toBe(17);

    const saved: Array<Record<string, unknown>> = [];
    const scoringPrisma = scoringPersistPrisma(saved);
    const result = await scoreCharacter(
      persistAfterBarrierInput(scoringPrisma, async () => {
        await assertPublicationContractMatchesJob(deps, job, {
          expectedHash: barrier.hash,
          scoringModelKey: "default",
          scoringModelVersion: 6,
        });
      }),
    );
    expect(result.characterScoreId).toBe("score-1");
    expect(saved).toHaveLength(1);
  });
});


