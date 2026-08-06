/**
 * Package roster diagnosis, newest-complete package selection, and provider-free replay.
 */
import { describe, expect, it, vi } from "vitest";
import {
  diagnosePackageRosterCompatibility,
  isPackageRosterIncompatible,
} from "./run-orchestration/package-roster-diagnosis.js";
import {
  resolveTargetActorIdFromRoster,
  selectTargetCharacterDigest,
} from "./run-orchestration/target-character-identity.js";
import {
  orchestrateScoringRuns,
  replayScoringFromPersistedEvidence,
} from "./run-orchestration/orchestrator.js";
import {
  buildMinimalCapabilityPackage,
  createMemoryOrchestrationPorts,
} from "./run-orchestration/memory-ports.js";
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

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  reportRevision: number,
  actorId: number,
): EvidenceCandidateMetadataV2 {
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

describe("package roster diagnosis", () => {
  it("flags incorrect package that excludes the target actor", () => {
    const diagnosis = diagnosePackageRosterCompatibility({
      packageActorIds: [3, 4, 5, 6, 7],
      expectedFightRosterActorIds: [4, 119, 120, 122, 152],
      targetActorId: 119,
    });
    expect(diagnosis.status).toBe("INCOMPATIBLE_TARGET_EXCLUDED");
    expect(isPackageRosterIncompatible(diagnosis)).toBe(true);
  });
});

describe("newest complete package wins (memory)", () => {
  it("reseeding a fight package replaces the prior HIT for that fight", async () => {
    const ports = createMemoryOrchestrationPorts({ providerCallsPerAcquire: 3 });
    const pit = candidate("pit-of-saron", "2MdLn3NVymJTYzg6", 6, 6, 119);
    const other = MIDNIGHT_SEASON_1_DUNGEON_SLUGS.filter(
      (s) => s !== "pit-of-saron",
    ).flatMap((slug, i) => [
      candidate(slug, `ok${i}a`, 1, 1, 1),
      candidate(slug, `ok${i}b`, 2, 1, 1),
    ]);
    const secondPit = candidate("pit-of-saron", "goodPit2", 2, 1, 1);
    const candidates = [pit, secondPit, ...other].slice(0, 16);

    for (const c of candidates) {
      const sourceFight = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: c.reportRevision ?? 1,
      };
      const isBad =
        c.discoveryIdentity.reportCode === "2MdLn3NVymJTYzg6" &&
        c.discoveryIdentity.fightId === 6;
      const actors = isBad ? [3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
      ports.setParticipants(
        sourceFight,
        actors.map((id) => ({
          playerActorId: id,
          characterName: id === (isBad ? -1 : 1) ? "Wallidrixe" : `Player${id}`,
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: id === 1 && !isBad ? CHAR_ID : null,
        })),
      );
      const pkg = buildMinimalCapabilityPackage({
        sourceFight,
        participants: actors.map((id) => ({
          playerActorId: id,
          characterName: `Actor${id}`,
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: null,
        })),
      });
      ports.seedPackage({
        package: pkg,
        packageArtifactId: `art-${c.discoveryIdentity.reportCode}`,
        contentHash: pkg.contentHash,
        providerCalls: 0,
      });
    }

    const badFight = {
      reportCode: "2MdLn3NVymJTYzg6",
      fightId: 6,
      reportRevision: 6,
    };
    const prior = await ports.findCompatibleCapabilityPackage({
      sourceFight: badFight,
    });
    expect(prior?.package.friendlyPlayerActorIds).toEqual([3, 4, 5, 6, 7]);
    const priorHash = prior!.contentHash;

    const rosterActors = [4, 119, 120, 122, 152];
    ports.setParticipants(
      badFight,
      rosterActors.map((id) => ({
        playerActorId: id,
        characterName: id === 119 ? "Wallidrixe" : `Player${id}`,
        realmSlug: "archimonde",
        regionCode: "eu",
        classSlug: "warlock",
        specSlug: "affliction",
        role: "DPS",
        ownedPetActorIds: [],
        characterId: id === 119 ? CHAR_ID : null,
      })),
    );

    const corrected = buildMinimalCapabilityPackage({
      sourceFight: badFight,
      participants: rosterActors.map((id) => ({
        playerActorId: id,
        characterName: id === 119 ? "Wallidrixe" : `Player${id}`,
        realmSlug: "archimonde",
        regionCode: "eu",
        classSlug: "warlock",
        specSlug: "affliction",
        role: "DPS",
        ownedPetActorIds: [],
        characterId: id === 119 ? CHAR_ID : null,
      })),
    });
    ports.seedPackage({
      package: corrected,
      packageArtifactId: "art-repaired",
      contentHash: corrected.contentHash,
      providerCalls: 0,
    });

    const after = await ports.findCompatibleCapabilityPackage({
      sourceFight: badFight,
    });
    expect(after?.package.friendlyPlayerActorIds).toEqual(rosterActors);
    expect(after?.contentHash).not.toBe(priorHash);

    const target = resolveTargetActorIdFromRoster({
      roster: rosterActors.map((id) => ({
        wclActorId: id,
        characterName: id === 119 ? "Wallidrixe" : `Player${id}`,
        realmSlug: "archimonde",
        regionCode: "eu",
      })),
      identity: {
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        regionCode: "eu",
        realmSlug: "archimonde",
      },
    });
    expect(target.actorId).toBe(119);

    for (const c of candidates) {
      const sf = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: c.reportRevision ?? 1,
      };
      const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: sf });
      const actors = hit!.package.friendlyPlayerActorIds;
      ports.setParticipants(
        sf,
        actors.map((id) => ({
          playerActorId: id,
          characterName:
            (sf.reportCode === "2MdLn3NVymJTYzg6" && id === 119) ||
            (sf.reportCode !== "2MdLn3NVymJTYzg6" && id === 1)
              ? "Wallidrixe"
              : `Player${id}`,
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId:
            (sf.reportCode === "2MdLn3NVymJTYzg6" && id === 119) ||
            (sf.reportCode !== "2MdLn3NVymJTYzg6" && id === 1)
              ? CHAR_ID
              : null,
        })),
      );
    }

    const digestsBefore = ports.getDigestCount();
    const live = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: baseScope(),
      candidates,
      liveProviderPermission: "FORBIDDEN",
      ports,
    });
    expect(live.characterDigests).toHaveLength(16);
    expect(ports.getPackageCount()).toBe(16);
    expect(ports.getDigestCount()).toBeGreaterThan(digestsBefore);

    const wall = selectTargetCharacterDigest({
      slotId: "pit-of-saron:1",
      digests: live.characterDigests
        .filter((d) => d.dungeonSlug === "pit-of-saron")
        .map((d) => ({
          participantActorId: d.digest.participantActorId,
          characterId: d.digest.characterId,
          characterName: d.digest.characterName,
          realmSlug: d.digest.realmSlug,
          regionCode: d.digest.regionCode,
          digest: d.digest,
          digestArtifactId: d.digestArtifactId,
        })),
      identity: {
        characterId: CHAR_ID,
        characterName: "Wallidrixe",
        regionCode: "eu",
        realmSlug: "archimonde",
      },
      targetActorId: 119,
    });
    expect(wall.participantActorId).toBe(119);
    void vi;
  });
});

