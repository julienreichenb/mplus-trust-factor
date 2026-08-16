/**
 * Cold/warm scoring cache behavior — provider-free with injectable ports.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import type { ExperiencePhase1Result } from "@mplus/scoring";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { scoreCharacter, SCORING_VERSION } from "./score-character.js";

const CHARACTER_ID = "00000000-0000-4000-8000-000000000001";
const SEASON_ID = "00000000-0000-4000-8000-000000000002";

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  reportRevision = 1,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision,
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

function allCandidates() {
  return DUNGEONS.flatMap((slug, i) => [
    candidate(slug, `R${i}A`, 1, 1),
    candidate(slug, `R${i}B`, 2, 1),
  ]);
}

function fakePrisma(saved: Array<Record<string, unknown>> = []) {
  return {
    scoreWrites: () => saved.length,
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
  } as never & { scoreWrites: () => number };
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

function baseScoreInput(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      characterId: CHARACTER_ID,
      region: "EU",
      realm: "archimonde",
      characterName: "Tester",
    },
    seasonId: SEASON_ID,
    seasonSlug: "midnight-season-1",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    activeDungeonSlugs: DUNGEONS,
    candidates: allCandidates(),
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

describe("scoreCharacter cache-backed pipeline", () => {
  it("provider-forbidden run performs zero provider calls", async () => {
    const cold = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(),
    });

    expect(cold.providerCalls).toBe(0);
    expect(cold.scoringVersion).toBe(SCORING_VERSION);
    expect(cold.characterScoreId).toBe("score-1");
    expect(cold.performanceAggregate.state).toBe("UNAVAILABLE");
    expect(cold.performanceAggregate.reason).toBe(
      "performance_aggregate_unavailable_replay",
    );

    const noPersist = await scoreCharacter({
      ...baseScoreInput({ persistCharacterScore: false }),
      prisma: fakePrisma(),
    });
    expect(noPersist.characterScoreId).toBeNull();
    expect(noPersist.orchestration.selectedSlotCount).toBeGreaterThanOrEqual(0);

    const warm = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(),
    });

    expect(warm.providerCalls).toBe(0);
  });

  it("production scoring path has no supersession vocabulary", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(
      process.cwd(),
      process.cwd().endsWith("apps\\worker") || process.cwd().endsWith("apps/worker")
        ? "src/orchestration/scoring"
        : "apps/worker/src/orchestration/scoring",
    );
    const files = [
      "score-character.ts",
      "run-orchestration/production-ports.ts",
      "run-orchestration/live-capability-adapter.ts",
    ];
    for (const rel of files) {
      const text = await fs.readFile(path.join(root, rel), "utf8");
      expect(text).not.toMatch(new RegExp("supersedes" + "CompatibilityKey"));
      expect(text).not.toMatch(new RegExp("selectCanonical" + "CompatiblePackageHead"));
      expect(text).not.toMatch(new RegExp("repairIncompatible" + "CapabilityPackages"));
    }
  });
});

describe("scoreCharacter Experience Phase 1 optional input", () => {
  it("omitted experience keeps unavailable Experience and null persistence", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(saved),
    });

    expect(result.providerCalls).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.experience).toBeNull();
    const details = saved[0]!.dimensionDetails as {
      experience: unknown;
      partialComposite: { availableCount: number; effectiveWeights: Record<string, number> };
    };
    expect(details.experience).toBeNull();
    expect(details.partialComposite.effectiveWeights.experience ?? 0).toBe(0);
  });

  it("available experience is included in partial composite and persisted", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const withoutExpSaved: Array<Record<string, unknown>> = [];
    const experience: ExperiencePhase1Result = {
      score: 75,
      available: true,
      confidence: 1,
      confidenceCauses: [],
      previousStandingScore: 75,
      classRankFloor: null,
      classRankFloorApplied: false,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: null,
    };

    const without = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(withoutExpSaved),
    });
    const withExp = await scoreCharacter({
      ...baseScoreInput({ experience }),
      prisma: fakePrisma(saved),
    });

    expect(withExp.providerCalls).toBe(without.providerCalls);
    expect(withExp.providerCalls).toBe(0);
    expect(saved[0]!.experience).toBe(75);
    expect(saved[0]!.performance).toBe(withoutExpSaved[0]!.performance);
    expect(saved[0]!.survival).toBe(withoutExpSaved[0]!.survival);
    expect(saved[0]!.utility).toBe(withoutExpSaved[0]!.utility);

    const details = saved[0]!.dimensionDetails as {
      experience: ExperiencePhase1Result;
      partialComposite: {
        availableCount: number;
        effectiveWeights: Record<string, number>;
      };
    };
    expect(details.experience).toEqual(experience);
    expect(details.partialComposite.effectiveWeights.experience).toBeGreaterThan(0);
    expect(details.partialComposite.availableCount).toBeGreaterThan(
      (withoutExpSaved[0]!.dimensionDetails as { partialComposite: { availableCount: number } })
        .partialComposite.availableCount,
    );
    expect(saved[0]!.composite).not.toBe(withoutExpSaved[0]!.composite);
  });

  it("unavailable/null experience stays excluded from composite", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const experience: ExperiencePhase1Result = {
      score: null,
      available: false,
      confidence: null,
      confidenceCauses: ["previous_evidence_unavailable"],
      previousStandingScore: null,
      classRankFloor: null,
      classRankFloorApplied: false,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
    };
    const baselineSaved: Array<Record<string, unknown>> = [];
    await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(baselineSaved),
    });
    await scoreCharacter({
      ...baseScoreInput({ experience }),
      prisma: fakePrisma(saved),
    });

    expect(saved[0]!.experience).toBeNull();
    expect(saved[0]!.composite).toBe(baselineSaved[0]!.composite);
    expect(saved[0]!.performance).toBe(baselineSaved[0]!.performance);
    expect(saved[0]!.survival).toBe(baselineSaved[0]!.survival);
    expect(saved[0]!.utility).toBe(baselineSaved[0]!.utility);
    const details = saved[0]!.dimensionDetails as {
      experience: ExperiencePhase1Result;
      partialComposite: { effectiveWeights: Record<string, number> };
    };
    expect(details.experience).toEqual(experience);
    expect(details.partialComposite.effectiveWeights.experience ?? 0).toBe(0);
  });

  it("score 0 is persisted and participates in the composite as available", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const withoutExpSaved: Array<Record<string, unknown>> = [];
    const experience: ExperiencePhase1Result = {
      score: 0,
      available: true,
      confidence: 1,
      confidenceCauses: [],
      previousStandingScore: 0,
      classRankFloor: null,
      classRankFloorApplied: false,
      eliteFloorApplied: false,
      confirmedEliteTitleCount: 0,
      reason: null,
    };

    await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(withoutExpSaved),
    });
    await scoreCharacter({
      ...baseScoreInput({ experience }),
      prisma: fakePrisma(saved),
    });

    expect(saved[0]!.experience).toBe(0);
    expect(saved[0]!.experience).not.toBeNull();
    const details = saved[0]!.dimensionDetails as {
      experience: ExperiencePhase1Result;
      partialComposite: {
        availableCount: number;
        effectiveWeights: Record<string, number>;
      };
    };
    expect(details.experience).toEqual(experience);
    expect(details.partialComposite.effectiveWeights.experience).toBeGreaterThan(0);
    expect(details.partialComposite.availableCount).toBeGreaterThan(
      (withoutExpSaved[0]!.dimensionDetails as { partialComposite: { availableCount: number } })
        .partialComposite.availableCount,
    );
    // Available Experience 0 is a real dimension score (not excluded / not null).
    expect(saved[0]!.composite).toBe(0);
    expect(saved[0]!.composite).not.toBe(withoutExpSaved[0]!.composite);
  });
});

describe("scoreCharacter Boost sibling", () => {
  it("passes the same selected slot identities to Boost as the scoring manifest", async () => {
    const result = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(),
    });
    const scoringIds = result.orchestration.characterDigests.map((d) => d.slotId).sort();
    const boostIds = result.boostAssessment?.sample.analyzedRuns.map((r) => r.runId).sort() ?? [];
    const selectedSlotIds = result.orchestration.manifest.slots.map((s) => s.slotId).sort();
    expect(result.boostAssessment).not.toBeNull();
    expect(boostIds).toEqual(selectedSlotIds);
    expect(scoringIds.every((id) => boostIds.includes(id))).toBe(true);
    const byDungeon = new Map<string, number>();
    for (const slot of result.orchestration.manifest.slots) {
      byDungeon.set(slot.dungeonSlug, (byDungeon.get(slot.dungeonSlug) ?? 0) + 1);
    }
    expect(result.orchestration.expectedSlotCount).toBe(16);
    expect([...byDungeon.values()].every((n) => n === 2)).toBe(true);
  });

  it("does not change Trust Score columns when Boost is calculated", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(saved),
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.performance).toBe(result.orchestration.dimensions.performance?.score ?? null);
    expect(saved[0]!.survival).toBe(result.orchestration.dimensions.survival?.score ?? null);
    expect(saved[0]!.utility).toBe(result.orchestration.dimensions.utility?.score ?? null);
  });

  it("does not invoke ranking enrichment when CharacterScore persist is disabled", async () => {
    let called = 0;
    await scoreCharacter({
      ...baseScoreInput({ persistCharacterScore: false }),
      prisma: fakePrisma(),
      ensureRankingSnapshots: async () => {
        called += 1;
      },
    });
    expect(called).toBe(0);
  });

  it("keeps CharacterScore persist when ranking enrichment throws", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const result = await scoreCharacter({
      ...baseScoreInput(),
      prisma: fakePrisma(saved),
      ensureRankingSnapshots: async () => {
        throw new Error("wcl ranking unavailable");
      },
    });
    expect(result.characterScoreId).toBe("score-1");
    expect(saved).toHaveLength(1);
    expect(result.boostAssessment).not.toBeNull();
  });
});
