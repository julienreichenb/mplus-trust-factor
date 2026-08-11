/**
 * Shadow Canary discovery must use dungeon-first encounterRankings only.
 * Scoring discovery never lists character recentReports or opens reports for discovery.
 */
import { describe, expect, it, vi } from "vitest";
import { OPERATIONS } from "@mplus/provider-warcraftlogs";
import { discoverShadowCanaryCandidates } from "./discover.js";

const SEASON_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ID = "22222222-2222-4222-8222-222222222222";
const CHARACTER_ID = "33333333-3333-4333-8333-333333333333";

const ACTIVE = ["skyreach", "windrunner-spire"] as const;

function encounterCandidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  keyLevel: number,
  overrides?: Partial<{ timed: boolean; source: string }>,
) {
  return {
    reportCode,
    fightId,
    dungeonSlug,
    keyLevel,
    timed: overrides?.timed ?? true,
    source: overrides?.source ?? "encounterRankings",
  };
}

function invalidFightStub(reportCode: string, startTime: number) {
  return {
    reportCode,
    fightId: 0,
    startTime,
    source: "encounterRankings",
    dungeonSlug: "skyreach",
    keyLevel: 10,
    timed: true,
  };
}

function mockContainer(
  requestPermissive: ReturnType<typeof vi.fn>,
  discoveryCandidates: unknown[],
  rankings: unknown[] = [],
) {
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
        findMany: vi.fn(async () =>
          ACTIVE.map((slug, i) => ({
            dungeon: {
              slug,
              wclZoneOrEncounterId: BigInt(12_532 + i),
            },
          })),
        ),
      },
    },
    repositories: {
      score: {
        getActiveModel: vi.fn(async () => ({ id: MODEL_ID })),
      },
    },
    providers: {
      warcraftlogs: {
        discoverCharacter: vi.fn(async () => ({
          candidates: discoveryCandidates,
          rankings,
        })),
        getGraphQlClient: () => ({
          request: requestPermissive,
          requestPermissive,
        }),
      },
    },
  };
}

describe("discoverShadowCanaryCandidates dungeon-first providerCalls", () => {
  it("never issues ReportWithFightAndMasterData during discovery", async () => {
    const timedCandidates = ACTIVE.flatMap((slug, di) =>
      [1, 2].map((fi) => encounterCandidate(slug, `ER${di}${fi}`, fi, 10 + fi)),
    );
    const requestPermissive = vi.fn(async (args: { operationName: string }) => {
      if (args.operationName === OPERATIONS.ReportWithFightAndMasterData.operationName) {
        throw new Error("unexpected_selected_report_fetch_during_discovery");
      }
      throw new Error(`unexpected_operation:${args.operationName}`);
    });
    const container = mockContainer(requestPermissive, timedCandidates);

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
      activeDungeonSlugs: [...ACTIVE],
      activeDungeonEncounters: ACTIVE.map((slug, i) => ({
        dungeonSlug: slug,
        encounterId: 12_532 + i,
      })),
      dungeonPoolSource: "season_dungeon_bindings",
    });

    expect(result.diagnostics.discoveryStrategy).toBe("encounter_rankings");
    expect(result.diagnostics.providerCallBreakdown).toEqual({
      zoneCatalog: 0,
      characterDiscovery: 0,
    });
    expect(requestPermissive).not.toHaveBeenCalled();
    expect(result.candidates.length).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.candidateNormalization.total).toBe(timedCandidates.length);
  });

  it("ignores invalid fightId<=0 candidates and does not open reports", async () => {
    const stubCount = 30;
    const stubs = Array.from({ length: stubCount }, (_, i) =>
      invalidFightStub(`STUB${i + 1}`, 1_000_000 - i),
    );
    let reportFetchInvocations = 0;
    const requestPermissive = vi.fn(async (args: { operationName: string }) => {
      if (args.operationName === OPERATIONS.ReportWithFightAndMasterData.operationName) {
        reportFetchInvocations += 1;
        throw new Error("network_failed");
      }
      throw new Error(`unexpected_operation:${args.operationName}`);
    });
    const container = mockContainer(requestPermissive, stubs);

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
      activeDungeonSlugs: [...ACTIVE],
      activeDungeonEncounters: ACTIVE.map((slug, i) => ({
        dungeonSlug: slug,
        encounterId: 12_532 + i,
      })),
      dungeonPoolSource: "season_dungeon_bindings",
    });

    expect(reportFetchInvocations).toBe(0);
    expect(requestPermissive).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.candidateNormalization.invalidFightId).toBe(stubCount);
    expect(result.diagnostics.discoveryStrategy).toBe("encounter_rankings");
  });

  it("under-covered dungeon leaves empty candidates for missing dungeon", async () => {
    const skyreachOnly = [
      encounterCandidate("skyreach", "SR1", 1, 18),
      encounterCandidate("skyreach", "SR2", 2, 17),
    ];
    const requestPermissive = vi.fn(async () => {
      throw new Error("unexpected_provider_call_during_discovery");
    });
    const container = mockContainer(requestPermissive, skyreachOnly);

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
      activeDungeonSlugs: [...ACTIVE],
      activeDungeonEncounters: ACTIVE.map((slug, i) => ({
        dungeonSlug: slug,
        encounterId: 12_532 + i,
      })),
      dungeonPoolSource: "season_dungeon_bindings",
    });

    expect(requestPermissive).not.toHaveBeenCalled();
    expect(result.candidates.filter((c) => c.dungeonSlug === "skyreach")).toHaveLength(2);
    expect(result.candidates.filter((c) => c.dungeonSlug === "windrunner-spire")).toHaveLength(0);
    expect(result.diagnostics.candidateNormalization.byDungeonSlug["skyreach"]).toBe(2);
    expect(
      result.diagnostics.candidateNormalization.byDungeonSlug["windrunner-spire"],
    ).toBeUndefined();
  });
});
