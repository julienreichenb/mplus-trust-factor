import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getAllRegisteredRules, CURRENT_CATALOG_VERSION_ID, dimensionTagsForRule, projectCurrentRuleBindings } from "@mplus/abilities";
import { AbilityCatalogReviewService } from "./ability-catalog-review-service.js";
import { buildApp } from "../app.js";
import { createApiContainer, type ApiContainer } from "../container.js";
import { buildTestEnv, createTestPrismaClient, uniqueName } from "../test-helpers.js";
import { ensureIamSeed } from "../iam/seed.js";
import type { CatalogRefreshReport } from "@mplus/abilities";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-ability-review";

afterAll(async () => {
  await prisma.$disconnect();
});

function minimalPinnedReport(overrides: Partial<CatalogRefreshReport> = {}): CatalogRefreshReport {
  const now = "2026-08-16T18:00:00.000Z";
  return {
    schemaVersion: "ability-catalog-refresh-shadow-v1",
    generatedAt: now,
    publication: "NONE",
    datasetKind: "PINNED",
    snapshots: [
      {
        source: "SIMULATIONCRAFT",
        datasetKind: "PINNED",
        sourceVersion: "spellquery-export-0.1.0",
        sourceRevision: "a060a356e16fdf266cb8b93fa4a9c892f3e26af3",
        retrievedAt: now,
        validFromBuild: "69299",
        captureProvenance: "REAL_CAPTURE",
      },
      {
        source: "BLIZZARD",
        datasetKind: "PINNED",
        sourceVersion: "wow-game-data",
        sourceRevision: "69299",
        retrievedAt: now,
        blizzardNamespace: "static-eu",
        captureProvenance: "REAL_CAPTURE",
      },
    ],
    validation: { valid: true, errors: [], warnings: [] },
    coverage: {
      datasetKind: "PINNED",
      classesDiscovered: [],
      specsDiscovered: [],
      racesDiscovered: ["haranir"],
      candidateAbilities: 0,
      candidateActiveAbilities: 0,
      candidatePassiveAbilities: 0,
      candidateUnknownAbilities: 0,
      racialCandidates: 0,
      candidatesByClass: {},
      candidatesBySpec: {},
      candidatesByCategory: {},
      currentCatalogEntries: getAllRegisteredRules().length,
      missingFromCurrentCatalog: 1,
      missingFromExternalSources: 0,
      changedBindings: 0,
      ambiguities: 0,
      sourceConflicts: 0,
      claimedCompleteInventories: 0,
      partialOrUnknownInventories: 0,
      inventoryScopes: [],
      topology: {
        matrixClassCount: 13,
        matrixSpecCount: 40,
        snapshotClassCount: 13,
        snapshotSpecCount: 40,
        addedClasses: [],
        removedClasses: [],
        addedSpecs: [],
        removedSpecs: [],
        nonRetailRejected: [],
      },
    },
    diff: [],
    diffTotals: {
      UNCHANGED: 0,
      MISSING_FROM_CURRENT_CATALOG: 1,
      MISSING_FROM_EXTERNAL_SOURCES: 0,
      NOT_OBSERVED_IN_CURRENT_QUERIES: 1,
      REMOVAL_REVIEW_CANDIDATE: 0,
      METADATA_CHANGED: 0,
      APPLICABILITY_CHANGED: 0,
      SPELL_BINDING_CHANGED: 1,
      AMBIGUOUS: 0,
      SOURCE_CONFLICT: 0,
    },
    quality: { incompleteScopes: 0, failedSources: [], unknownClassifications: 0 },
    review: {
      strongNewCandidates: [
        {
          status: "MISSING_FROM_CURRENT_CATALOG",
          candidateKey: "priest.refresh.vampiric-embrace-15286",
          name: "Vampiric Embrace",
          primarySpellId: 15286,
          classSlug: "priest",
          specSlugs: ["shadow"],
          raceSlugs: [],
          cooldownSeconds: 120,
          ownershipKind: "PLAYABLE_PLAYER",
          validFromBuild: "69299",
          candidateBindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          sourceObservations: [
            {
              source: "SIMULATIONCRAFT",
              state: "PRESENT",
              identity: {
                source: "SIMULATIONCRAFT",
                datasetKind: "PINNED",
                sourceVersion: "spellquery-export-0.1.0",
                sourceRevision: "a060a356e16fdf266cb8b93fa4a9c892f3e26af3",
                retrievedAt: now,
                validFromBuild: "69299",
                captureProvenance: "REAL_CAPTURE",
              },
            },
          ],
          notes: ["STRONG"],
        },
      ],
      weakDiscoveries: [
        {
          status: "MISSING_FROM_CURRENT_CATALOG",
          candidateKey: "death-knight.refresh.death-coil",
          name: "Death Coil",
          primarySpellId: 47541,
          classSlug: "death-knight",
          specSlugs: [],
          raceSlugs: [],
          sourceObservations: [],
          notes: ["WEAK"],
        },
      ],
      excludedStructurally: [],
      currentRulesNotObserved: [
        {
          status: "NOT_OBSERVED_IN_CURRENT_QUERIES",
          currentCanonicalKey: "mage.offensive.icy-veins",
          name: "Icy Veins",
          primarySpellId: 12472,
          classSlug: "mage",
          specSlugs: ["frost"],
          raceSlugs: [],
          sourceObservations: [],
          notes: ["not observed"],
        },
      ],
      removalReview: [],
      bindingReview: [
        {
          status: "SPELL_BINDING_CHANGED",
          currentCanonicalKey: "death-knight.battle-rez.raise-ally",
          name: "Raise Ally",
          primarySpellId: 61999,
          classSlug: "death-knight",
          specSlugs: [],
          raceSlugs: [],
          sourceObservations: [],
          bindingChanges: [
            {
              spellId: 61999,
              currentRoles: ["PRIMARY_ACTIVATION"],
              candidateRoles: ["PRIMARY_ACTIVATION", "SUMMON"],
            },
          ],
          notes: [],
        },
      ],
    },
    ...overrides,
  };
}

