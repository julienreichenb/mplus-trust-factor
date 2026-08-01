/**
 * Redis I/O for refresh admission: snapshot mirror, Lua EVAL wrappers, ownership reads.
 * Live snapshot writes are for background refreshers only — admit path never fetches WCL.
 */

import {
  deriveWclWindowId,
  effectiveAdmissionGlobalConcurrency,
  type RefreshAdmissionConfig,
} from "@mplus/config";
import { refreshAdmissionKeys } from "./redis-keys.js";
import {
  REFRESH_ADMISSION_EXPIRED_OWNERS_LUA,
  REFRESH_ADMISSION_RELEASE_LUA,
  REFRESH_ADMISSION_RENEW_LUA,
  REFRESH_ADMISSION_RESERVE_LUA,
} from "./lua-scripts.js";
import type {
  RefreshAdmissionDecisionReason,
  RefreshAdmissionRateSnapshot,
  RefreshAdmissionReleaseResult,
  RefreshSchedulingState,
} from "./types.js";
import { validateAdmissionRateSnapshot } from "./snapshot-validation.js";

export type AdmissionRedis = {
  eval(...args: unknown[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  hmset(key: string, ...args: (string | number)[]): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  exists(...keys: string[]): Promise<number>;
  hexists(key: string, field: string): Promise<number>;
};

export interface ReserveLuaResult {
  ok: boolean;
  reason: RefreshAdmissionDecisionReason | string;
  reservedPoints: number;
  payload: unknown[];
}

export interface RenewLuaResult {
  ok: boolean;
  reason: string;
  leaseExpiresAtMs: number | null;
}

function parseLuaTuple(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  return [];
}

function asReason(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "UNKNOWN");
}

export async function readSchedulingState(
  redis: AdmissionRedis,
  appEnv: string,
): Promise<RefreshSchedulingState> {
  const keys = refreshAdmissionKeys(appEnv);
  const raw = await redis.get(keys.schedulingState);
  if (
    raw === "RUNNING" ||
    raw === "PAUSED" ||
    raw === "RATE_LIMITED" ||
    raw === "CIRCUIT_OPEN" ||
    raw === "DRAINING"
  ) {
    return raw;
  }
  return "RUNNING";
}

export async function writeSchedulingState(
  redis: AdmissionRedis,
  appEnv: string,
  state: RefreshSchedulingState,
): Promise<void> {
  const keys = refreshAdmissionKeys(appEnv);
  await redis.set(keys.schedulingState, state);
}

/**
 * Persist WCL rate snapshot into Redis for the Lua admit path.
 * Call from background refreshers only — never from character-refresh admit.
 * Rejects malformed snapshots and never overwrites a still-valid Redis row with bad data.
 */
export async function writeWclAdmissionSnapshot(
  redis: AdmissionRedis,
  appEnv: string,
  snapshot: RefreshAdmissionRateSnapshot,
  options?: { nowMs?: number },
): Promise<{ written: boolean; reason: string }> {
  const validated = validateAdmissionRateSnapshot(snapshot, { nowMs: options?.nowMs });
  if (!validated.ok || !validated.snapshot) {
    return { written: false, reason: validated.reason };
  }

  const keys = refreshAdmissionKeys(appEnv);
  const normalized = validated.snapshot;
  const windowId = normalized.windowId ?? deriveWclWindowId(normalized.resetAt) ?? "";
  const fetchedAtMs = Date.parse(normalized.fetchedAt);
  await redis.hmset(
    keys.wclSnapshot,
    "pointsRemaining",
    String(Math.floor(normalized.pointsRemaining)),
    "pointsLimit",
    String(Math.floor(normalized.pointsLimit)),
    "fetchedAt",
    String(fetchedAtMs),
    "windowId",
    windowId,
    "resetAt",
    normalized.resetAt ?? "",
  );
  return { written: true, reason: "ok" };
}

export async function readWclAdmissionSnapshot(
  redis: AdmissionRedis,
  appEnv: string,
): Promise<RefreshAdmissionRateSnapshot | null> {
  const keys = refreshAdmissionKeys(appEnv);
  const hash = await redis.hgetall(keys.wclSnapshot);
  if (!hash || Object.keys(hash).length === 0) return null;
  const pointsRemaining = Number(hash.pointsRemaining);
  const pointsLimit = Number(hash.pointsLimit);
  const fetchedAtMs = Number(hash.fetchedAt);
  if (!Number.isFinite(pointsRemaining) || !Number.isFinite(pointsLimit) || !Number.isFinite(fetchedAtMs)) {
    return null;
  }
  return {
    pointsRemaining,
    pointsLimit,
    resetAt: hash.resetAt || null,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    windowId: hash.windowId || deriveWclWindowId(hash.resetAt || null),
  };
}

export async function readActiveReservedPoints(
  redis: AdmissionRedis,
  appEnv: string,
  windowId: string,
): Promise<number> {
  if (!windowId) return 0;
  const keys = refreshAdmissionKeys(appEnv);
  const raw = await redis.get(keys.wclReservedTotal(windowId));
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export async function readActiveGlobalSlots(redis: AdmissionRedis, appEnv: string): Promise<number> {
  const keys = refreshAdmissionKeys(appEnv);
  const raw = await redis.get(keys.slotCount);
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export async function readJobOwnership(
  redis: AdmissionRedis,
  appEnv: string,
  ingestionJobId: string,
  windowId: string | null,
): Promise<{ reservationPoints: number | null; hasSlot: boolean }> {
  const keys = refreshAdmissionKeys(appEnv);
  const hasSlot = (await redis.hexists(keys.slotOwners, ingestionJobId)) === 1;
  let reservationPoints: number | null = null;
  if (windowId) {
    const raw = await redis.hget(keys.wclReservations(windowId), ingestionJobId);
    if (raw != null) {
      const n = Number(raw);
      reservationPoints = Number.isFinite(n) ? n : null;
    }
  }
  return { reservationPoints, hasSlot };
}

export async function resolveJobWindowId(
  redis: AdmissionRedis,
  appEnv: string,
  ingestionJobId: string,
  fallbackWindowId?: string | null,
): Promise<string> {
  const keys = refreshAdmissionKeys(appEnv);
  const fromRedis = await redis.get(keys.jobWindow(ingestionJobId));
  if (fromRedis) return fromRedis;
  return fallbackWindowId ?? "";
}

export async function evalReserveAdmission(input: {
  redis: AdmissionRedis;
  appEnv: string;
  config: RefreshAdmissionConfig;
  ingestionJobId: string;
  estimatedPoints: number;
  emergency: boolean;
  expectedWindowId: string;
  nowMs?: number;
  allowSchedulingStates?: string;
}): Promise<ReserveLuaResult> {
  const nowMs = input.nowMs ?? Date.now();
  const keys = refreshAdmissionKeys(input.appEnv);
  const windowId = input.expectedWindowId || "none";
  const globalLimit = effectiveAdmissionGlobalConcurrency(input.config);
  const leaseExpiry = nowMs + input.config.leaseTtlMs;
  const raw = await input.redis.eval(
    REFRESH_ADMISSION_RESERVE_LUA,
    9,
    keys.schedulingState,
    keys.wclSnapshot,
    keys.wclReservedTotal(windowId),
    keys.wclReservations(windowId),
    keys.wclLeaseZset,
    keys.slotOwners,
    keys.slotLeaseZset,
    keys.slotCount,
    keys.jobWindow(input.ingestionJobId),
    input.ingestionJobId,
    String(Math.max(0, Math.floor(input.estimatedPoints))),
    input.emergency ? "1" : "0",
    String(globalLimit),
    String(leaseExpiry),
    input.expectedWindowId,
    String(nowMs),
    String(input.config.wclSnapshotMaxAgeSeconds * 1000),
    input.allowSchedulingStates ?? "RUNNING",
    String(input.config.safetyReserveFraction),
    String(input.config.minEmergencyReservePoints),
  );
  const tuple = parseLuaTuple(raw);
  const ok = Number(tuple[0]) === 1;
  const reason = asReason(tuple[1]);
  const reservedPoints = ok ? Math.max(0, Number(tuple[2]) || 0) : 0;
  return { ok, reason, reservedPoints, payload: tuple.slice(2) };
}

export async function evalReleaseAdmission(input: {
  redis: AdmissionRedis;
  appEnv: string;
  ingestionJobId: string;
  windowId: string;
}): Promise<RefreshAdmissionReleaseResult> {
  const keys = refreshAdmissionKeys(input.appEnv);
  const windowId = input.windowId || "none";
  const raw = await input.redis.eval(
    REFRESH_ADMISSION_RELEASE_LUA,
    7,
    keys.wclReservedTotal(windowId),
    keys.wclReservations(windowId),
    keys.wclLeaseZset,
    keys.slotOwners,
    keys.slotLeaseZset,
    keys.slotCount,
    keys.jobWindow(input.ingestionJobId),
    input.ingestionJobId,
  );
  const tuple = parseLuaTuple(raw);
  const releasedPoints = Math.max(0, Number(tuple[2]) || 0);
  const hadSlot = Number(tuple[3]) === 1;
  const released = releasedPoints > 0 || hadSlot || Number(tuple[0]) === 1;
  return {
    released,
    reason: asReason(tuple[1] ?? "RELEASED"),
    releasedPoints,
    hadSlot,
  };
}

export async function evalRenewAdmission(input: {
  redis: AdmissionRedis;
  appEnv: string;
  ingestionJobId: string;
  windowId: string;
  leaseTtlMs: number;
  nowMs?: number;
}): Promise<RenewLuaResult> {
  const nowMs = input.nowMs ?? Date.now();
  const leaseExpiry = nowMs + input.leaseTtlMs;
  const keys = refreshAdmissionKeys(input.appEnv);
  const windowId = input.windowId || "none";
  const raw = await input.redis.eval(
    REFRESH_ADMISSION_RENEW_LUA,
    4,
    keys.wclLeaseZset,
    keys.slotOwners,
    keys.slotLeaseZset,
    keys.wclReservations(windowId),
    input.ingestionJobId,
    String(leaseExpiry),
    String(nowMs),
  );
  const tuple = parseLuaTuple(raw);
  const ok = Number(tuple[0]) === 1;
  return {
    ok,
    reason: asReason(tuple[1]),
    leaseExpiresAtMs: ok ? leaseExpiry : null,
  };
}

export async function listExpiredAdmissionOwners(input: {
  redis: AdmissionRedis;
  appEnv: string;
  nowMs?: number;
  limit?: number;
}): Promise<string[]> {
  const keys = refreshAdmissionKeys(input.appEnv);
  const raw = await input.redis.eval(
    REFRESH_ADMISSION_EXPIRED_OWNERS_LUA,
    2,
    keys.wclLeaseZset,
    keys.slotLeaseZset,
    String(input.nowMs ?? Date.now()),
    String(input.limit ?? 50),
  );
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v)).filter(Boolean);
}
