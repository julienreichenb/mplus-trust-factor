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
    startedAt: new Date("2026-07-20T10:00:01.000Z"),
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
    expect(a).toBe("abc:exec-1");
    expect(b).toBe("abc:exec-2");
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
  });

  it("requeues after COMPLETED with a unique BullMQ id and only then promotes DB to QUEUED", async () => {
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
        order.push("promote");
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

    expect(order).toEqual(["resolve", "promote"]);
    expect(add).toHaveBeenCalledTimes(1);
    const bullJobId = add.mock.calls[0]![2].jobId as string;
    expect(bullJobId.startsWith("dedupe-1-")).toBe(true);
    expect(bullJobId).not.toBe("dedupe-1");
    expect(bullJobId).not.toContain(":");
    expect(result.enqueued).toBe(true);
    expect(result.jobId).toBe(queued.id);
    expect(jobRepository.promoteToQueuedAfterEnqueue).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not promote DB when queue.add fails after a terminal job", async () => {
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
      promoteToQueuedAfterEnqueue: vi.fn(),
      markEnqueueFailed: vi.fn(async () => jobStub({ status: "COMPLETED" })),
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
    expect(jobRepository.promoteToQueuedAfterEnqueue).not.toHaveBeenCalled();
    expect(jobRepository.markEnqueueFailed).toHaveBeenCalled();
  });

  it("removes duplicate BullMQ work when losing the promote claim", async () => {
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
    expect(remove).toHaveBeenCalled();
  });
});
