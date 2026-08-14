/**
 * Ensure CharacterPerformanceAggregate V2 — role/spec cache compatibility.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
  CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
  assertPersistedCharacterPerformanceAggregateV2,
  toPerformanceAggregateDbColumnsV2,
} from "@mplus/contracts";
import type { CharacterPerformanceAggregateDTO } from "@mplus/database";
import type * as DatabaseModule from "@mplus/database";
import { createEnsureCharacterPerformanceAggregate } from "./ensure-performance-aggregate.js";

const findCompatibleLive = vi.fn();
const findCompatibleForReplay = vi.fn();
const upsert = vi.fn();

vi.mock("@mplus/database", async (importOriginal) => {
  const actual = await importOriginal<typeof DatabaseModule>();
  return {
    ...actual,
    CharacterPerformanceAggregateRepository: class {
      findCompatibleLive = findCompatibleLive;
      findCompatibleForReplay = findCompatibleForReplay;
      upsert = upsert;
    },
  };
});

function channel(roleSpec: string) {
  return {
    metric: "points_and_damage" as const,
    dungeonAggregates: [
      {
        dungeonSlug: "skyreach",
        dungeonName: "Skyreach",
        encounterId: 1,
        bestParsePercentile: 80,
        medianParsePercentile: 80,
        loggedRunCount: 5,
        specialization: roleSpec,
        keystoneLevel: 12,
        bestDps: 1000,
      },
    ],
    bestPercentileAverage: 80,
    medianPercentileAverage: 80,
    totalLoggedRuns: 5,
    totalMythicPlusScore: 3000,
    partition: null,
    zoneId: 47,
    observedSpecs: [roleSpec],
    specBinding: "EXACT_MATCH" as const,
    wclBestPerformanceAverage: 80,
    wclMedianPerformanceAverage: 80,
  };
}

function compact(input: {
  role: "DPS" | "TANK" | "HEALER";
  targetSpecSlug: string | null;
}) {
  return assertPersistedCharacterPerformanceAggregateV2({
    state: "OK",
    adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    role: input.role,
    targetSpecSlug: input.targetSpecSlug,
    zoneId: 47,
    partition: null,
    damage: channel(input.targetSpecSlug ?? "Unknown"),
    healing:
      input.role === "HEALER"
        ? {
            ...channel(input.targetSpecSlug ?? "Restoration"),
            metric: "points_and_healing" as const,
          }
        : null,
    diagnostics: {
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      provenance: "AGGREGATE_ZONE_RANKINGS",
      role: input.role,
      targetSpecSlug: input.targetSpecSlug,
      damageDungeonCount: 1,
      healingDungeonCount: input.role === "HEALER" ? 1 : 0,
      expectedDungeonCount: 8,
      specBindingPolicy: "test",
      limitations: [],
    },
  });
}

function dtoFromCompact(
  c: ReturnType<typeof compact>,
): CharacterPerformanceAggregateDTO {
  const cols = toPerformanceAggregateDbColumnsV2(c);
  return {
    id: "agg-1",
    characterId: "char-1",
    seasonId: "season-1",
    zoneId: 47,
    partitionKey: "current",
    rankingVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
    metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
    state: "OK",
    rawPayload: {},
    dungeonAggregates: cols.dungeonAggregates,
    globalSummary: cols.globalSummary,
    diagnostics: cols.diagnostics,
    contentHash: "hash-1",
    sourceRequestFingerprint: "fp-1",
    fetchedAt: new Date("2026-08-10T12:00:00.000Z"),
    expiresAt: new Date("2026-08-11T12:00:00.000Z"),
    compact: c,
  };
}

const baseInput = {
  characterId: "char-1",
  seasonId: "season-1",
  zoneId: 47,
  partition: null as number | null,
  character: {
    name: "Tester",
    realmSlug: "archimonde",
    region: "EU" as const,
  },
  now: new Date("2026-08-10T12:00:00.000Z"),
  ttlSeconds: 43_200,
};

describe("ensureCharacterPerformanceAggregate role/spec cache gate", () => {
  beforeEach(() => {
    findCompatibleLive.mockReset();
    findCompatibleForReplay.mockReset();
    upsert.mockReset();
  });

  it("1. cached DPS requested as HEALER → not HIT (live refetch)", async () => {
    findCompatibleLive.mockResolvedValue(
      dtoFromCompact(compact({ role: "DPS", targetSpecSlug: "demonology" })),
    );
    const fetchedCompact = compact({
      role: "HEALER",
      targetSpecSlug: "restoration",
    });
    upsert.mockResolvedValue({
      row: dtoFromCompact(fetchedCompact),
      created: false,
      updated: true,
      rejectedStale: false,
    });
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const provider = {
      fetchCharacterPerformanceAggregate: vi.fn(async () => ({
        record: {
          state: "OK" as const,
          adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: fetchedCompact,
          raw: {},
        },
        rawPayload: {},
        sourceRequestFingerprint: "fp-new",
        providerCalls: 1,
      })),
    };

    const result = await ensure({
      ...baseInput,
      role: "HEALER",
      specSlug: "restoration",
      liveProviderPermission: "ALLOWED",
      provider,
    });

    expect(result.cache).toBe("MISS");
    expect(provider.fetchCharacterPerformanceAggregate).toHaveBeenCalledTimes(1);
    expect(result.state).toBe("AVAILABLE");
    expect(result.state === "AVAILABLE" && result.data.compact.role).toBe("HEALER");
  });

  it("2. cached HEALER requested as DPS → not HIT", async () => {
    findCompatibleLive.mockResolvedValue(
      dtoFromCompact(compact({ role: "HEALER", targetSpecSlug: "restoration" })),
    );
    const fetchedCompact = compact({ role: "DPS", targetSpecSlug: "elemental" });
    upsert.mockResolvedValue({
      row: dtoFromCompact(fetchedCompact),
      created: false,
      updated: true,
      rejectedStale: false,
    });
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const provider = {
      fetchCharacterPerformanceAggregate: vi.fn(async () => ({
        record: {
          state: "OK" as const,
          adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: fetchedCompact,
          raw: {},
        },
        rawPayload: {},
        sourceRequestFingerprint: "fp-new",
        providerCalls: 1,
      })),
    };

    const result = await ensure({
      ...baseInput,
      role: "DPS",
      specSlug: "elemental",
      liveProviderPermission: "ALLOWED",
      provider,
    });

    expect(result.cache).toBe("MISS");
    expect(provider.fetchCharacterPerformanceAggregate).toHaveBeenCalledTimes(1);
  });

  it("3. cached wrong spec → not HIT", async () => {
    findCompatibleLive.mockResolvedValue(
      dtoFromCompact(compact({ role: "DPS", targetSpecSlug: "restoration" })),
    );
    const fetchedCompact = compact({ role: "DPS", targetSpecSlug: "elemental" });
    upsert.mockResolvedValue({
      row: dtoFromCompact(fetchedCompact),
      created: false,
      updated: true,
      rejectedStale: false,
    });
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const provider = {
      fetchCharacterPerformanceAggregate: vi.fn(async () => ({
        record: {
          state: "OK" as const,
          adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: fetchedCompact,
          raw: {},
        },
        rawPayload: {},
        sourceRequestFingerprint: "fp-new",
        providerCalls: 1,
      })),
    };

    const result = await ensure({
      ...baseInput,
      role: "DPS",
      specSlug: "elemental",
      liveProviderPermission: "ALLOWED",
      provider,
    });

    expect(result.cache).toBe("MISS");
    expect(provider.fetchCharacterPerformanceAggregate).toHaveBeenCalledTimes(1);
  });

  it("4. provider-free wrong-role replay → unavailable", async () => {
    findCompatibleForReplay.mockResolvedValue(
      dtoFromCompact(compact({ role: "DPS", targetSpecSlug: "demonology" })),
    );
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const result = await ensure({
      ...baseInput,
      role: "HEALER",
      specSlug: "restoration",
      liveProviderPermission: "FORBIDDEN",
      provider: null,
    });
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.cache).toBe("INCOMPATIBLE");
    expect(result.reason).toBe(
      "performance_aggregate_role_spec_incompatible_replay",
    );
  });

  it("5. provider-free wrong-spec replay → unavailable", async () => {
    findCompatibleForReplay.mockResolvedValue(
      dtoFromCompact(compact({ role: "DPS", targetSpecSlug: "restoration" })),
    );
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const result = await ensure({
      ...baseInput,
      role: "DPS",
      specSlug: "elemental",
      liveProviderPermission: "FORBIDDEN",
      provider: null,
    });
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.cache).toBe("INCOMPATIBLE");
  });

  it("6. matching role/spec cache → HIT", async () => {
    findCompatibleLive.mockResolvedValue(
      dtoFromCompact(compact({ role: "DPS", targetSpecSlug: "demonology" })),
    );
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const provider = {
      fetchCharacterPerformanceAggregate: vi.fn(async () => {
        throw new Error("must not fetch on HIT");
      }),
    };
    const result = await ensure({
      ...baseInput,
      role: "DPS",
      specSlug: "Demonology",
      liveProviderPermission: "ALLOWED",
      provider,
    });
    expect(result.state).toBe("AVAILABLE");
    expect(result.cache).toBe("HIT");
    expect(provider.fetchCharacterPerformanceAggregate).not.toHaveBeenCalled();
  });

  it("7. cached elemental/DPS must not be reused as restoration/HEALER", async () => {
    findCompatibleLive.mockResolvedValue(
      dtoFromCompact(compact({ role: "DPS", targetSpecSlug: "elemental" })),
    );
    const fetchedCompact = compact({
      role: "HEALER",
      targetSpecSlug: "restoration",
    });
    upsert.mockResolvedValue({
      row: dtoFromCompact(fetchedCompact),
      created: false,
      updated: true,
      rejectedStale: false,
    });
    const ensure = createEnsureCharacterPerformanceAggregate({
      prisma: {} as never,
    });
    const provider = {
      fetchCharacterPerformanceAggregate: vi.fn(async () => ({
        record: {
          state: "OK" as const,
          adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
          metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
          compact: fetchedCompact,
          raw: {},
        },
        rawPayload: {},
        sourceRequestFingerprint: "fp-aspha",
        providerCalls: 1,
      })),
    };
    const result = await ensure({
      ...baseInput,
      role: "HEALER",
      specSlug: "restoration",
      liveProviderPermission: "ALLOWED",
      provider,
    });
    expect(result.cache).toBe("MISS");
    expect(provider.fetchCharacterPerformanceAggregate).toHaveBeenCalledTimes(1);
    expect(result.state === "AVAILABLE" && result.data.compact.role).toBe("HEALER");
    expect(result.state === "AVAILABLE" && result.data.compact.targetSpecSlug).toBe(
      "restoration",
    );
  });
});
