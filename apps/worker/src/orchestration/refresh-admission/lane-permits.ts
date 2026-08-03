/**
 * Distributed refresh lane permits (CALIBRATION vs OPERATION).
 * Redis-backed; multi-replica safe. Ownership tokens + lease renewal.
 * Complements global WCL admission.
 */
import { randomUUID } from "node:crypto";
import type { RefreshWorkloadClass } from "@mplus/contracts";
import { OBS_EVENTS, emitScoringV2Event, type Logger } from "@mplus/observability";
import { refreshAdmissionKeyPrefix } from "./redis-keys.js";

export const REFRESH_LANE_WORKER_CLAIM_HARD_MAX = 8;
export const REFRESH_LANE_LEASE_TTL_MS = 45_000;
export const REFRESH_LANE_RENEW_INTERVAL_MS = 15_000; // TTL/3

export interface LanePermitRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export function refreshLaneKeys(appEnv: string, lane: RefreshWorkloadClass) {
  const prefix = `${refreshAdmissionKeyPrefix(isolateLaneAppEnv(appEnv))}lane:${lane}:`;
  return {
    owners: `${prefix}owners`,
    lease: `${prefix}lease`,
    count: `${prefix}count`,
  };
}

/**
 * Isolate lane Redis keys under Vitest workers for test/development APP_ENV so
 * parallel test files sharing Redis do not starve each other on OPERATION limit.
 * Production/staging keys are never rewritten.
 */
export function isolateLaneAppEnv(appEnv: string): string {
  const normalized = (appEnv || "development").trim().toLowerCase();
  if (normalized !== "test" && normalized !== "development") {
    return appEnv;
  }
  const vitestWorker =
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? process.env.VITEST_WORKER;
  if (vitestWorker && vitestWorker.length > 0) {
    return `${normalized}:vw-${vitestWorker}`;
  }
  return appEnv;
}

/** @deprecated alias — prefer refreshLaneKeys */
export function lanePermitKeys(appEnv: string, lane: RefreshWorkloadClass) {
  return refreshLaneKeys(appEnv, lane);
}

/** Owners hash value: `token|expiryMs`. */
export function formatLaneOwnerValue(token: string, expiryMs: number): string {
  return `${token}|${expiryMs}`;
}

export function parseLaneOwnerValue(
  raw: string | null | undefined,
): { token: string; expiryMs: number } | null {
  if (raw == null || raw.length === 0) return null;
  const sep = raw.indexOf("|");
  if (sep <= 0 || sep >= raw.length - 1) return null;
  const token = raw.slice(0, sep);
  const expiryMs = Number(raw.slice(sep + 1));
  if (!token || !Number.isFinite(expiryMs)) return null;
  return { token, expiryMs };
}

/**
 * Fail-closed gate for lane Redis: must expose eval and must not be ended/closed.
 * Does not log connection URLs.
 */
export function isLanePermitRedisUsable(redis: unknown): boolean {
  if (redis == null || typeof redis !== "object") return false;
  if (typeof (redis as LanePermitRedis).eval !== "function") return false;
  const status = (redis as { status?: string }).status;
  if (status === "end" || status === "close") return false;
  return true;
}

const ACQUIRE_LUA = `
-- LANE_LIMIT_REACHED marker for test harness detection
local ownersKey = KEYS[1]
local leaseKey = KEYS[2]
local countKey = KEYS[3]
local jobId = ARGV[1]
local limit = tonumber(ARGV[2])
local leaseExpiry = tonumber(ARGV[3])
local nowMs = tonumber(ARGV[4])
local newToken = ARGV[5]

local expired = redis.call('ZRANGEBYSCORE', leaseKey, '-inf', nowMs)
for _, id in ipairs(expired) do
  redis.call('ZREM', leaseKey, id)
  if redis.call('HDEL', ownersKey, id) == 1 then
    local c = tonumber(redis.call('GET', countKey) or '0')
    if c > 0 then redis.call('DECR', countKey) end
  end
end

local existing = redis.call('HGET', ownersKey, jobId)
if existing then
  local sep = string.find(existing, '|', 1, true)
  local existingToken = sep and string.sub(existing, 1, sep - 1) or existing
  local value = existingToken .. '|' .. tostring(leaseExpiry)
  redis.call('HSET', ownersKey, jobId, value)
  redis.call('ZADD', leaseKey, leaseExpiry, jobId)
  return {1, 'IDEMPOTENT_EXISTING', tonumber(redis.call('GET', countKey) or '0'), existingToken}
end

local count = tonumber(redis.call('GET', countKey) or '0')
if count >= limit then
  return {0, 'LANE_LIMIT_REACHED', count, false}
end

local value = newToken .. '|' .. tostring(leaseExpiry)
redis.call('HSET', ownersKey, jobId, value)
redis.call('ZADD', leaseKey, leaseExpiry, jobId)
local newCount = redis.call('INCR', countKey)
return {1, 'OK', tonumber(newCount), newToken}
`;

