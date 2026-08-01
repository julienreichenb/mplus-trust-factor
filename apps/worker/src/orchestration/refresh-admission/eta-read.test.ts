import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gatherRefreshEtaFields } from "./eta-read.js";
import { InMemoryAdmissionRedis } from "./in-memory-redis.js";
import { writeSchedulingState, writeWclAdmissionSnapshot } from "./redis-ops.js";
import type { AppEnv } from "@mplus/config";

function mockEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    APP_ENV: "test",
    REFRESH_ADMISSION_MODE: "off",
    REFRESH_WORKER_CONCURRENCY: 1,
    REFRESH_GLOBAL_CONCURRENCY: 2,
    REFRESH_WORKER_HARD_MAX: 8,
    REFRESH_GLOBAL_HARD_MAX: 8,
    REFRESH_SAFETY_RESERVE_FRACTION: 0.1,
    REFRESH_MIN_EMERGENCY_RESERVE_POINTS: 50,
    REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS: 60,
    REFRESH_LEASE_TTL_MS: 45_000,
    REFRESH_LEASE_HEARTBEAT_MS: 15_000,
    REFRESH_ETA_ENABLED: false,
    REFRESH_PRIORITY_IN_BULLMQ: false,
    REFRESH_CONCURRENCY_ENABLED: false,
    ...overrides,
  } as AppEnv;
}

describe("refresh ETA gather (flag + read-only)", () => {
  it("returns null when REFRESH_ETA_ENABLED=false (no expensive path required)", async () => {
    const prisma = {
      ingestionJob: {
        findMany: vi.fn(),
      },
    };
    const result = await gatherRefreshEtaFields(
      {
        env: mockEnv({ REFRESH_ETA_ENABLED: false }),
        prisma: prisma as never,
        redis: null,
      },
      null,
    );
    expect(result).toBeNull();
    expect(prisma.ingestionJob.findMany).not.toHaveBeenCalled();
  });

  it("does not mutate Redis or call providers when enabled", async () => {
    const redis = new InMemoryAdmissionRedis();
    await writeSchedulingState(redis, "test", "RUNNING");
    await writeWclAdmissionSnapshot(redis, "test", {
      pointsRemaining: 1000,
      pointsLimit: 1000,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
      fetchedAt: new Date().toISOString(),
    });

    const evalSpy = vi.spyOn(redis, "eval");
    const prisma = {
      ingestionJob: {
        findMany: vi.fn(async ({ where }: { where: { status?: string | { in?: string[] } } }) => {
          if (where.status === "COMPLETED") return [];
          return [
            {
              id: "11111111-1111-1111-1111-111111111111",
              status: "QUEUED",
              priority: 0,
              scheduledAt: new Date(),
              cancelRequestedAt: null,
              jobType: "refresh-character",
            },
          ];
        }),
      },
    };

    const result = await gatherRefreshEtaFields(
      {
        env: mockEnv({ REFRESH_ETA_ENABLED: true, REFRESH_ADMISSION_MODE: "off" }),
        prisma: prisma as never,
        redis,
      },
      {
        id: "11111111-1111-1111-1111-111111111111",
        status: "QUEUED",
        priority: 0,
        scheduledAt: new Date(),
        cancelRequestedAt: null,
        jobType: "refresh-character",
      },
    );

    expect(result).not.toBeNull();
    expect(result?.schedulingState).toBe("RUNNING");
    expect(result?.queuePosition).toBe(0);
    // Read path must not run admission Lua (reserve/release/renew).
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it("surfaces PAUSED scheduling state with LOW confidence and null wait", async () => {
    const redis = new InMemoryAdmissionRedis();
    await writeSchedulingState(redis, "test", "PAUSED");
    const prisma = {
      ingestionJob: {
        findMany: vi.fn(async () => []),
      },
    };
    const result = await gatherRefreshEtaFields(
      {
        env: mockEnv({ REFRESH_ETA_ENABLED: true }),
        prisma: prisma as never,
        redis,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        status: "QUEUED",
        priority: 0,
        scheduledAt: new Date(),
        cancelRequestedAt: null,
        jobType: "refresh-character",
      },
    );
    expect(result?.schedulingState).toBe("PAUSED");
    expect(result?.estimatedWaitSeconds).toBeNull();
    expect(result?.estimateConfidence).toBe("LOW");
  });

  it("ships additive jobType+status+completedAt index for polled throughput queries", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(here, "../../../../../");
    const schema = readFileSync(resolve(repoRoot, "packages/database/prisma/schema.prisma"), "utf8");
    const migration = readFileSync(
      resolve(
        repoRoot,
        "packages/database/prisma/migrations/20260801120000_ingestion_job_completed_at_eta_index/migration.sql",
      ),
      "utf8",
    );
    expect(schema).toMatch(/@@index\(\[jobType,\s*status,\s*completedAt\]\)/);
    expect(migration).toContain("ingestion_jobs_job_type_status_completed_at_idx");
    expect(migration).toContain('"completed_at"');
  });
});
