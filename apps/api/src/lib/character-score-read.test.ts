import { describe, expect, it } from "vitest";
import {
  mapCharacterScoreToSnapshotDto,
  resolveProfilePerformanceSummary,
} from "./character-score-read.js";

describe("mapCharacterScoreToSnapshotDto partial composite", () => {
  const baseRow = {
    id: "score-1",
    characterId: "char-1",
    seasonId: "season-1",
    scoringVersion: "scoring-v1",
    performance: 83.16,
    utility: 61.88,
    survival: 74.27,
    experience: null as number | null,
    composite: null as number | null,
    confidence: null as number | null,
    tier: null as string | null,
    calculatedAt: new Date("2026-01-01T00:00:00.000Z"),
    dimensionDetails: {},
    season: { slug: "season-tww-3" },
  };

  it("P+U+S available, E missing → composite + letter grade (not U)", () => {
    const dto = mapCharacterScoreToSnapshotDto(baseRow, {
      modelKey: "default",
      modelVersion: 6,
      dimensionWeights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experience: 0.1,
      },
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      minConfidenceForGrade: 0.35,
    });

    expect(dto.overallScore).toBeGreaterThan(0);
    expect(dto.grade).not.toBe("U");
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.score).toBeNull();
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.state).toBe("UNAVAILABLE");
    expect(dto.explanation).toMatchObject({
      missingDimensionsExcluded: expect.stringContaining("renormalized"),
    });
  });

  it("prefers persisted composite/tier/confidence", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        composite: 77.5,
        confidence: 0.72,
        tier: "B",
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.overallScore).toBe(77.5);
    expect(dto.grade).toBe("B");
    expect(dto.confidence).toBe(0.72);
  });

  it("uses contextual final score as overallScore and keeps raw composite in explanation", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        composite: 73.421,
        contextualScore: 80.763,
        dimensionDetails: {
          scoreContext: {
            schemaVersion: "score-context-v1",
            seasonId: "season-1",
            contextRevisionId: "rev-1",
            contextRevisionKey: "rev-1",
            contextRevisionVersion: 1,
            distributionSnapshotId: "dist-1",
            rawScoreBeforeContext: 73.421,
            key: {
              status: "AVAILABLE",
              canonicalRuns: [],
              medianKeyLevel: 19.5,
              appliedAnchorPercentileBps: 9000,
              appliedAnchorKeyThreshold: 20,
              nextAnchorPercentileBps: null,
              nextAnchorKeyThreshold: null,
              factor: 1.1,
              distributionSnapshotId: "dist-1",
              distributionSource: "MANUAL_IMPORT",
              distributionVersion: "v1",
              distributionCollectedAt: "2026-01-01T00:00:00.000Z",
              reason: null,
            },
            meta: {
              status: "AVAILABLE",
              classSlug: "mage",
              specSlug: "fire",
              specSource: "WCL_ACTIVE_DUNGEONS",
              tier: 5,
              factor: 1,
              reason: null,
            },
            combinedFactor: 1.1,
            preClampAdjustedScore: 80.7631,
            wasClamped: false,
            finalScore: 80.763,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.overallScore).toBe(80.763);
    expect(dto.scoreContext?.rawScoreBeforeContext).toBe(73.421);
    expect(dto.explanation).toMatchObject({ composite: 73.421 });
  });

  it("does not keep stale tier=U when P/U/S composite is calculable", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        composite: 73.68,
        confidence: 0.18,
        tier: "U",
      },
      {
        modelKey: "default",
        modelVersion: 6,
        dimensionWeights: {
          performance: 0.35,
          survival: 0.3,
          utility: 0.25,
          experience: 0.1,
        },
        gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      },
    );
    expect(dto.overallScore).toBeCloseTo(73.68, 2);
    expect(dto.grade).not.toBe("U");
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")?.score).toBeNull();
  });

  it("zero available dimensions → U", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        performance: null,
        utility: null,
        survival: null,
        experience: null,
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.grade).toBe("U");
    expect(dto.overallScore).toBe(0);
  });

  it("Experience unavailable is not Experience = 0", () => {
    const unavailable = mapCharacterScoreToSnapshotDto(baseRow, {
      dimensionWeights: {
        performance: 0.35,
        survival: 0.3,
        utility: 0.25,
        experience: 0.1,
      },
      gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
    });
    const asZero = mapCharacterScoreToSnapshotDto(
      { ...baseRow, experience: 0 },
      {
        dimensionWeights: {
          performance: 0.35,
          survival: 0.3,
          utility: 0.25,
          experience: 0.1,
        },
        gradeThresholds: { S: 90, A: 80, B: 65, C: 50 },
      },
    );
    expect(unavailable.overallScore).toBeGreaterThan(asZero.overallScore);
    expect(asZero.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      reason: null,
    });
  });

  it("does not reuse overall confidence for every dimension", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        confidence: 0.26,
        dimensionDetails: {
          performance: { confidence: 0.41, limitations: ["profile_only"] },
          survival: {
            confidence: 0.52,
            explanation: { limitations: ["MAX_HP_CONTEXT_UNAVAILABLE"] },
          },
          utility: {
            confidence: 0.33,
            explanation: { confidenceReasons: ["no_hostile_casts_observed"] },
          },
          experience: {
            score: null,
            available: false,
            reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.confidence).toBe(0.26);
    expect(dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.confidence).toBe(0.41);
    expect(dto.dimensions.find((d) => d.dimension === "SURVIVAL")?.confidence).toBe(0.52);
    expect(dto.dimensions.find((d) => d.dimension === "UTILITY")?.confidence).toBe(0.33);
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: null,
      state: "UNAVAILABLE",
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
    });
    expect(
      (dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
        limitations?: string[];
        negative?: unknown[];
      }).limitations,
    ).toEqual(["profile_only"]);
    expect(
      (dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
        negative?: unknown[];
      }).negative,
    ).toEqual([]);
  });

  it("Experience 0 from dimensionDetails is available when column is set", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        experience: 0,
        dimensionDetails: {
          experience: {
            score: 0,
            available: true,
            reason: null,
            previousStandingScore: 0,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    expect(dto.dimensions.find((d) => d.dimension === "EXPERIENCE")).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      reason: null,
    });
  });

  it("reads Experience confidence from dimensionDetails (not hard-coded 1)", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        experience: 0,
        confidence: 0.5,
        dimensionDetails: {
          performance: { confidence: 1 },
          survival: { confidence: 1 },
          utility: { confidence: 1 },
          experience: {
            score: 0,
            available: true,
            confidence: 0.87,
            confidenceCauses: ["previous_evidence_unavailable"],
            reason: null,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );
    const experience = dto.dimensions.find((d) => d.dimension === "EXPERIENCE");
    expect(experience).toMatchObject({
      score: 0,
      state: "AVAILABLE",
      confidence: 0.87,
      reason: null,
    });
    expect(
      (experience?.contributors as { limitations?: string[]; negative?: unknown[] })
        .limitations,
    ).toEqual(["previous_evidence_unavailable"]);
    expect(
      (experience?.contributors as { negative?: unknown[] }).negative,
    ).toEqual([]);
  });
});

