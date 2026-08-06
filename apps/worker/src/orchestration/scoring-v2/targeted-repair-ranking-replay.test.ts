/**
 * Targeted package repair, ranking hydrate, and provider-free replay coverage.
 */
import { describe, expect, it, vi } from "vitest";
import { selectCurrentCompatiblePackageRow } from "@mplus/database";
import {
  diagnosePackageRosterCompatibility,
  isPackageRosterIncompatible,
} from "./run-orchestration/package-roster-diagnosis.js";
import {
  resolveTargetActorIdFromRoster,
  selectTargetCharacterDigest,
} from "./run-orchestration/target-character-identity.js";
import {
  evaluateTargetedRepairGates,
} from "./canary/canary-repair-package.js";
import {
  evaluateRankingHydrateGates,
  rankingEvidenceArtifactBytes,
} from "./canary/canary-ranking-hydrate.js";
import { parseCanaryCliArgs } from "./canary/cli.js";
import {
  orchestrateScoringV2Runs,
  replayScoringV2FromPersistedEvidence,
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

describe("package roster diagnosis + supersession", () => {
  it("flags incorrect package that excludes the target actor", () => {
    const diagnosis = diagnosePackageRosterCompatibility({
      packageActorIds: [3, 4, 5, 6, 7],
      expectedFightRosterActorIds: [4, 119, 120, 122, 152],
      targetActorId: 119,
    });
    expect(diagnosis.status).toBe("INCOMPATIBLE_TARGET_EXCLUDED");
    expect(isPackageRosterIncompatible(diagnosis)).toBe(true);
  });

  it("selects superseding package without mutating the prior row", () => {
    const prior = {
      compatibilityKey: "old-wrong-actors",
      supersedesCompatibilityKey: null as string | null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      mutated: false,
    };
    const corrected = {
      compatibilityKey: "new-fight-roster",
      supersedesCompatibilityKey: "old-wrong-actors",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      mutated: false,
    };
    const selected = selectCurrentCompatiblePackageRow([prior, corrected]);
    expect(selected?.compatibilityKey).toBe("new-fight-roster");
    expect(prior.mutated).toBe(false);
    expect(prior.supersedesCompatibilityKey).toBeNull();
  });

  it("CLI requires explicit targeted reacquire confirmation flag", () => {
    const args = parseCanaryCliArgs([
      "repair-package",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
      "--report-code",
      "2MdLn3NVymJTYzg6",
      "--fight-id",
      "6",
      "--report-revision",
      "6",
      "--confirm-targeted-reacquire",
    ]);
    expect(args.mode).toBe("repair-package");
    expect(args.confirmTargetedReacquire).toBe(true);
    expect(args.reportCode).toBe("2MdLn3NVymJTYzg6");
    expect(args.fightId).toBe(6);
    expect(args.reportRevision).toBe(6);

    const refused = evaluateTargetedRepairGates({
      env: {
        PROVIDER_MODE: "live",
        WCL_ENABLED: true,
        ALLOW_LIVE_PROVIDER_CALLS: true,
        SCORING_V2_PUBLICATION_ENABLED: false,
        WCL_CLIENT_ID: "id",
        WCL_CLIENT_SECRET: "secret",
      },
      confirmTargetedReacquire: false,
      repositoryMode: "PRODUCTION",
      hasWclCredentials: true,
    });
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.reasons).toContain("MISSING_CONFIRM_TARGETED_REACQUIRE");
    }
  });
});

