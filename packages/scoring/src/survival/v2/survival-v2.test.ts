import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceAcquisitionPlanV2,
  type EvidenceCandidateAcquisitionResult,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "../../selection/evidence-v2-selector.js";
import { selectSurvivalAnalysisRuns } from "../../selection/survival-run-selection.js";
import {
  SURVIVAL_V2_ALGORITHM_VERSION,
  SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION,
  SURVIVAL_V2_MODEL_CONFIG,
  SURVIVAL_V2_OUTCOME_BY_DEATHS,
  SURVIVAL_V2_SCHEMA_VERSION,
  SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF,
  SURVIVAL_V2_WEIGHTS_WITH_RELATIVE,
  computeSurvivalV2,
  exportSurvivalV2Calibration,
  mergePressureClusters,
  parseSurvivalFactDocumentV2,
  scoreSurvivalV2Defensive,
  scoreSurvivalV2EmergencyRecovery,
  scoreSurvivalV2Outcome,
  scoreSurvivalV2RelativeDamageShadow,
  scoreSurvivalV2Run,
  saturatingDefensiveRateScore,
  toSurvivalV2ShadowDimensionPayload,
  type SurvivalFactDocumentV2,
} from "./index.js";

const DUNGEONS = ["ara-kara-city-of-echoes", "the-rookery"] as const;

function baseScope(overrides?: Partial<EvidenceSelectionScope>): EvidenceSelectionScope {
  return {
    characterId: "char-surv-1",
    seasonId: "season-1",
    seasonSlug: "the-war-within-season-1",
    specializationId: "spec-1",
    classSlug: "warlock",
    specSlug: "affliction",
    role: "DPS",
    refreshContractHash: "refresh-hash-surv",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: [...DUNGEONS],
    ...overrides,
  };
}

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

