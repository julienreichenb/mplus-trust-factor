/**
 * Agent 02 — authoritative explainability persistence + fresh/API projector parity.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import {
  buildScoreExplainabilityV1,
  projectScoreExplainabilityPublic,
  productDimensionExplainabilityFields,
  tryParsePersistedScoreExplainability,
  type ExperiencePhase1Result,
} from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { scoreCharacter } from "./score-character.js";
import { scoreCharacterResultToSnapshotDto } from "./snapshot-from-character-score.js";

const CHARACTER_ID = "00000000-0000-4000-8000-000000000011";
const SEASON_ID = "00000000-0000-4000-8000-000000000012";

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel: 12,
    timed: true,
    runScore: 200,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "test",
  };
}

const DUNGEONS = [
  "ara-kara",
  "city-of-threads",
  "the-dawnbreaker",
  "the-stonevault",
  "mists-of-tirna-scithe",
  "the-necrotic-wake",
  "siege-of-boralus",
  "grim-batol",
];

function fakePrisma(saved: Array<Record<string, unknown>> = []) {
  return {
    scoreModel: {
      findUnique: async () => ({ config: {} }),
    },
    characterScore: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const row = { id: `score-${saved.length + 1}`, ...create };
        saved.push(row);
        return row;
      },
    },
  } as never;
}

const ensureUnavailable = async () =>
  ({
    state: "UNAVAILABLE" as const,
    data: null,
    reason: "performance_aggregate_unavailable_replay",
    cache: "MISS" as const,
    providerCalls: 0,
    created: false as const,
    updated: false as const,
    aggregateRowId: null,
    contentHash: null,
  });

function confirmedNoActivityExperience(): ExperiencePhase1Result {
  return {
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
  };
}

function baseScoreInput(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      characterId: CHARACTER_ID,
      region: "EU",
      realm: "archimonde",
      characterName: "Explainer",
    },
    seasonId: SEASON_ID,
    seasonSlug: "midnight-season-1",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    activeDungeonSlugs: DUNGEONS,
    candidates: DUNGEONS.flatMap((slug, i) => [
      candidate(slug, `E${i}A`, 1),
      candidate(slug, `E${i}B`, 2),
    ]),
    evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
    highKeyPolicyId: "policy-1",
    scoringModelId: "model-1",
    allowProviderCalls: false,
    zoneId: 47,
    ensurePerformanceAggregate: ensureUnavailable,
    ports: createMemoryOrchestrationPorts(),
    artifacts: {} as never,
    evidence: {} as never,
    ...overrides,
  };
}

describe("scoreCharacter explainability integration", () => {
  it("builds once, persists exact canonical object, and adds zero provider calls", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const experience = confirmedNoActivityExperience();
    const result = await scoreCharacter({
      ...baseScoreInput({ experience }),
      prisma: fakePrisma(saved),
    });

    expect(result.providerCalls).toBe(0);
    expect(result.explainability.schemaVersion).toBe("score-explainability-v1");
    expect(result.explainability.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    expect(saved).toHaveLength(1);
    const details = saved[0]!.dimensionDetails as {
      explainability: typeof result.explainability;
      experience: ExperiencePhase1Result;
    };
    // Persistence stores the exact canonical object (JSON round-trip).
    expect(details.explainability).toEqual(
      JSON.parse(JSON.stringify(result.explainability)),
    );
    expect(details.explainability.fingerprint).toBe(result.explainability.fingerprint);
    expect(details.experience.score).toBe(0);

    const expPublic = productDimensionExplainabilityFields(
      result.explainability,
      "EXPERIENCE",
    );
    expect(expPublic.explainability.scoreDrivers.map((d) => d.code)).toContain(
      "experience.confirmed_no_activity",
    );
    expect(expPublic.explainability.confidenceReasons).toEqual([]);
    expect(expPublic.contributors.negative.map((n) => n.metricKey)).toContain(
      "experience.confirmed_no_activity",
    );
  });

  it("cold and provider-free reconstruction share explainability fingerprint", async () => {
    const experience = confirmedNoActivityExperience();
    const coldSaved: Array<Record<string, unknown>> = [];
    const cold = await scoreCharacter({
      ...baseScoreInput({ experience }),
      prisma: fakePrisma(coldSaved),
    });

    const warmSaved: Array<Record<string, unknown>> = [];
    const warm = await scoreCharacter({
      ...baseScoreInput({ experience, allowProviderCalls: false }),
      prisma: fakePrisma(warmSaved),
    });

    expect(cold.providerCalls).toBe(0);
    expect(warm.providerCalls).toBe(0);
    expect(warm.explainability.fingerprint).toBe(cold.explainability.fingerprint);
    expect(warm.explainability).toEqual(cold.explainability);

    // Reconstruct fingerprint from persisted JSON alone (provider-free).
    const persisted = tryParsePersistedScoreExplainability(
      (coldSaved[0]!.dimensionDetails as { explainability: unknown }).explainability,
    );
    expect(persisted?.fingerprint).toBe(cold.explainability.fingerprint);
  });

  it("fresh snapshot public explainability matches projector of persisted canonical", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const experience = confirmedNoActivityExperience();
    const result = await scoreCharacter({
      ...baseScoreInput({ experience }),
      prisma: fakePrisma(saved),
    });

    const freshDto = scoreCharacterResultToSnapshotDto({
      result,
      characterId: CHARACTER_ID,
      seasonSlug: "midnight-season-1",
      scoreModelKey: "default",
      scoreModelVersion: 6,
      calculatedAt: "2026-08-09T00:00:00.000Z",
      inputFingerprint: "fp",
      publicationEnabled: false,
    });

    const publicView = projectScoreExplainabilityPublic(result.explainability);
    for (const key of [
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
      "EXPERIENCE",
    ] as const) {
      const dim = freshDto.dimensions.find((d) => d.dimension === key);
      expect(dim?.explainability).toEqual(publicView.dimensions[key]);
    }

    // Simulate API read: parse persisted JSON → same public projection.
    const parsed = tryParsePersistedScoreExplainability(
      (saved[0]!.dimensionDetails as { explainability: unknown }).explainability,
    );
    expect(parsed).not.toBeNull();
    const fromPersisted = projectScoreExplainabilityPublic(parsed!);
    expect(fromPersisted.dimensions).toEqual(publicView.dimensions);
    expect(fromPersisted.fingerprint).toBe(result.explainability.fingerprint);

    // Legacy contributors come only from scoreDrivers (not confidence).
    for (const dim of freshDto.dimensions) {
      const contributors = dim.contributors as {
        negative?: Array<{ metricKey: string }>;
        positive?: Array<{ metricKey: string }>;
      };
      const driverCodes = new Set(
        (dim.explainability?.scoreDrivers ?? []).map((d) => d.code),
      );
      for (const n of contributors.negative ?? []) {
        expect(driverCodes.has(n.metricKey)).toBe(true);
      }
      for (const p of contributors.positive ?? []) {
        expect(driverCodes.has(p.metricKey)).toBe(true);
      }
      for (const reason of dim.explainability?.confidenceReasons ?? []) {
        expect((contributors.negative ?? []).map((n) => n.metricKey)).not.toContain(
          reason.code,
        );
      }
    }
  });

  it("does not invent weaknesses from confidence causes in canonical builders", () => {
    const built = buildScoreExplainabilityV1({
      performance: null,
      survival: null,
      utility: null,
      experience: {
        score: null,
        available: false,
        previousStandingScore: null,
        classRankFloor: null,
        classRankFloorApplied: false,
        eliteFloorApplied: false,
        confirmedEliteTitleCount: 0,
        confidence: null,
        confidenceCauses: ["previous_evidence_unavailable"],
        reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
      },
      composite: null,
    });
    const publicExp = projectScoreExplainabilityPublic(built).dimensions.EXPERIENCE;
    expect(publicExp.scoreDrivers).toEqual([]);
    expect(publicExp.confidenceReasons.map((r) => r.code)).toContain(
      "previous_evidence_unavailable",
    );
    const contributors = productDimensionExplainabilityFields(
      built,
      "EXPERIENCE",
    ).contributors;
    expect(contributors.negative).toEqual([]);
    expect(contributors.positive).toEqual([]);
  });
});