const RELEASE_LUA = `
-- NOT_OWNED / DECRBY / TOKEN_MISMATCH markers for test harness detection
local ownersKey = KEYS[1]
local leaseKey = KEYS[2]
local countKey = KEYS[3]
local jobId = ARGV[1]
local ownershipToken = ARGV[2]

local existing = redis.call('HGET', ownersKey, jobId)
if not existing then
  return {0, 'NOT_OWNED', tonumber(redis.call('GET', countKey) or '0')}
end

local sep = string.find(existing, '|', 1, true)
local existingToken = sep and string.sub(existing, 1, sep - 1) or existing
if existingToken ~= ownershipToken then
  return {0, 'TOKEN_MISMATCH', tonumber(redis.call('GET', countKey) or '0')}
end

redis.call('HDEL', ownersKey, jobId)
redis.call('ZREM', leaseKey, jobId)
local c = tonumber(redis.call('GET', countKey) or '0')
if c > 0 then c = redis.call('DECR', countKey) end
return {1, 'RELEASED', tonumber(c)}
`;

const RENEW_LUA = `
-- RENEWED / TOKEN_MISMATCH markers for test harness detection
local ownersKey = KEYS[1]
local leaseKey = KEYS[2]
local jobId = ARGV[1]
local leaseExpiry = tonumber(ARGV[2])
local ownershipToken = ARGV[3]

local existing = redis.call('HGET', ownersKey, jobId)
if not existing then
  return {0, 'NOT_OWNED'}
end

local sep = string.find(existing, '|', 1, true)
local existingToken = sep and string.sub(existing, 1, sep - 1) or existing
if existingToken ~= ownershipToken then
  return {0, 'TOKEN_MISMATCH'}
end

local value = ownershipToken .. '|' .. tostring(leaseExpiry)
redis.call('HSET', ownersKey, jobId, value)
redis.call('ZADD', leaseKey, leaseExpiry, jobId)
return {1, 'RENEWED'}
`;

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(REFRESH_LANE_WORKER_CLAIM_HARD_MAX, Math.floor(limit)));
}

function coerceToken(raw: unknown): string | null {
  if (raw == null || raw === false) return null;
  const s = String(raw);
  return s.length > 0 && s !== "false" ? s : null;
}

export interface AcquireLanePermitResult {
  acquired: boolean;
  reason: string;
  laneCount: number;
  limit: number;
  /** Ownership token when acquired (including IDEMPOTENT_EXISTING). */
  token: string | null;
}

export async function acquireLanePermit(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  limit: number;
  leaseTtlMs?: number;
  nowMs?: number;
  /** Optional fixed token for tests; production generates randomUUID. */
  ownershipToken?: string;
  logger?: Logger;
}): Promise<AcquireLanePermitResult> {
  const keys = refreshLaneKeys(input.appEnv, input.lane);
  const limit = clampLimit(input.limit);
  const nowMs = input.nowMs ?? Date.now();
  const leaseTtlMs = input.leaseTtlMs ?? REFRESH_LANE_LEASE_TTL_MS;
  const leaseExpiry = nowMs + leaseTtlMs;
  const newToken = input.ownershipToken ?? randomUUID();
  const raw = (await input.redis.eval(
    ACQUIRE_LUA,
    3,
    keys.owners,
    keys.lease,
    keys.count,
    input.ingestionJobId,
    limit,
    leaseExpiry,
    nowMs,
    newToken,
  )) as [number, string, number, string | false | null];
  const acquired = Number(raw[0]) === 1;
  const reason = String(raw[1] ?? "UNKNOWN");
  const laneCount = Number(raw[2] ?? 0);
  const token = acquired ? coerceToken(raw[3]) : null;
  if (input.logger) {
    emitScoringV2Event(
      input.logger,
      acquired
        ? OBS_EVENTS.scoringV2ConcurrencyPermitAcquired
        : OBS_EVENTS.scoringV2ConcurrencyLimitReached,
      {
        workloadClass: input.lane,
        active: laneCount,
        limit,
        reasonCode: reason,
      },
      acquired ? "info" : "warn",
    );
  }
  return { acquired, reason, laneCount, limit, token };
}