function acquireAllFromPlan(
  plan: EvidenceAcquisitionPlanV2,
): EvidenceCandidateAcquisitionResult[] {
  const seen = new Set<string>();
  const results: EvidenceCandidateAcquisitionResult[] = [];
  for (const slot of plan.slots) {
    for (const attempt of slot.orderedCandidates) {
      const key = `${attempt.discoveryIdentity.reportCode}:${attempt.discoveryIdentity.fightId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
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
  return results;
}

function buildSharedManifest(): CharacterSeasonEvidenceManifestV2 {
  const candidates = DUNGEONS.flatMap((dungeonSlug, i) => [
    candidate({
      reportCode: `hi-${i}`,
      fightId: 1,
      dungeonSlug,
      keyLevel: 16,
      runScore: 500,
    }),
    candidate({
      reportCode: `lo-${i}`,
      fightId: 2,
      dungeonSlug,
      keyLevel: 14,
      runScore: 420,
    }),
  ]);
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: baseScope(),
    candidates,
    plannedAt: "2026-08-01T11:00:00.000Z",
  });
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: acquireAllFromPlan(plan),
    selectedAt: "2026-08-01T12:00:00.000Z",
  });
  return manifest;
}

function baseFact(
  overrides: Partial<SurvivalFactDocumentV2> &
    Pick<SurvivalFactDocumentV2, "dungeonSlug" | "slotIndex" | "identity">,
): SurvivalFactDocumentV2 {
  return {
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: "survival",
    extractorVersion: "survival-facts-test-1.0.0",
    keyLevel: 16,
    deaths: { count: 0 },
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
    ...overrides,
  };
}

function factsForManifest(manifest: CharacterSeasonEvidenceManifestV2): SurvivalFactDocumentV2[] {
  return manifest.slots
    .filter((s) => s.state === "SELECTED")
    .filter((s) => s.identity != null)
    .map((s) =>
      baseFact({
        dungeonSlug: s.dungeonSlug,
        slotIndex: s.slotIndex,
        identity: {
          reportCode: s.identity!.reportCode,
          fightId: s.identity!.fightId,
          reportRevision: s.identity!.reportRevision,
        },
        keyLevel: s.keyLevel,
        deaths: { count: s.slotIndex }, // 0 or 1 → distinct outcomes
      }),
    );
}

describe("Survival V2 Phase 1 — outcome", () => {
  it("maps deaths to V1-parity scores", () => {
    expect(scoreSurvivalV2Outcome(0).score).toBe(SURVIVAL_V2_OUTCOME_BY_DEATHS[0]);
    expect(scoreSurvivalV2Outcome(1).score).toBe(SURVIVAL_V2_OUTCOME_BY_DEATHS[1]);
    expect(scoreSurvivalV2Outcome(2).score).toBe(SURVIVAL_V2_OUTCOME_BY_DEATHS[2]);
    expect(scoreSurvivalV2Outcome(3).score).toBe(SURVIVAL_V2_OUTCOME_BY_DEATHS.threeOrMore);
    expect(scoreSurvivalV2Outcome(9).score).toBe(0);
  });
});

describe("Survival V2 Phase 1 — defensive / toolkit", () => {
  it("normalizes activation volume by active combat via saturating curve", () => {
    const scored = scoreSurvivalV2Defensive({
      activations: {
        byCategory: { DEFENSIVE_MAJOR: 2, DEFENSIVE_MINOR: 4 },
        toolkit: [
          { category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" },
          { category: "DEFENSIVE_MINOR", state: "AVAILABLE_CONFIRMED" },
        ],
        catalogCoverage: 1,
      },
      activeCombatDurationMs: 1_800_000, // 0.5 h → 12 act/h
    });
    expect(scored.state).toBe("SCORED");
    expect(scored.score).toBeCloseTo(saturatingDefensiveRateScore(12), 6);
    expect(scored.score).toBeGreaterThan(90);
  });

  it("marks defensive N/A when toolkit not talented / unavailable", () => {
    const scored = scoreSurvivalV2Defensive({
      activations: {
        byCategory: { DEFENSIVE_MAJOR: 0 },
        toolkit: [
          { category: "DEFENSIVE_MAJOR", state: "NOT_TALENTED_CONFIRMED" },
          { category: "SELF_HEAL", state: "AVAILABLE_CONFIRMED" },
        ],
        catalogCoverage: 0.5,
      },
      activeCombatDurationMs: 1_800_000,
    });
    expect(scored.state).toBe("NOT_APPLICABLE");
    expect(scored.score).toBeNull();
  });

  it("does not assume potion availability from unused consumables", () => {
    const recovery = scoreSurvivalV2EmergencyRecovery({
      clusters: [
        {
          startMs: 0,
          endMs: 1000,
          triggerTypes: ["LOW_HP"],
          hpEvidenceQuality: "EXPLICIT",
          recoveryEligible: true,
          recoveryUseful: false,
        },
      ],
      selfHealCatalogCoverage: 0.5,
    });
    expect(recovery.state).toBe("SCORED");
    expect(recovery.score).toBe(0);
    expect(String(recovery.evidence.note)).toMatch(/never assumed available/i);
  });
});

describe("Survival V2 Phase 1 — emergency recovery / pressure clusters", () => {
  it("returns NOT_APPLICABLE when there are no danger windows (not 100)", () => {
    const recovery = scoreSurvivalV2EmergencyRecovery({ clusters: [] });
    expect(recovery.state).toBe("NOT_APPLICABLE");
    expect(recovery.score).toBeNull();
    expect(recovery.reason).toBe("no_danger_windows");
  });

  it("dedupes overlapping pressure triggers into one cluster credit", () => {
    const windows = [
      {
        startMs: 1000,
        endMs: 2000,
        triggerTypes: ["LOW_HP"],
        hpEvidenceQuality: "EXPLICIT" as const,
        recoveryEligible: true,
        recoveryUseful: true,
      },
      {
        startMs: 2500,
        endMs: 3500,
        triggerTypes: ["LARGE_HIT"],
        hpEvidenceQuality: "EXPLICIT" as const,
        recoveryEligible: true,
        recoveryUseful: false,
      },
      {
        startMs: 50_000,
        endMs: 51_000,
        triggerTypes: ["LOW_HP"],
        hpEvidenceQuality: "EXPLICIT" as const,
        recoveryEligible: true,
        recoveryUseful: true,
      },
    ];
    const clusters = mergePressureClusters(windows);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.triggerTypes.sort()).toEqual(["LARGE_HIT", "LOW_HP"]);
    expect(clusters[0]!.recoveryUseful).toBe(true);

    const recovery = scoreSurvivalV2EmergencyRecovery({ clusters });
    expect(recovery.state).toBe("SCORED");
    expect(recovery.score).toBe(100); // both clusters useful after merge OR
    // first cluster useful, second useful → 2/2
    expect(recovery.evidence).toMatchObject({ eligible: 2, useful: 2 });
  });
});

describe("Survival V2 Phase 1 — relative damage shadow", () => {
  it("excludes tanks and reports zero public contribution", () => {
    const shadow = scoreSurvivalV2RelativeDamageShadow({
      mode: "shadow",
      fact: {
        role: "TANK",
        targetDamagePerActiveSecond: 10,
        nonTankGroupMedianPerActiveSecond: 12,
        selfDamageExcluded: true,
        mandatoryDamageExcluded: true,
        mechanicExclusionCoverage: 1,
      },
    });
    expect(shadow.reliability).toBe("EXCLUDED_ROLE");
    expect(shadow.publicContribution).toBe(0);
    expect(shadow.score).toBeNull();
  });

  it("marks relative damage UNRELIABLE without exclusions / coverage", () => {
    const shadow = scoreSurvivalV2RelativeDamageShadow({
      mode: "shadow",
      fact: {
        role: "DPS",
        targetDamagePerActiveSecond: 20,
        nonTankGroupMedianPerActiveSecond: 15,
        selfDamageExcluded: false,
        mandatoryDamageExcluded: false,
        mechanicExclusionCoverage: 0.1,
      },
    });
    expect(shadow.reliability).toBe("UNRELIABLE");
    expect(shadow.publicContribution).toBe(0);
    expect(shadow.score).toBeNull();
  });
});

describe("Survival V2 Phase 1 — health / truncation", () => {
  it("flags truncated health data in run limitations", () => {
    const run = scoreSurvivalV2Run(
      baseFact({
        dungeonSlug: "ara-kara-city-of-echoes",
        slotIndex: 0,
        identity: { reportCode: "r", fightId: 1, reportRevision: 1 },
        healthEvidence: { mode: "TRUNCATED" },
        limitations: [],
      }),
      "shadow",
    );
    expect(run.limitations).toContain("health_data_truncated");
    expect(run.valid).toBe(true);
    expect(run.behavioralScore).not.toBeNull();
  });
});

describe("Survival V2 Phase 1 — two-run aggregation + shared manifest", () => {
  it("uses the same EvidenceManifestV2 as other dimensions (no Survival selection)", () => {
    const manifest = buildSharedManifest();
    expect(manifest.selectedSlotCount).toBe(4); // 2 dungeons × 2 slots
    expect(manifest.slots.every((s) => s.slotIndex === 0 || s.slotIndex === 1)).toBe(true);

    // Survival V1 selector would pick up to 3/dungeon — V2 must ignore it.
    const v1Style = selectSurvivalAnalysisRuns(
      manifest.slots.flatMap((s) => [
        {
          canonicalRunId: `${s.identity?.reportCode}:${s.identity?.fightId}`,
          dungeonSlug: s.dungeonSlug,
          keyLevel: s.keyLevel ?? 0,
          timed: s.timed,
          completedAt: "2026-07-01T12:00:00.000Z",
          durationMs: 1_800_000,
          scoreValue: s.runScore,
          hasWclSource: true,
        },
      ]),
      { allowedDungeonSlugs: [...DUNGEONS], maxRunsPerDungeon: 3 },
    );
    expect(v1Style.maxRunsPerDungeon).toBe(3);

    const factSets = factsForManifest(manifest);
    const result = computeSurvivalV2({
      manifest,
      factSets,
      relativeDamageMode: "shadow",
    });

    expect(result.algorithmVersion).toBe(SURVIVAL_V2_ALGORITHM_VERSION);
    expect(result.explanation.scoredRunCount).toBe(4);
    expect(result.explanation.notes.some((n) => /no Survival-specific run selection/i.test(n))).toBe(
      true,
    );
    expect(result.relativeDamagePublicContribution).toBeNull();
    expect(result.metrics.weightsMode).toBe("55/30/15");
    expect(result.metrics.availabilityState).toBe("AVAILABLE");
    expect(result.state).toBe("AVAILABLE");
    expect(result.score).not.toBeNull();

    // Two-run median === mean for each dungeon.
    for (const dungeon of result.dungeons) {
      expect(dungeon.runCount).toBe(2);
      const scores = dungeon.runs.map((r) => r.behavioralScore!);
      expect(dungeon.medianBehavioralScore).toBeCloseTo((scores[0]! + scores[1]!) / 2, 6);
    }
  });

  it("is deterministic across replay", () => {
    const manifest = buildSharedManifest();
    const factSets = factsForManifest(manifest);
    const a = computeSurvivalV2({ manifest, factSets, relativeDamageMode: "shadow" });
    const b = computeSurvivalV2({ manifest, factSets, relativeDamageMode: "shadow" });
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.score).toBe(b.score);
    expect(a.confidence).toBe(b.confidence);
    expect(JSON.stringify(a.observations)).toBe(JSON.stringify(b.observations));
  });
});

describe("Survival V2 Phase 1 — weights + parity notes", () => {
  it("keeps shadow/off weights at 55/30/15 and active candidate at 50/25/15/10", () => {
    expect(SURVIVAL_V2_WEIGHTS_SHADOW_OR_OFF).toEqual({
      outcome: 0.55,
      defensive: 0.3,
      recovery: 0.15,
      relativeDamage: 0,
    });
    expect(SURVIVAL_V2_WEIGHTS_WITH_RELATIVE).toEqual({
      outcome: 0.5,
      defensive: 0.25,
      recovery: 0.15,
      relativeDamage: 0.1,
    });
  });

  it("parses bounded fact documents and rejects unbounded windows", () => {
    const ok = parseSurvivalFactDocumentV2(
      baseFact({
        dungeonSlug: "ara-kara-city-of-echoes",
        slotIndex: 0,
        identity: { reportCode: "r", fightId: 1, reportRevision: 1 },
      }),
    );
    expect(ok.ok).toBe(true);

    const bad = parseSurvivalFactDocumentV2({
      schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
      extractorFamily: "survival",
      extractorVersion: "x",
      dungeonSlug: "d",
      slotIndex: 0,
      identity: { reportCode: "r", fightId: 1, reportRevision: 1 },
      deaths: { count: 0 },
      activeCombat: { durationMs: 1, fightDurationMs: 1 },
      defensiveActivations: { byCategory: {}, toolkit: [], catalogCoverage: 1 },
      dangerWindows: Array.from({ length: 300 }, (_, i) => ({
        startMs: i,
        endMs: i + 1,
        triggerTypes: [],
        hpEvidenceQuality: "MISSING",
      })),
      healthEvidence: { mode: "FULL" },
      limitations: [],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("danger_windows_unbounded");
  });
});

describe("Survival V2 Phase 1 — no provider surface", () => {
  it("module graph stays provider-free (pure scoring package entry)", () => {
    // Behavioral guard: compute never needs network — empty fact sets → UNAVAILABLE.
    const manifest = buildSharedManifest();
    const result = computeSurvivalV2({
      manifest,
      factSets: [],
      relativeDamageMode: "off",
    });
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.score).toBeNull();
  });
});

describe("Survival V2 Phase 1 — relative damage active weights", () => {
  function reliableRelativeFact(ratioTargetOverMedian: number) {
    const median = 10;
    return {
      role: "DPS" as const,
      targetDamagePerActiveSecond: median * ratioTargetOverMedian,
      nonTankGroupMedianPerActiveSecond: median,
      selfDamageExcluded: true,
      mandatoryDamageExcluded: true,
      mechanicExclusionCoverage: 1,
    };
  }

  it("keeps configured weight when active relative-damage score is reliably 0", () => {
    // score = clamp(100*(2-ratio)) → ratio=2 → score 0
    const run = scoreSurvivalV2Run(
      baseFact({
        dungeonSlug: "ara-kara-city-of-echoes",
        slotIndex: 0,
        identity: { reportCode: "r", fightId: 1, reportRevision: 1 },
        deaths: { count: 0 },
        relativeDamage: reliableRelativeFact(2),
        // Force defensive/recovery N/A so blend is outcome + relative only.
        defensiveActivations: {
          byCategory: {},
          toolkit: [{ category: "DEFENSIVE_MAJOR", state: "NOT_TALENTED_CONFIRMED" }],
          catalogCoverage: 0.5,
        },
        dangerWindows: [],
      }),
      "active",
    );
    expect(run.relativeDamageShadow.reliability).toBe("RELIABLE");
    expect(run.relativeDamageShadow.score).toBe(0);
    expect(run.weightsApplied.relativeDamage).toBeCloseTo(0.1 / (0.5 + 0.1), 6);
    expect(run.weightsApplied.outcome).toBeCloseTo(0.5 / (0.5 + 0.1), 6);
    // 100*outcomeWeight + 0*relativeWeight
    expect(run.behavioralScore).toBeCloseTo(100 * run.weightsApplied.outcome, 6);
  });

  it("applies active relative-damage weight for a positive reliable score", () => {
    // equal to median → ratio 1 → score 100
    const run = scoreSurvivalV2Run(
      baseFact({
        dungeonSlug: "ara-kara-city-of-echoes",
        slotIndex: 0,
        identity: { reportCode: "r", fightId: 1, reportRevision: 1 },
        deaths: { count: 0 },
        relativeDamage: reliableRelativeFact(1),
        defensiveActivations: {
          byCategory: {},
          toolkit: [{ category: "DEFENSIVE_MAJOR", state: "NOT_TALENTED_CONFIRMED" }],
          catalogCoverage: 0.5,
        },
        dangerWindows: [],
      }),
      "active",
    );
    expect(run.relativeDamageShadow.score).toBe(100);
    expect(run.weightsApplied.relativeDamage).toBeCloseTo(0.1 / (0.5 + 0.1), 6);
    expect(run.behavioralScore).toBeCloseTo(100, 6);
  });
});

describe("Survival V2 Phase 1 — manifest binding + availability vocabulary", () => {
  it("skips slots on fact identity mismatch", () => {
    const manifest = buildSharedManifest();
    const factSets = factsForManifest(manifest).map((f, i) =>
      i === 0
        ? {
            ...f,
            identity: {
              ...f.identity,
              reportCode: "WRONG-CODE",
            },
          }
        : f,
    );
    const result = computeSurvivalV2({
      manifest,
      factSets,
      relativeDamageMode: "shadow",
    });
    expect(
      result.explanation.notes.some((n) => n.startsWith("fact_identity_mismatch:")),
    ).toBe(true);
    expect(result.explanation.scoredRunCount).toBe(3);
    expect(result.state).toBe("PARTIAL");
  });

  it("skips selected slots with missing fact binding", () => {
    const manifest = buildSharedManifest();
    const factSets = factsForManifest(manifest).slice(1);
    const result = computeSurvivalV2({
      manifest,
      factSets,
      relativeDamageMode: "shadow",
    });
    expect(result.explanation.notes.some((n) => n.startsWith("missing_fact_set:"))).toBe(
      true,
    );
    expect(result.explanation.scoredRunCount).toBe(3);
    expect(result.state).toBe("PARTIAL");
  });

  it("uses AVAILABLE | PARTIAL | UNAVAILABLE only (never COMPUTED/SHADOW)", () => {
    const manifest = buildSharedManifest();
    const available = computeSurvivalV2({
      manifest,
      factSets: factsForManifest(manifest),
      relativeDamageMode: "shadow",
    });
    expect(available.state).toBe("AVAILABLE");

    const partial = computeSurvivalV2({
      manifest,
      factSets: factsForManifest(manifest).map((f, i) =>
        i === 0 ? { ...f, healthEvidence: { mode: "TRUNCATED" } } : f,
      ),
      relativeDamageMode: "shadow",
    });
    expect(partial.state).toBe("PARTIAL");

    const unavailable = computeSurvivalV2({
      manifest,
      factSets: [],
      relativeDamageMode: "shadow",
    });
    expect(unavailable.state).toBe("UNAVAILABLE");

    for (const result of [available, partial, unavailable]) {
      expect(["AVAILABLE", "PARTIAL", "UNAVAILABLE"]).toContain(result.state);
      expect(result.state).not.toBe("COMPUTED");
      expect(result.state).not.toBe("SHADOW");
    }
  });
});

describe("Survival V2 Phase 1 — shadow payload + calibration export", () => {
  it("builds SHADOW DimensionComputation payload with availabilityState metrics", () => {
    const manifest = buildSharedManifest();
    const result = computeSurvivalV2({
      manifest,
      factSets: factsForManifest(manifest),
      relativeDamageMode: "shadow",
    });
    const payload = toSurvivalV2ShadowDimensionPayload({
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestId: "manifest-surv-1",
      scoreModelId: "model-surv-1",
      result,
      computedAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(payload.dimension).toBe("SURVIVAL");
    expect(payload.state).toBe("SHADOW");
    expect(payload.algorithmVersion).toBe(SURVIVAL_V2_ALGORITHM_VERSION);
    expect(payload.inputFingerprint).toBe(result.inputFingerprint);
    expect(payload.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.score).toBe(result.score);
    expect(payload.confidence).toBe(result.confidence);
    expect(payload.metrics.publicationBlocked).toBe(true);
    expect(payload.metrics.availabilityState).toBe("AVAILABLE");
    expect(payload.explanation).toEqual(result.explanation);
  });

  it("exports deterministic calibration bundles", () => {
    const manifest = buildSharedManifest();
    const input = {
      manifest,
      factSets: factsForManifest(manifest),
      relativeDamageMode: "shadow" as const,
      scoreModelId: "model-surv-1",
    };
    const a = exportSurvivalV2Calibration(input);
    const b = exportSurvivalV2Calibration(input);
    expect(a.schemaVersion).toBe(SURVIVAL_V2_CALIBRATION_SCHEMA_VERSION);
    expect(a.modelConfig).toEqual(SURVIVAL_V2_MODEL_CONFIG);
    expect(a.contributors.length).toBeGreaterThan(0);
    expect(a.result.inputFingerprint).toBe(b.result.inputFingerprint);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const replay = computeSurvivalV2(a.input);
    expect(replay.score).toBe(a.result.score);
    expect(replay.confidence).toBe(a.result.confidence);
    expect(replay.inputFingerprint).toBe(a.result.inputFingerprint);
  });

  it("does not apply relativeUnreliable confidence penalty when mode is shadow/off", () => {
    const manifest = buildSharedManifest();
    const factSets = factsForManifest(manifest);
    const shadow = computeSurvivalV2({
      manifest,
      factSets,
      relativeDamageMode: "shadow",
    });
    const off = computeSurvivalV2({
      manifest,
      factSets,
      relativeDamageMode: "off",
    });
    // All relativeDamage facts are null → INSUFFICIENT; must not crush confidence.
    expect(shadow.confidence).toBeGreaterThan(0.8);
    expect(off.confidence).toBeGreaterThan(0.8);
    expect(shadow.confidence).toBeCloseTo(off.confidence, 10);
  });
});