describe.skipIf(!dbAvailable)("ability catalog review curation", () => {
  let app: FastifyInstance | undefined;
  let container: ApiContainer;
  const catalogCountBefore = getAllRegisteredRules().length;
  const catalogVersionBefore = CURRENT_CATALOG_VERSION_ID;

  beforeAll(async () => {
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
    await ensureIamSeed(prisma);
    container = createApiContainer(env, {
      workerOverrides: { prisma },
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("imports PINNED report idempotently and excludes weak/not-observed/Icy Veins/Stormkeeper", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const report = minimalPinnedReport();
    const bytes = Buffer.from(JSON.stringify(report));
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    const first = await service.importPinnedReport(
      {
        report,
        reportBytes: bytes,
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
        simcBytes: Buffer.from(`{"simc":"${uniqueName("simc")}"}`),
        designateBaseline: true,
      },
      audit,
    );
    expect(first.created).toBe(true);
    expect(first.batch.summaryCounts.newAbilityCandidates).toBe(1);
    expect(first.batch.summaryCounts.spellBindingReviews).toBe(1);
    expect(first.batch.summaryCounts.topologyReviews).toBe(1);
    expect(first.batch.summaryCounts.removalReviews).toBe(0);
    expect(first.batch.summaryCounts.weakExcluded).toBe(1);
    expect(first.batch.summaryCounts.notObservedExcluded).toBe(1);
    expect(first.baselineId).toBeTruthy();

    const items = await service.listItems(first.batch.id, { pageSize: 100 });
    expect(items.items.some((i) => i.primarySpellId === 15286)).toBe(true);
    expect(items.items.some((i) => i.name === "haranir")).toBe(true);
    expect(items.items.some((i) => i.primarySpellId === 12472)).toBe(false);
    expect(items.items.some((i) => i.primarySpellId === 47541)).toBe(false);
    expect(items.items.some((i) => i.primarySpellId === 191634)).toBe(false);

    const second = await service.importPinnedReport(
      {
        report,
        reportBytes: bytes,
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
      },
      audit,
    );
    expect(second.created).toBe(false);
    expect(second.rebuilt).toBe(false);
    expect(second.batch.id).toBe(first.batch.id);
    expect(second.batch.reviewPlanDigest).toBe(first.batch.reviewPlanDigest);

    await expect(
      service.importPinnedReport(
        {
          report: { ...report, datasetKind: "FIXTURE" },
          reportBytes: Buffer.from("fixture"),
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REPORT" });
  });

  it("rebuilds undecided batch when review plan changes for same source identity", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    // Isolate source identity so this case does not rebuild peers from earlier tests.
    const stamp = uniqueName("rebuild");
    const report = minimalPinnedReport({
      generatedAt: "2026-08-16T19:00:00.000Z",
      snapshots: [
        {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "spellquery-export-0.1.0",
          sourceRevision: `simc-${stamp}`,
          retrievedAt: "2026-08-16T19:00:00.000Z",
          validFromBuild: `69299-${stamp}`,
          captureProvenance: "REAL_CAPTURE",
        },
        {
          source: "BLIZZARD",
          datasetKind: "PINNED",
          sourceVersion: "wow-game-data",
          sourceRevision: `69299-${stamp}`,
          retrievedAt: "2026-08-16T19:00:00.000Z",
          blizzardNamespace: "static-eu",
          captureProvenance: "REAL_CAPTURE",
        },
      ],
    });
    const bytes = Buffer.from(JSON.stringify(report));
    const first = await service.importPinnedReport(
      {
        report,
        reportBytes: bytes,
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
      },
      audit,
    );
    expect(first.created).toBe(true);
    const beforeCount = (await service.listItems(first.batch.id, { pageSize: 200 })).items.length;

    const mutatedReport: CatalogRefreshReport = {
      ...report,
      generatedAt: "2026-08-16T19:00:01.000Z",
      review: {
        ...report.review!,
        strongNewCandidates: [
          ...report.review!.strongNewCandidates,
          {
            status: "MISSING_FROM_CURRENT_CATALOG",
            candidateKey: "shared.racial.arcane-torrent",
            name: "Arcane Torrent",
            primarySpellId: 28730,
            classSlug: null,
            specSlugs: [],
            raceSlugs: ["blood-elf"],
            sourceObservations: [],
            notes: [
              "STRONG catalog-review candidate not represented in the current AbilityRule catalog. External discovery is not a scoring-category decision. No automatic insert.",
              "racial-variant-validity:AMBIGUOUS_VALIDITY",
              "ambiguous-ids:28730,25046",
            ],
          },
        ],
      },
    };
    const mutatedBytes = Buffer.from(JSON.stringify(mutatedReport));
    const second = await service.importPinnedReport(
      {
        report: mutatedReport,
        reportBytes: mutatedBytes,
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
      },
      audit,
    );
    expect(second.created).toBe(false);
    expect(second.rebuilt).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
    expect(second.batch.reviewPlanDigest).not.toBe(first.batch.reviewPlanDigest);
    const afterItems = await service.listItems(second.batch.id, { pageSize: 200 });
    expect(afterItems.items.length).toBeGreaterThan(beforeCount);
    expect(afterItems.items.some((i) => i.name === "Arcane Torrent")).toBe(true);

    const listed = await service.listBatches();
    const openSameSource = listed.batches.filter(
      (b) => b.status === "OPEN" && b.wowBuild === first.batch.wowBuild,
    );
    expect(openSameSource.filter((b) => b.decisionCounts.pending === b.decisionCounts.total).length).toBeGreaterThanOrEqual(1);
  });

  it("preserves decided batch and creates a distinct current batch when plan changes", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    const stamp = uniqueName("decided");
    const report = minimalPinnedReport({
      generatedAt: "2026-08-16T20:00:00.000Z",
      snapshots: [
        {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "spellquery-export-0.1.0",
          sourceRevision: `simc-${stamp}`,
          retrievedAt: "2026-08-16T20:00:00.000Z",
          validFromBuild: `69299-${stamp}`,
          captureProvenance: "REAL_CAPTURE",
        },
        {
          source: "BLIZZARD",
          datasetKind: "PINNED",
          sourceVersion: "wow-game-data",
          sourceRevision: `69299-${stamp}`,
          retrievedAt: "2026-08-16T20:00:00.000Z",
          blizzardNamespace: "static-eu",
          captureProvenance: "REAL_CAPTURE",
        },
      ],
    });
    const bytes = Buffer.from(JSON.stringify(report));
    const first = await service.importPinnedReport(
      {
        report,
        reportBytes: bytes,
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
      },
      audit,
    );
    expect(first.created).toBe(true);
    const items = await service.listItems(first.batch.id, { pageSize: 50 });
    const ve = items.items.find((i) => i.primarySpellId === 15286)!;
    await service.decideItem(ve.id, {
      expectedVersion: ve.version,
      action: "DEFER",
      note: "keep history",
    }, audit);

    const mutatedReport: CatalogRefreshReport = {
      ...report,
      generatedAt: "2026-08-16T20:00:01.000Z",
      quality: { incompleteScopes: 0, failedSources: [uniqueName("next")], unknownClassifications: 0 },
      review: {
        ...report.review!,
        strongNewCandidates: [
          ...report.review!.strongNewCandidates,
          {
            status: "MISSING_FROM_CURRENT_CATALOG",
            candidateKey: "shared.refresh.extra-999",
            name: "Extra Ability",
            primarySpellId: 999001,
            classSlug: "mage",
            specSlugs: ["frost"],
            raceSlugs: [],
            sourceObservations: [],
            notes: [
              "STRONG catalog-review candidate not represented in the current AbilityRule catalog. External discovery is not a scoring-category decision. No automatic insert.",
            ],
          },
        ],
      },
    };
    const second = await service.importPinnedReport(
      {
        report: mutatedReport,
        reportBytes: Buffer.from(JSON.stringify(mutatedReport)),
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
      },
      audit,
    );
    expect(second.created).toBe(true);
    expect(second.batch.id).not.toBe(first.batch.id);
    const preserved = await service.getBatch(first.batch.id);
    expect(preserved.status).toBe("OPEN");
    expect(preserved.decisionCounts.deferred).toBeGreaterThanOrEqual(1);
  });

  it("does not unsafe-dedupe listBatches by SimC/build when decided and undecided both OPEN", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const listed = await service.listBatches();
    // After prior tests we may have multiple OPEN batches; ensure API returns all of them
    // rather than collapsing by simc|build.
    const ids = new Set(listed.batches.map((b) => b.id));
    expect(ids.size).toBe(listed.batches.length);
  });

  it("accepts Vampiric Embrace only with ready curated draft and rejects incomplete ACCEPT", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const report = minimalPinnedReport({
      generatedAt: new Date().toISOString(),
    });
    const stamped = {
      ...report,
      quality: { ...report.quality, failedSources: [uniqueName("fs")] },
    };
    const bytes = Buffer.from(JSON.stringify(stamped));
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    const { batch } = await service.importPinnedReport(
      {
        report: stamped,
        reportBytes: bytes,
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
      },
      audit,
    );
    const { items } = await service.listItems(batch.id, { kind: "NEW_ABILITY_CANDIDATE" });
    const ve = items.find((i) => i.primarySpellId === 15286)!;

    await expect(
      service.decideItem(
        ve.id,
        {
          expectedVersion: ve.version,
          action: "ACCEPT",
          draft: {
            canonicalKey: `priest.defensive-minor.vampiric-embrace-${randomUUID().slice(0, 8)}`,
            name: "Vampiric Embrace",
            spellIds: [15286],
            bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
            classSlug: "priest",
            specSlugs: ["shadow"],
            availability: "TALENT",
          },
        },
        audit,
      ),
    ).rejects.toMatchObject({
      code: "DRAFT_NOT_READY",
      message: expect.stringMatching(/Category is required/),
    });

    const key = `priest.defensive-minor.vampiric-embrace-${randomUUID().slice(0, 8)}`;
    const accepted = await service.decideItem(
      ve.id,
      {
        expectedVersion: ve.version,
        action: "ACCEPT",
        draft: {
          canonicalKey: key,
          category: "DEFENSIVE_MINOR",
          name: "Vampiric Embrace",
          spellIds: [15286],
          bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          classSlug: "priest",
          specSlugs: ["shadow"],
          cooldownSeconds: 120,
          availability: "TALENT",
          sourceOwnership: "PLAYER",
          provenance: {
            source: "CURATED_OVERRIDE",
            verifiedAt: "2026-08-16T20:00:00.000Z",
            gameVersion: "12.0.0",
          },
        },
      },
      audit,
    );
    expect(accepted.decisionAction).toBe("ACCEPT");
    expect(accepted.draftStatus).toBe("READY_FOR_PUBLISH_REVIEW");
    expect(accepted.draftRule).toBeTruthy();
    expect(getAllRegisteredRules()).toHaveLength(catalogCountBefore);
    expect(CURRENT_CATALOG_VERSION_ID).toBe(catalogVersionBefore);

    const rejected = await service.decideItem(
      ve.id,
      { expectedVersion: accepted.version, action: "REJECT", note: "oops" },
      audit,
    );
    expect(rejected.decisionAction).toBe("REJECT");
    expect(rejected.decisionEvents.length).toBeGreaterThanOrEqual(2);
    expect(
      rejected.decisionEvents.some(
        (e) => (e.newState as { decisionAction?: string }).decisionAction === "ACCEPT",
      ),
    ).toBe(true);
    expect(
      rejected.decisionEvents.some(
        (e) => (e.newState as { decisionAction?: string }).decisionAction === "REJECT",
      ),
    ).toBe(true);

    const reaccepted = await service.decideItem(
      ve.id,
      {
        expectedVersion: rejected.version,
        action: "ACCEPT",
        draft: {
          canonicalKey: key,
          category: "DEFENSIVE_MINOR",
          name: "Vampiric Embrace",
          spellIds: [15286],
          bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          classSlug: "priest",
          specSlugs: ["shadow"],
          cooldownSeconds: 120,
          availability: "TALENT",
          sourceOwnership: "PLAYER",
          provenance: {
            source: "CURATED_OVERRIDE",
            verifiedAt: "2026-08-16T20:00:00.000Z",
            gameVersion: "12.0.0",
          },
        },
      },
      audit,
    );
    expect(reaccepted.decisionAction).toBe("ACCEPT");
    expect(reaccepted.draftRule).toBeTruthy();

    await expect(
      service.decideItem(ve.id, { expectedVersion: ve.version, action: "ACCEPT" }, audit),
    ).rejects.toMatchObject({ code: "REVIEW_ITEM_VERSION_CONFLICT" });

    const haranir = (await service.listItems(batch.id, { kind: "TOPOLOGY_REVIEW" })).items[0]!;
    const topo = await service.decideItem(
      haranir.id,
      { expectedVersion: haranir.version, action: "ACCEPT" },
      audit,
    );
    expect(topo.decisionAction).toBe("ACCEPT");
    expect((topo.draftTopology as { status?: string } | null)?.status).toBe("ACCEPTED");

    const binding = (await service.listItems(batch.id, { kind: "SPELL_BINDING_REVIEW" })).items[0]!;
    const kept = await service.decideItem(
      binding.id,
      { expectedVersion: binding.version, action: "KEEP_CURRENT" },
      audit,
    );
    expect(kept.decisionAction).toBe("KEEP_CURRENT");
  });

  it("ensureDraft then updateDraft can promote READY; incomplete edit reopens ACCEPT", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const stamp = uniqueName("ensure");
    const stamped = minimalPinnedReport({
      generatedAt: "2026-08-16T21:00:00.000Z",
      snapshots: [
        {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "spellquery-export-0.1.0",
          sourceRevision: `simc-${stamp}`,
          retrievedAt: "2026-08-16T21:00:00.000Z",
          validFromBuild: `69299-${stamp}`,
          captureProvenance: "REAL_CAPTURE",
        },
        {
          source: "BLIZZARD",
          datasetKind: "PINNED",
          sourceVersion: "wow-game-data",
          sourceRevision: `69299-${stamp}`,
          retrievedAt: "2026-08-16T21:00:00.000Z",
          blizzardNamespace: "static-eu",
          captureProvenance: "REAL_CAPTURE",
        },
      ],
    });
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    const { batch } = await service.importPinnedReport(
      {
        report: stamped,
        reportBytes: Buffer.from(JSON.stringify(stamped)),
        topologyClassification: { races: [{ key: "haranir", kind: "EXTERNAL_ONLY" }] },
        simcBytes: Buffer.from(`{"simc":"${uniqueName("simc2")}"}`),
        designateBaseline: true,
      },
      audit,
    );
    const ve = (await service.listItems(batch.id, { kind: "NEW_ABILITY_CANDIDATE" })).items.find(
      (i) => i.primarySpellId === 15286,
    )!;
    const key = `priest.defensive-minor.ve-${randomUUID().slice(0, 8)}`;
    const ensured = await service.ensureDraft(ve.id, {}, audit);
    expect(ensured.decisionAction).toBeNull();
    expect(ensured.draftRule).toBeTruthy();
    expect(ensured.draftStatus).toBe("NEEDS_METADATA");
    const ensuredDraft = ensured.draftRule as {
      canonicalKey?: string;
      cooldownSeconds?: number | null;
      sourceOwnership?: string | null;
      provenance?: { source?: string };
    };
    expect(ensuredDraft.canonicalKey).toBe("priest.shadow.vampiric-embrace");
    expect(ensuredDraft.cooldownSeconds).toBe(120);
    expect(ensuredDraft.sourceOwnership).toBe("PLAYER");
    expect(ensuredDraft.provenance?.source).toBe("SIMC_ADVISORY");

    const draft = ensured.draftRule as { version: number };
    const ready = await service.updateDraft(
      ve.id,
      {
        expectedVersion: draft.version,
        draft: {
          canonicalKey: key,
          name: "Vampiric Embrace",
          spellIds: [15286],
          bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          classSlug: "priest",
          specSlugs: ["shadow"],
          category: "DEFENSIVE_MINOR",
          dimensionTags: ["SURVIVAL_RECOVERY"],
          availability: "TALENT",
          sourceOwnership: "PLAYER",
          cooldownSeconds: 120,
          validFromBuild: "69299",
          provenance: {
            source: "CURATED_OVERRIDE",
            verifiedAt: "2026-08-16T20:00:00.000Z",
            gameVersion: "12.0.0",
          },
        },
      },
      audit,
    );
    expect(ready.draftStatus).toBe("READY_FOR_PUBLISH_REVIEW");

    const accepted = await service.decideItem(
      ve.id,
      {
        expectedVersion: ready.version,
        action: "ACCEPT",
        draft: {
          canonicalKey: key,
          name: "Vampiric Embrace",
          spellIds: [15286],
          bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          classSlug: "priest",
          specSlugs: ["shadow"],
          category: "DEFENSIVE_MINOR",
          dimensionTags: ["SURVIVAL_RECOVERY"],
          availability: "TALENT",
          sourceOwnership: "PLAYER",
          cooldownSeconds: 120,
          provenance: {
            source: "CURATED_OVERRIDE",
            verifiedAt: "2026-08-16T20:00:00.000Z",
            gameVersion: "12.0.0",
          },
        },
      },
      audit,
    );
    expect(accepted.decisionAction).toBe("ACCEPT");

    const readyDraft = accepted.draftRule as { version: number };
    const reopened = await service.updateDraft(
      ve.id,
      {
        expectedVersion: readyDraft.version,
        draft: {
          canonicalKey: key,
          name: "Vampiric Embrace",
          spellIds: [15286],
          bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          classSlug: "priest",
          specSlugs: ["shadow"],
          category: null,
          availability: "TALENT",
          provenance: {
            source: "CURATED_OVERRIDE",
            verifiedAt: "2026-08-16T20:00:00.000Z",
            gameVersion: "12.0.0",
          },
        },
      },
      audit,
    );
    expect(reopened.decisionAction).toBeNull();
    expect(reopened.draftStatus).toBe("NEEDS_METADATA");
    expect(
      reopened.decisionEvents.some(
        (e) => (e.newState as { action?: string }).action === "DRAFT_UPDATE_REOPEN",
      ),
    ).toBe(true);

    await expect(
      service.updateDraft(
        ve.id,
        {
          expectedVersion: draft.version,
          draft: {
            name: "stale",
            spellIds: [15286],
            bindings: [{ spellId: 15286, role: "PRIMARY_ACTIVATION" }],
          },
        },
        audit,
      ),
    ).rejects.toMatchObject({ code: "DRAFT_VERSION_CONFLICT" });

    const batchDto = await service.getBatch(batch.id);
    expect(batchDto.decisionCounts.total).toBeGreaterThan(0);

    const baselineId = (await service.getActiveBaseline("SIMULATIONCRAFT"))?.id;
    expect(baselineId).toBeTruthy();
    const exported = await service.exportBaselinePayload(baselineId!);
    expect(exported.contentHash).toHaveLength(64);
    expect(exported.bytes.byteLength).toBeGreaterThan(0);

    await expect(service.exportBaselinePayload(randomUUID())).rejects.toMatchObject({
      code: "BASELINE_NOT_FOUND",
    });
  });

  it("SPELL_BINDING_REVIEW KEEP_CURRENT preserves catalog rule without client draft", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const stamp = uniqueName("keep-current");
    const metamorphosisRule = getAllRegisteredRules().find(
      (rule) => rule.canonicalKey === "demon-hunter.offensive.metamorphosis-havoc",
    );
    expect(metamorphosisRule).toBeTruthy();

    const base = minimalPinnedReport();
    const report: CatalogRefreshReport = {
      ...base,
      generatedAt: "2026-08-16T22:00:00.000Z",
      coverage: {
        ...base.coverage,
        missingFromCurrentCatalog: 0,
      },
      diffTotals: {
        ...base.diffTotals,
        MISSING_FROM_CURRENT_CATALOG: 0,
        NOT_OBSERVED_IN_CURRENT_QUERIES: 0,
        SPELL_BINDING_CHANGED: 1,
      },
      review: {
        strongNewCandidates: [],
        weakDiscoveries: [],
        excludedStructurally: [],
        currentRulesNotObserved: [],
        removalReview: [],
        bindingReview: [
          {
            status: "SPELL_BINDING_CHANGED",
            currentCanonicalKey: metamorphosisRule!.canonicalKey,
            name: metamorphosisRule!.name,
            primarySpellId: 191427,
            classSlug: "demon-hunter",
            specSlugs: ["havoc"],
            raceSlugs: [],
            bindingChanges: [
              {
                spellId: 191427,
                currentRoles: ["PRIMARY_ACTIVATION"],
                candidateRoles: ["PRIMARY_ACTIVATION", "CAST_ALIAS"],
              },
            ],
            sourceObservations: [],
            notes: [],
          },
        ],
      },
      snapshots: [
        {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "spellquery-export-0.1.0",
          sourceRevision: `simc-${stamp}`,
          retrievedAt: "2026-08-16T22:00:00.000Z",
          validFromBuild: `69299-${stamp}`,
          captureProvenance: "REAL_CAPTURE",
        },
        {
          source: "BLIZZARD",
          datasetKind: "PINNED",
          sourceVersion: "wow-game-data",
          sourceRevision: `69299-${stamp}`,
          retrievedAt: "2026-08-16T22:00:00.000Z",
          blizzardNamespace: "static-eu",
          captureProvenance: "REAL_CAPTURE",
        },
      ],
    };
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    const { batch } = await service.importPinnedReport(
      {
        report,
        reportBytes: Buffer.from(JSON.stringify(report)),
        simcBytes: Buffer.from(`{"simc":"${stamp}"}`),
      },
      audit,
    );
    const binding = (
      await service.listItems(batch.id, { kind: "SPELL_BINDING_REVIEW" })
    ).items[0]!;
    expect(binding.matchedCanonicalKey).toBe(metamorphosisRule!.canonicalKey);

    const kept = await service.decideItem(
      binding.id,
      {
        expectedVersion: binding.version,
        action: "KEEP_CURRENT",
        draft: {
          category: null,
          availability: null,
          dimensionTags: [],
          name: "Wrong external name",
        },
      },
      audit,
    );
    expect(kept.decisionAction).toBe("KEEP_CURRENT");
    const draft = kept.draftRule as {
      canonicalKey?: string;
      category?: string;
      availability?: string;
      name?: string;
      dimensionTags?: string[];
      cooldownSeconds?: number | null;
      sourceOwnership?: string;
    };
    expect(draft.canonicalKey).toBe(metamorphosisRule!.canonicalKey);
    expect(draft.name).toBe(metamorphosisRule!.name);
    expect(draft.category).toBe(metamorphosisRule!.category);
    expect(draft.availability).toBe(metamorphosisRule!.availability);
    expect(draft.cooldownSeconds).toBe(metamorphosisRule!.cooldownSeconds);
    expect(draft.sourceOwnership).toBe(metamorphosisRule!.sourceOwnership);
    expect(draft.dimensionTags).toEqual(dimensionTagsForRule(metamorphosisRule!));
    const expectedBindings = projectCurrentRuleBindings(metamorphosisRule!).map((b) => ({
      spellId: b.spellId,
      role: b.role,
    }));
    expect(
      (kept.draftRule as { bindings?: Array<{ spellId: number; role: string }> }).bindings,
    ).toEqual(expectedBindings);
    expect(expectedBindings.some((b) => b.spellId === 162264)).toBe(true);
  });

  it("KEEP_CURRENT fails clearly when catalog rule is missing", async () => {
    const service = new AbilityCatalogReviewService(prisma);
    const stamp = uniqueName("keep-current-missing");
    const base = minimalPinnedReport();
    const report: CatalogRefreshReport = {
      ...base,
      review: {
        ...base.review!,
        strongNewCandidates: [],
        bindingReview: [
          {
            status: "SPELL_BINDING_CHANGED",
            currentCanonicalKey: "fake.nonexistent.binding-rule",
            name: "Ghost Binding",
            primarySpellId: 999001,
            classSlug: "mage",
            specSlugs: ["frost"],
            raceSlugs: [],
            bindingChanges: [
              {
                spellId: 999001,
                currentRoles: ["PRIMARY_ACTIVATION"],
                candidateRoles: ["SUMMON"],
              },
            ],
            sourceObservations: [],
            notes: [],
          },
        ],
      },
      snapshots: [
        {
          source: "SIMULATIONCRAFT",
          datasetKind: "PINNED",
          sourceVersion: "spellquery-export-0.1.0",
          sourceRevision: `simc-${stamp}`,
          retrievedAt: "2026-08-16T22:30:00.000Z",
          validFromBuild: `69299-${stamp}`,
          captureProvenance: "REAL_CAPTURE",
        },
        {
          source: "BLIZZARD",
          datasetKind: "PINNED",
          sourceVersion: "wow-game-data",
          sourceRevision: `69299-${stamp}`,
          retrievedAt: "2026-08-16T22:30:00.000Z",
          blizzardNamespace: "static-eu",
          captureProvenance: "REAL_CAPTURE",
        },
      ],
    };
    const audit = {
      actorType: "admin_key" as const,
      sessionSecret: container.env.SESSION_SECRET,
      userId: null,
    };
    const { batch } = await service.importPinnedReport(
      {
        report,
        reportBytes: Buffer.from(JSON.stringify(report)),
        simcBytes: Buffer.from(`{"simc":"${stamp}"}`),
      },
      audit,
    );
    const binding = (
      await service.listItems(batch.id, { kind: "SPELL_BINDING_REVIEW" })
    ).items.find((item) => item.name === "Ghost Binding")!;
    expect(binding).toBeTruthy();

    await expect(
      service.decideItem(
        binding.id,
        { expectedVersion: binding.version, action: "KEEP_CURRENT" },
        audit,
      ),
    ).rejects.toMatchObject({ code: "KEEP_CURRENT_NO_CATALOG_RULE" });
  });

  it("requires admin authorization on decide route", async () => {
    const res = await app!.inject({
      method: "POST",
      url: `/api/v1/admin/ability-catalog/review/items/${randomUUID()}/decide`,
      payload: { expectedVersion: 1, action: "DEFER" },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(401);
  });
});
