import { describe, expect, it, vi } from "vitest";
import type { IngestionJob } from "@mplus/database";
import type { Queue } from "bullmq";
import {
  buildBullmqExecutionJobId,
  isStaleQueued,
  persistAndEnqueue,
} from "./enqueue.js";
import type { JobRepository } from "../persistence/job-repository.js";

function jobStub(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    id: "job-1",
    jobType: "refresh-character",
    characterId: null,
    runId: null,
    status: "COMPLETED",
    dedupeKey: "dedupe-1",
    priority: 0,
    attempts: 1,
    payload: {},
    scheduledAt: new Date("2026-07-20T10:00:00.000Z"),
    startedAt: new Date("2026-07-20T10:01:00.000Z"),
    completedAt: new Date("2026-07-20T10:01:00.000Z"),
    error: null,
    ...overrides,
  } as IngestionJob;
}

function mockLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
}

describe("isStaleQueued", () => {
  it("flags QUEUED jobs with no startedAt past the threshold", () => {
    const scheduledAt = new Date("2026-07-20T10:00:00.000Z");
    expect(
      isStaleQueued(
        { status: "QUEUED", startedAt: null, scheduledAt },
        scheduledAt.getTime() + 16 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      isStaleQueued(
        { status: "QUEUED", startedAt: null, scheduledAt },
        scheduledAt.getTime() + 60 * 1000,
      ),
    ).toBe(false);
    expect(
      isStaleQueued({
        status: "QUEUED",
        startedAt: new Date(),
        scheduledAt,
      }),
    ).toBe(false);
    expect(
      isStaleQueued({
        status: "ACTIVE",
        startedAt: null,
        scheduledAt,
      }),
    ).toBe(false);
  });
});

describe("buildBullmqExecutionJobId", () => {
  it("keeps the logical dedupe key as a prefix and varies per execution", () => {
    const a = buildBullmqExecutionJobId("abc", "exec-1");
    const b = buildBullmqExecutionJobId("abc", "exec-2");
    expect(a).toBe("abc-exec-1");
    expect(b).toBe("abc-exec-2");
    expect(a).not.toBe(b);
  });
});

describe("persistAndEnqueue", () => {
  it("skips BullMQ publish when an in-flight job already exists", async () => {
    const add = vi.fn();
    const queue = { add, getJob: vi.fn() } as unknown as Queue;
    const jobRepository = {
      resolveForEnqueue: vi.fn(async () => ({
        job: jobStub({ status: "QUEUED", startedAt: null, completedAt: null }),
        reused: true,
        skipEnqueue: true,
      })),
      promoteToQueuedAfterEnqueue: vi.fn(),
      markEnqueueFailed: vi.fn(),
    } as unknown as JobRepository;

    const result = await persistAndEnqueue({
      queue,
      jobType: "refresh-character",
      dedupeKey: "dedupe-1",
      payload: { name: "Wallidrixe" },
      jobRepository,
      logger: mockLogger(),
    });

    expect(result.enqueued).toBe(false);
    expect(result.reused).toBe(true);
    expect(add).not.toHaveBeenCalled();
    expect(jobRepository.promoteToQueuedAfterEnqueue).not.toHaveBeenCalled();
  });

  it("claims DB then requeues after COMPLETED with a unique BullMQ id", async () => {
    const add = vi.fn(async () => ({ id: "bull-1" }));
    const remove = vi.fn();
    const queue = {
      add,
      getJob: vi.fn(async () => ({ remove })),
    } as unknown as Queue;

    const order: string[] = [];
    const completed = jobStub({ status: "COMPLETED" });
    const queued = jobStub({
      status: "QUEUED",
      startedAt: null,
      completedAt: null,
      scheduledAt: new Date("2026-07-20T11:00:00.000Z"),
    });

    const jobRepository = {
      resolveForEnqueue: vi.fn(async () => {
        order.push("resolve");
        return { job: completed, reused: true, skipEnqueue: false };
      }),
      promoteToQueuedAfterEnqueue: vi.fn(async () => {
        order.push("claim");
        return { job: queued, wonClaim: true };
      }),
      markEnqueueFailed: vi.fn(),
    } as unknown as JobRepository;

    const result = await persistAndEnqueue({
      queue,
      jobType: "refresh-character",
      dedupeKey: "dedupe-1",
      payload: { name: "Wallidrixe" },
      jobRepository,
      logger: mockLogger(),
    });

    expect(order).toEqual(["resolve", "claim"]);
    expect(add).toHaveBeenCalledTimes(1);
    const bullJobId = add.mock.calls[0]![2].jobId as string;
    expect(bullJobId.startsWith("dedupe-1-")).toBe(true);
    expect(bullJobId).not.toBe("dedupe-1");
    expect(bullJobId).not.toContain(":");
    expect(result.enqueued).toBe(true);
    expect(result.jobId).toBe(queued.id);
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not leave QUEUED when queue.add fails after claim", async () => {
    const add = vi.fn(async () => {
      throw new Error("Job already exists");
    });
    const queue = { add, getJob: vi.fn() } as unknown as Queue;
    const jobRepository = {
      resolveForEnqueue: vi.fn(async () => ({
        job: jobStub({ status: "COMPLETED" }),
        reused: true,
        skipEnqueue: false,
      })),
      promoteToQueuedAfterEnqueue: vi.fn(async () => ({
        job: jobStub({ status: "QUEUED", startedAt: null, completedAt: null }),
        wonClaim: true,
      })),
      markEnqueueFailed: vi.fn(async () => jobStub({ status: "FAILED" })),
    } as unknown as JobRepository;

    const result = await persistAndEnqueue({
      queue,
      jobType: "refresh-character",
      dedupeKey: "dedupe-1",
      payload: {},
      jobRepository,
      logger: mockLogger(),
    });

    expect(result.enqueued).toBe(false);
    expect(jobRepository.promoteToQueuedAfterEnqueue).toHaveBeenCalled();
    expect(jobRepository.markEnqueueFailed).toHaveBeenCalled();
  });

  it("does not add or remove BullMQ work when losing the claim race", async () => {
    const add = vi.fn(async () => ({ id: "bull-dup" }));
    const remove = vi.fn(async () => undefined);
    const queue = {
      add,
      getJob: vi.fn(async () => ({ remove })),
    } as unknown as Queue;

    const jobRepository = {
      resolveForEnqueue: vi.fn(async () => ({
        job: jobStub({ status: "FAILED" }),
        reused: true,
        skipEnqueue: false,
      })),
      promoteToQueuedAfterEnqueue: vi.fn(async () => ({
        job: jobStub({ status: "QUEUED", startedAt: null, completedAt: null }),
        wonClaim: false,
      })),
      markEnqueueFailed: vi.fn(),
    } as unknown as JobRepository;

    const result = await persistAndEnqueue({
      queue,
      jobType: "refresh-character",
      dedupeKey: "dedupe-1",
      payload: {},
      jobRepository,
      logger: mockLogger(),
    });

    expect(result.enqueued).toBe(false);
    expect(result.reused).toBe(true);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it("concurrent producers: at most one BullMQ add and no locked-job remove path", async () => {
    let claimCount = 0;
    const add = vi.fn(async () => ({ id: "bull-1" }));
    const remove = vi.fn();
    const queue = {
      add,
      getJob: vi.fn(async () => ({ remove })),
    } as unknown as Queue;

    const terminal = jobStub({ status: "FAILED", completedAt: new Date() });
    const queued = jobStub({
      id: "job-winner",
      status: "QUEUED",
      startedAt: null,
      completedAt: null,
    });

    const jobRepository = {
      resolveForEnqueue: vi.fn(async () => ({
        job: terminal,
        reused: true,
        skipEnqueue: false,
      })),
      promoteToQueuedAfterEnqueue: vi.fn(async () => {
        claimCount += 1;
        if (claimCount === 1) return { job: queued, wonClaim: true };
        return { job: queued, wonClaim: false };
      }),
      markEnqueueFailed: vi.fn(),
    } as unknown as JobRepository;

    const [a, b] = await Promise.all([
      persistAndEnqueue({
        queue,
        jobType: "refresh-character",
        dedupeKey: "dedupe-1",
        payload: {},
        jobRepository,
        logger: mockLogger(),
      }),
      persistAndEnqueue({
        queue,
        jobType: "refresh-character",
        dedupeKey: "dedupe-1",
        payload: {},
        jobRepository,
        logger: mockLogger(),
      }),
    ]);

    expect([a.enqueued, b.enqueued].filter(Boolean)).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
