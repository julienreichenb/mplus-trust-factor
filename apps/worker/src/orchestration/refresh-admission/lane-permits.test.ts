import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLanePermit,
  releaseLanePermit,
  renewLanePermit,
  refreshLaneKeys,
  startLanePermitHeartbeat,
  isLanePermitRedisUsable,
  formatLaneOwnerValue,
  parseLaneOwnerValue,
  REFRESH_LANE_WORKER_CLAIM_HARD_MAX,
  REFRESH_LANE_LEASE_TTL_MS,
  REFRESH_LANE_RENEW_INTERVAL_MS,
  type LanePermitRedis,
} from "./lane-permits.js";

/**
 * Minimal in-memory port of the lane-permit Lua scripts (hash/zset/string only).
 * Owners values are `token|expiryMs`.
 */
class InMemoryLaneRedis implements LanePermitRedis {
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();
  private strings = new Map<string, number>();

  /** Inspect owner value for tests. */
  getOwner(ownersKey: string, jobId: string): string | undefined {
    return this.hashes.get(ownersKey)?.get(jobId);
  }

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);

    if (script.includes("LANE_LIMIT_REACHED")) return this.acquire(keys, argv);
    if (script.includes("NOT_OWNED") && script.includes("DECR")) return this.release(keys, argv);
    if (script.includes("RENEWED")) return this.renew(keys, argv);
    throw new Error("unknown script");
  }

  private hash(key: string): Map<string, string> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }

  private zset(key: string): Map<string, number> {
    let z = this.zsets.get(key);
    if (!z) {
      z = new Map();
      this.zsets.set(key, z);
    }
    return z;
  }

  private parseOwner(raw: string): { token: string; expiryMs: number } {
    const sep = raw.indexOf("|");
    if (sep <= 0) return { token: raw, expiryMs: 0 };
    return { token: raw.slice(0, sep), expiryMs: Number(raw.slice(sep + 1)) };
  }

  private acquire(keys: string[], argv: string[]): unknown[] {
    const [ownersKey, leaseKey, countKey] = keys;
    const [jobId, limitStr, leaseExpiryStr, nowMsStr, newToken] = argv;
    const limit = Number(limitStr);
    const leaseExpiry = Number(leaseExpiryStr);
    const nowMs = Number(nowMsStr);
    const owners = this.hash(ownersKey!);
    const lease = this.zset(leaseKey!);

    for (const [id, score] of [...lease.entries()]) {
      if (score <= nowMs) {
        lease.delete(id);
        if (owners.delete(id)) {
          this.strings.set(countKey!, Math.max(0, (this.strings.get(countKey!) ?? 0) - 1));
        }
      }
    }

    if (owners.has(jobId!)) {
      const existingToken = this.parseOwner(owners.get(jobId!)!).token;
      owners.set(jobId!, formatLaneOwnerValue(existingToken, leaseExpiry));
      lease.set(jobId!, leaseExpiry);
      return [1, "IDEMPOTENT_EXISTING", this.strings.get(countKey!) ?? 0, existingToken];
    }

    const count = Math.max(0, this.strings.get(countKey!) ?? 0);
    if (count >= limit) {
      return [0, "LANE_LIMIT_REACHED", count, false];
    }
    owners.set(jobId!, formatLaneOwnerValue(newToken!, leaseExpiry));
    lease.set(jobId!, leaseExpiry);
    const newCount = count + 1;
    this.strings.set(countKey!, newCount);
    return [1, "OK", newCount, newToken];
  }

  private release(keys: string[], argv: string[]): unknown[] {
    const [ownersKey, leaseKey, countKey] = keys;
    const [jobId, ownershipToken] = argv;
    const owners = this.hash(ownersKey!);
    const lease = this.zset(leaseKey!);
    const existing = owners.get(jobId!);
    if (!existing) {
      return [0, "NOT_OWNED", Math.max(0, this.strings.get(countKey!) ?? 0)];
    }
    const { token } = this.parseOwner(existing);
    if (token !== ownershipToken) {
      return [0, "TOKEN_MISMATCH", Math.max(0, this.strings.get(countKey!) ?? 0)];
    }
    owners.delete(jobId!);
    lease.delete(jobId!);
    const newCount = Math.max(0, (this.strings.get(countKey!) ?? 0) - 1);
    this.strings.set(countKey!, newCount);
    return [1, "RELEASED", newCount];
  }

  private renew(keys: string[], argv: string[]): unknown[] {
    const [ownersKey, leaseKey] = keys;
    const [jobId, leaseExpiryStr, ownershipToken] = argv;
    const owners = this.hash(ownersKey!);
    const existing = owners.get(jobId!);
    if (!existing) return [0, "NOT_OWNED"];
    const { token } = this.parseOwner(existing);
    if (token !== ownershipToken) return [0, "TOKEN_MISMATCH"];
    const leaseExpiry = Number(leaseExpiryStr);
    owners.set(jobId!, formatLaneOwnerValue(token, leaseExpiry));
    this.zset(leaseKey!).set(jobId!, leaseExpiry);
    return [1, "RENEWED"];
  }
}

