import { describe, expect, it } from "vitest";
import { getConfigSummary, loadEnv, resetEnvCache } from "./index.js";

/** Disposable-looking URL for env parsing only — this suite does not open Prisma. */
const baseEnv = {
  DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_itest_fixture0001?schema=public",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_API_KEY: "test-admin-key",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  PROVIDER_MODE: "fixture",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_BASE_URL: "http://localhost:3000",
} as const;

describe("loadEnv", () => {
  it("accepts fixture mode without provider credentials", () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv });
    expect(env.PROVIDER_MODE).toBe("fixture");
    expect(env.API_PORT).toBe(3000);
    expect(env.ACTIVE_SCORE_MODEL_KEY).toBe("default");
    expect(env.ACTIVE_SCORE_MODEL_VERSION).toBe(6);
    expect(env.BLIZZARD_ENABLED).toBe(true);
    expect(env.WCL_ENABLED).toBe(true);
    expect(env.RAIDERIO_ENABLED).toBe(true);
    expect(env.ALLOW_LIVE_PROVIDER_CALLS).toBe(false);
    expect(env.REFRESH_SCHEDULER_ENABLED).toBe(false);
    expect(env.REFRESH_DRY_RUN_ONLY).toBe(true);
    expect(env.REFRESH_TRACKED_TOP_PERCENT).toBe(25);
    expect(env.REFRESH_ADMISSION_MODE).toBe("off");
    expect(env.REFRESH_CONCURRENCY_ENABLED).toBe(false);
    expect(env.REFRESH_WORKER_CONCURRENCY).toBe(1);
    expect(env.UTILITY_PUBLICATION_MODE).toBe("shadow");
    expect(env.ADMIN_API_KEY_EMERGENCY_FALLBACK).toBe(false);
    expect(env.ADMIN_CALIBRATION_ENABLED).toBe(false);
    expect(env.SCORING_V2_ENABLED).toBe(false);
    expect(env.SCORING_V2_PUBLICATION_ENABLED).toBe(false);
    expect(env.CALIBRATION_V2_ENABLED).toBe(false);
  });

  it("accepts UTILITY_PUBLICATION_MODE enum values", () => {
    resetEnvCache();
    expect(loadEnv({ ...baseEnv, UTILITY_PUBLICATION_MODE: "off" }).UTILITY_PUBLICATION_MODE).toBe(
      "off",
    );
    resetEnvCache();
    expect(
      loadEnv({ ...baseEnv, UTILITY_PUBLICATION_MODE: "shadow" }).UTILITY_PUBLICATION_MODE,
    ).toBe("shadow");
    resetEnvCache();
    expect(
      loadEnv({ ...baseEnv, UTILITY_PUBLICATION_MODE: "published" }).UTILITY_PUBLICATION_MODE,
    ).toBe("published");
  });

  it("rejects live mode without Blizzard credentials when Blizzard is enabled", () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...baseEnv,
        PROVIDER_MODE: "live",
        WCL_CLIENT_ID: "wcl",
        WCL_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/Blizzard live mode requires BLIZZARD_CLIENT_ID/);
  });

  it("rejects live mode without WCL credentials when WCL is enabled", () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...baseEnv,
        PROVIDER_MODE: "live",
        BLIZZARD_CLIENT_ID: "blizzard",
        BLIZZARD_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/Warcraft Logs live mode requires WCL_CLIENT_ID/);
  });

  it("allows live mode without Blizzard credentials when Blizzard is disabled", () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      PROVIDER_MODE: "live",
      BLIZZARD_ENABLED: "false",
      WCL_CLIENT_ID: "wcl",
      WCL_CLIENT_SECRET: "secret",
    });
    expect(env.BLIZZARD_ENABLED).toBe(false);
    expect(env.PROVIDER_MODE).toBe("live");
  });

  it("allows live mode without WCL credentials when WCL is disabled", () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      PROVIDER_MODE: "live",
      WCL_ENABLED: "false",
      BLIZZARD_CLIENT_ID: "blizzard",
      BLIZZARD_CLIENT_SECRET: "secret",
    });
    expect(env.WCL_ENABLED).toBe(false);
    expect(env.PROVIDER_MODE).toBe("live");
  });

  it("rejects short SESSION_SECRET", () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...baseEnv,
        SESSION_SECRET: "too-short",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("rejects both admin bootstrap identities together", () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...baseEnv,
        ADMIN_BOOTSTRAP_USER_ID: "11111111-1111-4111-8111-111111111111",
        ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: "bnet-sub",
      }),
    ).toThrow(/ADMIN_BOOTSTRAP/);
  });

  it("returns a credential-free config summary", () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      BLIZZARD_CLIENT_ID: "id-value",
      BLIZZARD_CLIENT_SECRET: "secret-value",
      ALLOW_LIVE_PROVIDER_CALLS: "true",
    });
    const summary = getConfigSummary(env);
    expect(summary.blizzardCredentialsConfigured).toBe(true);
    expect(summary.allowLiveProviderCalls).toBe(true);
    expect(summary.scoringV2.enabled).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("secret-value");
    expect(JSON.stringify(summary)).not.toContain("id-value");
  });
});
