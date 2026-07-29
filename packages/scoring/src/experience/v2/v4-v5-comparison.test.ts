import { describe, expect, it } from "vitest";
import type { MetricObservationDTO } from "@mplus/contracts";
import {
  buildCharacterHistoryExperienceObservations,
  buildExperienceV2Observations,
  calculateScore,
  createDefaultModelV4,
  createDefaultModelV5,
} from "../../index.js";

/**
 * Offline V4 (Experience V1 metrics) vs V5 (Experience V2) comparison.
 * Uses persisted-style observation inputs only — zero provider calls.
 */
const NOW = "2026-07-29T12:00:00.000Z";
const RECENT = "2026-07-20T12:00:00.000Z";
const STALE = "2026-03-01T12:00:00.000Z";
const CHAR = "11111111-1111-1111-1111-111111111111";

type ProviderCounter = { calls: number };

function sharedSkillObservations(): MetricObservationDTO[] {
  return [
    {
      metricKey: "performance.current_season_peak",
      dimension: "PERFORMANCE",
      rawValue: 78,
      normalizedValue: 78,
      confidence: 0.8,
      observedAt: NOW,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: {},
    },
    {
      metricKey: "performance.current_season_consistency",
      dimension: "PERFORMANCE",
      rawValue: 74,
      normalizedValue: 74,
      confidence: 0.8,
      observedAt: NOW,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: {},
    },
    {
      metricKey: "survival.outcome",
      dimension: "SURVIVAL",
      rawValue: 70,
      normalizedValue: 70,
      confidence: 0.75,
      observedAt: NOW,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: {},
    },
    {
      metricKey: "survival.defensive_response",
      dimension: "SURVIVAL",
      rawValue: 68,
      normalizedValue: 68,
      confidence: 0.7,
      observedAt: NOW,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: {},
    },
    {
      metricKey: "survival.emergency_recovery",
      dimension: "SURVIVAL",
      rawValue: 65,
      normalizedValue: 65,
      confidence: 0.65,
      observedAt: NOW,
      sourceProvider: "warcraftlogs",
      coverage: null,
      context: {},
    },
  ];
}

function scoreWith(
  model: ReturnType<typeof createDefaultModelV4>,
  experienceObs: MetricObservationDTO[],
  providerCounter: ProviderCounter,
) {
  const fetchProvider = () => {
    providerCounter.calls += 1;
    throw new Error("providers must not be called during local recalculation");
  };
  void fetchProvider;
  return calculateScore({
    characterId: CHAR,
    seasonSlug: "blizzard-season-13",
    model,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: [...sharedSkillObservations(), ...experienceObs],
    calculatedAt: NOW,
    inputFingerprint: `exp-compare-${model.version}`,
    context: { role: "DPS", freshness: 0.8, selectedRunCoverage: 0.5 },
  });
}

function dimSummary(snapshot: ReturnType<typeof calculateScore>, dimension: string) {
  const d = snapshot.dimensions.find((x) => x.dimension === dimension)!;
  const available =
    (d.contributors as { available?: Array<{ metricKey: string; normalizedValue?: number | null }> })
      .available ?? [];
  return {
    score: d.score,
    confidence: d.confidence,
    state: d.state,
    components: available.map((c) => ({
      metricKey: c.metricKey,
      normalizedValue: c.normalizedValue,
    })),
  };
}

interface Persona {
  id: string;
  label: string;
  v1: Parameters<typeof buildCharacterHistoryExperienceObservations>[0];
  v2: Parameters<typeof buildExperienceV2Observations>[0];
}

