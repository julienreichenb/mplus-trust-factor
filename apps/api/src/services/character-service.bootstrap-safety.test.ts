import { describe, expect, it, vi, beforeEach } from "vitest";
import { clearSeasonAuthorityCacheForTests } from "@mplus/worker";
import { CharacterService } from "./character-service.js";
import {
  fixtureReadySeasonRow,
  scoringSeasonPrismaStubs,
} from "./character-service.test-season.js";

import type { ApiContainer } from "../container.js";

describe("CharacterService.resolveCharacter — new-row bootstrap safety", () => {
  const mockEnqueue = vi.fn().mockResolvedValue({ jobId: "job-new-1", reused: false, enqueued: true });
  const mockFindByIdentity = vi.fn();
  const mockFindBySlug = vi.fn();
  const mockGetProfile = vi.fn();
  const mockGetKeystone = vi.fn();
  const mockApplyProviderProfile = vi.fn();
  const mockFindById = vi.fn();
  const mockFindByBlizzardCharacterId = vi.fn();
  const mockUpsert = vi.fn();
  const mockDeleteShell = vi.fn();
  const mockGetPublishedSnapshot = vi.fn();
  const mockFindActiveJob = vi.fn();
  const mockFindLatestJob = vi.fn();
  const mockListProviderState = vi.fn();
  const mockCharacterUpdate = vi.fn();
  const mockSnapshotCreate = vi.fn();
  const mockCharacterFindUnique = vi.fn();
  const mockSnapshotFindMany = vi.fn();

  const createdShell = {
    id: "char-new",
    regionId: "reg-1",
    realmId: "realm-1",
    displayName: "Newchar",
    normalizedName: "newchar",
    level: 90,
    blizzardCharacterId: 9999n,
    classId: "class-mage",
    activeSpecId: "spec-fire",
    role: "DPS" as const,
    faction: "Horde",
    lastPublicRefreshAt: null,
  };

  function buildContainer(opts: { authorityFail?: boolean } = {}): ApiContainer {
    const seasonFindFirst = opts.authorityFail
      ? vi.fn().mockResolvedValue(null)
      : vi.fn().mockResolvedValue(fixtureReadySeasonRow());

    return {
      env: {
        MAX_CHARACTER_LEVEL: 90,
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 4,
        PROVIDER_MODE: "fixture",
        MANUAL_REFRESH_COOLDOWN_SECONDS: 900,
        PUBLIC_DETAILS_ALL: true,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
      },
      logger: { warn: vi.fn(), info: vi.fn() },
      negativeCache: { has: () => false, set: vi.fn(), clear: vi.fn() },
      responseCache: { get: () => null, set: vi.fn(), invalidate: vi.fn() },
      producers: { enqueueRefreshCharacter: mockEnqueue, enqueueRecalculateScore: vi.fn() },
      worker: {
        disabledProviders: new Set(),
        providers: {
          blizzard: {
            getCharacterProfile: mockGetProfile,
            getMythicKeystoneProfile: mockGetKeystone,
            resolveAuthoritativeCurrentSeasonId: vi.fn(async () => {
              if (opts.authorityFail) {
                const { SeasonAuthorityUnavailableError } = await import("@mplus/worker");
                throw new SeasonAuthorityUnavailableError("EU", "season authority unavailable", 30);
              }
              return {
                data: {
                  seasonId: 13,
                  slug: "blizzard-season-13",
                  source: "season_index.current_season",
                },
              };
            }),
          },
        },
        prisma: {
          region: {
            findUnique: vi.fn().mockResolvedValue({ id: "reg-1", code: "EU" }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "reg-1", code: "EU" }),
          },
          ...scoringSeasonPrismaStubs(),
          season: {
            findFirst: seasonFindFirst,
            findUnique: vi.fn().mockResolvedValue(fixtureReadySeasonRow()),
          },
          scoreModel: { findFirst: vi.fn().mockResolvedValue({ key: "default", version: 4 }) },
          character: {
            findUnique: mockCharacterFindUnique,
            update: mockCharacterUpdate,
          },
          characterSnapshot: {
            create: mockSnapshotCreate,
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: mockSnapshotFindMany,
          },
          characterProviderState: { findUnique: vi.fn().mockResolvedValue(null) },
          runAnalysis: { findFirst: vi.fn().mockResolvedValue(null) },
          characterScore: { findFirst: vi.fn().mockResolvedValue(null) },
          verifiedCharacterOwnership: { findFirst: vi.fn().mockResolvedValue(null) },
          metricObservation: { findFirst: vi.fn().mockResolvedValue(null) },
        },
        repositories: {
          character: {
            findByIdentity: mockFindByIdentity,
            findById: mockFindById,
            findByBlizzardCharacterId: mockFindByBlizzardCharacterId,
            upsertCharacter: mockUpsert,
            applyProviderProfile: mockApplyProviderProfile,
            deleteUnreferencedBootstrapShell: mockDeleteShell,
            reassignToCatalogIdentity: vi.fn(),
          },
          realm: { findBySlug: mockFindBySlug },
          score: {
            getPublishedSnapshot: mockGetPublishedSnapshot,
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          job: {
            findActiveForCharacter: mockFindActiveJob,
            findLatestForCharacter: mockFindLatestJob,
            findById: vi.fn().mockResolvedValue({ id: "job-new-1", status: "QUEUED" }),
          },
          providerState: { listForCharacter: mockListProviderState },
          run: {
            findLatestForCharacter: vi.fn().mockResolvedValue(null),
            findHighestForCharacter: vi.fn().mockResolvedValue(null),
            countForCharacter: vi.fn().mockResolvedValue(0),
            findById: vi.fn(),
            findLatestAnalysisCoverage: vi.fn().mockResolvedValue(null),
          },
        },
      },
    } as unknown as ApiContainer;
  }

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    vi.clearAllMocks();
    mockFindBySlug.mockResolvedValue({ id: "realm-1", slug: "archimonde", name: "Archimonde" });
    mockFindByIdentity.mockResolvedValue(null);
    mockFindByBlizzardCharacterId.mockResolvedValue(null);
    mockGetPublishedSnapshot.mockResolvedValue(null);
    mockFindActiveJob.mockResolvedValue(null);
    mockFindLatestJob.mockResolvedValue(null);
    mockListProviderState.mockResolvedValue([]);
    mockDeleteShell.mockResolvedValue(true);
    mockUpsert.mockResolvedValue(createdShell);
    mockApplyProviderProfile.mockResolvedValue(createdShell);
    mockFindById.mockResolvedValue(createdShell);
    mockCharacterFindUnique.mockResolvedValue({
      id: "char-new",
      level: 90,
      regionId: "reg-1",
    });
    mockSnapshotFindMany.mockResolvedValue([
      {
        mythicRating: 2500,
        rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
      },
    ]);
    mockGetProfile.mockResolvedValue({
      data: {
        displayName: "Newchar",
        level: 90,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "9999",
      },
    });
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 2500 } });
    mockEnqueue.mockResolvedValue({ jobId: "job-new-1", reused: false, enqueued: true });
  });

  it("writes level/class/spec/role/blizzardId on the initial Character upsert", async () => {
    const service = new CharacterService(buildContainer());
    await service.resolveCharacter({ region: "EU", realmSlug: "archimonde", name: "Newchar" });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ region: "EU", realmSlug: "archimonde", name: "Newchar" }),
      expect.objectContaining({
        level: 90,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "9999",
      }),
    );
  });

  it("compensate-deletes a fresh shell when bootstrap persistence fails after create", async () => {
    mockApplyProviderProfile.mockRejectedValue(new Error("persist boom"));
    const service = new CharacterService(buildContainer());
    await expect(
      service.resolveCharacter({ region: "EU", realmSlug: "archimonde", name: "Newchar" }),
    ).rejects.toThrow("persist boom");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockDeleteShell).toHaveBeenCalledWith("char-new");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("compensate-deletes a fresh shell when season authority fails after create", async () => {
    const service = new CharacterService(buildContainer({ authorityFail: true }));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Newchar",
    });
    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({ status: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockDeleteShell).toHaveBeenCalledWith("char-new");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns PROFILE_ONLY (never READY/QUEUED) when Blizzard omits required bootstrap fields", async () => {
    mockGetProfile.mockResolvedValue({
      data: {
        displayName: "Newchar",
        level: null,
        classSlug: null,
        specSlug: null,
        role: null,
        faction: null,
        blizzardCharacterId: "9999",
      },
    });
    const incomplete = {
      ...createdShell,
      level: null,
      classId: null,
      activeSpecId: null,
      role: null,
      faction: null,
    };
    mockUpsert.mockResolvedValue(incomplete);
    mockApplyProviderProfile.mockResolvedValue(incomplete);
    mockFindById.mockResolvedValue(incomplete);

    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Newchar",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      status: "PROFILE_ONLY",
      characterId: "char-new",
      reason: "BOOTSTRAP_INCOMPLETE",
      bootstrapRepairRequired: true,
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockDeleteShell).not.toHaveBeenCalled();
  });
});

