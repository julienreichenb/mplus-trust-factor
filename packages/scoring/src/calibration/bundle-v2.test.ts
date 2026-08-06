import { describe, expect, it } from "vitest";
import {
  buildCalibrationContentRefV2,
  buildCalibrationInputBundle,
  buildCalibrationInputBundleV2,
  buildSyntheticFixtureBundle,
  computeArtifactSha256Hex,
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
  UTILITY_V2_MODEL_CONFIG,
  UTILITY_V2_SCORE_FLOOR,
} from "../utility/v2/index.js";
import {
  createDefaultscoringDimensionConfigSet,
  withscoringDimensionConfigs,
} from "../model-config/index.js";
import { createDefaultModelV6 } from "../model/defaults.js";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";

function storeJson(
  artifacts: Map<string, Uint8Array>,
  value: unknown,
): string {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  const hex = computeArtifactSha256Hex(bytes);
  artifacts.set(hex, bytes);
  return hex;
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
  const manifestDoc = { schemaVersion: "2.0.0", contentHash: "a".repeat(64) };
  const factDoc = { kind: "fixture-fact" };
  const manifestRef = buildCalibrationContentRefV2({
    bytes: Buffer.from(JSON.stringify(manifestDoc), "utf8"),
    artifactClass: "evidence_manifest",
    logicalContentHash: "a".repeat(64),
    schemaVersion: "2.0.0",
  });
  const factRef = buildCalibrationContentRefV2({
    bytes: Buffer.from(JSON.stringify(factDoc), "utf8"),
    artifactClass: "run_fact_set",
    schemaVersion: "utility-v2-facts",
  });
  const utilRef = buildCalibrationContentRefV2({
    bytes: Buffer.from(JSON.stringify(utilExport), "utf8"),
    artifactClass: "dimension_replay_export",
    schemaVersion: "utility-v2-facts",
  });

  const scoring = createDefaultscoringDimensionConfigSet();
  const modelConfig = withscoringDimensionConfigs(createDefaultModelV6(), scoring);
  const model = {
    key: modelConfig.key,
    version: modelConfig.version,
    status: "DRAFT" as const,
    config: modelConfig,
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
        manifest: manifestRef,
        factSets: [factRef],
        dimensionExports: {
          UTILITY: utilRef,
        },
      },
    ],
    artifactPackage: null,
    ...overrides,
  });
}

