/**
 * H5 — Real Redis distributed lane-permit integration tests.
 * Uses REDIS_URL from env (local/isolated). Skips cleanly when Redis is unreachable.
 * Keys are namespaced per run and deleted in afterEach/afterAll.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import {
  acquireLanePermit,
  releaseLanePermit,
  renewLanePermit,
  refreshLaneKeys,
  isolateLaneAppEnv,
} from "./lane-permits.js";

const CONNECT_TIMEOUT_MS = 2_000;
const REDIS_URL = process.env.REDIS_URL;

async function probeRedis(url: string): Promise<Redis | null> {
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
    const pong = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("redis ping timeout")), CONNECT_TIMEOUT_MS);
      }),
    ]);
    if (String(pong).toUpperCase() !== "PONG") {
      throw new Error("unexpected ping");
    }
    return client;
  } catch {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}

const runId = randomUUID().slice(0, 12);
/** Unique env so parallel suites / prior runs cannot collide. */
const appEnv = isolateLaneAppEnv(`test:h5-${runId}`);

let redisA: Redis | null = null;
let redisB: Redis | null = null;
let redisAvailable = false;

async function deleteLaneKeys(client: Redis): Promise<void> {
  for (const lane of ["CALIBRATION", "OPERATION"] as const) {
    const keys = refreshLaneKeys(appEnv, lane);
    await client.del(keys.owners, keys.lease, keys.count);
  }
}

beforeAll(async () => {
  if (!REDIS_URL) {
    redisAvailable = false;
    return;
  }
  redisA = await probeRedis(REDIS_URL);
  if (!redisA) {
    redisAvailable = false;
    return;
  }
  redisB = await probeRedis(REDIS_URL);
  if (!redisB) {
    try {
      await redisA.quit();
    } catch {
      redisA.disconnect();
    }
    redisA = null;
    redisAvailable = false;
    return;
  }
  redisAvailable = true;
  await deleteLaneKeys(redisA);
});

afterEach(async () => {
  if (redisA) await deleteLaneKeys(redisA);
});

afterAll(async () => {
  for (const client of [redisA, redisB]) {
    if (!client) continue;
    try {
      await deleteLaneKeys(client);
    } catch {
      /* ignore */
    }
    try {
      await client.quit();
    } catch {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
});

describe("lane-permits redis distributed invariants (H5)", () => {
  function clientsOrSkip(skip: (reason?: string) => void): { a: Redis; b: Redis } {
    if (!REDIS_URL) {
      skip("REDIS_URL not set");
    }
    if (!redisAvailable || !redisA || !redisB) {
      skip("Redis unavailable (connect/ping timeout)");
    }
    return { a: redisA!, b: redisB! };
  }

  it("shares OPERATION limit across two ioredis clients", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const first = await acquireLanePermit({
      redis: a,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "op-a-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(first.acquired).toBe(true);
    expect(first.token).toEqual(expect.any(String));

    const blocked = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "op-b-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(blocked.acquired).toBe(false);
    expect(blocked.reason).toBe("LANE_LIMIT_REACHED");
    expect(blocked.laneCount).toBe(1);
  });

  it("handles atomic race at the lane limit across clients", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const jobs = Array.from({ length: 10 }, (_, i) => ({
      redis: i % 2 === 0 ? a : b,
      ingestionJobId: `race-${i}`,
    }));
    const results = await Promise.all(
      jobs.map((j) =>
        acquireLanePermit({
          redis: j.redis,
          appEnv,
          lane: "CALIBRATION",
          ingestionJobId: j.ingestionJobId,
          limit: 2,
          leaseTtlMs: 30_000,
        }),
      ),
    );
    const acquired = results.filter((r) => r.acquired);
    const limited = results.filter((r) => !r.acquired && r.reason === "LANE_LIMIT_REACHED");
    expect(acquired).toHaveLength(2);
    expect(limited).toHaveLength(8);
    expect(new Set(acquired.map((r) => r.token)).size).toBe(2);
  });

  it("isolates CALIBRATION vs OPERATION capacity", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const cal = await acquireLanePermit({
      redis: a,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cal-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    const op = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "op-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(cal.acquired).toBe(true);
    expect(op.acquired).toBe(true);

    const calBlocked = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cal-2",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(calBlocked.acquired).toBe(false);
    expect(calBlocked.reason).toBe("LANE_LIMIT_REACHED");
  });

  it("rejects renew/release with the wrong ownership token", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const held = await acquireLanePermit({
      redis: a,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-job",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    const badRenew = await renewLanePermit({
      redis: b,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-job",
      ownershipToken: "not-the-owner",
      leaseTtlMs: 30_000,
    });
    expect(badRenew).toEqual({ renewed: false, reason: "TOKEN_MISMATCH" });

    const badRelease = await releaseLanePermit({
      redis: b,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-job",
      ownershipToken: "not-the-owner",
    });
    expect(badRelease).toEqual({ released: false, laneCount: 1, reason: "TOKEN_MISMATCH" });

    const stillBlocked = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-peer",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(stillBlocked.acquired).toBe(false);
  });

  it("reclaims capacity after short lease TTL expiry", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const leaseTtlMs = 250;
    const held = await acquireLanePermit({
      redis: a,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "ttl-stale",
      limit: 1,
      leaseTtlMs,
    });
    expect(held.acquired).toBe(true);

    await new Promise((r) => setTimeout(r, leaseTtlMs + 150));

    const reclaimed = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "ttl-new",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(reclaimed.acquired).toBe(true);
    expect(reclaimed.reason).toBe("OK");
    expect(reclaimed.laneCount).toBe(1);
  });

  it("renewal extends the lease past the original TTL", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const leaseTtlMs = 400;
    const held = await acquireLanePermit({
      redis: a,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "renew-job",
      limit: 1,
      leaseTtlMs,
    });
    expect(held.acquired).toBe(true);

    await new Promise((r) => setTimeout(r, 200));
    const renewed = await renewLanePermit({
      redis: a,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "renew-job",
      ownershipToken: held.token!,
      leaseTtlMs: 5_000,
    });
    expect(renewed).toEqual({ renewed: true, reason: "RENEWED" });

    // Original TTL would have expired; peer must still be blocked because renew extended lease.
    await new Promise((r) => setTimeout(r, 350));
    const blocked = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "renew-peer",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(blocked.acquired).toBe(false);
    expect(blocked.reason).toBe("LANE_LIMIT_REACHED");
  });

  it("release frees capacity so a new acquire succeeds", async ({ skip }) => {
    const { a, b } = clientsOrSkip(skip);

    const held = await acquireLanePermit({
      redis: a,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "rel-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    const released = await releaseLanePermit({
      redis: a,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "rel-1",
      ownershipToken: held.token!,
    });
    expect(released.released).toBe(true);
    expect(released.laneCount).toBe(0);

    const next = await acquireLanePermit({
      redis: b,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "rel-2",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(next.acquired).toBe(true);
    expect(next.reason).toBe("OK");
    expect(next.laneCount).toBe(1);
  });
});
