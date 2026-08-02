import { describe, expect, it } from "vitest";
import {
  DIMENSION_COMPUTATION_LIFECYCLE_SHADOW,
  availabilityFromComputeState,
  availabilityFromUtilityResult,
  buildUnavailableShadowDimensionRecord,
  normalizeShadowDimensionRecord,
} from "./shadow-record.js";
import {
  computePerformanceV2,
  toPerformanceV2ShadowDimensionPayload,
  type PerformanceRunParseFactV2,
  type PerformanceV2ComputeInput,
  type SeasonDifficultyPolicyV2,
} from "../../performance/v2/index.js";
import {
  computeExperienceV3,
  toExperienceV3ShadowDimensionPayload,
  createPreviousSeasonPolicyV3,
  createHistoricalRankPolicyV3,
  type ExperienceV3ComputeInput,
  type ExperienceV3CurrentExposureFact,
  type ExperienceV3EliteHistoryFact,
  type ExperienceV3PreviousSeasonFact,
} from "../../experience/v3/index.js";
import {
  computeSurvivalV2,
  toSurvivalV2ShadowDimensionPayload,
  SURVIVAL_V2_SCHEMA_VERSION,
  type SurvivalFactDocumentV2,
} from "../../survival/v2/index.js";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "../../selection/evidence-v2-selector.js";
import {
  computeUtilityV2,
  toUtilityV2ShadowDimensionPayload,
  emptyUtilityV2FactSet,
  UTILITY_V2_SCORE_FLOOR,
  type UtilityV2ComputeInput,
  type UtilityV2FrozenManifestRef,
} from "../../utility/v2/index.js";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceCandidateAcquisitionResult,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";

const COMPUTED_AT = new Date("2026-08-01T12:00:00.000Z");

describe("normalizeShadowDimensionRecord", () => {
  it("forces lifecycle SHADOW and normalized metrics for all availability states", () => {
    for (const availabilityState of ["AVAILABLE", "PARTIAL", "UNAVAILABLE"] as const) {
      const record = normalizeShadowDimensionRecord({
        payload: {
          characterId: "c1",
          seasonId: "s1",
          manifestId: "m1",
          scoreModelId: "model1",
          dimension: "PERFORMANCE",
          algorithmVersion: "perf-algo",
          inputFingerprint: "fp-1",
          score: availabilityState === "UNAVAILABLE" ? null : 72,
          confidence: availabilityState === "UNAVAILABLE" ? 0 : 0.8,
          state: availabilityState,
          metrics: {
            availabilityState: "AVAILABLE",
            publicationBlocked: false,
            state: "AVAILABLE",
            detail: "keep-me",
          },
          explanation: { note: "ok" },
          computedAt: COMPUTED_AT,
        },
        availabilityState,
      });

      expect(record.state).toBe(DIMENSION_COMPUTATION_LIFECYCLE_SHADOW);
      expect(record.state).toBe("SHADOW");
      expect(record.metrics.availabilityState).toBe(availabilityState);
      expect(record.metrics.publicationBlocked).toBe(true);
      expect(record.metrics.detail).toBe("keep-me");
      expect(record.metrics.state).toBeUndefined();
      expect(record.score).toBe(availabilityState === "UNAVAILABLE" ? null : 72);
      expect(record.confidence).toBe(availabilityState === "UNAVAILABLE" ? 0 : 0.8);
      expect(record.inputFingerprint).toBe("fp-1");
      expect(record.algorithmVersion).toBe("perf-algo");
    }
  });

  it("merges limitations and failureReasons without dropping calculator metrics", () => {
    const record = normalizeShadowDimensionRecord({
      payload: {
        characterId: "c1",
        seasonId: "s1",
        manifestId: "m1",
        scoreModelId: "model1",
        dimension: "SURVIVAL",
        algorithmVersion: "surv-algo",
        inputFingerprint: "fp-s",
        score: null,
        confidence: 0,
        metrics: { preexisting: true, limitations: ["prior"] },
        computedAt: COMPUTED_AT,
      },
      availabilityState: "UNAVAILABLE",
      limitations: ["shadow_placeholder"],
      failureReasons: ["facts_not_calculator_ready"],
    });
    expect(record.metrics.preexisting).toBe(true);
    expect(record.metrics.limitations).toEqual(["prior", "shadow_placeholder"]);
    expect(record.metrics.failureReasons).toEqual(["facts_not_calculator_ready"]);
  });
});

