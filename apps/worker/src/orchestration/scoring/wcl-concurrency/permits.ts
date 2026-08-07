/**
 * Distributed WCL concurrency controls for Scoring V2 Shadow Canary.
 * Reuses the lane-permit Lua pattern: global HTTP cap, per-character run cap,
 * source singleflight, and rate-budget deferral.
 */
import { randomUUID } from "node:crypto";

export const WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT = 3;
export const WCL_PER_CHARACTER_RUN_CONCURRENCY_DEFAULT = 2;
/** Reserve at least 20% of the hourly WCL point budget. */
export const WCL_BUDGET_RESERVE_RATIO_DEFAULT = 0.2;
export const WCL_PERMIT_LEASE_TTL_MS = 45_000;
export const WCL_PERMIT_RENEW_INTERVAL_MS = 15_000;

export interface WclConcurrencyRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

export function wclConcurrencyKeyPrefix(appEnv: string): string {
  const normalized = (appEnv || "development").trim().toLowerCase();
  const vitestWorker =
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? process.env.VITEST_WORKER;
  const env =
    (normalized === "test" || normalized === "development") && vitestWorker
      ? `${normalized}:vw-${vitestWorker}`
      : appEnv;
  return `mplus:${env}:wcl-v2:`;
}

export function wclGlobalPermitKeys(appEnv: string) {
  const prefix = `${wclConcurrencyKeyPrefix(appEnv)}global:`;
  return { owners: `${prefix}owners`, lease: `${prefix}lease`, count: `${prefix}count` };
}

export function wclCharacterPermitKeys(appEnv: string, characterId: string) {
  const prefix = `${wclConcurrencyKeyPrefix(appEnv)}char:${characterId}:`;
  return { owners: `${prefix}owners`, lease: `${prefix}lease`, count: `${prefix}count` };
}

export function wclSingleflightKey(
  appEnv: string,
  reportCode: string,
  fightId: number,
  reportRevision: number,
  datasetKey: string,
): string {
  return `${wclConcurrencyKeyPrefix(appEnv)}sf:${reportCode}:${fightId}:${reportRevision}:${datasetKey}`;
}

export function wclReportSingleflightKey(appEnv: string, reportCode: string): string {
  return `${wclConcurrencyKeyPrefix(appEnv)}sf-report:${reportCode}`;
}

export function wclBudgetKeys(appEnv: string) {
  const prefix = `${wclConcurrencyKeyPrefix(appEnv)}budget:`;
  return {
    remaining: `${prefix}remaining`,
    limit: `${prefix}limit`,
    updatedAt: `${prefix}updatedAt`,
  };
}

/** Same acquire Lua family as refresh lane permits. */
const ACQUIRE_LUA = `
local owners = KEYS[1]
local lease = KEYS[2]
local count = KEYS[3]
local ownerId = ARGV[1]
local token = ARGV[2]
local limit = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local expiry = now + ttl

-- reclaim expired
local expired = redis.call('ZRANGEBYSCORE', lease, '-inf', now)
for _, id in ipairs(expired) do
  redis.call('HDEL', owners, id)
  redis.call('ZREM', lease, id)
end

local existing = redis.call('HGET', owners, ownerId)
if existing then
  local sep = string.find(existing, '|', 1, true)
  if sep then
    local existingToken = string.sub(existing, 1, sep - 1)
    if existingToken == token then
      redis.call('HSET', owners, ownerId, token .. '|' .. expiry)
      redis.call('ZADD', lease, expiry, ownerId)
      redis.call('SET', count, redis.call('HLEN', owners))
      return {1, 'renewed', redis.call('HLEN', owners)}
    end
  end
  return {0, 'owned_by_other', redis.call('HLEN', owners)}
end

local current = redis.call('HLEN', owners)
if current >= limit then
  return {0, 'limit', current}
end

redis.call('HSET', owners, ownerId, token .. '|' .. expiry)
redis.call('ZADD', lease, expiry, ownerId)
redis.call('SET', count, redis.call('HLEN', owners))
return {1, 'acquired', redis.call('HLEN', owners)}
`;

