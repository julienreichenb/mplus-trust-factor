/**
 * Durable ParticipantScoringDigestV1 index + verified pg:// reload.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assertParticipantScoringDigestV1,
  buildParticipantDigestCompatibilityKey,
  type ParticipantScoringDigestV1,
} from "@mplus/contracts";
import {
  ArtifactLegacyExternalPayloadMissingError,
  type ArtifactRepository,
} from "./artifact-repository.js";
import { isCasStorageUri } from "../stores/postgres-artifact-store.js";

export interface UpsertParticipantScoringDigestInput {
  digest: ParticipantScoringDigestV1;
  artifactId: string;
}

export class ParticipantScoringDigestRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly artifacts: ArtifactRepository,
  ) {}

  async findByCompatibilityKey(
    compatibilityKey: string,
  ): Promise<{
    recordId: string;
    digest: ParticipantScoringDigestV1;
    artifactId: string;
  } | null> {
    const row = await this.prisma.participantScoringDigest.findUnique({
      where: { compatibilityKey },
      include: { artifact: true },
    });
    if (!row) return null;

    if (isCasStorageUri(row.artifact.storageUri)) {
      throw new ArtifactLegacyExternalPayloadMissingError(
        row.artifactId,
        row.artifact.storageUri,
      );
    }

    const bytes = await this.artifacts.readVerified(row.artifactId);
    const digest = assertParticipantScoringDigestV1(
      JSON.parse(bytes.toString("utf8")),
    );
    if (digest.contentHash !== row.contentHash) {
      throw new Error(
        `participant_digest_content_hash_mismatch:index=${row.contentHash} payload=${digest.contentHash}`,
      );
    }
    return {
      recordId: row.id,
      digest,
      artifactId: row.artifactId,
    };
  }

  async findCompatible(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    participantActorId: number;
    digestSchemaVersion: string;
    extractorCompatVersion: string;
    capabilityPackageContentHash: string;
    catalogVersion: string;
  }): Promise<{
    recordId: string;
    digest: ParticipantScoringDigestV1;
    artifactId: string;
  } | null> {
    const compatibilityKey = buildParticipantDigestCompatibilityKey(input);
    return this.findByCompatibilityKey(compatibilityKey);
  }

  async upsert(
    input: UpsertParticipantScoringDigestInput,
  ): Promise<{ id: string; created: boolean; compatibilityKey: string }> {
    const digest = assertParticipantScoringDigestV1(input.digest);
    const compatibilityKey = buildParticipantDigestCompatibilityKey({
      reportCode: digest.reportCode,
      fightId: digest.fightId,
      reportRevision: digest.reportRevision,
      participantActorId: digest.participantActorId,
      digestSchemaVersion: digest.schemaVersion,
      extractorCompatVersion: digest.extractorCompatVersion,
      capabilityPackageContentHash: digest.capabilityPackageContentHash,
      catalogVersion: digest.catalogVersion,
    });

    const existing = await this.prisma.participantScoringDigest.findUnique({
      where: { compatibilityKey },
      select: { id: true, contentHash: true },
    });
    if (existing) {
      if (existing.contentHash !== digest.contentHash) {
        await this.prisma.participantScoringDigest.update({
          where: { id: existing.id },
          data: {
            contentHash: digest.contentHash,
            artifactId: input.artifactId,
            characterId: digest.characterId,
            capabilityPackageArtifactId: digest.capabilityPackageArtifactId,
          },
        });
      }
      return { id: existing.id, created: false, compatibilityKey };
    }

    const created = await this.prisma.participantScoringDigest.create({
      data: {
        compatibilityKey,
        reportCode: digest.reportCode,
        fightId: digest.fightId,
        reportRevision: digest.reportRevision,
        participantActorId: digest.participantActorId,
        characterId: digest.characterId,
        digestSchemaVersion: digest.schemaVersion,
        extractorCompatVersion: digest.extractorCompatVersion,
        catalogVersion: digest.catalogVersion,
        capabilityPackageContentHash: digest.capabilityPackageContentHash,
        capabilityPackageArtifactId: digest.capabilityPackageArtifactId,
        contentHash: digest.contentHash,
        artifactId: input.artifactId,
      },
    });
    return { id: created.id, created: true, compatibilityKey };
  }
}
