/**
 * End-to-end relevant-character discovery enqueue idempotency through persistAndEnqueue.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";
import { loadEnv } from "@mplus/config";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import {
  QUEUE_NAMES,
  refreshCharacterJobSchema,
  RUNTIME_SETTING_KEYS,
  type RefreshCharacterJob,
} from "@mplus/contracts";
import { encodeMythicPlusRecord } from "../../../../packages/providers/raiderio/src/addon-db/fixture.js";
import { MYTHICPLUS_RECORD_SIZE_BYTES } from "../../../../packages/providers/raiderio/src/addon-db/types.js";
import {
  assertTestDatabaseAllowed,
  sanitizeDatabaseUrl,
} from "@mplus/test-utils";
import { createWorkerContainer } from "../container.js";
import { refreshCharacterDedupeKey } from "../dedupe.js";
import { persistAndEnqueue } from "./enqueue.js";
import { runRelevantCharacterDiscovery } from "./relevant-character-discovery.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping relevant discovery idempotency tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function mockAddonSnapshot() {
  const low = encodeMythicPlusRecord({
    currentScore: 1000,
    dungeonLevels: [10, 10, 10, 10, 10, 10, 10, 10],
  });
  const high = encodeMythicPlusRecord({
    currentScore: 3200,
    dungeonLevels: [18, 18, 18, 18, 18, 18, 18, 18],
  });
  const lookup = new Uint8Array(MYTHICPLUS_RECORD_SIZE_BYTES * 2);
  lookup.set(low, 0);
  lookup.set(high, MYTHICPLUS_RECORD_SIZE_BYTES);
  const named = [
    { realm: "tarren-mill", name: "RelevantOne", byteOffset: MYTHICPLUS_RECORD_SIZE_BYTES + 1 },
  ];
  return { lookup, named };
}

async function requireActiveAbilityCatalogRelease() {
  const row = await prisma.abilityCatalogRelease.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  if (!row) {
    throw new Error("ACTIVE ability catalog release required — run seed-active-bootstrap on test DB");
  }
}

describe.skipIf(!dbAvailable)("relevant character discovery enqueue idempotency", () => {
  it("reuses active refresh job on second discovery with same contract", async () => {
    await requireActiveAbilityCatalogRelease();

    const suffix = randomUUID().slice(0, 8);
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: databaseUrl,
      PROVIDER_MODE: "fixture",
      RELEVANT_REFRESH_KILL_SWITCH: "false",
      RELEVANT_CANDIDATE_TARGET: "10",
      RELEVANT_CANDIDATE_PERCENTILE_BPS: "7500",
    });
    const container = createWorkerContainer(env, { prisma });
    const queue = {
      add: vi.fn(async () => ({ id: `bull-${randomUUID()}` })),
      getJob: vi.fn(),
    } as unknown as Queue;

    const enqueueRefreshCharacter = async (
      input: Omit<RefreshCharacterJob, "requestedAt"> & { requestedAt?: string },
    ) => {
      const payload = refreshCharacterJobSchema.parse({
        ...input,
        requestedAt: input.requestedAt ?? new Date().toISOString(),
      }) as RefreshCharacterJob;
      const dedupeKey = refreshCharacterDedupeKey(payload);
      return persistAndEnqueue({
        queue,
        jobType: QUEUE_NAMES.refreshCharacter,
        dedupeKey,
        payload,
        jobRepository: container.repositories.job,
        logger: container.logger,
        options: {
          characterId: payload.characterId ?? null,
          priority: payload.priority === "high" ? 10 : payload.priority === "low" ? -10 : 0,
        },
      });
    };

    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: { enabled: true },
      create: {
        code: "EU",
        apiHost: "https://eu.api.blizzard.com",
        localeDefault: "en_GB",
        enabled: true,
      },
    });

    const seasonSlug = `rel-disc-${suffix}`;
    const blizzardSeasonId = 998001 + Math.floor(Math.random() * 1000);
    const season = await prisma.season.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: seasonSlug,
        name: "Rel Disc Season",
        blizzardSeasonId,
        isCurrent: false,
        startsAt: new Date("2026-01-01"),
      },
    });

    const priorSeasonSelection = await prisma.runtimeSetting.findUnique({
      where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection },
    });

    await prisma.runtimeSetting.upsert({
      where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection },
      update: { value: { mode: "PINNED", blizzardSeasonId } },
      create: {
        key: RUNTIME_SETTING_KEYS.scoringSeasonSelection,
        value: { mode: "PINNED", blizzardSeasonId },
        version: 1,
      },
    });

    const modelKey = `rel-disc-${suffix}`;
    const scoreModel = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: modelKey,
        version: 1,
        name: modelKey,
        status: "ACTIVE",
        config: {
          weights: { PERFORMANCE: 0.25, SURVIVAL: 0.25, UTILITY: 0.25, EXPERIENCE: 0.25 },
          authenticityBlend: { skillWeight: 0.5, authenticityWeight: 0.5 },
          gradeThresholds: { S: 90, A: 80, B: 70, C: 60 },
        },
      },
    });
    void scoreModel;

    await prisma.runtimeSetting.upsert({
      where: { key: RUNTIME_SETTING_KEYS.relevantRefreshEnabled },
      update: { value: true },
      create: {
        key: RUNTIME_SETTING_KEYS.relevantRefreshEnabled,
        value: true,
        version: 1,
      },
    });

    const jobPayload = {
      mode: "daily_discovery" as const,
      regionCode: "EU" as const,
      requestedAt: new Date().toISOString(),
    };

    const first = await runRelevantCharacterDiscovery(container, jobPayload, { enqueueRefreshCharacter }, {
      loadAddon: async () => mockAddonSnapshot(),
    });
    expect(first.counters.enqueued).toBe(1);
    expect(first.counters.deduped).toBe(0);
    expect(first.counters.newCount).toBe(1);

    const character = await prisma.character.findFirst({
      where: { regionId: region.id, normalizedName: "relevantone" },
    });
    expect(character).not.toBeNull();

    const activeBefore = await prisma.ingestionJob.findMany({
      where: {
        characterId: character!.id,
        jobType: "refresh-character",
        status: { in: ["QUEUED", "ACTIVE"] },
      },
    });
    expect(activeBefore).toHaveLength(1);
    const firstJobId = activeBefore[0]!.id;

    await prisma.ingestionJob.update({
      where: { id: firstJobId },
      data: { status: "ACTIVE", startedAt: new Date() },
    });

    const second = await runRelevantCharacterDiscovery(container, jobPayload, { enqueueRefreshCharacter }, {
      loadAddon: async () => mockAddonSnapshot(),
    });
    expect(second.counters.enqueued).toBe(0);
    expect(second.counters.freshSkipped).toBe(1);
    expect(second.counters.deduped).toBe(0);

    const activeAfter = await prisma.ingestionJob.findMany({
      where: {
        characterId: character!.id,
        jobType: "refresh-character",
        status: { in: ["QUEUED", "ACTIVE"] },
      },
    });
    expect(activeAfter).toHaveLength(1);
    expect(activeAfter[0]!.id).toBe(firstJobId);

    await prisma.ingestionJob.deleteMany({ where: { characterId: character!.id } }).catch(() => undefined);
    await prisma.character.delete({ where: { id: character!.id } }).catch(() => undefined);
    await prisma.season.delete({ where: { id: season.id } }).catch(() => undefined);
    await prisma.scoreModel.delete({ where: { id: scoreModel.id } }).catch(() => undefined);
    if (priorSeasonSelection) {
      await prisma.runtimeSetting.update({
        where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection },
        data: { value: priorSeasonSelection.value },
      });
    } else {
      await prisma.runtimeSetting
        .delete({ where: { key: RUNTIME_SETTING_KEYS.scoringSeasonSelection } })
        .catch(() => undefined);
    }
  });
});
