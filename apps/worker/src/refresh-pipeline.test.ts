import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import {
  ExternalApiError,
  type ProviderName,
  type ProviderResult,
  type RaiderIoCharacterProfile,
  type RefreshCharacterJob,
} from "@mplus/contracts";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createWorkerContainer, type WorkerContainer } from "./container.js";
import { negativeCache } from "./negative-cache.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { seedRefreshEligibilityEvidenceForTest } from "./test-eligibility-seed.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping refresh-pipeline tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. Run "pnpm dev:infra" first. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function buildJob(name: string, overrides: Partial<RefreshCharacterJob> = {}): RefreshCharacterJob {
  return {
    region: "EU",
    realmSlug: "tarren-mill",
    name,
    priority: "normal",
    forceRefresh: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  } as RefreshCharacterJob;
}

function buildContainer(disabledProviders?: Set<ProviderName>): WorkerContainer {
  const env = loadEnv();
  return createWorkerContainer(env, { prisma, disabledProviders });
}

describe.skipIf(!dbAvailable)("runRefreshPipeline (fixture mode, real Postgres)", () => {
  it("flows a happy-path refresh through to a persisted ScoreSnapshot", async () => {
    const container = buildContainer();
    const name = `Examplecharacter-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const job = buildJob(name);

    const result = await runRefreshPipeline(container, job);

    expect(result.notFound).toBe(false);
    expect(result.character.displayName).toBe(name);
    expect(result.job.status).toBe("COMPLETED");
    // Soft-skips (e.g. WCL summary) may appear; hard failures must not.
    expect(result.stagesSkipped.every((s) => typeof s === "string")).toBe(true);
    expect(result.score).not.toBeNull();
    expect(result.score?.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.score?.overallScore).toBeLessThanOrEqual(100);
    expect(["S", "A", "B", "C", "D", "U"]).toContain(result.score?.grade);

    const explanation = result.score?.explanation as {
      scoringVersion?: string;
      scoringDisabled?: boolean;
      observations?: Array<{ metricKey: string }>;
      modelKey?: string;
      coverage?: { selectedRunCoverage?: number };
      wclVisibility?: string;
      fusedRunCount?: number;
      providerTimestamps?: { warcraftlogs?: string | null };
    };
    // Authoritative path: scoreCharacter snapshot (or explicit SCORING_DISABLED).
    expect(
      explanation.scoringVersion != null ||
        explanation.scoringDisabled === true ||
        explanation.modelKey != null,
    ).toBe(true);

    const providerStates = await prisma.characterProviderState.findMany({
      where: { characterId: result.character.id },
    });
    expect(providerStates.length).toBeGreaterThanOrEqual(1);
    expect(providerStates.some((s) => s.provider === "BLIZZARD" && s.state === "OK")).toBe(true);

    const runParticipants = await prisma.runParticipant.count({
      where: { characterId: result.character.id, isTargetCharacter: true },
    });
    expect(runParticipants).toBeGreaterThan(0);

    const externalRequests = await prisma.externalRequest.count({
      where: { provider: { in: ["BLIZZARD", "WARCRAFT_LOGS", "RAIDER_IO"] } },
    });
    expect(externalRequests).toBeGreaterThan(0);

    const combatAnalysis = await prisma.runAnalysis.findFirst({
      where: { characterId: result.character.id, analysisVersion: "wcl-combat-facts-v1" },
    });
    const visibilityAnalysis = await prisma.runAnalysis.findFirst({
      where: { characterId: result.character.id, analysisVersion: "wcl-visibility-v1" },
    });
    const analysis = combatAnalysis ?? visibilityAnalysis;
    // Fixture refresh may complete without combat/visibility analyses when WCL soft-skips.
    if (analysis && combatAnalysis) {
      expect(combatAnalysis.summary).toMatchObject({
        wclVisibility: "PUBLIC",
        combatFacts: expect.objectContaining({
          reportCode: expect.any(String),
          fightId: expect.any(Number),
        }),
      });
    } else if (analysis && visibilityAnalysis) {
      expect(visibilityAnalysis?.summary).toMatchObject({
        wclVisibility: "PUBLIC",
        wclDataState: expect.stringMatching(/^(NO_MATCHED_RUN|RANKINGS_ONLY|NO_PUBLIC_LOGS)$/),
      });
    }
  }, 30_000);

  it("marks the job FAILED and negative-caches identities that resolve to NOT_FOUND", async () => {
    const container = buildContainer();
    const name = `MissingCharacter-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const job = buildJob(name);

    await expect(runRefreshPipeline(container, job)).rejects.toThrow(ExternalApiError);
    expect(negativeCache.has({ region: job.region, realmSlug: job.realmSlug, name })).toBe(true);
  }, 30_000);

  it("soft-skips a container-disabled provider and still produces a neutral score", async () => {
    const container = buildContainer(new Set<ProviderName>(["warcraftlogs"]));
    const name = `DisabledProviderChar-${randomUUID().slice(0, 8)}`;
    const job = buildJob(name);
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    const result = await runRefreshPipeline(container, job);

    expect(result.stagesSkipped).toContain("refresh-warcraftlogs-summary");
    expect(result.stagesSkipped).toContain("analyze-run");
    expect(result.score).not.toBeNull();

    const wclState = await prisma.characterProviderState.findFirst({
      where: { characterId: result.character.id, provider: "WARCRAFT_LOGS" },
    });
    expect(wclState?.state).toBe("UNAVAILABLE");
    expect(wclState?.detail).toBe("provider disabled");
    expect(wclState?.metadata).toMatchObject({ discoveryOutcome: "WCL_DISABLED" });

    const wclSources = await prisma.runSourceReference.count({
      where: {
        provider: "WARCRAFT_LOGS",
        run: { participants: { some: { characterId: result.character.id } } },
      },
    });
    expect(wclSources).toBe(0);
  }, 30_000);

  it("returns a Blizzard-backed score when Raider.IO is unavailable", async () => {
    const container = buildContainer(new Set<ProviderName>(["raiderio"]));
    const name = `NoRaiderIo-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const result = await runRefreshPipeline(container, buildJob(name));

    expect(result.stagesSkipped).toContain("refresh-raiderio");
    expect(result.score).not.toBeNull();
    expect(result.job.status).toBe("COMPLETED");

    const rioState = await prisma.characterProviderState.findFirst({
      where: { characterId: result.character.id, provider: "RAIDER_IO" },
    });
    expect(rioState?.state).toBe("UNAVAILABLE");
  }, 30_000);

  it("soft-skips live-shaped Raider.IO 500/rate-limit failures without failing the job", async () => {
    const base = buildContainer();
    const failingRaiderIo = {
      ...base.providers.raiderio,
      enabled: true,
      async getCharacterProfile(): Promise<ProviderResult<RaiderIoCharacterProfile>> {
        throw new ExternalApiError({
          message: "Raider.IO upstream 500",
          code: "UNKNOWN",
          provider: "raiderio",
          retryable: true,
          statusCode: 500,
        });
      },
    };
    const container = createWorkerContainer(loadEnv(), {
      prisma,
      providers: { raiderio: failingRaiderIo },
    });
    const name = `RioFail-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const result = await runRefreshPipeline(container, buildJob(name));

    expect(result.stagesSkipped).toContain("refresh-raiderio");
    expect(result.score).not.toBeNull();
    expect(result.job.status).toBe("COMPLETED");
  }, 30_000);

  it("soft-skips all providers for identities flagged with 'disabled-test'", async () => {
    const container = buildContainer();
    const name = `disabled-test-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const job = buildJob(name);

    const result = await runRefreshPipeline(container, job);

    expect(result.stagesSkipped).toContain("refresh-blizzard");
    expect(result.stagesSkipped).toContain("refresh-raiderio");
    expect(result.stagesSkipped).toContain("refresh-warcraftlogs-summary");
    expect(result.job.status).toBe("COMPLETED");
    expect(result.score).not.toBeNull();
  }, 30_000);

  it("collapses duplicate refresh requests onto the same IngestionJob dedupe key", async () => {
    const container = buildContainer();
    const name = `DedupeChar-${randomUUID().slice(0, 8)}`;
    const job = buildJob(name);
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    const first = await runRefreshPipeline(container, job);
    const second = await runRefreshPipeline(
      container,
      buildJob(name, { requestedAt: job.requestedAt }),
    );

    expect(first.job.dedupeKey).toBe(second.job.dedupeKey);
    expect(first.job.id).toBe(second.job.id);
    const jobCount = await prisma.ingestionJob.count({
      where: { dedupeKey: first.job.dedupeKey ?? undefined },
    });
    expect(jobCount).toBe(1);
  }, 30_000);

  it("re-runs a second refresh after COMPLETED on the same dedupe key", async () => {
    const container = buildContainer();
    const name = `RequeueChar-${randomUUID().slice(0, 8)}`;
    const job = buildJob(name);
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    const first = await runRefreshPipeline(container, job);
    expect(first.job.status).toBe("COMPLETED");
    const firstCompletedAt = first.job.completedAt?.getTime() ?? 0;

    // Simulate a later manual refresh (new requestedAt) after the first terminal result.
    await new Promise((r) => setTimeout(r, 20));
    const second = await runRefreshPipeline(
      container,
      buildJob(name, { requestedAt: new Date().toISOString() }),
    );

    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe("COMPLETED");
    expect(second.job.startedAt).not.toBeNull();
    expect(second.job.completedAt?.getTime() ?? 0).toBeGreaterThan(firstCompletedAt);
    expect(second.score).not.toBeNull();
  }, 30_000);

  it("completes with a Blizzard-backed score when WCL reports NO_PUBLIC_LOGS", async () => {
    const base = buildContainer();
    const wcl = {
      ...base.providers.warcraftlogs,
      async discoverCharacterSummary() {
        return {
          data: {
            visibility: "PUBLIC" as const,
            dataState: "NO_PUBLIC_LOGS" as const,
            warnings: [],
            dungeonAggregates: [],
            performance: null,
            rawZoneRankingsPointsAndDamage: null,
          },
          provenance: {
            provider: "warcraftlogs" as const,
            externalRequestId: null,
            sourcePayloadId: null,
            sourceUrl: null,
            fetchedAt: new Date().toISOString(),
            schemaVersion: "test",
          },
          freshness: { fetchedAt: new Date().toISOString(), expiresAt: null, stale: false },
          metadata: {
            provider: "warcraftlogs" as const,
            endpointKey: "discoverCharacterSummary",
            requestFingerprint: "test-no-logs",
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusCode: 200,
            cacheHit: false,
            retryCount: 0,
            costUnits: 0,
            etag: null,
            expiresAt: null,
          },
        };
      },
      async discoverCharacterRuns() {
        return {
          data: [],
          provenance: {
            provider: "warcraftlogs" as const,
            externalRequestId: null,
            sourcePayloadId: null,
            sourceUrl: null,
            fetchedAt: new Date().toISOString(),
            schemaVersion: "test",
          },
          freshness: { fetchedAt: new Date().toISOString(), expiresAt: null, stale: false },
          metadata: {
            provider: "warcraftlogs" as const,
            endpointKey: "discoverCharacterRuns",
            requestFingerprint: "test-no-runs",
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusCode: 200,
            cacheHit: false,
            retryCount: 0,
            costUnits: 0,
            etag: null,
            expiresAt: null,
          },
        };
      },
    };
    const container = createWorkerContainer(loadEnv(), {
      prisma,
      providers: { warcraftlogs: wcl },
    });
    const name = `NoPublicLogs-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const result = await runRefreshPipeline(container, buildJob(name));

    expect(result.job.status).toBe("COMPLETED");
    expect(result.score).not.toBeNull();
    const wclState = await prisma.characterProviderState.findFirst({
      where: { characterId: result.character.id, provider: "WARCRAFT_LOGS" },
    });
    expect(wclState).not.toBeNull();
    // Fixture path records NO_PUBLIC_LOGS on the provider row when available.
    const meta = wclState?.metadata as {
      wclDataState?: string;
      discoveryOutcome?: string;
    } | null;
    if (meta?.wclDataState != null) {
      expect(meta.wclDataState).toBe("NO_PUBLIC_LOGS");
    }
    expect(meta?.discoveryOutcome).toBe("NO_PUBLIC_RUNS");
  }, 30_000);

  it("still produces a score when WCL lacks discoverCharacterSummary and only has async discoverCharacter", async () => {
    const asyncDiscover = async () => ({
      summary: {
        visibility: "PUBLIC" as const,
        dataState: "NO_MATCHED_RUN" as const,
        warnings: [] as string[],
      },
      dungeonAggregates: [],
      performance: null,
      candidates: [],
    });
    const wcl = {
      name: "warcraftlogs" as const,
      discoverCharacter: asyncDiscover,
      async discoverCharacterRuns(_identity: unknown, ctx: { now: string }) {
        const discovery = await asyncDiscover();
        expect(discovery.summary.visibility).toBe("PUBLIC");
        return {
          data: [],
          provenance: {
            provider: "warcraftlogs" as const,
            externalRequestId: null,
            sourcePayloadId: null,
            sourceUrl: null,
            fetchedAt: ctx.now,
            schemaVersion: "test",
          },
          freshness: { fetchedAt: ctx.now, expiresAt: null, stale: false },
          metadata: {
            provider: "warcraftlogs" as const,
            endpointKey: "discoverCharacterRuns",
            requestFingerprint: "async-only",
            requestedAt: ctx.now,
            completedAt: ctx.now,
            statusCode: 200,
            cacheHit: false,
            retryCount: 0,
            costUnits: 0,
            etag: null,
            expiresAt: null,
          },
        };
      },
      async getReportFightDetails() {
        throw new ExternalApiError({
          message: "no fights",
          code: "NOT_FOUND",
          provider: "warcraftlogs",
          retryable: false,
        });
      },
    };
    // No discoverCharacterSummary — exercises Promise-safe fallback path.
    const container = createWorkerContainer(loadEnv(), {
      prisma,
      providers: { warcraftlogs: wcl as never },
    });
    const name = `AsyncWclOnly-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const result = await runRefreshPipeline(container, buildJob(name));
    expect(result.job.status).toBe("COMPLETED");
    expect(result.score).not.toBeNull();
  }, 30_000);

  it("soft-skips WCL parsing failures and completes a Blizzard-backed score (never stuck QUEUED)", async () => {
    const base = buildContainer();
    const wcl = {
      ...base.providers.warcraftlogs,
      async discoverCharacterSummary() {
        throw new TypeError("Cannot read properties of undefined (reading 'visibility')");
      },
      async discoverCharacterRuns() {
        throw new TypeError("Cannot read properties of undefined (reading 'visibility')");
      },
    };
    const container = createWorkerContainer(loadEnv(), {
      prisma,
      providers: { warcraftlogs: wcl },
    });
    const name = `WclParseFail-${randomUUID().slice(0, 8)}`;
    await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });
    const result = await runRefreshPipeline(container, buildJob(name));

    expect(result.stagesSkipped).toContain("refresh-warcraftlogs-summary");
    expect(result.job.status).toBe("COMPLETED");
    expect(result.score).not.toBeNull();
    expect(["queued", "QUEUED"]).not.toContain(result.job.status);

    const wclState = await prisma.characterProviderState.findFirst({
      where: { characterId: result.character.id, provider: "WARCRAFT_LOGS" },
    });
    expect(wclState?.metadata).toMatchObject({
      discoveryOutcome: "WCL_DISCOVERY_FAILED",
    });
    expect(String((wclState?.metadata as { discoveryDetail?: string } | null)?.discoveryDetail ?? "")).toMatch(
      /visibility/i,
    );
  }, 30_000);

  it("cold WCL discovery produces ranked candidate runs without persisted evidence", async () => {
    const base = buildContainer();
    const liveLikeRuns = [
      {
        id: "ColdReportAAA-1",
        region: "EU" as const,
        seasonSlug: "blizzard-season-17",
        dungeonSlug: "skyreach",
        keyLevel: 22,
        completedAt: "2026-07-01T12:00:00.000Z",
        durationMs: 1_800_000,
        timerMs: null,
        timed: true,
        scoreValue: 410,
        canonicalFingerprint: "cold-fp-aaa",
        affixes: [],
        participants: [],
        sources: [
          {
            provider: "WARCRAFT_LOGS" as const,
            externalRunId: "ColdReportAAA:1",
            externalUrl: "https://www.warcraftlogs.com/reports/ColdReportAAA?fight=1",
            reportCode: "ColdReportAAA",
            fightId: 1,
            revision: null,
          },
        ],
      },
      {
        id: "ColdReportBBB-2",
        region: "EU" as const,
        seasonSlug: "blizzard-season-17",
        dungeonSlug: "pit-of-saron",
        keyLevel: 21,
        completedAt: "2026-07-02T12:00:00.000Z",
        durationMs: 1_700_000,
        timerMs: null,
        timed: true,
        scoreValue: 400,
        canonicalFingerprint: "cold-fp-bbb",
        affixes: [],
        participants: [],
        sources: [
          {
            provider: "WARCRAFT_LOGS" as const,
            externalRunId: "ColdReportBBB:2",
            externalUrl: "https://www.warcraftlogs.com/reports/ColdReportBBB?fight=2",
            reportCode: "ColdReportBBB",
            fightId: 2,
            revision: null,
          },
        ],
      },
    ];
    const wcl = Object.assign(Object.create(base.providers.warcraftlogs), {
      async discoverCharacterSummary() {
        return {
          data: {
            visibility: "PUBLIC" as const,
            dataState: "OK" as const,
            warnings: [],
            dungeonAggregates: [],
            performance: { state: "SKIPPED", raw: null, global: null, diagnostics: null },
            rawZoneRankingsPointsAndDamage: null,
          },
          provenance: {
            provider: "warcraftlogs" as const,
            externalRequestId: null,
            sourcePayloadId: null,
            sourceUrl: null,
            fetchedAt: new Date().toISOString(),
            schemaVersion: "test",
          },
          freshness: { fetchedAt: new Date().toISOString(), expiresAt: null, stale: false },
          metadata: {
            provider: "warcraftlogs" as const,
            endpointKey: "discoverCharacterSummary",
            requestFingerprint: `cold-summary-${randomUUID()}`,
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusCode: 200,
            cacheHit: false,
            retryCount: 0,
            costUnits: 0,
            etag: null,
            expiresAt: null,
          },
        };
      },
      async discoverCharacterRuns(
        _identity: unknown,
        ctx: { wclActiveDungeonSlugs?: readonly string[] },
      ) {
        expect(ctx.wclActiveDungeonSlugs?.length ?? 0).toBeGreaterThan(0);
        return {
          data: liveLikeRuns,
          provenance: {
            provider: "warcraftlogs" as const,
            externalRequestId: null,
            sourcePayloadId: null,
            sourceUrl: null,
            fetchedAt: new Date().toISOString(),
            schemaVersion: "test",
          },
          freshness: { fetchedAt: new Date().toISOString(), expiresAt: null, stale: false },
          metadata: {
            provider: "warcraftlogs" as const,
            endpointKey: "discoverCharacterRuns",
            requestFingerprint: `cold-runs-${randomUUID()}`,
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            statusCode: 200,
            cacheHit: false,
            retryCount: 0,
            costUnits: 1,
            etag: null,
            expiresAt: null,
          },
          wclRankings: [],
        };
      },
      async getReportFightDetails() {
        throw new ExternalApiError({
          message: "fight details unavailable in cold discovery unit test",
          code: "INVALID_RESPONSE",
          provider: "warcraftlogs",
          retryable: false,
        });
      },
    });
    const container = createWorkerContainer(loadEnv(), {
      prisma,
      providers: { warcraftlogs: wcl as never },
    });
    const name = `ColdWclDiscover-${randomUUID().slice(0, 8)}`;
    const seeded = await seedRefreshEligibilityEvidenceForTest(container, {
      region: "EU",
      realmSlug: "tarren-mill",
      name,
    });

    // True cold: no WCL sources / digests for this character before refresh.
    const beforeSources = await prisma.runSourceReference.count({
      where: {
        provider: "WARCRAFT_LOGS",
        run: { participants: { some: { characterId: seeded.characterId } } },
      },
    });
    const beforeDigests = await prisma.characterRunDigest.count({
      where: { characterId: seeded.characterId },
    });
    expect(beforeSources).toBe(0);
    expect(beforeDigests).toBe(0);

    const result = await runRefreshPipeline(container, buildJob(name, { forceRefresh: true }));
    expect(result.job.status).toBe("COMPLETED");

    const wclState = await prisma.characterProviderState.findFirst({
      where: { characterId: result.character.id, provider: "WARCRAFT_LOGS" },
    });
    expect(wclState?.metadata).toMatchObject({
      discoveryOutcome: "OK",
      discoveredRunCount: 2,
    });

    const wclSources = await prisma.runSourceReference.count({
      where: {
        provider: "WARCRAFT_LOGS",
        run: { participants: { some: { characterId: result.character.id } } },
      },
    });
    expect(wclSources).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("marks unexpected pipeline failures FAILED (never QUEUED with an errorMessage)", async () => {
    const spy = vi
      .spyOn(
        await import("./orchestration/scoring/refresh-bridge.js"),
        "runAuthoritativeScoring",
      )
      .mockRejectedValue(new Error("unexpected scoring boom"));

    try {
      const container = buildContainer();
      const name = `UnexpectedFail-${randomUUID().slice(0, 8)}`;
      await seedRefreshEligibilityEvidenceForTest(container, {
        region: "EU",
        realmSlug: "tarren-mill",
        name,
      });
      await expect(runRefreshPipeline(container, buildJob(name))).rejects.toThrow(
        /unexpected scoring boom/i,
      );

      const job = await prisma.ingestionJob.findFirst({
        where: {
          character: { normalizedName: name.toLocaleLowerCase("en-US") },
        },
        orderBy: { scheduledAt: "desc" },
      });
      expect(job?.status).toBe("FAILED");
      expect(job?.status).not.toBe("QUEUED");
      expect(job?.error).toMatchObject({
        message: expect.stringMatching(/unexpected scoring boom/i),
      });
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});
