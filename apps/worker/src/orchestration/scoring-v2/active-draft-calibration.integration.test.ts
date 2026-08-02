/**
 * WS10.5 — disposable-DB active/draft calibration proof.
 *
 * Persists ACTIVE + DRAFT ScoreModel configs with scoringV2, freezes a Calibration
 * Bundle V2, strictly re-parses, and runs provider-free active/draft replay.
 * Requires `pnpm test:integration` (isolated DB). No providers, activation, or publication.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, checkDatabaseHealth, type PrismaClient } from "@mplus/database";
import {
  buildCalibrationInputBundleV2,
  buildCalibrationReportV2Extension,
  createDefaultScoringV2DimensionConfigSet,
  createMapArtifactResolverV2,
  emptyUtilityV2FactSet,
  exportUtilityV2Calibration,
  parseUtilityV2ModelConfig,
  replayCalibrationBundleV2ActiveVersusDraft,
  UTILITY_V2_MODEL_CONFIG,
  UTILITY_V2_SCORE_FLOOR,
  withScoringV2DimensionConfigs,
  createDefaultModelV6,
  COHORT_MANIFEST_SCHEMA_VERSION,
} from "@mplus/scoring";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping active/draft calibration integration: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("WS10.5 active/draft calibration (disposable DB)", () => {
  it("persists ACTIVE/DRAFT scoringV2 configs and replays provider-free with real deltas", async () => {
    const publishedBefore = await prisma.characterPublishedScore.count();
    const computationBefore = await prisma.dimensionComputation.count();

    const activeKey = `ws105-active-${randomUUID().slice(0, 8)}`;
    const draftKey = `ws105-draft-${randomUUID().slice(0, 8)}`;

    const activeConfigs = createDefaultScoringV2DimensionConfigSet();
    const draftConfigs = createDefaultScoringV2DimensionConfigSet();
    draftConfigs.utility = parseUtilityV2ModelConfig({
      ...UTILITY_V2_MODEL_CONFIG,
      scoreFloor: 55,
    });

    const activeDoc = withScoringV2DimensionConfigs(createDefaultModelV6({ key: activeKey }), activeConfigs);
    const draftDoc = withScoringV2DimensionConfigs(
      createDefaultModelV6({ key: draftKey, version: 2 }),
      draftConfigs,
    );

    const activeModel = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: activeKey,
        version: 1,
        name: "ws105-active",
        status: "ACTIVE",
        config: activeDoc as object,
      },
    });
    const draftModel = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: draftKey,
        version: 2,
        name: "ws105-draft",
        status: "DRAFT",
        config: draftDoc as object,
      },
    });

    const utilExport = exportUtilityV2Calibration({
      manifest: {
        contentHash: "util-manifest",
        schemaVersion: "2.0.0",
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
        slots: [
          {
            slotId: "slot-a",
            dungeonSlug: "ara-kara",
            slotIndex: 0,
            state: "SELECTED",
            identity: { reportCode: "R1", fightId: 1, reportRevision: 1 },
          },
        ],
      },
      factSets: [
        emptyUtilityV2FactSet({
          slotId: "slot-a",
          runId: "R1:1",
          dungeonSlug: "ara-kara",
          reportCode: "R1",
          fightId: 1,
          reportRevision: 1,
        }),
      ],
    });
    const utilHash = createHash("sha256").update(JSON.stringify(utilExport)).digest("hex");
    const manifestHash = createHash("sha256").update("{}").digest("hex");
    const factHash = createHash("sha256").update("f").digest("hex");

    const activePersisted = await prisma.scoreModel.findUniqueOrThrow({
      where: { id: activeModel.id },
    });
    const draftPersisted = await prisma.scoreModel.findUniqueOrThrow({
      where: { id: draftModel.id },
    });

    const bundle = buildCalibrationInputBundleV2({
      generatedAt: "2026-08-01T12:00:00.000Z",
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      source: "persisted-export",
      mode: "active-versus-draft",
      deterministicSeed: 42,
      cohort: {
        schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
        cohortId: "ws105",
        description: "active-draft itest",
        createdAt: "2026-08-01T12:00:00.000Z",
        members: [
          {
            id: "m1",
            region: "eu",
            realm: "r",
            character: "x",
            role: "DPS",
            classSlug: "mage",
            specSlug: "frost",
            expectedLabel: "good",
            meta: false,
            rationale: "r",
            suspectedBoost: false,
            source: "user-selected",
          },
        ],
      },
      season: { seasonId: "s", seasonSlug: "season", region: "eu" },
      activeModel: {
        id: activePersisted.id,
        key: activePersisted.key,
        version: activePersisted.version,
        status: "ACTIVE",
        config: activePersisted.config as never,
        isActive: true,
      },
      evaluationModel: {
        id: draftPersisted.id,
        key: draftPersisted.key,
        version: draftPersisted.version,
        status: "DRAFT",
        config: draftPersisted.config as never,
        isActive: false,
      },
      policies: {
        difficultyPolicies: [],
        abilityCatalogVersions: ["a"],
        mechanicCatalogVersions: ["m"],
        confidenceAlgorithmVersions: {},
        dimensionAlgorithmVersions: {
          PERFORMANCE: "p",
          SURVIVAL: "s",
          UTILITY: "u",
          EXPERIENCE: "e",
        },
      },
      members: [
        {
          memberId: "m1",
          characterId: null,
          expectedLabel: "good",
          rationale: "r",
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          included: true,
          exclusionCode: null,
          evidenceCutoffAt: null,
          manifest: { contentHash: manifestHash, artifactClass: "evidence_manifest" },
          factSets: [{ contentHash: factHash, artifactClass: "run_fact_set" }],
          dimensionExports: {
            UTILITY: { contentHash: utilHash, artifactClass: "dimension_replay_export" },
          },
        },
      ],
      artifactPackage: null,
    });

    const report = await replayCalibrationBundleV2ActiveVersusDraft({
      bundle,
      resolver: createMapArtifactResolverV2(
        new Map([
          [manifestHash, Buffer.from("{}")],
          [factHash, Buffer.from("{}")],
          [utilHash, Buffer.from(JSON.stringify(utilExport))],
        ]),
      ),
    });

    expect(report.identicalEvidence).toBe(true);
    expect(report.providerCalls).toBe(0);
    expect(report.refreshCalls).toBe(0);
    expect(report.modelActivated).toBe(false);
    expect(report.publicationMutated).toBe(false);
    expect(report.activeModelKey).toBe(activeKey);
    expect(report.draftModelKey).toBe(draftKey);

    const util = report.members[0]!.dimensions.find((d) => d.dimension === "UTILITY")!;
    expect(util.activeScore).toBe(UTILITY_V2_SCORE_FLOOR);
    expect(util.draftScore).toBe(55);
    expect(util.scoreDelta).toBe(5);
    expect(util.identicalEvidence).toBe(true);

    const extension = buildCalibrationReportV2Extension({
      draftReplay: {
        schemaVersion: "calibration-replay-v2",
        bundleHash: report.bundleHash,
        deterministicSeed: report.deterministicSeed,
        mode: "active-versus-draft",
        activeModelKey: report.activeModelKey,
        evaluationModelKey: report.draftModelKey,
        members: [
          {
            memberId: "m1",
            expectedLabel: "good",
            dimensions: [
              {
                dimension: "UTILITY",
                score: util.draftScore,
                confidence: util.draftConfidence ?? 0,
                availabilityState: util.draftAvailability ?? "AVAILABLE",
                inputFingerprint: "x",
                algorithmVersion: "utility-v2",
                modelConfigFingerprint: util.draftConfigFingerprint,
                evidenceFingerprint: util.evidenceFingerprintDraft,
              },
            ],
            errors: [],
          },
        ],
        preflightIssues: [],
        contentHash: report.contentHash,
        providerCalls: 0,
        refreshCalls: 0,
        modelActivated: false,
        publicationMutated: false,
      },
      activeVersusDraftReport: report,
    });
    expect(extension.activeVersusDraft?.identicalEvidence).toBe(true);
    expect(extension.activeVersusDraft?.modelActivated).toBe(false);
    expect(extension.activeVersusDraft?.publicationMutated).toBe(false);
    expect(extension.providerCalls).toBe(0);

    // Models remain in their original statuses — no activation.
    const activeAfter = await prisma.scoreModel.findUniqueOrThrow({
      where: { id: activeModel.id },
    });
    const draftAfter = await prisma.scoreModel.findUniqueOrThrow({
      where: { id: draftModel.id },
    });
    expect(activeAfter.status).toBe("ACTIVE");
    expect(draftAfter.status).toBe("DRAFT");

    expect(await prisma.characterPublishedScore.count()).toBe(publishedBefore);
    expect(await prisma.dimensionComputation.count()).toBe(computationBefore);

    await prisma.scoreModel.deleteMany({
      where: { id: { in: [activeModel.id, draftModel.id] } },
    });
  });
});
