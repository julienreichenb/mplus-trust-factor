import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_V3_ALGORITHM_VERSION,
  EXPERIENCE_V3_COMPONENT_WEIGHTS,
  EXPERIENCE_V3_MODEL_CONFIG,
  computeExperienceV3,
  computeExperienceV3InputFingerprint,
  createHistoricalRankPolicyV3,
  createPreviousSeasonPolicyV3,
  exportExperienceV3Calibration,
  normalizePreviousSeasonScore,
  toExperienceV3ShadowDimensionPayload,
  type ExperienceV3ComputeInput,
  type ExperienceV3CurrentExposureFact,
  type ExperienceV3EliteHistoryFact,
  type ExperienceV3HistoricalRankFact,
  type ExperienceV3PreviousSeasonFact,
} from "./index.js";

const OBSERVED_AT = "2026-08-01T12:00:00.000Z";

function manifest() {
  return {
    contentHash: "manifest-hash-abc",
    schemaVersion: "evidence-manifest-v2",
    selectorVersion: "selector-v2.1",
    characterId: "char-1",
    seasonId: "season-uuid-current",
    seasonSlug: "season-tww-3",
    highKeyPolicyId: "high-key-v1",
    evidenceCutoffAt: OBSERVED_AT,
  };
}

function policy() {
  return createPreviousSeasonPolicyV3({
    seasonId: "season-uuid-prev",
    seasonSlug: "season-tww-2",
    region: "eu",
    k50: 2000,
    k90: 2800,
    k99: 3200,
    confidence: 0.8,
  });
}

function rankPolicy() {
  return createHistoricalRankPolicyV3({ confidence: 0.7 });
}

function richExposure(): ExperienceV3CurrentExposureFact {
  const runs = [
    { dungeonSlug: " ara-kara", keyLevel: 10, completedAt: "2026-07-20T10:00:00.000Z" },
    { dungeonSlug: "city-of-threads", keyLevel: 8, completedAt: "2026-07-21T10:00:00.000Z" },
    { dungeonSlug: "stonevault", keyLevel: 12, completedAt: "2026-07-22T10:00:00.000Z" },
    { dungeonSlug: "dawnbreaker", keyLevel: 6, completedAt: "2026-07-23T10:00:00.000Z" },
    { dungeonSlug: "siege", keyLevel: 4, completedAt: "2026-07-24T10:00:00.000Z" },
    { dungeonSlug: "necrotic-wake", keyLevel: 15, completedAt: "2026-07-25T10:00:00.000Z" },
    { dungeonSlug: "mists", keyLevel: 11, completedAt: "2026-07-26T10:00:00.000Z" },
    { dungeonSlug: "sv", keyLevel: 9, completedAt: "2026-07-27T10:00:00.000Z" },
  ];
  return {
    expectedDungeonCount: 8,
    selectedRuns: runs,
    seasonRuns: runs,
    priorSeasonCount: 2,
    priorSeasonSourceDepth: 3,
    provenance: "HAS_HISTORY",
    observedAt: OBSERVED_AT,
  };
}

function emptyExposure(
  provenance: ExperienceV3CurrentExposureFact["provenance"] = "CONFIRMED_ABSENCE",
): ExperienceV3CurrentExposureFact {
  return {
    expectedDungeonCount: 8,
    selectedRuns: [],
    seasonRuns: [],
    priorSeasonCount: 0,
    priorSeasonSourceDepth: 1,
    provenance,
    observedAt: OBSERVED_AT,
  };
}

function previousHasValue(score: number): ExperienceV3PreviousSeasonFact {
  return {
    evidenceState: "HAS_VALUE",
    score,
    seasonId: "season-uuid-prev",
    seasonSlug: "season-tww-2",
    source: "BLIZZARD",
    sourceConfidence: 0.9,
    fetchedAt: OBSERVED_AT,
  };
}

function previousConfirmedNone(): ExperienceV3PreviousSeasonFact {
  return {
    evidenceState: "CONFIRMED_NO_ACTIVITY",
    score: 0,
    seasonId: "season-uuid-prev",
    seasonSlug: "season-tww-2",
    source: "BLIZZARD",
    sourceConfidence: 0.95,
    fetchedAt: OBSERVED_AT,
  };
}

function previousProviderFailure(): ExperienceV3PreviousSeasonFact {
  return {
    evidenceState: "PROVIDER_FAILURE",
    score: null,
    seasonId: null,
    seasonSlug: null,
    source: "UNKNOWN",
    sourceConfidence: 0,
    fetchedAt: null,
  };
}

function eliteNone(): ExperienceV3EliteHistoryFact {
  return { evidenceState: "CONFIRMED_NO_ACTIVITY", achievements: [] };
}