export async function releaseLanePermit(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  ownershipToken: string;
  logger?: Logger;
}): Promise<{ released: boolean; laneCount: number; reason?: string }> {
  const keys = refreshLaneKeys(input.appEnv, input.lane);
  const raw = (await input.redis.eval(
    RELEASE_LUA,
    3,
    keys.owners,
    keys.lease,
    keys.count,
    input.ingestionJobId,
    input.ownershipToken,
  )) as [number, string, number];
  const luaOk = Number(raw[0]) === 1;
  const reason = String(raw[1] ?? "UNKNOWN");
  const laneCount = Number(raw[2] ?? 0);

  // Idempotent: already released (NOT_OWNED) is treated as success.
  if (reason === "TOKEN_MISMATCH") {
    return { released: false, laneCount, reason };
  }
  const released = luaOk || reason === "NOT_OWNED";
  if (luaOk && input.logger) {
    emitScoringV2Event(input.logger, OBS_EVENTS.scoringV2ConcurrencyPermitReleased, {
      workloadClass: input.lane,
      active: laneCount,
      reasonCode: "released",
    });
  }
  return { released, laneCount, reason };
}

export async function renewLanePermit(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  ownershipToken: string;
  leaseTtlMs?: number;
  nowMs?: number;
}): Promise<{ renewed: boolean; reason?: string }> {
  const keys = refreshLaneKeys(input.appEnv, input.lane);
  const nowMs = input.nowMs ?? Date.now();
  const leaseExpiry = nowMs + (input.leaseTtlMs ?? REFRESH_LANE_LEASE_TTL_MS);
  const raw = (await input.redis.eval(
    RENEW_LUA,
    2,
    keys.owners,
    keys.lease,
    input.ingestionJobId,
    String(leaseExpiry),
    input.ownershipToken,
  )) as [number, string];
  const renewed = Number(raw[0]) === 1;
  const reason = String(raw[1] ?? "UNKNOWN");
  return renewed ? { renewed: true, reason } : { renewed: false, reason };
}

export function startLanePermitHeartbeat(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  ownershipToken: string;
  leaseTtlMs?: number;
  renewIntervalMs?: number;
  logger?: Logger;
  nowMs?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  onLost: (info: { reason: string }) => void;
}): { stop: () => Promise<void> } {
  const leaseTtlMs = input.leaseTtlMs ?? REFRESH_LANE_LEASE_TTL_MS;
  const renewIntervalMs = Math.max(
    500,
    input.renewIntervalMs ?? REFRESH_LANE_RENEW_INTERVAL_MS,
  );
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let lostEmitted = false;

  const emitLost = (reason: string) => {
    if (lostEmitted || stopped) return;
    lostEmitted = true;
    try {
      input.onLost({ reason });
    } catch {
      /* caller onLost must not break the timer path */
    }
  };

  const tick = () => {
    if (stopped) return;
    inFlight = (async () => {
      try {
        const result = await renewLanePermit({
          redis: input.redis,
          appEnv: input.appEnv,
          lane: input.lane,
          ingestionJobId: input.ingestionJobId,
          ownershipToken: input.ownershipToken,
          leaseTtlMs,
          nowMs: input.nowMs?.(),
        });
        if (!result.renewed) {
          emitLost(result.reason ?? "NOT_OWNED");
          stopped = true;
          clearIntervalFn(timer);
        }
      } catch {
        emitLost("RENEW_ERROR");
        stopped = true;
        clearIntervalFn(timer);
      } finally {
        inFlight = null;
      }
    })();
  };

  const timer = setIntervalFn(tick, renewIntervalMs);
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }

  return {
    async stop() {
      if (stopped) {
        if (inFlight) await inFlight.catch(() => undefined);
        return;
      }
      stopped = true;
      clearIntervalFn(timer);
      if (inFlight) await inFlight.catch(() => undefined);
    },
  };
}
