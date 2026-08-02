import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";
import { PERMISSIONS } from "./iam/permissions.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("admin explainability v2 routes", () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv();
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      skipQueues: true,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects manifest list without authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring-v2/manifests?limit=5",
    });
    expect(response.statusCode).toBe(401);
  });

  it("lists manifests with admin API key (bounded, no provider calls)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring-v2/manifests?limit=5",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number; nextCursor: string | null };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.limit).toBe(5);
    expect(body).toHaveProperty("nextCursor");
  });

  it("returns 404 for unknown character diagnostics", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring-v2/characters/00000000-0000-4000-8000-000000000099/explainability",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("provisions score.candidate.read for admin diagnostics", () => {
    expect(PERMISSIONS.SCORE_CANDIDATE_READ).toBe("score.candidate.read");
  });
});
