import { describe, expect, it } from "vitest";
import {
  buildRefreshAdmissionConfig,
  type RefreshAdmissionEnv,
} from "@mplus/config";
import {
  createRefreshAdmissionGate,
  predictRefreshAdmission,
  refreshAdmissionKeys,
  classifyAdmissionOwnership,
  simulateReserveLuaOwnershipBranch,
  REFRESH_ADMISSION_RELEASE_LUA,
  REFRESH_ADMISSION_RESERVE_LUA,
  REFRESH_ADMISSION_RESERVE_ARGV,
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

  it("idempotent only when reservation and global slot both exist (M3)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({ existingReservationPoints: 80, existingGlobalSlot: true }),
    );
    expect(result.admitted).toBe(true);
    expect(result.reason).toBe("IDEMPOTENT_EXISTING");
    expect(result.metadata.ownership).toBe("idempotent_full");
  });

  it("rejects WCL reservation without global slot (partial state)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({
        existingReservationPoints: 80,
        existingGlobalSlot: false,
        // Would be ample capacity if inconsistently admitted:
        estimatedWclPoints: 80,
        snapshot: freshSnapshot({ pointsRemaining: 500 }),
      }),
    );
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("INCONSISTENT_RESERVATION_WITHOUT_SLOT");
    expect(result.estimatedWclPoints).toBe(80);
    expect(result.metadata.ownership).toBe("inconsistent_reservation_without_slot");

    const ownership = classifyAdmissionOwnership({
      wclRequired: true,
      estimatedWclPoints: 80,
      existingReservationPoints: 80,
      existingGlobalSlot: false,
    });
    expect(ownership).toEqual({
      kind: "inconsistent_reservation_without_slot",
      reservationPoints: 80,
    });

    const lua = simulateReserveLuaOwnershipBranch({
      existingReservation: 80,
      hasSlot: false,
      estimatedPoints: 80,
    });
    expect(lua.ok).toBe(0);
    expect(lua.reason).toBe("INCONSISTENT_RESERVATION_WITHOUT_SLOT");
    expect(lua.payload).toEqual([80, 0]);
  });

  it("slot without WCL reservation still applies capacity checks (partial state)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);

    const deferred = predictRefreshAdmission(
      config,
      baseInput({
        existingGlobalSlot: true,
        existingReservationPoints: null,
        estimatedWclPoints: 350,
        snapshot: freshSnapshot({ pointsRemaining: 400 }),
        // activeGlobalSlots already counts this job's held slot
        activeGlobalSlots: 1,
      }),
    );
    // normalAvailable = 400 - 100 - 0 = 300 < 350 — must NOT bypass via slot-only idempotent
    expect(deferred.admitted).toBe(false);
    expect(deferred.reason).toBe("INSUFFICIENT_RESERVED_CAPACITY");
    expect(deferred.metadata.ownership).toBe("slot_without_reservation");

    const admitted = predictRefreshAdmission(
      config,
      baseInput({
        existingGlobalSlot: true,
        existingReservationPoints: null,
        estimatedWclPoints: 80,
        activeGlobalSlots: 1,
      }),
    );
    expect(admitted.admitted).toBe(true);
    expect(admitted.reason).toBe("OK");
    expect(admitted.metadata.ownership).toBe("slot_without_reservation");
    expect(admitted.metadata.repairReservation).toBe(true);

    expect(
      classifyAdmissionOwnership({
        wclRequired: true,
        estimatedWclPoints: 80,
        existingGlobalSlot: true,
        existingReservationPoints: null,
      }).kind,
    ).toBe("slot_without_reservation");

    const lua = simulateReserveLuaOwnershipBranch({
      existingReservation: null,
      hasSlot: true,
      estimatedPoints: 80,
    });
    expect(lua.ok).toBe(1);
    expect(lua.reason).toBe("CONTINUE_CAPACITY_CHECKS");
  });

  it("non-WCL jobs may be idempotent on global slot alone", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({
        wclRequired: false,
        estimatedWclPoints: 0,
        existingGlobalSlot: true,
        existingReservationPoints: null,
        snapshot: null,
        activeGlobalSlots: 1,
      }),
    );
    expect(result.admitted).toBe(true);
    expect(result.reason).toBe("IDEMPOTENT_EXISTING");
    expect(result.lane).toBe("non_wcl");
    expect(result.metadata.ownership).toBe("non_wcl_idempotent_slot");
  });

  it("Lua ownership branch matches classifier for full and partial pairs", () => {
    const full = simulateReserveLuaOwnershipBranch({
      existingReservation: 80,
      hasSlot: true,
      estimatedPoints: 80,
    });
    expect(full).toEqual({ ok: 1, reason: "IDEMPOTENT_EXISTING", payload: [80, 1] });
    expect(
      classifyAdmissionOwnership({
        wclRequired: true,
        estimatedWclPoints: 80,
        existingReservationPoints: 80,
        existingGlobalSlot: true,
      }).kind,
    ).toBe("idempotent_full");

    const resOnly = simulateReserveLuaOwnershipBranch({
      existingReservation: 42,
      hasSlot: false,
      estimatedPoints: 42,
    });
    expect(resOnly.ok).toBe(0);
    expect(resOnly.reason).toBe("INCONSISTENT_RESERVATION_WITHOUT_SLOT");

    const slotOnly = simulateReserveLuaOwnershipBranch({
      existingReservation: null,
      hasSlot: true,
      estimatedPoints: 42,
    });
    expect(slotOnly.reason).toBe("CONTINUE_CAPACITY_CHECKS");
  });

  it("documents ARGV[10]/ARGV[11] reserve math knobs in the Lua contract", () => {
    expect(REFRESH_ADMISSION_RESERVE_ARGV.map((a) => a.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(REFRESH_ADMISSION_RESERVE_ARGV[9]).toMatchObject({
      index: 10,
      name: "safetyReserveFraction",
    });
    expect(REFRESH_ADMISSION_RESERVE_ARGV[10]).toMatchObject({
      index: 11,
      name: "minEmergencyReservePoints",
    });

    // Script must bind documented ARGV slots and use them for pointsLimit reserve math.
    expect(REFRESH_ADMISSION_RESERVE_LUA).toMatch(
      /local safetyReserveFraction = tonumber\(ARGV\[10\]\)/,
    );
    expect(REFRESH_ADMISSION_RESERVE_LUA).toMatch(
      /local minEmergencyReservePoints = tonumber\(ARGV\[11\]\)/,
    );
    expect(REFRESH_ADMISSION_RESERVE_LUA).toMatch(
      /math\.floor\(pointsLimit \* safetyReserveFraction\)/,
    );
    expect(REFRESH_ADMISSION_RESERVE_LUA).toMatch(
      /math\.max\(fractionReserve, minEmergencyReservePoints\)/,
    );
    // Must not silently read ARGV[10]/[11] via unnamed tonumber(ARGV[10] or '0.1') only.
    expect(REFRESH_ADMISSION_RESERVE_LUA).not.toMatch(
      /tonumber\(ARGV\[10\] or /,
    );
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
