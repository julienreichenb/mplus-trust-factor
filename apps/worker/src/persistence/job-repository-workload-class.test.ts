import { describe, expect, it, vi } from "vitest";
import { createJobRepository } from "./job-repository.js";

describe("job repository workloadClass at create/claim", () => {
  it("sets CALIBRATION from payload when creating a pending enqueue row", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "job-1",
      ...data,
    }));
    const prisma = {
      ingestionJob: {
        findUnique: vi.fn(async () => null),
        create,
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    const jobs = createJobRepository(prisma as never);
    await jobs.resolveForEnqueue({
      jobType: "refresh-character",
      dedupeKey: "dedupe-1",
      payload: { workloadClass: "CALIBRATION", region: "eu" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workloadClass: "CALIBRATION",
        dedupeKey: "dedupe-1",
      }),
    });
  });

  it("defaults OPERATION when payload omits workloadClass", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "job-1",
      ...data,
    }));
    const prisma = {
      ingestionJob: {
        findUnique: vi.fn(async () => null),
        create,
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };

    const jobs = createJobRepository(prisma as never);
    await jobs.resolveForEnqueue({
      jobType: "refresh-character",
      dedupeKey: "dedupe-2",
      payload: { region: "eu" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ workloadClass: "OPERATION" }),
    });
  });

  it("sets workloadClass from payload when claiming a terminal row for requeue", async () => {
    const existing = {
      id: "job-1",
      status: "COMPLETED",
      dedupeKey: "dedupe-3",
      workloadClass: "OPERATION",
    };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUniqueOrThrow = vi.fn(async () => ({
      ...existing,
      status: "QUEUED",
      workloadClass: "CALIBRATION",
    }));
    const prisma = {
      ingestionJob: {
        findUnique: vi.fn(async () => existing),
        create: vi.fn(),
        updateMany,
        findUniqueOrThrow,
      },
    };

    const jobs = createJobRepository(prisma as never);
    await jobs.promoteToQueuedAfterEnqueue({
      jobId: "job-1",
      dedupeKey: "dedupe-3",
      jobType: "refresh-character",
      payload: { workloadClass: "CALIBRATION" },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } },
      data: expect.objectContaining({ workloadClass: "CALIBRATION" }),
    });
  });
});
