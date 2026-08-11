/**
 * Consolidated pipeline: package integrity diagnosis, idempotent warm run, no hard-coded identities.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diagnosePackageRosterCompatibility,
  isPackageRosterIncompatible,
} from "./run-orchestration/package-roster-diagnosis.js";
import { parsePublicCliArgs } from "./public-cli.js";
import {
  buildMinimalCapabilityPackage,
  createMemoryOrchestrationPorts,
} from "./run-orchestration/memory-ports.js";
import { buildTestThroughputChannels } from "./run-orchestration/test-fixtures.js";
import {
  orchestrateScoringRuns,
  replayScoringFromPersistedEvidence,
} from "./run-orchestration/orchestrator.js";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import { computeScoringConfidenceV1 } from "@mplus/scoring";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";
const TEST_THROUGHPUT = () => buildTestThroughputChannels(MIDNIGHT_SEASON_1_DUNGEON_SLUGS);

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
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel: 20,
    timed: true,
    runScore: 400,
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

describe("public operator surface", () => {
  it("accepts canary | replay | doctor only", () => {
    expect(parsePublicCliArgs(["replay", "--region", "eu", "--realm", "r", "--character", "c"]).mode).toBe(
      "replay",
    );
    expect(parsePublicCliArgs(["doctor", "--region", "eu", "--realm", "r", "--character", "c"]).mode).toBe(
      "doctor",
    );
    expect(() =>
      parsePublicCliArgs([
        "repair-package",
        "--region",
        "eu",
        "--realm",
        "r",
        "--character",
        "c",
      ]),
    ).toThrow(/deprecated_operator_command/);
  });
});

describe("package integrity (generic)", () => {
  it("detects invalid roster packages without hard-coded identities", () => {
    const diagnosis = diagnosePackageRosterCompatibility({
      packageActorIds: [3, 4, 5, 6, 7],
      expectedFightRosterActorIds: [10, 20, 30, 40, 50],
      targetActorId: 20,
    });
    expect(isPackageRosterIncompatible(diagnosis)).toBe(true);
    expect(diagnosis.status).toBe("INCOMPATIBLE_TARGET_EXCLUDED");
  });
});

describe("cold then warm orchestration idempotency", () => {
  it("scores all dimensions then warm replay is zero-provider", async () => {
    const ports = createMemoryOrchestrationPorts({
      providerCallsPerAcquire: 2,
      autoSeedRanking: true,
    });
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of MIDNIGHT_SEASON_1_DUNGEON_SLUGS) {
      for (const slot of [0, 1]) {
        n += 1;
        candidates.push(candidate(slug, `rep${n}`, slot + 1));
      }
    }

    // Cold: seed nothing — acquire all packages.
    for (const c of candidates) {
      const sf = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: 1,
      };
      ports.setParticipants(
        sf,
        [1, 2, 3, 4, 5].map((id) => ({
          playerActorId: id,
          characterName: id === 1 ? "TargetHero" : `P${id}`,
          realmSlug: "test-realm",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: id === 1 ? CHAR_ID : null,
        })),
      );
    }

    const cold = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test-realm",
      characterName: "TargetHero",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "ALLOWED",
      scope: baseScope(),
      candidates,
      throughputChannels: TEST_THROUGHPUT(),
      ports,
    });
    expect(cold.characterDigests).toHaveLength(16);
    expect(cold.dimensions.performance).not.toBeNull();
    expect(cold.dimensions.utility).not.toBeNull();
    expect(cold.dimensions.survival).not.toBeNull();
    expect(cold.composite).not.toBeNull();
    expect(ports.stats.packagesCreated).toBe(16);
    const coldProviderCalls = ports.stats.providerCalls;
    expect(coldProviderCalls).toBeGreaterThan(0);

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

    // Warm: packages already present — zero new acquisitions.
    const packagesBefore = ports.getPackageCount();
    const digestsBefore = ports.getDigestCount();
    const acquireBefore = ports.stats.acquireCalls;
    const warm = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test-realm",
      characterName: "TargetHero",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "FORBIDDEN",
      scope: baseScope(),
      candidates,
      throughputChannels: TEST_THROUGHPUT(),
      ports,
      existingManifest: cold.manifest,
    });
    expect(warm.characterDigests).toHaveLength(16);
    expect(ports.getPackageCount()).toBe(packagesBefore);
    expect(ports.stats.acquireCalls).toBe(acquireBefore);
    expect(ports.stats.providerCalls).toBe(coldProviderCalls);

    const replay = await replayScoringFromPersistedEvidence({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test-realm",
      characterName: "TargetHero",
      seasonId: "season-1",
      scoringModelId: "model-1",
      scope: baseScope(),
      throughputChannels: TEST_THROUGHPUT(),
      ports,
      existingManifest: cold.manifest,
    });
    expect(replay.accounting.providerCalls).toBe(0);
    expect(replay.accounting.packagesCreated).toBe(0);
    expect(ports.getDigestCount()).toBe(digestsBefore);
    expect(replay.dimensions.performance?.score).toBe(
      cold.dimensions.performance?.score,
    );
  });

  it("one invalid package is superseded while 15 remain reused", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: true });
    const candidates: EvidenceCandidateMetadataV2[] = [];
    let n = 0;
    for (const slug of MIDNIGHT_SEASON_1_DUNGEON_SLUGS) {
      for (const slot of [0, 1]) {
        n += 1;
        candidates.push(candidate(slug, `fix${n}`, slot + 1));
      }
    }
    const bad = candidates[0]!;
    for (const c of candidates) {
      const sf = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: 1,
      };
      const isBad =
        c.discoveryIdentity.reportCode === bad.discoveryIdentity.reportCode &&
        c.discoveryIdentity.fightId === bad.discoveryIdentity.fightId;
      const actors = isBad ? [3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
      ports.setParticipants(
        sf,
        actors.map((id) => ({
          playerActorId: id,
          characterName:
            !isBad && id === 1
              ? "TargetHero"
              : isBad && id === 99
                ? "TargetHero"
                : `P${id}`,
          realmSlug: "test-realm",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId: !isBad && id === 1 ? CHAR_ID : null,
        })),
      );
      const pkg = buildMinimalCapabilityPackage({
        sourceFight: sf,
        participants: actors.map((id) => ({
          playerActorId: id,
          characterName: `A${id}`,
          realmSlug: "test-realm",
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
        packageArtifactId: `a-${c.discoveryIdentity.reportCode}`,
        contentHash: pkg.contentHash,
        providerCalls: 0,
      });
    }

    // Repair bad fight with correct roster.
    const badFight = {
      reportCode: bad.discoveryIdentity.reportCode,
      fightId: bad.discoveryIdentity.fightId,
      reportRevision: 1,
    };
    const prior = await ports.findCompatibleCapabilityPackage({
      sourceFight: badFight,
    });
    expect(prior?.package.friendlyPlayerActorIds).toEqual([3, 4, 5, 6, 7]);
    const correctedActors = [10, 20, 30, 40, 50];
    const corrected = buildMinimalCapabilityPackage({
      sourceFight: badFight,
      participants: correctedActors.map((id) => ({
        playerActorId: id,
        characterName: id === 20 ? "TargetHero" : `P${id}`,
        realmSlug: "test-realm",
        regionCode: "eu",
        classSlug: "warlock",
        specSlug: "affliction",
        role: "DPS",
        ownedPetActorIds: [],
        characterId: id === 20 ? CHAR_ID : null,
      })),
    });
    ports.seedPackage({
      package: corrected,
      packageArtifactId: "repaired",
      contentHash: corrected.contentHash,
      providerCalls: 0,
    });
    ports.setParticipants(
      badFight,
      correctedActors.map((id) => ({
        playerActorId: id,
        characterName: id === 20 ? "TargetHero" : `P${id}`,
        realmSlug: "test-realm",
        regionCode: "eu",
        classSlug: "warlock",
        specSlug: "affliction",
        role: "DPS",
        ownedPetActorIds: [],
        characterId: id === 20 ? CHAR_ID : null,
      })),
    );

    for (const c of candidates) {
      const sf = {
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: 1,
      };
      const hit = await ports.findCompatibleCapabilityPackage({ sourceFight: sf });
      const actors = hit!.package.friendlyPlayerActorIds;
      ports.setParticipants(
        sf,
        actors.map((id) => ({
          playerActorId: id,
          characterName:
            (sf.reportCode === badFight.reportCode && id === 20) ||
            (sf.reportCode !== badFight.reportCode && id === 1)
              ? "TargetHero"
              : `P${id}`,
          realmSlug: "test-realm",
          regionCode: "eu",
          classSlug: "warlock",
          specSlug: "affliction",
          role: "DPS",
          ownedPetActorIds: [],
          characterId:
            (sf.reportCode === badFight.reportCode && id === 20) ||
            (sf.reportCode !== badFight.reportCode && id === 1)
              ? CHAR_ID
              : null,
        })),
      );
    }

    const result = await orchestrateScoringRuns({
      characterId: CHAR_ID,
      region: "eu",
      realm: "test-realm",
      characterName: "TargetHero",
      seasonId: "season-1",
      scoringModelId: "model-1",
      liveProviderPermission: "FORBIDDEN",
      scope: baseScope(),
      candidates,
      throughputChannels: TEST_THROUGHPUT(),
      ports,
    });
    expect(result.characterDigests).toHaveLength(16);
    expect(ports.stats.packagesCreated).toBe(0);
    expect(
      (
        await ports.findCompatibleCapabilityPackage({ sourceFight: badFight })
      )?.package.friendlyPlayerActorIds,
    ).toEqual(correctedActors);
  });
});

describe("production orchestration identity hygiene", () => {
  it("forbids canary character and report literals in production modules", () => {
    const forbidden = ["Wallidrixe", "2MdLn3NVymJTYzg6"] as const;
    const here = join(
      fileURLToPath(new URL(".", import.meta.url)),
    );
    const roots = [
      join(here, "run-orchestration"),
      join(here, "pipeline"),
      join(here, "refresh-bridge.ts"),
      join(here, "acquisition.ts"),
      join(here, "public-cli.ts"),
    ];
    const files: string[] = [];
    for (const root of roots) {
      try {
        const st = readFileSync(root, "utf8");
        void st;
        files.push(root);
      } catch {
        const walk = (dir: string) => {
          for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, ent.name);
            if (ent.isDirectory()) walk(p);
            else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")) {
              files.push(p);
            }
          }
        };
        walk(root);
      }
    }

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const lit of forbidden) {
        if (text.includes(lit)) {
          offenders.push(`${file}:${lit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