describe("mapCharacterScoreToSnapshotDto Score Explainability V1", () => {
  const baseRow = {
    id: "score-1",
    characterId: "char-1",
    seasonId: "season-1",
    scoringVersion: "scoring-v1",
    performance: 71,
    utility: 56,
    survival: 72.5,
    experience: 0 as number | null,
    composite: 68,
    confidence: 0.7,
    tier: "B" as string | null,
    calculatedAt: new Date("2026-01-01T00:00:00.000Z"),
    dimensionDetails: {} as unknown,
    season: { slug: "season-tww-3" },
  };

  it("projects persisted canonical explainability via shared public projector", async () => {
    const { buildScoreExplainabilityV1, projectScoreExplainabilityPublic } =
      await import("@mplus/scoring");

    const canonical = buildScoreExplainabilityV1({
      performance: null,
      survival: null,
      utility: null,
      experience: {
        score: 0,
        available: true,
        previousStandingScore: 0,
        classRankFloor: null,
        classRankFloorApplied: false,
        eliteFloorApplied: false,
        confirmedEliteTitleCount: 0,
        confidence: 1,
        confidenceCauses: [],
        reason: null,
      },
      composite: null,
    });

    // Simulate CharacterScore JSON persistence (serialize → DB → parse).
    const persistedDetails = JSON.parse(
      JSON.stringify({
        explainability: canonical,
        performance: { confidence: 0.72, limitations: ["incomplete_dungeon_coverage"] },
        survival: { confidence: 0.65 },
        utility: { confidence: 0.55 },
        experience: {
          score: 0,
          available: true,
          confidence: 1,
          confidenceCauses: [],
          reason: null,
        },
      }),
    );

    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        performance: null,
        utility: null,
        survival: null,
        experience: 0,
        dimensionDetails: persistedDetails,
      },
      { modelKey: "default", modelVersion: 6 },
    );

    const expected = projectScoreExplainabilityPublic(canonical);
    for (const key of [
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
    ] as const) {
      const dim = dto.dimensions.find((d) => d.dimension === key);
      expect(dim?.explainability).toEqual(expected.dimensions[key]);
    }

    const experience = dto.dimensions.find((d) => d.dimension === "EXPERIENCE");
    expect(experience?.explainability?.scoreDrivers.map((d) => d.code)).toContain(
      "experience.confirmed_no_activity",
    );
    expect(
      experience?.explainability?.scoreDrivers.find(
        (d) => d.code === "experience.confirmed_no_activity",
      )?.direction,
    ).toBe("NEUTRAL");
    expect(experience?.explainability?.confidenceReasons).toEqual([]);
    expect(
      (experience?.contributors as { negative?: Array<{ metricKey: string }> }).negative?.map(
        (n) => n.metricKey,
      ),
    ).not.toContain("experience.confirmed_no_activity");
    expect(
      (dto.explanation as { explainabilityFingerprint?: string })
        .explainabilityFingerprint,
    ).toBe(canonical.fingerprint);
  });

  it("soft-fails malformed explainability without breaking profile reads", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        dimensionDetails: {
          explainability: { schemaVersion: "not-a-real-schema", bogus: true },
          performance: { confidence: 0.9, limitations: ["profile_only"] },
          experience: {
            score: 0,
            available: true,
            confidence: 1,
            reason: null,
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );

    expect(dto.overallScore).toBe(68);
    expect(dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.score).toBe(71);
    expect(
      dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.explainability,
    ).toBeUndefined();
    expect(
      (
        dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
          negative?: unknown[];
          limitations?: string[];
        }
      ).negative,
    ).toEqual([]);
    expect(
      (
        dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.contributors as {
          limitations?: string[];
        }
      ).limitations,
    ).toEqual(["profile_only"]);
  });

  it("never maps confidence limitations into negative contributors on legacy rows", () => {
    const dto = mapCharacterScoreToSnapshotDto(
      {
        ...baseRow,
        experience: null,
        dimensionDetails: {
          performance: {
            confidence: 0.4,
            limitations: ["incomplete_dungeon_coverage", "incomplete_cooldown_run_coverage"],
          },
          survival: {
            confidence: 0.5,
            explanation: { limitations: ["max_hp_unavailable"] },
          },
          utility: {
            confidence: 0.3,
            explanation: { confidenceReasons: ["tiny_run_sample"] },
          },
        },
      },
      { modelKey: "default", modelVersion: 6 },
    );

    for (const key of ["PERFORMANCE", "SURVIVAL", "UTILITY"] as const) {
      const dim = dto.dimensions.find((d) => d.dimension === key);
      expect(
        (dim?.contributors as { negative?: unknown[] }).negative,
      ).toEqual([]);
      expect(dim?.explainability).toBeUndefined();
    }
  });
});

