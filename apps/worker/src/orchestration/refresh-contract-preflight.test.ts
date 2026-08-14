import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { hashRefreshContract, type RefreshCharacterJob } from "@mplus/contracts";
import { decideScoreRefresh } from "@mplus/config";
import {
  REFRESH_CONTRACT_PREFLIGHT_MISMATCH,
  REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH,
  RefreshContractPreflightError,
  runRefreshContractPreflight,
  isRefreshContractPreflightError,
} from "./refresh-contract-preflight.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";
import { classifyError } from "./retry-classification.js";
import { runRefreshPipeline } from "./refresh-pipeline.js";
import { clearSeasonAuthorityCacheForTests } from "./season-authority.js";
import type { WorkerContainer } from "../container.js";
import type { VerifiedSeasonAuthority } from "./season-authority.js";
import { stubEffectiveFromAuthority } from "./refresh-contract-preflight.test-helpers.js";
import { computeDungeonPoolHash } from "./active-mplus-season/types.js";

const PIPELINE_TEST_SLUGS = ["stub-a", "stub-b"] as const;
const PIPELINE_TEST_POOL_HASH = computeDungeonPoolHash(PIPELINE_TEST_SLUGS);

const authority: VerifiedSeasonAuthority = {
  regionCode: "EU",
  regionId: "reg-eu",
  seasonRowId: "season-row-1",
  blizzardSeasonId: 13,
  slug: "blizzard-season-13",
  authoritySource: "season_index.current_season",
  authorityVerifiedAt: new Date("2026-07-31T00:00:00.000Z"),
  resolution: "memory",
};

function liveEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PROVIDER_MODE: "live",
  };
}

function matchingHash(providerMode: "fixture" | "live" = "live"): string {
  return resolveActiveRefreshContract({
    scoringModelKey: "default",
    scoringModelVersion: 6,
    activeSeasonId: authority.slug,
    providerMode,
    zoneId: providerMode === "live" ? 39 : undefined,
    partition: null,
  }).hash;
}

function buildJob(overrides: Partial<RefreshCharacterJob> = {}): RefreshCharacterJob {
  return {
    characterId: "11111111-1111-4111-8111-111111111111",
    region: "EU",
    realmSlug: "tarren-mill",
    name: "Preflightchar",
    priority: "normal",
    forceRefresh: false,
    requestedAt: "2026-07-31T00:00:00.000Z",
    refreshContractHash: matchingHash("live"),
    triggerSource: "PROFILE_READ",
    authoritativeSeasonId: 13,
    authoritativeSeasonSlug: "blizzard-season-13",
    ...overrides,
  } as RefreshCharacterJob;
}

