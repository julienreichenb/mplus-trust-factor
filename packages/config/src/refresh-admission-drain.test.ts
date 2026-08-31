import { describe, expect, it } from "vitest";
import {
  buildRefreshAdmissionConfig,
  computePointsResetInSeconds,
  isWclPreResetDrainActive,
  resolveAdmissionReservePolicy,
} from "./refresh-admission-policy.js";

const baseEnv = {
  REFRESH_ADMISSION_MODE: "enforce" as const,
  REFRESH_WORKER_CONCURRENCY: 1,
  REFRESH_GLOBAL_CONCURRENCY: 2,
  REFRESH_WORKER_HARD_MAX: 8,
  REFRESH_GLOBAL_HARD_MAX: 8,
  REFRESH_SAFETY_RESERVE_FRACTION: 0.1,
  REFRESH_MIN_EMERGENCY_RESERVE_POINTS: 50,
  REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
  REFRESH_LEASE_TTL_MS: 45_000,
  REFRESH_LEASE_HEARTBEAT_MS: 15_000,
  REFRESH_ETA_ENABLED: false,
  REFRESH_PRIORITY_IN_BULLMQ: false,
  REFRESH_CONCURRENCY_ENABLED: false,
  WCL_PRE_RESET_DRAIN_SECONDS: 300,
};

describe("WCL pre-reset drain policy", () => {
  it("activates drain inside threshold", () => {
    expect(isWclPreResetDrainActive(120, 300)).toBe(true);
    expect(isWclPreResetDrainActive(600, 300)).toBe(false);
  });

  it("zeros reserve in drain window", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const resetAt = new Date(Date.now() + 120_000).toISOString();
    const policy = resolveAdmissionReservePolicy({ config, resetAt });
    expect(policy.drainActive).toBe(true);
    expect(policy.safetyReserveFraction).toBe(0);
    expect(policy.minEmergencyReservePoints).toBe(0);
  });

  it("keeps reserve outside drain window", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const resetAt = new Date(Date.now() + 900_000).toISOString();
    const policy = resolveAdmissionReservePolicy({ config, resetAt });
    expect(policy.drainActive).toBe(false);
    expect(policy.safetyReserveFraction).toBe(0.1);
    expect(policy.minEmergencyReservePoints).toBe(50);
  });
});

describe("computePointsResetInSeconds", () => {
  it("derives seconds from resetAt", () => {
    const now = Date.now();
    const resetAt = new Date(now + 125_000).toISOString();
    const secs = computePointsResetInSeconds(resetAt, now);
    expect(secs).toBeGreaterThanOrEqual(124);
    expect(secs).toBeLessThanOrEqual(125);
  });
});