const RELEASE_LUA = `
local owners = KEYS[1]
local lease = KEYS[2]
local count = KEYS[3]
local ownerId = ARGV[1]
local token = ARGV[2]
local existing = redis.call('HGET', owners, ownerId)
if not existing then
  redis.call('SET', count, redis.call('HLEN', owners))
  return {1, 'absent'}
end
local sep = string.find(existing, '|', 1, true)
local existingToken = sep and string.sub(existing, 1, sep - 1) or existing
if existingToken ~= token then
  return {0, 'token_mismatch'}
end
redis.call('HDEL', owners, ownerId)
redis.call('ZREM', lease, ownerId)
redis.call('SET', count, redis.call('HLEN', owners))
return {1, 'released'}
`;

const RENEW_LUA = `
local owners = KEYS[1]
local lease = KEYS[2]
local count = KEYS[3]
local ownerId = ARGV[1]
local token = ARGV[2]
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local expiry = now + ttl
local existing = redis.call('HGET', owners, ownerId)
if not existing then
  return {0, 'lost'}
end
local sep = string.find(existing, '|', 1, true)
local existingToken = sep and string.sub(existing, 1, sep - 1) or existing
if existingToken ~= token then
  return {0, 'lost'}
end
redis.call('HSET', owners, ownerId, token .. '|' .. expiry)
redis.call('ZADD', lease, expiry, ownerId)
redis.call('SET', count, redis.call('HLEN', owners))
return {1, 'renewed'}
`;

export type WclPermitAcquireResult =
  | { ok: true; token: string; reason: string; holders: number }
  | { ok: false; reason: string; holders: number; token: string };

async function acquirePermit(input: {
  redis: WclConcurrencyRedis;
  keys: { owners: string; lease: string; count: string };
  ownerId: string;
  limit: number;
  token?: string;
  nowMs?: number;
  ttlMs?: number;
}): Promise<WclPermitAcquireResult> {
  const token = input.token ?? randomUUID();
  const now = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? WCL_PERMIT_LEASE_TTL_MS;
  const raw = (await input.redis.eval(
    ACQUIRE_LUA,
    3,
    input.keys.owners,
    input.keys.lease,
    input.keys.count,
    input.ownerId,
    token,
    input.limit,
    now,
    ttl,
  )) as [number, string, number];
  const ok = Number(raw[0]) === 1;
  return {
    ok,
    token,
    reason: String(raw[1]),
    holders: Number(raw[2] ?? 0),
  };
}

async function releasePermit(input: {
  redis: WclConcurrencyRedis;
  keys: { owners: string; lease: string; count: string };
  ownerId: string;
  token: string;
}): Promise<{ ok: boolean; reason: string }> {
  const raw = (await input.redis.eval(
    RELEASE_LUA,
    3,
    input.keys.owners,
    input.keys.lease,
    input.keys.count,
    input.ownerId,
    input.token,
  )) as [number, string];
  return { ok: Number(raw[0]) === 1, reason: String(raw[1]) };
}

async function renewPermit(input: {
  redis: WclConcurrencyRedis;
  keys: { owners: string; lease: string; count: string };
  ownerId: string;
  token: string;
  nowMs?: number;
  ttlMs?: number;
}): Promise<{ ok: boolean; reason: string }> {
  const raw = (await input.redis.eval(
    RENEW_LUA,
    3,
    input.keys.owners,
    input.keys.lease,
    input.keys.count,
    input.ownerId,
    input.token,
    input.nowMs ?? Date.now(),
    input.ttlMs ?? WCL_PERMIT_LEASE_TTL_MS,
  )) as [number, string];
  return { ok: Number(raw[0]) === 1, reason: String(raw[1]) };
}

export async function acquireGlobalWclHttpPermit(input: {
  redis: WclConcurrencyRedis;
  appEnv: string;
  ownerId: string;
  limit?: number;
  token?: string;
}): Promise<WclPermitAcquireResult> {
  return acquirePermit({
    redis: input.redis,
    keys: wclGlobalPermitKeys(input.appEnv),
    ownerId: input.ownerId,
    limit: input.limit ?? WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT,
    token: input.token,
  });
}

export async function releaseGlobalWclHttpPermit(input: {
  redis: WclConcurrencyRedis;
  appEnv: string;
  ownerId: string;
  token: string;
}) {
  return releasePermit({
    redis: input.redis,
    keys: wclGlobalPermitKeys(input.appEnv),
    ownerId: input.ownerId,
    token: input.token,
  });
}

