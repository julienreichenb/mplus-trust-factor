import { describe, expect, it } from "vitest";
import {
  buildRefreshAdmissionConfig,
  computeEmergencyReservePoints,
  computeNormalAvailablePoints,
  resolveAdmissionReservePolicy,
} from "@mplus/config";
import { predictRefreshAdmission } from "./shadow-predict.js";

describe("refresh admission drain predict", () => {
  it("increases disposable budget inside drain window", () => {
    const config = buildRefreshAdmissionConfig({
      REFRESH_ADMISSION_MODE: "shadow",
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
    });
    const now = Date.now();
    const resetNear = new Date(now + 60_000).toISOString();
    const resetFar = new Date(now + 900_000).toISOString();
    const drainPolicy = resolveAdmissionReservePolicy({ config, resetAt: resetNear, nowMs: now });
    const normalPolicy = resolveAdmissionReservePolicy({ config, resetAt: resetFar, nowMs: now });
    const drainAvail = computeNormalAvailablePoints({
      pointsRemaining: 120,
      emergencyReservePoints: computeEmergencyReservePoints(
        1000,
        drainPolicy.safetyReserveFraction,
        drainPolicy.minEmergencyReservePoints,
      ),
      activeReservedPoints: 0,
    });
    const normalAvail = computeNormalAvailablePoints({
      pointsRemaining: 120,
      emergencyReservePoints: computeEmergencyReservePoints(
        1000,
        normalPolicy.safetyReserveFraction,
        normalPolicy.minEmergencyReservePoints,
      ),
      activeReservedPoints: 0,
    });
    expect(drainPolicy.drainActive).toBe(true);
    expect(normalPolicy.drainActive).toBe(false);
    expect(drainAvail).toBeGreaterThan(normalAvail);

    const prediction = predictRefreshAdmission(config, {
      ingestionJobId: "j1",
      estimatedWclPoints: 80,
      wclRequired: true,
      snapshot: {
        pointsRemaining: 120,
        pointsLimit: 1000,
        resetAt: resetNear,
        fetchedAt: new Date(now).toISOString(),
        windowId: "win:1",
      },
      activeReservedPoints: 0,
      activeGlobalSlots: 0,
      nowMs: now,
    });
    expect(prediction.admitted).toBe(true);
    expect(prediction.metadata.drainActive).toBe(true);
  });

  it("still refuses when remaining budget is insufficient", () => {
    const config = buildRefreshAdmissionConfig({
      REFRESH_ADMISSION_MODE: "shadow",
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
    });
    const now = Date.now();
    const result = predictRefreshAdmission(config, {
      ingestionJobId: "j3",
      estimatedWclPoints: 500,
      wclRequired: true,
      snapshot: {
        pointsRemaining: 10,
        pointsLimit: 1000,
        resetAt: new Date(now + 30_000).toISOString(),
        fetchedAt: new Date(now).toISOString(),
        windowId: "win:1",
      },
      activeReservedPoints: 0,
      activeGlobalSlots: 0,
      nowMs: now,
    });
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_RESERVED_CAPACITY");
  });
});
