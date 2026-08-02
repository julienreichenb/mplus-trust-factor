import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { assertTestDatabaseAllowed } from "@mplus/test-utils";
import { buildApp } from "./app.js";
import { createApiContainer } from "./container.js";
import type { FastifyInstance } from "fastify";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

describe("API health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
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

  it("returns ready when database is up (Redis skipped in inline queue mode)", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      revision?: string;
      database: { ok: boolean };
      redis: { ok: boolean; skipped?: boolean };
      queueMode: string;
      providers: Record<string, { enabled: boolean; configured: boolean }>;
      scoringV2?: { modes: { enabled: boolean; publicationEnabled: boolean } };
      contracts?: { workerJobSchema: string };
      wclSnapshot?: { state: string };
      artifactBackend?: { ok: boolean; required: boolean };
      failingReasons?: string[];
    };
    expect(body.status).toBe("ready");
    expect(body.database.ok).toBe(true);
    expect(body.redis.ok).toBe(true);
    expect(body.redis.skipped).toBe(true);
    expect(body.queueMode).toBe("inline");
    expect(body.providers.blizzard.enabled).toBeDefined();
    expect(typeof body.revision).toBe("string");
    expect(body.scoringV2?.modes.enabled).toBe(false);
    expect(body.scoringV2?.modes.publicationEnabled).toBe(false);
    expect(body.contracts?.workerJobSchema).toBe("2.0.0");
    expect(body.wclSnapshot?.state).toBe("worker_owned");
    expect(body.artifactBackend?.required).toBe(false);
    expect(body.failingReasons).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/CLIENT_SECRET|access_token|postgresql:\/\//i);
  });

  it("returns meta", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe("M+ Trust Factor");
    expect(body.providerMode).toBe("fixture");
  });
});
