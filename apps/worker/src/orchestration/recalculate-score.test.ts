import { describe, expect, it, vi, beforeEach } from "vitest";
import { hashRefreshContract } from "@mplus/contracts";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";

const runAuthoritativeScoring = vi.fn();

vi.mock("./scoring/refresh-bridge.js", () => ({
  runAuthoritativeScoring: (...args: unknown[]) => runAuthoritativeScoring(...args),
}));

describe("runRecalculateScore — contract stability", () => {
  beforeEach(() => {
    runAuthoritativeScoring.mockReset();
  });

  it("persists the canonical current refresh contract hash when publication is enabled", async () => {
    const { runRecalculateScore } = await import("./recalculate-score.js");

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
      env: process.env,
    });

    const saveScoreSnapshot = vi.fn(
      async (input: {
        snapshot: { explanation: unknown };
        refreshContractHash?: string;
      }) => {
        expect(input.refreshContractHash).toBe(expected.hash);
        const explanation = input.snapshot.explanation as {
          refreshContract: unknown;
          refreshContractHash: string;
        };
        expect(explanation.refreshContractHash).toBe(expected.hash);
        expect(hashRefreshContract(explanation.refreshContract as never)).toBe(
          expected.hash,
        );
        return { id: "snap-1" };
      },
    );

    runAuthoritativeScoring.mockResolvedValue({
      disabled: false,
      providerCalls: 0,
      scoreResult: null,
      snapshot: {
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
        redFlags: [],
        explanation: { prior: true },
        rankingEligibility: {
          eligible: true,
          scoreModelVersion: model.version,
          reasons: [],
          utilityEligible: true,
        },
      },
    });

    const container = {
      env: {
        PROVIDER_MODE: "fixture",
        SCORING_ENABLED: true,
        SCORING_PUBLICATION_ENABLED: true,
      },
      prisma: {
        character: {
          findUnique: vi.fn(async () => ({
            id: "char-1",
            gameClass: { slug: "mage" },
            activeSpec: { slug: "fire", role: "DPS" },
          })),
        },
        characterRunDigest: {
          findMany: vi.fn(async () => []),
        },
        season: { findUnique: vi.fn(async () => season) },
        region: { findUnique: vi.fn(async () => ({ code: "EU" })) },
        realm: { findUnique: vi.fn(async () => ({ slug: "tarren-mill" })) },
        seasonDungeon: { findMany: vi.fn(async () => []) },
        runParticipant: { findMany: vi.fn(async () => []) },
      },
      repositories: {
        character: {
          findById: vi.fn(async () => ({
            id: "char-1",
            regionId: "reg-1",
            realmId: "realm-1",
            displayName: "Test",
            role: "DPS",
          })),
        },
        score: {
          getModelByKeyVersion: vi.fn(async () => model),
          saveScoreSnapshot,
        },
      },
    };

    const result = await runRecalculateScore(container as never, {
      characterId: "char-1",
      seasonId: season.id,
      scoreModelKey: model.key,
      scoreModelVersion: model.version,
      requestedAt: new Date().toISOString(),
    });

    expect(runAuthoritativeScoring).toHaveBeenCalledTimes(1);
    expect(saveScoreSnapshot).toHaveBeenCalledTimes(1);
    expect(
      (result.explanation as { refreshContractHash: string }).refreshContractHash,
    ).toBe(expected.hash);
  });
});