describe("mapCharacterScoreToSnapshotDto role-aware performanceSummary", () => {
  it("projects roleAware performanceSummary from dimensionDetails", async () => {
    const {
      CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      assertPersistedCharacterPerformanceAggregateV2,
    } = await import("@mplus/contracts");
    const {
      computeRoleAwarePerformance,
      extractPersistedRoleAwarePerformanceEvidence,
    } = await import("@mplus/scoring");

    const active = ["algethar-academy"];
    const roleAware = computeRoleAwarePerformance({
      role: "DPS",
      specSlug: "demonology",
      activeDungeonSlugs: active,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 4,
        observedSpecs: ["Demonology"],
        specBinding: "EXACT_MATCH",
        perDungeon: [
          {
            dungeonSlug: "algethar-academy",
            bestParsePercentile: 80,
            medianParsePercentile: 70,
          },
        ],
      },
      healing: null,
      cooldownRuns: [],
    });
    const compact = assertPersistedCharacterPerformanceAggregateV2({
      state: "OK",
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      role: "DPS",
      targetSpecSlug: "demonology",
      zoneId: 47,
      partition: 1,
      damage: {
        metric: "points_and_damage",
        dungeonAggregates: [
          {
            dungeonSlug: "algethar-academy",
            dungeonName: "Algeth'ar Academy",
            encounterId: 1,
            bestParsePercentile: 80,
            medianParsePercentile: 70,
            loggedRunCount: 4,
            specialization: "Demonology",
            keystoneLevel: 12,
            bestDps: 1000,
          },
        ],
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        totalLoggedRuns: 4,
        totalMythicPlusScore: 1000,
        partition: 1,
        zoneId: 47,
        observedSpecs: ["Demonology"],
        specBinding: "EXACT_MATCH",
        wclBestPerformanceAverage: 80,
        wclMedianPerformanceAverage: 70,
      },
      healing: null,
      diagnostics: {
        adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
        metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
        provenance: "AGGREGATE_ZONE_RANKINGS",
        role: "DPS",
        targetSpecSlug: "demonology",
        damageDungeonCount: 1,
        healingDungeonCount: 0,
        expectedDungeonCount: 1,
        specBindingPolicy: "test",
        limitations: [],
      },
    });

    const dto = mapCharacterScoreToSnapshotDto(
      {
        id: "score-1",
        characterId: "char-1",
        seasonId: "season-1",
        scoringVersion: "scoring-v1",
        performance: roleAware.score,
        utility: null,
        survival: null,
        experience: null,
        composite: roleAware.score,
        confidence: roleAware.confidence,
        calculatedAt: new Date("2026-01-01T00:00:00.000Z"),
        dimensionDetails: {
          performance: {
            confidence: roleAware.confidence,
            roleAware: extractPersistedRoleAwarePerformanceEvidence({
              roleAware,
              activeDungeonSlugs: active,
            }),
          },
          performanceAggregate: { compact },
        },
        season: { slug: "season-tww-3" },
      },
      { modelKey: "default", modelVersion: 6 },
    );

    const summary = (dto.explanation as { performanceSummary?: { roleAware?: { role: string } } })
      .performanceSummary;
    expect(summary?.roleAware?.role).toBe("DPS");
  });

  it("Aspha: public performanceSummary.roleAware is HEALER with both channels", async () => {
    const {
      CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      assertPersistedCharacterPerformanceAggregateV2,
    } = await import("@mplus/contracts");
    const {
      computeRoleAwarePerformance,
      extractPersistedRoleAwarePerformanceEvidence,
    } = await import("@mplus/scoring");

    const active = [
      "ara-kara",
      "city-of-threads",
      "the-dawnbreaker",
      "the-stonevault",
      "mists-of-tirna-scithe",
      "the-necrotic-wake",
      "siege-of-boralus",
      "grim-batol",
    ];
    const perDungeon = active.map((dungeonSlug) => ({
      dungeonSlug,
      bestParsePercentile: 80,
      medianParsePercentile: 70,
    }));
    const roleAware = computeRoleAwarePerformance({
      role: "HEALER",
      specSlug: "restoration",
      activeDungeonSlugs: active,
      damage: {
        kind: "damage",
        metric: "points_and_damage",
        bestPercentileAverage: 60,
        medianPercentileAverage: 50,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 32,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon: perDungeon.map((d) => ({
          ...d,
          bestParsePercentile: 60,
          medianParsePercentile: 50,
        })),
      },
      healing: {
        kind: "healing",
        metric: "points_and_healing",
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        partition: 1,
        zoneId: 47,
        totalLoggedRuns: 32,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        perDungeon,
      },
      cooldownRuns: [],
    });
    const compact = assertPersistedCharacterPerformanceAggregateV2({
      state: "OK",
      adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
      metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
      role: "HEALER",
      targetSpecSlug: "restoration",
      zoneId: 47,
      partition: 1,
      damage: {
        metric: "points_and_damage",
        dungeonAggregates: active.map((slug) => ({
          dungeonSlug: slug,
          dungeonName: slug,
          encounterId: 1,
          bestParsePercentile: 60,
          medianParsePercentile: 50,
          loggedRunCount: 4,
          specialization: "Restoration",
          keystoneLevel: 12,
          bestDps: 1000,
        })),
        bestPercentileAverage: 60,
        medianPercentileAverage: 50,
        totalLoggedRuns: 32,
        totalMythicPlusScore: 3000,
        partition: 1,
        zoneId: 47,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        wclBestPerformanceAverage: 60,
        wclMedianPerformanceAverage: 50,
      },
      healing: {
        metric: "points_and_healing",
        dungeonAggregates: active.map((slug) => ({
          dungeonSlug: slug,
          dungeonName: slug,
          encounterId: 1,
          bestParsePercentile: 80,
          medianParsePercentile: 70,
          loggedRunCount: 4,
          specialization: "Restoration",
          keystoneLevel: 12,
          bestDps: 1000,
        })),
        bestPercentileAverage: 80,
        medianPercentileAverage: 70,
        totalLoggedRuns: 32,
        totalMythicPlusScore: 3000,
        partition: 1,
        zoneId: 47,
        observedSpecs: ["Restoration"],
        specBinding: "EXACT_MATCH",
        wclBestPerformanceAverage: 80,
        wclMedianPerformanceAverage: 70,
      },
      diagnostics: {
        adapterVersion: CHARACTER_PERFORMANCE_AGGREGATE_RANKING_VERSION,
        metric: CHARACTER_PERFORMANCE_AGGREGATE_METRIC,
        provenance: "AGGREGATE_ZONE_RANKINGS",
        role: "HEALER",
        targetSpecSlug: "restoration",
        damageDungeonCount: 8,
        healingDungeonCount: 8,
        expectedDungeonCount: 8,
        specBindingPolicy: "test",
        limitations: [],
      },
    });

    const dto = mapCharacterScoreToSnapshotDto(
      {
        id: "score-aspha",
        characterId: "char-aspha",
        seasonId: "season-1",
        scoringVersion: "scoring-v1",
        performance: roleAware.score,
        utility: null,
        survival: null,
        experience: null,
        composite: roleAware.score,
        confidence: roleAware.confidence,
        calculatedAt: new Date("2026-01-01T00:00:00.000Z"),
        dimensionDetails: {
          performance: {
            confidence: roleAware.confidence,
            state: roleAware.state,
            roleAware: extractPersistedRoleAwarePerformanceEvidence({
              roleAware,
              activeDungeonSlugs: active,
            }),
          },
          performanceAggregate: { compact },
        },
        season: { slug: "season-tww-3" },
      },
      { modelKey: "default", modelVersion: 6 },
    );

    const summary = (
      dto.explanation as {
        performanceSummary?: {
          roleAware?: { role: string; healing: unknown; damage: unknown };
        };
      }
    ).performanceSummary;
    expect(summary?.roleAware?.role).toBe("HEALER");
    expect(summary?.roleAware?.healing).not.toBeNull();
    expect(summary?.roleAware?.damage).not.toBeNull();
    expect(dto.dimensions.find((d) => d.dimension === "PERFORMANCE")?.state).toBe(
      "AVAILABLE",
    );
  });
});

