/**
 * DB-backed Scoring V2 batch fan-in / finalize integration.
 * Requires `pnpm test:integration` (isolated DB + seed).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import {
  EVIDENCE_SELECTOR_VERSION,
  discoveryIdentityKey,
  type EvidenceAcquisitionPlanV2,
  type EvidenceCandidateAcquisitionResult,
} from "@mplus/contracts";
import { createPrismaClient, checkDatabaseHealth, type PrismaClient } from "@mplus/database";
import { buildEvidenceAcquisitionPlanV2 } from "@mplus/scoring";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createWorkerContainer } from "../../container.js";
import { createEvidenceV2BatchRepository } from "../../persistence/evidence-v2-batch-repository.js";
import { runFinalizeEvidenceBatchV2 } from "./finalize.js";
import { collectOccupiedDiscoveryKeys } from "./occupied-discovery-keys.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping scoring-v2 pipeline integration tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function acquisitionResult(
  reportCode: string,
  fightId: number,
  reportRevision: number,
): EvidenceCandidateAcquisitionResult {
  const factSetHash = createHash("sha256")
    .update(`${reportCode}:${fightId}:${reportRevision}`)
    .digest("hex");
  return {
    discoveryIdentity: { reportCode, fightId },
    acquisitionStatus: "ACQUIRED",
    reportRevision,
    rejectionReason: null,
    rejectionDetail: null,
    datasetHashes: [
      {
        dataset: "COMBATANT_INFO",
        contentHash: createHash("sha256").update(`ds-${reportCode}-${fightId}`).digest("hex"),
      },
    ],
    factSetHash,
    dimensionValidity: {
      performance: "PARTIAL",
      survival: "PARTIAL",
      utility: "PARTIAL",
      reasons: ["integration_test"],
    },
    keyLevel: 12,
    timed: true,
    runScore: 200,
    completedAt: "2026-08-01T12:00:00.000Z",
    actorId: 1,
    evidenceCompleteness: 1,
  };
}

describe.runIf(dbAvailable)("scoring v2 pipeline fan-in integration", () => {
  let characterId: string;
  let seasonId: string;
  let scoreModelId: string;
  let dungeonSlug: string;
  let plan: EvidenceAcquisitionPlanV2;
  let storeRoot: string;

  beforeAll(async () => {
    storeRoot = await mkdtemp(path.join(tmpdir(), "mplus-v2-pipe-"));

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
    let realm = await prisma.realm.findFirst({
      where: { regionId: region.id, slug: "v2-pipe-realm" },
    });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-pipe-realm",
          name: "V2 Pipe Realm",
        },
      });
    }
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `v2pipe${randomUUID().slice(0, 8)}`,
        displayName: "V2Pipe",
        role: "DPS",
      },
    });
    characterId = character.id;

    const season =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "v2-pipe-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-pipe-season",
          name: "V2 Pipe Season",
          blizzardSeasonId: 999201,
          startsAt: new Date("2026-01-01"),
        },
      }));
    seasonId = season.id;

    dungeonSlug = "v2-pipe-dungeon";
    await prisma.dungeon.upsert({
      where: { slug: dungeonSlug },
      update: {},
      create: {
        id: randomUUID(),
        slug: dungeonSlug,
        name: "V2 Pipe Dungeon",
      },
    });

    const model = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `v2-pipe-model-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: "v2-pipe",
        status: "DRAFT",
        config: {},
      },
    });
    scoreModelId = model.id;

    const { plan: built } = buildEvidenceAcquisitionPlanV2({
      scope: {
        characterId,
        seasonId,
        seasonSlug: "v2-pipe-season",
        specializationId: null,
        classSlug: null,
        specSlug: null,
        role: "DPS",
        refreshContractHash: "rf-pipe-1",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2030-01-01T00:00:00.000Z",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [dungeonSlug],
      },
      candidates: [
        {
          discoveryIdentity: { reportCode: "PipeRep01", fightId: 10 },
          reportRevision: null,
          dungeonSlug,
          keyLevel: 14,
          timed: true,
          runScore: 240,
          evidenceCompleteness: 1,
          completedAt: "2026-08-01T10:00:00.000Z",
          fightDurationMs: 1_800_000,
          actorId: 1,
          accessState: "PUBLIC",
          identityResolution: "RESOLVED",
          fightAccessible: true,
          hardError: false,
          discoverySource: "integration",
        },
        {
          discoveryIdentity: { reportCode: "PipeRep02", fightId: 11 },
          reportRevision: null,
          dungeonSlug,
          keyLevel: 12,
          timed: true,
          runScore: 210,
          evidenceCompleteness: 1,
          completedAt: "2026-08-01T11:00:00.000Z",
          fightDurationMs: 1_700_000,
          actorId: 2,
          accessState: "PUBLIC",
          identityResolution: "RESOLVED",
          fightAccessible: true,
          hardError: false,
          discoverySource: "integration",
        },
      ],
      plannedAt: "2026-08-02T12:00:00.000Z",
    });
    plan = built;
    expect(plan.expectedSlotCount).toBe(2);
    expect(plan.slots).toHaveLength(2);
  });

  it("creates batch, completes slots, finalizes manifest, and stays publication-safe", async () => {
    resetEnvCache();
    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      PROVIDER_MODE: "fixture",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      RAW_ARTIFACTS_DIR: storeRoot,
      SCORING_ENABLED: "true",
      SCORING_ENABLED: "true",
      SCORING_ENABLED: "true",
      SCORING_ENABLED: "false",
      SCORING_PUBLICATION_ENABLED: "false",
    });

    const container = createWorkerContainer(env, { prisma });
    const repo = createEvidenceV2BatchRepository(prisma);
    // Ensure container uses the same prisma-backed repo instance for finalize.
    container.repositories.evidenceV2Batch = repo;

    const publishedBefore = await prisma.characterPublishedScore.count({
      where: { characterId },
    });

    const refreshId = randomUUID();
    const { batch, meta } = await repo.createBatch({
      characterId,
      seasonId,
      refreshId,
      scoreModelId,
      acquisitionPlan: plan,
      refreshGeneration: 7,
      parentIngestionJobId: null,
      correlationId: "v2-pipe-itest",
      enabledConsumers: ["PERFORMANCE", "SURVIVAL", "UTILITY"],
    });
    expect(batch.id).toBeTruthy();
    expect(meta.slots).toHaveLength(2);
    expect(meta.publicationBlocked).toBe(true);
    expect(batch.finalizationStatus).toBe("PENDING");

    // Idempotent create (same unique key) returns existing batch.
    const again = await repo.createBatch({
      characterId,
      seasonId,
      refreshId,
      scoreModelId,
      acquisitionPlan: plan,
      refreshGeneration: 7,
      enabledConsumers: ["PERFORMANCE"],
    });
    expect(again.batch.id).toBe(batch.id);

    for (const slot of plan.slots) {
      const claim = await repo.claimSlot({
        batchId: batch.id,
        slotId: slot.slotId,
        refreshGeneration: 7,
      });
      expect(claim.outcome).toBe("claimed");

      const occupied = collectOccupiedDiscoveryKeys(claim.view.meta.slots, slot.slotId);
      const candidate = slot.orderedCandidates.find(
        (c) => !occupied.has(discoveryIdentityKey(c.discoveryIdentity)),
      );
      if (!candidate) {
        const completed = await repo.completeSlot({
          batchId: batch.id,
          slotId: slot.slotId,
          status: "UNAVAILABLE",
          terminalReason: "MISSING_NO_CANDIDATE",
        });
        expect(completed.wasAlreadyTerminal).toBe(false);
        const redelivery = await repo.completeSlot({
          batchId: batch.id,
          slotId: slot.slotId,
          status: "FAILED",
          terminalReason: "SHOULD_NOT_APPLY",
        });
        expect(redelivery.wasAlreadyTerminal).toBe(true);
        continue;
      }

      const result = acquisitionResult(
        candidate.discoveryIdentity.reportCode,
        candidate.discoveryIdentity.fightId,
        3,
      );
      const completed = await repo.completeSlot({
        batchId: batch.id,
        slotId: slot.slotId,
        status: "PARTIAL",
        acquisitionResult: result,
        acquiredDiscoveryKey: discoveryIdentityKey(candidate.discoveryIdentity),
        datasetCompatibilityKeys: [`compat-${slot.slotId}`],
        factSetFingerprint: result.factSetHash,
      });
      expect(completed.wasAlreadyTerminal).toBe(false);

      // Terminal redelivery / idempotency — second complete is a no-op.
      const redelivery = await repo.completeSlot({
        batchId: batch.id,
        slotId: slot.slotId,
        status: "FAILED",
        terminalReason: "SHOULD_NOT_APPLY",
      });
      expect(redelivery.wasAlreadyTerminal).toBe(true);
      const slotAfter = redelivery.view.meta.slots.find((s) => s.slotId === slot.slotId)!;
      expect(slotAfter.status).toBe("PARTIAL");
      expect(slotAfter.terminalReason).toBeNull();
    }

    // At least one slot must have been acquired for a meaningful manifest freeze.
    const midSlots = (await repo.getById(batch.id))!.meta.slots;
    expect(midSlots.some((s) => s.status === "PARTIAL")).toBe(true);
    expect(midSlots.every((s) => s.status === "PARTIAL" || s.status === "UNAVAILABLE")).toBe(true);

    const ready = await repo.getById(batch.id);
    expect(ready?.batch.finalizationStatus).toBe("READY_TO_FINALIZE");
    expect(ready?.meta.batchState).toBe("READY_TO_FINALIZE");
    expect(ready?.batch.terminalRunCount).toBe(2);

    // Concurrent claim algebra on a disposable clone of readiness would require a second
    // batch; instead verify claim CAS once then restore for finalize via redelivery path.
    const claimA = await repo.claimFinalization(batch.id);
    expect(claimA).not.toBeNull();
    expect(claimA?.batch.finalizationStatus).toBe("FINALIZING");
    const claimB = await repo.claimFinalization(batch.id);
    expect(claimB).toBeNull();

    // Put batch back to READY_TO_FINALIZE so finalize can claim again (simulates lost worker
    // after claim without markFinalized — production uses FINALIZING recovery separately).
    await prisma.scoreAnalysisBatch.update({
      where: { id: batch.id },
      data: {
        finalizationStatus: "READY_TO_FINALIZE",
        metadata: {
          ...(typeof claimA!.batch.metadata === "object" && claimA!.batch.metadata
            ? (claimA!.batch.metadata as Record<string, unknown>)
            : {}),
          scoringV2: {
            ...claimA!.meta,
            batchState: "READY_TO_FINALIZE",
          },
        } as object,
      },
    });

    const finalized = await runFinalizeEvidenceBatchV2(container, {
      schemaVersion: "2.0.0",
      analysisBatchId: batch.id,
      acquisitionPlanContentHash: plan.contentHash,
      expectedTerminalSlotCount: 2,
      refreshGeneration: 7,
      requestedAt: new Date().toISOString(),
      correlationId: "v2-pipe-itest",
    });
    expect(finalized.outcome).toBe("finalized");
    expect(finalized.manifestId).toBeTruthy();
    expect(finalized.manifestContentHash).toBeTruthy();

    const frozen = await prisma.evidenceManifest.findUnique({
      where: { id: finalized.manifestId! },
      include: { slots: true },
    });
    expect(frozen).not.toBeNull();
    expect(frozen!.contentHash).toBe(finalized.manifestContentHash);
    expect(frozen!.slots.length).toBeGreaterThan(0);

    const batchAfter = await repo.getById(batch.id);
    expect(batchAfter?.batch.finalizationStatus).toBe("FINALIZED");
    expect(batchAfter?.batch.evidenceManifestId).toBe(finalized.manifestId);
    expect(batchAfter?.meta.manifestContentHash).toBe(finalized.manifestContentHash);

    // Finalize redelivery is idempotent.
    const reFinalize = await runFinalizeEvidenceBatchV2(container, {
      schemaVersion: "2.0.0",
      analysisBatchId: batch.id,
      acquisitionPlanContentHash: plan.contentHash,
      expectedTerminalSlotCount: 2,
      refreshGeneration: 7,
      requestedAt: new Date().toISOString(),
    });
    expect(reFinalize.outcome).toBe("already_finalized");
    expect(reFinalize.manifestId).toBe(finalized.manifestId);

    const publishedAfter = await prisma.characterPublishedScore.count({
      where: { characterId },
    });
    expect(publishedAfter).toBe(publishedBefore);

    // Claim after finalize remains a no-op.
    expect(await repo.claimFinalization(batch.id)).toBeNull();
  });
});
