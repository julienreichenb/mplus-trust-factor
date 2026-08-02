import { describe, expect, it } from "vitest";
import {
  evaluateScoringV2FlagCompatibility,
  getScoringV2FlagSummary,
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

describe("scoring v2 feature flags", () => {
  it("defaults all V2 flags off / fail-closed", () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv });
    const summary = getScoringV2FlagSummary(env);
    expect(summary.enabled).toBe(false);
    expect(summary.selectionEnabled).toBe(false);
    expect(summary.evidenceFetchEnabled).toBe(false);
    expect(summary.dimensionsEnabled).toBe(false);
    expect(summary.publicationEnabled).toBe(false);
    expect(summary.calibrationV2Enabled).toBe(false);
    expect(summary.incompatibleReasons).toEqual([]);
  });

  it("rejects publication without fetch/dimensions/master", () => {
    const reasons = evaluateScoringV2FlagCompatibility({
      SCORING_V2_ENABLED: false,
      SCORING_V2_SELECTION_ENABLED: false,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: false,
      SCORING_V2_DIMENSIONS_ENABLED: false,
      SCORING_V2_PUBLICATION_ENABLED: true,
      SCORING_V2_PERFORMANCE_ENABLED: false,
      SCORING_V2_SURVIVAL_ENABLED: false,
      SCORING_V2_UTILITY_ENABLED: false,
      SCORING_V2_EXPERIENCE_ENABLED: false,
      SCORING_V2_RELATIVE_DAMAGE_MODE: "off",
      SCORING_V2_UTILITY_OPPORTUNITY_MODE: "off",
      SCORING_V2_REFERENCE_COMPARISON_MODE: "off",
      CALIBRATION_V2_ENABLED: false,
    });
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes("PUBLICATION"))).toBe(true);
  });

  it("rejects fetch without selection", () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        ...baseEnv,
        SCORING_V2_ENABLED: "true",
        SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
      }),
    ).toThrow(/SCORING_V2_EVIDENCE_FETCH_ENABLED requires SCORING_V2_SELECTION_ENABLED/);
  });

  it("accepts compatible shadow combo", () => {
    resetEnvCache();
    const env = loadEnv({
      ...baseEnv,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
      SCORING_V2_DIMENSIONS_ENABLED: "true",
      SCORING_V2_PUBLICATION_ENABLED: "false",
    });
    expect(getScoringV2FlagSummary(env).incompatibleReasons).toEqual([]);
  });
});
