import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { buildApp } from "../../apps/api/src/app.js";
import { createApiContainer } from "../../apps/api/src/container.js";
import type { FastifyInstance } from "fastify";
import {
  loadFixtureManifest,
  loadFixtureById,
  assertFixtureSanitized,
  blizzardCharacterFixtureSchema,
  warcraftlogsCharacterRunsFixtureSchema,
  raiderioCharacterFixtureSchema,
  expertCohortFixtureSchema,
} from "@mplus/test-utils";
import { loadOpenApiSpec, assertResponseMatchesOpenApiSchema } from "@mplus/test-utils";

const baseEnv = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  ADMIN_API_KEY: "test-admin-key",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  PROVIDER_MODE: "fixture",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_BASE_URL: "http://localhost:3000",
} as const;

describe("contract: provider fixtures", () => {
  it("manifest lists versioned fixtures", () => {
    const manifest = loadFixtureManifest();
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(4);
    for (const entry of manifest.fixtures) {
      assertFixtureSanitized(entry.path);
    }
  });

  it("parses blizzard fixture against boundary schema", () => {
    const { data } = loadFixtureById("blizzard-character-profile-v1");
    expect(() => blizzardCharacterFixtureSchema.parse(data)).not.toThrow();
  });

  it("parses warcraftlogs fixture against boundary schema", () => {
    const { data } = loadFixtureById("warcraftlogs-character-runs-v1");
    expect(() => warcraftlogsCharacterRunsFixtureSchema.parse(data)).not.toThrow();
  });

  it("parses raiderio fixture against boundary schema", () => {
    const { data } = loadFixtureById("raiderio-character-profile-v1");
    expect(() => raiderioCharacterFixtureSchema.parse(data)).not.toThrow();
  });

  it("parses expert cohort fixture", () => {
    const { data } = loadFixtureById("scoring-expert-cohort-v1");
    expect(() => expertCohortFixtureSchema.parse(data)).not.toThrow();
  });
});

describe("contract: OpenAPI responses", () => {
  let app: FastifyInstance;
  let openApi: Record<string, unknown>;

  beforeAll(async () => {
    resetEnvCache();
    const env = loadEnv({ ...process.env, ...baseEnv });
    const container = createApiContainer(env, { skipQueues: true });
    app = await buildApp({ env, container });
    await app.ready();
    openApi = app.swagger() as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  it("health/live matches OpenAPI schema", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    const errors = assertResponseMatchesOpenApiSchema(
      openApi,
      "/health/live",
      "GET",
      200,
      response.json(),
    );
    expect(errors).toEqual([]);
  });

  it("api/v1/meta matches OpenAPI schema", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(response.statusCode).toBe(200);
    const errors = assertResponseMatchesOpenApiSchema(
      openApi,
      "/api/v1/meta",
      "GET",
      200,
      response.json(),
    );
    expect(errors).toEqual([]);
  });

  it("metrics endpoint returns prometheus text", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
  });
});

describe("contract: committed OpenAPI snapshot", () => {
  it("loads openapi snapshot for drift detection", () => {
    const spec = loadOpenApiSpec();
    expect(spec.openapi).toBeTruthy();
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/health/live"]).toBeTruthy();
    expect(paths["/api/v1/meta"]).toBeTruthy();
    expect(paths["/metrics"]).toBeTruthy();
  });

  it("live swagger matches committed snapshot paths", async () => {
    resetEnvCache();
    const env = loadEnv({ ...process.env, ...baseEnv });
    const container = createApiContainer(env, { skipQueues: true });
    const app = await buildApp({ env, container });
    await app.ready();
    const live = app.swagger() as Record<string, unknown>;
    const snapshot = loadOpenApiSpec();
    const livePaths = Object.keys((live.paths as Record<string, unknown>) ?? {}).sort();
    const snapshotPaths = Object.keys((snapshot.paths as Record<string, unknown>) ?? {}).sort();
    expect(livePaths).toEqual(snapshotPaths);
    await app.close();
  });
});
