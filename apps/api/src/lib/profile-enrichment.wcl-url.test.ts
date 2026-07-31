import { describe, expect, it } from "vitest";
import {
  sanitizeWarcraftLogsUrl,
  WARCRAFT_LOGS_URL_HOSTNAMES,
} from "@mplus/contracts";
import {
  attachWclUrlsToPerformanceSummary,
  resolveWclUrlFromSources,
} from "./profile-enrichment.js";
import type { PerformanceSummaryDTO } from "@mplus/contracts";

describe("sanitizeWarcraftLogsUrl", () => {
  it("accepts approved HTTPS Warcraft Logs hostnames", () => {
    expect(sanitizeWarcraftLogsUrl("https://www.warcraftlogs.com/reports/ABC?fight=1")).toBe(
      "https://www.warcraftlogs.com/reports/ABC?fight=1",
    );
    expect(sanitizeWarcraftLogsUrl("https://warcraftlogs.com/reports/ABC")).toContain(
      "warcraftlogs.com",
    );
    expect(WARCRAFT_LOGS_URL_HOSTNAMES).toEqual(["www.warcraftlogs.com", "warcraftlogs.com"]);
  });

  it("rejects missing, malformed, non-HTTPS, unrelated, and deceptive hosts", () => {
    expect(sanitizeWarcraftLogsUrl(null)).toBeNull();
    expect(sanitizeWarcraftLogsUrl("")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("not a url")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("http://www.warcraftlogs.com/reports/ABC")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("https://evil.example/reports/ABC")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("https://warcraftlogs.com.attacker.example/x")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("data:text/html,hi")).toBeNull();
    expect(sanitizeWarcraftLogsUrl("https://user:pass@www.warcraftlogs.com/reports/ABC")).toBeNull();
  });
});

describe("WCL URL enrichment", () => {
  it("resolves only allowlisted WARCRAFT_LOGS source URLs", () => {
    expect(
      resolveWclUrlFromSources([
        { provider: "RAIDER_IO", externalUrl: "https://raider.io/x" },
        { provider: "WARCRAFT_LOGS", externalUrl: "https://www.warcraftlogs.com/reports/ABC?fight=1" },
      ]),
    ).toBe("https://www.warcraftlogs.com/reports/ABC?fight=1");

    expect(
      resolveWclUrlFromSources([
        { provider: "WARCRAFT_LOGS", externalUrl: "https://warcraftlogs.com.attacker.example/x" },
      ]),
    ).toBeNull();
  });

  it("attaches urls onto performance explanatory runs without inventing missing ones", () => {
    const summary = {
      currentSeason: {
        peakScore: 1,
        consistencyScore: 1,
        score: 1,
        confidence: 1,
        dungeonCount: 1,
        expectedDungeonCount: 8,
        latestObservedAt: null,
        dungeons: [
          {
            dungeonSlug: "a",
            dungeonName: "A",
            bestParsePercentile: 90,
            medianParsePercentile: 80,
            loggedRunCount: 1,
            bestRun: {
              runId: "run-1",
              kind: "BOTH",
              dungeonSlug: "a",
              dungeonName: "A",
              keyLevel: 10,
              completedAt: "2026-01-01T00:00:00.000Z",
              timed: true,
              parsePercentile: 90,
              scoreValue: 100,
            },
            latestRun: {
              runId: "run-1",
              kind: "BOTH",
              dungeonSlug: "a",
              dungeonName: "A",
              keyLevel: 10,
              completedAt: "2026-01-01T00:00:00.000Z",
              timed: true,
              parsePercentile: 90,
              scoreValue: 100,
            },
          },
        ],
      },
      historical: null,
    } satisfies PerformanceSummaryDTO;

    const attached = attachWclUrlsToPerformanceSummary(summary, {
      "run-1": "https://www.warcraftlogs.com/reports/XYZ?fight=3",
    });
    expect(attached?.currentSeason.dungeons[0]?.bestRun?.wclUrl).toBe(
      "https://www.warcraftlogs.com/reports/XYZ?fight=3",
    );

    const missing = attachWclUrlsToPerformanceSummary(summary, {});
    expect(missing?.currentSeason.dungeons[0]?.bestRun?.wclUrl).toBeNull();
  });
});
