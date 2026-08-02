import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCalibrationInputBundle,
  buildCalibrationInputBundleV2,
  buildSyntheticFixtureBundle,
  createMapArtifactResolverV2,
  dispatchValidateCalibrationBundle,
  preflightCalibrationBundleV2,
  replayCalibrationBundleV2,
  replayCalibrationBundleV2ActiveVersusDraft,
  validateCalibrationInputBundleV2,
  type CalibrationInputBundleV2,
} from "./index.js";
import { COHORT_MANIFEST_SCHEMA_VERSION } from "./types.js";
import {
  emptyUtilityV2FactSet,
  exportUtilityV2Calibration,
  UTILITY_V2_ALGORITHM_VERSION,
  UTILITY_V2_SCORE_FLOOR,
} from "../utility/v2/index.js";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fixtureV2Bundle(overrides: Partial<CalibrationInputBundleV2> = {}): CalibrationInputBundleV2 {
  const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
  const utilInput = {
    manifest: {
      contentHash: "util-manifest",
      schemaVersion: "2.0.0",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      expectedSlotCount: 1,
      selectedSlotCount: 1,
      activeDungeonSlugs: ["ara-kara"],
      slots: [
        {
          slotId: "slot-a",
          dungeonSlug: "ara-kara",
          slotIndex: 0 as const,
          state: "SELECTED",
          identity,
        },
      ],
    },
    factSets: [
      emptyUtilityV2FactSet({
        slotId: "slot-a",
        runId: "R1:1",
        dungeonSlug: "ara-kara",
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision: identity.reportRevision,
      }),
    ],
  };
  const utilExport = exportUtilityV2Calibration(utilInput);
  const utilExportHash = sha256Json(utilExport);
  const manifestHash = sha256Json({ schemaVersion: "2.0.0", contentHash: "manifest-doc" });
  const factHash = sha256Json({ kind: "fixture-fact" });

  const model = {
    key: "v6",
    version: 1,
    status: "DRAFT" as const,
    config: { schemaVersion: "1" } as never,
    isActive: false,
  };

  return buildCalibrationInputBundleV2({
    generatedAt: "2026-08-01T12:00:00.000Z",
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    source: "fixture",
    mode: "active-versus-draft",
    deterministicSeed: 42,
    cohort: {
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: "cohort-1",
      description: "fixture cohort",
      createdAt: "2026-08-01T12:00:00.000Z",
      members: [
        {
          id: "m1",
          region: "eu",
          realm: "realm",
          character: "Testchar",
          role: "DPS",
          classSlug: "warlock",
          specSlug: "affliction",
          expectedLabel: "good",
          meta: false,
          rationale: "expert",
          suspectedBoost: false,
          source: "user-selected",
        },
      ],
    },
    season: { seasonId: "season-1", seasonSlug: "season-tww-1", region: "eu" },
    activeModel: { ...model, status: "ACTIVE", isActive: true, id: "active-1" },
    evaluationModel: { ...model, id: "draft-1" },
    policies: {
      difficultyPolicies: [{ id: "sdp", version: "1" }],
      abilityCatalogVersions: ["abilities-v1"],
      mechanicCatalogVersions: ["mechanics-v1"],
      confidenceAlgorithmVersions: { overall: "conf-v1" },
      dimensionAlgorithmVersions: {
        PERFORMANCE: "performance-v2.phase1.0.1.0",
        SURVIVAL: "survival-v2-phase1.0.0",
        UTILITY: UTILITY_V2_ALGORITHM_VERSION,
        EXPERIENCE: "experience-v3.phase1.0.1.0",
      },
    },
    members: [
      {
        memberId: "m1",
        characterId: "char-1",
        expectedLabel: "good",
        rationale: "expert",
        role: "DPS",
        classSlug: "warlock",
        specSlug: "affliction",
        included: true,
        exclusionCode: null,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
        manifest: {
          contentHash: manifestHash,
          artifactClass: "evidence_manifest",
          schemaVersion: "2.0.0",
        },
        factSets: [
          {
            contentHash: factHash,
            artifactClass: "run_fact_set",
            schemaVersion: "utility-v2-facts",
          },
        ],
        dimensionExports: {
          UTILITY: {
            contentHash: utilExportHash,
            artifactClass: "dimension_replay_export",
            schemaVersion: "utility-v2-facts",
          },
        },
      },
    ],
    artifactPackage: null,
    ...overrides,
  });
}

