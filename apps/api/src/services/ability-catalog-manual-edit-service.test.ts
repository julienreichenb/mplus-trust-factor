import { afterAll, afterEach, describe, expect, it } from "vitest";
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

  afterEach(async () => {
    await prisma.abilityCatalogDraftRule.deleteMany({ where: { source: "MANUAL" } });
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
  });

  it("saves manual edit without review batch and compiles into release candidate", async () => {
    expect(stormkeeper).toBeTruthy();
    const boot = await releases.persistBootstrapRelease0(audit);
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { status: "ACTIVE" },
    });

    const baseBefore = await releases.loadReleaseArtifact(boot.release.id);
    const baseRule = baseBefore.artifact.rules.find(
      (r) => r.canonicalKey === stormkeeper!.canonicalKey,
    );
    expect(baseRule?.cooldownSeconds).toBe(stormkeeper!.cooldownSeconds);

    const bindings = stormkeeperBindings();

    const saved = await manual.saveEdit(
      stormkeeper!.canonicalKey,
      {
        draft: {
          name: stormkeeper!.name,
          spellIds: [...stormkeeper!.spellIds],
          bindings,
          classSlug: stormkeeper!.classSlug,
          specSlugs: [...stormkeeper!.specSlugs],
          category: stormkeeper!.category,
          dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
          availability: stormkeeper!.availability,
          cooldownSeconds: (stormkeeper!.cooldownSeconds ?? 0) + 5,
          sourceOwnership: stormkeeper!.sourceOwnership,
          provenance: {
            source: stormkeeper!.provenance.source,
            verifiedAt: stormkeeper!.provenance.verifiedAt,
            gameVersion: stormkeeper!.provenance.gameVersion,
          },
        },
      },
      audit,
    );
    expect(saved.draftStatus).toBe("READY_FOR_PUBLISH_REVIEW");
    expect(saved.draftVersion).toBe(1);

    const activeAfterSave = await releases.loadReleaseArtifact(boot.release.id);
    const unchanged = activeAfterSave.artifact.rules.find(
      (r) => r.canonicalKey === stormkeeper!.canonicalKey,
    );
    expect(unchanged?.cooldownSeconds).toBe(baseRule?.cooldownSeconds);

    const candidate = await releases.createReleaseCandidate(
      { baseReleaseId: boot.release.id },
      audit,
    );
    const loadedCandidate = await releases.loadReleaseArtifact(candidate.release.id);
    const updated = loadedCandidate.artifact.rules.find(
      (r) => r.canonicalKey === stormkeeper!.canonicalKey,
    );
    expect(updated?.cooldownSeconds).toBe((stormkeeper!.cooldownSeconds ?? 0) + 5);
  });

  it("discard removes pending manual edit", async () => {
    expect(stormkeeper).toBeTruthy();
    const boot = await releases.persistBootstrapRelease0(audit);
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { status: "ACTIVE" },
    });

    await manual.saveEdit(
      stormkeeper!.canonicalKey,
      {
        draft: {
          name: stormkeeper!.name,
          spellIds: [...stormkeeper!.spellIds],
          bindings: stormkeeperBindings(),
          classSlug: stormkeeper!.classSlug,
          specSlugs: [...stormkeeper!.specSlugs],
          category: stormkeeper!.category,
          dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
          availability: stormkeeper!.availability,
          cooldownSeconds: 99,
          sourceOwnership: stormkeeper!.sourceOwnership,
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
    const boot = await releases.persistBootstrapRelease0(audit);
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { status: "ACTIVE" },
    });

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
      releases.createReleaseCandidate({ baseReleaseId: boot.release.id }, audit),
    ).rejects.toMatchObject({ code: "EMPTY_CHANGESET" });
  });
});