function eliteConfirmedTop01(): ExperienceV3EliteHistoryFact {
  return {
    evidenceState: "HAS_VALUE",
    achievements: [
      {
        achievementId: 20_986, // TWW S2 Keystone Hero 0.1%
        visibility: "CHARACTER_CONFIRMED",
        seasonsAgo: 1,
        observedAt: OBSERVED_AT,
      },
    ],
  };
}

function eliteMultipleTitles(): ExperienceV3EliteHistoryFact {
  return {
    evidenceState: "HAS_VALUE",
    achievements: [
      {
        achievementId: 20_986,
        visibility: "CHARACTER_CONFIRMED",
        seasonsAgo: 1,
        observedAt: OBSERVED_AT,
      },
      {
        achievementId: 20_526,
        visibility: "CHARACTER_CONFIRMED",
        seasonsAgo: 2,
        observedAt: OBSERVED_AT,
      },
      {
        achievementId: 20_525,
        visibility: "CHARACTER_CONFIRMED",
        seasonsAgo: 2,
        observedAt: OBSERVED_AT,
      },
    ],
  };
}

function eliteAccountVisibleAmbiguity(): ExperienceV3EliteHistoryFact {
  return {
    evidenceState: "PARTIAL",
    achievements: [
      {
        achievementId: 20_986,
        visibility: "ACCOUNT_VISIBLE",
        seasonsAgo: 1,
        observedAt: OBSERVED_AT,
      },
    ],
  };
}

function historicalRankTop1(): ExperienceV3HistoricalRankFact {
  return {
    evidenceState: "HAS_VALUE",
    source: "LOCAL_LEADERBOARD",
    seasonId: "season-uuid-prev",
    seasonSlug: "season-tww-2",
    region: "eu",
    classSlug: "monk",
    specSlug: "windwalker",
    role: "DPS",
    rank: 50,
    population: 10_000,
    percentile: 0.5,
    top10ClassSpecRegion: false,
    fetchedAt: OBSERVED_AT,
    sourceConfidence: 0.85,
  };
}

function baseInput(
  overrides: Partial<ExperienceV3ComputeInput> = {},
): ExperienceV3ComputeInput {
  return {
    manifest: manifest(),
    currentExposure: richExposure(),
    previousSeason: previousHasValue(2800),
    previousSeasonPolicy: policy(),
    eliteHistory: eliteNone(),
    historicalRank: null,
    historicalRankPolicy: rankPolicy(),
    computedAt: OBSERVED_AT,
    ...overrides,
  };
}