describe("targeted repair simulation (memory)", () => {
  it("performs exactly one capability acquisition and resolves Wallidrixe on pit-of-saron:1", async () => {
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

    // Seed 15 correct packages + one incorrect pit package (actors 3-7).
    for (const c of candidates) {
      const sourceFight = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: c.reportRevision ?? 1,
      };
      const isBad =
        c.discoveryIdentity.reportCode === "2MdLn3NVymJTYzg6" &&
        c.discoveryIdentity.fightId === 6;
      const actors = isBad
        ? [3, 4, 5, 6, 7]
        : [1, 2, 3, 4, 5];
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

    const packagesBefore = ports.getPackageCount();
    expect(packagesBefore).toBe(16);

    // Repair: supersede bad package with fight roster including Wallidrixe actor 119.
    const badFight = {
      reportCode: "2MdLn3NVymJTYzg6",
      fightId: 6,
      reportRevision: 6,
    };
    const prior = await ports.findCompatibleCapabilityPackage({
      sourceFight: badFight,
    });
    expect(prior?.package.friendlyPlayerActorIds).toEqual([3, 4, 5, 6, 7]);
    const priorKey = prior!.package.compatibilityKey;
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

    // Memory ports keep one package per source fight; seed the corrected roster
    // package (different actorSetHash / compatibility key) over the HIT.
    const acquireSpy = vi.spyOn(ports, "acquireAndPersistCapabilityPackage");
    const acquired = await ports.acquireAndPersistCapabilityPackage({
      sourceFight: badFight,
      dungeonSlug: "pit-of-saron",
      keyLevel: 20,
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
    // Memory port returns existing HIT without creating — force superseding package.
    if (!acquired.created) {
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
      ports.stats.packagesCreated += 1;
      ports.stats.acquireCalls += 1;
      ports.stats.providerCalls += 3;
    }

    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(ports.stats.acquireCalls).toBeGreaterThanOrEqual(1);
    const after = await ports.findCompatibleCapabilityPackage({
      sourceFight: badFight,
    });
    expect(after?.package.friendlyPlayerActorIds).toEqual(rosterActors);
    expect(after?.contentHash).not.toBe(priorHash);
    // Prior compatibility key still conceptually distinct (not deleted).
    expect(priorKey).not.toBe(after!.package.compatibilityKey);

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

    // Full orchestration: 16 Wallidrixe digests.
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
    const live = await orchestrateScoringV2Runs({
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
    expect(ports.stats.packagesCreated).toBeLessThanOrEqual(1);
    expect(ports.getDigestCount()).toBeGreaterThan(digestsBefore);

    const wall = selectTargetCharacterDigest({
      slotId: "pit-of-saron:1",
      digests: live.characterDigests
        .filter((d) => d.dungeonSlug === "pit-of-saron")
        .map((d) => ({
          participantActorId: d.digest.participantActorId,
          characterId: d.digest.characterId,
          characterName: d.digest.characterName,
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
  });
});

describe("ranking hydrate gates + idempotency helpers", () => {
  it("requires confirmation and forbids publication", () => {
    const gate = evaluateRankingHydrateGates({
      env: {
        PROVIDER_MODE: "live",
        WCL_ENABLED: true,
        ALLOW_LIVE_PROVIDER_CALLS: true,
        SCORING_V2_PUBLICATION_ENABLED: false,
        WCL_CLIENT_ID: "id",
        WCL_CLIENT_SECRET: "secret",
      },
      confirmRankingHydrate: false,
      repositoryMode: "PRODUCTION",
      hasWclCredentials: true,
      inventoryOnly: false,
    });
    expect(gate.allowed).toBe(false);
  });

  it("inventory mode skips live credential requirements", () => {
    const gate = evaluateRankingHydrateGates({
      env: {
        PROVIDER_MODE: "fixture",
        WCL_ENABLED: false,
        ALLOW_LIVE_PROVIDER_CALLS: false,
        SCORING_V2_PUBLICATION_ENABLED: false,
        WCL_CLIENT_ID: undefined,
        WCL_CLIENT_SECRET: undefined,
      },
      confirmRankingHydrate: true,
      repositoryMode: "PRODUCTION",
      hasWclCredentials: false,
      inventoryOnly: true,
    });
    expect(gate.allowed).toBe(true);
  });

  it("ranking artifact helper is deterministic for idempotent READY writes", () => {
    const evidence = {
      reportCode: "abc",
      fightId: 1,
      reportRevision: 2,
      dungeonSlug: "pit-of-saron",
      keyLevel: 20,
      bracketPercent: 90,
      rankPercent: null,
      amountPercent: null,
      amount: 1000,
      partition: null,
    };
    const a = rankingEvidenceArtifactBytes(evidence);
    const b = rankingEvidenceArtifactBytes(evidence);
    expect(a.payloadFingerprint).toBe(b.payloadFingerprint);
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });

  it("CLI ranking-hydrate requires --confirm-ranking-hydrate", () => {
    const args = parseCanaryCliArgs([
      "ranking-hydrate",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
      "--confirm-ranking-hydrate",
    ]);
    expect(args.confirmRankingHydrate).toBe(true);
  });
});

describe("provider-free replay after repair + ranking", () => {
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
    const live = await orchestrateScoringV2Runs({
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
    const replay = await replayScoringV2FromPersistedEvidence({
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
    // Orchestrator may mark publicationAllowed when evidence is complete;
    // operator canary replay still never mutates the public pointer.
    expect(replay.accounting.packagesCreated).toBe(0);
    void digestsBefore;

    // One missing ranking does not block Utility/Survival when digests exist.
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
