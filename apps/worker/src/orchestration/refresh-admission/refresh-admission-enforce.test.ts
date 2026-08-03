/**
 * Stage 3 enforce coverage: admit @ serial concurrency 1.
 * Uses in-memory Redis Lua port — no live Redis or destructive cleanup.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildRefreshAdmissionConfig,
  effectiveAdmissionGlobalConcurrency,
  isRefreshWorkerConcurrencyWiringEnabled,
  type RefreshAdmissionEnv,
} from "@mplus/config";
import {
  createRefreshAdmissionGate,
  estimateRefreshAdmissionWclPoints,
  InMemoryAdmissionRedis,
  predictRefreshAdmission,
  readActiveGlobalSlots,
  readActiveReservedPoints,
  readWclAdmissionSnapshot,
  reconcileExpiredAdmissionLeases,
  RefreshAdmissionError,
  startAdmissionLeaseHeartbeat,
  writeWclAdmissionSnapshot,
  writeSchedulingState,
  REFRESH_ADMISSION_DEFER_REASONS,
} from "./index.js";
import type { RefreshAdmissionPredictInput } from "./types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const baseEnv: RefreshAdmissionEnv = {
  REFRESH_ADMISSION_MODE: "enforce",
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

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function freshSnapshot(overrides: Partial<NonNullable<RefreshAdmissionPredictInput["snapshot"]>> = {}) {
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
    ingestionJobId: JOB_A,
    estimatedWclPoints: 80,
    wclRequired: true,
    snapshot: freshSnapshot(),
    activeReservedPoints: 0,
    activeGlobalSlots: 0,
    nowMs: Date.parse("2026-07-31T12:00:30.000Z"),
    ...overrides,
  };
}

async function seedRedis(redis: InMemoryAdmissionRedis, appEnv = "test") {
  await writeSchedulingState(redis, appEnv, "RUNNING");
  await writeWclAdmissionSnapshot(redis, appEnv, freshSnapshot());
}

describe("refresh admission enforce (serial concurrency 1)", () => {
  it("1. admitted serial refresh reserves slot + points", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({
      env: baseEnv,
      redis,
      appEnv: "test",
    });
    const result = await gate.tryAdmit(baseInput());
    expect(result.outcome).toBe("admitted");
    expect(result.reservedPoints).toBe(80);
    expect(await readActiveGlobalSlots(redis, "test")).toBe(1);
    expect(
      await readActiveReservedPoints(redis, "test", freshSnapshot().windowId!),
    ).toBe(80);
  });

  it("2. denial occurs before provider work (providerCallsAvoided)", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    const denied = await gate.tryAdmit(
      baseInput({ estimatedWclPoints: 9999, snapshot: freshSnapshot({ pointsRemaining: 100 }) }),
    );
    expect(denied.outcome).toBe("deferred");
    expect(denied.providerCallsAvoided).toBe(true);
    expect(denied.prediction.reason).toBe("INSUFFICIENT_RESERVED_CAPACITY");
  });

  it("3. missing WCL snapshot fails closed", async () => {
    const redis = new InMemoryAdmissionRedis();
    await writeSchedulingState(redis, "test", "RUNNING");
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    const result = await gate.tryAdmit(baseInput({ snapshot: null }));
    expect(result.prediction.admitted).toBe(false);
    expect(result.prediction.reason).toBe("SNAPSHOT_MISSING");
    expect(result.providerCallsAvoided).toBe(true);
  });

  it("4. stale WCL snapshot fails closed", async () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const result = predictRefreshAdmission(
      config,
      baseInput({
        snapshot: freshSnapshot({ fetchedAt: "2026-07-31T11:00:00.000Z" }),
        nowMs: Date.parse("2026-07-31T12:00:30.000Z"),
      }),
    );
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("SNAPSHOT_STALE");
  });

  it("5. insufficient normal capacity preserves emergency reserve", async () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    // normalAvailable = 500 - 100 reserve - 0 = 400; estimate 401 → defer
    const result = predictRefreshAdmission(
      config,
      baseInput({
        estimatedWclPoints: 401,
        snapshot: freshSnapshot({ pointsRemaining: 500, pointsLimit: 1000 }),
      }),
    );
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe("INSUFFICIENT_RESERVED_CAPACITY");
    expect(result.emergencyReservePoints).toBe(100);
    expect(result.normalAvailablePoints).toBe(400);
  });

  it("6. hard STOP cannot be bypassed (even emergency)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    const stopped = predictRefreshAdmission(
      config,
      baseInput({ emergencyOverride: true, providerStop: true }),
    );
    expect(stopped.admitted).toBe(false);
    expect(stopped.reason).toBe("PROVIDER_STOP");
  });

  it("7. duplicate admission is idempotent", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    const first = await gate.tryAdmit(baseInput());
    const second = await gate.tryAdmit(baseInput());
    expect(first.outcome).toBe("admitted");
    expect(second.outcome).toBe("admitted");
    expect(second.idempotent || second.prediction.reason === "IDEMPOTENT_EXISTING").toBe(true);
    expect(await readActiveGlobalSlots(redis, "test")).toBe(1);
    expect(
      await readActiveReservedPoints(redis, "test", freshSnapshot().windowId!),
    ).toBe(80);
  });

  it("8. reservation is not double-debited", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    await gate.tryAdmit(baseInput());
    await gate.tryAdmit(baseInput());
    expect(
      await readActiveReservedPoints(redis, "test", freshSnapshot().windowId!),
    ).toBe(80);
  });

  it("9. completion releases reservation and slot", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    await gate.tryAdmit(baseInput());
    const release = await gate.tryRelease(JOB_A, {
      windowId: freshSnapshot().windowId,
      status: "SETTLED",
    });
    expect(release.releasedPoints).toBe(80);
    expect(release.hadSlot).toBe(true);
    expect(await readActiveGlobalSlots(redis, "test")).toBe(0);
    expect(
      await readActiveReservedPoints(redis, "test", freshSnapshot().windowId!),
    ).toBe(0);
  });

  it("10. terminal failure releases reservation and slot", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    await gate.tryAdmit(baseInput());
    await gate.tryRelease(JOB_A, {
      windowId: freshSnapshot().windowId,
      status: "RELEASED",
    });
    expect(await readActiveGlobalSlots(redis, "test")).toBe(0);
  });

  it("11. cancellation releases reservation and slot", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    await gate.tryAdmit(baseInput());
    await gate.tryRelease(JOB_A, {
      windowId: freshSnapshot().windowId,
      status: "CANCELLED",
    });
    expect(await readActiveGlobalSlots(redis, "test")).toBe(0);
    // Idempotent duplicate release
    const second = await gate.tryRelease(JOB_A, {
      windowId: freshSnapshot().windowId,
      status: "CANCELLED",
    });
    expect(second.releasedPoints).toBe(0);
    expect(second.hadSlot).toBe(false);
  });

  it("12. kill-all uses existing cancellation release hook semantics", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    await gate.tryAdmit(baseInput({ ingestionJobId: JOB_A }));
    // Simulate control-center releaseAdmission hook (same as cancel/kill-all).
    const releaseAdmission = async (id: string) => {
      await gate.tryRelease(id, { windowId: freshSnapshot().windowId, status: "CANCELLED" });
    };
    await releaseAdmission(JOB_A);
    expect(await readActiveGlobalSlots(redis, "test")).toBe(0);
  });

  it("13. heartbeat renewal preserves active ownership beyond lease TTL", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({
      env: { ...baseEnv, REFRESH_LEASE_TTL_MS: 1_000, REFRESH_LEASE_HEARTBEAT_MS: 50 },
      redis,
      appEnv: "test",
    });
    await gate.tryAdmit(baseInput());
    const hb = startAdmissionLeaseHeartbeat({
      gate,
      ingestionJobId: JOB_A,
      windowId: freshSnapshot().windowId,
      intervalMs: 40,
    });
    await new Promise((r) => setTimeout(r, 120));
    const renew = await gate.tryRenew(JOB_A, { windowId: freshSnapshot().windowId });
    hb.stop();
    expect(renew.renewed).toBe(true);
    expect(await readActiveGlobalSlots(redis, "test")).toBe(1);
  });

  it("14. expired abandoned ownership can be reconciled", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({
      env: { ...baseEnv, REFRESH_LEASE_TTL_MS: 1_000 },
      redis,
      appEnv: "test",
    });
    const admitAt = Date.parse("2026-07-31T12:00:30.000Z");
    await gate.tryAdmit(baseInput({ nowMs: admitAt }));
    expect(await readActiveGlobalSlots(redis, "test")).toBe(1);

    const jobRepository = {
      findById: vi.fn(async () => null),
    };
    const admissionRepository = {
      findByJobId: vi.fn(async () => ({
        id: "adm",
        jobId: JOB_A,
        status: "RESERVED" as const,
        estimatedWclPoints: 80,
        measuredWclPoints: null,
        windowId: freshSnapshot().windowId!,
        metadata: {},
      })),
      upsertShadowPrediction: vi.fn(),
      upsertReserved: vi.fn(),
      settle: vi.fn(),
      markReleased: vi.fn(),
    };
    // Sweep well after lease expiry (admitAt + 1000ms).
    const result = await reconcileExpiredAdmissionLeases({
      redis,
      appEnv: "test",
      gate,
      jobRepository: jobRepository as never,
      admissionRepository: admissionRepository as never,
      nowMs: admitAt + 60_000,
    });
    expect(result.released).toBeGreaterThanOrEqual(1);
    expect(await readActiveGlobalSlots(redis, "test")).toBe(0);
  });

  it("15. Redis failure cannot fail open", async () => {
    const gate = createRefreshAdmissionGate({
      env: baseEnv,
      redis: null,
      appEnv: "test",
    });
    const result = await gate.tryAdmit(baseInput());
    expect(result.prediction.admitted).toBe(false);
    expect(result.prediction.reason).toBe("REDIS_UNAVAILABLE");
    expect(result.providerCallsAvoided).toBe(true);
    expect(REFRESH_ADMISSION_DEFER_REASONS.has("REDIS_UNAVAILABLE")).toBe(true);
  });

  it("16. measured settlement does not double-subtract provider cost", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const snapBefore = await readWclAdmissionSnapshot(redis, "test");
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    await gate.tryAdmit(baseInput());
    await gate.tryRelease(JOB_A, {
      windowId: freshSnapshot().windowId,
      status: "SETTLED",
    });
    const snapAfter = await readWclAdmissionSnapshot(redis, "test");
    // Live snapshot pointsRemaining unchanged by settlement (provider already spent).
    expect(snapAfter?.pointsRemaining).toBe(snapBefore?.pointsRemaining);
  });

  it("17. refresh Worker claim concurrency is lane hard-max; env wiring stays off", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    expect(effectiveAdmissionGlobalConcurrency(config)).toBe(1);
    expect(isRefreshWorkerConcurrencyWiringEnabled(config)).toBe(false);
    expect(config.workerConcurrency).toBe(1);
    // processors.ts: dual refresh workers claim up to hard-max; Redis lane permits enforce limits.
    const processorsPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../processors.ts",
    );
    const src = readFileSync(processorsPath, "utf8");
    const refreshStart = src.indexOf("const refresh = new Worker(");
    const analyzeStart = src.indexOf("const analyze = new Worker(");
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(analyzeStart).toBeGreaterThan(refreshStart);
    const refreshWorkerBlock = src.slice(refreshStart, analyzeStart);
    expect(refreshWorkerBlock).toContain("QUEUE_NAMES.refreshCharacter");
    expect(refreshWorkerBlock).toContain("QUEUE_NAMES.refreshCharacterCalibration");
    expect(refreshWorkerBlock).toMatch(/lane permits enforce concurrency/);
    expect(refreshWorkerBlock).toMatch(/concurrency:\s*8/);
    expect(isRefreshWorkerConcurrencyWiringEnabled(config)).toBe(false);
  });

  it("18. ETA / priority / retry remain disabled by default (Stage 4 wires ETA behind flag)", () => {
    const config = buildRefreshAdmissionConfig(baseEnv);
    expect(config.etaEnabled).toBe(false);
    expect(config.priorityInBullmq).toBe(false);
    const err = new RefreshAdmissionError({ reason: "INSUFFICIENT_RESERVED_CAPACITY" });
    expect(err.retryable).toBe(false);
    expect(err.providerFailure).toBe(false);
    expect(err.deferred).toBe(true);
    expect(err.code).toBe("REFRESH_ADMISSION_DEFERRED");
  });

  it("serial global slot blocks second job while first holds", async () => {
    const redis = new InMemoryAdmissionRedis();
    await seedRedis(redis);
    const gate = createRefreshAdmissionGate({ env: baseEnv, redis, appEnv: "test" });
    const first = await gate.tryAdmit(baseInput({ ingestionJobId: JOB_A }));
    expect(first.outcome).toBe("admitted");
    const second = await gate.tryAdmit(baseInput({ ingestionJobId: JOB_B }));
    expect(second.prediction.admitted).toBe(false);
    expect(second.prediction.reason).toBe("INSUFFICIENT_GLOBAL_SLOTS");
  });

  it("estimate never reserves 0 for WCL-required work", () => {
    expect(estimateRefreshAdmissionWclPoints({ wclRequired: true })).toBeGreaterThan(0);
    expect(estimateRefreshAdmissionWclPoints({ wclRequired: false })).toBe(0);
  });
});
