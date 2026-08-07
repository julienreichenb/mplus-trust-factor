import { describe, expect, it, vi, beforeEach } from "vitest";
import { clearSeasonAuthorityCacheForTests } from "@mplus/worker";
import { CharacterService } from "./character-service.js";
import type { ApiContainer } from "../container.js";

/**
 * Myzouth regression: incomplete persisted shell + FAILED eligibility job must not
 * present coarse profile refreshStatus as QUEUED while /refresh-status is FAILED.
 */
describe("CharacterService profile/status — incomplete bootstrap consistency", () => {
  const myzouthId = "4e2e51ee-9e77-44a0-ba82-4d24a68b4486";
  const identity = { region: "EU" as const, realmSlug: "burning-legion", name: "Myzouth" };
  const verifiedAt = new Date().toISOString();

  const myzouthShell = {
    id: myzouthId,
    regionId: "reg-eu",
    realmId: "realm-bl",
    displayName: "Myzouth",
    normalizedName: "myzouth",
    level: null as number | null,
    blizzardCharacterId: null as bigint | null,
    classId: null as string | null,
    activeSpecId: null as string | null,
    role: null as "DPS" | null,
    faction: null as string | null,
    lastPublicRefreshAt: null,
    lastSeenAt: null,
    raiderioProfileUrl: null,
  };

  const failedJob = {
    id: "job-myzouth-failed",
    characterId: myzouthId,
    status: "FAILED",
    completedAt: new Date("2026-08-01T10:00:00.000Z"),
    error: {
      code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
      message: "Character level is missing — refusing refresh (fail closed)",
    },
    payload: {
      refreshContractHash: "hash-1",
      authoritativeSeasonId: 15,
    },
    scheduledAt: new Date("2026-08-01T09:00:00.000Z"),
    startedAt: new Date("2026-08-01T09:01:00.000Z"),
    queueJobId: "q-1",
    jobType: "refresh-character",
    priority: 0,
    cancelRequestedAt: null,
  };

  const mockFindByIdentity = vi.fn();
  const mockFindBySlug = vi.fn();
  const mockGetPublishedSnapshot = vi.fn();
  const mockFindActiveJob = vi.fn();
  const mockFindLatestJob = vi.fn();
  const mockFindByIdJob = vi.fn();
  const mockCharacterFindUnique = vi.fn();
  const mockSnapshotFindMany = vi.fn();
  const mockListProviderState = vi.fn();

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    vi.clearAllMocks();
    mockFindByIdentity.mockResolvedValue(myzouthShell);
    mockGetPublishedSnapshot.mockResolvedValue(null);
    mockFindActiveJob.mockResolvedValue(null);
    mockFindLatestJob.mockResolvedValue(failedJob);
    mockFindByIdJob.mockResolvedValue(failedJob);
    mockListProviderState.mockResolvedValue([]);
    mockCharacterFindUnique.mockResolvedValue({
      id: myzouthId,
      level: null,
      regionId: "reg-eu",
      gameClass: null,
      activeSpec: null,
      realm: { slug: "burning-legion", name: "Burning Legion" },
    });
    mockSnapshotFindMany.mockResolvedValue([]);
    mockFindBySlug.mockResolvedValue({
      id: "realm-bl",
      slug: "burning-legion",
      name: "Burning Legion",
      regionId: "reg-eu",
      active: true,
    });
  });

  function buildContainer(): ApiContainer {
    return {
      env: {
        MAX_CHARACTER_LEVEL: 90,
        ACTIVE_SCORE_MODEL_KEY: "default",
        ACTIVE_SCORE_MODEL_VERSION: 6,
        PROVIDER_MODE: "fixture",
        MANUAL_REFRESH_COOLDOWN_SECONDS: 0,
        PUBLIC_DETAILS_ALL: true,
        SCORE_TTL_SECONDS: 604_800,
        REFRESH_FAILURE_BACKOFF_SECONDS: 3_600,
        BLIZZARD_CHARACTER_TTL_SECONDS: 86_400,
      },
      logger: { warn: vi.fn(), info: vi.fn() },
      negativeCache: { has: () => false, set: vi.fn(), clear: vi.fn() },
      responseCache: { get: () => null, set: vi.fn(), invalidate: vi.fn() },
      producers: {
        enqueueRefreshCharacter: vi.fn(),
        enqueueRecalculateScore: vi.fn(),
      },
      worker: {
        disabledProviders: new Set(),
        providers: {
          blizzard: {
            getCharacterProfile: vi.fn(),
            getMythicKeystoneProfile: vi.fn(),
            resolveAuthoritativeCurrentSeasonId: vi.fn(async () => ({
              data: {
                seasonId: 15,
                slug: "blizzard-season-15",
                source: "season_index.current_season",
              },
            })),
          },
        },
        prisma: {
          region: {
            findUnique: vi.fn().mockResolvedValue({ id: "reg-eu", code: "EU" }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "reg-eu", code: "EU" }),
          },
          season: {
            findFirst: vi.fn().mockResolvedValue({
              id: "season-1",
              slug: "blizzard-season-15",
              regionId: "reg-eu",
              blizzardSeasonId: 15,
              isCurrent: true,
              metadata: {
                blizzardSeasonId: 15,
                source: "blizzard",
                authoritySource: "season_index.current_season",
                authorityVerifiedAt: verifiedAt,
              },
            }),
          },
          scoreModel: { findFirst: vi.fn().mockResolvedValue({ key: "default", version: 6 }) },
          character: { findUnique: mockCharacterFindUnique },
          characterSnapshot: {
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
            findById: vi.fn().mockResolvedValue(myzouthShell),
            upsertCharacter: vi.fn(),
            applyProviderProfile: vi.fn(),
            deleteUnreferencedBootstrapShell: vi.fn().mockResolvedValue(false),
          },
          realm: { findBySlug: mockFindBySlug },
          score: {
            getPublishedSnapshot: mockGetPublishedSnapshot,
            getActiveModel: vi.fn().mockResolvedValue({ key: "default", version: 6 }),
          },
          job: {
            findActiveForCharacter: mockFindActiveJob,
            findLatestForCharacter: mockFindLatestJob,
            findById: mockFindByIdJob,
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

  it("profile and refresh-status agree on FAILED + bootstrapRepairRequired for Myzouth shape", async () => {
    const service = new CharacterService(buildContainer());
    const profile = await service.getProfile(identity);
    const status = await service.getRefreshStatus(identity);

    expect(profile.body.refreshStatus).toBe("FAILED");
    expect(profile.body.refreshStatus).not.toBe("QUEUED");
    expect(profile.statusCode).toBe(200);
    expect(profile.body.bootstrapRepairRequired).toBe(true);
    expect(profile.body.warnings?.some((w) => w.code === "CHARACTER_BOOTSTRAP_INCOMPLETE")).toBe(
      true,
    );

    expect(status.refreshStatus).toBe("FAILED");
    expect(status.bootstrapRepairRequired).toBe(true);
    expect(status.job?.status).toBe("failed");
  });
});
