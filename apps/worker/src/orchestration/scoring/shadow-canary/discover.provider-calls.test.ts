/**
 * Shadow Canary discovery providerCalls must match hydration fetch attempts,
 * including when requestPermissive throws.
 */
import { describe, expect, it, vi } from "vitest";
import {
  INCREMENTAL_HYDRATION_BATCH_SIZE,
  INITIAL_HYDRATION_BUDGET,
  MAX_COVERAGE_AWARE_HYDRATION_REPORTS,
  OPERATIONS,
} from "@mplus/provider-warcraftlogs";
import { discoverShadowCanaryCandidates } from "./discover.js";

const SEASON_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ID = "22222222-2222-4222-8222-222222222222";
const CHARACTER_ID = "33333333-3333-4333-8333-333333333333";

function fightUnknownStub(reportCode: string, startTime: number) {
  return {
    reportCode,
    fightId: 0,
    startTime,
    incompleteness: { fightUnknown: true },
  };
}

function mockContainer(requestPermissive: ReturnType<typeof vi.fn>, stubs: unknown[]) {
  return {
    env: { APP_ENV: "test" },
    prisma: {
      season: {
        findFirst: vi.fn(async () => ({
          id: SEASON_ID,
          slug: "blizzard-season-13",
          isCurrent: true,
        })),
      },
      seasonDungeon: {
        findMany: vi.fn(async () => []),
      },
    },
    repositories: {
      score: {
        getActiveModel: vi.fn(async () => ({ id: MODEL_ID })),
      },
    },
    providers: {
      warcraftlogs: {
        discoverCharacter: vi.fn(async () => ({ candidates: stubs })),
        getGraphQlClient: () => ({
          request: requestPermissive,
          requestPermissive,
        }),
      },
    },
  };
}

function zoneAndThrowingHydration() {
  let reportFetchInvocations = 0;
  const requestPermissive = vi.fn(async (args: { operationName: string }) => {
    if (args.operationName === OPERATIONS.WorldDataZone.operationName) {
      return {
        response: {
          data: {
            worldData: {
              zone: {
                id: 45,
                name: "Mythic+",
                encounters: [
                  { id: 12_532, name: "Skyreach" },
                  { id: 12_533, name: "Windrunner Spire" },
                ],
              },
            },
          },
        },
      };
    }
    if (args.operationName === OPERATIONS.ReportWithFightAndMasterData.operationName) {
      reportFetchInvocations += 1;
      throw new Error("network_failed");
    }
    throw new Error(`unexpected_operation:${args.operationName}`);
  });
  return {
    requestPermissive,
    getReportFetchInvocations: () => reportFetchInvocations,
  };
}

describe("discoverShadowCanaryCandidates providerCalls", () => {
  it("DEFER after initial budget keeps hydration bounded at INITIAL_HYDRATION_BUDGET", async () => {
    const stubCount = MAX_COVERAGE_AWARE_HYDRATION_REPORTS + 3;
    const stubs = Array.from({ length: stubCount }, (_, i) =>
      fightUnknownStub(`THROW${i + 1}`, 1_000_000 - i),
    );
    const { requestPermissive, getReportFetchInvocations } = zoneAndThrowingHydration();
    const container = mockContainer(requestPermissive, stubs);

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
      evaluateIncrementalAdmission: () => ({
        allow: false,
        action: "DEFER",
        reasons: ["test_defer"],
        projectedIncrementalPoints: INCREMENTAL_HYDRATION_BATCH_SIZE * 3,
      }),
    });

    const hydration = result.diagnostics.hydration;
    expect(hydration).not.toBeNull();
    expect(hydration!.reportFetchAttempts).toBe(INITIAL_HYDRATION_BUDGET);
    expect(getReportFetchInvocations()).toBe(INITIAL_HYDRATION_BUDGET);
    expect(result.diagnostics.iterativeHydration?.terminalHydrationReason).toBe(
      "rate_admission_defer",
    );
    // zone catalog + discoverCharacter (0 GraphQL via mock) + hydration attempts
    expect(result.diagnostics.providerCalls).toBe(1 + INITIAL_HYDRATION_BUDGET);
    expect(result.diagnostics.providerCallBreakdown).toEqual({
      zoneCatalog: 1,
      characterDiscovery: 0,
      reportHydration: INITIAL_HYDRATION_BUDGET,
    });
    expect(getReportFetchInvocations()).toBeLessThan(stubCount);
  });

  it("OK admission exhausts remaining stubs past the initial 24 when coverage fails", async () => {
    const stubCount = MAX_COVERAGE_AWARE_HYDRATION_REPORTS + 3;
    const stubs = Array.from({ length: stubCount }, (_, i) =>
      fightUnknownStub(`THROW${i + 1}`, 1_000_000 - i),
    );
    const { requestPermissive, getReportFetchInvocations } = zoneAndThrowingHydration();
    const container = mockContainer(requestPermissive, stubs);

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
      evaluateIncrementalAdmission: () => ({
        allow: true,
        action: "OK",
        reasons: ["ok"],
        projectedIncrementalPoints: INCREMENTAL_HYDRATION_BATCH_SIZE * 3,
      }),
    });

    expect(getReportFetchInvocations()).toBe(stubCount);
    expect(result.diagnostics.iterativeHydration?.terminalHydrationReason).toBe(
      "reports_exhausted",
    );
    expect(result.diagnostics.iterativeHydration?.incrementalBatchCount).toBeGreaterThan(0);
    expect(result.diagnostics.providerCalls).toBe(1 + stubCount);
  });

  it("skips mass hydration when encounterRankings already provide full timed coverage", async () => {
    const ACTIVE = [
      "skyreach",
      "windrunner-spire",
    ];
    const timedCandidates = ACTIVE.flatMap((slug, di) =>
      [1, 2].map((fi) => ({
        reportCode: `ER${di}${fi}`,
        fightId: fi,
        dungeonSlug: slug,
        keyLevel: 10 + fi,
        timed: true,
        incompleteness: { fightUnknown: false },
        source: "encounterRankings",
      })),
    );
    const requestPermissive = vi.fn(async () => {
      throw new Error("unexpected_hydration_call");
    });
    const container = mockContainer(requestPermissive, timedCandidates);
    container.prisma.seasonDungeon.findMany = vi.fn(async () =>
      ACTIVE.map((slug, i) => ({
        dungeon: {
          slug,
          wclZoneOrEncounterId: BigInt(12_532 + i),
        },
      })),
    );

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
      activeDungeonSlugs: ACTIVE,
      activeDungeonEncounters: ACTIVE.map((slug, i) => ({
        dungeonSlug: slug,
        encounterId: 12_532 + i,
      })),
      dungeonPoolSource: "season_dungeon_bindings",
    });

    expect(result.diagnostics.discoveryStrategy).toBe("encounter_rankings");
    expect(result.diagnostics.iterativeHydration).toBeNull();
    expect(result.diagnostics.reportsListed).toBe(0);
    expect(result.diagnostics.reportsHydrated).toBe(0);
    expect(result.diagnostics.unhydratedReportCount).toBe(0);
    expect(requestPermissive).not.toHaveBeenCalled();
    expect(result.candidates.length).toBeGreaterThanOrEqual(4);
  });
});