describe("provider-free replay", () => {
  it("uses 16 packages, zero WCL, AVAILABLE dimensions, confidence 100", async () => {
    const ports = createMemoryOrchestrationPorts({ providerCallsPerAcquire: 0 });
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of MIDNIGHT_SEASON_1_DUNGEON_SLUGS) {
      for (const slot of [0, 1] as const) {
        n += 1;
        candidates.push(candidate(slug, `rep${n}`, slot + 1, 1, 1));
      }
    }
    expect(candidates).toHaveLength(16);

    for (const c of candidates) {
      const sourceFight = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: 1,
      };
      ports.setParticipants(
        sourceFight,
        [1, 2, 3, 4, 5].map((id) => ({
          playerActorId: id,
          characterName: id === 1 ? "Wallidrixe" : `Player${id}`,
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: id === 1 ? CHAR_ID : null,
        })),
      );
      const pkg = buildMinimalCapabilityPackage({
        sourceFight,
        participants: [1, 2, 3, 4, 5].map((id) => ({
          playerActorId: id,
          characterName: id === 1 ? "Wallidrixe" : `Player${id}`,
          realmSlug: "archimonde",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: id === 1 ? CHAR_ID : null,
        })),
      });
      ports.seedPackage({
        package: pkg,
        packageArtifactId: `a-${c.discoveryIdentity.reportCode}`,
        contentHash: pkg.contentHash,
        providerCalls: 0,
      });
    }

    const packagesBefore = ports.getPackageCount();
    const digestsBefore = ports.getDigestCount();
    const live = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: baseScope(),
      candidates,
      liveProviderPermission: "FORBIDDEN",
      ports,
    });
    expect(live.characterDigests).toHaveLength(16);
    expect(live.dimensions.blocked).toEqual([]);
    expect(live.dimensions.performance).not.toBeNull();
    expect(live.dimensions.utility).not.toBeNull();
    expect(live.dimensions.survival).not.toBeNull();
    expect(live.composite).not.toBeNull();

    const conf = computeScoringConfidenceV1({
      usableRunCount: 16,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
      missingDungeons: [],
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      representedDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
    });
    expect(conf.confidenceScore).toBe(100);

    const digestsAfterLive = ports.getDigestCount();
    const replay = await replayScoringFromPersistedEvidence({
      characterId: CHAR_ID,
      region: "eu",
      realm: "archimonde",
      characterName: "Wallidrixe",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: baseScope(),
      ports,
      existingManifest: live.manifest,
    });
    expect(replay.accounting.providerCalls).toBe(0);
    expect(ports.getPackageCount()).toBe(packagesBefore);
    expect(ports.stats.packagesCreated).toBe(0);
    expect(ports.getDigestCount()).toBe(digestsAfterLive);
    expect(replay.characterDigests).toHaveLength(16);
    expect(replay.dimensions.performance).not.toBeNull();
    expect(replay.composite).not.toBeNull();
    expect(replay.accounting.packagesCreated).toBe(0);
    void digestsBefore;

    const poisoned = structuredClone(
      live.characterDigests[0]!.digest,
    ) as ParticipantScoringDigestV1;
    poisoned.performance.completeness = "UNAVAILABLE";
    poisoned.performance.parsePercentile = null;
    poisoned.performance.parseSemantic = "UNAVAILABLE";
    expect(poisoned.utility).toBeDefined();
    expect(poisoned.survival).toBeDefined();
  });
});
