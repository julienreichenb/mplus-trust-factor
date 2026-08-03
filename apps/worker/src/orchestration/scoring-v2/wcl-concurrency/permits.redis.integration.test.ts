/**
 * Redis integration tests for WCL concurrency permits.
 * Fail hard when Redis is unavailable — do NOT skip.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import {
  acquireGlobalWclHttpPermit,
  acquirePerCharacterRunPermit,
  acquireSourceSingleflight,
  completeSourceSingleflight,
  releaseGlobalWclHttpPermit,
  releaseSourceSingleflight,
  renewGlobalWclHttpPermit,
  shouldDeferForBudgetReserve,
  wclCharacterPermitKeys,
  wclConcurrencyKeyPrefix,
  wclGlobalPermitKeys,
  wclSingleflightKey,
  WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT,
  WCL_PER_CHARACTER_RUN_CONCURRENCY_DEFAULT,
} from "./permits.js";

const CONNECT_TIMEOUT_MS = 2_000;
const REDIS_URL = process.env.REDIS_URL;

async function probeRedis(url: string): Promise<Redis> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("redis connect timeout")), CONNECT_TIMEOUT_MS);
      }),
    ]);
    const pong = await client.ping();
    if (String(pong).toUpperCase() !== "PONG") throw new Error("unexpected ping");
    return client;
  } catch (err) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function redisUnavailableError(detail: string): Error {
  return new Error(
    `TEST INFRASTRUCTURE: Redis unavailable for WCL concurrency integration (REDIS_URL=${REDIS_URL ?? "<missing>"}): ${detail}`,
  );
}

const runId = randomUUID().slice(0, 12);
const appEnv = `test:wcl-conc-${runId}`;
let redis: Redis;

async function cleanup(): Promise<void> {
  const prefix = wclConcurrencyKeyPrefix(appEnv);
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
  if (!REDIS_URL) throw redisUnavailableError("REDIS_URL missing");
  try {
    redis = await probeRedis(REDIS_URL);
  } catch (err) {
    throw redisUnavailableError(err instanceof Error ? err.message : String(err));
  }
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await redis.quit();
});

describe("WCL concurrency Redis permits", () => {
  it("enforces global HTTP concurrency <= 3", async () => {
    const tokens: Array<{ ownerId: string; token: string }> = [];
    for (let i = 0; i < WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT; i++) {
      const ownerId = `http-${i}`;
      const result = await acquireGlobalWclHttpPermit({
        redis,
        appEnv,
        ownerId,
        limit: WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT,
      });
      expect(result.ok).toBe(true);
      tokens.push({ ownerId, token: result.token });
    }
    const blocked = await acquireGlobalWclHttpPermit({
      redis,
      appEnv,
      ownerId: "http-blocked",
      limit: WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("limit");

    for (const t of tokens) {
      await releaseGlobalWclHttpPermit({
        redis,
        appEnv,
        ownerId: t.ownerId,
        token: t.token,
      });
    }
    const after = await acquireGlobalWclHttpPermit({
      redis,
      appEnv,
      ownerId: "http-after",
      limit: WCL_GLOBAL_HTTP_CONCURRENCY_DEFAULT,
    });
    expect(after.ok).toBe(true);
  });

  it("enforces per-character run concurrency <= 2", async () => {
    const characterId = randomUUID();
    const a = await acquirePerCharacterRunPermit({
      redis,
      appEnv,
      characterId,
      ownerId: "slot-0",
    });
    const b = await acquirePerCharacterRunPermit({
      redis,
      appEnv,
      characterId,
      ownerId: "slot-1",
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const c = await acquirePerCharacterRunPermit({
      redis,
      appEnv,
      characterId,
      ownerId: "slot-2",
    });
    expect(c.ok).toBe(false);

    // Another character can still progress.
    const other = await acquirePerCharacterRunPermit({
      redis,
      appEnv,
      characterId: randomUUID(),
      ownerId: "other-0",
    });
    expect(other.ok).toBe(true);

    expect(WCL_PER_CHARACTER_RUN_CONCURRENCY_DEFAULT).toBe(2);
    void wclCharacterPermitKeys;
    void wclGlobalPermitKeys;
  });

  it("supports source singleflight owner + waiter reuse", async () => {
    const key = wclSingleflightKey(appEnv, "AbCdEf12", 3, 1, "Casts");
    const owner = await acquireSourceSingleflight({ redis, key });
    expect(owner.role).toBe("owner");
    if (owner.role !== "owner") return;

    const waiter = await acquireSourceSingleflight({ redis, key });
    expect(waiter.role).toBe("waiter");

    const completed = await completeSourceSingleflight({
      redis,
      key,
      token: owner.token,
      value: "persisted",
    });
    expect(completed).toBe(true);

    const ready = await acquireSourceSingleflight({ redis, key });
    expect(ready).toEqual({ role: "ready", value: "persisted" });
  });

  it("releases singleflight on failure so waiters can become owners", async () => {
    const key = wclSingleflightKey(appEnv, "AbCdEf12", 4, 1, "Deaths");
    const owner = await acquireSourceSingleflight({ redis, key });
    expect(owner.role).toBe("owner");
    if (owner.role !== "owner") return;
    await releaseSourceSingleflight({ redis, key, token: owner.token });
    const next = await acquireSourceSingleflight({ redis, key });
    expect(next.role).toBe("owner");
  });

  it("renews leases and detects lease loss", async () => {
    const ownerId = "renew-owner";
    const acquired = await acquireGlobalWclHttpPermit({ redis, appEnv, ownerId });
    expect(acquired.ok).toBe(true);
    const renewed = await renewGlobalWclHttpPermit({
      redis,
      appEnv,
      ownerId,
      token: acquired.token,
    });
    expect(renewed.ok).toBe(true);
    const lost = await renewGlobalWclHttpPermit({
      redis,
      appEnv,
      ownerId,
      token: "wrong-token",
    });
    expect(lost.ok).toBe(false);
    expect(lost.reason).toBe("lost");
  });

  it("defers when budget reserve would be breached", () => {
    const decision = shouldDeferForBudgetReserve({
      pointsRemaining: 250,
      pointsLimit: 1000,
      estimatedCost: 60,
      reserveRatio: 0.2,
    });
    expect(decision.defer).toBe(true);
    const ok = shouldDeferForBudgetReserve({
      pointsRemaining: 500,
      pointsLimit: 1000,
      estimatedCost: 10,
      reserveRatio: 0.2,
    });
    expect(ok.defer).toBe(false);
  });
});
