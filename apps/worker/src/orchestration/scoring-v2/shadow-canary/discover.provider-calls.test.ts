/**
 * Shadow Canary discovery providerCalls must match hydration fetch attempts,
 * including when requestPermissive throws.
 */
import { describe, expect, it, vi } from "vitest";
import {
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

describe("discoverShadowCanaryCandidates providerCalls", () => {
  it("counts thrown hydration requestPermissive calls once each and stays bounded", async () => {
    // More stubs than the coverage-aware budget so the attempt cap is exercised.
    const stubCount = MAX_COVERAGE_AWARE_HYDRATION_REPORTS + 3;
    const stubs = Array.from({ length: stubCount }, (_, i) =>
      fightUnknownStub(`THROW${i + 1}`, 1_000_000 - i),
    );

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

    const container = {
      env: { APP_ENV: "test" },
      prisma: {
        season: {
          findFirst: vi.fn(async () => ({
            id: SEASON_ID,
            slug: "blizzard-season-13",
            isCurrent: true,
          })),
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
          getGraphQlClient: () => ({ requestPermissive }),
        },
      },
    };

    const result = await discoverShadowCanaryCandidates({
      container: container as never,
      region: "EU",
      realmSlug: "archimonde",
      characterName: "Wallidrixe",
      characterId: CHARACTER_ID,
    });

    const hydration = result.diagnostics.hydration;
    expect(hydration).not.toBeNull();
    expect(hydration!.reportFetchAttempts).toBe(MAX_COVERAGE_AWARE_HYDRATION_REPORTS);
    expect(hydration!.reportsFailedOrEmpty).toBe(MAX_COVERAGE_AWARE_HYDRATION_REPORTS);
    expect(hydration!.stopReason).toBe("budget_exhausted");
    expect(reportFetchInvocations).toBe(MAX_COVERAGE_AWARE_HYDRATION_REPORTS);

    // zone (1) + discoverCharacter flat charge (5) + one per hydration attempt
    expect(result.diagnostics.providerCalls).toBe(
      1 + 5 + hydration!.reportFetchAttempts,
    );
    expect(result.diagnostics.providerCalls).toBe(
      1 + 5 + MAX_COVERAGE_AWARE_HYDRATION_REPORTS,
    );

    // Strict bound: never more report GraphQL calls than maxReports.
    expect(reportFetchInvocations).toBeLessThanOrEqual(MAX_COVERAGE_AWARE_HYDRATION_REPORTS);
    expect(reportFetchInvocations).toBeLessThan(stubCount);
  });
});
