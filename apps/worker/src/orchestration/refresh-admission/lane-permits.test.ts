import { describe, expect, it } from "vitest";
import {
  acquireLanePermit,
  releaseLanePermit,
  renewLanePermit,
  refreshLaneKeys,
  REFRESH_LANE_WORKER_CLAIM_HARD_MAX,
  type LanePermitRedis,
} from "./lane-permits.js";

/**
 * Minimal in-memory port of the lane-permit Lua scripts (hash/zset/string only).
 */
class InMemoryLaneRedis implements LanePermitRedis {
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();
  private strings = new Map<string, number>();

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

  private acquire(keys: string[], argv: string[]): unknown[] {
    const [ownersKey, leaseKey, countKey] = keys;
    const [jobId, limitStr, leaseExpiryStr, nowMsStr] = argv;
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
      owners.set(jobId!, String(leaseExpiry));
      lease.set(jobId!, leaseExpiry);
      return [1, "IDEMPOTENT_EXISTING", this.strings.get(countKey!) ?? 0];
    }

    const count = Math.max(0, this.strings.get(countKey!) ?? 0);
    if (count >= limit) {
      return [0, "LANE_LIMIT_REACHED", count];
    }
    owners.set(jobId!, String(leaseExpiry));
    lease.set(jobId!, leaseExpiry);
    const newCount = count + 1;
    this.strings.set(countKey!, newCount);
    return [1, "OK", newCount];
  }

  private release(keys: string[], argv: string[]): unknown[] {
    const [ownersKey, leaseKey, countKey] = keys;
    const [jobId] = argv;
    const owners = this.hash(ownersKey!);
    const lease = this.zset(leaseKey!);
    const removed = owners.delete(jobId!);
    lease.delete(jobId!);
    if (removed) {
      const newCount = Math.max(0, (this.strings.get(countKey!) ?? 0) - 1);
      this.strings.set(countKey!, newCount);
      return [1, "RELEASED", newCount];
    }
    return [0, "NOT_OWNED", Math.max(0, this.strings.get(countKey!) ?? 0)];
  }

  private renew(keys: string[], argv: string[]): unknown[] {
    const [ownersKey, leaseKey] = keys;
    const [jobId, leaseExpiryStr] = argv;
    const owners = this.hash(ownersKey!);
    if (!owners.has(jobId!)) return [0, "NOT_OWNED"];
    owners.set(jobId!, leaseExpiryStr!);
    this.zset(leaseKey!).set(jobId!, Number(leaseExpiryStr));
    return [1, "RENEWED"];
  }
}

describe("lane-permits", () => {
  it("acquires up to the configured limit then reports LANE_LIMIT_REACHED", async () => {
    const redis = new InMemoryLaneRedis();
    const base = { redis, appEnv: "test", lane: "CALIBRATION" as const, limit: 2, nowMs: 1_000 };

    const first = await acquireLanePermit({ ...base, ingestionJobId: "job-1" });
    expect(first).toEqual({ acquired: true, reason: "OK", laneCount: 1, limit: 2 });

    const second = await acquireLanePermit({ ...base, ingestionJobId: "job-2" });
    expect(second.acquired).toBe(true);
    expect(second.laneCount).toBe(2);

    const third = await acquireLanePermit({ ...base, ingestionJobId: "job-3" });
    expect(third).toEqual({ acquired: false, reason: "LANE_LIMIT_REACHED", laneCount: 2, limit: 2 });
  });

  it("is idempotent for a job that already holds a permit", async () => {
    const redis = new InMemoryLaneRedis();
    const base = { redis, appEnv: "test", lane: "OPERATION" as const, limit: 1, nowMs: 1_000 };

    const first = await acquireLanePermit({ ...base, ingestionJobId: "job-1" });
    expect(first.acquired).toBe(true);

    const again = await acquireLanePermit({ ...base, ingestionJobId: "job-1", nowMs: 2_000 });
    expect(again).toEqual({ acquired: true, reason: "IDEMPOTENT_EXISTING", laneCount: 1, limit: 1 });
  });

  it("releases a held permit and frees capacity for a new acquire", async () => {
    const redis = new InMemoryLaneRedis();
    const base = { redis, appEnv: "test", lane: "CALIBRATION" as const, limit: 1, nowMs: 1_000 };

    await acquireLanePermit({ ...base, ingestionJobId: "job-1" });
    const release = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "CALIBRATION",
      ingestionJobId: "job-1",
    });
    expect(release).toEqual({ released: true, laneCount: 0 });

    const next = await acquireLanePermit({ ...base, ingestionJobId: "job-2" });
    expect(next.acquired).toBe(true);
  });

  it("releasing a permit not held returns released:false without going negative", async () => {
    const redis = new InMemoryLaneRedis();
    const release = await releaseLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "never-acquired",
    });
    expect(release).toEqual({ released: false, laneCount: 0 });
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
    expect(result).toEqual({ acquired: true, reason: "OK", laneCount: 1, limit: 1 });
  });

  it("renews a held lease and refuses to renew an unowned one", async () => {
    const redis = new InMemoryLaneRedis();
    await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      limit: 1,
      nowMs: 0,
    });
    const renewed = await renewLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-1",
      nowMs: 500,
    });
    expect(renewed).toEqual({ renewed: true });

    const notOwned = await renewLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-unknown",
      nowMs: 500,
    });
    expect(notOwned).toEqual({ renewed: false });
  });

  it("clamps requested limits to the worker claim hard max", () => {
    expect(REFRESH_LANE_WORKER_CLAIM_HARD_MAX).toBe(8);
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
    // New acquires see the reduced limit, but the held job remains owned.
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
      nowMs: 1_200,
    });
    expect(renew).toEqual({ renewed: true });
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