describe("refresh contract preflight barrier", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const resolveEffective = vi.fn(async () => stubEffectiveFromAuthority(authority, 39));
  const previousMode = process.env.PROVIDER_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveEffective.mockResolvedValue(stubEffectiveFromAuthority(authority, 39));
    clearSeasonAuthorityCacheForTests();
    process.env.PROVIDER_MODE = "live";
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.PROVIDER_MODE;
    else process.env.PROVIDER_MODE = previousMode;
  });

  function buildDeps(providerMode: "fixture" | "live" = "live") {
    return {
      prisma: {
        region: {
          findUnique: vi.fn(async () => ({ id: "reg-eu", code: "EU" })),
          create: vi.fn(async () => ({ id: "reg-eu", code: "EU" })),
        },
      } as never,
      blizzard: {
        resolveAuthoritativeCurrentSeasonId: vi.fn(async () => {
          throw new Error("Blizzard season sync must not run when authority is injected");
        }),
        getCharacterProfile: vi.fn(async () => {
          throw new Error("Blizzard profile must not run during preflight unit tests");
        }),
      } as never,
      logger: logger as never,
      env: {
        PROVIDER_MODE: providerMode,
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
      },
      getActiveModel: vi.fn(async () => ({ key: "default", version: 6 })),
      resolveEffective,
      processEnv:
        providerMode === "live"
          ? liveEnv()
          : ({ ...process.env, PROVIDER_MODE: "fixture" } as NodeJS.ProcessEnv),
      zoneId: providerMode === "live" ? 39 : undefined,
      partition: null as number | null,
    };
  }

  it("matching hash proceeds and uses verified season authority slug", async () => {
    const expected = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: authority.slug,
      providerMode: "live",
      zoneId: 39,
      partition: null,
    });
    const result = await runRefreshContractPreflight(
      buildDeps("live"),
      buildJob({ refreshContractHash: expected.hash }),
      { jobId: "job-1" },
    );

    expect(result.hash).toBe(expected.hash);
    expect(result.effective.activeSeasonId).toBe("blizzard-season-13");
    expect(resolveEffective).toHaveBeenCalled();
    expect(result.missingHashAllowed).toBe(false);
  });

  it("uses verified authority rather than stale Season.isCurrent data", async () => {
    const staleIsCurrentSlug = "blizzard-season-3";
    resolveEffective.mockResolvedValue(stubEffectiveFromAuthority({
      ...authority,
      blizzardSeasonId: 17,
      slug: "blizzard-season-17",
    }));
    const computed = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: "blizzard-season-17",
      providerMode: "live",
      env: liveEnv(),
      zoneId: 39,
      partition: null,
    });
    const staleHash = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: staleIsCurrentSlug,
      providerMode: "live",
      env: liveEnv(),
      zoneId: 39,
      partition: null,
    }).hash;

    await expect(
      runRefreshContractPreflight(
        buildDeps("live"),
        buildJob({ refreshContractHash: staleHash }),
        { jobId: "job-stale" },
      ),
    ).rejects.toMatchObject({
      code: REFRESH_CONTRACT_PREFLIGHT_MISMATCH,
      computedHash: computed.hash,
    });
    expect(staleHash).not.toBe(computed.hash);
  });

  it("mismatch fails with dedicated non-retryable code", async () => {
    const err = await runRefreshContractPreflight(
      buildDeps("live"),
      buildJob({ refreshContractHash: "a".repeat(64) }),
      { jobId: "job-mismatch" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RefreshContractPreflightError);
    expect((err as RefreshContractPreflightError).code).toBe(REFRESH_CONTRACT_PREFLIGHT_MISMATCH);
    expect((err as RefreshContractPreflightError).retryable).toBe(false);
    expect((err as RefreshContractPreflightError).providerFailure).toBe(false);
    expect((err as RefreshContractPreflightError).providerCalls).toBe(0);
    expect((err as RefreshContractPreflightError).stage).toBe("preflight");

    const classification = classifyError(err);
    expect(classification.retryable).toBe(false);
    expect(classification.providerFailure).toBe(false);
    expect(isRefreshContractPreflightError(err)).toBe(true);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "refresh_contract_preflight_mismatch",
        stage: "preflight",
        jobId: "job-mismatch",
        providerCalls: 0,
        requestedHash: "a".repeat(64),
      }),
      expect.any(String),
    );
  });

  it("live jobs without a hash fail closed", async () => {
    await expect(
      runRefreshContractPreflight(
        buildDeps("live"),
        buildJob({ refreshContractHash: undefined }),
        { jobId: "job-missing" },
      ),
    ).rejects.toMatchObject({ code: REFRESH_CONTRACT_PREFLIGHT_MISSING_HASH });
  });

  it("fixture jobs without a hash keep minimum compatibility", async () => {
    const result = await runRefreshContractPreflight(
      buildDeps("fixture"),
      buildJob({ refreshContractHash: undefined }),
      { jobId: "job-fixture" },
    );
    expect(result.missingHashAllowed).toBe(true);
    expect(result.hash).toHaveLength(64);
  });

  it("API and worker generate the same hash from the same contract inputs", () => {
    const api = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: authority.slug,
      providerMode: "live",
      env: liveEnv(),
      zoneId: 39,
      partition: null,
    });
    const worker = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: authority.slug,
      providerMode: "live",
      env: liveEnv(),
      zoneId: 39,
      partition: null,
    });
    expect(api.hash).toBe(worker.hash);
    expect(hashRefreshContract(api.contract)).toBe(api.hash);
  });

  it("final publication/TOCTOU barrier still catches a post-preflight contract change", () => {
    const preflight = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 6,
      activeSeasonId: authority.slug,
      providerMode: "live",
      env: liveEnv(),
      zoneId: 39,
      partition: null,
    });
    const publication = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 7,
      activeSeasonId: authority.slug,
      providerMode: "live",
      env: liveEnv(),
      zoneId: 39,
      partition: null,
    });
    expect(preflight.hash).not.toBe(publication.hash);
    expect(Boolean(preflight.hash && preflight.hash !== publication.hash)).toBe(true);
  });

  it("failed preflight maps to STALE_CONTRACT rather than generic BACKOFF", () => {
    const decision = decideScoreRefresh({
      hasPublishedScore: true,
      scoreCalculatedAt: new Date(Date.now() - 8 * 86_400_000),
      scoreTtlSeconds: 604_800,
      failureBackoffSeconds: 3_600,
      activeJobStatus: null,
      latestJobStatus: "FAILED",
      latestJobFinishedAt: new Date(),
      latestJobErrorCode: REFRESH_CONTRACT_PREFLIGHT_MISMATCH,
      contractReasons: [],
    });
    expect(decision.action).toBe("NONE");
    expect(decision.action).not.toBe("BACKOFF");
    expect(decision.reason).toBe("STALE_CONTRACT");
    expect(decision.publicState).toBe("STALE_USABLE");
  });
});

