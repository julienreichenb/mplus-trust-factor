import { describe, expect, it, vi } from "vitest";
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
  recentReportsToCandidates,
  rankingsToCandidates,
  mythicRunPlaceholders,
  deriveVisibility,
  capDiscoveryCandidates,
} from "./discovery/run-discovery.js";
import { MAX_DISCOVERY_CANDIDATES, MAX_EVENT_PAGES } from "./discovery/bounds.js";
import {
  resolveMplusZoneConfig,
  shouldQueryZoneRankings,
  MPLUS_ZONE_ENV,
} from "./discovery/mplus-zone.js";
import { ReportRevisionCache } from "./analysis/revision-cache.js";
import { evaluateRateBudget, parseRateLimitSnapshot, shouldDeferExpensiveWork } from "./rate/rate-budget.js";
import { parseWithSchema, characterResolveSchema } from "./client/graphql-client.js";
import { isUnavailableEvidenceError, mapGraphQlErrors } from "./client/errors.js";
import type { WclRunCandidate } from "./types.js";

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
      fightUnknown: false,
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
      resetInSeconds: 600,
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
  it("documents candidate cap and event page bound", () => {
    expect(MAX_DISCOVERY_CANDIDATES).toBe(25);
    expect(MAX_EVENT_PAGES).toBeLessThanOrEqual(10);
  });

  it("never claims timed=true without evidence", () => {
    const placeholders = mythicRunPlaceholders(baseCandidate({ timed: null }));
    expect(placeholders.timed).toBe(false);
    expect(placeholders.seasonSlug).toBe("unknown");
  });

  it("skips private and unlisted recent reports", () => {
    const mapped = recentReportsToCandidates({
      data: [
        { code: "Pub1", startTime: 1, visibility: "public", zone: { id: 45 } },
        { code: "Priv1", startTime: 2, visibility: "private", zone: { id: 45 } },
        { code: "Unl1", startTime: 3, visibility: "unlisted", zone: { id: 45 } },
      ],
    });
    expect(mapped.candidates).toHaveLength(1);
    expect(mapped.privateSkipped).toBe(1);
    expect(mapped.unlistedSkipped).toBe(1);
    expect(mapped.candidates[0]?.incompleteness.fightUnknown).toBe(true);
  });

  it("caps discovery candidates", () => {
    const rankings = rankingsToCandidates(
      Array.from({ length: 30 }, (_, i) => ({
        reportCode: `R${i}`,
        fightId: i + 1,
        encounterId: 1201,
        zoneId: 45,
        bracket: 10,
        keyLevel: 10,
        score: 100,
        amount: null,
        percentile: null,
        specSlug: null,
        roleSlug: null,
        durationMs: 1000,
        startTimeMs: i,
        reportStartTimeMs: 1_000_000,
        timed: null,
        metric: "playerscore",
      })),
    );
    const capped = capDiscoveryCandidates(rankings, []);
    expect(capped.candidates).toHaveLength(MAX_DISCOVERY_CANDIDATES);
    expect(capped.truncated).toBe(true);
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
    expect(discovery.candidates).toHaveLength(0);
    expect(discovery.latest).toBeNull();
  });

  it("returns successful NO_PUBLIC_LOGS state with zero combat coverage", () => {
    const discovery = provider.discoverCharacter(
      { region: "EU", realmSlug: "silvermoon", name: "Nologsplayer" },
      ctx,
    );
    expect(discovery.summary.visibility).toBe("NO_PUBLIC_LOGS");
    expect(discovery.candidates).toHaveLength(0);
  });

  it("skips private/unlisted reports as PRIVATE_SKIPPED", () => {
    const discovery = provider.discoverCharacter(
      { region: "EU", realmSlug: "tarren-mill", name: "Privateplayer" },
      ctx,
    );
    expect(discovery.summary.visibility).toBe("PRIVATE_SKIPPED");
    expect(discovery.privateReportsSkipped).toBeGreaterThan(0);
    expect(discovery.candidates).toHaveLength(0);
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
    expect(details.combatFacts.dispels.length).toBe(1);
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

  it("models RATE_LIMITED visibility helper", () => {
    expect(deriveVisibility(null, [], 0, { rateLimited: true })).toBe("RATE_LIMITED");
    expect(deriveVisibility(null, [], 0, { unavailable: true })).toBe("UNAVAILABLE");
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