describe("Experience V3 Phase 1", () => {
  it("component weights match normative 45/30/15/10", () => {
    expect(EXPERIENCE_V3_COMPONENT_WEIGHTS.currentExposure).toBe(0.45);
    expect(EXPERIENCE_V3_COMPONENT_WEIGHTS.previousSeasonStrength).toBe(0.3);
    expect(EXPERIENCE_V3_COMPONENT_WEIGHTS.eliteHistory).toBe(0.15);
    expect(EXPERIENCE_V3_COMPONENT_WEIGHTS.historicalRank).toBe(0.1);
    const sum =
      EXPERIENCE_V3_COMPONENT_WEIGHTS.currentExposure +
      EXPERIENCE_V3_COMPONENT_WEIGHTS.previousSeasonStrength +
      EXPERIENCE_V3_COMPONENT_WEIGHTS.eliteHistory +
      EXPERIENCE_V3_COMPONENT_WEIGHTS.historicalRank;
    expect(sum).toBeCloseTo(1, 10);
  });

  it("previous score present contributes previous-season strength", () => {
    const result = computeExperienceV3(baseInput());
    const prev = result.components.find((c) => c.key === "previousSeasonStrength")!;
    expect(prev.available).toBe(true);
    expect(prev.score).toBeCloseTo(78, 0); // K90 → atK90
    expect(result.score).not.toBeNull();
    expect(result.explanation.previousSeason.rawScore).toBe(2800);
    expect(result.explanation.previousSeason.source).toBe("BLIZZARD");
  });

  it("confirmed no activity yields low previous-season score, not zero and not failure", () => {
    const result = computeExperienceV3(
      baseInput({ previousSeason: previousConfirmedNone() }),
    );
    const prev = result.components.find((c) => c.key === "previousSeasonStrength")!;
    expect(prev.available).toBe(true);
    expect(prev.score).toBe(EXPERIENCE_V3_MODEL_CONFIG.previousSeason.confirmedNoActivityScore);
    expect(prev.score).toBeGreaterThan(0);
    expect(prev.evidenceState).toBe("CONFIRMED_NO_ACTIVITY");
    expect(result.score).not.toBeNull();
  });

  it("provider failure excludes previous-season (not treated as no activity)", () => {
    const withFailure = computeExperienceV3(
      baseInput({ previousSeason: previousProviderFailure() }),
    );
    const withNone = computeExperienceV3(
      baseInput({ previousSeason: previousConfirmedNone() }),
    );
    const failComp = withFailure.components.find(
      (c) => c.key === "previousSeasonStrength",
    )!;
    const noneComp = withNone.components.find(
      (c) => c.key === "previousSeasonStrength",
    )!;
    expect(failComp.available).toBe(false);
    expect(failComp.score).toBeNull();
    expect(noneComp.available).toBe(true);
    expect(withFailure.metrics.renormalized).toBe(true);
    expect(failComp.detail.reason).toBe(
      "provider_failure_not_equivalent_to_no_activity",
    );
    // Renormalized score should differ from zero-filling previous season.
    expect(withFailure.score).not.toBeNull();
    expect(withFailure.score).not.toBeCloseTo(withNone.score!, 5);
  });

  it("account-visible achievement ambiguity is discounted and explained", () => {
    const result = computeExperienceV3(
      baseInput({ eliteHistory: eliteAccountVisibleAmbiguity() }),
    );
    const elite = result.components.find((c) => c.key === "eliteHistory")!;
    expect(elite.available).toBe(true);
    expect(elite.score).toBeGreaterThan(0);
    expect(elite.score!).toBeLessThan(
      EXPERIENCE_V3_MODEL_CONFIG.eliteHistory.singleTop01Score,
    );
    expect(result.explanation.eliteHistory.accountVisibleOnlyCount).toBe(1);
    expect(result.explanation.eliteHistory.ambiguityNotes.length).toBeGreaterThan(0);
    expect(result.explanation.confidenceLimits).toContain(
      "account_visible_achievement_ambiguity",
    );
    expect(result.explanation.eliteHistory.confirmedTitleCount).toBe(0);
  });

  it("multiple titles use diminishing returns and approach but do not explode past cap", () => {
    const single = computeExperienceV3(
      baseInput({ eliteHistory: eliteConfirmedTop01() }),
    );
    const multi = computeExperienceV3(
      baseInput({ eliteHistory: eliteMultipleTitles() }),
    );
    const singleElite = single.components.find((c) => c.key === "eliteHistory")!;
    const multiElite = multi.components.find((c) => c.key === "eliteHistory")!;
    expect(singleElite.score).toBeGreaterThan(80);
    expect(multiElite.score!).toBeGreaterThan(singleElite.score!);
    expect(multiElite.score!).toBeLessThanOrEqual(
      EXPERIENCE_V3_MODEL_CONFIG.eliteHistory.scoreCap,
    );
    // Diminishing: third title adds less than a full second title jump.
    const gain = multiElite.score! - singleElite.score!;
    expect(gain).toBeLessThan(25);
    expect(multi.explanation.eliteHistory.confirmedTitleCount).toBe(3);
  });

  it("historical rank is optional and renormalizes when absent", () => {
    const without = computeExperienceV3(baseInput({ historicalRank: null }));
    const withRank = computeExperienceV3(
      baseInput({ historicalRank: historicalRankTop1() }),
    );
    const absent = without.components.find((c) => c.key === "historicalRank")!;
    const present = withRank.components.find((c) => c.key === "historicalRank")!;
    expect(absent.available).toBe(false);
    expect(absent.effectiveWeight).toBe(0);
    expect(without.metrics.renormalized).toBe(true);
    expect(present.available).toBe(true);
    expect(present.score).toBe(
      EXPERIENCE_V3_MODEL_CONFIG.historicalRank.top1PercentScore,
    );
    // Effective weights of remaining components sum to 1 when rank absent.
    const weightSum = without.components
      .filter((c) => c.available)
      .reduce((s, c) => s + c.effectiveWeight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
  });

  it("missing optional components renormalize correctly (prev failure + no rank)", () => {
    const result = computeExperienceV3(
      baseInput({
        previousSeason: previousProviderFailure(),
        historicalRank: null,
        eliteHistory: eliteConfirmedTop01(),
      }),
    );
    const available = result.components.filter((c) => c.available);
    expect(available.map((c) => c.key).sort()).toEqual(
      ["currentExposure", "eliteHistory"].sort(),
    );
    const weightSum = available.reduce((s, c) => s + c.effectiveWeight, 0);
    expect(weightSum).toBeCloseTo(1, 10);
    // Relative share: exposure 0.45 / (0.45+0.15) = 0.75
    const exposure = available.find((c) => c.key === "currentExposure")!;
    expect(exposure.effectiveWeight).toBeCloseTo(0.75, 10);
    expect(result.metrics.renormalized).toBe(true);
  });

  it("has no WCL dependency and no current Performance leakage flags", () => {
    const result = computeExperienceV3(baseInput());
    expect(result.explanation.noWclDependency).toBe(true);
    expect(result.explanation.noCurrentPerformanceLeakage).toBe(true);
    expect(result.explanation.noPublicAccountLinkInference).toBe(true);
    expect(result.metrics.noWclDependency).toBe(true);
    // Input fingerprint payload must not reference parse/DPS fields — smoke via stable hash.
    const fp1 = computeExperienceV3InputFingerprint(baseInput());
    const fp2 = computeExperienceV3InputFingerprint(baseInput());
    expect(fp1).toBe(fp2);
    expect(result.inputFingerprint).toBe(fp1);
  });

  it("produces deterministic explanation across identical inputs", () => {
    const a = computeExperienceV3(
      baseInput({
        eliteHistory: eliteMultipleTitles(),
        historicalRank: historicalRankTop1(),
      }),
    );
    const b = computeExperienceV3(
      baseInput({
        eliteHistory: eliteMultipleTitles(),
        historicalRank: historicalRankTop1(),
      }),
    );
    expect(a.score).toBe(b.score);
    expect(a.confidence).toBe(b.confidence);
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(JSON.stringify(a.explanation)).toBe(JSON.stringify(b.explanation));
    expect(a.algorithmVersion).toBe(EXPERIENCE_V3_ALGORITHM_VERSION);
  });

  it("provider failure on current exposure yields UNAVAILABLE with confidence 0", () => {
    const result = computeExperienceV3(
      baseInput({ currentExposure: emptyExposure("PROVIDER_FAILURE") }),
    );
    expect(result.score).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("phase 2 account boost contract stays disabled", () => {
    const result = computeExperienceV3(baseInput());
    expect(result.explanation.accountLinkedBoost.enabled).toBe(false);
    expect(result.explanation.phase2State).toBe("INACTIVE");
    expect(result.metrics.phase2AccountBoostEnabled).toBe(false);
    expect(EXPERIENCE_V3_MODEL_CONFIG.phase2AccountBoost.enabled).toBe(false);
  });

  it("normalizes previous-season scores monotonically across K thresholds", () => {
    const p = policy();
    const cfg = EXPERIENCE_V3_MODEL_CONFIG;
    const s0 = normalizePreviousSeasonScore(0, p, cfg);
    const sK50 = normalizePreviousSeasonScore(p.k50, p, cfg);
    const sK90 = normalizePreviousSeasonScore(p.k90, p, cfg);
    const sK99 = normalizePreviousSeasonScore(p.k99, p, cfg);
    const sHigh = normalizePreviousSeasonScore(p.k99 * 1.1, p, cfg);
    expect(s0).toBeLessThan(sK50);
    expect(sK50).toBeLessThan(sK90);
    expect(sK90).toBeLessThan(sK99);
    expect(sK99).toBeLessThanOrEqual(sHigh);
    expect(sHigh).toBeLessThanOrEqual(100);
  });

  it("shadow dimension payload is EXPERIENCE / SHADOW with publication blocked metrics", () => {
    const result = computeExperienceV3(baseInput());
    const payload = toExperienceV3ShadowDimensionPayload({
      characterId: "char-1",
      seasonId: "season-uuid-current",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      result,
      computedAt: new Date(OBSERVED_AT),
    });
    expect(payload.dimension).toBe("EXPERIENCE");
    expect(payload.state).toBe("SHADOW");
    expect(payload.algorithmVersion).toBe(EXPERIENCE_V3_ALGORITHM_VERSION);
    expect(payload.metrics.publicationBlocked).toBe(true);
    expect(payload.score).toBe(result.score);
  });

  it("calibration export is replayable and provider-free", () => {
    const input = baseInput({ historicalRank: historicalRankTop1() });
    const result = computeExperienceV3(input);
    const exported = exportExperienceV3Calibration(input, result);
    expect(exported.schemaVersion).toBe("experience-v3");
    expect(exported.result.inputFingerprint).toBe(result.inputFingerprint);
    expect(exported.contributors.length).toBeGreaterThan(0);
    // Recompute from exported input matches.
    const replay = computeExperienceV3(exported.input);
    expect(replay.score).toBe(exported.result.score);
    expect(replay.inputFingerprint).toBe(exported.result.inputFingerprint);
  });

  it("score and confidence stay within bounds for a full profile", () => {
    const result = computeExperienceV3(
      baseInput({
        previousSeason: previousHasValue(3200),
        eliteHistory: eliteMultipleTitles(),
        historicalRank: {
          ...historicalRankTop1(),
          top10ClassSpecRegion: true,
          percentile: 0.05,
        },
      }),
    );
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.state).toBe("AVAILABLE");
  });
});
