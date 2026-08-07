/**
 * Persist ParticipantScoringDigestV1 bytes and link ArtifactReference to the
 * digest row UUID (never contentHash / compatibility keys).
 */
import type { ParticipantScoringDigestV1 } from "@mplus/contracts";
import type {
  ArtifactRepository,
  ParticipantScoringDigestRepository,
} from "@mplus/database";

export async function persistParticipantDigestWithRowOwner(input: {
  artifacts: ArtifactRepository;
  digests: ParticipantScoringDigestRepository;
  digest: ParticipantScoringDigestV1;
}): Promise<{
  artifactId: string;
  digestRecordId: string;
  created: boolean;
  compatibilityKey: string;
}> {
  const bytes = Buffer.from(JSON.stringify(input.digest), "utf8");
  // Persist without owner first — ownerId must be the digest row UUID.
  const write = await input.artifacts.persist({
    provider: "WARCRAFT_LOGS",
    bytes,
    compression: "GZIP",
    artifactClass: "participant_scoring_digest_v1",
  });
  const upserted = await input.digests.upsert({
    digest: input.digest,
    artifactId: write.artifactId,
  });
  await input.artifacts.ensureOwnerReference({
    artifactId: write.artifactId,
    ownerType: "ParticipantScoringDigest",
    ownerId: upserted.id,
    artifactClass: "participant_scoring_digest_v1",
  });
  return {
    artifactId: write.artifactId,
    digestRecordId: upserted.id,
    created: upserted.created,
    compatibilityKey: upserted.compatibilityKey,
  };
}
