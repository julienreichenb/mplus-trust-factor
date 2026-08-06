/**
 * Durable CapabilityEvidencePackageV1 index + verified pg:// reload.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assertCapabilityEvidencePackageV1,
  type CapabilityEvidencePackageV1,
} from "@mplus/contracts";
import {
  ArtifactLegacyExternalPayloadMissingError,
  type ArtifactRepository,
} from "./artifact-repository.js";
import { isCasStorageUri } from "../stores/postgres-artifact-store.js";

export interface UpsertCapabilityEvidencePackageInput {
  package: CapabilityEvidencePackageV1;
  packageArtifactId: string;
  contentHash: string;
}

export class CapabilityEvidencePackageRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly artifacts: ArtifactRepository,
  ) {}

  private async loadVerifiedRow(row: {
    id: string;
    artifactId: string;
    contentHash: string;
    complete: boolean;
    artifact: { storageUri: string };
  }): Promise<{
    recordId: string;
    package: CapabilityEvidencePackageV1;
    packageArtifactId: string;
    contentHash: string;
    complete: boolean;
  } | null> {
    if (isCasStorageUri(row.artifact.storageUri)) {
      throw new ArtifactLegacyExternalPayloadMissingError(
        row.artifactId,
        row.artifact.storageUri,
      );
    }

    const bytes = await this.artifacts.readVerified(row.artifactId);
    const pkg = assertCapabilityEvidencePackageV1(
      JSON.parse(bytes.toString("utf8")),
    );
    if (pkg.contentHash !== row.contentHash) {
      throw new Error(
        `capability_package_content_hash_mismatch:index=${row.contentHash} payload=${pkg.contentHash}`,
      );
    }
    return {
      recordId: row.id,
      package: pkg,
      packageArtifactId: row.artifactId,
      contentHash: row.contentHash,
      complete: row.complete && pkg.complete,
    };
  }

  async findByCompatibilityKey(
    compatibilityKey: string,
  ): Promise<{
    recordId: string;
    package: CapabilityEvidencePackageV1;
    packageArtifactId: string;
    contentHash: string;
    complete: boolean;
  } | null> {
    const row = await this.prisma.capabilityEvidencePackageRecord.findUnique({
      where: { compatibilityKey },
      include: { artifact: true },
    });
    if (!row) return null;
    return this.loadVerifiedRow(row);
  }

  /**
   * Newest complete package for a source fight (updatedAt DESC).
   * Incomplete packages are never treated as reusable cache hits.
   */
  async findCompleteBySourceFight(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
  }): Promise<{
    recordId: string;
    package: CapabilityEvidencePackageV1;
    packageArtifactId: string;
    contentHash: string;
  } | null> {
    const rows = await this.prisma.capabilityEvidencePackageRecord.findMany({
      where: {
        reportCode: input.reportCode,
        fightId: input.fightId,
        reportRevision: input.reportRevision,
        complete: true,
      },
      orderBy: { updatedAt: "desc" },
      include: { artifact: true },
      take: 1,
    });
    if (rows.length === 0) return null;
    const loaded = await this.loadVerifiedRow(rows[0]!);
    if (!loaded || !loaded.complete) return null;
    return {
      recordId: loaded.recordId,
      package: loaded.package,
      packageArtifactId: loaded.packageArtifactId,
      contentHash: loaded.contentHash,
    };
  }

  async upsertIndex(
    input: UpsertCapabilityEvidencePackageInput,
  ): Promise<{ id: string; created: boolean }> {
    const pkg = assertCapabilityEvidencePackageV1(input.package);

    const existing = await this.prisma.capabilityEvidencePackageRecord.findUnique({
      where: { compatibilityKey: pkg.compatibilityKey },
      select: { id: true, contentHash: true },
    });
    if (existing) {
      if (existing.contentHash !== input.contentHash) {
        await this.prisma.capabilityEvidencePackageRecord.update({
          where: { id: existing.id },
          data: {
            contentHash: input.contentHash,
            artifactId: input.packageArtifactId,
            participantActorIds: pkg.friendlyPlayerActorIds,
            complete: pkg.complete,
            actorSetHash: pkg.actorSetHash,
            abilityFilterHash: pkg.abilityFilterHash,
            catalogVersion: pkg.catalogVersion,
          },
        });
      }
      return { id: existing.id, created: false };
    }

    const created = await this.prisma.capabilityEvidencePackageRecord.create({
      data: {
        compatibilityKey: pkg.compatibilityKey,
        reportCode: pkg.sourceKey.reportCode,
        fightId: pkg.sourceKey.fightId,
        reportRevision: pkg.sourceKey.reportRevision,
        actorSetHash: pkg.actorSetHash,
        abilityFilterHash: pkg.abilityFilterHash,
        catalogVersion: pkg.catalogVersion,
        acquisitionPlanVersion: pkg.acquisitionPlanVersion,
        graphqlQueryVersion: pkg.graphqlQueryVersion,
        mode: pkg.mode,
        contentHash: input.contentHash,
        artifactId: input.packageArtifactId,
        participantActorIds: pkg.friendlyPlayerActorIds,
        complete: pkg.complete,
        legacySupersedesKey: null,
      },
    });
    return { id: created.id, created: true };
  }
}
