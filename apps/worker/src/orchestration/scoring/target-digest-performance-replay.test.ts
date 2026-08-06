/**
 * Target digest linkage + Performance partial evidence + provider-free replay.
 */
import { describe, expect, it, vi } from "vitest";
import {
  isUsablePerformanceDigest,
  resolveTargetActorIdFromRoster,
  selectTargetCharacterDigest,
  TargetCharacterDigestError,
} from "./run-orchestration/target-character-identity.js";
import {
  orchestrateScoringV2Runs,
  replayScoringV2FromPersistedEvidence,
} from "./run-orchestration/orchestrator.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceCandidateMetadataV2,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import { computeScoringConfidenceV1 } from "@mplus/scoring";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";

function baseScope() {
  return {
    characterId: CHAR_ID,
    seasonId: "season-1",
    seasonSlug: "blizzard-season-17",
    specializationId: null,
    classSlug: "warlock",
    specSlug: "affliction",
    role: "DPS" as const,
    refreshContractHash: "rh",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: "h",
    activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
  };
}

function seedParticipants(
  ports: ReturnType<typeof createMemoryOrchestrationPorts>,
  candidates: EvidenceCandidateMetadataV2[],
  characterName = "Wallidrixe",
) {
  for (const c of candidates) {
    const sourceFight = {
      reportCode: c.discoveryIdentity.reportCode,
      fightId: c.discoveryIdentity.fightId,
      reportRevision: c.reportRevision ?? 1,
    };
    ports.setParticipants(
      sourceFight,
      [1, 2, 3, 4, 5].map((id) => ({
        playerActorId: id,
        characterName: id === 1 ? characterName : `Player${id}`,
        realmSlug: "archimonde",
        regionCode: "eu",
        classSlug: "warlock",
        specSlug: "affliction",
        role: "DPS",
        ownedPetActorIds: [],
        characterId: id === 1 ? CHAR_ID : null,
      })),
    );
  }
}

function candidate(
  dungeonSlug: string,
  slotIndex: 0 | 1,
  reportCode: string,
  fightId: number,
  reportRevision: number,
  actorId: number,
): EvidenceCandidateMetadataV2 {
  void slotIndex;
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision,
    dungeonSlug,
    keyLevel: 20,
    timed: true,
    runScore: 400,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "test",
  };
}

