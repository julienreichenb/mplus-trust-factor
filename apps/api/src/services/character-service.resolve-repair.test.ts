import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import { clearSeasonAuthorityCacheForTests } from "@mplus/worker";
import { CharacterService } from "./character-service.js";
import type { ApiContainer } from "../container.js";
import { characterLacksBootstrapEvidence } from "./character-bootstrap-repair.js";

/**
 * Regression: previously persisted incomplete Character rows must be repaired
 * through exact resolve without weakening the provider-free worker gate.
 */
describe("CharacterService.resolveCharacter — existing incomplete repair", () => {
  const mockEnqueue = vi.fn().mockResolvedValue({ jobId: "job-repair-1", reused: false, enqueued: true });
  const mockFindByIdentity = vi.fn();
  const mockFindBySlug = vi.fn();
  const mockGetProfile = vi.fn();
  const mockGetKeystone = vi.fn();
  const mockApplyProviderProfile = vi.fn();
  const mockFindById = vi.fn();
  const mockFindByBlizzardCharacterId = vi.fn();
  const mockUpsert = vi.fn();
  const mockReassign = vi.fn();
  const mockGetPublishedSnapshot = vi.fn();
  const mockFindActiveJob = vi.fn();
  const mockFindLatestJob = vi.fn();
  const mockListProviderState = vi.fn();
  const mockCharacterUpdate = vi.fn();
  const mockSnapshotCreate = vi.fn();
  const mockCharacterFindUnique = vi.fn();
  const mockSnapshotFindMany = vi.fn();
  const negativeCacheClear = vi.fn();
  const negativeCacheSet = vi.fn();

  const verifiedAt = new Date().toISOString();

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
    displayName: "Legacychar",
  };

  function buildContainer(opts: {
    levelAfter?: number;
    mythicRating?: number | null;
  } = {}): ApiContainer {
    const levelAfter = opts.levelAfter ?? 90;
    const mythicRating = opts.mythicRating === undefined ? 2500 : opts.mythicRating;

    mockApplyProviderProfile.mockResolvedValue({ ...repairedFixture, level: levelAfter });
    mockFindById.mockResolvedValue({ ...repairedFixture, level: levelAfter });
    mockCharacterFindUnique.mockResolvedValue({
      id: "char-incomplete",
      level: levelAfter,
      regionId: "reg-1",
    });
    mockSnapshotFindMany.mockResolvedValue(
      mythicRating != null
        ? [
            {
              mythicRating,
              rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
            },
          ]
        : [],
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
      negativeCache: {
        has: () => false,
        set: negativeCacheSet,
        clear: negativeCacheClear,
      },
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
          season: {
            findFirst: vi.fn().mockResolvedValue({
              id: "season-1",
              slug: "blizzard-season-13",
              regionId: "reg-1",
              blizzardSeasonId: 13,
              isCurrent: true,
              metadata: {
                blizzardSeasonId: 13,
                source: "blizzard",
                authoritySource: "season_index.current_season",
                authorityVerifiedAt: verifiedAt,
              },
            }),
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
            reassignToCatalogIdentity: mockReassign,
            deleteUnreferencedBootstrapShell: vi.fn().mockResolvedValue(false),
          },
          realm: { findBySlug: mockFindBySlug },
          score: {
            getPublishedSnapshot: mockGetPublishedSnapshot,
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          job: {
            findActiveForCharacter: mockFindActiveJob,
            findLatestForCharacter: mockFindLatestJob,
            findById: vi.fn().mockResolvedValue({ id: "job-repair-1", status: "QUEUED" }),
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
    mockFindByIdentity.mockResolvedValue({ ...incompleteFixture });
    mockGetPublishedSnapshot.mockResolvedValue(null);
    mockFindActiveJob.mockResolvedValue(null);
    mockFindLatestJob.mockResolvedValue({
      status: "FAILED",
      error: { code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN", message: "Character level is missing" },
    });
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

  it("repairs existing level=null character through exact resolve and queues one refresh", async () => {
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });

    expect(result.statusCode).toBe(202);
    expect(result.body).toMatchObject({
      status: "QUEUED",
      characterId: "char-incomplete",
      refreshId: "job-repair-1",
    });
    expect(mockGetProfile).toHaveBeenCalledTimes(1);
    expect(mockGetKeystone).toHaveBeenCalledTimes(1);
    expect(mockApplyProviderProfile).toHaveBeenCalledWith(
      "char-incomplete",
      expect.objectContaining({
        level: 90,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "4242",
      }),
    );
    expect(mockCharacterUpdate).toHaveBeenCalled();
    expect(mockSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          characterId: "char-incomplete",
          mythicRating: 2500,
          rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
        }),
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("repairs existing activeSpecId+role=null shell through exact resolve and queues refresh", async () => {
    const roleNullShell = {
      ...incompleteFixture,
      level: 90,
      blizzardCharacterId: 4242n,
      classId: "class-paladin",
      activeSpecId: "spec-holy",
      role: null as "DPS" | null,
      faction: "Horde",
    };
    const repaired = {
      ...roleNullShell,
      role: "HEALER" as const,
    };
    expect(characterLacksBootstrapEvidence(roleNullShell)).toBe(true);
    expect(characterLacksBootstrapEvidence(repaired)).toBe(false);

    mockFindByIdentity.mockResolvedValue(roleNullShell);
    mockApplyProviderProfile.mockResolvedValue(repaired);
    mockFindById.mockResolvedValue(repaired);
    mockGetProfile.mockResolvedValue({
      data: {
        displayName: "Legacychar",
        level: 90,
        classSlug: "paladin",
        specSlug: "holy",
        // Blizzard profile summary often omits role / active_spec.type
        role: null,
        faction: "Horde",
        blizzardCharacterId: "4242",
      },
    });
    mockCharacterFindUnique.mockResolvedValue({
      id: "char-incomplete",
      level: 90,
      regionId: "reg-1",
    });

    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });

    expect(result.statusCode).toBe(202);
    expect(result.body).toMatchObject({
      status: "QUEUED",
      characterId: "char-incomplete",
      refreshId: "job-repair-1",
    });
    expect(mockApplyProviderProfile).toHaveBeenCalledWith(
      "char-incomplete",
      expect.objectContaining({
        classSlug: "paladin",
        specSlug: "holy",
        role: null,
        blizzardCharacterId: "4242",
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("is idempotent on repeated resolve for a repaired eligible character", async () => {
    const complete = { ...repairedFixture };
    mockFindByIdentity.mockResolvedValue(complete);
    mockFindLatestJob.mockResolvedValue(null);
    mockSnapshotFindMany.mockResolvedValue([
      {
        mythicRating: 2500,
        rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
      },
    ]);
    mockCharacterFindUnique.mockResolvedValue({
      id: "char-incomplete",
      level: 90,
      regionId: "reg-1",
    });

    const service = new CharacterService(buildContainer());
    const first = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    const second = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    // Complete bootstrap — no further Blizzard repair calls.
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
  });

  it("reuses one active job under concurrent resolves", async () => {
    mockFindActiveJob.mockResolvedValue({ id: "job-active", status: "QUEUED" });
    const service = new CharacterService(buildContainer());
    const [a, b] = await Promise.all([
      service.resolveCharacter({ region: "EU", realmSlug: "archimonde", name: "Legacychar" }),
      service.resolveCharacter({ region: "EU", realmSlug: "archimonde", name: "Legacychar" }),
    ]);
    expect(a.body).toMatchObject({ status: "QUEUED", refreshId: "job-active" });
    expect(b.body).toMatchObject({ status: "QUEUED", refreshId: "job-active" });
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("keeps valid below-level characters profile-only after repair", async () => {
    mockGetProfile.mockResolvedValue({
      data: {
        displayName: "Legacychar",
        level: 80,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "4242",
      },
    });
    const service = new CharacterService(buildContainer({ levelAfter: 80, mythicRating: 2500 }));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ status: "READY", characterId: "char-incomplete" });
    expect(mockApplyProviderProfile).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("keeps max-level characters with no current-season rating profile-only", async () => {
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 0 } });
    const service = new CharacterService(buildContainer({ mythicRating: 0 }));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ status: "READY", characterId: "char-incomplete" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not fabricate eligibility evidence on Blizzard NOT_FOUND", async () => {
    mockGetProfile.mockRejectedValue(
      new ExternalApiError({
        provider: "blizzard",
        code: "NOT_FOUND",
        message: "gone",
        retryable: false,
      }),
    );
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(404);
    expect(result.body.status).toBe("NOT_FOUND");
    expect(mockApplyProviderProfile).not.toHaveBeenCalled();
    expect(mockCharacterUpdate).not.toHaveBeenCalled();
    expect(mockSnapshotCreate).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(negativeCacheSet).toHaveBeenCalled();
  });

  it("returns retryable PROVIDER_UNAVAILABLE on temporary Blizzard failure", async () => {
    mockGetProfile.mockRejectedValue(
      new ExternalApiError({
        provider: "blizzard",
        code: "UPSTREAM_UNAVAILABLE",
        message: "timeout",
        retryable: true,
      }),
    );
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({ status: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockApplyProviderProfile).not.toHaveBeenCalled();
  });

  it("never calls Blizzard from ordinary GET profile to repair eligibility", async () => {
    mockFindByIdentity.mockResolvedValue({ ...incompleteFixture });
    const service = new CharacterService(buildContainer());
    await service.getProfile({ region: "EU", realmSlug: "archimonde", name: "Legacychar" });
    expect(mockGetProfile).not.toHaveBeenCalled();
    expect(mockGetKeystone).not.toHaveBeenCalled();
  });

  it("does not call Blizzard for existing successful complete characters", async () => {
    mockFindByIdentity.mockResolvedValue({ ...repairedFixture });
    mockGetPublishedSnapshot.mockResolvedValue({
      id: "snap-1",
      characterId: "char-incomplete",
      seasonId: "season-1",
      overallScore: 80,
      grade: "B",
      calculatedAt: new Date(),
      explanation: { refreshContractHash: "v1" },
      dimensionScores: [],
      scoreModel: { key: "default", version: 4 },
      season: { slug: "blizzard-season-13" },
      skillScore: 80,
      authenticityScore: 70,
      confidence: 0.8,
      inputFingerprint: "fp",
      scopeType: "CHARACTER",
      scopeKey: null,
      publicationStatus: "PUBLISHED",
      isPublic: true,
    });
    mockFindLatestJob.mockResolvedValue(null);
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ status: "READY", characterId: "char-incomplete" });
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it("fails safely on conflicting Blizzard character IDs", async () => {
    mockFindByIdentity.mockResolvedValue({
      ...incompleteFixture,
      blizzardCharacterId: 111n,
    });
    mockGetProfile.mockResolvedValue({
      data: {
        displayName: "Legacychar",
        level: 90,
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "222",
      },
    });
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({ status: "FAILED", retryable: false });
    expect(String((result.body as { message?: string }).message)).toContain("CHARACTER_IDENTITY_COLLISION");
    expect(mockApplyProviderProfile).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("reuses legacy row via Blizzard ID instead of creating a duplicate", async () => {
    mockFindByIdentity.mockResolvedValue(null);
    mockFindByBlizzardCharacterId.mockResolvedValue({
      ...incompleteFixture,
      realmId: "realm-legacy",
    });
    mockReassign.mockResolvedValue({ ...incompleteFixture, realmId: "realm-1" });
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Legacychar",
    });
    expect(result.statusCode).toBe(202);
    expect(result.body).toMatchObject({ characterId: "char-incomplete" });
    expect(mockReassign).toHaveBeenCalledWith(
      "char-incomplete",
      expect.objectContaining({ realmSlug: "archimonde", name: "Legacychar" }),
      expect.any(Object),
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("allows forceRetry after CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN", async () => {
    const service = new CharacterService(buildContainer());
    const result = await service.resolveCharacter(
      { region: "EU", realmSlug: "archimonde", name: "Legacychar" },
      { forceRetry: true },
    );
    expect(result.statusCode).toBe(202);
    expect(negativeCacheClear).toHaveBeenCalled();
    expect(mockGetProfile).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });
});
