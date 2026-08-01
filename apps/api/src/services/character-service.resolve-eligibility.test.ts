import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import { clearSeasonAuthorityCacheForTests } from "@mplus/worker";
import { CharacterService } from "./character-service.js";
import type { ApiContainer } from "../container.js";

describe("CharacterService.resolveCharacter — shared eligibility", () => {
  const mockEnqueue = vi.fn().mockResolvedValue({ jobId: "job-1", reused: false, enqueued: true });
  const mockUpsert = vi.fn();
  const mockFindByIdentity = vi.fn();
  const mockFindBySlug = vi.fn();
  const mockGetProfile = vi.fn();
  const mockGetKeystone = vi.fn();
  const mockApplyProviderProfile = vi.fn();
  const mockFindById = vi.fn();
  const mockFindByBlizzardCharacterId = vi.fn();

  const verifiedAt = new Date().toISOString();

  function buildContainer(level: number, mythicRating: number | null): ApiContainer {
    const shell = {
      id: "char-new",
      regionId: "reg-1",
      realmId: "realm-1",
      displayName: "Newchar",
      level: null as number | null,
      blizzardCharacterId: null as bigint | null,
      classId: null as string | null,
      activeSpecId: null as string | null,
      role: null as string | null,
    };
    mockUpsert.mockResolvedValue({ ...shell });
    mockApplyProviderProfile.mockImplementation(async () => ({
      ...shell,
      level,
      blizzardCharacterId: 99n,
      classId: "class-1",
      activeSpecId: "spec-1",
      role: "DPS",
    }));
    mockFindById.mockImplementation(async () => ({
      ...shell,
      level,
      blizzardCharacterId: 99n,
      classId: "class-1",
      activeSpecId: "spec-1",
      role: "DPS",
    }));
    mockFindByBlizzardCharacterId.mockResolvedValue(null);
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
            findUnique: vi.fn().mockImplementation(async () => ({
              id: "char-new",
              level,
              regionId: "reg-1",
            })),
            update: vi.fn().mockResolvedValue({}),
          },
          characterSnapshot: {
            create: vi.fn().mockResolvedValue({}),
            findMany: vi.fn().mockResolvedValue(
              mythicRating != null
                ? [
                    {
                      mythicRating,
                      rawSummary: { eligibility: { authoritativeSeasonId: "season-1" } },
                    },
                  ]
                : [],
            ),
          },
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
            reassignToCatalogIdentity: vi.fn(),
            deleteUnreferencedBootstrapShell: vi.fn().mockResolvedValue(false),
          },
          realm: { findBySlug: mockFindBySlug },
          score: {
            getPublishedSnapshot: vi.fn().mockResolvedValue(null),
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 4 }),
          },
          job: {
            findActiveForCharacter: vi.fn().mockResolvedValue(null),
            findLatestForCharacter: vi.fn().mockResolvedValue(null),
            findById: vi.fn(),
          },
          providerState: { listForCharacter: vi.fn().mockResolvedValue([]) },
        },
      },
    } as unknown as ApiContainer;
  }

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    vi.clearAllMocks();
    mockFindByIdentity.mockResolvedValue(null);
    mockFindBySlug.mockResolvedValue({ id: "realm-1", slug: "archimonde", name: "Archimonde" });
    mockGetProfile.mockResolvedValue({
      data: {
        level: 90,
        displayName: "Newchar",
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        faction: "Horde",
        blizzardCharacterId: "99",
      },
    });
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 2500 } });
  });

  it("enqueues refresh when max level and current-season rating > 0", async () => {
    mockGetProfile.mockResolvedValue({ data: { level: 90 } });
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 2500 } });
    const service = new CharacterService(buildContainer(90, 2500));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Newchar",
    });
    expect(result.statusCode).toBe(202);
    expect(result.body).toMatchObject({ status: "QUEUED", refreshId: "job-1" });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("returns profile-only READY without enqueue when below max level", async () => {
    mockGetProfile.mockResolvedValue({ data: { level: 80 } });
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 2500 } });
    const service = new CharacterService(buildContainer(80, 2500));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Newchar",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      status: "READY",
      characterId: "char-new",
      profilePath: "/character/EU/archimonde/Newchar",
    });
    expect(result.body).not.toHaveProperty("refreshId");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns profile-only READY without enqueue when mythic rating is 0", async () => {
    mockGetProfile.mockResolvedValue({ data: { level: 90 } });
    mockGetKeystone.mockResolvedValue({ data: { currentMythicRating: 0 } });
    const service = new CharacterService(buildContainer(90, 0));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Newchar",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ status: "READY" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects manual refresh while ineligible with shared code", async () => {
    mockFindByIdentity.mockResolvedValue({
      id: "char-new",
      regionId: "reg-1",
      realmId: "realm-1",
      displayName: "Newchar",
      level: 80,
      lastPublicRefreshAt: null,
    });
    const service = new CharacterService(buildContainer(80, null));
    await expect(
      service.requestRefresh(
        { region: "EU", realmSlug: "archimonde", name: "Newchar" },
        { bypassCooldown: false, forceRefresh: false },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CHARACTER_BELOW_MAX_LEVEL",
    });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("maps Blizzard NOT_FOUND without inventing fuzzy search", async () => {
    mockGetProfile.mockRejectedValue(
      new ExternalApiError({
        provider: "blizzard",
        code: "NOT_FOUND",
        message: "missing",
        retryable: false,
      }),
    );
    const service = new CharacterService(buildContainer(90, 2500));
    const result = await service.resolveCharacter({
      region: "EU",
      realmSlug: "archimonde",
      name: "Missing",
    });
    expect(result.statusCode).toBe(404);
    expect(result.body.status).toBe("NOT_FOUND");
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
