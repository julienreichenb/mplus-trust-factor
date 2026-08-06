/**
 * Cold/warm scoring cache behavior — provider-free with injectable ports.
 */
import { describe, expect, it } from "vitest";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
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

function fakePrisma() {
  return {
    characterScore: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({
        id: "score-1",
        ...create,
      }),
    },
  } as never;
}

describe("scoreCharacter cache-backed pipeline", () => {
  it("provider-forbidden run performs zero provider calls", async () => {
    const dungeons = [
      "ara-kara",
      "city-of-threads",
      "the-dawnbreaker",
      "the-stonevault",
      "mists-of-tirna-scithe",
      "the-necrotic-wake",
      "siege-of-boralus",
      "grim-batol",
    ];
    const candidates = dungeons.flatMap((slug, i) => [
      candidate(slug, `R${i}A`, 1, 1),
      candidate(slug, `R${i}B`, 2, 1),
    ]);

    const ports = createMemoryOrchestrationPorts();
    const cold = await scoreCharacter({
      identity: {
        characterId: CHARACTER_ID,
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: dungeons,
      candidates,
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      scoringModelId: "model-1",
      allowProviderCalls: false,
      ports,
      prisma: fakePrisma(),
      artifacts: {} as never,
      evidence: {} as never,
    });

    expect(cold.providerCalls).toBe(0);
    expect(cold.scoringVersion).toBe(SCORING_VERSION);
    expect(cold.characterScoreId).toBe("score-1");
    expect(cold.performanceAggregate.state).toBe("UNAVAILABLE");
    expect(cold.performanceAggregate.reason).toBe(
      "performance_aggregate_zone_not_configured",
    );

    const warm = await scoreCharacter({
      identity: {
        characterId: CHARACTER_ID,
        region: "EU",
        realm: "archimonde",
        characterName: "Tester",
      },
      seasonId: SEASON_ID,
      seasonSlug: "midnight-season-1",
      role: "DPS",
      classSlug: "mage",
      specSlug: "fire",
      activeDungeonSlugs: dungeons,
      candidates,
      evidenceCutoffAt: "2026-01-01T00:00:00.000Z",
      highKeyPolicyId: "policy-1",
      scoringModelId: "model-1",
      allowProviderCalls: false,
      ports,
      prisma: fakePrisma(),
      artifacts: {} as never,
      evidence: {} as never,
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
