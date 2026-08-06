/**
 * Integration tests for runAuthoritativeScoring → scoreCharacter.
 * Uses in-memory orchestration ports (no WCL, no Postgres).
 */
import { describe, expect, it, vi } from "vitest";
import { EVIDENCE_SELECTOR_VERSION } from "@mplus/contracts";
import type { WorkerContainer } from "../../container.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";

const EIGHT_DUNGEONS = [
  "algethar-academy",
  "azure-vault",
  "brackenhide-hollow",
  "halls-of-infusion",
  "neltharus",
  "nokhud-offensive",
  "ruby-life-pools",
  "vault-of-the-incarnates",
] as const;

function fullSixteenCandidates(): EvidenceCandidateMetadataV2[] {
  const out: EvidenceCandidateMetadataV2[] = [];
  let fight = 1;
  for (const dungeon of EIGHT_DUNGEONS) {
    for (let i = 0; i < 2; i += 1) {
      out.push({
        dungeonSlug: dungeon,
        keyLevel: 16,
        timed: true,
        reportRevision: 1,
        discoveryIdentity: { reportCode: `R${fight}`, fightId: fight },
        runScore: 200,
        evidenceCompleteness: 1,
        completedAt: "2026-08-01T12:00:00.000Z",
        durationMs: 1_800_000,
        accessState: "AVAILABLE",
        identityResolution: "EXACT",
        playerActorId: 1,
        characterId: CHAR_ID,
      } as EvidenceCandidateMetadataV2);
      fight += 1;
    }
  }
  return out;
}

function mockContainer(env: Record<string, unknown>): WorkerContainer {
  return {
    env,
    prisma: {
      characterScore: {
        upsert: vi.fn(async ({ create }) => ({ id: "score-1", ...create })),
        findUnique: vi.fn(async () => null),
      },
    } as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    createRedisConnection: vi.fn(() => ({
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
    })),
    providers: {} as never,
    disabledProviders: new Set(),
    repositories: {
      artifacts: {} as never,
      evidence: {} as never,
    } as never,
  } as unknown as WorkerContainer;
}

const refreshContract = {
  scoringModelKey: "test",
  scoringModelVersion: "1",
  activeSeasonId: "s1",
  providerMode: "fixture" as const,
};

function baseInput(
  container: WorkerContainer,
  ports: ReturnType<typeof createMemoryOrchestrationPorts>,
) {
  return {
    container,
    characterId: CHAR_ID,
    seasonId: "season-1",
    seasonSlug: "the-war-within-season-1",
    role: "DPS" as const,
    classSlug: "mage",
    specSlug: "fire",
    refreshContract,
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: [...EIGHT_DUNGEONS],
    candidates: fullSixteenCandidates(),
    scoreModelKey: "test",
    scoreModelVersion: 1,
    scoreModelId: "model-1",
    calculatedAt: "2026-08-01T12:00:00.000Z",
    region: "eu",
    realm: "test",
    characterName: "Target",
    portsOverride: ports,
  };
}

describe("runAuthoritativeScoring ↔ scoreCharacter", () => {
  it("invokes orchestrator when scoring is enabled", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer({
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
    });

    const result = await runAuthoritativeScoring(baseInput(container, ports));

    expect(result.disabled).toBe(false);
    expect(result.scoreResult).not.toBeNull();
    expect(result.scoreResult!.orchestration.expectedSlotCount).toBeGreaterThan(0);
    expect(result.snapshot.provisionalReason).not.toBe("SCORING_DISABLED");
  });

  it("returns disabled snapshot when SCORING_ENABLED is false", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const container = mockContainer({
      SCORING_ENABLED: false,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
    });

    const result = await runAuthoritativeScoring(baseInput(container, ports));

    expect(result.disabled).toBe(true);
    expect(result.scoreResult).toBeNull();
    expect(result.snapshot.provisionalReason).toBe("SCORING_DISABLED");
    expect(acquire).not.toHaveBeenCalled();
    expect(ports.stats.providerCalls).toBe(0);
  });

  it("does not call WCL when ALLOW_LIVE_PROVIDER_CALLS is false", async () => {
    const ports = createMemoryOrchestrationPorts();
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const container = mockContainer({
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
    });

    const result = await runAuthoritativeScoring(baseInput(container, ports));

    expect(result.disabled).toBe(false);
    expect(result.providerCalls).toBe(0);
    expect(acquire).not.toHaveBeenCalled();
    expect(ports.stats.providerCalls).toBe(0);
  });

  it("reports providerCalls from scoreCharacter and keeps publication off", async () => {
    const ports = createMemoryOrchestrationPorts();
    const container = mockContainer({
      SCORING_ENABLED: true,
      SCORING_PUBLICATION_ENABLED: false,
      ALLOW_LIVE_PROVIDER_CALLS: false,
      PROVIDER_MODE: "fixture",
      WCL_ENABLED: false,
    });

    const result = await runAuthoritativeScoring(baseInput(container, ports));

    expect(result.providerCalls).toBe(
      result.scoreResult!.orchestration.accounting.providerCalls,
    );
    expect(result.providerCalls).toBe(0);
    expect(result.scoreResult!.publicationEnabled).toBe(false);
    expect(result.snapshot.explanation).toMatchObject({
      publicationEnabled: false,
    });
  });

  it("uses selector version constant", () => {
    expect(EVIDENCE_SELECTOR_VERSION.length).toBeGreaterThan(0);
  });
});
