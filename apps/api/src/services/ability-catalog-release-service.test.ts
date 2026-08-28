import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  compileBootstrapRelease0,
  compareStaticCatalogToReleaseArtifact,
  serializeSemanticReleaseContentBytes,
  casHashOfSemanticBytes,
} from "@mplus/abilities/release";
import { CURRENT_CATALOG_VERSION_ID, getAllRegisteredRules } from "@mplus/abilities";
import {
  AbilityCatalogReleaseService,
  draftRuleRowToAbilityRule,
} from "./ability-catalog-release-service.js";
import { createTestPrismaClient, ensureActiveBootstrapCatalogReleaseForTests } from "../test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

const audit = {
  userId: null as string | null,
  actorType: "system",
  sessionSecret: "test-session-secret-at-least-32-chars",
};

afterAll(async () => {
  await prisma.$disconnect();
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function draftBindingsFromRule(rule: {
  spellIds: number[];
  bindings?: Array<{ spellId: number; role: string }>;
}) {
  if (rule.bindings?.length) {
    return rule.bindings.map((b) => ({ spellId: b.spellId, role: b.role }));
  }
  return rule.spellIds.map((spellId, index) => ({
    spellId,
    role: index === 0 ? "PRIMARY_ACTIVATION" : "CAST_ALIAS",
  }));
}

function readyManualDraftFromRegistry(canonicalKey: string, cooldownDelta: number) {
  const rule = getAllRegisteredRules().find((entry) => entry.canonicalKey === canonicalKey)!;
  return {
    canonicalKey,
    name: rule.name,
    spellIds: [...rule.spellIds],
    bindings: draftBindingsFromRule(rule),
    iconName: rule.iconName ?? null,
    classSlug: rule.classSlug,
    specSlugs: [...rule.specSlugs],
    raceSlugs: [],
    category: rule.category,
    dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
    availability: rule.availability,
    cooldownSeconds: (rule.cooldownSeconds ?? 0) + cooldownDelta,
    charges: rule.charges ?? null,
    sourceOwnership: rule.sourceOwnership,
    provenance: rule.provenance,
  };
}

describe.skipIf(!dbAvailable)("AbilityCatalogReleaseService persistence", () => {
  const service = new AbilityCatalogReleaseService(prisma);

  afterEach(async () => {
    await ensureActiveBootstrapCatalogReleaseForTests(prisma);
  });

  it("persists Bootstrap Release 0 with accepted 3B.1 identity and VALIDATED status", async () => {
    const first = await service.persistBootstrapRelease0(audit);
    expect(first.parityPass).toBe(true);
    expect(["VALIDATED", "ACTIVE"]).toContain(first.release.status);
    expect(first.release.id).toBe("d68793e5-7389-4cd6-b4c2-2eec96bea068");
    expect(first.release.releaseKey).toBe("wow-unknown-static/catalog-v1/fe8c9a03");
    expect(first.release.contentDigest).toBe(
      "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
    );
    expect(first.release.casContentHash).toBe(first.release.contentDigest);
    expect(first.release.ruleCount).toBe(311);
    expect(first.release.classCount).toBe(13);
    expect(first.release.specCount).toBe(40);
    expect(first.release.raceCount).toBe(25);
    expect(first.release.wowBuild).toBe("unknown-static");
    expect(first.release.previousReleaseId).toBeNull();
    expect((first.release.diff as { kind: string }).kind).toBe("BOOTSTRAP");
    expect(first.release.manifest).toMatchObject({
      origin: "BOOTSTRAP_STATIC_CATALOG",
      staticCatalogVersionId: CURRENT_CATALOG_VERSION_ID,
    });
    expect(first.release.validationStatus).toBe("PASS");
    expect(first.release.validationReportDigest).toBeTruthy();
    expect(first.release.validationReportArtifactId).toBeTruthy();

    const second = await service.persistBootstrapRelease0(audit);
    expect(second.created).toBe(false);
    expect(second.release.id).toBe(first.release.id);

    const loaded = await service.loadReleaseArtifact(first.release.id);
    expect(loaded.artifact.contentDigest).toBe(first.release.contentDigest);
    expect(loaded.artifact.rules).toHaveLength(311);
    const parity = compareStaticCatalogToReleaseArtifact(loaded.artifact);
    expect(parity.overall).toBe("PASS");
  });

  it("fails closed on missing / corrupt CAS and digest mismatches", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    const row = await prisma.abilityCatalogRelease.findUniqueOrThrow({
      where: { id: boot.release.id },
    });

    // Corrupt payload bytes while keeping hash key → load fails
    const payload = await prisma.rawArtifactPayload.findUniqueOrThrow({
      where: { contentHash: row.casContentHash },
    });
    const original = Buffer.from(payload.payload);
    await prisma.rawArtifactPayload.update({
      where: { contentHash: row.casContentHash },
      data: { payload: new Uint8Array(Buffer.from("CORRUPT")) },
    });
    await expect(service.loadReleaseArtifact(boot.release.id)).rejects.toMatchObject({
      code: "RELEASE_CAS_CORRUPT",
    });
    // restore
    await prisma.rawArtifactPayload.update({
      where: { contentHash: row.casContentHash },
      data: { payload: new Uint8Array(original) },
    });

    // Metadata digest mismatch
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { contentDigest: "0".repeat(64) },
    });
    await expect(service.loadReleaseArtifact(boot.release.id)).rejects.toMatchObject({
      code: "RELEASE_CONTENT_DIGEST_MISMATCH",
    });
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { contentDigest: boot.release.contentDigest },
    });

    // releaseKey mismatch
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { releaseKey: "wow-unknown-static/catalog-v1/deadbeef" },
    });
    await expect(service.loadReleaseArtifact(boot.release.id)).rejects.toMatchObject({
      code: "RELEASE_KEY_MISMATCH",
    });
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { releaseKey: boot.release.releaseKey },
    });

    // topologyDigest mismatch
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { topologyDigest: "1".repeat(64) },
    });
    await expect(service.loadReleaseArtifact(boot.release.id)).rejects.toMatchObject({
      code: "RELEASE_TOPOLOGY_DIGEST_MISMATCH",
    });
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { topologyDigest: boot.release.topologyDigest },
    });

    // missing CAS
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { casContentHash: "f".repeat(64) },
    });
    await expect(service.loadReleaseArtifact(boot.release.id)).rejects.toMatchObject({
      code: "RELEASE_CAS_MISSING",
    });
    await prisma.abilityCatalogRelease.update({
      where: { id: boot.release.id },
      data: { casContentHash: boot.release.casContentHash },
    });
  });

  it("revalidates without mutating semantic content", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    const before = await service.getRelease(boot.release.id);
    const result = await service.revalidateRelease(boot.release.id, audit);
    expect(result.validation.valid).toBe(true);
    expect(result.release.contentDigest).toBe(before.contentDigest);
    expect(result.release.releaseKey).toBe(before.releaseKey);
    expect(result.release.artifactId).toBe(before.artifactId);
    expect(result.release.validationStatus).toBe("PASS");
    expect(result.validatorVersion).toBe("ability-catalog-release-validator-v1");
  });

  it("creates curated candidate from READY drafts (ADD_RULE + UPDATE_TOPOLOGY) without mutating base", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    const baseBefore = await service.loadReleaseArtifact(boot.release.id);

    const batchId = randomUUID();
    const itemRuleId = randomUUID();
    const itemTopoId = randomUUID();
    const draftRuleId = randomUUID();
    const draftTopoId = randomUUID();
    const reportDigest = sha256(Buffer.from(`candidate-${randomUUID()}`));

    await prisma.abilityCatalogReviewBatch.create({
      data: {
        id: batchId,
        reportDigest,
        reviewPlanDigest: sha256(Buffer.from(`candidate-plan-${batchId}`)),
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
        identityKey: `synthetic.add.${randomUUID().slice(0, 8)}`,
        name: "Synthetic Test Ability",
        reviewReason: "test",
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
        canonicalKey: `test.synthetic.${randomUUID().slice(0, 8)}.ability`,
        name: "Synthetic Test Ability",
        spellIds: [98_000_001],
        bindings: [{ spellId: 98_000_001, role: "PRIMARY_ACTIVATION" }],
        classSlug: "mage",
        specSlugs: ["frost"],
        raceSlugs: [],
        category: "OFFENSIVE_MINOR",
        dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
        availability: "BASELINE",
        sourceOwnership: "PLAYER",
        provenance: {
          source: "CURATED_OVERRIDE",
          verifiedAt: "2026-08-16",
          gameVersion: "12.0.0",
          certainty: "verified",
        },
        status: "READY_FOR_PUBLISH_REVIEW",
        version: 1,
      },
    });
    await prisma.abilityCatalogReviewItem.create({
      data: {
        id: itemTopoId,
        batchId,
        kind: "TOPOLOGY_REVIEW",
        identityKey: `topology.race.haranir.${randomUUID().slice(0, 8)}`,
        name: "Haranir",
        reviewReason: "test",
        evidence: {},
        sourceProvenance: {},
        decisionAction: "ACCEPT",
        decidedAt: new Date(),
        version: 1,
      },
    });
    await prisma.abilityCatalogDraftTopology.create({
      data: {
        id: draftTopoId,
        reviewItemId: itemTopoId,
        kind: "RACE",
        slug: "haranir",
        displayName: "Haranir",
        status: "ACCEPTED",
        evidence: { blizzardRaceIds: [99_001] },
        version: 1,
      },
    });

    const candidate = await service.createReleaseCandidate(
      {
        baseReleaseId: boot.release.id,
        includedDraftRuleIds: [{ draftRuleId, draftVersion: 1 }],
        includedDraftTopologyIds: [{ draftTopologyId: draftTopoId, draftVersion: 1 }],
        wowBuild: "69299",
        notes: "synthetic candidate smoke",
      },
      audit,
    );

    expect(candidate.created).toBe(true);
    expect(candidate.release.status).toBe("VALIDATED");
    expect(candidate.release.previousReleaseId).toBe(boot.release.id);
    expect(candidate.release.ruleCount).toBe(312);
    expect(candidate.release.raceCount).toBe(26);
    expect(candidate.release.wowBuild).toBe("69299");
    expect((candidate.release.diff as { kind: string }).kind).toBe("CURATED");

    const loadedCandidate = await service.loadReleaseArtifact(candidate.release.id);
    expect(loadedCandidate.artifact.rules).toHaveLength(312);
    expect(loadedCandidate.artifact.topology.races.some((r) => r.slug === "haranir")).toBe(true);

    // Base immutable
    const baseAfter = await service.loadReleaseArtifact(boot.release.id);
    expect(baseAfter.artifact.contentDigest).toBe(baseBefore.artifact.contentDigest);
    expect(baseAfter.artifact.rules).toHaveLength(311);
    expect(baseAfter.artifact.topology.races.some((r) => r.slug === "haranir")).toBe(false);

    // Untouched keys still present
    const baseKeys = new Set(baseBefore.artifact.rules.map((r) => r.canonicalKey));
    const candKeys = new Set(loadedCandidate.artifact.rules.map((r) => r.canonicalKey));
    for (const k of baseKeys) expect(candKeys.has(k)).toBe(true);

    // Idempotent same candidate
    const again = await service.createReleaseCandidate(
      {
        baseReleaseId: boot.release.id,
        includedDraftRuleIds: [{ draftRuleId, draftVersion: 1 }],
        includedDraftTopologyIds: [{ draftTopologyId: draftTopoId, draftVersion: 1 }],
        wowBuild: "69299",
        notes: "synthetic candidate smoke",
      },
      audit,
    );
    expect(again.created).toBe(false);
    expect(again.release.id).toBe(candidate.release.id);

    // NEEDS_METADATA fails
    await prisma.abilityCatalogDraftRule.update({
      where: { id: draftRuleId },
      data: { status: "NEEDS_METADATA" },
    });
    // Force a different content by changing wowBuild so we don't hit idempotent short-circuit
    // after restoring READY — first assert NEEDS_METADATA fails:
    await expect(
      service.createReleaseCandidate(
        {
          baseReleaseId: boot.release.id,
          includedDraftRuleIds: [{ draftRuleId, draftVersion: 1 }],
          wowBuild: "70001",
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "DRAFT_NOT_READY" });
    await prisma.abilityCatalogDraftRule.update({
      where: { id: draftRuleId },
      data: { status: "READY_FOR_PUBLISH_REVIEW" },
    });
  });

  it("implicit createReleaseCandidate auto-selects READY draft rules", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    const targetKey = "shaman.offensive.stormkeeper";
    const registryRule = getAllRegisteredRules().find((rule) => rule.canonicalKey === targetKey)!;
    const draftData = readyManualDraftFromRegistry(targetKey, 1);

    await prisma.abilityCatalogDraftRule.deleteMany({ where: { status: "READY_FOR_PUBLISH_REVIEW" } });

    await prisma.abilityCatalogDraftRule.create({
      data: {
        id: randomUUID(),
        source: "MANUAL",
        reviewItemId: null,
        ...draftData,
        status: "READY_FOR_PUBLISH_REVIEW",
        version: 1,
      },
    });

    const candidate = await service.createReleaseCandidate({ baseReleaseId: boot.release.id }, audit);
    const art = await service.loadReleaseArtifact(candidate.release.id);
    const updated = art.artifact.rules.find((r) => r.canonicalKey === targetKey);
    expect(updated?.cooldownSeconds).toBe((registryRule.cooldownSeconds ?? 0) + 1);
  });

  it("explicit removal-only request does not auto-include READY rule drafts", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    const loadedBase = await service.loadReleaseArtifact(boot.release.id);
    const tombstoneKey = loadedBase.artifact.rules[0]!.canonicalKey;
    const otherKey = "shaman.offensive.stormkeeper";
    const registryRule = getAllRegisteredRules().find((rule) => rule.canonicalKey === otherKey)!;
    const draftData = readyManualDraftFromRegistry(otherKey, 9);

    await prisma.abilityCatalogDraftRule.deleteMany({ where: { status: "READY_FOR_PUBLISH_REVIEW" } });
    await prisma.abilityCatalogDraftRule.create({
      data: {
        id: randomUUID(),
        source: "MANUAL",
        reviewItemId: null,
        ...draftData,
        status: "READY_FOR_PUBLISH_REVIEW",
        version: 1,
      },
    });

    const batchId = randomUUID();
    const itemId = randomUUID();
    await prisma.abilityCatalogReviewBatch.create({
      data: {
        id: batchId,
        reportDigest: sha256(Buffer.from(`removal-explicit-${randomUUID()}`)),
        reviewPlanDigest: sha256(Buffer.from(`removal-explicit-plan-${batchId}`)),
        datasetKind: "PINNED",
        sourceIdentities: {},
        summaryCounts: {},
      },
    });
    await prisma.abilityCatalogReviewItem.create({
      data: {
        id: itemId,
        batchId,
        kind: "REMOVAL_REVIEW",
        identityKey: `removal.${tombstoneKey}`,
        name: "Removal",
        matchedCanonicalKey: tombstoneKey,
        reviewReason: "test",
        evidence: {},
        sourceProvenance: {},
        decisionAction: "CONFIRM_REMOVAL",
        decidedAt: new Date(),
        version: 1,
      },
    });

    const tombstoned = await service.createReleaseCandidate(
      {
        baseReleaseId: boot.release.id,
        includedRemovalItemIds: [{ reviewItemId: itemId, validToBuild: "70000" }],
        wowBuild: "tombstone-explicit-only",
      },
      audit,
    );
    expect(tombstoned.release.ruleCount).toBe(311);
    const art = await service.loadReleaseArtifact(tombstoned.release.id);
    expect(art.artifact.rules.find((r) => r.canonicalKey === tombstoneKey)?.validToBuild).toBe("70000");
    expect(art.artifact.rules.find((r) => r.canonicalKey === otherKey)?.cooldownSeconds).toBe(
      registryRule.cooldownSeconds,
    );
  });

  it("explicit empty includedDraftRuleIds yields EMPTY_CHANGESET", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    await prisma.abilityCatalogDraftRule.deleteMany({ where: { status: "READY_FOR_PUBLISH_REVIEW" } });
    await expect(
      service.createReleaseCandidate(
        {
          baseReleaseId: boot.release.id,
          includedDraftRuleIds: [],
          includedDraftTopologyIds: [],
          includedRemovalItemIds: [],
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "EMPTY_CHANGESET" });
  });

  it("supports TOMBSTONE_RULE via explicit removal inclusion without mutating base", async () => {
    const boot = await service.persistBootstrapRelease0(audit);
    const loadedBase = await service.loadReleaseArtifact(boot.release.id);
    const targetKey = loadedBase.artifact.rules[0]!.canonicalKey;

    const batchId = randomUUID();
    const itemId = randomUUID();
    await prisma.abilityCatalogReviewBatch.create({
      data: {
        id: batchId,
        reportDigest: sha256(Buffer.from(`removal-${randomUUID()}`)),
        reviewPlanDigest: sha256(Buffer.from(`removal-plan-${batchId}`)),
        datasetKind: "PINNED",
        sourceIdentities: {},
        summaryCounts: {},
      },
    });
    await prisma.abilityCatalogReviewItem.create({
      data: {
        id: itemId,
        batchId,
        kind: "REMOVAL_REVIEW",
        identityKey: `removal.${targetKey}`,
        name: "Removal",
        matchedCanonicalKey: targetKey,
        reviewReason: "test",
        evidence: {},
        sourceProvenance: {},
        decisionAction: "CONFIRM_REMOVAL",
        decidedAt: new Date(),
        version: 1,
      },
    });

    const tombstoned = await service.createReleaseCandidate(
      {
        baseReleaseId: boot.release.id,
        includedRemovalItemIds: [{ reviewItemId: itemId, validToBuild: "70000" }],
        wowBuild: "tombstone-test",
      },
      audit,
    );
    expect(tombstoned.release.ruleCount).toBe(311);
    const art = await service.loadReleaseArtifact(tombstoned.release.id);
    const rule = art.artifact.rules.find((r) => r.canonicalKey === targetKey);
    expect(rule?.validToBuild).toBe("70000");
    expect(rule?.provenance.certainty).toBe("deprecated");

    const base = await service.loadReleaseArtifact(boot.release.id);
    const baseRule = base.artifact.rules.find((r) => r.canonicalKey === targetKey);
    expect(baseRule?.validToBuild).toBeUndefined();
  });

  it("CAS semantic bytes exclude generatedAt and match contentDigest", () => {
    const a = compileBootstrapRelease0({ generatedAt: "2020-01-01T00:00:00.000Z" });
    const b = compileBootstrapRelease0({ generatedAt: "2099-01-01T00:00:00.000Z" });
    const bytesA = serializeSemanticReleaseContentBytes(a.artifact);
    const bytesB = serializeSemanticReleaseContentBytes(b.artifact);
    expect(bytesA.equals(bytesB)).toBe(true);
    expect(casHashOfSemanticBytes(bytesA)).toBe(a.artifact.contentDigest);
    expect(bytesA.toString("utf8")).not.toContain("generatedAt");
  });
});

