import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContainer } from "./container.js";

const persistAndEnqueue = vi.hoisted(() => vi.fn());

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("./orchestration/enqueue.js", () => ({
  persistAndEnqueue,
}));

import { createQueueProducers } from "./queues.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function baseRefreshInput(
  workloadClass: "OPERATION" | "CALIBRATION" = "OPERATION",
): {
  region: string;
  realmSlug: string;
  name: string;
  priority: "normal";
  forceRefresh: boolean;
  workloadClass: "OPERATION" | "CALIBRATION";
} {
  return {
    region: "eu",
    realmSlug: "hyjal",
    name: "Wallidrixe",
    priority: "normal",
    forceRefresh: false,
    workloadClass,
  };
}

function mockContainer(existingWorkloadClass: "OPERATION" | "CALIBRATION" = "OPERATION") {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findUnique = vi.fn(async () => ({ workloadClass: existingWorkloadClass }));
  const info = vi.fn();
  const container = {
    prisma: {
      ingestionJob: { updateMany, findUnique },
    },
    logger: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    repositories: { job: {} },
  } as unknown as WorkerContainer;
  return { container, updateMany, findUnique, info };
}

describe("enqueueRefreshCharacter workloadClass reuse", () => {
  beforeEach(() => {
    persistAndEnqueue.mockReset();
  });

  it("sets workloadClass on fresh enqueue (enqueued: true)", async () => {
    const { container, updateMany, findUnique } = mockContainer();
    persistAndEnqueue.mockResolvedValue({
      jobId: JOB_ID,
      dedupeKey: "dedupe-1",
      reused: false,
      enqueued: true,
      bullmqJobId: "bull-1",
    });

    const producers = createQueueProducers({} as never, container);
    const result = await producers.enqueueRefreshCharacter(baseRefreshInput("CALIBRATION"));

    expect(result.enqueued).toBe(true);
    expect(result.reusedAcrossWorkloadIntent).toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: { workloadClass: "CALIBRATION" },
    });
    expect(findUnique).not.toHaveBeenCalled();
    await producers.close();
  });

  it("does not overwrite DB when CALIBRATION request reuses an OPERATION job", async () => {
    const { container, updateMany, findUnique, info } = mockContainer("OPERATION");
    persistAndEnqueue.mockResolvedValue({
      jobId: JOB_ID,
      dedupeKey: "dedupe-1",
      reused: true,
      enqueued: false,
      bullmqJobId: null,
    });

    const producers = createQueueProducers({} as never, container);
    const result = await producers.enqueueRefreshCharacter(baseRefreshInput("CALIBRATION"));

    expect(result.enqueued).toBe(false);
    expect(result.reused).toBe(true);
    expect(result.reusedAcrossWorkloadIntent).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      select: { workloadClass: true },
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        requestedWorkloadClass: "CALIBRATION",
        existingWorkloadClass: "OPERATION",
      }),
      "refresh job reused across workload intent",
    );
    await producers.close();
  });

  it("does not overwrite DB when OPERATION request reuses a CALIBRATION job", async () => {
    const { container, updateMany, findUnique, info } = mockContainer("CALIBRATION");
    persistAndEnqueue.mockResolvedValue({
      jobId: JOB_ID,
      dedupeKey: "dedupe-1",
      reused: true,
      enqueued: false,
      bullmqJobId: null,
    });

    const producers = createQueueProducers({} as never, container);
    const result = await producers.enqueueRefreshCharacter(baseRefreshInput("OPERATION"));

    expect(result.enqueued).toBe(false);
    expect(result.reusedAcrossWorkloadIntent).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedWorkloadClass: "OPERATION",
        existingWorkloadClass: "CALIBRATION",
      }),
      "refresh job reused across workload intent",
    );
    await producers.close();
  });

  it("leaves DB unchanged on same-lane reuse without cross-intent flag", async () => {
    const { container, updateMany, info } = mockContainer("OPERATION");
    persistAndEnqueue.mockResolvedValue({
      jobId: JOB_ID,
      dedupeKey: "dedupe-1",
      reused: true,
      enqueued: false,
      bullmqJobId: null,
    });

    const producers = createQueueProducers({} as never, container);
    const result = await producers.enqueueRefreshCharacter(baseRefreshInput("OPERATION"));

    expect(result.reusedAcrossWorkloadIntent).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    await producers.close();
  });

  it("passes requested workloadClass in payload on fresh OPERATION enqueue", async () => {
    const { container, updateMany } = mockContainer();
    persistAndEnqueue.mockResolvedValue({
      jobId: JOB_ID,
      dedupeKey: "dedupe-1",
      reused: false,
      enqueued: true,
      bullmqJobId: "bull-1",
    });

    const producers = createQueueProducers({} as never, container);
    await producers.enqueueRefreshCharacter(baseRefreshInput("OPERATION"));

    expect(persistAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ workloadClass: "OPERATION" }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: { workloadClass: "OPERATION" },
    });
    await producers.close();
  });
});