describe("Calibration Bundle V2", () => {
  it("validates and is deterministic on rebuild", () => {
    const a = fixtureV2Bundle();
    const b = fixtureV2Bundle();
    expect(a.bundleHash).toBe(b.bundleHash);
    expect(a.schemaVersion).toBe("2.0.0");
    const validated = validateCalibrationInputBundleV2(a);
    expect(validated.ok).toBe(true);
    expect(validated.bundle?.bundleHash).toBe(a.bundleHash);
  });

  it("fails closed on bundleHash mismatch", () => {
    const bundle = fixtureV2Bundle();
    const tampered = { ...bundle, bundleHash: "0".repeat(64) };
    const validated = validateCalibrationInputBundleV2(tampered);
    expect(validated.ok).toBe(false);
    expect(validated.errors.some((e) => e.code === "HASH_MISMATCH")).toBe(true);
  });

  it("fails closed on label derived from score", () => {
    const bundle = fixtureV2Bundle();
    const raw = {
      ...bundle,
      bundleHash: undefined,
      members: [
        {
          ...bundle.members[0],
          expectedScore: 90,
          labelFromScore: true,
        },
      ],
    };
    const validated = validateCalibrationInputBundleV2(raw);
    expect(validated.ok).toBe(false);
    expect(validated.errors.some((e) => e.code === "LABEL_FROM_SCORE")).toBe(true);
  });

  it("dispatch keeps V1 and V2 separate (no silent conversion)", () => {
    const v1 = buildSyntheticFixtureBundle();
    const v1Dispatch = dispatchValidateCalibrationBundle(v1);
    expect(v1Dispatch.schemaMajor).toBe(1);
    expect(v1Dispatch.ok).toBe(true);

    const v2 = fixtureV2Bundle();
    const v2Dispatch = dispatchValidateCalibrationBundle(v2);
    expect(v2Dispatch.schemaMajor).toBe(2);
    expect(v2Dispatch.ok).toBe(true);

    const unknown = dispatchValidateCalibrationBundle({ schemaVersion: "9.0.0" });
    expect(unknown.ok).toBe(false);
    expect(unknown.schemaMajor).toBe("unknown");

    // V1 validator still works independently.
    expect(buildCalibrationInputBundle({
      manifest: v1.manifest,
      evidenceByMemberId: v1.evidenceByMemberId,
      generatedAt: v1.generatedAt,
      source: "fixture",
    }).schemaVersion).toBe("1.0.0");
  });

  it("preflight blocks missing artifacts and allows resolvable fixtures", async () => {
    const bundle = fixtureV2Bundle();
    const emptyResolver = createMapArtifactResolverV2(new Map());
    const blocked = await preflightCalibrationBundleV2({
      bundle,
      resolver: emptyResolver,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocking.some((b) => b.code === "MISSING_ARTIFACT")).toBe(true);

    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const utilExport = exportUtilityV2Calibration({
      manifest: {
        contentHash: "util-manifest",
        schemaVersion: "2.0.0",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
        slots: [
          {
            slotId: "slot-a",
            dungeonSlug: "ara-kara",
            slotIndex: 0,
            state: "SELECTED",
            identity,
          },
        ],
      },
      factSets: [
        emptyUtilityV2FactSet({
          slotId: "slot-a",
          runId: "R1:1",
          dungeonSlug: "ara-kara",
          reportCode: identity.reportCode,
          fightId: identity.fightId,
          reportRevision: identity.reportRevision,
        }),
      ],
    });
    const artifacts = new Map<string, Uint8Array>([
      [bundle.members[0]!.manifest.contentHash, Buffer.from("{}")],
      [bundle.members[0]!.factSets[0]!.contentHash, Buffer.from("{}")],
      [bundle.members[0]!.dimensionExports!.UTILITY!.contentHash, Buffer.from(JSON.stringify(utilExport))],
    ]);
    const ok = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
    });
    expect(ok.ok).toBe(true);
  });

  it("replays provider-free with identical active/draft evidence", async () => {
    const bundle = fixtureV2Bundle();
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const utilExport = exportUtilityV2Calibration({
      manifest: {
        contentHash: "util-manifest",
        schemaVersion: "2.0.0",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
        slots: [
          {
            slotId: "slot-a",
            dungeonSlug: "ara-kara",
            slotIndex: 0,
            state: "SELECTED",
            identity,
          },
        ],
      },
      factSets: [
        emptyUtilityV2FactSet({
          slotId: "slot-a",
          runId: "R1:1",
          dungeonSlug: "ara-kara",
          reportCode: identity.reportCode,
          fightId: identity.fightId,
          reportRevision: identity.reportRevision,
        }),
      ],
    });
    const artifacts = new Map<string, Uint8Array>([
      [bundle.members[0]!.manifest.contentHash, Buffer.from("{}")],
      [bundle.members[0]!.factSets[0]!.contentHash, Buffer.from("{}")],
      [
        bundle.members[0]!.dimensionExports!.UTILITY!.contentHash,
        Buffer.from(JSON.stringify(utilExport)),
      ],
    ]);
    const resolver = createMapArtifactResolverV2(artifacts);

    const a = await replayCalibrationBundleV2({ bundle, resolver, modelSide: "evaluation" });
    const b = await replayCalibrationBundleV2({ bundle, resolver, modelSide: "evaluation" });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.providerCalls).toBe(0);
    expect(a.refreshCalls).toBe(0);
    expect(a.members[0]!.dimensions[0]!.score).toBe(UTILITY_V2_SCORE_FLOOR);

    const cmp = await replayCalibrationBundleV2ActiveVersusDraft({ bundle, resolver });
    expect(cmp.identicalEvidence).toBe(true);
    expect(cmp.sourceModelsImmutable).toBe(true);
    expect(cmp.active.bundleHash).toBe(cmp.draft.bundleHash);
    expect(cmp.active.members[0]!.dimensions[0]!.inputFingerprint).toBe(
      cmp.draft.members[0]!.dimensions[0]!.inputFingerprint,
    );
  });

  it("blocks account-split identity conflicts", () => {
    const bundle = fixtureV2Bundle();
    const raw = {
      ...bundle,
      bundleHash: undefined,
      members: [
        bundle.members[0],
        {
          ...bundle.members[0],
          memberId: "m2",
          characterId: "char-1",
        },
      ],
    };
    const validated = validateCalibrationInputBundleV2(raw);
    expect(validated.ok).toBe(false);
    expect(validated.errors.some((e) => e.code === "ACCOUNT_SPLIT_CONFLICT")).toBe(true);
  });
});