describe("resolveProfilePerformanceSummary", () => {
  it("operational roleAware summary wins over stale published summary", () => {
    const operational = {
      currentSeason: {
        peakScore: 80,
        consistencyScore: 70,
        score: 76,
        confidence: 0.9,
        dungeonCount: 8,
        expectedDungeonCount: 8,
        latestObservedAt: null,
        dungeons: [],
      },
      historical: null,
      roleAware: {
        role: "DPS" as const,
        performanceScore: 76,
        weightsApplied: { damageParse: 0.8, healingParse: 0, cooldown: 0.2 },
        damage: {
          score: 80,
          confidence: 1,
          bestAverage: 80,
          medianAverage: 70,
          availableCells: 8,
          expectedCells: 8,
          dungeons: [],
        },
        healing: null,
      },
    };
    const published = {
      currentSeason: {
        peakScore: 10,
        consistencyScore: 10,
        score: 10,
        confidence: 0.1,
        dungeonCount: 1,
        expectedDungeonCount: 8,
        latestObservedAt: null,
        dungeons: [],
      },
      historical: null,
    };
    const resolved = resolveProfilePerformanceSummary({
      productScoreSource: "character_score",
      operationalExplanation: { performanceSummary: operational },
      publishedExplanation: { performanceSummary: published },
    });
    expect(resolved?.roleAware?.performanceScore).toBe(76);
    expect(resolved?.currentSeason.peakScore).toBe(80);
  });

  it("falls back to published legacy summary when operational has no roleAware", () => {
    const published = {
      currentSeason: {
        peakScore: 10,
        consistencyScore: 10,
        score: 10,
        confidence: 0.1,
        dungeonCount: 1,
        expectedDungeonCount: 8,
        latestObservedAt: null,
        dungeons: [],
      },
      historical: null,
    };
    const resolved = resolveProfilePerformanceSummary({
      productScoreSource: "character_score",
      operationalExplanation: {},
      publishedExplanation: { performanceSummary: published },
    });
    expect(resolved?.currentSeason.score).toBe(10);
    expect(resolved?.roleAware).toBeUndefined();
  });
});