const personas: Persona[] = [
  {
    id: "wallidrixe",
    label: "Wallidrixe-shaped (full pool, prior season, recent)",
    v1: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `w-${i + 1}`,
        keyLevel: 10 + (i % 4),
        timed: true,
        completedAt: RECENT,
      })),
      mythicRatingObservation: {
        metricKey: "experience.mythic_rating",
        dimension: "EXPERIENCE",
        rawValue: 2845,
        normalizedValue: 78,
        confidence: 0.75,
        observedAt: NOW,
        sourceProvider: "blizzard",
        coverage: null,
        context: { notAParsePercentile: true },
      },
      priorSeasonCount: 1,
      roleContinuity: 1,
    },
    v2: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `w-${i + 1}`,
        keyLevel: 10 + (i % 4),
        completedAt: RECENT,
      })),
      seasonRuns: Array.from({ length: 18 }, (_, i) => ({
        dungeonSlug: `w-${(i % 8) + 1}`,
        keyLevel: 9 + (i % 5),
        completedAt: RECENT,
      })),
      priorSeasonCount: 1,
      priorSeasonSourceDepth: 1,
      provenance: "HAS_HISTORY",
    },
  },
  {
    id: "new-character",
    label: "Recent/new character",
    v1: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [],
      priorSeasonCount: 0,
    },
    v2: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [],
      seasonRuns: [],
      priorSeasonCount: 0,
      priorSeasonSourceDepth: 1,
      provenance: "CONFIRMED_ABSENCE",
    },
  },
  {
    id: "active-single-season",
    label: "Active single-season character",
    v1: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `a-${i + 1}`,
        keyLevel: 8 + (i % 3),
        timed: true,
        completedAt: RECENT,
      })),
      priorSeasonCount: 0,
      roleContinuity: 1,
    },
    v2: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: Array.from({ length: 8 }, (_, i) => ({
        dungeonSlug: `a-${i + 1}`,
        keyLevel: 8 + (i % 3),
        completedAt: RECENT,
      })),
      seasonRuns: Array.from({ length: 14 }, (_, i) => ({
        dungeonSlug: `a-${(i % 8) + 1}`,
        keyLevel: 7 + (i % 4),
        completedAt: RECENT,
      })),
      priorSeasonCount: 0,
      priorSeasonSourceDepth: 1,
      provenance: "HAS_HISTORY",
    },
  },
  {
    id: "returning-multi-season",
    label: "Returning multi-season character",
    v1: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [
        { dungeonSlug: "r-1", keyLevel: 11, timed: true, completedAt: STALE },
        { dungeonSlug: "r-2", keyLevel: 10, timed: true, completedAt: STALE },
        { dungeonSlug: "r-3", keyLevel: 12, timed: true, completedAt: STALE },
      ],
      priorSeasonCount: 1,
      roleContinuity: 1,
    },
    v2: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [
        { dungeonSlug: "r-1", keyLevel: 11, completedAt: STALE },
        { dungeonSlug: "r-2", keyLevel: 10, completedAt: STALE },
        { dungeonSlug: "r-3", keyLevel: 12, completedAt: STALE },
      ],
      seasonRuns: [
        { dungeonSlug: "r-1", keyLevel: 11, completedAt: STALE },
        { dungeonSlug: "r-2", keyLevel: 10, completedAt: STALE },
        { dungeonSlug: "r-3", keyLevel: 12, completedAt: STALE },
      ],
      priorSeasonCount: 3,
      priorSeasonSourceDepth: 3,
      provenance: "HAS_HISTORY",
    },
  },
  {
    id: "spam-one-dungeon",
    label: "Spam-one-dungeon fixture",
    v1: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [
        { dungeonSlug: "only", keyLevel: 10, timed: true, completedAt: RECENT },
      ],
      priorSeasonCount: 0,
      roleContinuity: 1,
    },
    v2: {
      observedAt: NOW,
      expectedDungeonCount: 8,
      selectedRuns: [{ dungeonSlug: "only", keyLevel: 10, completedAt: RECENT }],
      seasonRuns: Array.from({ length: 80 }, () => ({
        dungeonSlug: "only",
        keyLevel: 10,
        completedAt: RECENT,
      })),
      priorSeasonCount: 0,
      priorSeasonSourceDepth: 1,
      provenance: "HAS_HISTORY",
    },
  },
];

describe("Experience V4 vs V5 offline recalculation (zero provider calls)", () => {
  it("reports component/score/confidence/trust deltas for calibration personas", () => {
    const providerCounter: ProviderCounter = { calls: 0 };
    const report: Array<Record<string, unknown>> = [];

    for (const persona of personas) {
      const v1Obs = buildCharacterHistoryExperienceObservations(persona.v1);
      const v2Obs = buildExperienceV2Observations(persona.v2);
      const v4 = scoreWith(createDefaultModelV4(), v1Obs, providerCounter);
      const v5 = scoreWith(createDefaultModelV5(), v2Obs, providerCounter);
      const expV4 = dimSummary(v4, "EXPERIENCE");
      const expV5 = dimSummary(v5, "EXPERIENCE");
      report.push({
        id: persona.id,
        label: persona.label,
        experienceBefore: expV4,
        experienceAfter: expV5,
        overallBefore: v4.overallScore,
        overallAfter: v5.overallScore,
        trustDelta: (v5.overallScore ?? 0) - (v4.overallScore ?? 0),
        providerCalls: providerCounter.calls,
      });
    }

    expect(providerCounter.calls).toBe(0);
    expect(report).toHaveLength(personas.length);

    const summary = report.map((r) => ({
      id: r.id,
      expBefore: Number(((r.experienceBefore as { score: number | null }).score ?? 0).toFixed(2)),
      expBeforeConf: Number(
        ((r.experienceBefore as { confidence: number }).confidence ?? 0).toFixed(3),
      ),
      expAfter: Number(((r.experienceAfter as { score: number | null }).score ?? 0).toFixed(2)),
      expAfterConf: Number(
        ((r.experienceAfter as { confidence: number }).confidence ?? 0).toFixed(3),
      ),
      overallBefore: Number((Number(r.overallBefore) || 0).toFixed(2)),
      overallAfter: Number((Number(r.overallAfter) || 0).toFixed(2)),
      trustDelta: Number((Number(r.trustDelta) || 0).toFixed(2)),
      providerCalls: r.providerCalls,
      componentsAfter: (r.experienceAfter as { components: unknown }).components,
    }));

    const wall = summary.find((r) => r.id === "wallidrixe")!;
    const newbie = summary.find((r) => r.id === "new-character")!;
    const active = summary.find((r) => r.id === "active-single-season")!;
    const returning = summary.find((r) => r.id === "returning-multi-season")!;
    const spam = summary.find((r) => r.id === "spam-one-dungeon")!;

    expect(wall.expBefore).toBeCloseTo(72.77, 1);
    expect(wall.expAfter).toBeCloseTo(80.61, 1);
    expect(newbie.expAfter).toBeLessThan(35);
    expect(spam.expAfter).toBeLessThan(active.expAfter);
    expect(returning.expAfter).toBeGreaterThan(newbie.expAfter);
    expect(Math.abs(wall.trustDelta)).toBeLessThan(5);
    expect(summary.every((r) => r.providerCalls === 0)).toBe(true);
  });
});
