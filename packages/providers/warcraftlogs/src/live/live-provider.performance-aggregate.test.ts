/**
 * Dedicated fetchCharacterPerformanceAggregate — Test A.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveWarcraftLogsProvider } from "./live-provider.js";
import { OPERATIONS } from "../operations/queries.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const wallidrixePadPath = resolve(
  root,
  "tools/fixtures/warcraftlogs/wallidrixe-points-and-damage.json",
);

describe("LiveWarcraftLogsProvider.fetchCharacterPerformanceAggregate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues only CharacterZoneRankingsPointsAndDamage and adapts OK", async () => {
    const fixture = JSON.parse(readFileSync(wallidrixePadPath, "utf8")) as {
      rawZoneRankingsPointsAndDamage: unknown;
    };

    const provider = new LiveWarcraftLogsProvider({
      env: {
        WCL_CLIENT_ID: "test-client",
        WCL_CLIENT_SECRET: "test-secret",
        WCL_PUBLIC_GRAPHQL_URL: "https://example.test/graphql",
        WCL_TOKEN_URL: "https://example.test/token",
        WCL_RATE_WARN_PERCENT: 70,
        WCL_RATE_DEFER_PERCENT: 80,
        WCL_RATE_STOP_PERCENT: 90,
        WCL_CHARACTER_TTL_SECONDS: 43_200,
      },
      zoneId: 47,
      processEnv: { WCL_MPLUS_ZONE_ID: "47" },
    });

    const request = vi.fn(async (args: { operationName: string }) => {
      if (args.operationName === "RateLimitData") {
        return {
          response: {
            data: {
              rateLimitData: {
                limitPerHour: 3600,
                pointsSpentThisHour: 0,
                pointsResetIn: 3600,
              },
            },
            errors: undefined,
          },
          cost: null,
        };
      }
      expect(args.operationName).toBe(
        OPERATIONS.CharacterZoneRankingsPointsAndDamage.operationName,
      );
      return {
        response: {
          data: {
            characterData: {
              character: {
                zoneRankings: fixture.rawZoneRankingsPointsAndDamage,
              },
            },
          },
          errors: undefined,
        },
        cost: null,
      };
    });
    vi.spyOn(provider.getGraphQlClient(), "request").mockImplementation(
      request as never,
    );

    const result = await provider.fetchCharacterPerformanceAggregate({
      character: {
        name: "Wallidrixe",
        realmSlug: "archimonde",
        region: "EU",
      },
      zoneId: 47,
      partition: null,
      ctx: {
        region: "EU",
        now: "2026-08-06T12:00:00.000Z",
        requestId: "test-a",
        correlationId: "test-a",
        forceRefresh: false,
        targetCharacter: {
          name: "Wallidrixe",
          realmSlug: "archimonde",
          region: "EU",
        },
      },
    });

    const padCalls = request.mock.calls.filter(
      (c) =>
        (c[0] as { operationName: string }).operationName ===
        "CharacterZoneRankingsPointsAndDamage",
    );
    expect(padCalls).toHaveLength(1);
    const called = padCalls[0]?.[0] as { operationName: string; query: string };
    expect(called.query).not.toMatch(/recentReports/i);
    expect(called.query).not.toMatch(/metric:\s*dps/i);
    expect(called.query).not.toMatch(/events\(/i);
    expect(called.query).not.toMatch(/ReportWithFight/i);

    expect(result.record.state).toBe("OK");
    expect(result.rawPayload).toEqual(fixture.rawZoneRankingsPointsAndDamage);
    expect(result.record.dungeonAggregates.length).toBeGreaterThan(0);
    expect(result.sourceRequestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
