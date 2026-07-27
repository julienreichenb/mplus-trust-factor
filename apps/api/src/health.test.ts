import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { buildApp } from "./app.js";
import { createApiContainer } from "./container.js";
import type { FastifyInstance } from "fastify";

describe("API health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      PROVIDER_MODE: "fixture",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
    });
    const container = createApiContainer(env, { skipQueues: true });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns live health", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns meta", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe("M+ Trust Factor");
    expect(body.providerMode).toBe("fixture");
  });
});
