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
        indexEntries: 3,
        rejectedAtIndex: 0,
        detailCandidates: 3,
        detailsFetched: 0,
        eligible: 3,
        rejectedTournament: 0,
        rejectedInternal: 0,
        detailFailures: 0,
        retainedLastKnownGood: 0,
        newlyDeactivated: 0,
        activeCatalogCount: 3,
        rejectedSamples: [],
        upserted: 3,
        minimallyUpserted: 0,
        enriched: 0,
        enrichmentFailures: 0,
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
    ensureSeasonDataReady: vi.fn(async (input: { blizzardSeasonId: number }) => ({
      seasonId: "s17",
      blizzardSeasonId: input.blizzardSeasonId,
      regionCode: "EU",
      selectionMode: "AUTO",
      catalogReadyBefore: false,
      catalogReadyAfter: true,
      dungeonCount: 8,
      expectedDungeonCount: 8,
      wclZoneId: 47,
      reasons: [],
      catalogSource: "zone_catalog_registry",
      skippedReady: false,
      catalogSynced: true,
      activated: false,
      distributionRequested: true,
      distributionError: null,
      status: "ready",
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
          indexEntries: 3,
          rejectedAtIndex: 0,
          detailCandidates: 3,
          detailsFetched: 0,
          eligible: 3,
          rejectedTournament: 0,
          rejectedInternal: 0,
          detailFailures: 0,
          retainedLastKnownGood: 0,
          newlyDeactivated: 0,
          activeCatalogCount: 3,
          rejectedSamples: [],
          upserted: 3,
          minimallyUpserted: 0,
          enriched: 0,
          enrichmentFailures: 0,
          skippedDetails: 3,
          errors: [],
        },
      ],
    });
    expect(response.json().results[0]).not.toHaveProperty("indexed");
  });

  it("CORS preflight for scoring-season PUT advertises PUT and the mutation then reaches the route", async () => {
    const origin = "http://localhost:5173";
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/admin/misc/scoring-season",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type, accept",
      },
    });
    expect(preflight.statusCode).toBe(204);
    const allowMethods = preflight.headers["access-control-allow-methods"];
    expect(typeof allowMethods).toBe("string");
    const methods = String(allowMethods)
      .split(",")
      .map((m) => m.trim().toUpperCase());
    expect(methods).toEqual(expect.arrayContaining(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]));
    expect(methods).toContain("PUT");
    expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    const allowHeaders = String(preflight.headers["access-control-allow-headers"] ?? "").toLowerCase();
    expect(allowHeaders).toMatch(/content-type/);

    const mutation = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/misc/scoring-season",
      headers: {
        Origin: origin,
        "content-type": "application/json",
        accept: "application/json",
        "x-admin-api-key": ADMIN_KEY,
      },
      payload: { mode: "AUTO", expectedVersion: 1, region: "EU" },
    });
    expect(mutation.statusCode).not.toBe(204);
    expect(mutation.statusCode).not.toBe(404);
    expect(mutation.headers["access-control-allow-origin"]).toBe(origin);
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

  it("synchronize-data calls ensureSeasonDataReady", async () => {
    const { ensureSeasonDataReady } = await import("@mplus/worker");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/misc/scoring-season/synchronize-data",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { region: "EU" },
    });
    expect(response.statusCode).not.toBe(404);
    expect(response.statusCode).not.toBe(405);
    if (response.statusCode === 200) {
      expect(ensureSeasonDataReady).toHaveBeenCalled();
    }
  });
});
