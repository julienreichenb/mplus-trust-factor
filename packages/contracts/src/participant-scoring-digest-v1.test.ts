import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  PARTICIPANT_SCORING_DIGEST_SCHEMA_VERSION,
  assertParticipantScoringDigestV1,
  withParticipantDigestContentHash,
  type ParticipantScoringDigestV1,
} from "./participant-scoring-digest-v1.js";

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
    capabilityPackageArtifactId: "pkg-1",
    capabilityPackageContentHash: "a".repeat(32),
    catalogVersion: "catalog-test-v1",
    extractorCompatVersion: PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
    performance: {
      parsePercentile: 80,
      parseSemantic: "BRACKET_PERCENT",
      partition: null,
      rawDps: null,
      offensiveActivations: [],
      completeness: "COMPLETE",
      limitations: [],
    },
    utility: {
      actions: [],
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
  it("includes realmSlug and regionCode and hashes deterministically (Test F)", () => {
    const a = withParticipantDigestContentHash(baseDigest());
    const b = withParticipantDigestContentHash(baseDigest());
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.realmSlug).toBe("archimonde");
    expect(a.regionCode).toBe("EU");

    const realmChanged = withParticipantDigestContentHash(
      baseDigest({ realmSlug: "twisting-nether" }),
    );
    expect(realmChanged.contentHash).not.toBe(a.contentHash);

    const regionChanged = withParticipantDigestContentHash(
      baseDigest({ regionCode: "US" }),
    );
    expect(regionChanged.contentHash).not.toBe(a.contentHash);
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
