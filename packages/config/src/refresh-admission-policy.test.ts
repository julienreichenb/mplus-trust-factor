import { describe, expect, it } from "vitest";
import {
  buildRefreshAdmissionConfig,
  clampGlobalConcurrency,
  clampWorkerConcurrency,
  computeEmergencyAvailablePoints,
  computeEmergencyReservePoints,
  computeNormalAvailablePoints,
  deriveWclWindowId,
  isRefreshAdmissionRedisMutationEnabled,
  isRefreshAdmissionShadowEnabled,
  isWclSnapshotFresh,
} from "./refresh-admission-policy.js";
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

describe("refresh admission policy", () => {
  it("defaults keep admission off and concurrency disabled", () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv });
    expect(env.REFRESH_ADMISSION_MODE).toBe("off");
    expect(env.REFRESH_CONCURRENCY_ENABLED).toBe(false);
    expect(env.REFRESH_ETA_ENABLED).toBe(false);
    expect(env.REFRESH_PRIORITY_IN_BULLMQ).toBe(false);
    expect(env.REFRESH_WORKER_CONCURRENCY).toBe(1);
    expect(env.REFRESH_GLOBAL_CONCURRENCY).toBe(2);
    expect(env.REFRESH_WORKER_HARD_MAX).toBe(8);
    expect(env.REFRESH_GLOBAL_HARD_MAX).toBe(8);
    expect(env.REFRESH_MIN_EMERGENCY_RESERVE_POINTS).toBe(50);

    const config = buildRefreshAdmissionConfig(env);
    expect(config.mode).toBe("off");
    expect(config.concurrencyEnabled).toBe(false);
    expect(isRefreshAdmissionRedisMutationEnabled(config)).toBe(false);
    expect(isRefreshAdmissionShadowEnabled(config)).toBe(false);
  });

  it("shadow mode enables prediction but not Redis mutation", () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv, REFRESH_ADMISSION_MODE: "shadow" });
    const config = buildRefreshAdmissionConfig(env);
    expect(isRefreshAdmissionShadowEnabled(config)).toBe(true);
    expect(isRefreshAdmissionRedisMutationEnabled(config)).toBe(false);
  });

  it("enforce alone does not enable Redis mutation without concurrency flag", () => {
    resetEnvCache();
    const env = loadEnv({ ...baseEnv, REFRESH_ADMISSION_MODE: "enforce" });
    const config = buildRefreshAdmissionConfig(env);
    expect(isRefreshAdmissionRedisMutationEnabled(config)).toBe(false);
  });

  it("clamps concurrency knobs to hard maxima", () => {
    expect(clampWorkerConcurrency(100, 8)).toBe(8);
    expect(clampGlobalConcurrency(0, 8)).toBe(1);
    expect(clampWorkerConcurrency(3, 8)).toBe(3);
  });

  it("computes emergency reserve from pointsLimit not pointsRemaining", () => {
    // pointsLimit=1000 → floor(100) = 100; min floor 50 → 100
    expect(computeEmergencyReservePoints(1000, 0.1, 50)).toBe(100);
    // pointsLimit=200 → floor(20)=20; min 50 → 50
    expect(computeEmergencyReservePoints(200, 0.1, 50)).toBe(50);
    // Must not shrink with remaining: same limit always same reserve
    expect(computeEmergencyReservePoints(1000, 0.1, 50)).toBe(100);
  });

  it("computes normal vs emergency available points (M13)", () => {
    const reserve = computeEmergencyReservePoints(1000, 0.1, 50);
    expect(reserve).toBe(100);
    expect(
      computeNormalAvailablePoints({
        pointsRemaining: 400,
        emergencyReservePoints: reserve,
        activeReservedPoints: 50,
      }),
    ).toBe(250);
    expect(
      computeEmergencyAvailablePoints({
        pointsRemaining: 400,
        activeReservedPoints: 50,
      }),
    ).toBe(350);
  });

  it("derives window id and snapshot freshness", () => {
    const resetAt = "2026-07-31T12:00:00.000Z";
    expect(deriveWclWindowId(resetAt)).toBe(`win:${Math.floor(Date.parse(resetAt) / 1000)}`);
    expect(deriveWclWindowId(null)).toBeNull();
    const fetchedAt = resetAt;
    const fetchedMs = Date.parse(fetchedAt);
    expect(
      isWclSnapshotFresh({ fetchedAt, maxAgeSeconds: 60, nowMs: fetchedMs + 30_000 }),
    ).toBe(true);
    expect(
      isWclSnapshotFresh({ fetchedAt, maxAgeSeconds: 60, nowMs: fetchedMs + 61_000 }),
    ).toBe(false);
  });
});