describe("buildUnavailableShadowDimensionRecord", () => {
  it("persists SHADOW + UNAVAILABLE with null score and zero confidence", () => {
    const record = buildUnavailableShadowDimensionRecord({
      characterId: "c1",
      seasonId: "s1",
      manifestId: "m1",
      scoreModelId: "model1",
      dimension: "UTILITY",
      algorithmVersion: "utility-v2-phase1-observed-0.1.0",
      inputFingerprint: "fp-unavail",
      computedAt: COMPUTED_AT,
      limitations: ["shadow_placeholder"],
      failureReasons: ["DIMENSION_CALCULATORS_NOT_WIRED"],
      extraMetrics: { manifestContentHash: "hash-abc" },
    });
    expect(record.state).toBe("SHADOW");
    expect(record.metrics.availabilityState).toBe("UNAVAILABLE");
    expect(record.metrics.publicationBlocked).toBe(true);
    expect(record.score).toBeNull();
    expect(record.confidence).toBe(0);
    expect(record.metrics.manifestContentHash).toBe("hash-abc");
    expect(record.metrics.limitations).toEqual(["shadow_placeholder"]);
    expect(record.metrics.failureReasons).toEqual(["DIMENSION_CALCULATORS_NOT_WIRED"]);
  });
});

describe("availability helpers", () => {
  it("accepts known vocabulary and fails closed on unknown", () => {
    expect(availabilityFromComputeState("AVAILABLE")).toBe("AVAILABLE");
    expect(availabilityFromComputeState("PARTIAL")).toBe("PARTIAL");
    expect(availabilityFromComputeState("UNAVAILABLE")).toBe("UNAVAILABLE");
    expect(availabilityFromComputeState("SHADOW")).toBe("UNAVAILABLE");
    expect(availabilityFromComputeState("COMPUTED")).toBe("UNAVAILABLE");
    expect(availabilityFromUtilityResult("PARTIAL")).toBe("PARTIAL");
  });
});

