import { describe, expect, it } from "vitest";
import { acquireLanePermit, releaseLanePermit, type LanePermitRedis } from "./lane-permits.js";

class InMemoryLaneRedis implements LanePermitRedis {
  private owners = new Map<string, string>();
  private count = 0;

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const argv = args.slice(numKeys).map(String);
    if (script.includes("LANE_LIMIT_REACHED")) {
      const jobId = argv[0]!;
      const limit = Number(argv[1]);
      if (this.owners.has(jobId)) return [1, argv[4], String(this.count)];
      if (this.count >= limit) return [0, "LANE_LIMIT_REACHED", String(this.count)];
      this.owners.set(jobId, `${argv[4]}|${argv[2]}`);
      this.count += 1;
      return [1, argv[4], String(this.count)];
    }
    if (script.includes("NOT_OWNED")) {
      const jobId = argv[0]!;
      const token = argv[1]!;
      const existing = this.owners.get(jobId);
      if (!existing?.startsWith(`${token}|`)) return [0, "NOT_OWNED"];
      this.owners.delete(jobId);
      this.count = Math.max(0, this.count - 1);
      return [1, "RELEASED"];
    }
    throw new Error("unknown script");
  }
}

describe("operation lane parallel permits", () => {
  it("allows N concurrent OPERATION permits and refuses N+1", async () => {
    const redis = new InMemoryLaneRedis();
    const limit = 2;
    const held: string[] = [];
    for (let i = 0; i < limit; i++) {
      const permit = await acquireLanePermit({
        redis,
        appEnv: "test",
        lane: "OPERATION",
        ingestionJobId: `job-${i}`,
        limit,
        nowMs: Date.now(),
      });
      expect(permit.acquired).toBe(true);
      held.push(permit.token!);
    }
    const blocked = await acquireLanePermit({
      redis,
      appEnv: "test",
      lane: "OPERATION",
      ingestionJobId: "job-blocked",
      limit,
      nowMs: Date.now(),
    });
    expect(blocked.acquired).toBe(false);
    for (let i = 0; i < limit; i++) {
      await releaseLanePermit({
        redis,
        appEnv: "test",
        lane: "OPERATION",
        ingestionJobId: `job-${i}`,
        token: held[i]!,
      });
    }
  });
});
