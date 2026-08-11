import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraphQlFingerprint, hashGraphQlBody } from "./client/fingerprint.js";
import { WclTokenManager } from "./client/token-manager.js";
import { FixtureWarcraftLogsProvider } from "./fixture/fixture-provider.js";
import { loadFixtureScenario } from "./fixture/loader.js";
import {
  dedupeCandidates,
  matchRunCandidate,
  resolveActorSourceId,
  resolveActorSourceIdStrict,
  selectLatestAndHighest,
  buildActorMap,
} from "./discovery/run-matching.js";
import {
    rankingsToCandidates,
  mythicRunPlaceholders,
  deriveVisibility,
  deriveWclProvenance,
    mapZoneRankings,
  countParseStyleRankingRows,
} from "./discovery/run-discovery.js";
import { MAX_EVENT_PAGES, TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON } from "./discovery/bounds.js";
import {
  resolveMplusZoneConfig,
  shouldQueryZoneRankings,
  MPLUS_ZONE_ENV,
} from "./discovery/mplus-zone.js";
import { ReportRevisionCache } from "./analysis/revision-cache.js";
import { evaluateRateBudget, parseRateLimitSnapshot, shouldDeferExpensiveWork } from "./rate/rate-budget.js";
import { parseWithSchema, characterResolveSchema } from "./client/graphql-client.js";
import { isUnavailableEvidenceError, mapGraphQlErrors } from "./client/errors.js";
import { OPERATIONS } from "./operations/queries.js";
import type { WclRunCandidate } from "./types.js";
import {
  assertWorkerWclPath,
  rejectionReasonFromMatch,
  sanitizeReportCode,
  sanitizeReportRef,
  WORKER_WCL_REQUIRED_CALLS,
} from "./smoke/sanitize.js";
import { candidatesFromMappedReport } from "./discovery/report-fight-mapping.js";

const ctx = {
  region: "EU" as const,
  requestId: "test-req",
  correlationId: null,
  forceRefresh: false,
  now: new Date().toISOString(),
  targetCharacter: {
    region: "EU" as const,
    realmSlug: "tarren-mill",
    name: "Fixtureplayer",
  },
};

function baseCandidate(overrides: Partial<WclRunCandidate> = {}): WclRunCandidate {
  return {
    reportCode: "AbCdEf12XyZ3",
    fightId: 3,
    encounterId: 1201,
    zoneId: 45,
    dungeonSlug: "ara-kara-city-of-echoes",
    seasonSlug: null,
    keyLevel: 12,
    score: 385,
    startTimeMs: 120000,
    completedAt: "2025-06-27T10:02:00.000Z",
    durationMs: 1823456,
    timed: null,
    selectionTags: [],
    source: "zoneRankings",
    matchConfidence: null,
    incompleteness: {
      dungeonUnknown: false,
      seasonUnknown: true,
      timedUnknown: true,
      keyLevelUnknown: false,
      rosterIncomplete: true,
    },
    warnings: [],
    ...overrides,
  };
}