describe("normalization does not alter calculator formulas", () => {
  const POLICY: SeasonDifficultyPolicyV2 = {
    id: "policy-manual-s1",
    seasonId: "season-1",
    region: "eu",
    role: "dps",
    specSlug: "affliction",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    k50: 8,
    k90: 12,
    k99: 15,
    source: "MANUAL",
    sampleSize: 1000,
    confidence: 0.8,
    version: "sdp-v1",
  };

  const ACTIVE = [
    "dungeon-a",
    "dungeon-b",
    "dungeon-c",
    "dungeon-d",
    "dungeon-e",
    "dungeon-f",
    "dungeon-g",
    "dungeon-h",
  ];

  function perfFact(
    overrides: Partial<PerformanceRunParseFactV2> &
      Pick<PerformanceRunParseFactV2, "slotId" | "dungeonSlug" | "keyLevel">,
  ): PerformanceRunParseFactV2 {
    return {
      parsePercentile: 70,
      semantic: "BRACKET_PERCENT",
      partition: 1,
      rawDps: 500_000,
      reportCode: "AbCdEfGh",
      fightId: 1,
      reportRevision: 1,
      ...overrides,
    };
  }

  function perfInput(
    overrides: Partial<PerformanceV2ComputeInput> = {},
  ): PerformanceV2ComputeInput {
    const runParseFacts = ACTIVE.flatMap((slug, di) => [
      perfFact({
        slotId: `${slug}:0`,
        dungeonSlug: slug,
        keyLevel: 10,
        parsePercentile: 60 + di,
        fightId: di * 2 + 1,
      }),
      perfFact({
        slotId: `${slug}:1`,
        dungeonSlug: slug,
        keyLevel: 11,
        parsePercentile: 55 + di,
        fightId: di * 2 + 2,
      }),
    ]);
    return {
      manifest: {
        contentHash: "manifest-hash-perf",
        schemaVersion: "2.0.0",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        characterId: "char-1",
        seasonId: "season-1",
        seasonSlug: "season-tww-1",
        specSlug: "affliction",
        role: "DPS",
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: ACTIVE,
        expectedSlotCount: ACTIVE.length * 2,
        selectedSlotCount: runParseFacts.length,
        evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      },
      runParseFacts,
      profileAggregate: null,
      difficultyPolicy: POLICY,
      expectedPartition: 1,
      logFreshness: 1,
      computedAt: "2026-08-01T12:00:00.000Z",
      ...overrides,
    };
  }

  it("Performance V2: score/fingerprint unchanged; lifecycle SHADOW; availability in metrics", () => {
    const result = computePerformanceV2(perfInput());
    const payload = toPerformanceV2ShadowDimensionPayload({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      result,
      computedAt: COMPUTED_AT,
    });
    const normalized = normalizeShadowDimensionRecord({
      payload,
      availabilityState: availabilityFromComputeState(result.state),
    });

    expect(normalized.score).toBe(result.score);
    expect(normalized.confidence).toBe(result.confidence);
    expect(normalized.inputFingerprint).toBe(result.inputFingerprint);
    expect(normalized.algorithmVersion).toBe(result.algorithmVersion);
    expect(normalized.state).toBe("SHADOW");
    expect(normalized.metrics.availabilityState).toBe(result.state);
    expect(normalized.metrics.publicationBlocked).toBe(true);

    const tank = computePerformanceV2(
      perfInput({
        manifest: { ...perfInput().manifest, role: "TANK", specSlug: "blood" },
        difficultyPolicy: { ...POLICY, role: "tank", specSlug: "blood" },
      }),
    );
    expect(tank.state).toBe("UNAVAILABLE");
    const tankNorm = normalizeShadowDimensionRecord({
      payload: toPerformanceV2ShadowDimensionPayload({
        characterId: "char-1",
        seasonId: "season-1",
        manifestId: "manifest-1",
        scoreModelId: "model-1",
        result: tank,
        computedAt: COMPUTED_AT,
      }),
      availabilityState: availabilityFromComputeState(tank.state),
    });
    expect(tankNorm.state).toBe("SHADOW");
    expect(tankNorm.metrics.availabilityState).toBe("UNAVAILABLE");
    expect(tankNorm.score).toBeNull();
  });

  it("Experience V3: preserves no-WCL metrics and lifecycle SHADOW", () => {
    const observedAt = "2026-08-01T12:00:00.000Z";
    const runs = [
      { dungeonSlug: "ara-kara", keyLevel: 10, completedAt: "2026-07-20T10:00:00.000Z" },
      { dungeonSlug: "city-of-threads", keyLevel: 8, completedAt: "2026-07-21T10:00:00.000Z" },
      { dungeonSlug: "stonevault", keyLevel: 12, completedAt: "2026-07-22T10:00:00.000Z" },
      { dungeonSlug: "dawnbreaker", keyLevel: 6, completedAt: "2026-07-23T10:00:00.000Z" },
      { dungeonSlug: "siege", keyLevel: 4, completedAt: "2026-07-24T10:00:00.000Z" },
      { dungeonSlug: "necrotic-wake", keyLevel: 15, completedAt: "2026-07-25T10:00:00.000Z" },
      { dungeonSlug: "mists", keyLevel: 11, completedAt: "2026-07-26T10:00:00.000Z" },
      { dungeonSlug: "sv", keyLevel: 9, completedAt: "2026-07-27T10:00:00.000Z" },
    ];
    const currentExposure: ExperienceV3CurrentExposureFact = {
      expectedDungeonCount: 8,
      selectedRuns: runs,
      seasonRuns: runs,
      priorSeasonCount: 2,
      priorSeasonSourceDepth: 3,
      provenance: "HAS_HISTORY",
      observedAt,
    };
    const previousSeason: ExperienceV3PreviousSeasonFact = {
      evidenceState: "HAS_VALUE",
      score: 2800,
      seasonId: "season-uuid-prev",
      seasonSlug: "season-tww-2",
      source: "BLIZZARD",
      sourceConfidence: 0.9,
      fetchedAt: observedAt,
    };
    const eliteHistory: ExperienceV3EliteHistoryFact = {
      evidenceState: "CONFIRMED_NO_ACTIVITY",
      achievements: [],
    };
    const input: ExperienceV3ComputeInput = {
      manifest: {
        contentHash: "manifest-hash-exp",
        schemaVersion: "evidence-manifest-v2",
        selectorVersion: "selector-v2.1",
        characterId: "char-1",
        seasonId: "season-uuid-current",
        seasonSlug: "season-tww-3",
        highKeyPolicyId: "high-key-v1",
        evidenceCutoffAt: observedAt,
      },
      currentExposure,
      previousSeason,
      previousSeasonPolicy: createPreviousSeasonPolicyV3({
        seasonId: "season-uuid-prev",
        seasonSlug: "season-tww-2",
        region: "eu",
        k50: 2000,
        k90: 2800,
        k99: 3200,
        confidence: 0.8,
      }),
      eliteHistory,
      historicalRank: null,
      historicalRankPolicy: createHistoricalRankPolicyV3({ confidence: 0.7 }),
      computedAt: observedAt,
    };
    const result = computeExperienceV3(input);
    const normalized = normalizeShadowDimensionRecord({
      payload: toExperienceV3ShadowDimensionPayload({
        characterId: "char-1",
        seasonId: "season-uuid-current",
        manifestId: "manifest-1",
        scoreModelId: "model-1",
        result,
        computedAt: COMPUTED_AT,
      }),
      availabilityState: availabilityFromComputeState(result.state),
    });
    expect(normalized.score).toBe(result.score);
    expect(normalized.inputFingerprint).toBe(result.inputFingerprint);
    expect(normalized.state).toBe("SHADOW");
    expect(normalized.metrics.availabilityState).toBe(result.state);
    expect(normalized.metrics.noWclDependency).toBe(true);
    expect(normalized.metrics.publicationBlocked).toBe(true);
  });

  it("Survival V2: preserves compute outputs; SHADOW lifecycle", () => {
    const dungeons = ["ara-kara-city-of-echoes", "the-rookery"] as const;
    const scope: EvidenceSelectionScope = {
      characterId: "char-surv-1",
      seasonId: "season-1",
      seasonSlug: "the-war-within-season-1",
      specializationId: "spec-1",
      specSlug: "affliction",
      role: "DPS",
      refreshContractHash: "refresh-hash-surv",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...dungeons],
    };

    function candidate(
      overrides: Partial<EvidenceCandidateMetadataV2> & {
        reportCode: string;
        fightId: number;
        dungeonSlug: string;
        keyLevel: number;
      },
    ): EvidenceCandidateMetadataV2 {
      const { reportCode, fightId, dungeonSlug, keyLevel, ...rest } = overrides;
      return {
        discoveryIdentity: { reportCode, fightId },
        reportRevision: rest.reportRevision !== undefined ? rest.reportRevision : null,
        dungeonSlug,
        keyLevel,
        timed: rest.timed !== undefined ? rest.timed : true,
        runScore: rest.runScore !== undefined ? rest.runScore : 400,
        evidenceCompleteness: rest.evidenceCompleteness ?? 1,
        completedAt: rest.completedAt !== undefined ? rest.completedAt : "2026-07-01T12:00:00.000Z",
        fightDurationMs: rest.fightDurationMs !== undefined ? rest.fightDurationMs : 1_800_000,
        actorId: rest.actorId !== undefined ? rest.actorId : 10,
        accessState: rest.accessState ?? "PUBLIC",
        identityResolution: rest.identityResolution ?? "RESOLVED",
        fightAccessible: rest.fightAccessible ?? true,
        hardError: rest.hardError ?? false,
      };
    }

    const candidates = dungeons.flatMap((dungeonSlug, i) => [
      candidate({ reportCode: `hi-${i}`, fightId: 1, dungeonSlug, keyLevel: 16, runScore: 500 }),
      candidate({ reportCode: `lo-${i}`, fightId: 2, dungeonSlug, keyLevel: 14, runScore: 420 }),
    ]);
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope,
      candidates,
      plannedAt: "2026-08-01T11:00:00.000Z",
    });
    const seen = new Set<string>();
    const acquisitionResults: EvidenceCandidateAcquisitionResult[] = [];
    for (const slot of plan.slots) {
      for (const attempt of slot.orderedCandidates) {
        const key = `${attempt.discoveryIdentity.reportCode}:${attempt.discoveryIdentity.fightId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        acquisitionResults.push({
          discoveryIdentity: { ...attempt.discoveryIdentity },
          acquisitionStatus: "ACQUIRED",
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [{ dataset: "CASTS", contentHash: `casts-${key}` }],
          factSetHash: `facts-${key}`,
          dimensionValidity: {
            performance: "VALID",
            survival: "VALID",
            utility: "VALID",
            reasons: [],
          },
          keyLevel: attempt.keyLevel,
          timed: attempt.timed,
          runScore: attempt.runScore,
          completedAt: attempt.completedAt,
          actorId: attempt.actorId,
          evidenceCompleteness: attempt.evidenceCompleteness,
        });
      }
    }
    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults,
      selectedAt: "2026-08-01T12:00:00.000Z",
    });

    const factSets: SurvivalFactDocumentV2[] = manifest.slots
      .filter((s) => s.state === "SELECTED" && s.identity != null)
      .map((s) => ({
        schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
        extractorFamily: "survival",
        extractorVersion: "survival-facts-test-1.0.0",
        dungeonSlug: s.dungeonSlug,
        slotIndex: s.slotIndex,
        identity: {
          reportCode: s.identity!.reportCode,
          fightId: s.identity!.fightId,
          reportRevision: s.identity!.reportRevision,
        },
        keyLevel: s.keyLevel,
        deaths: { count: s.slotIndex },
        activeCombat: { durationMs: 1_800_000, fightDurationMs: 2_000_000 },
        defensiveActivations: {
          byCategory: { DEFENSIVE_MAJOR: 3, DEFENSIVE_MINOR: 6 },
          toolkit: [
            { category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" },
            { category: "DEFENSIVE_MINOR", state: "AVAILABLE_INFERRED" },
          ],
          catalogCoverage: 0.9,
        },
        dangerWindows: [],
        healthEvidence: { mode: "FULL", catalogSelfHealCoverage: 0.8 },
        relativeDamage: null,
        limitations: [],
      }));

    const result = computeSurvivalV2({
      manifest,
      factSets,
      relativeDamageMode: "off",
    });
    const normalized = normalizeShadowDimensionRecord({
      payload: toSurvivalV2ShadowDimensionPayload({
        characterId: "char-surv-1",
        seasonId: "season-1",
        manifestId: "manifest-1",
        scoreModelId: "model-1",
        result,
        computedAt: COMPUTED_AT,
      }),
      availabilityState: availabilityFromComputeState(result.state),
    });
    expect(normalized.score).toBe(result.score);
    expect(normalized.confidence).toBe(result.confidence);
    expect(normalized.inputFingerprint).toBe(result.inputFingerprint);
    expect(normalized.state).toBe("SHADOW");
    expect(normalized.metrics.availabilityState).toBe(result.state);
    expect(normalized.metrics.publicationBlocked).toBe(true);
  });

  it("Utility V2: floor-50 semantics preserved; SHADOW lifecycle", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const fact = emptyUtilityV2FactSet({
      slotId: "slot-a",
      runId: "R1:1",
      dungeonSlug: "ara-kara",
      slotIndex: 0,
      reportCode: identity.reportCode,
      fightId: identity.fightId,
      reportRevision: identity.reportRevision,
    });
    const slots: UtilityV2FrozenManifestRef["slots"] = [
      {
        slotId: "slot-a",
        dungeonSlug: "ara-kara",
        slotIndex: 0,
        state: "SELECTED",
        identity,
      },
    ];
    const input: UtilityV2ComputeInput = {
      manifest: {
        contentHash: "util-manifest",
        schemaVersion: "2.0.0",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
        slots,
      },
      factSets: [fact],
    };
    const result = computeUtilityV2(input);
    expect(result.score).toBe(UTILITY_V2_SCORE_FLOOR);
    const normalized = normalizeShadowDimensionRecord({
      payload: toUtilityV2ShadowDimensionPayload({
        characterId: "char-1",
        seasonId: "season-1",
        manifestId: "manifest-1",
        scoreModelId: "model-1",
        result,
        computedAt: COMPUTED_AT,
      }),
      availabilityState: availabilityFromUtilityResult(result.availabilityState),
    });
    expect(normalized.score).toBe(UTILITY_V2_SCORE_FLOOR);
    expect(normalized.score).toBe(result.score);
    expect(normalized.inputFingerprint).toBe(result.inputFingerprint);
    expect(normalized.state).toBe("SHADOW");
    expect(normalized.metrics.availabilityState).toBe(result.availabilityState);
    expect(normalized.metrics.publicationBlocked).toBe(true);
  });
});
