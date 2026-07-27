import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient } from "@mplus/database";
import { buildApp } from "../../apps/api/src/app.js";
import { createApiContainer } from "../../apps/api/src/container.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

const prisma = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);

describe.skipIf(!health.ok)("fixture pipeline integration (API + inline worker)", () => {
  it("search → refresh → persisted score → profile enrichment → comparison", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      PROVIDER_MODE: "fixture",
    });

    const container = createApiContainer(env, { workerOverrides: { prisma }, skipQueues: true });
    const app = await buildApp({ env, container });
    await app.ready();

    const suffix = randomUUID().slice(0, 8);
    const nameA = `E2eApiA-${suffix}`;
    const nameB = `E2eApiB-${suffix}`;
    const realmPath = "EU/tarren-mill";

    const firstA = await app.inject({ method: "GET", url: `/api/v1/characters/${realmPath}/${nameA}` });
    expect(firstA.statusCode).toBe(202);
    const secondA = await app.inject({ method: "GET", url: `/api/v1/characters/${realmPath}/${nameA}` });
    expect(secondA.statusCode).toBe(200);
    const profileA = secondA.json();
    expect(profileA.score).not.toBeNull();
    expect(profileA.wclVisibility).toBeTruthy();
    expect(profileA.raiderIoUsed).toBe(true);

    const firstB = await app.inject({ method: "GET", url: `/api/v1/characters/${realmPath}/${nameB}` });
    expect(firstB.statusCode).toBe(202);
    const secondB = await app.inject({ method: "GET", url: `/api/v1/characters/${realmPath}/${nameB}` });
    expect(secondB.statusCode).toBe(200);

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

    await app.close();
  });
});