describe("lane-permits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquires up to the configured limit then reports LANE_LIMIT_REACHED", async () => {
    const redis = new InMemoryLaneRedis();
    const base = { redis, appEnv: "test", lane: "CALIBRATION" as const, limit: 2, nowMs: 1_000 };

    const first = await acquireLanePermit({ ...base, ingestionJobId: "job-1" });
    expect(first.acquired).toBe(true);
    expect(first.reason).toBe("OK");
    expect(first.laneCount).toBe(1);
    expect(first.limit).toBe(2);
    expect(first.token).toEqual(expect.any(String));
    expect(first.token!.length).toBeGreaterThan(0);

    const second = await acquireLanePermit({ ...base, ingestionJobId: "job-2" });
    expect(second.acquired).toBe(true);
    expect(second.laneCount).toBe(2);
    expect(second.token).toEqual(expect.any(String));

    const third = await acquireLanePermit({ ...base, ingestionJobId: "job-3" });
    expect(third).toEqual({
      acquired: false,
      reason: "LANE_LIMIT_REACHED",
      laneCount: 2,
      limit: 2,
      token: null,
    });
  });

  it("acquire returns an ownership token stored as token|expiryMs", async () => {
    const redis = new InMemoryLaneRedis();
    const result = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-token",
      limit: 1,
      nowMs: 1_000,
      leaseTtlMs: 5_000,
      ownershipToken: "fixed-token-1",
    });
    expect(result.acquired).toBe(true);
    expect(result.token).toBe("fixed-token-1");
    const keys = refreshLaneKeys("test", "OPERATION");
    expect(redis.getOwner(keys.owners, "job-token")).toBe(
      formatLaneOwnerValue("fixed-token-1", 6_000),
    );
  });

  it("is idempotent for a job that already holds a permit and returns existing token", async () => {
    const redis = new InMemoryLaneRedis();
    const base = { redis, appEnv: "test", lane: "OPERATION" as const, limit: 1, nowMs: 1_000 };

    const first = await acquireLanePermit({
      ...base,
      ingestionJobId: "job-1",
      ownershipToken: "tok-a",
    });
    expect(first.acquired).toBe(true);
    expect(first.token).toBe("tok-a");

    const again = await acquireLanePermit({
      ...base,
      ingestionJobId: "job-1",
      nowMs: 2_000,
      ownershipToken: "tok-b-ignored",
    });
    expect(again).toEqual({
      acquired: true,
      reason: "IDEMPOTENT_EXISTING",
      laneCount: 1,
      limit: 1,
      token: "tok-a",
    });
  });

  it("releases a held permit and frees capacity for a new acquire", async () => {
    const redis = new InMemoryLaneRedis();
    const base = { redis, appEnv: "test", lane: "CALIBRATION" as const, limit: 1, nowMs: 1_000 };

    const held = await acquireLanePermit({ ...base, ingestionJobId: "job-1" });
    const release = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "job-1",
      ownershipToken: held.token!,
    });
    expect(release).toEqual({ released: true, laneCount: 0, reason: "RELEASED" });

    const next = await acquireLanePermit({ ...base, ingestionJobId: "job-2" });
    expect(next.acquired).toBe(true);
  });

  it("idempotent release after already released", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      limit: 1,
      nowMs: 1_000,
    });
    const first = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      ownershipToken: held.token!,
    });
    expect(first.released).toBe(true);
    const second = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      ownershipToken: held.token!,
    });
    expect(second.released).toBe(true);
    expect(second.reason).toBe("NOT_OWNED");
    expect(second.laneCount).toBe(0);
  });

  it("wrong token release fails and permit remains", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "job-1",
      limit: 1,
      nowMs: 1_000,
    });
    const bad = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "job-1",
      ownershipToken: "wrong-token",
    });
    expect(bad).toEqual({ released: false, laneCount: 1, reason: "TOKEN_MISMATCH" });

    const blocked = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "job-2",
      limit: 1,
      nowMs: 1_100,
    });
    expect(blocked.acquired).toBe(false);

    const good = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "job-1",
      ownershipToken: held.token!,
    });
    expect(good.released).toBe(true);
  });

  it("reaps expired leases so a crashed worker's permit can be reclaimed", async () => {
    const redis = new InMemoryLaneRedis();
    await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "stale-job",
      limit: 1,
      leaseTtlMs: 1_000,
      nowMs: 0,
    });

    const result = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "new-job",
      limit: 1,
      nowMs: 5_000,
    });
    expect(result.acquired).toBe(true);
    expect(result.reason).toBe("OK");
    expect(result.laneCount).toBe(1);
    expect(result.token).toEqual(expect.any(String));
  });

  it("multiple renewals succeed with the correct token", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      limit: 1,
      nowMs: 0,
      leaseTtlMs: 1_000,
    });
    for (const t of [200, 400, 600]) {
      const renewed = await renewLanePermit({
        redis,
        appEnv: "test",
        lane: "OPERATION",
        ingestionJobId: "job-1",
        ownershipToken: held.token!,
        nowMs: t,
        leaseTtlMs: 1_000,
      });
      expect(renewed).toEqual({ renewed: true, reason: "RENEWED" });
    }
  });

  it("wrong token renew fails", async () => {
    const redis = new InMemoryLaneRedis();
    await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      limit: 1,
      nowMs: 0,
    });
    const bad = await renewLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      ownershipToken: "not-the-owner",
      nowMs: 500,
    });
    expect(bad).toEqual({ renewed: false, reason: "TOKEN_MISMATCH" });
  });

  it("renew after deleted permit fails", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      limit: 1,
      nowMs: 0,
    });
    await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      ownershipToken: held.token!,
    });
    const after = await renewLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      ownershipToken: held.token!,
      nowMs: 500,
    });
    expect(after).toEqual({ renewed: false, reason: "NOT_OWNED" });
  });

  it("heartbeat renews via injectable setInterval", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "hb-job",
      limit: 1,
      nowMs: 0,
      leaseTtlMs: 1_000,
    });

    let now = 0;
    const timers = new Map<ReturnType<typeof setInterval>, { fn: () => void; ms: number }>();
    let nextId = 1;
    const setIntervalFn = ((fn: () => void, ms: number) => {
      const id = nextId++ as unknown as ReturnType<typeof setInterval>;
      timers.set(id, { fn, ms });
      return id;
    }) as typeof setInterval;
    const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
      timers.delete(id);
    }) as typeof clearInterval;

    const lost: string[] = [];
    const hb = startLanePermitHeartbeat({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "hb-job",
      ownershipToken: held.token!,
      leaseTtlMs: 1_000,
      renewIntervalMs: 100,
      nowMs: () => now,
      setIntervalFn,
      clearIntervalFn,
      onLost: (info) => lost.push(info.reason),
    });

    expect(timers.size).toBe(1);
    now = 150;
    for (const { fn } of timers.values()) fn();
    await Promise.resolve();
    await Promise.resolve();

    const keys = refreshLaneKeys("test", "CALIBRATION");
    expect(redis.getOwner(keys.owners, "hb-job")).toBe(
      formatLaneOwnerValue(held.token!, 1_150),
    );
    expect(lost).toHaveLength(0);

    now = 300;
    for (const { fn } of timers.values()) fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(redis.getOwner(keys.owners, "hb-job")).toBe(
      formatLaneOwnerValue(held.token!, 1_300),
    );

    await hb.stop();
    expect(timers.size).toBe(0);
  });

  it("heartbeat onLost when renew fails after release", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "lost-job",
      limit: 1,
      nowMs: 0,
    });

    const timers = new Map<ReturnType<typeof setInterval>, () => void>();
    let nextId = 1;
    const setIntervalFn = ((fn: () => void) => {
      const id = nextId++ as unknown as ReturnType<typeof setInterval>;
      timers.set(id, fn);
      return id;
    }) as typeof setInterval;
    const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
      timers.delete(id);
    }) as typeof clearInterval;

    const lost: string[] = [];
    startLanePermitHeartbeat({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "lost-job",
      ownershipToken: held.token!,
      renewIntervalMs: 50,
      setIntervalFn,
      clearIntervalFn,
      onLost: (info) => lost.push(info.reason),
    });

    await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "lost-job",
      ownershipToken: held.token!,
    });

    for (const fn of timers.values()) fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(lost).toContain("NOT_OWNED");
    expect(timers.size).toBe(0);
  });

  it("clamps requested limits to the worker claim hard max", () => {
    expect(REFRESH_LANE_WORKER_CLAIM_HARD_MAX).toBe(8);
    expect(REFRESH_LANE_LEASE_TTL_MS).toBe(45_000);
    expect(REFRESH_LANE_RENEW_INTERVAL_MS).toBe(15_000);
  });

  it("parses and formats owner values", () => {
    expect(formatLaneOwnerValue("abc", 99)).toBe("abc|99");
    expect(parseLaneOwnerValue("abc|99")).toEqual({ token: "abc", expiryMs: 99 });
    expect(parseLaneOwnerValue("bad")).toBeNull();
  });

  it("isLanePermitRedisUsable rejects ended/closed or missing eval", () => {
    expect(isLanePermitRedisUsable(null)).toBe(false);
    expect(isLanePermitRedisUsable({})).toBe(false);
    expect(isLanePermitRedisUsable({ eval: async () => null, status: "ready" })).toBe(true);
    expect(isLanePermitRedisUsable({ eval: async () => null, status: "end" })).toBe(false);
    expect(isLanePermitRedisUsable({ eval: async () => null, status: "close" })).toBe(false);
  });

  it("builds environment-scoped, lane-scoped Redis keys", () => {
    const keys = refreshLaneKeys("production", "CALIBRATION");
    expect(keys.owners).toBe("mplus:production:refresh:lane:CALIBRATION:owners");
    expect(keys.lease).toBe("mplus:production:refresh:lane:CALIBRATION:lease");
    expect(keys.count).toBe("mplus:production:refresh:lane:CALIBRATION:count");
  });

  it("isolates Vitest worker lane keys when VITEST_POOL_ID is set", () => {
    const prev = process.env.VITEST_POOL_ID;
    process.env.VITEST_POOL_ID = "7";
    try {
      const keys = refreshLaneKeys("test", "OPERATION");
      expect(keys.owners).toBe("mplus:test:vw-7:refresh:lane:OPERATION:owners");
    } finally {
      if (prev === undefined) delete process.env.VITEST_POOL_ID;
      else process.env.VITEST_POOL_ID = prev;
    }
  });

  it("handles concurrent acquire races at the lane limit atomically", async () => {
    const redis = new InMemoryLaneRedis();
    const base = {
      redis,
      appEnv: "test",
      lane: "CALIBRATION" as const,
      limit: 2,
      nowMs: 1_000,
      leaseMs: 60_000,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        acquireLanePermit({ ...base, ingestionJobId: `race-${i}` }),
      ),
    );
    const acquired = results.filter((r) => r.acquired);
    const limited = results.filter((r) => !r.acquired && r.reason === "LANE_LIMIT_REACHED");
    expect(acquired).toHaveLength(2);
    expect(limited).toHaveLength(6);
    for (const r of acquired) {
      expect(r.token).toEqual(expect.any(String));
    }
  });

  it("isolates CALIBRATION and OPERATION lane capacity", async () => {
    const redis = new InMemoryLaneRedis();
    const cal = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "cal-1",
      limit: 1,
      nowMs: 1_000,
    });
    const op = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "op-1",
      limit: 1,
      nowMs: 1_000,
    });
    expect(cal.acquired).toBe(true);
    expect(op.acquired).toBe(true);
    const calBlocked = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "cal-2",
      limit: 1,
      nowMs: 1_000,
    });
    expect(calBlocked.acquired).toBe(false);
    const opStillOk = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "op-2",
      limit: 2,
      nowMs: 1_000,
    });
    expect(opStillOk.acquired).toBe(true);
  });

  it("reducing the configured limit does not revoke held permits", async () => {
    const redis = new InMemoryLaneRedis();
    const held = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "held-1",
      limit: 4,
      nowMs: 1_000,
    });
    expect(held.acquired).toBe(true);
    const blocked = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "new-1",
      limit: 1,
      nowMs: 1_100,
    });
    expect(blocked.acquired).toBe(false);
    const renew = await renewLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "held-1",
      ownershipToken: held.token!,
      nowMs: 1_200,
    });
    expect(renew).toEqual({ renewed: true, reason: "RENEWED" });
  });

  it("increasing the configured limit allows additional claims", async () => {
    const redis = new InMemoryLaneRedis();
    await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "c1",
      limit: 1,
      nowMs: 1_000,
    });
    const blocked = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "c2",
      limit: 1,
      nowMs: 1_100,
    });
    expect(blocked.acquired).toBe(false);
    const allowed = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "c2",
      limit: 2,
      nowMs: 1_200,
    });
    expect(allowed.acquired).toBe(true);
  });
});
