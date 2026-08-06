import { describe, expect, it } from "vitest";
import {
  evaluateScoringFlagCompatibility,
  getScoringFlagSummary,
  loadEnv,
  resetEnvCache,
} from "@mplus/config";

const baseEnv = {
  DATABASE_URL: "postgresql://mplus:mplus@localhost:5433/mplus_itest_fixture0001?schema=public",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_API_KEY: "test-admin-key",
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
  PROVIDER_MODE: "fixture",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_BASE_URL: "http://localhost:3000",
} as const;

describe("scoring feature flags", () => {
  it("defaults scoring flags off / fail-closed", () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv });
    const summary = getScoringFlagSummary(env);
    expect(summary.enabled).toBe(false);
    expect(summary.publicationEnabled).toBe(false);
    expect(summary.calibrationEnabled).toBe(false);
    expect(summary.incompatibleReasons).toEqual([]);
  });

  it("rejects publication without SCORING_ENABLED", () => {
    const reasons = evaluateScoringFlagCompatibility({
      SCORING_ENABLED: false,
      SCORING_PUBLICATION_ENABLED: true,
      SCORING_RELATIVE_DAMAGE_MODE: "off",
      SCORING_UTILITY_OPPORTUNITY_MODE: "off",
      SCORING_REFERENCE_COMPARISON_MODE: "off",
      CALIBRATION_ENABLED: false,
    });
    expect(reasons).toContain("SCORING_PUBLICATION_ENABLED requires SCORING_ENABLED");
  });

  it("accepts SCORING_ENABLED alone", () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_ENABLED: "true",
      SCORING_PUBLICATION_ENABLED: "false",
    });
    expect(getScoringFlagSummary(env).incompatibleReasons).toEqual([]);
  });
});