function fixtureArtifacts(): Map<string, Uint8Array> {
  const artifacts = new Map<string, Uint8Array>();
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
  storeJson(artifacts, { schemaVersion: "2.0.0", contentHash: "a".repeat(64) });
  storeJson(artifacts, { kind: "fixture-fact" });
  storeJson(artifacts, utilExport);
  return artifacts;
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

    const artifacts = fixtureArtifacts();
    const ok = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireByteIntegrity: true,
    });
    expect(ok.ok).toBe(true);
  });

  it("replays provider-free with deterministic export replay; active/draft model eval fails closed", async () => {
    const bundle = fixtureV2Bundle();
    const artifacts = fixtureArtifacts();
    const resolver = createMapArtifactResolverV2(artifacts);

    const a = await replayCalibrationBundleV2({ bundle, resolver, modelSide: "evaluation" });
    const b = await replayCalibrationBundleV2({ bundle, resolver, modelSide: "evaluation" });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.providerCalls).toBe(0);
    expect(a.refreshCalls).toBe(0);
    expect(a.members[0]!.dimensions[0]!.score).toBe(UTILITY_V2_SCORE_FLOOR);

    const activeDraft = await replayCalibrationBundleV2ActiveVersusDraft({
      bundle,
      resolver,
    });
    expect(activeDraft.schemaVersion).toBe("calibration-active-draft-v2");
    expect(activeDraft.providerCalls).toBe(0);
    expect(activeDraft.refreshCalls).toBe(0);
    expect(activeDraft.modelActivated).toBe(false);
    expect(activeDraft.publicationMutated).toBe(false);
    expect(activeDraft.identicalEvidence).toBe(true);
    // Same default configs → zero deltas
    for (const member of activeDraft.members) {
      for (const dim of member.dimensions) {
        if (dim.activeScore != null && dim.draftScore != null) {
          expect(dim.scoreDelta).toBe(0);
        }
      }
      if (member.overallDelta != null) expect(member.overallDelta).toBe(0);
    }
  });

  it("active-versus-draft produces real deltas when Utility config differs", async () => {
    const base = fixtureV2Bundle();
    const draftUtility = {
      ...structuredClone(UTILITY_V2_MODEL_CONFIG),
      scoreFloor: 55,
    };
    const draftConfigs = createDefaultscoringDimensionConfigSet();
    (draftConfigs as { utility: typeof draftUtility }).utility = draftUtility;
    const draftModelConfig = withscoringDimensionConfigs(
      createDefaultModelV6({ key: "draft-v6", version: 99 }),
      draftConfigs,
    );
    const { bundleHash: _drop, ...rest } = base;
    const rebuilt = buildCalibrationInputBundleV2({
      ...rest,
      evaluationModel: {
        id: "draft-changed",
        key: draftModelConfig.key,
        version: draftModelConfig.version,
        status: "DRAFT",
        config: draftModelConfig,
        isActive: false,
      },
    });
    const artifacts = fixtureArtifacts();
    const report = await replayCalibrationBundleV2ActiveVersusDraft({
      bundle: rebuilt,
      resolver: createMapArtifactResolverV2(artifacts),
    });
    const util = report.members[0]!.dimensions.find((d) => d.dimension === "UTILITY")!;
    expect(util.activeScore).toBe(UTILITY_V2_SCORE_FLOOR);
    expect(util.draftScore).toBe(55);
    expect(util.scoreDelta).toBe(5);
    expect(util.identicalEvidence).toBe(true);
  });

  it("rejects ACTIVE evaluationModel (DRAFT-only creation)", async () => {
    const bundle = fixtureV2Bundle();
    const bad = {
      ...bundle,
      evaluationModel: {
        ...bundle.evaluationModel!,
        status: "ACTIVE" as const,
        isActive: true,
      },
    };
    const artifacts = fixtureArtifacts();
    await expect(
      replayCalibrationBundleV2({
        bundle: bad,
        resolver: createMapArtifactResolverV2(artifacts),
      }),
    ).rejects.toThrow(/DRAFT_MODEL_CREATION_FORBIDDEN/);
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

  it("blocks duplicate frozen run identity across included members", async () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const manifestDoc = {
      schemaVersion: "2.0.0",
      contentHash: "shared-manifest",
      slots: [
        {
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          slotIndex: 0,
          state: "SELECTED",
          identity,
        },
      ],
    };
    const manifestRef = buildCalibrationContentRefV2({
      bytes: Buffer.from(JSON.stringify(manifestDoc), "utf8"),
      artifactClass: "evidence_manifest",
      schemaVersion: "2.0.0",
    });
    const base = fixtureV2Bundle();
    const bundle = buildCalibrationInputBundleV2({
      ...base,
      bundleHash: undefined as never,
      members: [
        {
          ...base.members[0]!,
          memberId: "m1",
          characterId: "char-1",
          manifest: manifestRef,
        },
        {
          ...base.members[0]!,
          memberId: "m2",
          characterId: "char-2",
          manifest: manifestRef,
          dimensionExports: {},
          factSets: base.members[0]!.factSets,
        },
      ],
    });

    const artifacts = fixtureArtifacts();
    artifacts.set(manifestRef.contentHash, Buffer.from(JSON.stringify(manifestDoc), "utf8"));

    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
    });
    expect(preflight.ok).toBe(false);
    expect(preflight.blocking.some((b) => b.code === "DUPLICATE_FROZEN_IDENTITY")).toBe(true);
    expect(preflight.blocking.some((b) => b.message.includes("firstMember=m1"))).toBe(true);
    expect(preflight.blocking.some((b) => b.message.includes("conflictingMember=m2"))).toBe(true);
  });

  it("allows same reportCode/fightId when reportRevision differs", async () => {
    const docA = {
      slots: [
        {
          slotId: "a:0",
          slotIndex: 0,
          state: "SELECTED",
          identity: { reportCode: "R1", fightId: 1, reportRevision: 1 },
        },
      ],
    };
    const docB = {
      slots: [
        {
          slotId: "b:0",
          slotIndex: 0,
          state: "SELECTED",
          identity: { reportCode: "R1", fightId: 1, reportRevision: 2 },
        },
      ],
    };
    const refA = buildCalibrationContentRefV2({
      bytes: Buffer.from(JSON.stringify(docA), "utf8"),
      artifactClass: "evidence_manifest",
    });
    const refB = buildCalibrationContentRefV2({
      bytes: Buffer.from(JSON.stringify(docB), "utf8"),
      artifactClass: "evidence_manifest",
    });
    const base = fixtureV2Bundle();
    const bundle = buildCalibrationInputBundleV2({
      ...base,
      bundleHash: undefined as never,
      members: [
        {
          ...base.members[0]!,
          memberId: "m1",
          characterId: "char-1",
          manifest: refA,
        },
        {
          ...base.members[0]!,
          memberId: "m2",
          characterId: "char-2",
          manifest: refB,
          dimensionExports: {},
        },
      ],
    });
    const artifacts = fixtureArtifacts();
    artifacts.set(refA.contentHash, Buffer.from(JSON.stringify(docA), "utf8"));
    artifacts.set(refB.contentHash, Buffer.from(JSON.stringify(docB), "utf8"));
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
    });
    expect(preflight.blocking.filter((b) => b.code === "DUPLICATE_FROZEN_IDENTITY")).toHaveLength(
      0,
    );
  });

  it("blocks duplicate frozen identity inside one malformed member", async () => {
    const identity = { reportCode: "Dup1", fightId: 9, reportRevision: 1 };
    const doc = {
      slots: [
        { slotId: "a:0", slotIndex: 0, state: "SELECTED", identity },
        { slotId: "b:0", slotIndex: 0, state: "SELECTED", identity },
      ],
    };
    const manifestRef = buildCalibrationContentRefV2({
      bytes: Buffer.from(JSON.stringify(doc), "utf8"),
      artifactClass: "evidence_manifest",
    });
    const base = fixtureV2Bundle();
    const bundle = buildCalibrationInputBundleV2({
      ...base,
      bundleHash: undefined as never,
      members: [
        {
          ...base.members[0]!,
          manifest: manifestRef,
        },
      ],
    });
    const artifacts = fixtureArtifacts();
    artifacts.set(manifestRef.contentHash, Buffer.from(JSON.stringify(doc), "utf8"));
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
    });
    expect(preflight.ok).toBe(false);
    expect(
      preflight.blocking.some(
        (b) => b.code === "DUPLICATE_FROZEN_IDENTITY" && b.message.includes("within member"),
      ),
    ).toBe(true);
  });

  it("excluded member does not create frozen-identity conflict", async () => {
    const identity = { reportCode: "R9", fightId: 3, reportRevision: 1 };
    const doc = {
      slots: [{ slotId: "a:0", slotIndex: 0, state: "SELECTED", identity }],
    };
    const manifestRef = buildCalibrationContentRefV2({
      bytes: Buffer.from(JSON.stringify(doc), "utf8"),
      artifactClass: "evidence_manifest",
    });
    const base = fixtureV2Bundle();
    const bundle = buildCalibrationInputBundleV2({
      ...base,
      bundleHash: undefined as never,
      members: [
        {
          ...base.members[0]!,
          memberId: "m1",
          characterId: "char-1",
          included: true,
          manifest: manifestRef,
        },
        {
          ...base.members[0]!,
          memberId: "m2",
          characterId: "char-2",
          included: false,
          exclusionCode: "manual",
          manifest: manifestRef,
          dimensionExports: {},
        },
      ],
    });
    const artifacts = fixtureArtifacts();
    artifacts.set(manifestRef.contentHash, Buffer.from(JSON.stringify(doc), "utf8"));
    const preflight = await preflightCalibrationBundleV2({
      bundle,
      resolver: createMapArtifactResolverV2(artifacts),
      requireCatalogVersions: false,
    });
    expect(preflight.blocking.filter((b) => b.code === "DUPLICATE_FROZEN_IDENTITY")).toHaveLength(
      0,
    );
  });
});
