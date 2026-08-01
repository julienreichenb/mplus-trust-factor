import { describe, expect, it, vi } from "vitest";
import { hashRefreshContract } from "@mplus/contracts";
import { runRecalculateScore } from "./recalculate-score.js";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";

describe("runRecalculateScore — contract stability", () => {
  it("persists the canonical current refresh contract hash in explanation and column", async () => {
    const season = { id: "season-1", slug: "blizzard-season-13" };
    const model = {
      id: "model-1",
      key: "default",
      version: 6,
      config: { key: "default", version: 6, metricWeights: {} },
    };
    const expected = resolveActiveRefreshContract({
      scoringModelKey: model.key,
      scoringModelVersion: model.version,
      activeSeasonId: season.slug,
      providerMode: "fixture",
      // Match runRecalculateScore: contract resolution reads process.env for zone pins.
      env: process.env,
    });

    const saveScoreSnapshot = vi.fn(async (input: { snapshot: { explanation: unknown }; refreshContractHash?: string }) => {
      expect(input.refreshContractHash).toBe(expected.hash);
      const explanation = input.snapshot.explanation as {
        refreshContract: unknown;
        refreshContractHash: string;
      };
      expect(explanation.refreshContractHash).toBe(expected.hash);
      expect(hashRefreshContract(explanation.refreshContract as never)).toBe(expected.hash);
      return { id: "snap-1" };
    });

    const container = {
      env: { PROVIDER_MODE: "fixture" },
      prisma: {
        season: { findUnique: vi.fn(async () => season) },
      },
      repositories: {
        character: {
          findById: vi.fn(async () => ({ id: "char-1" })),
        },
        score: {
          getModelByKeyVersion: vi.fn(async () => model),
          saveScoreSnapshot,
        },
        metric: {
          listForCharacter: vi.fn(async () => []),
        },
      },
      calculateScore: vi.fn(() => ({
        characterId: "char-1",
        seasonSlug: season.slug,
        modelKey: model.key,
        modelVersion: model.version,
        scopeType: "CHARACTER",
        scopeKey: null,
        overallScore: 70,
        grade: "B",
        skillScore: 70,
        authenticityScore: 70,
        confidence: 0.7,
        calculatedAt: new Date().toISOString(),
        inputFingerprint: "fp",
        dimensions: [],
        explanation: { prior: true },
      })),
    };

    const result = await runRecalculateScore(container as never, {
      characterId: "char-1",
      seasonId: season.id,
      scoreModelKey: model.key,
      scoreModelVersion: model.version,
      requestedAt: new Date().toISOString(),
    });

    expect(saveScoreSnapshot).toHaveBeenCalledTimes(1);
    expect((result.explanation as { refreshContractHash: string }).refreshContractHash).toBe(
      expected.hash,
    );
  });
});
