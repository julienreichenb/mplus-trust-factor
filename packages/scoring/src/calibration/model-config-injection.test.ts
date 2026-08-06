/**
 * WS10.5 — deterministic active/draft comparison and model-config injection proofs.
 */

import { describe, expect, it } from "vitest";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import {
  createDefaultscoringDimensionConfigSet,
  parsePerformanceV2ModelConfig,
  parseSurvivalV2ModelConfig,
  parseUtilityV2ModelConfig,
  parseExperienceV3ModelConfig,
  resolveScoreModelV2DimensionConfigs,
  withscoringDimensionConfigs,
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
  buildCalibrationContentRefV2,
  createMapArtifactResolverV2,
  replayCalibrationBundleV2ActiveVersusDraft,
  freezeDimensionModelConfigsV2,
  strictReparseFrozenDimensionConfigs,
  UTILITY_V2_SCORE_FLOOR,
  UTILITY_V2_DEFAULT_CONFIG_FINGERPRINT,
  EXPERIENCE_V3_DEFAULT_CONFIG_FINGERPRINT,
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

  it("calibration-strict fails closed when scoring is missing", () => {
    expect(() =>
      resolveScoreModelV2DimensionConfigs(createDefaultModelV6(), "calibration-strict"),
    ).toThrow(/lacks scoring/);
  });

  it("reads complete scoring documents from persisted models", () => {
    const configs = createDefaultscoringDimensionConfigSet();
    const model = withscoringDimensionConfigs(createDefaultModelV6(), configs);
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
  it("malformed draft scoring fails closed", async () => {
    const active = withscoringDimensionConfigs(createDefaultModelV6());
    const draft = {
      ...createDefaultModelV6({ key: "draft", version: 2 }),
      scoring: { schemaVersion: "scoring-dimension-configs.1" },
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
    const utilBytes = Buffer.from(JSON.stringify(utilExport));
    const manifestBytes = Buffer.from("{}");
    const factBytes = Buffer.from("{}");
    const utilRef = buildCalibrationContentRefV2({
      bytes: utilBytes,
      artifactClass: "dimension_replay_export",
    });
    const manifestRef = buildCalibrationContentRefV2({
      bytes: manifestBytes,
      artifactClass: "evidence_manifest",
    });
    const factRef = buildCalibrationContentRefV2({
      bytes: factBytes,
      artifactClass: "run_fact_set",
    });
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
          manifest: manifestRef,
          factSets: [factRef],
          dimensionExports: {
            UTILITY: utilRef,
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
            [manifestRef.contentHash, manifestBytes],
            [factRef.contentHash, factBytes],
            [utilRef.contentHash, utilBytes],
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

describe("deep Utility / Experience validation", () => {
  it("parses canonical defaults and preserves default fingerprints", () => {
    const util = parseUtilityV2ModelConfig(
      JSON.parse(JSON.stringify(UTILITY_V2_MODEL_CONFIG)),
    );
    const exp = parseExperienceV3ModelConfig(
      JSON.parse(JSON.stringify(EXPERIENCE_V3_MODEL_CONFIG)),
    );
    expect(fingerprintUtilityV2ModelConfig(util)).toBe(UTILITY_V2_DEFAULT_CONFIG_FINGERPRINT);
    expect(fingerprintExperienceV3ModelConfig(exp)).toBe(
      EXPERIENCE_V3_DEFAULT_CONFIG_FINGERPRINT,
    );
    expect(fingerprintUtilityV2ModelConfig(util)).toBe(
      fingerprintUtilityV2ModelConfig(UTILITY_V2_MODEL_CONFIG),
    );
    expect(fingerprintExperienceV3ModelConfig(exp)).toBe(
      fingerprintExperienceV3ModelConfig(EXPERIENCE_V3_MODEL_CONFIG),
    );
  });

  it("rejects Utility NaN, Infinity, wrong nested types, and unknown nested fields", () => {
    expect(() =>
      parseUtilityV2ModelConfig({
        ...UTILITY_V2_MODEL_CONFIG,
        interruptCredits: {
          ...UTILITY_V2_MODEL_CONFIG.interruptCredits,
          CONFIRMED_SUCCESS: Number.NaN,
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      parseUtilityV2ModelConfig({
        ...UTILITY_V2_MODEL_CONFIG,
        confidence: {
          ...UTILITY_V2_MODEL_CONFIG.confidence,
          minReliability: Number.POSITIVE_INFINITY,
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      parseUtilityV2ModelConfig({
        ...UTILITY_V2_MODEL_CONFIG,
        confidence: {
          ...UTILITY_V2_MODEL_CONFIG.confidence,
          weights: {
            ...UTILITY_V2_MODEL_CONFIG.confidence.weights,
            dungeonCoverage: "nope" as unknown as number,
          },
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      parseUtilityV2ModelConfig({
        ...UTILITY_V2_MODEL_CONFIG,
        confidence: {
          ...UTILITY_V2_MODEL_CONFIG.confidence,
          unexpectedCap: 1,
        },
      }),
    ).toThrow(/unknown field/);
    expect(() =>
      parseUtilityV2ModelConfig({
        ...UTILITY_V2_MODEL_CONFIG,
        scoreSemantics: {
          ...UTILITY_V2_MODEL_CONFIG.scoreSemantics,
          opportunityMode: "on",
        },
      }),
    ).toThrow(/opportunityMode/);
  });

  it("rejects Experience NaN, Infinity, wrong nested types, and unknown nested fields", () => {
    expect(() =>
      parseExperienceV3ModelConfig({
        ...EXPERIENCE_V3_MODEL_CONFIG,
        eliteHistory: {
          ...EXPERIENCE_V3_MODEL_CONFIG.eliteHistory,
          singleTop01Score: Number.NaN,
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      parseExperienceV3ModelConfig({
        ...EXPERIENCE_V3_MODEL_CONFIG,
        previousSeason: {
          ...EXPERIENCE_V3_MODEL_CONFIG.previousSeason,
          atK90: Number.POSITIVE_INFINITY,
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      parseExperienceV3ModelConfig({
        ...EXPERIENCE_V3_MODEL_CONFIG,
        historicalRank: {
          ...EXPERIENCE_V3_MODEL_CONFIG.historicalRank,
          confirmedFloor: "35" as unknown as number,
        },
      }),
    ).toThrow(/finite number/);
    expect(() =>
      parseExperienceV3ModelConfig({
        ...EXPERIENCE_V3_MODEL_CONFIG,
        phase2AccountBoost: {
          ...EXPERIENCE_V3_MODEL_CONFIG.phase2AccountBoost,
          enabled: true,
        },
      }),
    ).toThrow(/enabled must be false/);
    expect(() =>
      parseExperienceV3ModelConfig({
        ...EXPERIENCE_V3_MODEL_CONFIG,
        eliteHistory: {
          ...EXPERIENCE_V3_MODEL_CONFIG.eliteHistory,
          extraKnob: 1,
        },
      }),
    ).toThrow(/unknown field/);
  });
});

describe("strict replay-boundary re-parse", () => {
  function utilArtifacts() {
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
    const utilBytes = Buffer.from(JSON.stringify(utilExport));
    const manifestBytes = Buffer.from("{}");
    const factBytes = Buffer.from("{}");
    const utilRef = buildCalibrationContentRefV2({
      bytes: utilBytes,
      artifactClass: "dimension_replay_export",
    });
    const manifestRef = buildCalibrationContentRefV2({
      bytes: manifestBytes,
      artifactClass: "evidence_manifest",
    });
    const factRef = buildCalibrationContentRefV2({
      bytes: factBytes,
      artifactClass: "run_fact_set",
    });
    return {
      utilHash: utilRef.contentHash,
      manifestHash: manifestRef.contentHash,
      factHash: factRef.contentHash,
      utilRef,
      manifestRef,
      factRef,
      resolver: createMapArtifactResolverV2(
        new Map([
          [manifestRef.contentHash, manifestBytes],
          [factRef.contentHash, factBytes],
          [utilRef.contentHash, utilBytes],
        ]),
      ),
    };
  }

  function baseBundle(
    activeConfig: unknown,
    draftConfig: unknown,
    hashes: ReturnType<typeof utilArtifacts>,
  ) {
    return buildCalibrationInputBundleV2({
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
        key: "active-v6",
        version: 1,
        status: "ACTIVE",
        config: activeConfig as never,
        isActive: true,
      },
      evaluationModel: {
        key: "draft-v6",
        version: 2,
        status: "DRAFT",
        config: draftConfig as never,
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
          characterId: "c1",
          expectedLabel: "good",
          rationale: "r",
          role: "DPS",
          classSlug: "mage",
          specSlug: "frost",
          included: true,
          exclusionCode: null,
          evidenceCutoffAt: null,
          manifest: hashes.manifestRef,
          factSets: [hashes.factRef],
          dimensionExports: {
            UTILITY: hashes.utilRef,
          },
        },
      ],
      artifactPackage: null,
    });
  }

  it("re-parses bundle-attached configs and rejects unsafe nested Utility values before scoring", async () => {
    const hashes = utilArtifacts();
    const defaults = createDefaultscoringDimensionConfigSet();
    const frozen = freezeDimensionModelConfigsV2(defaults, {
      performance: fingerprintPerformanceV2ModelConfig(defaults.performance),
      survival: fingerprintSurvivalV2ModelConfig(defaults.survival),
      utility: fingerprintUtilityV2ModelConfig(defaults.utility),
      experience: fingerprintExperienceV3ModelConfig(defaults.experience),
    });
    // Tamper nested Utility after freeze — must fail on strict re-parse.
    (frozen.configs.utility.interruptCredits as { CONFIRMED_SUCCESS: number }).CONFIRMED_SUCCESS =
      Number.NaN;

    const active = withscoringDimensionConfigs(createDefaultModelV6());
    const draft = withscoringDimensionConfigs(
      createDefaultModelV6({ key: "draft", version: 2 }),
    );
    const bundle = {
      ...baseBundle(active, draft, hashes),
      activeDimensionConfigs: frozen,
      evaluationDimensionConfigs: freezeDimensionModelConfigsV2(defaults, {
        performance: fingerprintPerformanceV2ModelConfig(defaults.performance),
        survival: fingerprintSurvivalV2ModelConfig(defaults.survival),
        utility: fingerprintUtilityV2ModelConfig(defaults.utility),
        experience: fingerprintExperienceV3ModelConfig(defaults.experience),
      }),
    };

    await expect(
      replayCalibrationBundleV2ActiveVersusDraft({
        bundle,
        resolver: hashes.resolver,
      }),
    ).rejects.toThrow(ModelConfigValidationError);
  });

  it("rejects fingerprint mismatch on strict re-parse", () => {
    const defaults = createDefaultscoringDimensionConfigSet();
    const frozen = freezeDimensionModelConfigsV2(defaults, {
      performance: fingerprintPerformanceV2ModelConfig(defaults.performance),
      survival: fingerprintSurvivalV2ModelConfig(defaults.survival),
      utility: fingerprintUtilityV2ModelConfig(defaults.utility),
      experience: fingerprintExperienceV3ModelConfig(defaults.experience),
    });
    frozen.fingerprints.utility = "0".repeat(64);
    expect(() => strictReparseFrozenDimensionConfigs(frozen)).toThrow(/fingerprint mismatch/);
  });

  it("malformed active config fails before scoring; no partial result", async () => {
    const hashes = utilArtifacts();
    const draft = withscoringDimensionConfigs(
      createDefaultModelV6({ key: "draft", version: 2 }),
    );
    const activeBad = {
      ...createDefaultModelV6(),
      scoring: {
        schemaVersion: "scoring-dimension-configs.1",
        performance: PERFORMANCE_V2_MODEL_CONFIG,
        survival: SURVIVAL_V2_MODEL_CONFIG,
        utility: {
          ...UTILITY_V2_MODEL_CONFIG,
          interruptCredits: {
            ...UTILITY_V2_MODEL_CONFIG.interruptCredits,
            CONFIRMED_SUCCESS: Number.NaN,
          },
        },
        experience: EXPERIENCE_V3_MODEL_CONFIG,
      },
    };
    await expect(
      replayCalibrationBundleV2ActiveVersusDraft({
        bundle: baseBundle(activeBad, draft, hashes),
        resolver: hashes.resolver,
      }),
    ).rejects.toThrow(ModelConfigValidationError);
  });

  it("malformed draft Experience config fails before scoring", async () => {
    const hashes = utilArtifacts();
    const active = withscoringDimensionConfigs(createDefaultModelV6());
    const draftBad = {
      ...createDefaultModelV6({ key: "draft", version: 2 }),
      scoring: {
        schemaVersion: "scoring-dimension-configs.1",
        performance: PERFORMANCE_V2_MODEL_CONFIG,
        survival: SURVIVAL_V2_MODEL_CONFIG,
        utility: UTILITY_V2_MODEL_CONFIG,
        experience: {
          ...EXPERIENCE_V3_MODEL_CONFIG,
          eliteHistory: {
            ...EXPERIENCE_V3_MODEL_CONFIG.eliteHistory,
            singleTop01Score: Number.NaN,
          },
        },
      },
    };
    await expect(
      replayCalibrationBundleV2ActiveVersusDraft({
        bundle: baseBundle(active, draftBad, hashes),
        resolver: hashes.resolver,
      }),
    ).rejects.toThrow(ModelConfigValidationError);
  });

  it("same valid configs yield zero deltas with verified identicalEvidence", async () => {
    const hashes = utilArtifacts();
    const configs = createDefaultscoringDimensionConfigSet();
    const active = withscoringDimensionConfigs(createDefaultModelV6(), configs);
    const draft = withscoringDimensionConfigs(
      createDefaultModelV6({ key: "draft", version: 2 }),
      configs,
    );
    const report = await replayCalibrationBundleV2ActiveVersusDraft({
      bundle: baseBundle(active, draft, hashes),
      resolver: hashes.resolver,
    });
    expect(report.identicalEvidence).toBe(true);
    expect(report.providerCalls).toBe(0);
    expect(report.refreshCalls).toBe(0);
    expect(report.modelActivated).toBe(false);
    expect(report.publicationMutated).toBe(false);
    for (const member of report.members) {
      for (const dim of member.dimensions) {
        expect(dim.identicalEvidence).toBe(true);
        if (dim.activeScore != null && dim.draftScore != null) {
          expect(dim.scoreDelta).toBe(0);
        }
      }
    }
  });

  it("different valid Utility configs produce deterministic real deltas", async () => {
    const hashes = utilArtifacts();
    const activeConfigs = createDefaultscoringDimensionConfigSet();
    const draftConfigs = createDefaultscoringDimensionConfigSet();
    draftConfigs.utility = parseUtilityV2ModelConfig({
      ...UTILITY_V2_MODEL_CONFIG,
      scoreFloor: 55,
    });
    const active = withscoringDimensionConfigs(createDefaultModelV6(), activeConfigs);
    const draft = withscoringDimensionConfigs(
      createDefaultModelV6({ key: "draft", version: 2 }),
      draftConfigs,
    );
    const report = await replayCalibrationBundleV2ActiveVersusDraft({
      bundle: baseBundle(active, draft, hashes),
      resolver: hashes.resolver,
    });
    const util = report.members[0]!.dimensions.find((d) => d.dimension === "UTILITY")!;
    expect(util.activeScore).toBe(UTILITY_V2_SCORE_FLOOR);
    expect(util.draftScore).toBe(55);
    expect(util.scoreDelta).toBe(5);
    expect(util.identicalEvidence).toBe(true);
    expect(report.identicalEvidence).toBe(true);
  });
});
