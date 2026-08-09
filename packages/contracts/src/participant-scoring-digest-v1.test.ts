import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  assertParticipantScoringDigestV1,
  buildParticipantScoringDigestHashMaterial,
  hashCanonicalJson,
  withParticipantDigestContentHash,
  type ParticipantScoringDigestV1,
} from "./index.js";

function baseDigest(
  overrides: Partial<
    Omit<ParticipantScoringDigestV1, "contentHash">
  > = {},
): Omit<ParticipantScoringDigestV1, "contentHash"> {
  return {
    schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
    reportCode: "abc123",
    fightId: 1,
    reportRevision: 1,
    dungeonSlug: "skyreach",
    keyLevel: 15,
    timed: true,
    runScore: 400,
    completedAt: "2026-07-01T12:00:00.000Z",
    participantActorId: 10,
    characterId: null,
    characterName: "Target",
    realmSlug: "archimonde",
    regionCode: "EU",
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS",
    ownedPetActorIds: [],
    loadoutEvidence: {
      evidenceState: "ABSENT",
      talentSpellIds: [],
      talentTreeNodeIds: [],
      blizzardSpecId: null,
      source: "ABSENT",
    },
    capabilityPackageArtifactId: "pkg-1",
    capabilityPackageContentHash: "a".repeat(32),
    catalogVersion: "catalog-test-v1",
    extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
    performance: {
      parsePercentile: 80,
      parseSemantic: "BRACKET_PERCENT",
      partition: null,
      rawDps: null,
      rankingProvenance: {
        providerContractVersion: "wcl-ranking-parse-v1",
        schemaVersion: "1.0.0",
        artifactId: "ranking-art-1",
        contentHash: "r".repeat(32),
        source: "PERSISTED_RANKING_PARSE",
      },
      offensiveActivations: [
        {
          activationId: "off-1",
          canonicalKey: "combustion",
          primarySpellId: 190319,
          observedSpellIds: [190319],
          timestampMs: 1000,
          fightOffsetMs: 1000,
          rawMatchedEventCount: 1,
          contributingSpellIds: [190319],
        },
      ],
      activeCombatMs: 1_500_000,
      activeCombatMethod: "hostile_cast_activity",
      completeness: "COMPLETE",
      limitations: [],
    },
    utility: {
      actions: [],
      hostileCastEvents: [],
      capabilityCompleteness: [],
      completeness: "COMPLETE",
      limitations: [],
    },
    survival: {
      damageTakenTotal: 1000,
      damageTakenEventCount: 10,
      deaths: [],
      personalDefensiveActivations: [],
      recoveryActivations: [],
      externalsReceived: [],
      pressureWindows: [],
      fightDurationMs: 1_800_000,
      activeCombatMs: 1_500_000,
      capabilityCompleteness: [],
      completeness: "COMPLETE",
      limitations: [],
    },
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("ParticipantScoringDigestV1 identity + hashing", () => {
  it("Test A — createdAt does not affect content hash", () => {
    const a = withParticipantDigestContentHash(
      baseDigest({ createdAt: "2026-08-01T12:00:00.000Z" }),
    );
    const b = withParticipantDigestContentHash(
      baseDigest({ createdAt: "2026-08-02T00:00:00.000Z" }),
    );
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("Test B — object insertion order does not affect content hash", () => {
    const materialA = {
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
      reportCode: "abc123",
      fightId: 1,
      nested: { z: 1, a: { y: 2, x: 3 } },
      list: [1, 2],
    };
    const materialB = {
      list: [1, 2],
      nested: { a: { x: 3, y: 2 }, z: 1 },
      fightId: 1,
      reportCode: "abc123",
      schemaVersion: PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
    };
    expect(hashCanonicalJson(materialA)).toBe(hashCanonicalJson(materialB));

    const digestLeft = baseDigest();
    const digestRight = {
      createdAt: digestLeft.createdAt,
      survival: digestLeft.survival,
      utility: digestLeft.utility,
      performance: {
        limitations: digestLeft.performance.limitations,
        completeness: digestLeft.performance.completeness,
        activeCombatMethod: digestLeft.performance.activeCombatMethod,
        activeCombatMs: digestLeft.performance.activeCombatMs,
        offensiveActivations: digestLeft.performance.offensiveActivations,
        rankingProvenance: digestLeft.performance.rankingProvenance,
        rawDps: digestLeft.performance.rawDps,
        partition: digestLeft.performance.partition,
        parseSemantic: digestLeft.performance.parseSemantic,
        parsePercentile: digestLeft.performance.parsePercentile,
      },
      extractorCompatVersion: digestLeft.extractorCompatVersion,
      catalogVersion: digestLeft.catalogVersion,
      capabilityPackageContentHash: digestLeft.capabilityPackageContentHash,
      capabilityPackageArtifactId: "pkg-other-storage-id",
      ownedPetActorIds: digestLeft.ownedPetActorIds,
      loadoutEvidence: digestLeft.loadoutEvidence,
      role: digestLeft.role,
      specSlug: digestLeft.specSlug,
      classSlug: digestLeft.classSlug,
      regionCode: digestLeft.regionCode,
      realmSlug: digestLeft.realmSlug,
      characterName: digestLeft.characterName,
      characterId: digestLeft.characterId,
      participantActorId: digestLeft.participantActorId,
      completedAt: digestLeft.completedAt,
      runScore: digestLeft.runScore,
      timed: digestLeft.timed,
      keyLevel: digestLeft.keyLevel,
      dungeonSlug: digestLeft.dungeonSlug,
      reportRevision: digestLeft.reportRevision,
      fightId: digestLeft.fightId,
      reportCode: digestLeft.reportCode,
      schemaVersion: digestLeft.schemaVersion,
    };
    expect(withParticipantDigestContentHash(digestLeft).contentHash).toBe(
      withParticipantDigestContentHash(digestRight).contentHash,
    );
  });

  it("Test C/D — realm and region changes affect the hash", () => {
    const a = withParticipantDigestContentHash(baseDigest());
    const realmChanged = withParticipantDigestContentHash(
      baseDigest({ realmSlug: "twisting-nether" }),
    );
    const regionChanged = withParticipantDigestContentHash(
      baseDigest({ regionCode: "US" }),
    );
    expect(realmChanged.contentHash).not.toBe(a.contentHash);
    expect(regionChanged.contentHash).not.toBe(a.contentHash);
  });

  it("Test E — scoring evidence changes affect the hash", () => {
    const a = withParticipantDigestContentHash(baseDigest());
    const survivalChanged = withParticipantDigestContentHash(
      baseDigest({
        survival: {
          ...baseDigest().survival,
          damageTakenTotal: 9999,
        },
      }),
    );
    expect(survivalChanged.contentHash).not.toBe(a.contentHash);
  });

  it("Test F — stable source evidence identity changes affect the hash", () => {
    const a = withParticipantDigestContentHash(baseDigest());
    const revisionChanged = withParticipantDigestContentHash(
      baseDigest({ reportRevision: 2 }),
    );
    const packageHashChanged = withParticipantDigestContentHash(
      baseDigest({ capabilityPackageContentHash: "b".repeat(32) }),
    );
    expect(revisionChanged.contentHash).not.toBe(a.contentHash);
    expect(packageHashChanged.contentHash).not.toBe(a.contentHash);
  });

  it("Test G — hashing does not mutate the input", () => {
    const input = baseDigest();
    const before = structuredClone(input);
    void withParticipantDigestContentHash(input);
    void buildParticipantScoringDigestHashMaterial(input);
    expect(input).toEqual(before);
  });

  it("excludes storage artifact ids from hash material", () => {
    const a = withParticipantDigestContentHash(
      baseDigest({ capabilityPackageArtifactId: "artifact-a" }),
    );
    const b = withParticipantDigestContentHash(
      baseDigest({ capabilityPackageArtifactId: "artifact-b" }),
    );
    expect(a.contentHash).toBe(b.contentHash);

    const material = buildParticipantScoringDigestHashMaterial(
      baseDigest(),
    ) as Record<string, unknown>;
    expect(material).not.toHaveProperty("createdAt");
    expect(material).not.toHaveProperty("contentHash");
    expect(material).not.toHaveProperty("capabilityPackageArtifactId");
    const performance = material.performance as {
      rankingProvenance?: Record<string, unknown>;
    };
    expect(performance.rankingProvenance).not.toHaveProperty("artifactId");
  });

  it("rejects unknown sentinel, whitespace-only, and missing identity fields", () => {
    expect(() =>
      withParticipantDigestContentHash(
        baseDigest({ realmSlug: "unknown" as unknown as string }),
      ),
    ).toThrow();

    expect(() =>
      withParticipantDigestContentHash(
        baseDigest({ realmSlug: "   " as unknown as string }),
      ),
    ).toThrow();

    expect(() =>
      assertParticipantScoringDigestV1({
        ...withParticipantDigestContentHash(baseDigest()),
        realmSlug: undefined,
      }),
    ).toThrow();
  });

  it("accepts null realm and region when genuinely absent", () => {
    const digest = withParticipantDigestContentHash(
      baseDigest({ realmSlug: null, regionCode: null }),
    );
    expect(digest.realmSlug).toBeNull();
    expect(digest.regionCode).toBeNull();
  });
});