describe("refresh pipeline — preflight stops before providers", () => {
  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    process.env.WCL_MPLUS_ZONE_ID = "39";
    process.env.WCL_MPLUS_ZONE_EXPIRES_AT = "2099-01-01T00:00:00.000Z";
    process.env.PROVIDER_MODE = "live";
  });

  it("mismatch fails before Blizzard, Raider.IO, or WCL adapters and writes nothing", async () => {
    const getCharacterProfile = vi.fn(async () => {
      throw new Error("blizzard profile must not run");
    });
    const getMythicKeystoneProfile = vi.fn(async () => {
      throw new Error("blizzard m+ must not run");
    });
    const resolveAuthoritativeCurrentSeasonId = vi.fn(async () => ({
      data: {
        seasonId: 13,
        slug: "blizzard-season-13",
        source: "season_index.current_season",
      },
    }));
    const getCharacterProfileRio = vi.fn(async () => {
      throw new Error("raiderio must not run");
    });
    const getCharacterParses = vi.fn(async () => {
      throw new Error("wcl must not run");
    });

    const upsertObservations = vi.fn();
    const upsertProviderState = vi.fn();
    const saveScoreSnapshot = vi.fn();
    const upsertRuns = vi.fn();
    const getPublishedSnapshot = vi.fn(async () => ({
      id: "snap-1",
      overallScore: 72,
      grade: "B",
    }));
    const markFailed = vi.fn(async (_id: string, error: unknown) => ({
      id: "job-1",
      status: "FAILED",
      error,
    }));
    const createOrGetByDedupe = vi.fn(async () => ({
      job: { id: "job-1", status: "QUEUED" },
      reused: false,
    }));
    const markActive = vi.fn(async () => ({ id: "job-1", status: "ACTIVE" }));
    const findById = vi.fn(async () => ({ id: "job-1", status: "FAILED" }));
    const upsertCharacter = vi.fn(async () => {
      throw new Error("character upsert must not run after preflight mismatch");
    });

    const verifiedAt = new Date().toISOString();
    const container = {
      env: {
        PROVIDER_MODE: "live",
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        LOG_LEVEL: "silent",
      },
      prisma: {
        region: {
          findUnique: vi.fn(async () => ({ id: "reg-eu", code: "EU" })),
          create: vi.fn(async () => ({ id: "reg-eu", code: "EU" })),
        },
        runtimeSetting: {
          findUnique: vi.fn(async () => null),
        },
        season: {
          findFirst: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
            const season = {
              id: "season-1",
              slug: "blizzard-season-13",
              name: "Season 13",
              regionId: "reg-eu",
              blizzardSeasonId: 13,
              isCurrent: true,
              dungeonCount: 2,
              metadata: {
                blizzardSeasonId: 13,
                authoritySource: "season_index.current_season",
                authorityVerifiedAt: verifiedAt,
                activeMplusCatalog: {
                  schemaVersion: "active-mplus-catalog-v1",
                  wclZoneId: 39,
                  blizzardSeasonId: 13,
                  expansionIdentity: "Fixture",
                  dungeonPoolHash: PIPELINE_TEST_POOL_HASH,
                  sourceMetadataHash: "abc",
                  catalogVersion: `active-mplus-season-authority-v1:zone-39:pool-${PIPELINE_TEST_POOL_HASH.slice(0, 12)}`,
                  dungeonSlugs: [...PIPELINE_TEST_SLUGS],
                  synchronizedAt: verifiedAt,
                  validatedAt: verifiedAt,
                  lastKnownGood: true,
                  authorityVersion: "active-mplus-season-authority-v1",
                },
              },
            };
            if (args?.where?.slug && args.where.slug !== season.slug) return null;
            return season;
          }),
          findMany: vi.fn(async () => [
            {
              id: "season-1",
              slug: "blizzard-season-13",
              name: "Season 13",
              regionId: "reg-eu",
              blizzardSeasonId: 13,
              isCurrent: true,
              dungeonCount: 2,
              metadata: {
                blizzardSeasonId: 13,
                authoritySource: "season_index.current_season",
                authorityVerifiedAt: verifiedAt,
                activeMplusCatalog: {
                  schemaVersion: "active-mplus-catalog-v1",
                  wclZoneId: 39,
                  blizzardSeasonId: 13,
                  expansionIdentity: "Fixture",
                  dungeonPoolHash: PIPELINE_TEST_POOL_HASH,
                  sourceMetadataHash: "abc",
                  catalogVersion: `active-mplus-season-authority-v1:zone-39:pool-${PIPELINE_TEST_POOL_HASH.slice(0, 12)}`,
                  dungeonSlugs: [...PIPELINE_TEST_SLUGS],
                  synchronizedAt: verifiedAt,
                  validatedAt: verifiedAt,
                  lastKnownGood: true,
                  authorityVersion: "active-mplus-season-authority-v1",
                },
              },
            },
          ]),
          findUnique: vi.fn(async () => null),
        },
        seasonDungeon: {
          findMany: vi.fn(async () => [
            {
              sortOrder: 0,
              dungeon: { id: "d1", slug: "stub-a", wclZoneOrEncounterId: 1001n },
            },
            {
              sortOrder: 1,
              dungeon: { id: "d2", slug: "stub-b", wclZoneOrEncounterId: 1002n },
            },
          ]),
        },
        refreshCostLedgerEntry: {
          create: vi.fn(async () => {
            throw new Error("cost ledger must not be written on preflight mismatch");
          }),
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      providers: {
        blizzard: {
          getCharacterProfile,
          getMythicKeystoneProfile,
          resolveAuthoritativeCurrentSeasonId,
        },
        raiderio: {
          getCharacterProfile: getCharacterProfileRio,
        },
        warcraftlogs: {
          getCharacterParses,
        },
      },
      disabledProviders: new Set(),
      repositories: {
        job: {
          createOrGetByDedupe,
          markActive,
          markFailed,
          findById,
          attachCharacter: vi.fn(),
        },
        character: {
          upsertCharacter,
          updateRefreshTimestamps: vi.fn(),
        },
        providerState: { upsert: upsertProviderState },
        metric: { upsertObservations, listObservations: vi.fn() },
        score: {
          getActiveModel: vi.fn(async () => ({
            id: "model-1",
            key: "default",
            version: 6,
            config: {},
          })),
          saveScoreSnapshot,
          getPublishedSnapshot,
        },
        run: { upsertRuns, listRunsForCharacter: vi.fn() },
        analysisBatch: {
          createBatch: vi.fn(),
          claimFinalization: vi.fn(),
          markFinalized: vi.fn(),
        },
      },
    } as unknown as WorkerContainer;

    const job = buildJob({ refreshContractHash: "b".repeat(64) });

    await expect(runRefreshPipeline(container, job)).rejects.toMatchObject({
      code: REFRESH_CONTRACT_PREFLIGHT_MISMATCH,
      retryable: false,
      providerFailure: false,
    });

    expect(getCharacterProfile).not.toHaveBeenCalled();
    expect(getMythicKeystoneProfile).not.toHaveBeenCalled();
    expect(getCharacterProfileRio).not.toHaveBeenCalled();
    expect(getCharacterParses).not.toHaveBeenCalled();
    expect(upsertCharacter).not.toHaveBeenCalled();
    expect(upsertProviderState).not.toHaveBeenCalled();
    expect(upsertObservations).not.toHaveBeenCalled();
    expect(saveScoreSnapshot).not.toHaveBeenCalled();
    expect(upsertRuns).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        code: REFRESH_CONTRACT_PREFLIGHT_MISMATCH,
        retryable: false,
        providerFailure: false,
        stage: "preflight",
      }),
    );
    expect(getPublishedSnapshot).not.toHaveBeenCalled();
    expect(container.prisma.refreshCostLedgerEntry.create).not.toHaveBeenCalled();
  });
});