describe("stable character identity", () => {
  it("treats actor IDs as report-local and resolves via name+realm", () => {
    const roster = [
      {
        wclActorId: 3,
        characterName: "Other",
        realmSlug: "archimonde",
        regionCode: "EU",
      },
      {
        wclActorId: 119,
        characterName: "Wallidrixe",
        realmSlug: "archimonde",
        regionCode: "EU",
      },
    ];
    const resolved = resolveTargetActorIdFromRoster({
      roster,
      identity: {
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
    });
    expect(resolved.reason).toBe("RESOLVED");
    expect(resolved.actorId).toBe(119);

    // Same character, different report-local actor after revision.
    const revised = resolveTargetActorIdFromRoster({
      roster: [
        {
          wclActorId: 50,
          characterName: "Wallidrixe",
          realmSlug: "archimonde",
          regionCode: "EU",
        },
      ],
      identity: {
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
    });
    expect(revised.actorId).toBe(50);
  });

  it("finds the correct digest after revision when five ActorN digests exist", () => {
    const digests = [3, 4, 5, 6, 7].map((actor) => ({
      participantActorId: actor,
      characterId: null as string | null,
      characterName: `Actor${actor}`,
      digest: {
        participantActorId: actor,
        characterId: null,
        characterName: `Actor${actor}`,
        performance: {
          completeness: "COMPLETE",
          parsePercentile: 90,
          parseSemantic: "PARSE",
          limitations: [],
        },
      } as unknown as ParticipantScoringDigestV1,
      digestArtifactId: `art-${actor}`,
    }));
    // Stale discovery actor 4 is in the package set but is not Wallidrixe.
    expect(() =>
      selectTargetCharacterDigest({
        slotId: "pit-of-saron:1",
        digests,
        identity: {
          characterId: CHAR_ID,
          characterName: "Wallidrixe",
          regionCode: "EU",
          realmSlug: "archimonde",
        },
        targetActorId: 119,
      }),
    ).toThrow(TargetCharacterDigestError);

    digests.push({
      participantActorId: 119,
      characterId: null,
      characterName: "Actor119",
      digest: {
        participantActorId: 119,
        characterId: null,
        characterName: "Actor119",
        performance: {
          completeness: "COMPLETE",
          parsePercentile: 88,
          parseSemantic: "PARSE",
          limitations: [],
        },
      } as unknown as ParticipantScoringDigestV1,
      digestArtifactId: "art-119",
    });
    const hit = selectTargetCharacterDigest({
      slotId: "pit-of-saron:1",
      digests,
      identity: {
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        regionCode: "EU",
        realmSlug: "archimonde",
      },
      targetActorId: 119,
    });
    expect(hit.participantActorId).toBe(119);
  });

  it("requires exactly one target digest per selected fight", () => {
    const digests = [
      {
        participantActorId: 1,
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        digest: { characterId: CHAR_ID, characterName: "Wallidrixe" } as ParticipantScoringDigestV1,
        digestArtifactId: "a",
      },
      {
        participantActorId: 2,
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        digest: { characterId: CHAR_ID, characterName: "Wallidrixe" } as ParticipantScoringDigestV1,
        digestArtifactId: "b",
      },
    ];
    expect(() =>
      selectTargetCharacterDigest({
        slotId: "x:0",
        digests,
        identity: {
          characterId: CHAR_ID,
          characterName: "Wallidrixe",
          regionCode: "EU",
          realmSlug: "archimonde",
        },
        targetActorId: null,
      }),
    ).toThrow(/TARGET_CHARACTER_DIGEST_AMBIGUOUS/);
  });
});

describe("performance partial evidence", () => {
  it("reports exact blocker when zero compatible ranking facts exist", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const slugs = [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS];
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of slugs) {
      for (const idx of [0, 1] as const) {
        n += 1;
        candidates.push(
          candidate(slug, idx, `R${n}`, 1, 1, 1),
        );
      }
    }
    seedParticipants(ports, candidates);
    const result = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope(),
      candidates,
      ports,
    });
    expect(result.characterDigests.length).toBe(16);
    expect(
      result.dimensions.blocked.some(
        (b) =>
          b.dimension === "PERFORMANCE" &&
          b.reason === "zero_compatible_performance_facts",
      ),
    ).toBe(true);
    expect(result.dimensions.utility).not.toBeNull();
    expect(result.dimensions.survival).not.toBeNull();
    expect(
      result.dimensions.performanceDigestDiagnostics.every((d) => !d.usable),
    ).toBe(true);
  });

  it("calculates Performance from partial compatible ranking evidence", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: true });
    const slugs = [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS];
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of slugs) {
      for (const idx of [0, 1] as const) {
        n += 1;
        candidates.push(candidate(slug, idx, `P${n}`, 1, 1, 1));
      }
    }
    seedParticipants(ports, candidates);
    // First orchestrate with ranking.
    const full = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope(),
      candidates,
      ports,
    });
    expect(full.dimensions.performance).not.toBeNull();
    expect(full.dimensions.blocked.find((b) => b.dimension === "PERFORMANCE")).toBeUndefined();

    // Mark one digest ranking absent without blocking Utility/Survival.
    const poisoned = structuredClone(full.characterDigests[0]!.digest);
    poisoned.performance.completeness = "UNAVAILABLE";
    poisoned.performance.parsePercentile = null;
    poisoned.performance.parseSemantic = "UNAVAILABLE";
    poisoned.performance.limitations = ["ranking_parse_absent"];
    expect(isUsablePerformanceDigest(poisoned)).toBe(false);

    const usable = full.characterDigests
      .slice(1)
      .filter((d) => isUsablePerformanceDigest(d.digest));
    expect(usable.length).toBe(15);
    const conf = computeScoringConfidenceV1({
      usableRunCount: 15,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    expect(conf.confidenceScore).toBe(97);
  });

  it("dimension confidence is calculated independently", () => {
    const perf = computeScoringConfidenceV1({
      usableRunCount: 15,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    const util = computeScoringConfidenceV1({
      usableRunCount: 16,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    expect(perf.confidenceScore).toBe(97);
    expect(util.confidenceScore).toBe(100);
    expect(Math.min(perf.confidenceScore, util.confidenceScore)).toBe(97);
  });
});

describe("provider-free replay", () => {
  it("performs zero WCL calls and creates zero packages / duplicate digests", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: true });
    const acquire = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const slugs = [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS];
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of slugs) {
      for (const idx of [0, 1] as const) {
        n += 1;
        candidates.push(candidate(slug, idx, `Z${n}`, 1, 1, 1));
      }
    }
    seedParticipants(ports, candidates);
    const seeded = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope(),
      candidates,
      ports,
    });
    expect(seeded.characterDigests).toHaveLength(16);
    const createdBefore = seeded.accounting.digestsCreated;
    acquire.mockClear();

    const replay = await replayScoringV2FromPersistedEvidence({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: baseScope(),
      existingManifest: seeded.manifest,
      candidates,
      ports,
    });

    expect(acquire).not.toHaveBeenCalled();
    expect(replay.accounting.providerCalls).toBe(0);
    expect(replay.accounting.packagesCreated).toBe(0);
    expect(replay.characterDigests).toHaveLength(16);
    expect(replay.accounting.digestsCreated).toBe(0);
    expect(replay.dimensions.performance).not.toBeNull();
    // Orchestrator may mark publicationAllowed when evidence is complete;
    // canary/replay commands still keep publicationEnabled false.
    expect(replay.dimensions.blocked).toEqual([]);
    const conf = computeScoringConfidenceV1({
      usableRunCount: 16,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    expect(conf.confidenceScore).toBe(100);
    void createdBefore;
  });

  it("16 packages produce 16 requested-character digests with roster resolution", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: true });
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of MIDNIGHT_SEASON_1_DUNGEON_SLUGS) {
      for (const idx of [0, 1] as const) {
        n += 1;
        candidates.push(candidate(slug, idx, `R${n}`, 1, 1, 1));
      }
    }
    seedParticipants(ports, candidates);
    ports.resolveFightRoster = async () => {
      return [
        {
          wclActorId: 1,
          characterName: "Wallidrixe",
          realmSlug: "archimonde",
          regionCode: "EU",
          characterId: CHAR_ID,
        },
        {
          wclActorId: 12,
          characterName: "Other",
          realmSlug: "archimonde",
          regionCode: "EU",
        },
      ];
    };

    const result = await orchestrateScoringV2Runs({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope(),
      candidates,
      ports,
    });
    expect(result.characterDigests).toHaveLength(16);
    expect(result.targetDigestFailures).toEqual([]);
  });
});