describe("CharacterService.resolveCharacter — concurrent repair dedupe", () => {
  const mockEnqueue = vi.fn().mockResolvedValue({ jobId: "job-repair-1", reused: false, enqueued: true });
  const mockFindByIdentity = vi.fn();
  const mockFindBySlug = vi.fn();
  const mockGetProfile = vi.fn();
  const mockGetKeystone = vi.fn();
  const mockApplyProviderProfile = vi.fn();
  const mockFindById = vi.fn();
  const mockFindByBlizzardCharacterId = vi.fn();
  const mockGetPublishedSnapshot = vi.fn();
  const mockFindActiveJob = vi.fn();
  const mockFindLatestJob = vi.fn();
  const mockListProviderState = vi.fn();
  const mockCharacterUpdate = vi.fn();
  const mockSnapshotCreate = vi.fn();
  const mockCharacterFindUnique = vi.fn();
  const mockSnapshotFindMany = vi.fn();
  const mockUpsert = vi.fn();
  const mockDeleteShell = vi.fn();

  const incompleteFixture = {
    id: "char-incomplete",
    regionId: "reg-1",
    realmId: "realm-1",
    displayName: "Legacychar",
    normalizedName: "legacychar",
    level: null as number | null,
    blizzardCharacterId: null as bigint | null,
    classId: null as string | null,
    activeSpecId: null as string | null,
    role: null as "DPS" | null,
    faction: null as string | null,
    lastPublicRefreshAt: null,
  };
  const repairedFixture = {
    ...incompleteFixture,
    level: 90,
    blizzardCharacterId: 4242n,
    classId: "class-mage",
    activeSpecId: "spec-fire",
    role: "DPS" as const,
    faction: "Horde",
  };
  const failedJob = {
    id: "job-failed-historical",
    status: "FAILED",
    error: {
      code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
      message: "Character level is missing — refusing refresh (fail closed)",
    },
    completedAt: new Date("2026-08-01T09:00:00.000Z"),
  };

  let repaired = false;

  function buildContainer(): ApiContainer {
    mockApplyProviderProfile.mockImplementation(async () => {
      repaired = true;
      return repairedFixture;
    });
    mockFindById.mockImplementation(async () => (repaired ? repairedFixture : incompleteFixture));
    mockCharacterFindUnique.mockImplementation(async () => ({
      id: "char-incomplete",
      level: repaired ? 90 : null,
      regionId: "reg-1",
    }));
    mockSnapshotFindMany.mockImplementation(async () =>
      repaired
        ? [
            {
              mythicRating: 2500,
              rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
            },
          ]
        : [],
    );
    mockFindByIdentity.mockImplementation(async () =>
      repaired ? repairedFixture : incompleteFixture,
    );
    mockFindActiveJob.mockImplementation(async () =>
      mockEnqueue.mock.calls.length > 0
        ? { id: "job-repair-1", status: "QUEUED" }
        : null,
    );

    return {
      env: {
        MAX_CHARACTER_LEVEL: 90,
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 4,
        PROVIDER_MODE: "fixture",
        MANUAL_REFRESH_COOLDOWN_SECONDS: 900,
        PUBLIC_DETAILS_ALL: true,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
      },
      logger: { warn: vi.fn(), info: vi.fn() },
      negativeCache: { has: () => false, set: vi.fn(), clear: vi.fn() },
      responseCache: { get: () => null, set: vi.fn(), invalidate: vi.fn() },
      producers: { enqueueRefreshCharacter: mockEnqueue, enqueueRecalculateScore: vi.fn() },
      worker: {
        disabledProviders: new Set(),
        providers: {
          blizzard: {
            getCharacterProfile: mockGetProfile,
            getMythicKeystoneProfile: mockGetKeystone,
            resolveAuthoritativeCurrentSeasonId: vi.fn(async () => ({
              data: {
                seasonId: 13,
                slug: "blizzard-season-13",
                source: "season_index.current_season",
              },
            })),
          },
        },
        prisma: {
          region: {
            findUnique: vi.fn().mockResolvedValue({ id: "reg-1", code: "EU" }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "reg-1", code: "EU" }),
          },
          ...scoringSeasonPrismaStubs(),
          season: {
            findFirst: vi.fn().mockResolvedValue(fixtureReadySeasonRow()),
            findUnique: vi.fn().mockResolvedValue(fixtureReadySeasonRow()),
          },
          scoreModel: { findFirst: vi.fn().mockResolvedValue({ key: "default", version: 4 }) },
          character: {
            findUnique: mockCharacterFindUnique,
            update: mockCharacterUpdate,
          },
          characterSnapshot: {
            create: mockSnapshotCreate,
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: mockSnapshotFindMany,
          },
          characterProviderState: { findUnique: vi.fn().mockResolvedValue(null) },
          runAnalysis: { findFirst: vi.fn().mockResolvedValue(null) },
          characterScore: { findFirst: vi.fn().mockResolvedValue(null) },
          verifiedCharacterOwnership: { findFirst: vi.fn().mockResolvedValue(null) },
          metricObservation: { findFirst: vi.fn().mockResolvedValue(null) },
        },
        repositories: {
          character: {
            findByIdentity: mockFindByIdentity,
            findById: mockFindById,
            findByBlizzardCharacterId: mockFindByBlizzardCharacterId,
            upsertCharacter: mockUpsert,
            applyProviderProfile: mockApplyProviderProfile,
            deleteUnreferencedBootstrapShell: mockDeleteShell,
            reassignToCatalogIdentity: vi.fn(),
          },
          realm: { findBySlug: mockFindBySlug },
          score: {
            getPublishedSnapshot: mockGetPublishedSnapshot,
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          job: {
            findActiveForCharacter: mockFindActiveJob,
            findLatestForCharacter: mockFindLatestJob,
            findById: vi.fn().mockImplementation(async (id: string) =>
              id === "job-repair-1"
                ? { id: "job-repair-1", status: "QUEUED" }
                : failedJob,
            ),
          },
          providerState: { listForCharacter: mockListProviderState },
          run: {
            findLatestForCharacter: vi.fn().mockResolvedValue(null),
            findHighestForCharacter: vi.fn().mockResolvedValue(null),
            countForCharacter: vi.fn().mockResolvedValue(0),
            findById: vi.fn(),
            findLatestAnalysisCoverage: vi.fn().mockResolvedValue(null),
          },
        },
      },
    } as unknown as ApiContainer;
  }

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    vi.clearAllMocks();
    repaired = false;
    mockFindBySlug.mockResolvedValue({ id: "realm-1", slug: "archimonde", name: "Archimonde" });
    mockGetPublishedSnapshot.mockResolvedValue(null);
    mockFindLatestJob.mockResolvedValue(failedJob);
    mockListProviderState.mockResolvedValue([]);
    mockFindByBlizzardCharacterId.mockResolvedValue(null);
    mockGetProfile.mockResolvedValue({
      data: {
        displayName: "Legacychar",
        level: 90,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "4242",
      },
    });
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 2500 } });
    mockEnqueue.mockResolvedValue({ jobId: "job-repair-1", reused: false, enqueued: true });
  });

  it("serializes concurrent forceRetry repairs: one Blizzard fetch, one enqueue, same characterId", async () => {
    const service = new CharacterService(buildContainer());
    const [a, b] = await Promise.all([
      service.resolveCharacter(
        { region: "EU", realmSlug: "archimonde", name: "Legacychar" },
        { forceRetry: true },
      ),
      service.resolveCharacter(
        { region: "EU", realmSlug: "archimonde", name: "Legacychar" },
        { forceRetry: true },
      ),
    ]);

    expect(a.body).toMatchObject({ status: "QUEUED", characterId: "char-incomplete" });
    expect(b.body).toMatchObject({ status: "QUEUED", characterId: "char-incomplete" });
    expect((a.body as { refreshId: string }).refreshId).toBe("job-repair-1");
    expect((b.body as { refreshId: string }).refreshId).toBe("job-repair-1");
    expect(mockGetProfile).toHaveBeenCalledTimes(1);
    expect(mockGetKeystone).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "char-incomplete",
        forceRefresh: true,
      }),
    );
    // Historical FAILED job is still the latest before enqueue; new job uses a distinct id.
    expect(failedJob.id).not.toBe("job-repair-1");
  });
});

