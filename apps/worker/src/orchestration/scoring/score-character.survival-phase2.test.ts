/**
 * Product boundary: scoreCharacter persists authoritative Survival Phase 2.
 * Performance / Utility numerical paths remain unchanged; replay stays provider-free.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import {
  SURVIVAL_V2_ALGORITHM_VERSION,
  PERFORMANCE_PHASE2_ALGORITHM_VERSION,
  UTILITY_V2_ALGORITHM_VERSION,
} from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { buildTestEnsurePerformanceAggregateResult } from "./run-orchestration/test-fixtures.js";
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
    scoreModel: {
      findUnique: async () => ({ config: {} }),
    },
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

describe("scoreCharacter Survival Phase 2 product boundary", () => {
  it("persists Survival Phase 2; warm/replay match; Performance/Utility unchanged; zero provider calls on replay", async () => {
    const candidates = DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `S${i}A`, 1, 1),
      candidate(slug, `S${i}B`, 2, 1),
    ]);
    const ports = createMemoryOrchestrationPorts();
    const ensureAgg = buildTestEnsurePerformanceAggregateResult({
      characterId: CHARACTER_ID,
      seasonId: SEASON_ID,
      dungeonSlugs: DUNGEONS,
      role: "DPS",
      targetSpecSlug: "fire",
    });

    const saved: Array<Record<string, unknown>> = [];
    const baseFields = {
      identity: {
        characterId: CHARACTER_ID,
        region: "eu",
        realm: "archimonde",
        characterName: "Target",
      },
      seasonId: SEASON_ID,
      seasonSlug: "season-tww-3",
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: DUNGEONS,
      candidates,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "test-policy",
      scoringModelId: "product-survival-phase2",
      zoneId: 47,
      partition: null as number | null,
      ensurePerformanceAggregate: ensureAgg,
      ports,
      prisma: fakePrisma(saved),
      artifacts: {} as never,
      evidence: {} as never,
    };

    const cold = await scoreCharacter({
      ...baseFields,
      allowProviderCalls: true,
    });
    expect(cold.scoringVersion).toBe(SCORING_VERSION);
    expect(cold.scoringVersion).toContain("survival-phase2");
    expect(cold.orchestration.characterDigests.length).toBe(16);

    const survival = cold.orchestration.dimensions.survival;
    const performance = cold.orchestration.dimensions.performance;
    const utility = cold.orchestration.dimensions.utility;
    expect(survival?.algorithmVersion).toBe(SURVIVAL_V2_ALGORITHM_VERSION);
    expect(survival?.score).not.toBeNull();
    expect(performance?.calculatorVersion).toBe(PERFORMANCE_PHASE2_ALGORITHM_VERSION);
    expect(utility?.algorithmVersion).toBe(UTILITY_V2_ALGORITHM_VERSION);

    const survivalScore = survival!.score;
    const performanceScore = performance!.score;
    const utilityScore = utility!.score;
    const performanceFp = performance!.inputFingerprint;
    const utilityFp = utility!.inputFingerprint;

    const details = saved[0]?.dimensionDetails as {
      survival?: { algorithmVersion?: string; state?: string };
    };
    expect(details.survival?.algorithmVersion).toBe(SURVIVAL_V2_ALGORITHM_VERSION);
    expect(saved[0]?.survival).toBe(survivalScore);

    const warm = await scoreCharacter({
      ...baseFields,
      allowProviderCalls: false,
    });
    expect(warm.providerCalls).toBe(0);
    expect(warm.orchestration.dimensions.survival?.score).toBe(survivalScore);
    expect(warm.orchestration.dimensions.performance?.score).toBe(performanceScore);
    expect(warm.orchestration.dimensions.performance?.inputFingerprint).toBe(
      performanceFp,
    );
    expect(warm.orchestration.dimensions.utility?.score).toBe(utilityScore);
    expect(warm.orchestration.dimensions.utility?.inputFingerprint).toBe(utilityFp);

    const replay = await scoreCharacter({
      ...baseFields,
      allowProviderCalls: false,
    });
    expect(replay.providerCalls).toBe(0);
    expect(replay.orchestration.dimensions.survival?.score).toBe(survivalScore);
    expect(replay.orchestration.dimensions.performance?.score).toBe(performanceScore);
    expect(replay.orchestration.dimensions.utility?.score).toBe(utilityScore);
  });
});
