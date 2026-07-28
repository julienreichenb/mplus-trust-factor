import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("admin ability catalog route", () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
    container = createApiContainer(env, { workerOverrides: { prisma: prisma as PrismaClient }, skipQueues: true });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/ability-catalog" });
    expect(response.statusCode).toBe(401);
  });

  it("returns catalog for admin key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/ability-catalog?limit=5",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.catalogSummary.canonicalRules).toBeGreaterThan(0);
    expect(body.entries).toHaveLength(5);
    expect(body.validationSummary).toBeTruthy();
  });

  it("filters by classSlug", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/ability-catalog?classSlug=mage&limit=50",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries.every((e: { rule: { classSlug: string } }) => e.rule.classSlug === "mage")).toBe(true);
  });

  it("searches by spell id", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/ability-catalog?query=6552&limit=20",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.entries.some((e: { rule: { spellIds: number[] } }) => e.rule.spellIds.includes(6552))).toBe(true);
  });
});
