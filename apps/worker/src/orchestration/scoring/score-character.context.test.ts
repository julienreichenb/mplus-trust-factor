/**
 * Context factor plumbing through scoreCharacter — provider-free.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import { applyScoreContext, defaultNeutralTierFactors } from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { scoreCharacter } from "./score-character.js";
import type { ScoringRunSelection } from "@mplus/scoring";

const CHARACTER_ID = "00000000-0000-4000-8000-000000000001";
const SEASON_ID = "00000000-0000-4000-8000-000000000002";

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
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: 1,
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
    hardError: false,
  };
}

function fakePrisma() {
  return {
    scoreModel: { findUnique: async () => ({ config: {} }) },
    characterScore: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({
        id: "score-1",
        ...create,
      }),
    },
  } as never;
}

const ensureUnavailable = async () =>
  ({
    state: "UNAVAILABLE" as const,
    data: null,
    reason: "test",
    cache: "MISS" as const,
    providerCalls: 0,
    created: false as const,
    updated: false as const,
    aggregateRowId: null,
    contentHash: null,
  });

function canonicalSelection(): ScoringRunSelection {
  const keys = [18, 18, 19, 19, 20, 20, 21, 22];
  return {
    seasonSlug: "midnight-season-1",
    expectedDungeonCount: 8,
    selectedRuns: DUNGEONS.map((dungeonSlug, i) => ({
      dungeonSlug,
      canonicalRunId: `run-${i}`,
      keyLevel: keys[i]!,
      timed: true,
      completedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 1000,
      raiderIoScore: 200,
      wclReportMatched: true,
      wclCoverageRatio: 1,
      selectionReason: "HIGHEST_KEY" as const,
    })),
  };
}

describe("scoreCharacter context plumbing", () => {
  it("M: provider-forbidden scoring with context remains providerCalls=0", async () => {
    const result = await scoreCharacter({
      identity: {
        characterId: CHARACTER_ID,
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: DUNGEONS,
      candidates: DUNGEONS.flatMap((slug, i) => [
        candidate(slug, `R${i}A`, 1),
        candidate(slug, `R${i}B`, 2),
      ]),
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      scoringModelId: "model-1",
      allowProviderCalls: false,
      zoneId: 47,
      ensurePerformanceAggregate: ensureUnavailable,
      ports: createMemoryOrchestrationPorts(),
      artifacts: {} as never,
      evidence: {} as never,
      prisma: fakePrisma(),
      canonicalRunSelection: canonicalSelection(),
      seasonContextRevision: {
        id: "rev-1",
        seasonId: SEASON_ID,
        version: 1,
        status: "PUBLISHED",
        publishedAt: "2026-01-01T00:00:00.000Z",
        tierFactors: { ...defaultNeutralTierFactors(), 5: 1.2 },
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
        distribution: {
          id: "dist-1",
          seasonId: SEASON_ID,
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9000, medianKeyThreshold: 19.5 }],
        },
      },
    });

    expect(result.providerCalls).toBe(0);
    expect(result.appliedContext.key.medianKeyLevel).toBe(19.5);
    expect(result.appliedContext.key.canonicalRuns).toHaveLength(8);
    expect(result.appliedContext.meta.tier).toBe(5);
    expect(result.appliedContext.meta.factor).toBe(1.2);
    const recomputed = applyScoreContext({
      seasonId: SEASON_ID,
      rawScoreBeforeContext: result.appliedContext.rawScoreBeforeContext,
      canonicalRunSelection: canonicalSelection(),
      seasonContextRevision: {
        id: "rev-1",
        seasonId: SEASON_ID,
        version: 1,
        status: "PUBLISHED",
        publishedAt: "2026-01-01T00:00:00.000Z",
        tierFactors: { ...defaultNeutralTierFactors(), 5: 1.2 },
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        percentileAnchors: [{ percentileBps: 9000, factor: 1 }],
        distribution: {
          id: "dist-1",
          seasonId: SEASON_ID,
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9000, medianKeyThreshold: 19.5 }],
        },
      },
      seasonScoringSpec: {
        classSlug: "mage",
        specSlug: "fire",
        source: "SEASON_SCORING_IDENTITY",
      },
    });
    expect(result.appliedContext.finalScore).toBe(recomputed.finalScore);
  });

  it("N: P/S/U scores are independent of context factors", async () => {
    const base = {
      identity: {
        characterId: CHARACTER_ID,
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: DUNGEONS,
      candidates: DUNGEONS.flatMap((slug, i) => [
        candidate(slug, `R${i}A`, 1),
        candidate(slug, `R${i}B`, 2),
      ]),
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      scoringModelId: "model-1",
      allowProviderCalls: false,
      zoneId: 47,
      ensurePerformanceAggregate: ensureUnavailable,
      ports: createMemoryOrchestrationPorts(),
      artifacts: {} as never,
      evidence: {} as never,
      prisma: fakePrisma(),
      canonicalRunSelection: canonicalSelection(),
    };

    const neutral = await scoreCharacter({
      ...base,
      seasonContextRevision: null,
    });
    const boosted = await scoreCharacter({
      ...base,
      seasonContextRevision: {
        id: "rev-boost",
        seasonId: SEASON_ID,
        version: 2,
        status: "PUBLISHED",
        publishedAt: "2026-01-01T00:00:00.000Z",
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1.5 },
        specAssignments: [{ classSlug: "mage", specSlug: "fire", tier: 5 }],
        percentileAnchors: [{ percentileBps: 9000, factor: 1.1 }],
        distribution: {
          id: "dist-1",
          seasonId: SEASON_ID,
          source: "MANUAL_IMPORT",
          provenance: {},
          sourceVersion: "v1",
          collectedAt: "2026-01-01T00:00:00.000Z",
          effectiveAt: null,
          contentHash: "x",
          points: [{ percentileBps: 9000, medianKeyThreshold: 19 }],
        },
      },
    });

    expect(neutral.orchestration.dimensions.performance?.score).toBe(
      boosted.orchestration.dimensions.performance?.score,
    );
    expect(neutral.orchestration.dimensions.utility?.score).toBe(
      boosted.orchestration.dimensions.utility?.score,
    );
    expect(neutral.orchestration.dimensions.survival?.score).toBe(
      boosted.orchestration.dimensions.survival?.score,
    );
    expect(neutral.appliedContext.rawScoreBeforeContext).toBe(
      boosted.appliedContext.rawScoreBeforeContext,
    );
    expect(boosted.appliedContext.combinedFactor).toBeGreaterThan(1);
  });
});
