/**
 * Gate A.1 regressions: match acceptance, empty dungeon, call accounting, clean smoke import.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIDNIGHT_S1_SEASON } from "@mplus/mechanics";
import { selectScoringRuns, type SelectableScoringRun } from "@mplus/scoring";
import {
  isAcceptedWclMatchForAnalysis,
  isDungeonSlugUnknown,
  matchRunCandidate,
} from "./discovery/run-matching.js";
import { reportCodeFingerprint } from "./smoke/sanitize.js";
import { WclGraphQlClient } from "./client/graphql-client.js";
import type { WclRunCandidate } from "./types.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

function baseCandidate(overrides: Partial<WclRunCandidate> = {}): WclRunCandidate {
  return {
    reportCode: "7PajSkyreach6KAc",
    fightId: 1,
    encounterId: 1201,
    zoneId: 47,
    dungeonSlug: "skyreach",
    seasonSlug: null,
    keyLevel: 22,
    score: null,
    startTimeMs: 1000,
    completedAt: "2026-07-11T16:39:44.544Z",
    durationMs: 1_551_218,
    timed: null,
    selectionTags: [],
    source: "recentReports",
    matchConfidence: null,
    incompleteness: {
      dungeonUnknown: false,
      seasonUnknown: true,
      timedUnknown: true,
      keyLevelUnknown: false,
      rosterIncomplete: true,
      fightUnknown: false,
    },
    warnings: [],
    ...overrides,
  };
}

describe("Gate A.1 foundation regressions", () => {
  it("propagates accepted match identity onto ScoringRunSelection", () => {
    const match = matchRunCandidate(
      baseCandidate(),
      {
        dungeonSlug: "skyreach",
        keyLevel: 22,
        completedAt: "2026-07-11T16:39:43.000Z",
        durationMs: 1_557_871,
        participants: [{ realmSlug: "archimonde", name: "Wallidrixe" }],
      },
      [],
    );
    expect(isAcceptedWclMatchForAnalysis(match)).toBe(true);

    const selectable: SelectableScoringRun = {
      id: "raiderio:skyreach:22:2026-07-11T16:39:43.000Z",
      dungeonSlug: "skyreach",
      seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug,
      keyLevel: 22,
      timed: true,
      completedAt: "2026-07-11T16:39:43.000Z",
      durationMs: 1_557_871,
      raiderIoScore: 300,
      wclReportMatched: true,
      wclCoverageRatio: null,
      wclReportCode: "7PajSkyreach6KAc",
      wclReportFingerprint: reportCodeFingerprint("7PajSkyreach6KAc"),
      wclFightId: 1,
      matchConfidence: match.confidence,
      matchEvidence: {
        dungeonMatch: match.evidence.dungeonMatch,
        keyLevelMatch: match.evidence.keyLevelMatch,
        timeDeltaMs: match.evidence.timeDeltaMs,
        durationDeltaMs: match.evidence.durationDeltaMs,
        rosterOverlapRatio: match.evidence.rosterOverlapRatio,
      },
    };

    const selection = selectScoringRuns({
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: ["skyreach"],
        expectedDungeonCount: 1,
      },
      runs: [selectable],
      observedAt: "2026-07-28T00:00:00.000Z",
    });

    const selected = selection.selectedRuns[0]!;
    expect(selected.wclReportMatched).toBe(true);
    expect(selected.detailAvailable).toBe(true);
    expect(selected.wclFightId).toBe(1);
    expect(selected.wclReportFingerprint).toBe(reportCodeFingerprint("7PajSkyreach6KAc"));
    expect(selected.matchConfidence).toBe("LOW");
    expect(selected.matchEvidence?.timeDeltaMs).toBeLessThan(5_000);
  });

  it("keeps unmatched highest run unavailable (no demotion)", () => {
    const selection = selectScoringRuns({
      season: {
        ...MIDNIGHT_S1_SEASON,
        dungeonSlugs: ["skyreach"],
        expectedDungeonCount: 1,
      },
      runs: [
        {
          id: "highest-unlogged",
          dungeonSlug: "skyreach",
          seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug,
          keyLevel: 22,
          timed: true,
          completedAt: "2026-07-11T16:39:43.000Z",
          durationMs: 1_557_871,
          raiderIoScore: 300,
          wclReportMatched: false,
          wclCoverageRatio: null,
        },
        {
          id: "lower-logged",
          dungeonSlug: "skyreach",
          seasonSlug: MIDNIGHT_S1_SEASON.seasonSlug,
          keyLevel: 18,
          timed: true,
          completedAt: "2026-07-10T12:00:00.000Z",
          durationMs: 1_400_000,
          raiderIoScore: 250,
          wclReportMatched: true,
          wclCoverageRatio: 1,
          wclReportCode: "LowerOnly",
          wclReportFingerprint: reportCodeFingerprint("LowerOnly"),
          wclFightId: 1,
        },
      ],
      observedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(selection.selectedRuns[0]?.canonicalRunId).toBe("highest-unlogged");
    expect(selection.selectedRuns[0]?.wclReportMatched).toBe(false);
    expect(selection.selectedRuns[0]?.detailAvailable).toBe(false);
    expect(selection.selectedRuns[0]?.combatCoverageState).toBe("UNAVAILABLE");
  });

  it("marks empty dungeon slug as unknown", () => {
    expect(isDungeonSlugUnknown("")).toBe(true);
    const match = matchRunCandidate(
      baseCandidate({ dungeonSlug: "", incompleteness: {
        dungeonUnknown: true,
        seasonUnknown: true,
        timedUnknown: true,
        keyLevelUnknown: false,
        rosterIncomplete: true,
        fightUnknown: false,
      }}),
      {
        dungeonSlug: "skyreach",
        keyLevel: 22,
        completedAt: "2026-07-11T16:39:43.000Z",
        durationMs: 1_557_871,
        participants: [],
      },
      [],
    );
    expect(match.evidence.dungeonMatch).toBe(false);
    expect(isAcceptedWclMatchForAnalysis(match)).toBe(false);
  });

  it("instruments GraphQL call counts for metadata and events", async () => {
    const client = new WclGraphQlClient({
      graphqlUrl: "https://example.test/graphql",
      tokenManager: {
        getToken: async () => "token",
      } as never,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    client.resetRequestCount();
    expect(client.getRequestCount()).toBe(0);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    try {
      await client.request({
        operationName: "ReportWithFightAndMasterData",
        query: "query ReportWithFightAndMasterData { __typename }",
      });
      await client.request({
        operationName: "ReportEvents",
        query: "query ReportEvents { __typename }",
      });
      await client.request({
        operationName: "ReportEvents",
        query: "query ReportEvents { __typename }",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(client.getRequestCount()).toBe(3);
    expect(client.getRequestCountsByOperation()).toEqual({
      ReportWithFightAndMasterData: 1,
      ReportEvents: 2,
    });
    client.resetRequestCount();
    expect(client.getRequestCount()).toBe(0);
  });

  it("clean-checkout smoke can resolve database via dist or source entry", () => {
    const smoke = readFileSync(
      resolve(root, "packages/providers/warcraftlogs/src/smoke-live.ts"),
      "utf8",
    );
    expect(smoke).toContain("packages/database/src/index.ts");
    expect(smoke).toContain("loadCreatePrismaClient");

    const launcher = readFileSync(resolve(root, "tools/scripts/live-smoke-wcl.mjs"), "utf8");
    expect(launcher).toContain('@mplus/database');
    expect(launcher).toContain("packages/database/dist/index.js");

    const dist = resolve(root, "packages/database/dist/index.js");
    const src = resolve(root, "packages/database/src/index.ts");
    expect(existsSync(src) || existsSync(dist)).toBe(true);
  });
});
