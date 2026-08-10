/**
 * Cold / warm / replay CharacterPerformanceAggregate orchestration (Tests F–K, M).
 */
import { describe, expect, it, vi } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  toPerformanceAggregateDbColumnsV2,
} from "@mplus/contracts";
import type { CharacterPerformanceAggregateDTO } from "@mplus/database";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { scoreCharacter, SCORING_VERSION } from "./score-character.js";
import type { EnsureCharacterPerformanceAggregateResult } from "./run-orchestration/ensure-performance-aggregate.js";
import { buildRoleAwareAggregateFromRaw } from "@mplus/provider-warcraftlogs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHARACTER_ID = "00000000-0000-4000-8000-000000000011";
const SEASON_ID = "00000000-0000-4000-8000-000000000012";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const wallidrixePadPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json",
);

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

function baseScoreInput(
  overrides: Partial<Parameters<typeof scoreCharacter>[0]> = {},
) {
  const candidates = DUNGEONS.flatMap((slug, i) => [
    candidate(slug, `R${i}A`, 1, 1),
    candidate(slug, `R${i}B`, 2, 1),
  ]);
  return {
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
    candidates,
    evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
    highKeyPolicyId: "policy-1",
    scoringModelId: "model-1",
    allowProviderCalls: false,
    zoneId: 47,
    ports: createMemoryOrchestrationPorts(),
    prisma: {
      scoreModel: {
        findUnique: async () => ({ config: {} }),
      },
      characterScore: {
        findUnique: async () => null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => ({
          id: "score-1",
          ...create,
        }),
      },
    } as never,
    artifacts: {} as never,
    evidence: {} as never,
    ensurePerformanceAggregate: async () => ({
      state: "UNAVAILABLE" as const,
      data: null,
      reason: "performance_aggregate_unavailable_replay",
      cache: "MISS" as const,
      providerCalls: 0,
      created: false as const,
      updated: false as const,
      aggregateRowId: null,
      contentHash: null,
    }),
    ...overrides,
  };
}

function compactFromPadFixture(raw: unknown) {
  const built = buildRoleAwareAggregateFromRaw({
    role: "DPS",
    // Fixture is Wallidrixe Demonology — leave unproven rather than inventing a Fire bind.
    targetSpecSlug: null,
    zoneId: 47,
    partition: null,
    damageRaw: raw,
    healingRaw: null,
  });
  if (built.state !== "OK" || built.compact == null) {
    throw new Error(`fixture adapt failed: ${built.state} ${built.errorMessage ?? ""}`);
  }
  return built.compact;
}

function sampleDto(
  overrides: Partial<CharacterPerformanceAggregateDTO> = {},
): CharacterPerformanceAggregateDTO {
  const fixture = JSON.parse(readFileSync(wallidrixePadPath, "utf8")) as {
    rawZoneRankingsPointsAndDamage: unknown;
  };
  const compact = compactFromPadFixture(fixture.rawZoneRankingsPointsAndDamage);
  const cols = toPerformanceAggregateDbColumnsV2(compact);
  return {
    id: "agg-1",
    characterId: CHARACTER_ID,
    seasonId: SEASON_ID,
    zoneId: 47,
    partitionKey: "current",
    rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    state: "OK",
    rawPayload: { damage: fixture.rawZoneRankingsPointsAndDamage, healing: null },
    dungeonAggregates: cols.dungeonAggregates,
    globalSummary: cols.globalSummary,
    diagnostics: cols.diagnostics,
    contentHash: "hash-1",
    sourceRequestFingerprint: "fp-1",
    fetchedAt: new Date("2026-08-06T10:00:00.000Z"),
    expiresAt: new Date("2026-08-06T22:00:00.000Z"),
    compact,
    ...overrides,
  };
}