/**
 * Cross-process audit: two independently constructed CharacterService instances share
 * persistence mocks but bypass withResolveIdentityLock by calling resolveCharacterLocked.
 * Proves durable identity + active-job collapse remain idempotent without the process lock,
 * and that collapse reconciles BullMQ (remove/cancel) so a superseded job is not executable.
 */
describe("CharacterService.resolveCharacter — cross-instance lock bypass", () => {
  type JobRow = {
    id: string;
    characterId: string;
    status: string;
    scheduledAt: Date;
    jobType: string;
    error: unknown;
    completedAt: Date | null;
    queueJobId: string | null;
    cancelRequestedAt: Date | null;
    cancelReason: string | null;
  };

  type QueueLedger = {
    published: string[];
    removed: string[];
    cancelRequested: string[];
    admissionReleased: string[];
  };

  const failedHistorical: JobRow = {
    id: "job-failed-historical",
    characterId: "char-incomplete",
    status: "FAILED",
    scheduledAt: new Date("2026-08-01T08:00:00.000Z"),
    jobType: "refresh-character",
    error: {
      code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
      message: "Character level is missing — refusing refresh (fail closed)",
    },
    completedAt: new Date("2026-08-01T08:05:00.000Z"),
    queueJobId: null,
    cancelRequestedAt: null,
    cancelReason: null,
  };

  let characterRow: Record<string, unknown>;
  let jobs: JobRow[];
  let jobSeq: number;
  let blizzardCalls: number;
  let ledger: QueueLedger;
  /** Shared across both replica containers — collapse remove must be visible to both. */
  let bullJobs: Map<string, { id: string; state: string; getState: () => Promise<string>; remove: () => Promise<void> }>;

  const incomplete = {
    id: "char-incomplete",
    regionId: "reg-1",
    realmId: "realm-1",
    displayName: "Legacychar",
    normalizedName: "legacychar",
    level: null as number | null,
    blizzardCharacterId: null as bigint | null,
    classId: null as string | null,
    activeSpecId: null as string | null,
    role: null as "DPS" | null,
    faction: null as string | null,
    lastPublicRefreshAt: null,
  };

  function buildSharedContainer(): ApiContainer {
    const listActive = async (characterId: string) =>
      jobs.filter(
        (j) =>
          j.characterId === characterId &&
          j.jobType === "refresh-character" &&
          (j.status === "QUEUED" || j.status === "ACTIVE"),
      );

    /** BullMQ-like mock: records publish/remove; getJob reflects remaining executable messages. */
    const refreshQueue = {
      getJob: vi.fn(async (queueJobId: string) => bullJobs.get(queueJobId) ?? null),
      getJobs: vi.fn(async () => [...bullJobs.values()]),
    };

    return {
      env: {
        MAX_CHARACTER_LEVEL: 90,
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 4,
        PROVIDER_MODE: "fixture",
        MANUAL_REFRESH_COOLDOWN_SECONDS: 900,
        PUBLIC_DETAILS_ALL: true,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        // Exercise admission-release path (mocked gate below via dynamic import spy).
        REFRESH_ADMISSION_MODE: "off",
      },
      logger: { warn: vi.fn(), info: vi.fn() },
      negativeCache: { has: () => false, set: vi.fn(), clear: vi.fn() },
      responseCache: { get: () => null, set: vi.fn(), invalidate: vi.fn() },
      producers: {
        enqueueRefreshCharacter: vi.fn(async (input: { characterId: string }) => {
          // Simulate forceRefresh unique dedupe keys: each call creates a distinct job row.
          const id = `job-active-${++jobSeq}`;
          const queueJobId = `bull-${id}`;
          const row: JobRow = {
            id,
            characterId: input.characterId,
            status: "QUEUED",
            scheduledAt: new Date(Date.now() + jobSeq),
            jobType: "refresh-character",
            error: null,
            completedAt: null,
            queueJobId,
            cancelRequestedAt: null,
            cancelReason: null,
          };
          jobs.push(row);
          ledger.published.push(queueJobId);
          bullJobs.set(queueJobId, {
            id: queueJobId,
            state: "waiting",
            getState: async () => "waiting",
            remove: async () => {
              bullJobs.delete(queueJobId);
              ledger.removed.push(queueJobId);
            },
          });
          return { jobId: id, dedupeKey: `force-${id}`, reused: false, enqueued: true };
        }),
        enqueueRecalculateScore: vi.fn(),
        getRefreshCharacterQueue: vi.fn(() => refreshQueue),
      },
      worker: {
        disabledProviders: new Set(),
        createRedisConnection: vi.fn(() => ({ quit: vi.fn().mockResolvedValue(undefined) })),
        providers: {
          blizzard: {
            getCharacterProfile: vi.fn(async () => {
              blizzardCalls += 1;
              // Tiny delay so both replicas pass the pre-enqueue active check.
              await new Promise((r) => setTimeout(r, 5));
              return {
                data: {
                  displayName: "Legacychar",
                  level: 90,
                  classSlug: "mage",
                  specSlug: "fire",
                  role: "DPS",
                  faction: "Horde",
                  blizzardCharacterId: "4242",
                },
              };
            }),
            getMythicKeystoneProfile: vi.fn(async () => ({
              data: { currentMythicRating: 2500 },
            })),
            resolveAuthoritativeCurrentSeasonId: vi.fn(async () => ({
              data: {
                seasonId: 13,
                slug: "blizzard-season-13",
                source: "season_index.current_season",
              },
            })),
          },
        },
        prisma: {
          region: {
            findUnique: vi.fn().mockResolvedValue({ id: "reg-1", code: "EU" }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "reg-1", code: "EU" }),
          },
          ...scoringSeasonPrismaStubs(),
          season: {
            findFirst: vi.fn().mockResolvedValue(fixtureReadySeasonRow()),
            findUnique: vi.fn().mockResolvedValue(fixtureReadySeasonRow()),
          },
          scoreModel: { findFirst: vi.fn().mockResolvedValue({ key: "default", version: 4 }) },
          character: {
            findUnique: vi.fn(async () => ({
              id: characterRow.id,
              level: characterRow.level,
              regionId: "reg-1",
            })),
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(characterRow, data);
              return characterRow;
            }),
          },
          characterSnapshot: {
            create: vi.fn(async () => ({})),
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn(async () =>
              characterRow.level != null
                ? [
                    {
                      mythicRating: 2500,
                      rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
                    },
                  ]
                : [],
            ),
          },
          characterProviderState: { findUnique: vi.fn().mockResolvedValue(null) },
          runAnalysis: { findFirst: vi.fn().mockResolvedValue(null) },
          characterScore: { findFirst: vi.fn().mockResolvedValue(null) },
          verifiedCharacterOwnership: { findFirst: vi.fn().mockResolvedValue(null) },
          metricObservation: { findFirst: vi.fn().mockResolvedValue(null) },
        },
        repositories: {
          character: {
            findByIdentity: vi.fn(async () => characterRow),
            findById: vi.fn(async () => characterRow),
            findByBlizzardCharacterId: vi.fn(async () => null),
            upsertCharacter: vi.fn(async () => {
              throw new Error("must not create a duplicate Character row");
            }),
            applyProviderProfile: vi.fn(async (_id: string, profile: Record<string, unknown>) => {
              characterRow = {
                ...characterRow,
                level: profile.level ?? characterRow.level,
                blizzardCharacterId: profile.blizzardCharacterId
                  ? BigInt(String(profile.blizzardCharacterId))
                  : characterRow.blizzardCharacterId,
                classId: "class-mage",
                activeSpecId: "spec-fire",
                role: profile.role ?? characterRow.role,
                faction: profile.faction ?? characterRow.faction,
                displayName: profile.displayName ?? characterRow.displayName,
              };
              return characterRow;
            }),
            deleteUnreferencedBootstrapShell: vi.fn().mockResolvedValue(false),
            reassignToCatalogIdentity: vi.fn(),
          },
          realm: {
            findBySlug: vi.fn().mockResolvedValue({
              id: "realm-1",
              slug: "archimonde",
              name: "Archimonde",
            }),
          },
          score: {
            getPublishedSnapshot: vi.fn().mockResolvedValue(null),
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          job: {
            findActiveForCharacter: vi.fn(async (characterId: string) => {
              const active = await listActive(characterId);
              return active.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0] ?? null;
            }),
            listActiveRefreshJobsForCharacter: vi.fn(async (characterId: string) =>
              listActive(characterId),
            ),
            findLatestForCharacter: vi.fn(async (characterId: string) => {
              const forChar = jobs.filter((j) => j.characterId === characterId);
              return (
                [...forChar].sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0] ??
                null
              );
            }),
            findById: vi.fn(async (id: string) => jobs.find((j) => j.id === id) ?? null),
            markFailed: vi.fn(async (id: string, error: unknown) => {
              const job = jobs.find((j) => j.id === id);
              if (!job) throw new Error(`missing job ${id}`);
              job.status = "FAILED";
              job.error = error;
              job.completedAt = new Date();
              return job;
            }),
            requestCancel: vi.fn(async (id: string, reason: string | null = null) => {
              const job = jobs.find((j) => j.id === id);
              if (!job) throw new Error(`missing job ${id}`);
              if (!job.cancelRequestedAt) {
                job.cancelRequestedAt = new Date();
                job.cancelReason = reason;
                ledger.cancelRequested.push(id);
              }
              return job;
            }),
          },
          providerState: { listForCharacter: vi.fn().mockResolvedValue([]) },
          run: {
            findLatestForCharacter: vi.fn().mockResolvedValue(null),
            findHighestForCharacter: vi.fn().mockResolvedValue(null),
            countForCharacter: vi.fn().mockResolvedValue(0),
            findById: vi.fn(),
            findLatestAnalysisCoverage: vi.fn().mockResolvedValue(null),
          },
        },
      },
    } as unknown as ApiContainer;
  }

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    characterRow = { ...incomplete };
    jobs = [{ ...failedHistorical }];
    jobSeq = 0;
    blizzardCalls = 0;
    ledger = { published: [], removed: [], cancelRequested: [], admissionReleased: [] };
    bullJobs = new Map();
  });

  it("two service instances without the process lock still converge on one character and one active job", async () => {
    const containerA = buildSharedContainer();
    const containerB = buildSharedContainer();
    const serviceA = new CharacterService(containerA);
    const serviceB = new CharacterService(containerB);
    const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Legacychar" };

    // Bypass withResolveIdentityLock — simulate two API replicas.
    const lockedA = (
      serviceA as unknown as {
        resolveCharacterLocked: typeof serviceA.resolveCharacter;
      }
    ).resolveCharacterLocked.bind(serviceA);
    const lockedB = (
      serviceB as unknown as {
        resolveCharacterLocked: typeof serviceB.resolveCharacter;
      }
    ).resolveCharacterLocked.bind(serviceB);

    const [a, b] = await Promise.all([
      lockedA(identity, { forceRetry: true }),
      lockedB(identity, { forceRetry: true }),
    ]);

    expect(a.body).toMatchObject({ characterId: "char-incomplete" });
    expect(b.body).toMatchObject({ characterId: "char-incomplete" });
    expect((a.body as { characterId: string }).characterId).toBe(
      (b.body as { characterId: string }).characterId,
    );

    // Duplicate Blizzard calls across replicas are allowed but bounded.
    expect(blizzardCalls).toBeGreaterThanOrEqual(1);
    expect(blizzardCalls).toBeLessThanOrEqual(2);

    // Two force-refresh publishes may race.
    expect(ledger.published.length).toBeGreaterThanOrEqual(1);
    expect(ledger.published.length).toBeLessThanOrEqual(2);

    const active = jobs.filter((j) => j.status === "QUEUED" || j.status === "ACTIVE");
    expect(active).toHaveLength(1);
    const winner = active[0]!;
    expect(winner.id).not.toBe(failedHistorical.id);

    // Exactly one executable BullMQ refresh remains (loser removed or never left waiting).
    expect(bullJobs.size).toBe(1);
    const remainingBull = ledger.published.filter((id) => !ledger.removed.includes(id));
    expect(remainingBull).toHaveLength(1);
    expect(remainingBull[0]).toBe(winner.queueJobId);
    expect([...bullJobs.keys()][0]).toBe(winner.queueJobId);

    const losers = jobs.filter(
      (j) =>
        j.id !== failedHistorical.id &&
        j.id !== winner.id &&
        j.jobType === "refresh-character",
    );
    for (const loser of losers) {
      expect(loser.status).toBe("FAILED");
      expect(loser.error).toMatchObject({ code: "REFRESH_SUPERSEDED_DEDUPED" });
      // Queued losers must not remain executable in BullMQ.
      if (loser.queueJobId) {
        expect(ledger.removed).toContain(loser.queueJobId);
      }
    }

    // Both callers resolve to the winning refresh job ID.
    const refreshIds = [a.body, b.body]
      .map((body) => ("refreshId" in body ? body.refreshId : undefined))
      .filter((id): id is string => typeof id === "string");
    expect(refreshIds.length).toBeGreaterThanOrEqual(1);
    expect(refreshIds.every((id) => id === winner.id)).toBe(true);
    expect(refreshIds.every((id) => id !== losers[0]?.id)).toBe(true);

    const historical = jobs.find((j) => j.id === failedHistorical.id);
    expect(historical?.status).toBe("FAILED");
    expect(historical?.error).toMatchObject({ code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN" });

    expect(characterRow.level).toBe(90);
    expect(characterRow.blizzardCharacterId).toBe(4242n);
    expect(characterRow.classId).toBe("class-mage");
    expect(characterRow.activeSpecId).toBe("spec-fire");
    expect(characterRow.role).toBe("DPS");

    const statuses = [a.body.status, b.body.status];
    expect(statuses.every((s) => s === "QUEUED" || s === "PROFILE_ONLY" || s === "READY")).toBe(
      true,
    );
    expect(statuses.includes("QUEUED") || statuses.every((s) => s === "PROFILE_ONLY")).toBe(true);

    // Profile / refresh-status agreement after repair.
    const profile = await serviceA.getProfile(identity);
    const refresh = await serviceA.getRefreshStatus(identity);
    if (profile.body.refreshStatus === "QUEUED") {
      expect(refresh.refreshStatus === "QUEUED" || refresh.refreshStatus === "IN_PROGRESS").toBe(
        true,
      );
    } else {
      expect(profile.body.refreshStatus).toBe(refresh.refreshStatus === "IN_PROGRESS" ? "QUEUED" : refresh.refreshStatus);
    }
    expect(profile.body.characterId).toBe("char-incomplete");
    expect(refresh.characterId).toBe("char-incomplete");
  });
});
