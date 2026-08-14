import { describe, expect, it, vi, beforeEach } from "vitest";

const runAuthoritativeScoring = vi.fn();

vi.mock("./scoring/refresh-bridge.js", () => ({
  runAuthoritativeScoring: (...args: unknown[]) => runAuthoritativeScoring(...args),
}));

const DUNGEONS = [
  "ara-kara-city-of-echoes",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

describe("runRecalculateScore canonical selection + season pin", () => {
  beforeEach(() => {
    runAuthoritativeScoring.mockReset();
    runAuthoritativeScoring.mockResolvedValue({
      disabled: false,
      providerCalls: 0,
      scoreResult: { providerCalls: 0 },
      snapshot: {
        characterId: "char-1",
        seasonSlug: "midnight-season-1",
        modelKey: "default",
        modelVersion: 6,
        scopeType: "CHARACTER",
        scopeKey: null,
        overallScore: 75,
        grade: "B",
        skillScore: 75,
        authenticityScore: 100,
        confidence: 0.8,
        calculatedAt: new Date().toISOString(),
        inputFingerprint: "fp",
        dimensions: [],
        redFlags: [],
        explanation: {},
      },
    });
  });

  it("rebuilds canonical 8 runs from persisted MythicRuns and forces provider-free scoring on job.seasonId", async () => {
    const { runRecalculateScore } = await import("./recalculate-score.js");
    const season = {
      id: "season-a",
      slug: "midnight-season-1",
      dungeonCount: 8,
      metadata: {
        activeMplusCatalog: {
          schemaVersion: "active-mplus-catalog-v1",
          wclZoneId: 45,
          blizzardSeasonId: 13,
          expansionIdentity: "Fixture",
          dungeonPoolHash: "hash",
          sourceMetadataHash: "src",
          catalogVersion: "test",
          dungeonSlugs: DUNGEONS,
          synchronizedAt: "2026-01-01T00:00:00.000Z",
          validatedAt: "2026-01-01T00:00:00.000Z",
          lastKnownGood: true,
          authorityVersion: "active-mplus-season-authority-v1",
        },
      },
    };
    const model = { id: "model-1", key: "default", version: 6, config: {} };
    const persistedRuns = DUNGEONS.map((slug, i) => ({
      id: `run-${i}`,
      keyLevel: 18 + (i % 4),
      timed: true,
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
      durationMs: 1000,
      scoreValue: 200,
      dungeon: { slug },
      sources: [{ provider: "WARCRAFT_LOGS" }],
    }));

    const container = {
      env: {
        PROVIDER_MODE: "live",
        ALLOW_LIVE_PROVIDER_CALLS: true,
        WCL_ENABLED: true,
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: false,
      },
      logger: { info: vi.fn(), warn: vi.fn() },
      prisma: {
        character: {
          findUnique: vi.fn(async () => ({
            id: "char-1",
            gameClass: { slug: "mage" },
            activeSpec: { slug: "fire", role: "DPS" },
          })),
        },
        characterRunDigest: { findMany: vi.fn(async () => []) },
        season: { findUnique: vi.fn(async () => season) },
        region: { findUnique: vi.fn(async () => ({ code: "EU" })) },
        realm: { findUnique: vi.fn(async () => ({ slug: "archimonde" })) },
        seasonDungeon: {
          findMany: vi.fn(async () => DUNGEONS.map((slug) => ({ dungeon: { slug } }))),
        },
        runParticipant: { findMany: vi.fn(async () => []) },
        characterPerformanceAggregate: { findUnique: vi.fn(async () => null) },
      },
      repositories: {
        character: {
          findById: vi.fn(async () => ({
            id: "char-1",
            regionId: "reg-1",
            realmId: "realm-1",
            displayName: "Tester",
            role: "DPS",
          })),
        },
        score: {
          getModelByKeyVersion: vi.fn(async () => model),
          saveScoreSnapshot: vi.fn(),
        },
        run: {
          findRunsForCharacterInSeason: vi.fn(async (characterId: string, seasonId: string) => {
            expect(characterId).toBe("char-1");
            expect(seasonId).toBe("season-a");
            return persistedRuns;
          }),
        },
      },
    };

    await runRecalculateScore(container as never, {
      characterId: "char-1",
      seasonId: "season-a",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      requestedAt: new Date().toISOString(),
    });

    expect(runAuthoritativeScoring).toHaveBeenCalledTimes(1);
    const payload = runAuthoritativeScoring.mock.calls[0]?.[0] as {
      seasonId: string;
      forceProviderFree: boolean;
      canonicalRunSelection: { selectedRuns: Array<{ canonicalRunId: string; keyLevel: number }> };
    };
    expect(payload.seasonId).toBe("season-a");
    expect(payload.forceProviderFree).toBe(true);
    expect(payload.canonicalRunSelection.selectedRuns).toHaveLength(8);
    expect(payload.canonicalRunSelection.selectedRuns.map((r) => r.canonicalRunId).sort()).toEqual(
      persistedRuns.map((r) => r.id).sort(),
    );
  });
});
