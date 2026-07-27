import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import { createJobRepository } from "./job-repository.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping job-repository tests: PostgreSQL not reachable at ${databaseUrl}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("job repository enqueue reconciliation", () => {
  const jobs = createJobRepository(prisma);

  it("does not reset terminal rows to QUEUED until promoteAfterEnqueue", async () => {
    const dedupeKey = `test-dedupe-${randomUUID()}`;
    const created = await jobs.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 1 },
    });
    await jobs.markActive(created.job.id);
    await jobs.markCompleted(created.job.id);

    const resolved = await jobs.resolveForEnqueue({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 2 },
    });
    expect(resolved.skipEnqueue).toBe(false);
    expect(resolved.job.status).toBe("COMPLETED");

    const promoted = await jobs.promoteToQueuedAfterEnqueue({
      jobId: resolved.job.id,
      dedupeKey,
      jobType: "refresh-character",
      payload: { n: 2 },
    });
    expect(promoted.wonClaim).toBe(true);
    expect(promoted.job.status).toBe("QUEUED");
    expect(promoted.job.startedAt).toBeNull();
    expect(promoted.job.completedAt).toBeNull();
  });

  it("collapses concurrent in-flight resolve calls without a second enqueue", async () => {
    const dedupeKey = `test-dedupe-${randomUUID()}`;
    const first = await jobs.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 1 },
    });
    expect(first.job.status).toBe("QUEUED");

    const a = await jobs.resolveForEnqueue({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 2 },
    });
    const b = await jobs.resolveForEnqueue({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 3 },
    });
    expect(a.skipEnqueue).toBe(true);
    expect(b.skipEnqueue).toBe(true);
    expect(a.job.id).toBe(first.job.id);
    expect(b.job.id).toBe(first.job.id);
  });

  it("marks stale QUEUED (no startedAt) as FAILED so a new execution can proceed", async () => {
    const dedupeKey = `test-dedupe-${randomUUID()}`;
    const created = await jobs.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 1 },
    });
    await prisma.ingestionJob.update({
      where: { id: created.job.id },
      data: { scheduledAt: new Date(Date.now() - 20 * 60 * 1000), startedAt: null },
    });

    const resolved = await jobs.resolveForEnqueue({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 2 },
      staleQueuedMs: 15 * 60 * 1000,
    });
    expect(resolved.job.status).toBe("FAILED");
    expect(resolved.skipEnqueue).toBe(false);
    expect((resolved.job.error as { code?: string } | null)?.code).toBe("STALE_QUEUED");
  });

  it("allows a second direct execution after COMPLETED (inline / pipeline path)", async () => {
    const dedupeKey = `test-dedupe-${randomUUID()}`;
    const first = await jobs.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 1 },
    });
    await jobs.markActive(first.job.id);
    await jobs.markCompleted(first.job.id);

    const second = await jobs.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 2 },
    });
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe("QUEUED");
    expect(second.reused).toBe(true);

    await jobs.markActive(second.job.id);
    await jobs.markCompleted(second.job.id);
    const final = await jobs.findById(second.job.id);
    expect(final?.status).toBe("COMPLETED");
  });

  it("losing promote claim returns the in-flight winner", async () => {
    const dedupeKey = `test-dedupe-${randomUUID()}`;
    const created = await jobs.createOrGetByDedupe({
      jobType: "refresh-character",
      dedupeKey,
      payload: { n: 1 },
    });
    await jobs.markActive(created.job.id);
    await jobs.markCompleted(created.job.id);

    const winner = await jobs.promoteToQueuedAfterEnqueue({
      jobId: created.job.id,
      dedupeKey,
      jobType: "refresh-character",
      payload: { n: 2 },
    });
    expect(winner.wonClaim).toBe(true);

    const loser = await jobs.promoteToQueuedAfterEnqueue({
      jobId: created.job.id,
      dedupeKey,
      jobType: "refresh-character",
      payload: { n: 3 },
    });
    expect(loser.wonClaim).toBe(false);
    expect(loser.job.status).toBe("QUEUED");
  });
});
