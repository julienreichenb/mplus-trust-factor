/**
 * M8 / H5 — Real Redis distributed lane-permit integration tests.
 * Requires REDIS_URL (vitest defaults to redis://localhost:6379).
 * Fail hard when Redis is unavailable — do NOT skip.
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
    `TEST INFRASTRUCTURE: Redis unavailable for lane-permits integration (REDIS_URL=${REDIS_URL ?? "<missing>"}): ${detail}`,
  );
}

const runId = randomUUID().slice(0, 12);
/** Unique env so parallel suites / prior runs cannot collide. */
const appEnv = isolateLaneAppEnv(`test:h5-${runId}`);

let redisA: Redis;
let redisB: Redis;

async function deleteLaneKeys(client: Redis): Promise<void> {
  for (const lane of ["CALIBRATION", "OPERATION"] as const) {
    const keys = refreshLaneKeys(appEnv, lane);
    await client.del(keys.owners, keys.lease, keys.count);
  }
}

beforeAll(async () => {
  if (!REDIS_URL) {
    throw redisUnavailableError("REDIS_URL missing");
  }
  try {
    redisA = await probeRedis(REDIS_URL);
    redisB = await probeRedis(REDIS_URL);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw redisUnavailableError(detail);
  }
  await deleteLaneKeys(redisA);
});

