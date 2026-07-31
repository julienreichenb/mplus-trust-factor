import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, Prisma, type PrismaClient } from "@mplus/database";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createBulkOperationRepository } from "../persistence/bulk-operation-repository.js";
import { buildBullmqExecutionJobId } from "./enqueue.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping bulk integrity tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

const ACTIVE = ["PENDING", "SELECTING", "RUNNING", "PAUSED"] as const;

describe.skipIf(!dbAvailable)("bulk operation persistence integrity", () => {
  const repo = createBulkOperationRepository(prisma);

  it("rejects concurrent active creates for the same logical key via partial unique index", async () => {
    const logicalKey = `concurrent-${randomUUID()}`;
    const input = {
      mode: "RECALCULATE_ONLY" as const,
      logicalKey,
      minMythicPlusScore: null,
      scoreModelId: null,
      batchSize: 10,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: false,
      allowFullRefreshOnIncompatible: false,
      createdByUserId: null,
      configSnapshot: { logicalKey },
    };

    const results = await Promise.allSettled([repo.create(input), repo.create(input)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");

    const active = await prisma.bulkOperation.findMany({
      where: { logicalKey, status: { in: [...ACTIVE] } },
    });
    expect(active).toHaveLength(1);

    await prisma.bulkOperation.delete({ where: { id: active[0]!.id } });
  });

  it("treats PAUSED as active for uniqueness and allows reuse after COMPLETED", async () => {
    const logicalKey = `paused-terminal-${randomUUID()}`;
    const first = await repo.create({
      mode: "FULL_REFRESH",
      logicalKey,
      minMythicPlusScore: 1,
      scoreModelId: null,
      batchSize: 5,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: false,
      allowFullRefreshOnIncompatible: false,
      createdByUserId: null,
      configSnapshot: {},
    });
    await prisma.bulkOperation.update({
      where: { id: first.id },
      data: { status: "PAUSED" },
    });

    await expect(
      repo.create({
        mode: "FULL_REFRESH",
        logicalKey,
        minMythicPlusScore: 1,
        scoreModelId: null,
        batchSize: 5,
        maxCharacters: null,
        maxWclCalls: null,
        dryRun: false,
        allowFullRefreshOnIncompatible: false,
        createdByUserId: null,
        configSnapshot: {},
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.bulkOperation.update({
      where: { id: first.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const second = await repo.create({
      mode: "FULL_REFRESH",
      logicalKey,
      minMythicPlusScore: 1,
      scoreModelId: null,
      batchSize: 5,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: false,
      allowFullRefreshOnIncompatible: false,
      createdByUserId: null,
      configSnapshot: {},
    });
    expect(second.id).not.toBe(first.id);

    await prisma.bulkOperation.deleteMany({ where: { logicalKey } });
  });

  it("persists dispatchedCount / dispatchFailedCount column names (not completed/failed)", async () => {
    const op = await repo.create({
      mode: "RECALCULATE_ONLY",
      logicalKey: `counters-${randomUUID()}`,
      minMythicPlusScore: null,
      scoreModelId: null,
      batchSize: 3,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: false,
      allowFullRefreshOnIncompatible: false,
      createdByUserId: null,
      configSnapshot: {},
    });
    const updated = await repo.saveCheckpoint(op.id, repo.parseCheckpoint(op), {
      enqueuedCount: 2,
      dispatchedCount: 3,
      dispatchFailedCount: 1,
      skippedCount: 0,
      consumedWclCalls: 0,
    });
    expect(updated.dispatchedCount).toBe(3);
    expect(updated.dispatchFailedCount).toBe(1);
    expect(updated.enqueuedCount).toBe(2);
    expect((updated as { completedCount?: unknown }).completedCount).toBeUndefined();
    expect((updated as { failedCount?: unknown }).failedCount).toBeUndefined();

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT dispatched_count, dispatch_failed_count, enqueued_count
      FROM bulk_operations WHERE id = ${op.id}::uuid
    `;
    expect(rows[0]).toMatchObject({
      dispatched_count: 3,
      dispatch_failed_count: 1,
      enqueued_count: 2,
    });

    await prisma.bulkOperation.delete({ where: { id: op.id } });
  });

  it("stores childJobId as IngestionJob UUID, not BullMQ execution id", async () => {
    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: {
        code: "EU",
        apiHost: "https://eu.api.blizzard.com",
        localeDefault: "en_GB",
        enabled: true,
      },
    });
    let realm = await prisma.realm.findFirst({ where: { regionId: region.id, slug: "tarren-mill" } });
    if (!realm) {
      realm = await prisma.realm.create({
        data: { id: randomUUID(), regionId: region.id, slug: "tarren-mill", name: "Tarren Mill" },
      });
    }
    const name = `Bulk${randomUUID().slice(0, 6)}`;
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: name.toLowerCase(),
        displayName: name,
      },
    });

    const ingestionJob = await prisma.ingestionJob.create({
      data: {
        id: randomUUID(),
        jobType: "refresh-character",
        dedupeKey: `bulk-child-${randomUUID()}`,
        status: "QUEUED",
        payload: {},
        characterId: character.id,
      },
    });
    const bullmqId = buildBullmqExecutionJobId(ingestionJob.dedupeKey);
    expect(bullmqId).not.toBe(ingestionJob.id);
    expect(bullmqId).toContain(ingestionJob.dedupeKey);

    const op = await repo.create({
      mode: "FULL_REFRESH",
      logicalKey: `childjob-${randomUUID()}`,
      minMythicPlusScore: null,
      scoreModelId: null,
      batchSize: 1,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: false,
      allowFullRefreshOnIncompatible: false,
      createdByUserId: null,
      configSnapshot: {},
    });
    await prisma.bulkOperationItem.create({
      data: {
        id: randomUUID(),
        bulkOperationId: op.id,
        characterId: character.id,
        position: 0,
        status: "ENQUEUED",
        region: "EU",
        realmSlug: realm.slug,
        characterName: name,
        childJobId: ingestionJob.id,
        childJobType: "refresh-character",
      },
    });
    const item = await prisma.bulkOperationItem.findFirst({ where: { bulkOperationId: op.id } });
    expect(item?.childJobId).toBe(ingestionJob.id);
    expect(item?.childJobId).not.toBe(bullmqId);

    await prisma.bulkOperation.delete({ where: { id: op.id } });
    await prisma.ingestionJob.delete({ where: { id: ingestionJob.id } });
    await prisma.character.delete({ where: { id: character.id } });
  });

  it("SET NULL on user and score model delete; preserves bulk history on character delete", async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        displayName: `BulkUser${randomUUID().slice(0, 4)}`,
        authProvider: "test",
        externalSubject: `bulk-user-${randomUUID()}`,
      },
    });
    const model = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `bulk-model-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: "Bulk integrity model",
        status: "DRAFT",
        config: {},
      },
    });
    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: {
        code: "EU",
        apiHost: "https://eu.api.blizzard.com",
        localeDefault: "en_GB",
        enabled: true,
      },
    });
    let realm = await prisma.realm.findFirst({ where: { regionId: region.id, slug: "tarren-mill" } });
    if (!realm) {
      realm = await prisma.realm.create({
        data: { id: randomUUID(), regionId: region.id, slug: "tarren-mill", name: "Tarren Mill" },
      });
    }
    const name = `Hist${randomUUID().slice(0, 6)}`;
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: name.toLowerCase(),
        displayName: name,
      },
    });

    const op = await repo.create({
      mode: "RECALCULATE_ONLY",
      logicalKey: `fk-${randomUUID()}`,
      minMythicPlusScore: null,
      scoreModelId: model.id,
      batchSize: 1,
      maxCharacters: null,
      maxWclCalls: null,
      dryRun: false,
      allowFullRefreshOnIncompatible: false,
      createdByUserId: user.id,
      configSnapshot: { preserved: true },
    });
    const itemId = randomUUID();
    await prisma.bulkOperationItem.create({
      data: {
        id: itemId,
        bulkOperationId: op.id,
        characterId: character.id,
        position: 0,
        status: "PENDING",
        region: "EU",
        realmSlug: realm.slug,
        characterName: name,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });
    await prisma.scoreModel.delete({ where: { id: model.id } });
    const afterFk = await prisma.bulkOperation.findUnique({ where: { id: op.id } });
    expect(afterFk?.createdByUserId).toBeNull();
    expect(afterFk?.scoreModelId).toBeNull();
    expect(afterFk?.configSnapshot).toMatchObject({ preserved: true });

    await prisma.character.delete({ where: { id: character.id } });
    const afterChar = await prisma.bulkOperationItem.findUnique({ where: { id: itemId } });
    expect(afterChar).not.toBeNull();
    expect(afterChar?.characterId).toBeNull();
    expect(afterChar?.characterName).toBe(name);
    expect(afterChar?.realmSlug).toBe(realm.slug);

    await prisma.bulkOperation.delete({ where: { id: op.id } });
  });

  it("item status enum has no COMPLETED or FAILED values", async () => {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'BulkOperationItemStatus'
      ORDER BY e.enumsortorder
    `;
    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toEqual([
      "PENDING",
      "ENQUEUED",
      "SKIPPED_INCOMPATIBLE",
      "SKIPPED_BUDGET",
      "SKIPPED_CANCELLED",
      "SKIPPED_DRY_RUN",
      "SKIPPED_CHARACTER_DELETED",
    ]);
    expect(labels).not.toContain("COMPLETED");
    expect(labels).not.toContain("FAILED");
  });
});
