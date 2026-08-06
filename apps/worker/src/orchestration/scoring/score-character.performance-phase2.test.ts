/**
 * Product-boundary: scoreCharacter uses Performance Phase 2 with aggregate + digests.
 * Utility / Survival numerical paths remain unchanged; replay stays provider-free.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  type PersistedCharacterPerformanceAggregateV1,
} from "@mplus/contracts";
import {
  computePerformanceV2,
  PERFORMANCE_PHASE2_ALGORITHM_VERSION,
  PERFORMANCE_V2_ALGORITHM_VERSION,
} from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { scoreCharacter, SCORING_VERSION } from "./score-character.js";

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_ID = "00000000-0000-4000-8000-000000000012";

const DUNGEONS = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  reportRevision = 1,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision,
    dungeonSlug,
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
    discoverySource: "test",
  };
}

function fakePrisma(saved: Array<Record<string, unknown>> = []) {
  return {
    characterScore: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const row = { id: `score-${saved.length + 1}`, ...create };
        saved.push(row);
        return row;
      },
    },
  } as never;
}

function aggregateCompact(): PersistedCharacterPerformanceAggregateV1 {
  return {
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: "points_and_damage",
    zoneId: 47,
    partition: null,
    dungeonAggregates: DUNGEONS.map((slug) => ({
      dungeonSlug: slug,
      dungeonName: slug,
      encounterId: 1,
      bestParsePercentile: 80,
      medianParsePercentile: 70,
      loggedRunCount: 4,
      specialization: "Fire",
      keystoneLevel: 12,
      bestDps: 1_000_000,
    })),
    global: {
      totalMythicPlusScore: 3000,
      totalLoggedRuns: 40,
      bestDpsPercentileAverage: 80,
      medianDpsPercentileAverage: 70,
      partition: null,
      zoneId: 47,
    },
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: "points_and_damage",
      provenance: "AGGREGATE_ZONE_RANKINGS",
      availableDungeonCount: 8,
      expectedDungeonCount: 8,
      unavailableEncounters: [],
      wclBestPerformanceAverage: 80,
      wclMedianPerformanceAverage: 70,
      computedBestAverage: 80,
      computedMedianAverage: 70,
    },
  };
}

describe("scoreCharacter Performance Phase 2 product boundary", () => {
  it("persists Phase 2 Performance; warm/replay match; Utility/Survival unchanged; zero provider calls on replay", async () => {
    const candidates = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `P${i}A`, 1, 1),
      candidate(slug, `P${i}B`, 2, 1),
    ]);
    const ports = createMemoryOrchestrationPorts();
    const compact = aggregateCompact();
    const ensureAgg = async () =>
      ({
        state: "AVAILABLE" as const,
        data: {
          id: "agg-1",
          characterId: CHARACTER_ID,
          seasonId: SEASON_ID,
          zoneId: 47,
          partitionKey: "current",
          rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
          metric: "points_and_damage",
          state: "OK" as const,
          rawPayload: {},
          dungeonAggregates: compact.dungeonAggregates,
          globalSummary: compact.global,
          diagnostics: compact.diagnostics,
          contentHash: "agg-hash-1",
          sourceRequestFingerprint: "fp-1",
          fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: new Date("2026-01-02T00:00:00.000Z"),
          compact,
        },
        reason: null,
        cache: "HIT" as const,
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: "agg-1",
        contentHash: "agg-hash-1",
      });

    const saved: Array<Record<string, unknown>> = [];
    const identity = {
      characterId: CHARACTER_ID,
      region: "eu",
      realm: "test",
      characterName: "Target",
    };
    const baseFields = {
      identity,
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: DUNGEONS,
      candidates,
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      scoringModelId: "model-1",
      zoneId: 47,
      partition: null as number | null,
      ensurePerformanceAggregate: ensureAgg,
      ports,
      prisma: fakePrisma(saved),
      artifacts: {} as never,
      evidence: {} as never,
    };

    // Cold: memory ports may acquire (not live WCL).
    const cold = await scoreCharacter({
      ...baseFields,
      allowProviderCalls: true,
    });
    expect(cold.scoringVersion).toBe(SCORING_VERSION);
    expect(cold.scoringVersion).toContain("performance-phase2");
    expect(cold.performanceAggregate.state).toBe("AVAILABLE");
    expect(cold.orchestration.characterDigests.length).toBe(16);

    const perf = cold.orchestration.dimensions.performance;
    const utility = cold.orchestration.dimensions.utility;
    const survival = cold.orchestration.dimensions.survival;
    expect(perf).not.toBeNull();
    expect(perf!.calculatorVersion).toBe(PERFORMANCE_PHASE2_ALGORITHM_VERSION);
    expect(perf!.phase1Score).not.toBeNull();
    expect(perf!.profileSummary).not.toBeNull();
    expect(utility?.score).not.toBeNull();
    expect(survival?.score).not.toBeNull();

    // Legacy Phase 1 internals stamp differs from product Phase 2.
    expect(PERFORMANCE_V2_ALGORITHM_VERSION).not.toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );
    expect(perf!.algorithmVersion).toBe(PERFORMANCE_PHASE2_ALGORITHM_VERSION);
    expect(
      computePerformanceV2({
        manifest: {
          contentHash: cold.orchestration.manifest.contentHash,
          schemaVersion: cold.orchestration.manifest.schemaVersion,
          selectorVersion: cold.orchestration.manifest.selectorVersion,
          characterId: cold.orchestration.manifest.characterId,
          seasonId: cold.orchestration.manifest.seasonId,
          seasonSlug: cold.orchestration.manifest.seasonSlug,
          specSlug: cold.orchestration.manifest.specSlug,
          role: cold.orchestration.manifest.role,
          highKeyPolicyId: cold.orchestration.manifest.highKeyPolicyId,
          activeDungeonSlugs: cold.orchestration.manifest.activeDungeonSlugs,
          expectedSlotCount: cold.orchestration.manifest.expectedSlotCount,
          selectedSlotCount: cold.orchestration.manifest.selectedSlotCount,
          evidenceCutoffAt: cold.orchestration.manifest.evidenceCutoffAt,
        },
        runParseFacts: [],
        profileAggregate: null,
        difficultyPolicy: {
          id: "legacy",
          seasonId: SEASON_ID,
          region: "eu",
          role: "dps",
          specSlug: "fire",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          k50: 8,
          k90: 12,
          k99: 15,
          source: "MANUAL",
          sampleSize: 1,
          confidence: 0.5,
          version: "sdp-v1",
        },
        expectedPartition: null,
        logFreshness: 1,
        computedAt: "2026-01-01T00:00:00.000Z",
      }).algorithmVersion,
    ).toBe(PERFORMANCE_V2_ALGORITHM_VERSION);

    const details = saved[0]?.dimensionDetails as {
      performance?: { calculatorVersion?: string };
    };
    expect(details?.performance?.calculatorVersion).toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );

    const utilityScore = utility!.score;
    const survivalScore = survival!.score;
    const perfScore = perf!.score;
    const perfFp = perf!.inputFingerprint;

    // Warm on same ports: provider-forbidden, cache hits, zero provider calls.
    const warm = await scoreCharacter({
      ...baseFields,
      allowProviderCalls: false,
    });
    expect(warm.providerCalls).toBe(0);
    expect(warm.orchestration.dimensions.utility?.score).toBe(utilityScore);
    expect(warm.orchestration.dimensions.survival?.score).toBe(survivalScore);
    expect(warm.orchestration.dimensions.performance?.score).toBe(perfScore);
    expect(warm.orchestration.dimensions.performance?.inputFingerprint).toBe(
      perfFp,
    );
    expect(warm.orchestration.dimensions.performance?.calculatorVersion).toBe(
      PERFORMANCE_PHASE2_ALGORITHM_VERSION,
    );

    // Provider-free replay again — still zero provider calls, same diagnostics.
    const replay = await scoreCharacter({
      ...baseFields,
      allowProviderCalls: false,
    });
    expect(replay.providerCalls).toBe(0);
    expect(replay.orchestration.dimensions.performance?.score).toBe(perfScore);
    expect(replay.orchestration.dimensions.performance?.phase1Score).toBe(
      perf!.phase1Score,
    );
    expect(replay.orchestration.dimensions.utility?.score).toBe(utilityScore);
    expect(replay.orchestration.dimensions.survival?.score).toBe(survivalScore);
  });
});
