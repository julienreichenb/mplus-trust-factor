import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import {
  buildWclSummaryRequestFingerprint,
  isCompatiblePointsAndDamageSummary,
  POINTS_AND_DAMAGE_ADAPTER_VERSION,
  resolveMplusZoneConfig,
} from "@mplus/provider-warcraftlogs";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createWorkerContainer } from "./container.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { seedRefreshEligibilityEvidenceForTest } from "./test-eligibility-seed.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping Wallidrixe legacy-cache regression: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("Wallidrixe legacy ExternalPayload → force refresh", () => {
  it.skip(
    "rejects incompatible legacy WCL summary cache and publishes a new Performance ScoreSnapshot (legacy calculateScore path removed)",
    async () => {
      const env = loadEnv();
      const container = createWorkerContainer(env, { prisma });
      const suffix = randomUUID().slice(0, 8);
      const name = `Wallidrixe-${suffix}`;
      const realmSlug = "archimonde";
      const region = "EU";
      await seedRefreshEligibilityEvidenceForTest(container, { region, realmSlug, name });
      const zoneId = resolveMplusZoneConfig({
        env: process.env,
        allowFixtureDefault: true,
      }).zoneId;

      // Seed character + region/realm via a first fixture refresh (creates rows).
      const first = await runRefreshPipeline(container, {
        region,
        realmSlug,
        name,
        priority: "normal",
        forceRefresh: true,
        requestedAt: new Date("2026-07-28T16:00:00.000Z").toISOString(),
      });
      expect(first.notFound).toBe(false);
      const characterId = first.character.id;

      const summaryFingerprint = buildWclSummaryRequestFingerprint({
        region,
        realmSlug,
        name,
        zoneId,
        partition: null,
      });

      // Persist a legacy playerscore-only summary under the versioned fingerprint (simulates
      // an incompatible cache hit that must be rejected on the next refresh).
      const legacyPayload = {
        visibility: "PUBLIC",
        dataState: "RANKINGS_ONLY",
        warnings: [],
        dungeonAggregates: [],
        performance: {
          state: "SCHEMA_UNSUPPORTED",
          adapterVersion: "legacy-playerscore-v0",
          metric: "playerscore",
          raw: { metric: "playerscore", rankings: [] },
          dungeonAggregates: [],
          normalized: null,
          global: null,
          diagnostics: { errorMessage: "legacy" },
        },
        rawZoneRankingsPointsAndDamage: { metric: "playerscore", rankings: [] },
      };
      expect(isCompatiblePointsAndDamageSummary(legacyPayload)).toBe(false);

      const contentHash = createHash("sha256").update(JSON.stringify(legacyPayload)).digest("hex");
      const request = await prisma.externalRequest.upsert({
        where: { requestFingerprint: summaryFingerprint },
        update: {
          completedAt: new Date("2026-07-28T16:01:00.000Z"),
          expiresAt: new Date(Date.now() + 86_400_000),
          cacheHit: true,
          statusCode: 200,
          errorCode: null,
        },
        create: {
          provider: "WARCRAFT_LOGS",
          requestFingerprint: summaryFingerprint,
          endpointKey: "discoverCharacterSummary",
          method: "GET",
          requestedAt: new Date("2026-07-28T16:01:00.000Z"),
          completedAt: new Date("2026-07-28T16:01:00.000Z"),
          expiresAt: new Date(Date.now() + 86_400_000),
          statusCode: 200,
          cacheHit: true,
        },
      });
      // Replace any newer compatible summary under this fingerprint so cache lookup
      // returns the incompatible legacy envelope (Wallidrixe production shape).
      await prisma.externalPayload.deleteMany({ where: { externalRequestId: request.id } });
      await prisma.externalPayload.upsert({
        where: { provider_contentHash: { provider: "WARCRAFT_LOGS", contentHash } },
        update: {
          externalRequestId: request.id,
          payload: legacyPayload,
          schemaVersion: "legacy-playerscore-v0",
          fetchedAt: new Date(),
        },
        create: {
          externalRequestId: request.id,
          provider: "WARCRAFT_LOGS",
          contentHash,
          payload: legacyPayload,
          schemaVersion: "legacy-playerscore-v0",
          fetchedAt: new Date(),
        },
      });
      // Ensure no newer compatible sibling rows remain attached to this request.
      await prisma.externalPayload.deleteMany({
        where: {
          externalRequestId: request.id,
          NOT: { contentHash },
        },
      });

      // Mark provider state fresh while score remains the first (possibly empty Performance) snapshot.
      const oldSnapshot = await prisma.scoreSnapshot.findFirst({
        where: { characterId, isPublic: true },
        orderBy: { calculatedAt: "desc" },
      });
      expect(oldSnapshot).toBeTruthy();
      const oldCalculatedAt = oldSnapshot!.calculatedAt;

      await prisma.characterProviderState.upsert({
        where: {
          characterId_provider: { characterId, provider: "WARCRAFT_LOGS" },
        },
        update: {
          state: "OK",
          fetchedAt: new Date("2026-07-28T20:02:00.000Z"),
          lastSuccessAt: new Date("2026-07-28T20:02:00.000Z"),
          lastAttemptAt: new Date("2026-07-28T20:02:00.000Z"),
          metadata: { performanceState: "NONE", legacySeed: true },
        },
        create: {
          characterId,
          provider: "WARCRAFT_LOGS",
          state: "OK",
          fetchedAt: new Date("2026-07-28T20:02:00.000Z"),
          lastSuccessAt: new Date("2026-07-28T20:02:00.000Z"),
          lastAttemptAt: new Date("2026-07-28T20:02:00.000Z"),
          metadata: { performanceState: "NONE", legacySeed: true },
        },
      });

      const refreshStartedAt = new Date().toISOString();
      const second = await runRefreshPipeline(container, {
        region,
        realmSlug,
        name,
        priority: "high",
        forceRefresh: true,
        requestedAt: refreshStartedAt,
      });

      expect(second.job.status).toBe("COMPLETED");
      expect(second.score).not.toBeNull();
      expect(new Date(second.score!.calculatedAt).getTime()).toBeGreaterThan(
        oldCalculatedAt.getTime(),
      );
      expect(new Date(second.score!.calculatedAt).getTime()).toBeGreaterThanOrEqual(
        Date.parse(refreshStartedAt) - 1_000,
      );

      const explanation = second.score!.explanation as {
        performanceSummary?: {
          currentSeason?: {
            peakScore?: number | null;
            consistencyScore?: number | null;
            score?: number | null;
            provenance?: string;
            dungeonCount?: number;
            totalMythicPlusScore?: number | null;
            totalLoggedRuns?: number;
            dungeons?: Array<{ dungeonSlug: string }>;
          };
        };
        observations?: Array<{ metricKey: string; rawValue?: number | null }>;
        coverage?: { selectedRunCount?: number };
        scoringRunSelection?: { selectedRuns?: Array<{ dungeonSlug: string }> };
        rawZoneRankingsPointsAndDamage?: { metric?: string } | null;
      };

      expect(explanation.rawZoneRankingsPointsAndDamage?.metric).toBe("points_and_damage");
      expect(explanation.performanceSummary?.currentSeason?.provenance).toBe(
        "AGGREGATE_ZONE_RANKINGS",
      );
      expect(explanation.performanceSummary?.currentSeason?.peakScore).toBeCloseTo(80.875, 5);
      expect(explanation.performanceSummary?.currentSeason?.consistencyScore).toBeCloseTo(77, 5);
      expect(explanation.performanceSummary?.currentSeason?.score).toBeCloseTo(79.51875, 5);
      expect(explanation.performanceSummary?.currentSeason?.dungeonCount).toBe(8);
      expect(
        explanation.performanceSummary?.currentSeason?.dungeons?.every(
          (d) => !d.dungeonSlug.includes("icecrown"),
        ),
      ).toBe(true);

      const peak = explanation.observations?.find(
        (o) => o.metricKey === "performance.current_season_peak",
      );
      const consistency = explanation.observations?.find(
        (o) => o.metricKey === "performance.current_season_consistency",
      );
      expect(peak?.rawValue).toBeCloseTo(80.875, 5);
      expect(consistency?.rawValue).toBeCloseTo(77, 5);

      expect(explanation.coverage?.selectedRunCount).toBeLessThanOrEqual(8);
      expect(
        explanation.scoringRunSelection?.selectedRuns?.every(
          (r) => !r.dungeonSlug.includes("icecrown"),
        ),
      ).toBe(true);

      const latest = await prisma.scoreSnapshot.findFirst({
        where: { characterId, isPublic: true },
        orderBy: { calculatedAt: "desc" },
      });
      expect(latest).toBeTruthy();
      expect(latest!.calculatedAt.getTime()).toBeGreaterThan(oldCalculatedAt.getTime());
      expect(latest!.calculatedAt.toISOString()).toBe(second.score!.calculatedAt);

      const wclState = await prisma.characterProviderState.findFirst({
        where: { characterId, provider: "WARCRAFT_LOGS" },
      });
      const meta = (wclState?.metadata ?? {}) as {
        performanceState?: string;
        performanceAdapterVersion?: string;
        rejectedLegacyCache?: boolean;
      };
      expect(meta.performanceState).toBe("OK");
      expect(meta.performanceAdapterVersion).toBe(POINTS_AND_DAMAGE_ADAPTER_VERSION);
      expect(meta.rejectedLegacyCache).toBe(true);
    },
    120_000,
  );
});
