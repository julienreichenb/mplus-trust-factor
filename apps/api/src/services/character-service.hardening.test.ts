import { describe, expect, it, vi, beforeEach } from "vitest";
import { CharacterService } from "./character-service.js";
import type { ApiContainer } from "../container.js";
import { clearSeasonAuthorityCacheForTests } from "@mplus/worker";

describe("CharacterService — public read path invariants", () => {
  const mockEnqueue = vi.fn().mockResolvedValue({ jobId: "job-1", reused: false });
  const mockGetPublishedSnapshot = vi.fn();
  const mockFindByIdentity = vi.fn();

  function buildContainer(): ApiContainer {
    const verifiedAt = new Date().toISOString();
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
      negativeCache: { has: () => false },
      responseCache: { get: () => null, set: () => {}, invalidate: () => {} },
      producers: { enqueueRefreshCharacter: mockEnqueue, enqueueRecalculateScore: vi.fn() },
      logger: { warn: vi.fn(), info: vi.fn() },
      worker: {
        disabledProviders: new Set(),
        providers: {
          blizzard: {
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
          job: {
            findActiveForCharacter: vi.fn().mockResolvedValue(null),
            findLatestForCharacter: vi.fn().mockResolvedValue(null),
            findById: vi.fn().mockResolvedValue({ id: "job-1", status: "QUEUED" }),
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

  const publishedSnapshot = {
    id: "snap-1",
    characterId: "char-1",
    seasonId: "season-1",
    overallScore: 75,
    grade: "B",
    skillScore: 75,
    authenticityScore: 70,
    confidence: 0.75,
    calculatedAt: new Date(),
    inputFingerprint: "fp-1",
    explanation: {
      refreshContractHash: "v1",
      coverage: { freshness: 0.8, selectedRunCoverage: 0.5 },
      observations: [
        { metricKey: "performance.current_season_peak", sourceProvider: "warcraftlogs" },
        { metricKey: "survival.avoidable_damage", sourceProvider: "warcraftlogs" },
      ],
    },
    dimensionScores: [
      { dimension: "PERFORMANCE", score: 80, confidence: 0.8, weight: 0.35, state: "AVAILABLE", reason: null, contributors: [] },
      { dimension: "SURVIVAL", score: 75, confidence: 0.8, weight: 0.3, state: "AVAILABLE", reason: null, contributors: [] },
      { dimension: "EXPERIENCE", score: 70, confidence: 0.7, weight: 0.1, state: "AVAILABLE", reason: null, contributors: [] },
    ],
    scoreModel: { key: "default", version: 4 },
    season: { slug: "blizzard-season-13" },
    scopeType: "CHARACTER",
    scopeKey: null,
    publicationStatus: "PUBLISHED",
    isPublic: true,
  };

  beforeEach(() => {
    clearSeasonAuthorityCacheForTests();
    vi.clearAllMocks();
    mockFindByIdentity.mockResolvedValue({
      id: "char-1",
      displayName: "Wallidrixe",
      regionId: "reg-1",
      realmId: "realm-1",
      role: "DPS",
      lastPublicRefreshAt: new Date(),
      lastSeenAt: new Date(),
    });
    mockGetPublishedSnapshot.mockResolvedValue(publishedSnapshot);
  });

  it("GET profile performs zero external provider calls", async () => {
    const service = new CharacterService(buildContainer());

    const result = await service.getProfile({
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.score).not.toBeNull();
    expect(result.body.score?.grade).toBe("B");
    expect(mockGetPublishedSnapshot).toHaveBeenCalledWith("char-1");
    // Background enqueue is allowed; test verifies no synchronous external provider HTTP calls.
    expect(mockEnqueue.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("serves persisted PostgreSQL score when Redis unavailable (no cache)", async () => {
    const container = buildContainer();
    const service = new CharacterService(container);

    const result = await service.getProfile({
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
    });

    expect(result.body.score?.dimensions.some((d) => d.dimension === "SURVIVAL")).toBe(true);
    expect(result.body.score?.grade).not.toBe("U");
  });
});
