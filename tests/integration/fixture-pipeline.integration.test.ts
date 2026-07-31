import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient } from "@mplus/database";
import {
  clearSeasonAuthorityCacheForTests,
  repairSeasonAuthority,
  seedRefreshEligibilityEvidenceForTest,
} from "@mplus/worker";
import { buildApp } from "../../apps/api/src/app.js";
import { createApiContainer } from "../../apps/api/src/container.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

const prisma = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);

const PROFILE_POLL_INTERVAL_MS = 50;
const PROFILE_READY_TIMEOUT_MS = 10_000;

/**
 * Poll a character profile until a published score is visible (HTTP 200 + score).
 * Does not treat 202 as success. Surfaces FAILED refresh jobs immediately.
 */
async function waitForReadyProfile(
  app: FastifyInstance,
  profileUrl: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<Record<string, unknown>> {
  const intervalMs = opts.intervalMs ?? PROFILE_POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? PROFILE_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let lastProfileStatus: number | null = null;
  let lastProfileBody: unknown = null;
  let lastRefreshStatus: unknown = null;
  let polls = 0;

  while (Date.now() < deadline) {
    polls += 1;
    const profile = await app.inject({ method: "GET", url: profileUrl });
    lastProfileStatus = profile.statusCode;
    lastProfileBody = (() => {
      try {
        return profile.json();
      } catch {
        return profile.body;
      }
    })();

    if (profile.statusCode === 200) {
      const body = lastProfileBody as { score?: unknown };
      if (body.score != null) {
        return body as Record<string, unknown>;
      }
      throw new Error(
        `Profile ${profileUrl} returned 200 without a published score after ${polls} poll(s): ${JSON.stringify(lastProfileBody)}`,
      );
    }

    if (profile.statusCode !== 202) {
      throw new Error(
        `Profile ${profileUrl} returned unexpected status ${profile.statusCode} (expected 200 with score or 202 while refreshing). Body: ${JSON.stringify(lastProfileBody)}`,
      );
    }

    const statusRes = await app.inject({ method: "GET", url: `${profileUrl}/refresh-status` });
    lastRefreshStatus = (() => {
      try {
        return statusRes.json();
      } catch {
        return statusRes.body;
      }
    })();

    const refreshBody = lastRefreshStatus as {
      refreshStatus?: string;
      job?: { jobId?: string; status?: string; errorMessage?: string | null } | null;
    };

    if (refreshBody.refreshStatus === "FAILED" || refreshBody.job?.status === "failed") {
      throw new Error(
        [
          `Refresh FAILED for ${profileUrl}`,
          `jobId=${refreshBody.job?.jobId ?? "null"}`,
          `jobError=${refreshBody.job?.errorMessage ?? "null"}`,
          `refreshStatus=${JSON.stringify(lastRefreshStatus)}`,
          `lastProfileStatus=${lastProfileStatus}`,
          `lastProfile=${JSON.stringify(lastProfileBody)}`,
        ].join(" | "),
      );
    }

    await delay(intervalMs);
  }

  throw new Error(
    [
      `Timed out after ${timeoutMs}ms waiting for ready profile ${profileUrl}`,
      `polls=${polls}`,
      `lastProfileStatus=${lastProfileStatus}`,
      `lastProfile=${JSON.stringify(lastProfileBody)}`,
      `lastRefreshStatus=${JSON.stringify(lastRefreshStatus)}`,
    ].join(" | "),
  );
}

describe.skipIf(!health.ok)("fixture pipeline integration (API + inline worker)", () => {
  it(
    "search → refresh → persisted score → profile enrichment → comparison",
    async () => {
      resetEnvCache();
      clearSeasonAuthorityCacheForTests();
      const env = loadEnv({
        ...process.env,
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
        ADMIN_API_KEY: "test-admin-key",
        SESSION_SECRET: "test-session-secret-at-least-32-chars",
        PROVIDER_MODE: "fixture",
      });

      const container = createApiContainer(env, { workerOverrides: { prisma }, skipQueues: true });

      // Align DB season authority with fixture Blizzard (season 13). A polluted local DB
      // that still caches a live season (e.g. 17) would enqueue then supersede mid-pipeline.
      await repairSeasonAuthority(
        {
          prisma: container.worker.prisma,
          blizzard: container.worker.providers.blizzard,
          logger: container.logger,
        },
        "EU",
      );
      clearSeasonAuthorityCacheForTests();

      const app = await buildApp({ env, container });
      await app.ready();

      try {
        const suffix = randomUUID().slice(0, 8);
        const nameA = `E2eApiA-${suffix}`;
        const nameB = `E2eApiB-${suffix}`;
        const realmPath = "EU/tarren-mill";
        const pathA = `/api/v1/characters/${realmPath}/${nameA}`;
        const pathB = `/api/v1/characters/${realmPath}/${nameB}`;

        // Worker refresh gate is fail-closed; seed season-scoped eligibility like other API tests.
        await seedRefreshEligibilityEvidenceForTest(container.worker, {
          region: "EU",
          realmSlug: "tarren-mill",
          name: nameA,
        });
        await seedRefreshEligibilityEvidenceForTest(container.worker, {
          region: "EU",
          realmSlug: "tarren-mill",
          name: nameB,
        });

        const firstA = await app.inject({ method: "GET", url: pathA });
        expect(firstA.statusCode).toBe(202);
        const profileA = await waitForReadyProfile(app, pathA);
        expect(profileA.score).not.toBeNull();
        expect(profileA.wclVisibility).toBeTruthy();
        expect(profileA.raiderIoUsed).toBe(true);

        const firstB = await app.inject({ method: "GET", url: pathB });
        expect(firstB.statusCode).toBe(202);
        const profileB = await waitForReadyProfile(app, pathB);
        expect(profileB.score).not.toBeNull();

        const comparison = await app.inject({
          method: "POST",
          url: "/api/v1/comparisons",
          payload: {
            characters: [
              { region: "EU", realmSlug: "tarren-mill", name: nameA },
              { region: "EU", realmSlug: "tarren-mill", name: nameB },
            ],
          },
        });
        expect(comparison.statusCode).toBe(200);
        expect(comparison.json().entries).toHaveLength(2);
      } finally {
        await app.close();
      }
    },
    30_000,
  );
});
