import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { buildApiReadiness, toModeSnapshot } from "./readiness-diagnostics.js";

const baseEnv = {
  DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_itest_fixture0001?schema=public",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_API_KEY: "test-admin-key",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  PROVIDER_MODE: "fixture",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_BASE_URL: "http://localhost:3000",
  APP_VERSION: "rev-test-1",
  RAW_ARTIFACTS_DIR: "./data/raw-artifacts-readiness-test",
} as const;

describe("API readiness diagnostics", () => {
  it("reports revision and V2 modes when flags are off", async () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: false, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
    });
    expect(result.ready).toBe(true);
    expect(result.body.revision).toBe("rev-test-1");
    expect((result.body.scoringV2 as { modes: { enabled: boolean } }).modes.enabled).toBe(false);
    expect((result.body.contracts as { workerJobSchema: string }).workerJobSchema).toBe("2.0.0");
    expect((result.body.wclSnapshot as { state: string }).state).toBe("worker_owned");
  });

  it("requires artifact backend when evidence fetch is enabled", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
    });
    expect(toModeSnapshot(env).evidenceFetchEnabled).toBe(true);

    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: true, configured: true } },
      activeModel: { key: "trust-v6", version: 1 },
    });
    expect(result.probes.artifactBackend.required).toBe(true);
    expect(result.probes.artifactBackend.ok).toBe(true);
    expect(result.ready).toBe(true);
  });

  it("fails when dimensions enabled and active model missing", async () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
      SCORING_V2_DIMENSIONS_ENABLED: "true",
    });
    const result = await buildApiReadiness({
      env,
      database: { ok: true, latencyMs: 1 },
      redis: { ok: true, latencyMs: 0, skipped: true },
      queueMode: "inline",
      providers: { warcraftlogs: { enabled: true, configured: true } },
      activeModel: null,
    });
    expect(result.ready).toBe(false);
    expect(result.failingReasons).toContain("model_catalog_incompatible");
  });
});
