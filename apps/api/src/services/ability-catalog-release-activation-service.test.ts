/**
 * Phase 3B.5 — activation / rollback / enqueue pin mode.
 *
 * Never clears the shared ACTIVE release for the duration of a test body:
 * parallel character-route suites share the isolated DB and fail closed without ACTIVE.
 */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { AbilityCatalogReleaseService } from "./ability-catalog-release-service.js";
import { AbilityCatalogReleaseActivationService } from "./ability-catalog-release-activation-service.js";
import {
  createTestPrismaClient,
  ensureActiveBootstrapCatalogReleaseForTests,
  ensureActiveBootstrapCatalogReleaseUnlocked,
  withCatalogActiveTestLock,
} from "../test-helpers.js";
import { resolveEnqueueAbilityCatalogExecutionPin } from "@mplus/worker";
import { AbilityCatalogPinError } from "@mplus/contracts";

const { prisma, dbAvailable } = await createTestPrismaClient();

const audit = {
  userId: null as string | null,
  actorType: "system" as const,
  sessionSecret: "test-session-secret-at-least-32-chars",
};

afterAll(async () => {
  await prisma.$disconnect();
});

async function ensurePassedReplay(candidateReleaseId: string): Promise<void> {
  const existing = await prisma.abilityCatalogReleaseReplay.findFirst({
    where: { candidateReleaseId, status: "PASSED" },
  });
  if (existing) return;
  await prisma.abilityCatalogReleaseReplay.create({
    data: {
      idempotencyKey: `activation-test|${candidateReleaseId}|${randomUUID()}`,
      baseKind: "STATIC",
      baseReleaseId: null,
      candidateReleaseId,
      corpusDigest: "a".repeat(64),
      replayInputDigest: "b".repeat(64),
      replayEngineVersion: "test",
      status: "PASSED",
      summary: {
        artifactsSelected: 1,
        changedAnalyses: 0,
        unresolvedFailures: 0,
      },
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
}

async function createSyntheticValidatedCandidate(
  releases: AbilityCatalogReleaseService,
  baseReleaseId: string,
): Promise<{ id: string; contentDigest: string; releaseKey: string }> {
  const batchId = randomUUID();
  const itemRuleId = randomUUID();
  const draftRuleId = randomUUID();
  const reportDigest = createHash("sha256")
    .update(`activation-synth-${randomUUID()}`)
    .digest("hex");
  const spellId = 98_000_000 + Math.floor(Math.random() * 100_000);
  await prisma.abilityCatalogReviewBatch.create({
    data: {
      id: batchId,
      reportDigest,
      reviewPlanDigest: createHash("sha256").update(`activation-plan-${batchId}`).digest("hex"),
      datasetKind: "PINNED",
      sourceIdentities: {},
      summaryCounts: {},
    },
  });
  await prisma.abilityCatalogReviewItem.create({
    data: {
      id: itemRuleId,
      batchId,
      kind: "NEW_ABILITY_CANDIDATE",
      identityKey: `synthetic.activation.${randomUUID().slice(0, 8)}`,
      name: "Activation Synthetic Ability",
      reviewReason: "activation test",
      evidence: {},
      sourceProvenance: {},
      decisionAction: "ACCEPT",
      decidedAt: new Date(),
      version: 1,
    },
  });
  await prisma.abilityCatalogDraftRule.create({
    data: {
      id: draftRuleId,
      reviewItemId: itemRuleId,
      canonicalKey: `test.activation.${randomUUID().slice(0, 8)}.ability`,
      name: "Activation Synthetic Ability",
      spellIds: [spellId],
      bindings: [{ spellId, role: "PRIMARY_ACTIVATION" }],
      classSlug: "mage",
      specSlugs: ["frost"],
      raceSlugs: [],
      category: "OFFENSIVE_MINOR",
      dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
      availability: "BASELINE",
      sourceOwnership: "PLAYER",
      provenance: {
        source: "CURATED_OVERRIDE",
        verifiedAt: "2026-08-27",
        gameVersion: "12.0.0",
        certainty: "verified",
      },
      status: "READY_FOR_PUBLISH_REVIEW",
      version: 1,
    },
  });
  const created = await releases.createReleaseCandidate(
    {
      baseReleaseId,
      includedDraftRuleIds: [{ draftRuleId, draftVersion: 1 }],
      notes: "activation-service test synthetic",
    },
    audit,
  );
  return {
    id: created.release.id,
    contentDigest: created.release.contentDigest,
    releaseKey: created.release.releaseKey,
  };
}

describe.skipIf(!dbAvailable)("AbilityCatalogReleaseActivationService", () => {
  const releases = new AbilityCatalogReleaseService(prisma);
  const activation = new AbilityCatalogReleaseActivationService(prisma);

  afterEach(async () => {
    // Hold the shared ACTIVE lock while restoring so parallel character suites never
    // observe a non-Bootstrap ACTIVE between test body end and Bootstrap restore.
    await withCatalogActiveTestLock(prisma, async () => {
      const boot = await releases.persistBootstrapRelease0(audit);
      const active = await prisma.abilityCatalogRelease.findFirst({ where: { status: "ACTIVE" } });
      if (active?.id === boot.release.id) return;
      await ensurePassedReplay(boot.release.id);
      await prisma.abilityCatalogRelease.update({
        where: { id: boot.release.id },
        data: { status: "VALIDATED" },
      });
      await activation.activate(
        {
          releaseId: boot.release.id,
          confirmationDigest: boot.release.contentDigest,
          confirm: true,
          reason: "restore Bootstrap ACTIVE after activation test",
          expectedPreviousActiveId: active?.id ?? null,
        },
        audit,
        { type: active ? "ROLLBACK" : "PUBLISH" },
      );
    });
  });

  it("rejects wrong confirmation digest and missing replay", async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    const boot = await releases.persistBootstrapRelease0(audit);
    const candidate = await createSyntheticValidatedCandidate(releases, boot.release.id);

    await expect(
      activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: "0".repeat(64),
          confirm: true,
        },
        audit,
        { type: "PUBLISH" },
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_DIGEST_MISMATCH" });

    await prisma.abilityCatalogReleaseReplay.deleteMany({
      where: { candidateReleaseId: candidate.id },
    });
    await expect(
      activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: candidate.contentDigest,
          confirm: true,
        },
        audit,
        { type: "PUBLISH" },
      ),
    ).rejects.toMatchObject({ code: "REPLAY_GATE_FAILED" });
  });

  it("activates candidate over Bootstrap; rollback restores Bootstrap ACTIVE", async () => {
    await withCatalogActiveTestLock(prisma, async () => {
      await ensureActiveBootstrapCatalogReleaseUnlocked(prisma);
      const boot = await releases.persistBootstrapRelease0(audit);
      const candidate = await createSyntheticValidatedCandidate(releases, boot.release.id);
      await ensurePassedReplay(candidate.id);

      const published = await activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: candidate.contentDigest,
          confirm: true,
          expectedPreviousActiveId: boot.release.id,
        },
        audit,
        { type: "PUBLISH" },
      );
      expect(published.release.status).toBe("ACTIVE");
      expect(published.activation.type).toBe("PUBLISH");

      const pin = await resolveEnqueueAbilityCatalogExecutionPin({ prisma });
      expect(pin).toMatchObject({
        kind: "RELEASE",
        releaseId: candidate.id,
        contentDigest: candidate.contentDigest,
      });

      const rolled = await activation.activate(
        {
          releaseId: boot.release.id,
          confirmationDigest: boot.release.contentDigest,
          confirm: true,
          reason: "test rollback to Bootstrap",
          expectedPreviousActiveId: candidate.id,
        },
        audit,
        { type: "ROLLBACK" },
      );
      expect(rolled.release.status).toBe("ACTIVE");
      expect(rolled.activation.type).toBe("ROLLBACK");
      expect(rolled.activation.reason).toContain("rollback");

      const history = await activation.listActivations(5);
      expect(history.activations.some((a) => a.type === "PUBLISH")).toBe(true);
      expect(history.activations.some((a) => a.type === "ROLLBACK")).toBe(true);
    });
  });

  it("rejects DRAFT_BUILD and FAILED replay gate", async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    const boot = await releases.persistBootstrapRelease0(audit);
    const candidate = await createSyntheticValidatedCandidate(releases, boot.release.id);

    await prisma.abilityCatalogRelease.update({
      where: { id: candidate.id },
      data: { status: "DRAFT_BUILD" },
    });
    await expect(
      activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: candidate.contentDigest,
          confirm: true,
        },
        audit,
        { type: "PUBLISH" },
      ),
    ).rejects.toMatchObject({ code: "RELEASE_NOT_ACTIVATABLE" });

    await prisma.abilityCatalogRelease.update({
      where: { id: candidate.id },
      data: { status: "VALIDATED" },
    });
    await prisma.abilityCatalogReleaseReplay.deleteMany({
      where: { candidateReleaseId: candidate.id },
    });
    await prisma.abilityCatalogReleaseReplay.create({
      data: {
        idempotencyKey: `activation-fail|${candidate.id}|${randomUUID()}`,
        baseKind: "STATIC",
        baseReleaseId: null,
        candidateReleaseId: candidate.id,
        corpusDigest: "c".repeat(64),
        replayInputDigest: "d".repeat(64),
        replayEngineVersion: "test",
        status: "FAILED",
        summary: { unresolvedFailures: 1 },
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    await expect(
      activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: candidate.contentDigest,
          confirm: true,
        },
        audit,
        { type: "PUBLISH" },
      ),
    ).rejects.toMatchObject({ code: "REPLAY_GATE_FAILED" });
  });

  it("concurrent activate with matching expectedPreviousActiveId conflicts after first wins", async () => {
    await withCatalogActiveTestLock(prisma, async () => {
      await ensureActiveBootstrapCatalogReleaseUnlocked(prisma);
      const boot = await releases.persistBootstrapRelease0(audit);
      const candidate = await createSyntheticValidatedCandidate(releases, boot.release.id);
      await ensurePassedReplay(candidate.id);

      const input = {
        releaseId: candidate.id,
        confirmationDigest: candidate.contentDigest,
        confirm: true as const,
        expectedPreviousActiveId: boot.release.id,
      };
      const settled = await Promise.allSettled([
        activation.activate(input, audit, { type: "PUBLISH" }),
        activation.activate(input, audit, { type: "PUBLISH" }),
      ]);
      const fulfilled = settled.filter((s) => s.status === "fulfilled");
      const rejected = settled.filter((s) => s.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const err = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
      expect(["ALREADY_ACTIVE", "ACTIVE_RELEASE_CONFLICT"]).toContain(err.code);

      const activeCount = await prisma.abilityCatalogRelease.count({
        where: { status: "ACTIVE" },
      });
      expect(activeCount).toBe(1);
    });
  });

  it("Bootstrap ACTIVE pin matches accepted Bootstrap identity", async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    const pin = await resolveEnqueueAbilityCatalogExecutionPin({ prisma });
    expect(pin).toEqual({
      kind: "RELEASE",
      releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
      contentDigest:
        "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
      schemaVersion: "ability-catalog-release-v1",
    });
  });

  it("activation rejects stale expectedPreviousActiveId after another release is ACTIVE", async () => {
    await withCatalogActiveTestLock(prisma, async () => {
      await ensureActiveBootstrapCatalogReleaseUnlocked(prisma);
      const boot = await releases.persistBootstrapRelease0(audit);
      const candidate = await createSyntheticValidatedCandidate(releases, boot.release.id);
      await ensurePassedReplay(candidate.id);

      await activation.activate(
        {
          releaseId: candidate.id,
          confirmationDigest: candidate.contentDigest,
          confirm: true,
          expectedPreviousActiveId: boot.release.id,
        },
        audit,
        { type: "PUBLISH" },
      );

      const other = await createSyntheticValidatedCandidate(releases, boot.release.id);
      await ensurePassedReplay(other.id);

      await expect(
        activation.activate(
          {
            releaseId: other.id,
            confirmationDigest: other.contentDigest,
            confirm: true,
            expectedPreviousActiveId: boot.release.id,
          },
          audit,
          { type: "PUBLISH" },
        ),
      ).rejects.toMatchObject({ code: "ACTIVE_RELEASE_CONFLICT" });
    });
  });

  it("enqueue always queries ACTIVE release", async () => {
    const findFirst = vi.fn(async () => ({
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      releaseKey: "test/feaaaaaa",
      contentDigest: "a".repeat(64),
      schemaVersion: "ability-catalog-release-v1",
      status: "ACTIVE",
    }));
    const pin = await resolveEnqueueAbilityCatalogExecutionPin({
      prisma: { abilityCatalogRelease: { findFirst } } as never,
    });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(pin.kind).toBe("RELEASE");
  });
});

describe("resolveEnqueueAbilityCatalogExecutionPin fail closed", () => {
  it("fails closed when no ACTIVE row", async () => {
    const prismaMock = {
      abilityCatalogRelease: {
        findFirst: async () => null,
      },
    } as never;
    await expect(
      resolveEnqueueAbilityCatalogExecutionPin({
        prisma: prismaMock,
      }),
    ).rejects.toBeInstanceOf(AbilityCatalogPinError);
  });
});