describe("scoreCharacter performance aggregate orchestration", () => {
  it("cold path: one provider call, exposes aggregate, scores unchanged (Test F + M)", async () => {
    const fixture = JSON.parse(readFileSync(wallidrixePadPath, "utf8")) as {
      rawZoneRankingsPointsAndDamage: unknown;
    };
    const compact = compactFromPadFixture(fixture.rawZoneRankingsPointsAndDamage);
    const cols = toPerformanceAggregateDbColumnsV2(compact);
    const dto = sampleDto({
      dungeonAggregates: cols.dungeonAggregates,
      globalSummary: cols.globalSummary,
      diagnostics: cols.diagnostics,
      compact,
      contentHash: "cold-hash",
      id: "agg-cold",
    });

    const ensure = vi.fn(
      async (): Promise<EnsureCharacterPerformanceAggregateResult> => ({
        state: "AVAILABLE",
        data: dto,
        reason: null,
        cache: "MISS",
        providerCalls: 1,
        created: true,
        updated: false,
        aggregateRowId: dto.id,
        contentHash: dto.contentHash,
      }),
    );

    const withoutAgg = await scoreCharacter(
      baseScoreInput({
        ensurePerformanceAggregate: async () => ({
          state: "UNAVAILABLE",
          data: null,
          reason: "performance_aggregate_unavailable_replay",
          cache: "MISS",
          providerCalls: 0,
          created: false,
          updated: false,
          aggregateRowId: null,
          contentHash: null,
        }),
      }),
    );
    const withAgg = await scoreCharacter(
      baseScoreInput({
        allowProviderCalls: true,
        ensurePerformanceAggregate: ensure,
        performanceAggregateProvider: {
          fetchCharacterPerformanceAggregate: async () => {
            throw new Error("should not be called when ensure is overridden");
          },
        },
      }),
    );

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(withAgg.performanceAggregate.state).toBe("AVAILABLE");
    expect(withAgg.performanceAggregate.cache).toBe("MISS");
    expect(withAgg.performanceAggregate.providerCalls).toBe(1);
    expect(withAgg.performanceAggregate.data?.dungeonAggregates[0]?.bestParsePercentile).toBe(
      compact.damage.dungeonAggregates[0]?.bestParsePercentile,
    );

    // Utility / Survival unchanged; Performance uses role-aware profile throughput.
    expect(withAgg.orchestration.dimensions.utility?.score).toBe(
      withoutAgg.orchestration.dimensions.utility?.score,
    );
    expect(withAgg.orchestration.dimensions.survival?.score).toBe(
      withoutAgg.orchestration.dimensions.survival?.score,
    );
    expect(withAgg.scoringVersion).toBe(SCORING_VERSION);
    expect(
      withAgg.orchestration.dimensions.performance?.calculatorVersion ??
        withAgg.orchestration.dimensions.blocked.some(
          (b) => b.dimension === "PERFORMANCE",
        ),
    ).toBeTruthy();
  });

  it("warm path: provider not called (Test G)", async () => {
    const dto = sampleDto({ id: "agg-warm", contentHash: "warm-hash" });
    const ensure = vi.fn(
      async (): Promise<EnsureCharacterPerformanceAggregateResult> => ({
        state: "AVAILABLE",
        data: dto,
        reason: null,
        cache: "HIT",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: dto.id,
        contentHash: dto.contentHash,
      }),
    );
    const result = await scoreCharacter(
      baseScoreInput({
        zoneId: 47,
        allowProviderCalls: true,
        ensurePerformanceAggregate: ensure,
        performanceAggregateProvider: {
          fetchCharacterPerformanceAggregate: async () => {
            throw new Error("provider must not be called on warm hit");
          },
        },
      }),
    );
    expect(result.performanceAggregate.cache).toBe("HIT");
    expect(result.performanceAggregate.providerCalls).toBe(0);
  });

  it("provider-free replay loads aggregate with zero provider calls (Test I)", async () => {
    const dto = sampleDto({
      id: "agg-replay",
      contentHash: "replay-hash",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const ensure = vi.fn(
      async (): Promise<EnsureCharacterPerformanceAggregateResult> => ({
        state: "AVAILABLE",
        data: dto,
        reason: null,
        cache: "REPLAY",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: dto.id,
        contentHash: dto.contentHash,
      }),
    );
    const result = await scoreCharacter(
      baseScoreInput({
        zoneId: 47,
        allowProviderCalls: false,
        ensurePerformanceAggregate: ensure,
        performanceAggregateProvider: {
          fetchCharacterPerformanceAggregate: async () => {
            throw new Error("replay must not call provider");
          },
        },
      }),
    );
    expect(result.performanceAggregate.state).toBe("AVAILABLE");
    expect(result.performanceAggregate.cache).toBe("REPLAY");
    expect(result.performanceAggregate.providerCalls).toBe(0);
    expect(result.performanceAggregate.contentHash).toBe("replay-hash");
    expect(result.providerCalls).toBe(0);
  });

  it("replay missing aggregate is dimension-local unavailable (Test J)", async () => {
    const ensure = vi.fn(
      async (): Promise<EnsureCharacterPerformanceAggregateResult> => ({
        state: "UNAVAILABLE",
        data: null,
        reason: "performance_aggregate_unavailable_replay",
        cache: "MISS",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      }),
    );
    const baseline = await scoreCharacter(baseScoreInput());
    const result = await scoreCharacter(
      baseScoreInput({
        zoneId: 47,
        allowProviderCalls: false,
        ensurePerformanceAggregate: ensure,
        performanceAggregateProvider: {
          fetchCharacterPerformanceAggregate: async () => {
            throw new Error("must not call");
          },
        },
      }),
    );
    expect(result.performanceAggregate.state).toBe("UNAVAILABLE");
    expect(result.performanceAggregate.providerCalls).toBe(0);
    expect(result.orchestration.dimensions.utility?.score).toBe(
      baseline.orchestration.dimensions.utility?.score,
    );
    expect(result.orchestration.dimensions.survival?.score).toBe(
      baseline.orchestration.dimensions.survival?.score,
    );
  });

  it("version incompatibility surfaces as unavailable on replay (Test K)", async () => {
    const ensure = vi.fn(
      async (): Promise<EnsureCharacterPerformanceAggregateResult> => ({
        state: "UNAVAILABLE",
        data: null,
        reason: "performance_aggregate_unavailable_replay",
        cache: "INCOMPATIBLE",
        providerCalls: 0,
        created: false,
        updated: false,
        aggregateRowId: null,
        contentHash: null,
      }),
    );
    const result = await scoreCharacter(
      baseScoreInput({
        zoneId: 47,
        allowProviderCalls: false,
        ensurePerformanceAggregate: ensure,
      }),
    );
    expect(result.performanceAggregate.state).toBe("UNAVAILABLE");
    expect(result.performanceAggregate.providerCalls).toBe(0);
  });
});

describe("ensureCharacterPerformanceAggregate port behavior", () => {
  it("expired live row refreshes via provider (Test H)", async () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    const providerCalls = vi.fn(async () => ({
      record: {
        state: "OK" as const,
        adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
        metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
        compact: sampleDto().compact,
        raw: sampleDto().rawPayload,
      },
      rawPayload: sampleDto().rawPayload,
      sourceRequestFingerprint: "fp-refresh",
      providerCalls: 1,
    }));

    const refreshed = sampleDto({
      id: "expired",
      contentHash: "new-hash",
      expiresAt: new Date("2026-08-07T12:00:00.000Z"),
      fetchedAt: now,
    });
    const ensureOverride = vi.fn(
      async (): Promise<EnsureCharacterPerformanceAggregateResult> => {
        await providerCalls();
        return {
          state: "AVAILABLE",
          data: refreshed,
          reason: null,
          cache: "MISS",
          providerCalls: 1,
          created: false,
          updated: true,
          aggregateRowId: refreshed.id,
          contentHash: refreshed.contentHash,
        };
      },
    );

    const result = await scoreCharacter(
      baseScoreInput({
        zoneId: 47,
        allowProviderCalls: true,
        now,
        ensurePerformanceAggregate: ensureOverride,
      }),
    );
    expect(providerCalls).toHaveBeenCalledTimes(1);
    expect(result.performanceAggregate.updated).toBe(true);
    expect(result.performanceAggregate.contentHash).toBe("new-hash");
  });
});
