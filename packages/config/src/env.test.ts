import { describe, expect, it } from "vitest";
import { getConfigSummary, loadEnv, resetEnvCache } from "./index.js";

const baseEnv = {
  DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public",
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
    expect(env.ACTIVE_SCORE_MODEL_VERSION).toBe(4);
    expect(env.BLIZZARD_ENABLED).toBe(true);
    expect(env.WCL_ENABLED).toBe(true);
    expect(env.RAIDERIO_ENABLED).toBe(true);
    expect(env.ALLOW_LIVE_PROVIDER_CALLS).toBe(false);
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
    expect(JSON.stringify(summary)).not.toContain("secret-value");
    expect(JSON.stringify(summary)).not.toContain("id-value");
  });
});
