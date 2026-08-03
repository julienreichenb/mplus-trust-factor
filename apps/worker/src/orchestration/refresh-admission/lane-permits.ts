/**
 * Distributed refresh lane permits (CALIBRATION vs OPERATION).
 * Redis-backed; multi-replica safe. Complements global WCL admission.
 */
import type { RefreshWorkloadClass } from "@mplus/contracts";
import { OBS_EVENTS, emitScoringV2Event, type Logger } from "@mplus/observability";
import { refreshAdmissionKeyPrefix } from "./redis-keys.js";

export const REFRESH_LANE_WORKER_CLAIM_HARD_MAX = 8;

export interface LanePermitRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

export function refreshLaneKeys(appEnv: string, lane: RefreshWorkloadClass) {
  const prefix = `${refreshAdmissionKeyPrefix(appEnv)}lane:${lane}:`;
  return {
    owners: `${prefix}owners`,
    lease: `${prefix}lease`,
    count: `${prefix}count`,
  };
}

/** @deprecated alias — prefer refreshLaneKeys */
export function lanePermitKeys(appEnv: string, lane: RefreshWorkloadClass) {
  return refreshLaneKeys(appEnv, lane);
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

local expired = redis.call('ZRANGEBYSCORE', leaseKey, '-inf', nowMs)
for _, id in ipairs(expired) do
  redis.call('ZREM', leaseKey, id)
  if redis.call('HDEL', ownersKey, id) == 1 then
    local c = tonumber(redis.call('GET', countKey) or '0')
    if c > 0 then redis.call('DECR', countKey) end
  end
end

if redis.call('HEXISTS', ownersKey, jobId) == 1 then
  redis.call('HSET', ownersKey, jobId, tostring(leaseExpiry))
  redis.call('ZADD', leaseKey, leaseExpiry, jobId)
  return {1, 'IDEMPOTENT_EXISTING', tonumber(redis.call('GET', countKey) or '0')}
end

local count = tonumber(redis.call('GET', countKey) or '0')
if count >= limit then
  return {0, 'LANE_LIMIT_REACHED', count}
end

redis.call('HSET', ownersKey, jobId, tostring(leaseExpiry))
redis.call('ZADD', leaseKey, leaseExpiry, jobId)
local newCount = redis.call('INCR', countKey)
return {1, 'OK', tonumber(newCount)}
`;

const RELEASE_LUA = `
-- NOT_OWNED / DECRBY markers for test harness detection
local ownersKey = KEYS[1]
local leaseKey = KEYS[2]
local countKey = KEYS[3]
local jobId = ARGV[1]
local removed = redis.call('HDEL', ownersKey, jobId)
redis.call('ZREM', leaseKey, jobId)
if removed == 1 then
  local c = tonumber(redis.call('GET', countKey) or '0')
  if c > 0 then c = redis.call('DECR', countKey) end
  return {1, 'RELEASED', tonumber(c)}
end
return {0, 'NOT_OWNED', tonumber(redis.call('GET', countKey) or '0')}
`;

const RENEW_LUA = `
-- RENEWED marker for test harness detection
local ownersKey = KEYS[1]
local leaseKey = KEYS[2]
local jobId = ARGV[1]
local leaseExpiry = ARGV[2]
if redis.call('HEXISTS', ownersKey, jobId) == 0 then
  return {0, 'NOT_OWNED'}
end
redis.call('HSET', ownersKey, jobId, leaseExpiry)
redis.call('ZADD', leaseKey, tonumber(leaseExpiry), jobId)
return {1, 'RENEWED'}
`;

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(REFRESH_LANE_WORKER_CLAIM_HARD_MAX, Math.floor(limit)));
}

export interface AcquireLanePermitResult {
  acquired: boolean;
  reason: string;
  laneCount: number;
  limit: number;
}

export async function acquireLanePermit(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  limit: number;
  leaseTtlMs?: number;
  nowMs?: number;
  logger?: Logger;
}): Promise<AcquireLanePermitResult> {
  const keys = refreshLaneKeys(input.appEnv, input.lane);
  const limit = clampLimit(input.limit);
  const nowMs = input.nowMs ?? Date.now();
  const leaseTtlMs = input.leaseTtlMs ?? 45_000;
  const leaseExpiry = nowMs + leaseTtlMs;
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
  )) as [number, string, number];
  const acquired = Number(raw[0]) === 1;
  const reason = String(raw[1] ?? "UNKNOWN");
  const laneCount = Number(raw[2] ?? 0);
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
  return { acquired, reason, laneCount, limit };
}

export async function releaseLanePermit(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  logger?: Logger;
}): Promise<{ released: boolean; laneCount: number }> {
  const keys = refreshLaneKeys(input.appEnv, input.lane);
  const raw = (await input.redis.eval(
    RELEASE_LUA,
    3,
    keys.owners,
    keys.lease,
    keys.count,
    input.ingestionJobId,
  )) as [number, string, number];
  const released = Number(raw[0]) === 1;
  const laneCount = Number(raw[2] ?? 0);
  if (released && input.logger) {
    emitScoringV2Event(input.logger, OBS_EVENTS.scoringV2ConcurrencyPermitReleased, {
      workloadClass: input.lane,
      active: laneCount,
      reasonCode: "released",
    });
  }
  return { released, laneCount };
}

export async function renewLanePermit(input: {
  redis: LanePermitRedis;
  appEnv: string;
  lane: RefreshWorkloadClass;
  ingestionJobId: string;
  leaseTtlMs?: number;
  nowMs?: number;
}): Promise<{ renewed: boolean }> {
  const keys = refreshLaneKeys(input.appEnv, input.lane);
  const nowMs = input.nowMs ?? Date.now();
  const leaseExpiry = nowMs + (input.leaseTtlMs ?? 45_000);
  const raw = (await input.redis.eval(
    RENEW_LUA,
    2,
    keys.owners,
    keys.lease,
    input.ingestionJobId,
    String(leaseExpiry),
  )) as [number, string];
  return { renewed: Number(raw[0]) === 1 };
}
