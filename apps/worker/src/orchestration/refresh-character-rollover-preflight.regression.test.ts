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
  type PersistedActiveMplusCatalogMetadata,
} from "./active-mplus-season/index.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import { runRefreshContractPreflight } from "./refresh-contract-preflight.js";
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

  it("source guard: publication TOCTOU rebuilds contract with preflightEffective.wclZoneId", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "refresh-pipeline.ts"), "utf8");
    expect(src).toMatch(/zoneId:\s*preflightEffective\.wclZoneId/);
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
      }),
    ).toThrow(ZONE_MISSING_MSG);
  });
});