describe("draftRuleRowToAbilityRule", () => {
  it("maps bindings into AbilityRule fields", () => {
    const rule = draftRuleRowToAbilityRule({
      canonicalKey: "mage.test.foo",
      name: "Foo",
      spellIds: [1],
      bindings: [
        { spellId: 1, role: "PRIMARY_ACTIVATION" },
        { spellId: 2, role: "CAST_ALIAS" },
      ],
      iconName: null,
      classSlug: "mage",
      specSlugs: ["frost"],
      raceSlugs: [],
      category: "OFFENSIVE_MINOR",
      dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
      availability: "BASELINE",
      cooldownSeconds: 30,
      charges: null,
      sourceOwnership: "PLAYER",
      provenance: { source: "CURATED_OVERRIDE", verifiedAt: "2026-08-16", gameVersion: "12.0.0" },
      validityBuild: null,
    });
    expect(rule.aliases).toEqual([2]);
    expect(rule.activationSpellIds).toEqual([1]);
    expect(rule.roles).toEqual(["DPS"]);
  });
});

describe("Phase 3B.2 runtime isolation", () => {
  it("keeps static catalog authority and does not invent activation APIs", async () => {
    const compiled = compileBootstrapRelease0();
    expect(compiled.artifact.rules).toHaveLength(311);
    expect(compiled.parity.overall).toBe("PASS");
    const mod = await import("@mplus/abilities");
    expect("activateAbilityCatalogRelease" in mod).toBe(false);
    expect(CURRENT_CATALOG_VERSION_ID).toBe("12.0.0/midnight-season-1");
  });
});