export async function renewGlobalWclHttpPermit(input: {
  redis: WclConcurrencyRedis;
  appEnv: string;
  ownerId: string;
  token: string;
}) {
  return renewPermit({
    redis: input.redis,
    keys: wclGlobalPermitKeys(input.appEnv),
    ownerId: input.ownerId,
    token: input.token,
  });
}

export async function acquirePerCharacterRunPermit(input: {
  redis: WclConcurrencyRedis;
  appEnv: string;
  characterId: string;
  ownerId: string;
  limit?: number;
  token?: string;
}): Promise<WclPermitAcquireResult> {
  return acquirePermit({
    redis: input.redis,
    keys: wclCharacterPermitKeys(input.appEnv, input.characterId),
    ownerId: input.ownerId,
    limit: input.limit ?? WCL_PER_CHARACTER_RUN_CONCURRENCY_DEFAULT,
    token: input.token,
  });
}

export async function releasePerCharacterRunPermit(input: {
  redis: WclConcurrencyRedis;
  appEnv: string;
  characterId: string;
  ownerId: string;
  token: string;
}) {
  return releasePermit({
    redis: input.redis,
    keys: wclCharacterPermitKeys(input.appEnv, input.characterId),
    ownerId: input.ownerId,
    token: input.token,
  });
}

export async function renewPerCharacterRunPermit(input: {
  redis: WclConcurrencyRedis;
  appEnv: string;
  characterId: string;
  ownerId: string;
  token: string;
}) {
  return renewPermit({
    redis: input.redis,
    keys: wclCharacterPermitKeys(input.appEnv, input.characterId),
    ownerId: input.ownerId,
    token: input.token,
  });
}

export type SingleflightAcquireResult =
  | { role: "owner"; token: string }
  | { role: "waiter"; ownerToken: string | null }
  | { role: "ready"; value: string };

/**
 * Distributed singleflight for one source identity.
 * Owner writes result to the same key with a short TTL after persistence.
 */
export async function acquireSourceSingleflight(input: {
  redis: WclConcurrencyRedis;
  key: string;
  token?: string;
  leaseMs?: number;
}): Promise<SingleflightAcquireResult> {
  const token = input.token ?? randomUUID();
  const leaseMs = input.leaseMs ?? WCL_PERMIT_LEASE_TTL_MS;
  const existing = await input.redis.get(input.key);
  if (existing?.startsWith("ready:")) {
    return { role: "ready", value: existing.slice("ready:".length) };
  }
  if (existing?.startsWith("owner:")) {
    return { role: "waiter", ownerToken: existing.slice("owner:".length) };
  }
  const set = await input.redis.set(input.key, `owner:${token}`, "PX", leaseMs, "NX");
  if (set === "OK") {
    return { role: "owner", token };
  }
  const after = await input.redis.get(input.key);
  if (after?.startsWith("ready:")) {
    return { role: "ready", value: after.slice("ready:".length) };
  }
  return { role: "waiter", ownerToken: after?.startsWith("owner:") ? after.slice(6) : null };
}

export async function completeSourceSingleflight(input: {
  redis: WclConcurrencyRedis;
  key: string;
  token: string;
  value: string;
  readyTtlMs?: number;
}): Promise<boolean> {
  const existing = await input.redis.get(input.key);
  if (existing !== `owner:${input.token}`) {
    return false;
  }
  await input.redis.set(
    input.key,
    `ready:${input.value}`,
    "PX",
    input.readyTtlMs ?? 60_000,
  );
  return true;
}

export async function releaseSourceSingleflight(input: {
  redis: WclConcurrencyRedis;
  key: string;
  token: string;
}): Promise<void> {
  const existing = await input.redis.get(input.key);
  if (existing === `owner:${input.token}`) {
    await input.redis.del(input.key);
  }
}

export function shouldDeferForBudgetReserve(input: {
  pointsRemaining: number;
  pointsLimit: number;
  estimatedCost: number;
  reserveRatio?: number;
}): { defer: boolean; reason: string | null } {
  const reserve = input.reserveRatio ?? WCL_BUDGET_RESERVE_RATIO_DEFAULT;
  const reserveFloor = input.pointsLimit * reserve;
  if (input.pointsRemaining - input.estimatedCost < reserveFloor) {
    return {
      defer: true,
      reason: `wcl_budget_reserve_breach:remaining=${input.pointsRemaining};limit=${input.pointsLimit};cost=${input.estimatedCost};reserve=${reserveFloor}`,
    };
  }
  return { defer: false, reason: null };
}
