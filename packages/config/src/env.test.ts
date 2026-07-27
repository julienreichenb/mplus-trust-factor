import { describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "./index.js";

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
  });

  it("rejects live mode without Blizzard credentials", () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...baseEnv,
        PROVIDER_MODE: "live",
        WCL_CLIENT_ID: "wcl",
        WCL_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/Invalid environment configuration/);
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
});
