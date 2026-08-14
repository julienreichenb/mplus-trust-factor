/**
 * Aspha regression: current profile Elemental/DPS vs season WCL Restoration/HEALER.
 * Scoring identity is resolved upstream; strict spec binding stays EXACT_MATCH.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  type PersistedCharacterPerformanceAggregateV2,
} from "@mplus/contracts";
import { HEALER_PERFORMANCE_WEIGHTS, PARSE_CHANNEL_WEIGHTS } from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { scoreCharacter } from "./score-character.js";
import { resolveSeasonScoringIdentity } from "./season-scoring-identity.js";

const CHARACTER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const SEASON_ID = "bbbbbbbb-0000-4000-8000-000000000012";

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

function dungeonRow(
  slug: string,
  best: number,
  median: number,
): PersistedCharacterPerformanceAggregateV2["damage"]["dungeonAggregates"][number] {
  return {
    dungeonSlug: slug,
    dungeonName: slug,
    encounterId: 1,
    bestParsePercentile: best,
    medianParsePercentile: median,
    loggedRunCount: 4,
    specialization: "Restoration",
    keystoneLevel: 12,
    bestDps: 1_000,
  };
}

function asphaHealerCompact(): PersistedCharacterPerformanceAggregateV2 {
  const healing = DUNGEONS.map((slug) => dungeonRow(slug, 80, 70));
  const damage = DUNGEONS.map((slug) => dungeonRow(slug, 60, 50));
  return {
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role: "HEALER",
    targetSpecSlug: "restoration",
    zoneId: 47,
    partition: null,
    damage: {
      metric: "points_and_damage",
      dungeonAggregates: damage,
      bestPercentileAverage: 60,
      medianPercentileAverage: 50,
      totalLoggedRuns: 32,
      totalMythicPlusScore: 3000,
      partition: null,
      zoneId: 47,
      observedSpecs: ["Restoration"],
      specBinding: "EXACT_MATCH",
      wclBestPerformanceAverage: 60,
      wclMedianPerformanceAverage: 50,
    },
    healing: {
      metric: "points_and_healing",
      dungeonAggregates: healing,
      bestPercentileAverage: 80,
      medianPercentileAverage: 70,
      totalLoggedRuns: 32,
      totalMythicPlusScore: 3000,
      partition: null,
      zoneId: 47,
      observedSpecs: ["Restoration"],
      specBinding: "EXACT_MATCH",
      wclBestPerformanceAverage: 80,
      wclMedianPerformanceAverage: 70,
    },
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      role: "HEALER",
      targetSpecSlug: "restoration",
      damageDungeonCount: 8,
      healingDungeonCount: 8,
      expectedDungeonCount: 8,
      specBindingPolicy: "payload_observed_specs_vs_target_spec; query role/specName not trusted",
      limitations: [],
    },
  };
}

describe("Aspha season scoring identity → role-aware healer Performance", () => {
  it("scores Restoration/HEALER from WCL season evidence while profile stays Elemental/DPS", async () => {
    const publicProfile = {
      classSlug: "shaman",
      specSlug: "elemental",
      role: "DPS" as const,
    };
    const seasonIdentity = resolveSeasonScoringIdentity({
      profileIdentity: publicProfile,
      wclPerformanceEvidence: {
        specRanks: [{ spec: "Restoration" }],
        dungeonAggregates: DUNGEONS.map((dungeonSlug) => ({
          dungeonSlug,
          specialization: "Restoration",
        })),
      },
      activeDungeonSlugs: DUNGEONS,
    });
    expect(seasonIdentity).toMatchObject({
      classSlug: "shaman",
      specSlug: "restoration",
      role: "HEALER",
      source: "WCL_ACTIVE_DUNGEONS",
    });
    expect(publicProfile).toEqual({
      classSlug: "shaman",
      specSlug: "elemental",
      role: "DPS",
    });

    const compact = asphaHealerCompact();
    const ensureCalls: Array<{ role: string; specSlug: string | null }> = [];
    const ensureAgg: Parameters<
      typeof scoreCharacter
    >[0]["ensurePerformanceAggregate"] = async (input) => {
      ensureCalls.push({ role: input.role, specSlug: input.specSlug });
      return {
        state: "AVAILABLE" as const,
        data: {
          id: "agg-aspha",
          characterId: CHARACTER_ID,
          seasonId: SEASON_ID,
          zoneId: 47,
          partitionKey: "current",
          rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          state: "OK" as const,
          rawPayload: { damage: {}, healing: {} },
          dungeonAggregates: compact.damage.dungeonAggregates,
          globalSummary: {
            totalMythicPlusScore: compact.damage.totalMythicPlusScore,
            totalLoggedRuns: compact.damage.totalLoggedRuns,
            bestDpsPercentileAverage: compact.damage.bestPercentileAverage,
            medianDpsPercentileAverage: compact.damage.medianPercentileAverage,
            partition: compact.partition,
            zoneId: compact.zoneId,
          },
          diagnostics: compact.diagnostics,
          contentHash: "agg-hash-aspha",
          sourceRequestFingerprint: "fp-aspha",
          fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
          expiresAt: new Date("2026-01-02T00:00:00.000Z"),
          compact,
        },
        reason: null,
        cache: "MISS" as const,
        providerCalls: 1,
        created: true,
        updated: false,
        aggregateRowId: "agg-aspha",
        contentHash: "agg-hash-aspha",
      };
    };

    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      identity: {
        characterId: CHARACTER_ID,
        region: "eu",
        realm: "garona",
        characterName: "Aspha",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: seasonIdentity.role,
      classSlug: seasonIdentity.classSlug,
      specSlug: seasonIdentity.specSlug,
      activeDungeonSlugs: DUNGEONS,
      candidates: DUNGEONS.map((slug, i) => candidate(slug, `A${i}`, 1)),
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      scoringModelId: "model-1",
      zoneId: 47,
      partition: null,
      ensurePerformanceAggregate: ensureAgg,
      ports: createMemoryOrchestrationPorts(),
      prisma: fakePrisma(saved),
      artifacts: {} as never,
      evidence: {} as never,
      allowProviderCalls: true,
    });

    expect(ensureCalls).toEqual([{ role: "HEALER", specSlug: "restoration" }]);
    expect(result.performanceAggregate.state).toBe("AVAILABLE");
    expect(result.performanceAggregate.data?.compact.role).toBe("HEALER");
    expect(result.performanceAggregate.data?.compact.healing).not.toBeNull();
    expect(result.performanceAggregate.data?.compact.damage).not.toBeNull();

    const perf = result.orchestration.dimensions.performance;
    expect(perf).not.toBeNull();
    expect(perf!.state).toBe("AVAILABLE");
    expect(perf!.roleAware?.role).toBe("HEALER");
    expect(perf!.roleAware?.healingParse).not.toBeNull();
    expect(perf!.roleAware?.damageParse).not.toBeNull();
    expect(perf!.roleAware?.weightsApplied.healingParse).toBe(
      HEALER_PERFORMANCE_WEIGHTS.healingParse,
    );
    expect(perf!.roleAware?.weightsApplied.damageParse).toBe(
      HEALER_PERFORMANCE_WEIGHTS.damageParse,
    );

    const healingParse =
      PARSE_CHANNEL_WEIGHTS.bestAverage * 80 + PARSE_CHANNEL_WEIGHTS.medianAverage * 70;
    const damageParse =
      PARSE_CHANNEL_WEIGHTS.bestAverage * 60 + PARSE_CHANNEL_WEIGHTS.medianAverage * 50;
    const expected =
      HEALER_PERFORMANCE_WEIGHTS.healingParse * healingParse +
      HEALER_PERFORMANCE_WEIGHTS.damageParse * damageParse;
    expect(perf!.score).toBeCloseTo(expected, 5);

    const details = saved[0]?.dimensionDetails as {
      performance?: { roleAware?: { role?: string; damageParse?: unknown; healingParse?: unknown } };
    };
    expect(details.performance?.roleAware?.role).toBe("HEALER");
    expect(details.performance?.roleAware?.damageParse).not.toBeNull();
    expect(details.performance?.roleAware?.healingParse).not.toBeNull();

    expect(publicProfile.specSlug).toBe("elemental");
    expect(publicProfile.role).toBe("DPS");
  });
});
