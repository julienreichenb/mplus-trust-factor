/**
 * Calibration acquire/evaluate — isolation + cold/warm/DRAFT/ACTIVE/failure semantics.
 * Mocks authoritative scoring so tests stay provider-free and deterministic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALIBRATION_EVIDENCE_SOURCE_CANONICAL,
  type EvidenceCandidateMetadataV2,
  type ScoreSnapshotDTO,
} from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";

const runAuthoritativeScoring = vi.fn();
const buildCandidatesFromPersistedDigests = vi.fn();
const discoverCharacterRuns = vi.fn();

vi.mock("./refresh-bridge.js", () => ({
  runAuthoritativeScoring: (...args: unknown[]) => runAuthoritativeScoring(...args),
}));

vi.mock("../build-refresh-contract.js", () => ({
  resolveActiveRefreshContract: () => ({
    contract: {
      scoringModelKey: "cal-model",
      scoringModelVersion: 1,
      activeSeasonId: "test-season",
      zoneId: 47,
      partition: null,
    },
    hash: "hash",
    allowFixtureZoneDefault: true,
  }),
}));

vi.mock("./digest-candidates.js", async () => {
  const actual = await vi.importActual("./digest-candidates.js");
  return {
    ...(actual as Record<string, unknown>),
    buildCandidatesFromPersistedDigests: (...args: unknown[]) =>
      buildCandidatesFromPersistedDigests(...args),
  };
});

import {
  acquireAndEvaluateCalibrationMember,
  CalibrationAcquireEvaluateError,
} from "./calibration-acquire-evaluate.js";
import { runCalibrationRunJob } from "../calibration-run.js";

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_ID = "22222222-2222-4222-8222-222222222222";
const MODEL_ID = "33333333-3333-4333-8333-333333333333";

function digestCandidate(): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode: "ABC", fightId: 1 },
    reportRevision: 1,
    dungeonSlug: "ara-kara",
    keyLevel: 12,
    timed: true,
    runScore: 200,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "persisted-digest",
  };
}

function discoveryCandidate(): EvidenceCandidateMetadataV2 {
  return {
    ...digestCandidate(),
    discoveryIdentity: { reportCode: "COLD", fightId: 2 },
    discoverySource: "wcl-discovery",
  };
}

function scoreResult(overrides?: { characterScoreId?: string | null }) {
  const orchestration = {
    incomplete: false,
    selectedSlotCount: 8,
    expectedSlotCount: 16,
    characterDigests: [],
    cacheMisses: [],
    fightFailures: [],
    targetDigestFailures: [],
    dimensions: {
      performance: { score: 70, confidence: 0.8 },
      utility: { score: 74, confidence: 0.8 },
      survival: { score: 72, confidence: 0.8 },
      blocked: [] as Array<{ dimension: string; reason: string }>,
      performanceDigestDiagnostics: [],
      utilityDigestDiagnostics: [],
      survivalDigestDiagnostics: [],
    },
    accounting: {
      providerCalls: 2,
      packagesCreated: 1,
      packagesReused: 0,
      digestsCreated: 5,
      digestsReused: 0,
      fights: [],
    },
  };
  return {
    disabled: false,
    snapshot: {
      characterId: CHARACTER_ID,
      seasonSlug: "test-season",
      modelKey: "cal-model",
      modelVersion: 1,
      overallScore: 72,
      grade: "B",
      confidence: 0.8,
      dimensions: [],
    } as unknown as ScoreSnapshotDTO,
    scoreResult: {
      characterScoreId: overrides?.characterScoreId ?? null,
      providerCalls: 2,
      scoringVersion: "test",
      publicationEnabled: false,
      orchestration,
      experience: null,
      explainability: {
        schemaVersion: "score-explainability-v1",
        labelCatalogVersion: "score-explainability-labels-v1",
        materialityPolicyVersion: "score-explainability-materiality-v1",
        fingerprint: "test-fp",
        dimensions: {
          PERFORMANCE: {
            dimension: "PERFORMANCE",
            score: null,
            availability: "UNAVAILABLE",
            scoreStory: { drivers: [] },
            confidenceStory: {
              value: null,
              band: null,
              reasons: [],
              components: [],
            },
          },
          SURVIVAL: {
            dimension: "SURVIVAL",
            score: null,
            availability: "UNAVAILABLE",
            scoreStory: { drivers: [] },
            confidenceStory: {
              value: null,
              band: null,
              reasons: [],
              components: [],
            },
          },
          UTILITY: {
            dimension: "UTILITY",
            score: null,
            availability: "UNAVAILABLE",
            scoreStory: { drivers: [] },
            confidenceStory: {
              value: null,
              band: null,
              reasons: [],
              components: [],
            },
          },
          EXPERIENCE: {
            dimension: "EXPERIENCE",
            score: null,
            availability: "UNAVAILABLE",
            scoreStory: { drivers: [] },
            confidenceStory: {
              value: null,
              band: null,
              reasons: [],
              components: [],
            },
          },
        },
        composite: {
          score: null,
          confidence: 0,
          grade: "U",
          availableDimensions: [],
          unavailableDimensions: [
            "performance",
            "survival",
            "utility",
            "experience",
          ],
          effectiveWeights: {},
          availabilityCoverage: 0,
        },
      },
      performanceAggregate: {
        state: "UNAVAILABLE" as const,
        data: null,
        reason: null,
        cache: "MISS" as const,
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      },
    },
    providerCalls: 2,
  };
}

function baseContainer(overrides?: {
  allowLive?: boolean;
  characterScoreUpsert?: ReturnType<typeof vi.fn>;
}): WorkerContainer {
  const characterScoreUpsert = overrides?.characterScoreUpsert ?? vi.fn();
  return {
    env: {
      ALLOW_LIVE_PROVIDER_CALLS: overrides?.allowLive ?? false,
      PROVIDER_MODE: overrides?.allowLive ? "live" : "fixture",
      WCL_ENABLED: overrides?.allowLive ?? false,
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: true,
      WCL_CHARACTER_TTL_SECONDS: 43_200,
    },
    prisma: {
      character: {
        findUnique: async () => ({
          id: CHARACTER_ID,
          displayName: "Zam",
          role: "DPS",
          region: { code: "EU" },
          realm: { slug: "archimonde" },
          gameClass: { slug: "mage" },
          activeSpec: { slug: "fire", role: "DPS" },
        }),
      },
      season: {
        findUnique: async () => ({ id: SEASON_ID, slug: "test-season" }),
      },
      scoreModel: {
        findUnique: async () => ({
          id: MODEL_ID,
          key: "cal-model",
          version: 1,
          status: "DRAFT",
        }),
      },
      seasonDungeon: {
        findMany: async () => [
          { dungeon: { slug: "ara-kara" }, sortOrder: 0 },
          { dungeon: { slug: "city-of-threads" }, sortOrder: 1 },
        ],
      },
      characterScore: {
        upsert: characterScoreUpsert,
        findUnique: async () => null,
      },
      characterRunDigest: {
        findMany: async () => [],
      },
    },
    providers: {
      warcraftlogs: {
        discoverCharacterRuns,
      },
    },
    disabledProviders: new Set(),
    repositories: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    createRedisConnection: () => ({}) as never,
  } as unknown as WorkerContainer;
}

describe("acquireAndEvaluateCalibrationMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildCandidatesFromPersistedDigests.mockResolvedValue([]);
    discoverCharacterRuns.mockResolvedValue({ data: [] });
  });

  it("cold path: discovers WCL candidates and evaluates without CharacterScore", async () => {
    buildCandidatesFromPersistedDigests.mockResolvedValue([]);
    discoverCharacterRuns.mockResolvedValue({
      data: [
        {
          id: "r1",
          dungeonSlug: "ara-kara",
          keyLevel: 12,
          timed: true,
          scoreValue: 200,
          completedAt: "2026-01-01T00:00:00.000Z",
          durationMs: 1_800_000,
          sources: [{ provider: "WARCRAFT_LOGS", reportCode: "COLD", fightId: 2, revision: 1 }],
        },
      ],
    });
    const characterScoreUpsert = vi.fn();
    runAuthoritativeScoring.mockImplementation(async (input: { persistCharacterScore?: boolean }) => {
      expect(input.persistCharacterScore).toBe(false);
      return scoreResult({ characterScoreId: null });
    });

    const result = await acquireAndEvaluateCalibrationMember(baseContainer({ allowLive: true, characterScoreUpsert }), {
      characterId: CHARACTER_ID,
      seasonId: SEASON_ID,
      scoreModelId: MODEL_ID,
      scoreModelKey: "cal-model",
      scoreModelVersion: 1,
      scoreModelConfig: { key: "cal-model", version: 1 } as never,
    });

    expect(discoverCharacterRuns).toHaveBeenCalled();
    expect(result.characterScoreId).toBeNull();
    expect(result.snapshot.grade).toBe("B");
    expect(characterScoreUpsert).not.toHaveBeenCalled();
    expect(result.discoveredCandidateCount).toBeGreaterThan(0);
  });

  it("warm path: reuses digest candidates without requiring discovery data", async () => {
    buildCandidatesFromPersistedDigests.mockResolvedValue([digestCandidate()]);
    runAuthoritativeScoring.mockResolvedValue(scoreResult());
    const container = baseContainer({ allowLive: false });

    const result = await acquireAndEvaluateCalibrationMember(container, {
      characterId: CHARACTER_ID,
      seasonId: SEASON_ID,
      scoreModelId: MODEL_ID,
      scoreModelKey: "cal-model",
      scoreModelVersion: 1,
    });

    expect(discoverCharacterRuns).not.toHaveBeenCalled();
    expect(result.digestCandidateCount).toBe(1);
    expect(result.characterScoreId).toBeNull();
    expect(runAuthoritativeScoring).toHaveBeenCalledWith(
      expect.objectContaining({ persistCharacterScore: false }),
    );
  });

  it("DRAFT and ACTIVE both pass persistCharacterScore=false", async () => {
    buildCandidatesFromPersistedDigests.mockResolvedValue([digestCandidate()]);
    runAuthoritativeScoring.mockResolvedValue(scoreResult());
    const container = baseContainer();

    for (const status of ["DRAFT", "ACTIVE"] as const) {
      container.prisma.scoreModel.findUnique = async () =>
        ({
          id: MODEL_ID,
          key: "cal-model",
          version: status === "DRAFT" ? 2 : 1,
          status,
        }) as never;
      await acquireAndEvaluateCalibrationMember(container, {
        characterId: CHARACTER_ID,
        seasonId: SEASON_ID,
        scoreModelId: MODEL_ID,
        scoreModelKey: "cal-model",
        scoreModelVersion: status === "DRAFT" ? 2 : 1,
        scoreModelConfig: { draft: status === "DRAFT" } as never,
      });
    }
    expect(runAuthoritativeScoring).toHaveBeenCalledTimes(2);
    for (const call of runAuthoritativeScoring.mock.calls) {
      expect(call[0].persistCharacterScore).toBe(false);
    }
  });

  it("fails closed when scoring accidentally returns a CharacterScore id", async () => {
    buildCandidatesFromPersistedDigests.mockResolvedValue([digestCandidate()]);
    runAuthoritativeScoring.mockResolvedValue(scoreResult({ characterScoreId: "leak" }));
    await expect(
      acquireAndEvaluateCalibrationMember(baseContainer(), {
        characterId: CHARACTER_ID,
        seasonId: SEASON_ID,
        scoreModelId: MODEL_ID,
        scoreModelKey: "cal-model",
        scoreModelVersion: 1,
      }),
    ).rejects.toBeInstanceOf(CalibrationAcquireEvaluateError);
  });

  it("classifies empty candidates as MISSING_EVIDENCE", async () => {
    buildCandidatesFromPersistedDigests.mockResolvedValue([]);
    await expect(
      acquireAndEvaluateCalibrationMember(baseContainer({ allowLive: false }), {
        characterId: CHARACTER_ID,
        seasonId: SEASON_ID,
        scoreModelId: MODEL_ID,
        scoreModelKey: "cal-model",
        scoreModelVersion: 1,
      }),
    ).rejects.toMatchObject({ stage: "MISSING_EVIDENCE", code: "NO_SCORING_CANDIDATES" });
  });
});

describe("runCalibrationRunJob canonical acquire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildCandidatesFromPersistedDigests.mockResolvedValue([digestCandidate()]);
    runAuthoritativeScoring.mockResolvedValue(scoreResult());
  });

  it("continues after one member failure and never writes CharacterScore", async () => {
    const characterScoreUpsert = vi.fn();
    const members = [
      {
        id: "m1",
        region: "EU",
        realm: "archimonde",
        character: "Ok",
        role: "DPS",
        classSlug: "mage",
        specSlug: "fire",
        expectedLabel: "good",
        meta: false,
        source: "user-selected",
        suspectedBoost: false,
        rationale: null,
        snapshotIds: [],
        seasonSlug: "test-season",
      },
      {
        id: "m2",
        region: "EU",
        realm: "archimonde",
        character: "Fail",
        role: "DPS",
        classSlug: "mage",
        specSlug: "fire",
        expectedLabel: "average",
        meta: false,
        source: "user-selected",
        suspectedBoost: false,
        rationale: null,
        snapshotIds: [],
        seasonSlug: "test-season",
      },
    ];

    let acquireCalls = 0;
    runAuthoritativeScoring.mockImplementation(async () => {
      acquireCalls += 1;
      if (acquireCalls === 2) {
        throw new Error("WCL acquisition boom");
      }
      return scoreResult();
    });

    const reportUpsert = vi.fn(async () => ({}));
    const runUpdate = vi.fn(async () => ({}));
    const prisma = {
      calibrationRun: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "run-1",
            status: "QUEUED",
            cancelRequestedAt: null,
            mode: "DRAFT_MODEL_EVALUATE",
            seasonId: SEASON_ID,
            evaluationModelId: MODEL_ID,
            evaluationModelConfig: { key: "cal-model", version: 2, minConfidenceForGrade: 0.35 },
            activeModelConfig: {},
            algorithmVersions: { evidenceSource: CALIBRATION_EVIDENCE_SOURCE_CANONICAL },
            createdAt: new Date(),
            inputBundle: {
              manifest: {
                schemaVersion: "1.0.0",
                cohortId: "cohort-1",
                members,
              },
              evidenceByMemberId: {
                m1: { memberId: "m1", characterId: CHARACTER_ID },
                m2: { memberId: "m2", characterId: CHARACTER_ID },
              },
              evaluationModel: {
                key: "cal-model",
                version: 2,
                status: "DRAFT",
                isActive: false,
                config: { minConfidenceForGrade: 0.35, gradeThresholds: {} },
              },
              activeModel: {
                key: "cal-model",
                version: 1,
                status: "ACTIVE",
                isActive: true,
                config: { minConfidenceForGrade: 0.35, gradeThresholds: {} },
              },
            },
          })
          .mockResolvedValue({ cancelRequestedAt: null, status: "RUNNING" }),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: runUpdate,
      },
      calibrationReport: {
        upsert: reportUpsert,
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          calibrationReport: { upsert: reportUpsert },
          calibrationRun: { update: runUpdate },
        }),
      characterScore: { upsert: characterScoreUpsert },
    };

    const result = await runCalibrationRunJob(
      {
        prisma: prisma as never,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
        calibrationEnabled: true,
        container: baseContainer({ characterScoreUpsert }),
      },
      { calibrationRunId: "run-1", requestedAt: new Date().toISOString() },
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(characterScoreUpsert).not.toHaveBeenCalled();
    expect(reportUpsert).toHaveBeenCalled();
    const reportArg = reportUpsert.mock.calls[0]![0] as {
      create: { reportJson: { characters: Array<{ error: string | null }> }; evaluatedCount: number };
    };
    expect(reportArg.create.evaluatedCount).toBe(1);
    expect(reportArg.create.reportJson.characters.some((c) => c.error)).toBe(true);
    expect(reportArg.create.reportJson.characters.some((c) => !c.error)).toBe(true);
  });

  it("existing operational score stays untouched across calibration (byte-stable fields)", async () => {
    const existing = {
      id: "ops-score",
      characterId: CHARACTER_ID,
      seasonId: SEASON_ID,
      scoringVersion: "scoring-v1",
      performance: 88,
      utility: 77,
      survival: 66,
      composite: null,
      confidence: 0.9,
    };
    const opsAfter = { ...existing };
    buildCandidatesFromPersistedDigests.mockResolvedValue([digestCandidate()]);
    runAuthoritativeScoring.mockImplementation(async (input: { persistCharacterScore?: boolean }) => {
      expect(input.persistCharacterScore).toBe(false);
      return scoreResult({ characterScoreId: null });
    });

    const before = { ...opsAfter };
    await acquireAndEvaluateCalibrationMember(baseContainer(), {
      characterId: CHARACTER_ID,
      seasonId: SEASON_ID,
      scoreModelId: MODEL_ID,
      scoreModelKey: "cal-model",
      scoreModelVersion: 1,
    });
    expect(opsAfter).toEqual(before);
  });
});

describe("evidence reuse is not calibration-siloed", () => {
  it("warm calibration reads shared CharacterRunDigest candidates", async () => {
    const shared = [digestCandidate(), discoveryCandidate()];
    buildCandidatesFromPersistedDigests.mockResolvedValue(shared);
    runAuthoritativeScoring.mockImplementation(async (input: { candidates: EvidenceCandidateMetadataV2[] }) => {
      expect(input.candidates.some((c) => c.discoverySource === "persisted-digest")).toBe(true);
      return scoreResult();
    });
    await acquireAndEvaluateCalibrationMember(baseContainer(), {
      characterId: CHARACTER_ID,
      seasonId: SEASON_ID,
      scoreModelId: MODEL_ID,
      scoreModelKey: "cal-model",
      scoreModelVersion: 1,
    });
    expect(buildCandidatesFromPersistedDigests).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: CHARACTER_ID }),
    );
  });
});
