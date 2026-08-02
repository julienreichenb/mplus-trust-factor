/**
 * WS10.5 — deterministic active/draft comparison and model-config injection proofs.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import {
  createDefaultScoringV2DimensionConfigSet,
  parsePerformanceV2ModelConfig,
  parseSurvivalV2ModelConfig,
  parseUtilityV2ModelConfig,
  parseExperienceV3ModelConfig,
  resolveScoreModelV2DimensionConfigs,
  withScoringV2DimensionConfigs,
  ModelConfigValidationError,
  stableSha256,
  PERFORMANCE_V2_MODEL_CONFIG,
  SURVIVAL_V2_MODEL_CONFIG,
  UTILITY_V2_MODEL_CONFIG,
  EXPERIENCE_V3_MODEL_CONFIG,
  computePerformanceV2,
  computeUtilityV2,
  fingerprintPerformanceV2ModelConfig,
  fingerprintSurvivalV2ModelConfig,
  fingerprintUtilityV2ModelConfig,
  fingerprintExperienceV3ModelConfig,
  emptyUtilityV2FactSet,
  exportUtilityV2Calibration,
  createManualDifficultyPolicyV2,
  buildCalibrationInputBundleV2,
  createMapArtifactResolverV2,
  replayCalibrationBundleV2ActiveVersusDraft,
  UTILITY_V2_SCORE_FLOOR,
} from "../index.js";
import { createDefaultModelV6 } from "../model/defaults.js";
import { COHORT_MANIFEST_SCHEMA_VERSION } from "./types.js";

describe("model-config schemas", () => {
  it("rejects incompatible Performance versions and unknown fields", () => {
    expect(() =>
      parsePerformanceV2ModelConfig({
        ...PERFORMANCE_V2_MODEL_CONFIG,
        schemaVersion: "performance-v1",
      }),
    ).toThrow(ModelConfigValidationError);
    expect(() =>
      parsePerformanceV2ModelConfig({
        ...PERFORMANCE_V2_MODEL_CONFIG,
        unexpectedKnob: 1,
      }),
    ).toThrow(/unknown field/);
    expect(() =>
      parsePerformanceV2ModelConfig({
        ...PERFORMANCE_V2_MODEL_CONFIG,
        parseCenter: 150,
      }),
    ).toThrow(/parseCenter/);
  });

  it("rejects Survival weight sums that are not 1", () => {
    expect(() =>
      parseSurvivalV2ModelConfig({
        ...SURVIVAL_V2_MODEL_CONFIG,
        weightsWithRelative: {
          outcome: 0.5,
          defensive: 0.5,
          recovery: 0.5,
          relativeDamage: 0.5,
        },
      }),
    ).toThrow(/sum to 1/);
  });

  it("rejects Utility incompatible algorithm versions", () => {
    expect(() =>
      parseUtilityV2ModelConfig({
        ...UTILITY_V2_MODEL_CONFIG,
        algorithmVersion: "utility-v1-legacy",
      }),
    ).toThrow(/incompatible algorithmVersion/);
  });

  it("rejects Experience incompatible schema versions", () => {
    expect(() =>
      parseExperienceV3ModelConfig({
        ...EXPERIENCE_V3_MODEL_CONFIG,
        schemaVersion: "experience-v2",
      }),
    ).toThrow(/incompatible schemaVersion/);
  });

  it("canonical config hashes ignore JSON key order", () => {
    const a = { z: 1, a: { c: 2, b: 3 } };
    const b = { a: { b: 3, c: 2 }, z: 1 };
    expect(stableSha256(a)).toBe(stableSha256(b));
    expect(
      fingerprintPerformanceV2ModelConfig(PERFORMANCE_V2_MODEL_CONFIG),
    ).toBe(
      fingerprintPerformanceV2ModelConfig(
        JSON.parse(JSON.stringify(PERFORMANCE_V2_MODEL_CONFIG)),
      ),
    );
  });
});

describe("default configs reproduce golden scores", () => {
  it("Performance default override matches no-override score and fingerprint", () => {
    const policy = createManualDifficultyPolicyV2({
      id: "p",
      seasonId: "s",
      region: "eu",
      role: "DPS",
      k50: 8,
      k90: 12,
      k99: 16,
    });
    const input = {
      manifest: {
        contentHash: "m",
        schemaVersion: "2.0.0",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        characterId: "c",
        seasonId: "s",
        seasonSlug: "season",
        specSlug: "frost",
        role: "DPS" as const,
        highKeyPolicyId: "hk",
        activeDungeonSlugs: ["dungeon-a"],
        expectedSlotCount: 2,
        selectedSlotCount: 2,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      },
      runParseFacts: [
        {
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          keyLevel: 10,
          parsePercentile: 80,
          semantic: "BRACKET_PERCENT" as const,
          partition: 1,
          rawDps: null,
          reportCode: null,
          fightId: null,
          reportRevision: null,
        },
        {
          slotId: "dungeon-a:1",
          dungeonSlug: "dungeon-a",
          keyLevel: 11,
          parsePercentile: 70,
          semantic: "BRACKET_PERCENT" as const,
          partition: 1,
          rawDps: null,
          reportCode: null,
          fightId: null,
          reportRevision: null,
        },
      ],
      profileAggregate: null,
      difficultyPolicy: policy,
      expectedPartition: 1,
      logFreshness: 1,
      computedAt: "2026-08-01T12:00:00.000Z",
    };
    const a = computePerformanceV2(input);
    const b = computePerformanceV2(input, { modelConfig: PERFORMANCE_V2_MODEL_CONFIG });
    expect(a.score).toBe(b.score);
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.modelConfigFingerprint).toBe(
      fingerprintPerformanceV2ModelConfig(PERFORMANCE_V2_MODEL_CONFIG),
    );
  });

  it("changed Performance config changes Performance only (fingerprint/score)", () => {
    const policy = createManualDifficultyPolicyV2({
      id: "p",
      seasonId: "s",
      region: "eu",
      role: "DPS",
      k50: 8,
      k90: 12,
      k99: 16,
    });
    const input = {
      manifest: {
        contentHash: "m",
        schemaVersion: "2.0.0",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        characterId: "c",
        seasonId: "s",
        seasonSlug: "season",
        specSlug: "frost",
        role: "DPS" as const,
        highKeyPolicyId: "hk",
        activeDungeonSlugs: ["dungeon-a"],
        expectedSlotCount: 2,
        selectedSlotCount: 2,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      },
      runParseFacts: [
        {
          slotId: "dungeon-a:0",
          dungeonSlug: "dungeon-a",
          keyLevel: 10,
          parsePercentile: 80,
          semantic: "BRACKET_PERCENT" as const,
          partition: 1,
          rawDps: null,
          reportCode: null,
          fightId: null,
          reportRevision: null,
        },
        {
          slotId: "dungeon-a:1",
          dungeonSlug: "dungeon-a",
          keyLevel: 11,
          parsePercentile: 70,
          semantic: "BRACKET_PERCENT" as const,
          partition: 1,
          rawDps: null,
          reportCode: null,
          fightId: null,
          reportRevision: null,
        },
      ],
      profileAggregate: null,
      difficultyPolicy: policy,
      expectedPartition: 1,
      logFreshness: 1,
      computedAt: "2026-08-01T12:00:00.000Z",
    };
    const base = computePerformanceV2(input);
    const changed = computePerformanceV2(input, {
      modelConfig: {
        ...PERFORMANCE_V2_MODEL_CONFIG,
        parseCenter: 40,
      },
    });
    expect(changed.score).not.toBe(base.score);
    expect(changed.inputFingerprint).not.toBe(base.inputFingerprint);
    expect(changed.modelConfigFingerprint).not.toBe(base.modelConfigFingerprint);
  });
});

describe("ScoreModel mapping", () => {
  it("phase1-default uses package defaults for legacy models", () => {
    const resolved = resolveScoreModelV2DimensionConfigs(createDefaultModelV6(), "phase1-default");
    expect(resolved.compatibility).toBe("legacy-defaults");
    expect(resolved.configs.performance).toEqual(PERFORMANCE_V2_MODEL_CONFIG);
  });

  it("calibration-strict fails closed when scoringV2 is missing", () => {
    expect(() =>
      resolveScoreModelV2DimensionConfigs(createDefaultModelV6(), "calibration-strict"),
    ).toThrow(/lacks scoringV2/);
  });

  it("reads complete scoringV2 documents from persisted models", () => {
    const configs = createDefaultScoringV2DimensionConfigSet();
    const model = withScoringV2DimensionConfigs(createDefaultModelV6(), configs);
    const resolved = resolveScoreModelV2DimensionConfigs(model, "calibration-strict");
    expect(resolved.fromPersistedDocument).toBe(true);
    expect(resolved.fingerprints.utility).toBe(
      fingerprintUtilityV2ModelConfig(UTILITY_V2_MODEL_CONFIG),
    );
    expect(resolved.fingerprints.survival).toBe(
      fingerprintSurvivalV2ModelConfig(SURVIVAL_V2_MODEL_CONFIG),
    );
    expect(resolved.fingerprints.experience).toBe(
      fingerprintExperienceV3ModelConfig(EXPERIENCE_V3_MODEL_CONFIG),
    );
  });
});

describe("active-versus-draft safety", () => {
  it("malformed draft scoringV2 fails closed", async () => {
    const active = withScoringV2DimensionConfigs(createDefaultModelV6());
    const draft = {
      ...createDefaultModelV6({ key: "draft", version: 2 }),
      scoringV2: { schemaVersion: "scoring-v2-dimension-configs.1" },
    };
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
    const bundle = buildCalibrationInputBundleV2({
      generatedAt: "2026-08-01T12:00:00.000Z",
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      source: "fixture",
      mode: "active-versus-draft",
      deterministicSeed: 1,
      cohort: {
        schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
        cohortId: "c",
        description: "d",
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
        key: active.key,
        version: active.version,
        status: "ACTIVE",
        config: active,
        isActive: true,
      },
      evaluationModel: {
        key: draft.key,
        version: draft.version,
        status: "DRAFT",
        config: draft as never,
        isActive: false,
      },
      policies: {
        difficultyPolicies: [],
        abilityCatalogVersions: [],
        mechanicCatalogVersions: [],
        confidenceAlgorithmVersions: {},
        dimensionAlgorithmVersions: {},
      },
      members: [
        {
          memberId: "m1",
          characterId: "c1",
          expectedLabel: "good",
          rationale: "r",
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          included: true,
          exclusionCode: null,
          evidenceCutoffAt: null,
          manifest: {
            contentHash: manifestHash,
            artifactClass: "evidence_manifest",
          },
          factSets: [{ contentHash: factHash, artifactClass: "run_fact_set" }],
          dimensionExports: {
            UTILITY: {
              contentHash: utilHash,
              artifactClass: "dimension_replay_export",
            },
          },
        },
      ],
      artifactPackage: null,
    });

    await expect(
      replayCalibrationBundleV2ActiveVersusDraft({
        bundle,
        resolver: createMapArtifactResolverV2(
          new Map([
            [manifestHash, Buffer.from("{}")],
            [factHash, Buffer.from("{}")],
            [utilHash, Buffer.from(JSON.stringify(utilExport))],
          ]),
        ),
      }),
    ).rejects.toThrow(ModelConfigValidationError);
  });

  it("same facts + same config are deterministic; unavailable stays unavailable", () => {
    const input = {
      manifest: {
        contentHash: "m",
        schemaVersion: "2.0.0",
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
        slots: [
          {
            slotId: "slot-a",
            dungeonSlug: "ara-kara",
            slotIndex: 0 as const,
            state: "SELECTED",
            identity: { reportCode: "R1", fightId: 1, reportRevision: 1 },
          },
        ],
      },
      factSets: [] as ReturnType<typeof emptyUtilityV2FactSet>[],
      extractionFailed: true,
    };
    const a = computeUtilityV2(input);
    const b = computeUtilityV2(input, { modelConfig: UTILITY_V2_MODEL_CONFIG });
    expect(a.availabilityState).toBe("UNAVAILABLE");
    expect(a.score).toBeNull();
    expect(a.score).toBe(b.score);
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.score).not.toBe(0);
    expect(a.score).not.toBe(UTILITY_V2_SCORE_FLOOR);
  });
});