afterEach(async () => {
  await deleteLaneKeys(redisA);
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

describe("lane-permits redis distributed invariants (H5/M8)", () => {
  it("shares OPERATION limit across two ioredis clients", async () => {
    const first = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "op-a-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(first.acquired).toBe(true);
    expect(first.token).toEqual(expect.any(String));

    const blocked = await acquireLanePermit({
      redis: redisB,
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

  it("handles atomic race at the lane limit across clients", async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({
      redis: i % 2 === 0 ? redisA : redisB,
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

  it("isolates CALIBRATION vs OPERATION capacity", async () => {
    const cal = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cal-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    const op = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "op-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(cal.acquired).toBe(true);
    expect(op.acquired).toBe(true);

    const calBlocked = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cal-2",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(calBlocked.acquired).toBe(false);
    expect(calBlocked.reason).toBe("LANE_LIMIT_REACHED");
  });

  it("rejects renew/release with the wrong ownership token", async () => {
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-job",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    const badRenew = await renewLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-job",
      ownershipToken: "not-the-owner",
      leaseTtlMs: 30_000,
    });
    expect(badRenew).toEqual({ renewed: false, reason: "TOKEN_MISMATCH" });

    const badRelease = await releaseLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-job",
      ownershipToken: "not-the-owner",
    });
    expect(badRelease).toEqual({ released: false, laneCount: 1, reason: "TOKEN_MISMATCH" });

    const stillBlocked = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "tok-peer",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(stillBlocked.acquired).toBe(false);
  });

  it("reclaims capacity after short lease TTL expiry", async () => {
    const leaseTtlMs = 250;
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "ttl-stale",
      limit: 1,
      leaseTtlMs,
    });
    expect(held.acquired).toBe(true);

    await new Promise((r) => setTimeout(r, leaseTtlMs + 150));

    const reclaimed = await acquireLanePermit({
      redis: redisB,
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

  it("renewal extends the lease past the original TTL", async () => {
    const leaseTtlMs = 400;
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "renew-job",
      limit: 1,
      leaseTtlMs,
    });
    expect(held.acquired).toBe(true);

    await new Promise((r) => setTimeout(r, 200));
    const renewed = await renewLanePermit({
      redis: redisA,
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
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "renew-peer",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(blocked.acquired).toBe(false);
    expect(blocked.reason).toBe("LANE_LIMIT_REACHED");
  });

  it("release frees capacity so a new acquire succeeds", async () => {
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "rel-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    const released = await releaseLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "rel-1",
      ownershipToken: held.token!,
    });
    expect(released.released).toBe(true);
    expect(released.laneCount).toBe(0);

    const next = await acquireLanePermit({
      redis: redisB,
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

  it("reclaims after holder client disconnect (quit) when short lease TTL expires", async () => {
    const leaseTtlMs = 800;
    const holder = await probeRedis(REDIS_URL!);
    try {
      const held = await acquireLanePermit({
        redis: holder,
        appEnv,
        lane: "OPERATION",
        ingestionJobId: "disc-hold",
        limit: 1,
        leaseTtlMs,
      });
      expect(held.acquired).toBe(true);

      // Quit without release — peer cannot free capacity until TTL reclaim.
      await holder.quit();

      const blocked = await acquireLanePermit({
        redis: redisB,
        appEnv,
        lane: "OPERATION",
        ingestionJobId: "disc-peer-early",
        limit: 1,
        leaseTtlMs: 30_000,
      });
      expect(blocked.acquired).toBe(false);
      expect(blocked.reason).toBe("LANE_LIMIT_REACHED");

      await new Promise((r) => setTimeout(r, leaseTtlMs + 200));

      const reclaimed = await acquireLanePermit({
        redis: redisB,
        appEnv,
        lane: "OPERATION",
        ingestionJobId: "disc-peer-reclaim",
        limit: 1,
        leaseTtlMs: 30_000,
      });
      expect(reclaimed.acquired).toBe(true);
      expect(reclaimed.reason).toBe("OK");
    } finally {
      try {
        holder.disconnect();
      } catch {
        /* already quit */
      }
    }
  });

  it("reconnects and retries acquire after client reconnect", async () => {
    const client = await probeRedis(REDIS_URL!);
    try {
      const first = await acquireLanePermit({
        redis: client,
        appEnv,
        lane: "CALIBRATION",
        ingestionJobId: "reconn-1",
        limit: 1,
        leaseTtlMs: 30_000,
      });
      expect(first.acquired).toBe(true);

      await releaseLanePermit({
        redis: client,
        appEnv,
        lane: "CALIBRATION",
        ingestionJobId: "reconn-1",
        ownershipToken: first.token!,
      });

      await client.quit();
      // Fresh connection after disconnect — acquire must succeed again.
      const reconnected = await probeRedis(REDIS_URL!);
      try {
        const second = await acquireLanePermit({
          redis: reconnected,
          appEnv,
          lane: "CALIBRATION",
          ingestionJobId: "reconn-2",
          limit: 1,
          leaseTtlMs: 30_000,
        });
        expect(second.acquired).toBe(true);
        expect(second.reason).toBe("OK");
      } finally {
        await reconnected.quit().catch(() => reconnected.disconnect());
      }
    } finally {
      try {
        client.disconnect();
      } catch {
        /* already quit */
      }
    }
  });

  it("applies dynamic CALIBRATION limit change without restart (limit arg per acquire)", async () => {
    const a = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "dyn-cal-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(a.acquired).toBe(true);

    const blockedAtOld = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "dyn-cal-2",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(blockedAtOld.acquired).toBe(false);
    expect(blockedAtOld.reason).toBe("LANE_LIMIT_REACHED");

    // Raise limit on next acquire without restarting Redis / workers.
    const raised = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "dyn-cal-2",
      limit: 2,
      leaseTtlMs: 30_000,
    });
    expect(raised.acquired).toBe(true);
    expect(raised.limit).toBe(2);
    expect(raised.laneCount).toBe(2);
  });

  it("applies dynamic OPERATION limit change without restart (limit arg per acquire)", async () => {
    const a = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "dyn-op-1",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(a.acquired).toBe(true);

    const blockedAtOld = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "dyn-op-2",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(blockedAtOld.acquired).toBe(false);

    const raised = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "dyn-op-2",
      limit: 2,
      leaseTtlMs: 30_000,
    });
    expect(raised.acquired).toBe(true);
    expect(raised.limit).toBe(2);
    expect(raised.laneCount).toBe(2);
  });

  it("cancellation cleanup: releaseLanePermit frees capacity", async () => {
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cancel-job",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    const released = await releaseLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cancel-job",
      ownershipToken: held.token!,
    });
    expect(released.released).toBe(true);
    expect(released.laneCount).toBe(0);

    const next = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cancel-next",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(next.acquired).toBe(true);
    expect(next.laneCount).toBe(1);
  });

  it("failure cleanup: release on failure path leaves no capacity leak", async () => {
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "fail-job",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    // Simulate failure-path finally: release ownership so peers are not starved.
    const released = await releaseLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "fail-job",
      ownershipToken: held.token!,
    });
    expect(released.released).toBe(true);
    expect(released.laneCount).toBe(0);

    const next = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "fail-next",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(next.acquired).toBe(true);
    expect(next.reason).toBe("OK");
  });

  /**
   * Cross-lane capacity is independent in Redis.
   * Same-character exclusion is NOT enforced by lane Redis permits — it lives in job
   * dedupe / winner-guard outside this suite (no Redis character-lock API on lane keys).
   */
  it("cross-lane: CALIBRATION and OPERATION hold permits simultaneously (capacity independent; same-character exclusion not in lane Redis)", async () => {
    const cal = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "cross-cal-job",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    const op = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "cross-op-job",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(cal.acquired).toBe(true);
    expect(op.acquired).toBe(true);
    expect(cal.laneCount).toBe(1);
    expect(op.laneCount).toBe(1);
  });

  it("long-running renewal loop keeps lease past multiple original TTLs", async () => {
    const leaseTtlMs = 400;
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "long-renew",
      limit: 1,
      leaseTtlMs,
    });
    expect(held.acquired).toBe(true);

    // Renew past >2x original TTL (renew loop beyond a single extension).
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const renewed = await renewLanePermit({
        redis: redisA,
        appEnv,
        lane: "OPERATION",
        ingestionJobId: "long-renew",
        ownershipToken: held.token!,
        leaseTtlMs,
      });
      expect(renewed).toEqual({ renewed: true, reason: "RENEWED" });
    }

    const blocked = await acquireLanePermit({
      redis: redisB,
      appEnv,
      lane: "OPERATION",
      ingestionJobId: "long-renew-peer",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(blocked.acquired).toBe(false);
    expect(blocked.reason).toBe("LANE_LIMIT_REACHED");
  });

  it("ownership loss during execution: delete lease ownership mid-hold → renew NOT_OWNED (no provider admission after lease loss)", async () => {
    const held = await acquireLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "lost-own",
      limit: 1,
      leaseTtlMs: 30_000,
    });
    expect(held.acquired).toBe(true);

    const keys = refreshLaneKeys(appEnv, "CALIBRATION");
    // Simulate external ownership loss (lease zset + owners hash cleared for job).
    await redisB.zrem(keys.lease, "lost-own");
    await redisB.hdel(keys.owners, "lost-own");
    const countRaw = await redisB.get(keys.count);
    const count = Number(countRaw ?? "0");
    if (count > 0) await redisB.decr(keys.count);

    const renew = await renewLanePermit({
      redis: redisA,
      appEnv,
      lane: "CALIBRATION",
      ingestionJobId: "lost-own",
      ownershipToken: held.token!,
      leaseTtlMs: 30_000,
    });
    expect(renew.renewed).toBe(false);
    expect(["NOT_OWNED", "TOKEN_MISMATCH"]).toContain(renew.reason);
    // Unit-level "no provider admission after lease loss" is covered elsewhere;
    // here we assert renew failure reason after ownership delete.
  });
});
