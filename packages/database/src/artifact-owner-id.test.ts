/**
 * ArtifactReference.ownerId must be a DB row UUID — never a SHA-256 content hash.
 */
import { describe, expect, it } from "vitest";
import {
  ArtifactInvalidOwnerIdError,
  assertArtifactOwnerIdIsUuid,
} from "./repositories/artifact-repository.js";

describe("assertArtifactOwnerIdIsUuid", () => {
  it("accepts canonical UUID owner ids", () => {
    expect(() =>
      assertArtifactOwnerIdIsUuid({
        ownerType: "ParticipantScoringDigest",
        ownerId: "038d4de4-931c-449c-9f41-af8bd59e569c",
        artifactClass: "participant_scoring_digest_v1",
      }),
    ).not.toThrow();
  });

  it("rejects a 64-character SHA-256 content hash before Prisma", () => {
    const sha256 =
      "c236e7ff5428856cae1264ec36fa8188eaae897cfb07e0fbb0387cc250bc2bd1";
    expect(sha256).toHaveLength(64);
    try {
      assertArtifactOwnerIdIsUuid({
        ownerType: "ParticipantScoringDigest",
        ownerId: sha256,
        artifactClass: "participant_scoring_digest_v1",
      });
      expect.unreachable("expected ArtifactInvalidOwnerIdError");
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactInvalidOwnerIdError);
      const err = error as ArtifactInvalidOwnerIdError;
      expect(err.code).toBe("ARTIFACT_INVALID_OWNER_ID");
      expect(err.ownerType).toBe("ParticipantScoringDigest");
      expect(err.ownerIdLength).toBe(64);
      expect(err.looksLikeSha256Hex).toBe(true);
      expect(err.artifactClass).toBe("participant_scoring_digest_v1");
      // Do not echo the hash into the message.
      expect(err.message).not.toContain(sha256);
    }
  });

  it("rejects compatibility-key shaped non-UUID owners", () => {
    expect(() =>
      assertArtifactOwnerIdIsUuid({
        ownerType: "CapabilityEvidencePackage",
        ownerId:
          "wcl-capability-evidence|2MdLn3NVymJTYzg6|r6|f6|PACKAGE|actors:abc",
        artifactClass: "canonical_capability_evidence_v1",
      }),
    ).toThrow(ArtifactInvalidOwnerIdError);
  });
});
