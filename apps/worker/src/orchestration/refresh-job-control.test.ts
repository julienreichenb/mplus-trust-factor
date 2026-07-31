import { describe, expect, it, vi } from "vitest";
import type { IngestionJob } from "@mplus/database";
import {
  cancelRefreshJob,
  killAllRefreshJobs,
  prioritizeRefreshJob,
} from "./refresh-job-control.js";
import type { JobRepository } from "../persistence/job-repository.js";

function jobStub(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    id: "job-1",
    jobType: "refresh-character",
    characterId: "char-1",
    runId: null,
    status: "QUEUED",
    dedupeKey: "dedupe-1",
    priority: 0,
    attempts: 0,
    payload: { region: "EU", realmSlug: "tarren-mill", name: "Test" },
    scheduledAt: new Date(),
    startedAt: null,
    completedAt: null,
    error: null,
    queueJobId: "bull-queue-id-1",
    cancelRequestedAt: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  } as IngestionJob;
}

function mockLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
}

describe("refresh job control", () => {
  it("cancels queued jobs via CAS and is idempotent", async () => {
    const queued = jobStub({ status: "QUEUED" });
    const requested = jobStub({ status: "QUEUED", cancelRequestedAt: new Date() });
    const cancelled = jobStub({ status: "CANCELLED", cancelledAt: new Date() });
    const jobRepository = {
      findById: vi
        .fn()
        .mockResolvedValueOnce(queued)
        .mockResolvedValueOnce(cancelled)
        .mockResolvedValue(cancelled),
      requestCancel: vi.fn(async () => requested),
      markCancelledIfQueued: vi.fn(async () => cancelled),
      markCancelled: vi.fn(),
    } as unknown as JobRepository;

    const remove = vi.fn();
    const queue = {
      getJob: vi.fn(async () => ({
        id: "bull-queue-id-1",
        getState: async () => "waiting",
        remove,
      })),
      getJobs: vi.fn(async () => []),
    };

    const first = await cancelRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      queued.id,
    );
    expect(first.outcome).toBe("queued_cancelled");
    expect(first.ingestionJobId).toBe(queued.id);
    expect(first.queueJobId).toBe("bull-queue-id-1");
    expect(jobRepository.markCancelledIfQueued).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    // Never pass IngestionJob UUID to BullMQ getJob when queueJobId is set.
    expect(queue.getJob).toHaveBeenCalledWith("bull-queue-id-1");

    const second = await cancelRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      queued.id,
    );
    expect(second.outcome).toBe("already_terminal");
  });

  it("does not falsely mark CANCELLED when queued job becomes active before remove", async () => {
    const queued = jobStub({ status: "QUEUED" });
    const requested = jobStub({ status: "QUEUED", cancelRequestedAt: new Date() });
    const jobRepository = {
      findById: vi.fn(async () => queued),
      requestCancel: vi.fn(async () => requested),
      markCancelledIfQueued: vi.fn(),
      markCancelled: vi.fn(),
    } as unknown as JobRepository;

    const queue = {
      getJob: vi.fn(async () => ({
        getState: async () => "active",
        remove: vi.fn(),
      })),
      getJobs: vi.fn(async () => []),
    };

    const result = await cancelRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      queued.id,
    );
    expect(result.outcome).toBe("active_cancel_requested");
    expect(jobRepository.markCancelledIfQueued).not.toHaveBeenCalled();
  });

  it("CAS miss after remove leaves cooperative cancel when job became ACTIVE", async () => {
    const queued = jobStub({ status: "QUEUED" });
    const requested = jobStub({ status: "QUEUED", cancelRequestedAt: new Date() });
    const active = jobStub({ status: "ACTIVE", cancelRequestedAt: new Date() });
    const jobRepository = {
      findById: vi.fn().mockResolvedValueOnce(queued).mockResolvedValue(active),
      requestCancel: vi.fn(async () => requested),
      markCancelledIfQueued: vi.fn(async () => null),
      markCancelled: vi.fn(),
    } as unknown as JobRepository;

    const remove = vi.fn();
    const queue = {
      getJob: vi.fn(async () => ({
        getState: async () => "waiting",
        remove,
      })),
      getJobs: vi.fn(async () => []),
    };

    const result = await cancelRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      queued.id,
    );
    expect(result.outcome).toBe("active_cancel_requested");
    expect(remove).toHaveBeenCalled();
  });

  it("requests cooperative cancel for ACTIVE jobs and never removes", async () => {
    const active = jobStub({ status: "ACTIVE", startedAt: new Date() });
    const requested = jobStub({
      status: "ACTIVE",
      startedAt: active.startedAt,
      scheduledAt: active.scheduledAt,
      cancelRequestedAt: new Date(),
      cancelReason: "admin_cancel",
    });
    const jobRepository = {
      findById: vi.fn(async () => active),
      requestCancel: vi.fn(async () => requested),
      markCancelled: vi.fn(),
      markCancelledIfQueued: vi.fn(),
    } as unknown as JobRepository;

    const remove = vi.fn();
    const queue = {
      getJob: vi.fn(async () => ({ getState: async () => "active", remove })),
      getJobs: vi.fn(async () => []),
    };

    const result = await cancelRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      active.id,
    );
    expect(result.outcome).toBe("active_cancel_requested");
    expect(jobRepository.requestCancel).toHaveBeenCalled();
    expect(jobRepository.markCancelled).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("force-cancels ACTIVE jobs when cancellation was already requested (zombie)", async () => {
    const active = jobStub({
      status: "ACTIVE",
      startedAt: new Date(),
      cancelRequestedAt: new Date(),
      cancelReason: "admin_cancel",
    });
    const cancelled = jobStub({
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelRequestedAt: active.cancelRequestedAt,
    });
    const jobRepository = {
      findById: vi.fn(async () => active),
      requestCancel: vi.fn(async () => active),
      markCancelled: vi.fn(async () => cancelled),
      markCancelledIfQueued: vi.fn(),
    } as unknown as JobRepository;

    const result = await cancelRefreshJob(
      { jobRepository, refreshQueue: null, logger: mockLogger() },
      active.id,
    );
    expect(result.outcome).toBe("active_force_cancelled");
    expect(result.databaseStatus).toBe("CANCELLED");
    expect(jobRepository.markCancelled).toHaveBeenCalled();
  });

  it("force-cancels ACTIVE jobs on kill-all reason", async () => {
    const active = jobStub({ status: "ACTIVE", startedAt: new Date() });
    const requested = jobStub({
      status: "ACTIVE",
      startedAt: active.startedAt,
      scheduledAt: active.scheduledAt,
      cancelRequestedAt: new Date(),
      cancelReason: "admin_kill_all",
    });
    const cancelled = jobStub({ status: "CANCELLED", cancelledAt: new Date() });
    const jobRepository = {
      findById: vi.fn(async () => active),
      requestCancel: vi.fn(async () => requested),
      markCancelled: vi.fn(async () => cancelled),
      markCancelledIfQueued: vi.fn(),
    } as unknown as JobRepository;

    const result = await cancelRefreshJob(
      { jobRepository, refreshQueue: null, logger: mockLogger() },
      active.id,
      "admin_kill_all",
    );
    expect(result.outcome).toBe("active_force_cancelled");
    expect(jobRepository.markCancelled).toHaveBeenCalledWith(active.id, { reason: "admin_kill_all" });
  });

  it("is idempotent for already CANCELLED / COMPLETED", async () => {
    for (const status of ["CANCELLED", "COMPLETED", "FAILED"] as const) {
      const terminal = jobStub({ status });
      const jobRepository = {
        findById: vi.fn(async () => terminal),
        requestCancel: vi.fn(),
        markCancelled: vi.fn(),
        markCancelledIfQueued: vi.fn(),
      } as unknown as JobRepository;
      const result = await cancelRefreshJob(
        { jobRepository, refreshQueue: null, logger: mockLogger() },
        terminal.id,
      );
      expect(result.outcome).toBe("already_terminal");
      expect(jobRepository.requestCancel).not.toHaveBeenCalled();
    }
  });

  it("handles legacy null queueJobId without scanning active jobs", async () => {
    const queued = jobStub({ status: "QUEUED", queueJobId: null });
    const requested = jobStub({ status: "QUEUED", queueJobId: null, cancelRequestedAt: new Date() });
    const cancelled = jobStub({ status: "CANCELLED", queueJobId: null });
    const jobRepository = {
      findById: vi.fn(async () => queued),
      requestCancel: vi.fn(async () => requested),
      markCancelledIfQueued: vi.fn(async () => cancelled),
    } as unknown as JobRepository;

    const getJobs = vi.fn(async () => []);
    const queue = {
      getJob: vi.fn(),
      getJobs,
    };

    const result = await cancelRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      queued.id,
    );
    expect(result.outcome).toBe("queued_cancelled");
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(getJobs).toHaveBeenCalled();
    const states = getJobs.mock.calls[0]![0] as string[];
    expect(states).not.toContain("active");
  });

  it("prioritizes queued jobs without duplicating", async () => {
    const queued = jobStub({ status: "QUEUED", priority: 0 });
    const raised = jobStub({ status: "QUEUED", priority: 10 });
    const jobRepository = {
      findById: vi.fn(async () => queued),
      updatePriority: vi.fn(async () => raised),
    } as unknown as JobRepository;

    const changePriority = vi.fn();
    const queue = {
      getJob: vi.fn(async () => ({
        getState: async () => "waiting",
        changePriority,
      })),
      getJobs: vi.fn(async () => []),
    };

    const result = await prioritizeRefreshJob(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      queued.id,
    );
    expect(result.prioritized).toBe(true);
    expect(result.ingestionJobId).toBe(queued.id);
    expect(result.databasePriority).toBe(10);
    expect(changePriority).toHaveBeenCalledWith({ priority: 10 });
  });

  it("rejects prioritize for ACTIVE, CANCELLED, terminal, and cancel-requested queued jobs", async () => {
    for (const status of ["ACTIVE", "CANCELLED", "COMPLETED", "FAILED"] as const) {
      const job = jobStub({ status });
      const jobRepository = {
        findById: vi.fn(async () => job),
        updatePriority: vi.fn(),
      } as unknown as JobRepository;
      await expect(
        prioritizeRefreshJob({ jobRepository, refreshQueue: null, logger: mockLogger() }, job.id),
      ).rejects.toThrow(/Only queued/);
      expect(jobRepository.updatePriority).not.toHaveBeenCalled();
    }

    const cancelRequestedQueued = jobStub({
      status: "QUEUED",
      cancelRequestedAt: new Date(),
      cancelReason: "admin_cancel",
    });
    const cancelRequestedRepo = {
      findById: vi.fn(async () => cancelRequestedQueued),
      updatePriority: vi.fn(),
    } as unknown as JobRepository;
    await expect(
      prioritizeRefreshJob(
        { jobRepository: cancelRequestedRepo, refreshQueue: null, logger: mockLogger() },
        cancelRequestedQueued.id,
      ),
    ).rejects.toThrow(/without a cancellation request/);
    expect(cancelRequestedRepo.updatePriority).not.toHaveBeenCalled();
  });

  it("kill-all is point-in-time and force-cancels ACTIVE jobs", async () => {
    const queued = jobStub({ id: "q1", status: "QUEUED", queueJobId: "bull-waiting" });
    const delayed = jobStub({ id: "d1", status: "QUEUED", queueJobId: "bull-delayed" });
    const active = jobStub({ id: "a1", status: "ACTIVE", startedAt: new Date() });
    const snapshot = [queued, delayed, active];
    const cancelledById = new Map<string, IngestionJob>();

    let call = 0;
    const jobRepository = {
      listInFlightRefreshJobs: vi.fn(async () => {
        call += 1;
        return call === 1 ? snapshot : [];
      }),
      findById: vi.fn(async (id: string) => cancelledById.get(id) ?? snapshot.find((j) => j.id === id) ?? null),
      requestCancel: vi.fn(async (id: string) => {
        const job = snapshot.find((j) => j.id === id)!;
        const withRequest = { ...job, cancelRequestedAt: new Date(), cancelReason: "admin_kill_all" };
        cancelledById.set(id, withRequest);
        return withRequest;
      }),
      markCancelled: vi.fn(async (id: string) => {
        const cancelled = jobStub({
          id,
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelRequestedAt: new Date(),
        });
        cancelledById.set(id, cancelled);
        return cancelled;
      }),
      markCancelledIfQueued: vi.fn(async (id: string) => {
        const cancelled = jobStub({
          id,
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelRequestedAt: new Date(),
          queueJobId: id === "d1" ? "bull-delayed" : "bull-waiting",
        });
        cancelledById.set(id, cancelled);
        return cancelled;
      }),
    } as unknown as JobRepository;

    const queue = {
      getJob: vi.fn(async (qid: string) => ({
        id: qid,
        getState: async () => (qid === "bull-delayed" ? "delayed" : "waiting"),
        remove: vi.fn(async () => undefined),
      })),
      getJobs: vi.fn(async () => []),
    };

    const first = await killAllRefreshJobs(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      "admin_kill_all",
    );
    expect(first.queuedCancelled).toBe(1);
    expect(first.delayedCancelled).toBe(1);
    expect(first.activeForceCancelled).toBe(1);
    expect(first.activeCancellationRequested).toBe(0);
    expect(first.results).toHaveLength(3);

    const second = await killAllRefreshJobs(
      { jobRepository, refreshQueue: queue as never, logger: mockLogger() },
      "admin_kill_all",
    );
    expect(second.results).toEqual([]);
    expect(jobRepository.listInFlightRefreshJobs).toHaveBeenCalledTimes(2);
  });

  it("kill-all force-cancels already-requested ACTIVE zombies", async () => {
    const queued = jobStub({ id: "q1", status: "QUEUED" });
    const active = jobStub({ id: "a1", status: "ACTIVE", startedAt: new Date() });
    const already = jobStub({
      id: "a2",
      status: "ACTIVE",
      startedAt: new Date(),
      cancelRequestedAt: new Date(),
    });
    const cancelledQueued = jobStub({ id: "q1", status: "CANCELLED" });

    const jobRepository = {
      listInFlightRefreshJobs: vi.fn(async () => [queued, active, already]),
      findById: vi.fn(async (id: string) => {
        if (id === "q1") return queued;
        if (id === "a1") return active;
        return already;
      }),
      requestCancel: vi.fn(async (id: string) => {
        if (id === "q1") return jobStub({ id: "q1", status: "QUEUED", cancelRequestedAt: new Date() });
        if (id === "a1") {
          return jobStub({
            id: "a1",
            status: "ACTIVE",
            startedAt: active.startedAt,
            scheduledAt: active.scheduledAt,
            cancelRequestedAt: new Date(),
          });
        }
        return already;
      }),
      markCancelledIfQueued: vi.fn(async () => cancelledQueued),
      markCancelled: vi.fn(async (id: string) =>
        jobStub({ id, status: "CANCELLED", cancelledAt: new Date() }),
      ),
    } as unknown as JobRepository;

    const result = await killAllRefreshJobs(
      { jobRepository, refreshQueue: null, logger: mockLogger() },
      "admin_kill_all",
    );
    expect(result.queuedCancelled).toBe(1);
    expect(result.activeForceCancelled).toBe(2);
    expect(result.activeCancellationRequested).toBe(0);
    expect(result.alreadyCancellationRequested).toBe(0);
    expect(result.results).toHaveLength(3);
  });
});
