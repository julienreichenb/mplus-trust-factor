import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getAllRegisteredRules, projectCurrentRuleBindings } from "@mplus/abilities";
import { AbilityCatalogManualEditService } from "./ability-catalog-manual-edit-service.js";
import { AbilityCatalogReleaseService } from "./ability-catalog-release-service.js";
import { createTestPrismaClient, ensureActiveBootstrapCatalogReleaseForTests } from "../test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

const audit = {
  userId: null as string | null,
  actorType: "admin_key" as const,
  sessionSecret: "test-session-secret-at-least-32-chars",
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("AbilityCatalogManualEditService", () => {
  const manual = new AbilityCatalogManualEditService(prisma);
  const releases = new AbilityCatalogReleaseService(prisma);
  const stormkeeper = getAllRegisteredRules().find(
    (rule) => rule.canonicalKey === "shaman.offensive.stormkeeper",
  );
  const stormkeeperBindings = () =>
    projectCurrentRuleBindings(stormkeeper!).map((b) => ({
      spellId: b.spellId,
      role: b.role,
    }));

  async function activeBootstrapReleaseId(): Promise<string> {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
    const active = await prisma.abilityCatalogRelease.findFirstOrThrow({
      where: { status: "ACTIVE" },
    });
    return active.id;
  }

  beforeEach(async () => {
    await prisma.abilityCatalogDraftRule.deleteMany({ where: { source: "MANUAL" } });
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
  });

  afterEach(async () => {
    await prisma.abilityCatalogDraftRule.deleteMany({ where: { source: "MANUAL" } });
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
  });

  it("saves business metadata without review batch and compiles into release candidate", async () => {
    expect(stormkeeper).toBeTruthy();
    const baseReleaseId = await activeBootstrapReleaseId();

    const baseBefore = await releases.loadReleaseArtifact(baseReleaseId);
    const baseRule = baseBefore.artifact.rules.find(
      (r) => r.canonicalKey === stormkeeper!.canonicalKey,
    );
    expect(baseRule?.cooldownSeconds).toBe(stormkeeper!.cooldownSeconds);

    const saved = await manual.saveEdit(
      stormkeeper!.canonicalKey,
      {
        draft: {
          category: "INTERRUPT",
        },
      },
      audit,
    );
    expect(saved.draftStatus).toBe("READY_FOR_PUBLISH_REVIEW");
    expect(saved.draftVersion).toBe(1);
    const savedDraft = saved.draft as {
      category?: string;
      cooldownSeconds?: number;
      availability?: string;
    };
    expect(savedDraft.category).toBe("INTERRUPT");
    expect(savedDraft.cooldownSeconds).toBe(stormkeeper!.cooldownSeconds);
    expect(savedDraft.availability).toBe(stormkeeper!.availability);

    const activeAfterSave = await releases.loadReleaseArtifact(baseReleaseId);
    const unchanged = activeAfterSave.artifact.rules.find(
      (r) => r.canonicalKey === stormkeeper!.canonicalKey,
    );
    expect(unchanged?.cooldownSeconds).toBe(baseRule?.cooldownSeconds);
    expect(unchanged?.category).toBe(stormkeeper!.category);

    const candidate = await releases.createReleaseCandidate({ baseReleaseId }, audit);
    const loadedCandidate = await releases.loadReleaseArtifact(candidate.release.id);
    const updated = loadedCandidate.artifact.rules.find(
      (r) => r.canonicalKey === stormkeeper!.canonicalKey,
    );
    expect(updated?.cooldownSeconds).toBe(stormkeeper!.cooldownSeconds);
    expect(updated?.category).toBe("INTERRUPT");
    expect(updated?.availability).toBe(stormkeeper!.availability);
  });

  it("rejects source-owned fields in manual edit payload", async () => {
    expect(stormkeeper).toBeTruthy();
    await activeBootstrapReleaseId();

    await expect(
      manual.saveEdit(
        stormkeeper!.canonicalKey,
        {
          draft: {
            category: stormkeeper!.category,
            cooldownSeconds: 999,
          } as never,
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("discard removes pending manual edit", async () => {
    expect(stormkeeper).toBeTruthy();
    await activeBootstrapReleaseId();

    await manual.saveEdit(
      stormkeeper!.canonicalKey,
      {
        draft: {
          category: stormkeeper!.category,
        },
      },
      audit,
    );
    const pending = await manual.listPendingEdits();
    expect(pending.edits.some((e) => e.canonicalKey === stormkeeper!.canonicalKey)).toBe(true);

    await manual.discardEdit(stormkeeper!.canonicalKey, audit);
    const after = await manual.listPendingEdits();
    expect(after.edits.some((e) => e.canonicalKey === stormkeeper!.canonicalKey)).toBe(false);
  });

  it("incomplete manual draft is not included in release candidate", async () => {
    expect(stormkeeper).toBeTruthy();
    const baseReleaseId = await activeBootstrapReleaseId();

    await prisma.abilityCatalogDraftRule.create({
      data: {
        id: randomUUID(),
        source: "MANUAL",
        reviewItemId: null,
        canonicalKey: stormkeeper!.canonicalKey,
        name: stormkeeper!.name,
        spellIds: [...stormkeeper!.spellIds],
        bindings: stormkeeperBindings(),
        classSlug: stormkeeper!.classSlug,
        specSlugs: [...stormkeeper!.specSlugs],
        raceSlugs: [],
        category: null,
        dimensionTags: [],
        availability: null,
        sourceOwnership: "PLAYER",
        provenance: {},
        status: "NEEDS_METADATA",
        version: 1,
      },
    });

    await expect(
      releases.createReleaseCandidate(
        {
          baseReleaseId,
          includedDraftRuleIds: [],
          includedDraftTopologyIds: [],
          includedRemovalItemIds: [],
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "EMPTY_CHANGESET" });
  });
});
