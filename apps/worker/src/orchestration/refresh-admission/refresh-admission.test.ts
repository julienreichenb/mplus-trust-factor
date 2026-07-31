import { describe, expect, it } from "vitest";
import {
  buildRefreshAdmissionConfig,
  type RefreshAdmissionEnv,
} from "@mplus/config";
import {
  createRefreshAdmissionGate,
  predictRefreshAdmission,
  refreshAdmissionKeys,
  REFRESH_ADMISSION_RELEASE_LUA,
  REFRESH_ADMISSION_RESERVE_LUA,
} from "./index.js";
import type { RefreshAdmissionPredictInput } from "./types.js";

const baseEnv: RefreshAdmissionEnv = {
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
};

function freshSnapshot(overrides: Partial<RefreshAdmissionPredictInput["snapshot"]> = {}) {
  const fetchedAt = "2026-07-31T12:00:00.000Z";
  const resetAt = "2026-07-31T13:00:00.000Z";
  return {
    pointsRemaining: 500,
    pointsLimit: 1000,
    resetAt,
    fetchedAt,
    windowId: `win:${Math.floor(Date.parse(resetAt) / 1000)}`,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<RefreshAdmissionPredictInput> = {},
): RefreshAdmissionPredictInput {
  return {
    ingestionJobId: "11111111-1111-4111-8111-111111111111",
    estimatedWclPoints: 80,
    wclRequired: true,
    snapshot: freshSnapshot(),
    activeReservedPoints: 0,
    activeGlobalSlots: 0,
    nowMs: Date.parse("2026-07-31T12:00:30.000Z"),
    ...overrides,
  };
}

describe("refresh admission foundation", () => {
  it("exposes Redis key layout and Lua scripts without executing them", () => {
    const keys = refreshAdmissionKeys("test");
    expect(keys.prefix).toBe("mplus:test:refresh:");
    expect(keys.slotCount).toBe("mplus:test:refresh:slot:count");
    expect(keys.wclReservedTotal("win:1")).toContain("win:1");
    expect(REFRESH_ADMISSION_RESERVE_LUA).toContain("INSUFFICIENT_RESERVED_CAPACITY");
    expect(REFRESH_ADMISSION_RELEASE_LUA).toContain("RELEASED");
  });

  it("mode=off skips prediction admit", () => {
    const config = buildRefreshAdmissionConfig({ ...baseEnv, REFRESH_ADMISSION_MODE: "off" });
    const result = predictRefreshAdmission(config, baseInput());
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("MODE_OFF");
    expect(result.wouldMutateRedis).toBe(false);
  });

  it("shadow admits when capacity exists and never mutates Redis", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(config, baseInput());
    expect(result.admitted).toBe(true);
    expect(result.reason).toBe("OK");
    expect(result.wouldMutateRedis).toBe(false);
    expect(result.emergencyReservePoints).toBe(100);
    expect(result.normalAvailablePoints).toBe(400);
    expect(result.shadowDivergence).toBe(false);
  });

  it("fail-closed on stale snapshot (M4)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({
        nowMs: Date.parse("2026-07-31T12:05:00.000Z"),
      }),
    );
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("SNAPSHOT_STALE");
  });

  it("insufficient normal capacity preserves emergency floor (M13)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({
        estimatedWclPoints: 350,
        snapshot: freshSnapshot({ pointsRemaining: 400 }),
      }),
    );
    // normalAvailable = 400 - 100 - 0 = 300 < 350
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_RESERVED_CAPACITY");
    expect(result.emergencyReservePoints).toBe(100);
  });

  it("emergency lane may use reserve but provider STOP still blocks (M14)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const okEmergency = predictRefreshAdmission(
      config,
      baseInput({
        emergencyOverride: true,
        estimatedWclPoints: 350,
        snapshot: freshSnapshot({ pointsRemaining: 400 }),
      }),
    );
    expect(okEmergency.admitted).toBe(true);
    expect(okEmergency.lane).toBe("emergency");

    const stopped = predictRefreshAdmission(
      config,
      baseInput({ emergencyOverride: true, providerStop: true }),
    );
    expect(stopped.admitted).toBe(false);
    expect(stopped.reason).toBe("PROVIDER_STOP");
  });

  it("non-WCL path needs slot only (M28)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({ wclRequired: false, estimatedWclPoints: 0, snapshot: null }),
    );
    expect(result.admitted).toBe(true);
    expect(result.reason).toBe("NON_WCL_SLOT_ONLY");
  });

  it("idempotent existing reservation / slot (M3)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({ existingReservationPoints: 80, existingGlobalSlot: true }),
    );
    expect(result.admitted).toBe(true);
    expect(result.reason).toBe("IDEMPOTENT_EXISTING");
  });

  it("gate tryAdmit never enables Redis mutation on foundation defaults", async () => {
    const observed: unknown[] = [];
    const gate = createRefreshAdmissionGate({
      env: baseEnv,
      onShadowPrediction: (p) => {
        observed.push(p.reason);
      },
    });
    const result = await gate.tryAdmit(baseInput());
    expect(result.wouldMutateRedis).toBe(false);
    expect(result.metadata.admitPath).toBe("foundation_no_redis_mutation");
    expect(observed).toEqual(["OK"]);

    const release = await gate.tryRelease("11111111-1111-4111-8111-111111111111");
    expect(release).toEqual({ released: false, reason: "redis_mutation_disabled" });
  });

  it("enforce without concurrency flag still refuses Redis mutation", async () => {
    const gate = createRefreshAdmissionGate({
      env: { ...baseEnv, REFRESH_ADMISSION_MODE: "enforce", REFRESH_CONCURRENCY_ENABLED: false },
    });
    expect(gate.config.mode).toBe("enforce");
    const result = await gate.tryAdmit(baseInput());
    expect(result.wouldMutateRedis).toBe(false);
    const release = await gate.tryRelease("x");
    expect(release.released).toBe(false);
  });

  it("shadow divergence when prediction would defer but serial reality proceeds", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({
        estimatedWclPoints: 9999,
        snapshot: freshSnapshot({ pointsRemaining: 100 }),
      }),
    );
    expect(result.admitted).toBe(false);
    expect(result.serialRealityWouldProceed).toBe(true);
    expect(result.shadowDivergence).toBe(true);
  });

  it("module surface is admission-only (no cancel/eligibility fork)", async () => {
    const mod = await import("./index.js");
    expect(mod.createRefreshAdmissionGate).toBeTypeOf("function");
    expect(mod.predictRefreshAdmission).toBeTypeOf("function");
    expect(mod).not.toHaveProperty("cancelRefreshJob");
    expect(mod).not.toHaveProperty("evaluateCharacterRefreshEligibility");
    expect(mod).not.toHaveProperty("killAllRefreshJobs");
  });
});
