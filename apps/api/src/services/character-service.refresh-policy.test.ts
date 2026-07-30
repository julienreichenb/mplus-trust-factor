import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildRefreshContract } from "@mplus/worker";
import { CharacterService } from "./character-service.js";
import type { ApiContainer } from "../container.js";

describe("CharacterService — centralized 7-day refresh policy", () => {
  const mockEnqueue = vi.fn().mockResolvedValue({ jobId: "job-1", reused: false, enqueued: true });
  const mockRecalc = vi.fn().mockResolvedValue({ jobId: "recalc-1", reused: false, enqueued: true });
  const mockGetPublishedSnapshot = vi.fn();
  const mockFindByIdentity = vi.fn();
  const mockFindActive = vi.fn().mockResolvedValue(null);
  const mockFindLatest = vi.fn().mockResolvedValue(null);
  const mockFindById = vi.fn().mockResolvedValue({
    id: "job-1",
    status: "QUEUED",
    dedupeKey: "d",
    scheduledAt: new Date(),
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    error: null,
    jobType: "refresh-character",
  });
  const mockCacheGet = vi.fn().mockReturnValue(null);
  const mockCacheSet = vi.fn();
  const mockCacheInvalidate = vi.fn();

  const recentCalculatedAt = new Date();
  const staleCalculatedAt = new Date(Date.now() - 8 * 86_400_000);

  const matchingContract = buildRefreshContract({
    scoringModelKey: "default",
    scoringModelVersion: 4,
    activeSeasonId: "blizzard-season-13",
    env: process.env,
    allowFixtureZoneDefault: true,
  });

  function buildContainer(): ApiContainer {
    return {
      env: {
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 4,
        PROVIDER_MODE: "fixture",
        MANUAL_REFRESH_COOLDOWN_SECONDS: 900,
        PUBLIC_DETAILS_ALL: true,
      },
      logger: { warn: vi.fn(), info: vi.fn() },
      negativeCache: { has: () => false, clear: vi.fn() },
      responseCache: {
        get: mockCacheGet,
        set: mockCacheSet,
        invalidate: mockCacheInvalidate,
      },
      producers: {
        enqueueRefreshCharacter: mockEnqueue,
        enqueueRecalculateScore: mockRecalc,
      },
      worker: {
        disabledProviders: new Set(),
        prisma: {
          season: {
            findFirst: vi.fn().mockResolvedValue({
              id: "season-1",
              slug: "blizzard-season-13",
              isCurrent: true,
            }),
          },
          scoreModel: {
            findFirst: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          character: {
            findUnique: vi.fn().mockResolvedValue({
              id: "char-1",
              displayName: "Wallidrixe",
              gameClass: { slug: "mage", name: "Mage" },
              activeSpec: { slug: "fire", name: "Fire", role: "DPS" },
              realm: { slug: "archimonde", name: "Archimonde" },
            }),
          },
          characterSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
          characterProviderState: {
            findUnique: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
          },
          runAnalysis: { findFirst: vi.fn().mockResolvedValue(null) },
        },
        repositories: {
          character: {
            findByIdentity: mockFindByIdentity,
            upsertCharacter: vi.fn(),
          },
          score: {
            getPublishedSnapshot: mockGetPublishedSnapshot,
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          run: {
            findLatestForCharacter: vi.fn().mockResolvedValue(null),
            findHighestForCharacter: vi.fn().mockResolvedValue(null),
            countForCharacter: vi.fn().mockResolvedValue(0),
            findById: vi.fn(),
            findLatestAnalysisCoverage: vi.fn().mockResolvedValue(null),
          },
          job: {
            findActiveForCharacter: mockFindActive,
            findLatestForCharacter: mockFindLatest,
            findById: mockFindById,
          },
          providerState: { listForCharacter: vi.fn().mockResolvedValue([]) },
        },
      },
    } as unknown as ApiContainer;
  }

  function publishedSnapshot(
    calculatedAt: Date,
    overrides: { modelVersion?: number; contract?: typeof matchingContract } = {},
  ) {
    const modelVersion = overrides.modelVersion ?? 4;
    const contract = overrides.contract ?? { ...matchingContract, scoringModelVersion: modelVersion };
    return {
      id: "snap-1",
      characterId: "char-1",
      seasonId: "season-1",
      overallScore: 75,
      grade: "B",
      skillScore: 75,
      authenticityScore: 70,
      confidence: 0.75,
      calculatedAt,
      inputFingerprint: "fp-1",
      explanation: {
        refreshContract: contract,
        coverage: { freshness: 0.8, selectedRunCoverage: 0.5 },
        observations: [],
      },
      dimensionScores: [],
      scoreModel: { key: "default", version: modelVersion },
      season: { slug: "blizzard-season-13" },
      scopeType: "CHARACTER",
      scopeKey: null,
      publicationStatus: "PUBLISHED",
      isPublic: true,
    };
  }

  const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Wallidrixe" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockReturnValue(null);
    mockFindByIdentity.mockResolvedValue({
      id: "char-1",
      displayName: "Wallidrixe",
      regionId: "reg-1",
      realmId: "realm-1",
      role: "DPS",
      lastPublicRefreshAt: new Date(),
      lastSeenAt: new Date(),
    });
    mockFindActive.mockResolvedValue(null);
    mockFindLatest.mockResolvedValue({
      id: "job-old",
      status: "COMPLETED",
      completedAt: new Date(),
      scheduledAt: new Date(),
      startedAt: new Date(),
      dedupeKey: "d",
      jobType: "refresh-character",
      error: null,
    });
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(recentCalculatedAt));
  });

  it("ten fresh profile reads create zero jobs", async () => {
    const service = new CharacterService(buildContainer());
    for (let i = 0; i < 10; i++) {
      const result = await service.getProfile(identity);
      expect(result.statusCode).toBe(200);
      expect(result.body.refreshStatus).toBe("FRESH");
    }
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it("stale profile creates exactly one job", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(staleCalculatedAt));
    mockEnqueue.mockImplementation(async () => {
      mockFindActive.mockResolvedValue({
        id: "job-1",
        status: "QUEUED",
        completedAt: null,
        scheduledAt: new Date(),
        startedAt: null,
        dedupeKey: "d",
        jobType: "refresh-character",
        error: null,
      });
      return { jobId: "job-1", reused: false, enqueued: true };
    });
    const service = new CharacterService(buildContainer());
    const result = await service.getProfile(identity);
    expect(result.statusCode).toBe(200);
    expect(result.body.refreshStatus).toBe("REFRESHING");
    expect(result.body.score).not.toBeNull();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("concurrent stale reads reuse one logical job", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(staleCalculatedAt));
    mockFindActive.mockResolvedValue({
      id: "job-active",
      status: "QUEUED",
      completedAt: null,
    });
    const service = new CharacterService(buildContainer());
    const a = await service.getProfile(identity);
    const b = await service.getProfile(identity);
    expect(a.body.refreshStatus).toBe("REFRESHING");
    expect(b.body.refreshStatus).toBe("REFRESHING");
    expect(a.body.score).not.toBeNull();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("reading after job completion does not enqueue again before 7 days", async () => {
    mockFindLatest.mockResolvedValue({
      id: "job-done",
      status: "COMPLETED",
      completedAt: new Date(),
      scheduledAt: new Date(),
      startedAt: new Date(),
      dedupeKey: "d",
      jobType: "refresh-character",
      error: null,
    });
    const service = new CharacterService(buildContainer());
    await service.getProfile(identity);
    await service.searchCharacter(identity);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("failed refresh applies backoff without re-enqueue", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(staleCalculatedAt));
    mockFindLatest.mockResolvedValue({
      id: "job-fail",
      status: "FAILED",
      completedAt: new Date(),
      scheduledAt: new Date(),
      startedAt: new Date(),
      dedupeKey: "d",
      jobType: "refresh-character",
      error: { code: "REFRESH_FAILED", message: "boom" },
    });
    const service = new CharacterService(buildContainer());
    const result = await service.getProfile(identity);
    expect(result.body.refreshStatus).toBe("STALE");
    expect(result.body.score).not.toBeNull();
    expect(result.body.warnings?.some((w) => w.code === "REFRESH_FAILED")).toBe(true);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("search and profile use the same policy", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(staleCalculatedAt));
    mockEnqueue.mockImplementation(async () => {
      mockFindActive.mockResolvedValue({
        id: "job-1",
        status: "QUEUED",
        completedAt: null,
        scheduledAt: new Date(),
        startedAt: null,
        dedupeKey: "d",
        jobType: "refresh-character",
        error: null,
      });
      return { jobId: "job-1", reused: false, enqueued: true };
    });
    const service = new CharacterService(buildContainer());
    const profile = await service.getProfile(identity);
    mockEnqueue.mockClear();
    mockFindActive.mockResolvedValue({
      id: "job-1",
      status: "QUEUED",
      completedAt: null,
      scheduledAt: new Date(),
      startedAt: null,
      dedupeKey: "d",
      jobType: "refresh-character",
      error: null,
    });
    const search = await service.searchCharacter(identity);
    expect(profile.body.refreshStatus).toBe("REFRESHING");
    expect(search.refreshStatus).toBe("REFRESHING");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("stale score remains visible during refresh with REFRESHING status", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(staleCalculatedAt));
    mockFindActive.mockResolvedValue({
      id: "job-active",
      status: "ACTIVE",
      completedAt: null,
    });
    const service = new CharacterService(buildContainer());
    const result = await service.getProfile(identity);
    expect(result.body.score?.grade).toBe("B");
    expect(result.body.refreshStatus).toBe("REFRESHING");
    expect(result.body.refreshStatus).not.toBe("STALE");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("three sequential fresh GETs stay NONE with zero enqueue", async () => {
    const service = new CharacterService(buildContainer());
    for (let i = 0; i < 3; i++) {
      const result = await service.getProfile(identity);
      expect(result.body.refreshStatus).toBe("FRESH");
    }
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it("profile enqueue carries PROFILE_READ triggerSource and contract hash", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot(staleCalculatedAt));
    const service = new CharacterService(buildContainer());
    await service.getProfile(identity);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "PROFILE_READ",
        refreshContractHash: expect.any(String),
      }),
    );
  });

  it("manual force refresh carries MANUAL_FORCE_REFRESH triggerSource", async () => {
    const service = new CharacterService(buildContainer());
    await service.requestRefresh(identity, {
      bypassCooldown: true,
      forceRefresh: true,
      correlationId: "force-1",
    });
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "char-1",
        forceRefresh: true,
        correlationId: "force-1",
        triggerSource: "MANUAL_FORCE_REFRESH",
      }),
    );
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it("cache invalidation does not bypass policy for fresh scores", async () => {
    const service = new CharacterService(buildContainer());
    mockCacheGet.mockReturnValue(null);
    await service.getProfile(identity);
    mockCacheInvalidate("character:EU:archimonde:wallidrixe");
    mockCacheGet.mockReturnValue(null);
    await service.getProfile(identity);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("model-only mismatch chooses recalculate", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(
      publishedSnapshot(recentCalculatedAt, {
        modelVersion: 3,
        contract: { ...matchingContract, scoringModelVersion: 3 },
      }),
    );
    mockRecalc.mockImplementation(async () => {
      mockFindActive.mockResolvedValue({
        id: "recalc-1",
        status: "QUEUED",
        completedAt: null,
        scheduledAt: new Date(),
        startedAt: null,
        dedupeKey: "d",
        jobType: "recalculate-score",
        error: null,
      });
      return { jobId: "recalc-1", reused: false, enqueued: true };
    });
    const service = new CharacterService(buildContainer());
    const result = await service.getProfile(identity);
    expect(result.body.refreshStatus).toBe("REFRESHING");
    expect(mockRecalc).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("authorized forceRefresh uses the centralized enqueue path with forceRefresh=true", async () => {
    const service = new CharacterService(buildContainer());
    await service.requestRefresh(identity, {
      bypassCooldown: true,
      forceRefresh: true,
      correlationId: "force-1",
    });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "char-1",
        forceRefresh: true,
        correlationId: "force-1",
        triggerSource: "MANUAL_FORCE_REFRESH",
      }),
    );
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it("cooldown bypass without forceRefresh enqueues with forceRefresh=false", async () => {
    const service = new CharacterService(buildContainer());
    await service.requestRefresh(identity, {
      bypassCooldown: true,
      forceRefresh: false,
    });
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: false, triggerSource: "MANUAL_REFRESH" }),
    );
  });

  it("force refresh reuses an active job instead of creating a duplicate", async () => {
    mockFindActive.mockResolvedValue({
      id: "job-active",
      status: "QUEUED",
      completedAt: null,
      scheduledAt: new Date(),
      startedAt: null,
      dedupeKey: "d",
      jobType: "refresh-character",
      error: null,
    });
    const service = new CharacterService(buildContainer());
    const first = await service.requestRefresh(identity, {
      bypassCooldown: true,
      forceRefresh: true,
    });
    const second = await service.requestRefresh(identity, {
      bypassCooldown: true,
      forceRefresh: true,
    });
    expect(first.job?.jobId).toBe("job-active");
    expect(second.job?.jobId).toBe("job-active");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("model-only mismatch still recalculates after force-refresh helpers exist", async () => {
    mockGetPublishedSnapshot.mockResolvedValue(
      publishedSnapshot(recentCalculatedAt, {
        modelVersion: 3,
        contract: { ...matchingContract, scoringModelVersion: 3 },
      }),
    );
    const service = new CharacterService(buildContainer());
    await service.getProfile(identity);
    expect(mockRecalc).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
