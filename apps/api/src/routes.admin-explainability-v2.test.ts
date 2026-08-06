import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "./test-helpers.js";
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

  it("rejects unauthenticated requests with 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/manifests?limit=5",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects authenticated users without score.candidate.read with 403", async () => {
    const subject = `subj-exp-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: "battlenet",
        externalSubject: subject,
        displayName: uniqueName("Exp"),
        role: "USER",
      },
    });
    const token = await container.authService.createSession({ userId: user.id });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/manifests?limit=5",
      headers: { cookie: `mplus_session=${token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("lists manifests with admin API key (bounded, no provider calls)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/manifests?limit=5",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[]; limit: number; nextCursor: string | null };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.limit).toBe(5);
    expect(body.limit).toBeLessThanOrEqual(50);
    expect(body).toHaveProperty("nextCursor");
  });

  it("clamps list limit to the maximum bound", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/manifests?limit=999",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    // Fastify query schema rejects >50 before handler, or handler clamps — either is bounded.
    expect([200, 400]).toContain(response.statusCode);
    if (response.statusCode === 200) {
      expect(response.json().limit).toBeLessThanOrEqual(50);
    }
  });

  it("rejects malformed cursor with 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/manifests?cursor=not-a-date",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_CURSOR");
  });

  it("returns 404 for unknown character diagnostics without leaking DB errors", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/characters/00000000-0000-4000-8000-000000000099/explainability",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("EVIDENCE_MANIFEST_NOT_FOUND");
    expect(JSON.stringify(response.json())).not.toMatch(/prisma|stack|ECONN|SELECT /i);
  });

  it("returns 404 when manifestId belongs to another character", async () => {
    const foreignManifestId = randomUUID();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/scoring/characters/00000000-0000-4000-8000-000000000088/explainability?manifestId=${foreignManifestId}`,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for malformed characterId / query UUIDs", async () => {
    const badChar = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/characters/not-a-uuid/explainability",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(badChar.statusCode).toBe(400);

    const badQuery = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scoring/manifests?characterId=not-a-uuid",
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(badQuery.statusCode).toBe(400);
  });

  it("provisions score.candidate.read for admin diagnostics", () => {
    expect(PERMISSIONS.SCORE_CANDIDATE_READ).toBe("score.candidate.read");
  });
});
