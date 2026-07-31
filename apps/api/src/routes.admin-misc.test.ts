import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import type * as MplusWorker from "@mplus/worker";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-misc";

vi.mock("@mplus/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof MplusWorker>();
  return {
    ...actual,
    syncRealmCatalog: vi.fn(async () => [
      {
        region: "EU",
        indexed: 3,
        upserted: 3,
        detailsFetched: 0,
        skippedDetails: 3,
        errors: [],
      },
    ]),
    clearSeasonAuthorityCacheForTests: vi.fn(),
    listPersistedRegionsForAuthority: vi.fn(async () => [{ id: "eu", code: "EU" }]),
    repairSeasonAuthority: vi.fn(async () => ({
      region: "EU",
      previous: { blizzardSeasonId: 13, slug: "blizzard-season-13" },
      current: {
        blizzardSeasonId: 17,
        slug: "blizzard-season-17",
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: new Date("2026-07-31T12:00:00.000Z"),
        region: "EU",
        resolution: "live",
      },
      changed: true,
    })),
  };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("admin misc routes", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
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

  it("rejects realm sync without admin credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/misc/realms/sync",
      payload: { regions: ["EU"] },
    });
    expect(response.statusCode).toBe(401);
  });

  it("syncs realms with a valid admin API key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/misc/realms/sync",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { regions: ["EU"], forceDetails: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      results: [
        {
          region: "EU",
          indexed: 3,
          upserted: 3,
          detailsFetched: 0,
          skippedDetails: 3,
          errors: [],
        },
      ],
    });
  });

  it("syncs season authority with a valid admin API key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/misc/season/sync-authority",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { regions: ["EU"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      results: [
        {
          region: "EU",
          previous: { blizzardSeasonId: 13, slug: "blizzard-season-13" },
          current: {
            blizzardSeasonId: 17,
            slug: "blizzard-season-17",
            authoritySource: "season_index.current_season",
            authorityVerifiedAt: "2026-07-31T12:00:00.000Z",
          },
          changed: true,
        },
      ],
    });
  });
});