describe("WclTokenManager", () => {
  it("deduplicates concurrent token refresh", async () => {
    const fetchToken = vi.fn(async () => ({
      accessToken: "token-abc",
      expiresAtMs: Date.now() + 3600_000,
    }));
    const manager = new WclTokenManager(
      { clientId: "id", clientSecret: "secret", tokenUrl: "https://example.com/token" },
      fetchToken,
    );

    const [a, b] = await Promise.all([manager.getToken(), manager.getToken()]);
    expect(a).toBe("token-abc");
    expect(b).toBe("token-abc");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes token after expiry", async () => {
    let call = 0;
    const fetchToken = vi.fn(async () => {
      call += 1;
      return {
        accessToken: `token-${call}`,
        expiresAtMs: call === 1 ? Date.now() + 1000 : Date.now() + 3600_000,
      };
    });
    const manager = new WclTokenManager(
      { clientId: "id", clientSecret: "secret", tokenUrl: "https://example.com/token", expirySafetyMarginMs: 5000 },
      fetchToken,
    );

    expect(await manager.getToken()).toBe("token-1");
    await new Promise((r) => setTimeout(r, 1100));
    expect(await manager.getToken()).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});

describe("GraphQL fingerprint", () => {
  it("is stable for canonical variable ordering", () => {
    const a = buildGraphQlFingerprint({
      region: "EU",
      operationName: "ResolveCharacter",
      variables: { name: "Test", serverSlug: "tarren-mill", serverRegion: "EU" },
    });
    const b = buildGraphQlFingerprint({
      region: "EU",
      operationName: "ResolveCharacter",
      variables: { serverRegion: "EU", serverSlug: "tarren-mill", name: "Test" },
    });
    expect(a).toBe(b);
  });

  it("hashes body with operation name", () => {
    const hash = hashGraphQlBody("RateLimitData", {});
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Run matching", () => {
  const candidate = baseCandidate();

  it("returns HIGH confidence for strong matches", () => {
    const result = matchRunCandidate(
      candidate,
      {
        dungeonSlug: "ara-kara-city-of-echoes",
        keyLevel: 12,
        completedAt: "2025-06-27T10:02:00.000Z",
        durationMs: 1823456,
        participants: [
          { realmSlug: "tarren-mill", name: "Fixtureplayer" },
          { realmSlug: "tarren-mill", name: "Healerone" },
        ],
      },
      [
        { realmSlug: "tarren-mill", name: "Fixtureplayer" },
        { realmSlug: "tarren-mill", name: "Healerone" },
      ],
    );
    expect(result.confidence).toBe("HIGH");
    expect(result.autoMergeAllowed).toBe(true);
  });

  it("returns LOW confidence when only dungeon and key match", () => {
    const result = matchRunCandidate(
      candidate,
      {
        dungeonSlug: "ara-kara-city-of-echoes",
        keyLevel: 12,
        completedAt: "2025-01-01T00:00:00.000Z",
        durationMs: 999999,
        participants: [],
      },
      [],
    );
    expect(result.confidence).toBe("LOW");
    expect(result.autoMergeAllowed).toBe(false);
  });
});

describe("Actor resolution", () => {
  it("resolves player actor by name and realm", () => {
    const map = buildActorMap([
      { id: 1, name: "Fixtureplayer", type: "Player", server: "Tarren Mill" },
      { id: 2, name: "Trash Mob", type: "NPC", server: null },
    ]);
    expect(resolveActorSourceId(map, "Fixtureplayer", "tarren-mill")).toBe(1);
  });

  it("fails safely on ambiguous same-name players", () => {
    const map = buildActorMap([
      { id: 1, name: "Twinplayer", type: "Player", server: "Tarren Mill" },
      { id: 2, name: "Twinplayer", type: "Player", server: "Tarren Mill" },
    ]);
    expect(resolveActorSourceId(map, "Twinplayer", "tarren-mill")).toBeNull();
    const strict = resolveActorSourceIdStrict(map, "Twinplayer", "tarren-mill");
    expect("error" in strict && strict.error).toBe("AMBIGUOUS");
  });
});

describe("Latest/highest selection", () => {
  it("tags same run as LATEST and HIGHEST", () => {
    const candidates: WclRunCandidate[] = [
      baseCandidate({
        reportCode: "SameRun001",
        fightId: 1,
        encounterId: 1207,
        dungeonSlug: "the-dawnbreaker",
        keyLevel: 14,
        score: 410,
        startTimeMs: 80000,
        completedAt: "2025-06-27T12:00:00.000Z",
        durationMs: 1700000,
      }),
    ];
    const deduped = dedupeCandidates(candidates);
    const { latest, highest } = selectLatestAndHighest(deduped);
    expect(latest?.reportCode).toBe("SameRun001");
    expect(highest?.reportCode).toBe("SameRun001");
    expect(latest?.selectionTags).toContain("LATEST");
    expect(latest?.selectionTags).toContain("HIGHEST");
  });
});

describe("Revision cache", () => {
  it("invalidates analysis when revision changes", () => {
    const cache = new ReportRevisionCache();
    cache.setRevision("AbCdEf12XyZ3", 3);
    cache.markAnalysis("AbCdEf12XyZ3", 1, 3, "v1");
    expect(cache.hasAnalysis("AbCdEf12XyZ3", 1, 3, "v1")).toBe(true);

    cache.setRevision("AbCdEf12XyZ3", 4);
    expect(cache.hasAnalysis("AbCdEf12XyZ3", 1, 3, "v1")).toBe(false);
    expect(cache.getRevision("AbCdEf12XyZ3")).toBe(4);
  });
});

describe("Rate budget", () => {
  it("defers when above 80% utilization", () => {
    const snapshot = parseRateLimitSnapshot({
      limitPerHour: 3600,
      pointsSpentThisHour: 2900,
      pointsResetIn: 600,
    });
    const decision = evaluateRateBudget(snapshot, { warnPercent: 70, deferPercent: 80, stopPercent: 90 });
    expect(decision.action).toBe("DEFER");
    expect(shouldDeferExpensiveWork(decision)).toBe(true);
  });

  it("stops when above 90% utilization", () => {
    const fixture = loadFixtureScenario("rate-limit-near-stop");
    const raw = (fixture.rateLimitData as { data: { rateLimitData: { limitPerHour: number; pointsSpentThisHour: number; resetInSeconds: number } } }).data.rateLimitData;
    const snapshot = parseRateLimitSnapshot(raw);
    const decision = evaluateRateBudget(snapshot, { warnPercent: 70, deferPercent: 80, stopPercent: 90 });
    expect(decision.action).toBe("STOP");
  });

  it("derives pointsRemaining from live schema fields (pointsResetIn)", () => {
    const snapshot = parseRateLimitSnapshot({
      limitPerHour: 3600,
      pointsSpentThisHour: 120,
      pointsResetIn: 2400,
    });
    expect(snapshot.pointsRemaining).toBe(3480);
    expect(snapshot.resetAt).toBeTruthy();
  });
});

describe("RateLimitData live GraphQL selection", () => {
  const LIVE_FIELDS = ["limitPerHour", "pointsSpentThisHour", "pointsResetIn"] as const;
  const STALE_FIELDS = ["pointsRemaining", "resetInSeconds"] as const;

  function assertLiveRateLimitSelection(querySource: string): void {
    for (const field of LIVE_FIELDS) {
      expect(querySource).toMatch(new RegExp(`\\b${field}\\b`));
    }
    for (const field of STALE_FIELDS) {
      expect(querySource).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  }

  it("OPERATIONS.RateLimitData matches the current live schema fields", () => {
    assertLiveRateLimitSelection(OPERATIONS.RateLimitData.query);
  });

  it("CharacterZoneRankings requests JSON scalar without subselection", () => {
    expect(OPERATIONS.CharacterZoneRankings.query).toMatch(
      /zoneRankings\([^)]*\)\s*(?!\{)/,
    );
    expect(OPERATIONS.CharacterZoneRankings.query).not.toMatch(
      /zoneRankings\([^)]*\)\s*\{/,
    );
  });

  it("all production GraphQL documents avoid bare faction and friendlyPlayers object subselection", () => {
    for (const [name, op] of Object.entries(OPERATIONS)) {
      expect(op.query, name).not.toMatch(/\bfaction\b(?!\s*\{)/);
      expect(op.query, name).not.toMatch(/friendlyPlayers\s*\{/);
    }
    expect(OPERATIONS.ResolveCharacter.query).not.toMatch(/\bfaction\b/);
    expect(OPERATIONS.ReportWithFightAndMasterData.query).toMatch(/\bfriendlyPlayers\b/);
  });

  it("live-smoke-wcl.mjs rateLimitData selection matches OPERATIONS (no stale fields)", () => {
    const smokePath = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../../tools/scripts/live-smoke-wcl.mjs",
    );
    const smokeSource = readFileSync(smokePath, "utf8");
    const rateLimitBlock = smokeSource.match(/rateLimitData\s*\{[^}]+\}/);
    expect(rateLimitBlock?.[0]).toBeTruthy();
    assertLiveRateLimitSelection(rateLimitBlock![0]!);
    assertLiveRateLimitSelection(OPERATIONS.RateLimitData.query);

    // Smoke and provider operation must request the same live fields.
    for (const field of LIVE_FIELDS) {
      expect(rateLimitBlock![0]).toContain(field);
      expect(OPERATIONS.RateLimitData.query).toContain(field);
    }
  });
});

describe("Deep smoke sanitization + worker path", () => {
  it("masks report codes and fingerprints without leaking full codes", () => {
    const code = "AbCdEfGhIjKl";
    const ref = sanitizeReportRef(code);
    expect(ref.maskedCode).toBe(sanitizeReportCode(code));
    expect(ref.maskedCode).not.toBe(code);
    expect(ref.maskedCode).toContain("****");
    expect(ref.fingerprint).toHaveLength(12);
    expect(ref.fingerprint).not.toContain(code);
  });

  it("ignores aggregate zoneRankings rows without report/fightID", () => {
    const payload = {
      metric: "playerscore",
      zone: 47,
      rankings: [
        { encounter: { id: 1 }, rankPercent: 90, bestAmount: 12 },
        {
          report: { code: "AbCdEf12XyZ3", startTime: 1 },
          fightID: 3,
          encounterID: 1201,
          bracket: 12,
          score: 100,
        },
      ],
    };
    expect(countParseStyleRankingRows(payload)).toEqual({ totalRows: 2, parseRows: 1 });
    const mapped = mapZoneRankings(payload, 47);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.reportCode).toBe("AbCdEf12XyZ3");
    expect(mapped[0]?.fightId).toBe(3);
    expect(mapped[0]?.zoneId).toBe(47);
  });

  it("maps aggregate zoneRankings rows to dungeon best/median percentiles", async () => {
    const { mapZoneRankingAggregates } = await import("./discovery/zone-ranking-aggregates.js");
    const payload = {
      metric: "playerscore",
      zone: 47,
      partition: 1,
      bestPerformanceAverage: 80,
      medianPerformanceAverage: 75,
      rankings: [
        {
          encounter: { id: 99, name: "Skyreach" },
          rankPercent: 98,
          medianPercent: 98,
          totalKills: 6,
          spec: "Affliction",
        },
        {
          encounter: { id: 100, name: "Pit of Saron" },
          rankPercent: 95,
          medianPercent: 75,
          totalKills: 20,
        },
        {
          report: { code: "ParseOnly", startTime: 1 },
          fightID: 1,
          encounterID: 1201,
          amount: 1,
          total: 1,
        },
      ],
    };
    const mapped = mapZoneRankingAggregates(payload);
    expect(mapped.dungeons).toHaveLength(2);
    expect(mapped.dungeons.find((d) => d.dungeonSlug === "skyreach")?.bestParsePercentile).toBe(98);
    expect(mapped.dungeons.find((d) => d.dungeonSlug === "pit-of-saron")?.medianParsePercentile).toBe(
      75,
    );
  });

  it("explains match rejection reasons without auto-merge", () => {
    expect(
      rejectionReasonFromMatch({
        confidence: "LOW",
        evidence: {
          dungeonMatch: false,
          keyLevelMatch: true,
          timeDeltaMs: 500_000,
          durationDeltaMs: null,
          rosterOverlapRatio: 0.1,
        },
        autoMergeAllowed: false,
        timeToleranceMs: 120_000,
      }),
    ).toContain("dungeon_mismatch_or_unknown");
    expect(
      rejectionReasonFromMatch({
        confidence: "HIGH",
        evidence: {
          dungeonMatch: true,
          keyLevelMatch: true,
          timeDeltaMs: 1_000,
          durationDeltaMs: 1_000,
          rosterOverlapRatio: 1,
        },
        autoMergeAllowed: true,
      }),
    ).toBeNull();
  });

  it("refresh-pipeline uses full WCL discovery + analyze path", () => {
    const pipelinePath = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../../apps/worker/src/orchestration/refresh-pipeline.ts",
    );
    const source = readFileSync(pipelinePath, "utf8");
    expect(assertWorkerWclPath(source)).toEqual([]);
    for (const call of WORKER_WCL_REQUIRED_CALLS) {
      expect(source).toContain(call);
    }
    // Must not stop at summary-only enrichment.
    expect(source).toMatch(/discoverCharacterSummary[\s\S]*discoverCharacterRuns/);
    expect(source).toContain("getReportFightDetails");
  });
});

describe("M+ zone configuration", () => {
  it("requires explicit zone ID outside fixture mode", () => {
    expect(() =>
      resolveMplusZoneConfig({ env: {}, allowFixtureDefault: false }),
    ).toThrow(/WCL_MPLUS_ZONE_ID/);
  });

  it("warns when zone is past expiry and skips rankings", () => {
    const config = resolveMplusZoneConfig({
      zoneId: 45,
      expiresAt: "2020-01-01T00:00:00.000Z",
      now: new Date("2026-07-27T00:00:00.000Z"),
    });
    expect(config.expired).toBe(true);
    expect(config.warning).toMatch(/expired/);
    expect(shouldQueryZoneRankings(config)).toBe(false);
  });

  it("warns when expiry env is unset", () => {
    const config = resolveMplusZoneConfig({
      env: { [MPLUS_ZONE_ENV.zoneId]: "45" },
      now: new Date("2026-07-27T00:00:00.000Z"),
    });
    expect(config.zoneId).toBe(45);
    expect(config.expired).toBe(false);
    expect(config.warning).toMatch(/expires/i);
  });
});

describe("Discovery bounds and placeholders", () => {
  it.skip("documents candidate cap and event page bound", () => {
    expect(TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON).toBe(2);
    expect(MAX_EVENT_PAGES).toBeLessThanOrEqual(10);
  });

  it("never claims timed=true without evidence", () => {
    const placeholders = mythicRunPlaceholders(baseCandidate({ timed: null }));
    expect(placeholders.timed).toBe(false);
    expect(placeholders.seasonSlug).toBe("unknown");
  });

  it("documents top-2 eligible candidates per dungeon contract", () => {
    expect(TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON).toBe(2);
  });
});

describe("GraphQL errors and unavailable evidence", () => {
  it("marks archived report GraphQL errors as unavailable evidence", () => {
    const error = mapGraphQlErrors([
      { message: "This report has been archived and is unavailable without archive access" },
    ]);
    expect(isUnavailableEvidenceError(error)).toBe(true);
  });

  it("maps rate-limit GraphQL messages to RATE_LIMITED", () => {
    const error = mapGraphQlErrors([{ message: "You have exceeded your rate limit points remaining" }]);
    expect(error.code).toBe("RATE_LIMITED");
  });
});

describe("FixtureWarcraftLogsProvider", () => {
  const provider = new FixtureWarcraftLogsProvider();

  it("discovers character runs from fixtures without optimistic timed=true", async () => {
    const result = await provider.discoverCharacterRuns(
      { region: "EU", realmSlug: "tarren-mill", name: "Fixtureplayer" },
      ctx,
    );
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.sources[0]?.provider).toBe("WARCRAFT_LOGS");
    expect(result.data.every((run) => run.timed === false)).toBe(true);
    expect(result.data.every((run) => run.seasonSlug === "unknown")).toBe(true);
  });

  it("returns successful HIDDEN state with zero combat coverage", () => {
    const discovery = provider.discoverCharacter(
      { region: "EU", realmSlug: "tarren-mill", name: "Hiddenplayer" },
      ctx,
    );
    expect(discovery.summary.visibility).toBe("HIDDEN");
    expect(discovery.summary.dataState).toBe("NO_PUBLIC_LOGS");
    expect(discovery.candidates).toHaveLength(0);
    expect(discovery.latest).toBeNull();
  });

  it("returns successful NO_PUBLIC_LOGS data-state with public visibility", () => {
    const discovery = provider.discoverCharacter(
      { region: "EU", realmSlug: "silvermoon", name: "Nologsplayer" },
      ctx,
    );
    expect(discovery.summary.visibility).toBe("PUBLIC");
    expect(discovery.summary.dataState).toBe("NO_PUBLIC_LOGS");
    expect(discovery.candidates).toHaveLength(0);
  });

  it("maps TARGET_NOT_IN_REPORT when mapped fight lacks the character", () => {
    expect(
      candidatesFromMappedReport(
        {
          code: "AbCdEf12XyZ3",
          startTime: 1,
          visibility: "public",
          fights: [{ id: 1, keystoneLevel: 10, startTime: 0, endTime: 1000 }],
          masterData: { actors: [] },
        },
        "Fixtureplayer",
        "tarren-mill",
      ).rejected.some((r) => r.includes("TARGET_NOT_IN_REPORT")),
    ).toBe(true);
  });

  it("extracts combat facts from report fixture", async () => {
    const details = await provider.fetchReportFightDetails(
      "AbCdEf12XyZ3",
      3,
      "Fixtureplayer",
      "tarren-mill",
      ctx,
    );
    expect(details.combatFacts.interrupts.length).toBe(1);
    expect(details.combatFacts.deaths.length).toBe(1);
    expect(details.combatFacts.dispels.length).toBe(0);
    expect(details.combatFacts.combatantInfo?.specId).toBe(63);
  });

  it("requires targetCharacter from fetch context in getReportFightDetails", async () => {
    await expect(provider.getReportFightDetails("AbCdEf12XyZ3", 3, { ...ctx, targetCharacter: undefined })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });

    const result = await provider.getReportFightDetails("AbCdEf12XyZ3", 3, ctx);
    expect(result.data.combatFacts.reportCode).toBe("AbCdEf12XyZ3");
  });

  it("fails safely on actor ambiguity", async () => {
    await expect(
      provider.fetchReportFightDetails("AmbActor99", 1, "Twinplayer", "tarren-mill", ctx),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Ambiguous/i),
    });
  });

  it("avoids duplicate detailed fetch for same revision", async () => {
    await provider.fetchReportFightDetails("AbCdEf12XyZ3", 3, "Fixtureplayer", "tarren-mill", ctx);
    const second = await provider.fetchReportFightDetails(
      "AbCdEf12XyZ3",
      3,
      "Fixtureplayer",
      "tarren-mill",
      ctx,
    );
    expect(second.combatFacts.limitations.notes.some((n) => n.includes("Duplicate"))).toBe(true);
  });

  it("rejects invalid JSON scalar shapes", () => {
    const fixture = loadFixtureScenario("invalid-json-scalar");
    const raw = (fixture.resolveCharacter as { data: unknown }).data;
    expect(() => parseWithSchema(characterResolveSchema, raw, "ResolveCharacter")).toThrow();
  });

  it("models RATE_LIMITED / UNAVAILABLE as data-state, not visibility", () => {
    expect(deriveWclProvenance(null, [], 0, { rateLimited: true })).toEqual({
      visibility: null,
      dataState: "RATE_LIMITED",
    });
    expect(deriveWclProvenance(null, [], 0, { unavailable: true })).toEqual({
      visibility: null,
      dataState: "UNAVAILABLE",
    });
    expect(deriveVisibility(null, [], 0, { rateLimited: true })).toBeNull();
  });
});

describe("Pagination fixture", () => {
  it("marks truncated pages in limitations", async () => {
    const provider = new FixtureWarcraftLogsProvider();
    const details = await provider.fetchReportFightDetails(
      "PageEvt888",
      1,
      "Fixtureplayer",
      "tarren-mill",
      ctx,
    );
    expect(details.combatFacts.limitations.truncatedPages).toContain("Casts");
  });
});
