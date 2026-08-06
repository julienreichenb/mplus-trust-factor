/**
 * One-time, idempotent backfill: CapabilityEvidencePackageRecord → WclRunRaw.
 * Provider-free. No Wallidrixe-specific identities. Safe to rerun.
 */
import {
  assertCapabilityEvidencePackageV1,
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  type CapabilityEvidencePackageV1,
} from "@mplus/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ArtifactLegacyExternalPayloadMissingError,
  createArtifactRepository,
} from "./repositories/artifact-repository.js";
import { WclRunRawRepository } from "./repositories/wcl-run-raw-repository.js";
import { CharacterRunDigestRepository } from "./repositories/character-run-digest-repository.js";
import { isCasStorageUri } from "./stores/postgres-artifact-store.js";

export interface ScoringCacheBackfillReport {
  packagesScanned: number;
  rawMigrated: number;
  rawReused: number;
  rawSkipped: number;
  rawInvalid: number;
  digestsMigrated: number;
  digestsReused: number;
  digestsSkipped: number;
  rankingsMigrated: number;
  rankingsSkipped: number;
  errors: Array<{ source: string; reason: string }>;
}

export interface ScoringCacheBackfillOptions {
  prisma: PrismaClient;
  /** Limit rows for dry diagnostics; omit for full backfill. */
  limit?: number;
  dryRun?: boolean;
  acquisitionVersion?: string;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function loadPackagePayload(
  prisma: PrismaClient,
  row: {
    id: string;
    artifactId: string;
    contentHash: string;
    complete: boolean;
  },
): Promise<CapabilityEvidencePackageV1 | null> {
  const artifact = await prisma.rawArtifact.findUnique({
    where: { id: row.artifactId },
  });
  if (!artifact) return null;
  if (isCasStorageUri(artifact.storageUri)) {
    throw new ArtifactLegacyExternalPayloadMissingError(
      row.artifactId,
      artifact.storageUri,
    );
  }
  const artifacts = createArtifactRepository(prisma);
  const bytes = await artifacts.readVerified(row.artifactId);
  const pkg = assertCapabilityEvidencePackageV1(
    JSON.parse(bytes.toString("utf8")),
  );
  if (pkg.contentHash !== row.contentHash) {
    throw new Error(
      `content_hash_mismatch:index=${row.contentHash} payload=${pkg.contentHash}`,
    );
  }
  return pkg;
}

/**
 * Migrate complete capability packages into WclRunRaw.
 * Optionally migrates participant digests when characterId is present.
 */
export async function backfillScoringMinimalCache(
  options: ScoringCacheBackfillOptions,
): Promise<ScoringCacheBackfillReport> {
  const acquisitionVersion =
    options.acquisitionVersion ?? CAPABILITY_ACQUISITION_PLAN_VERSION;
  const report: ScoringCacheBackfillReport = {
    packagesScanned: 0,
    rawMigrated: 0,
    rawReused: 0,
    rawSkipped: 0,
    rawInvalid: 0,
    digestsMigrated: 0,
    digestsReused: 0,
    digestsSkipped: 0,
    rankingsMigrated: 0,
    rankingsSkipped: 0,
    errors: [],
  };

  const rawRuns = new WclRunRawRepository(options.prisma);
  const digests = new CharacterRunDigestRepository(options.prisma);

  const packageRows = await options.prisma.capabilityEvidencePackageRecord.findMany({
    where: { complete: true },
    orderBy: { updatedAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      reportCode: true,
      fightId: true,
      reportRevision: true,
      artifactId: true,
      contentHash: true,
      complete: true,
      acquisitionPlanVersion: true,
      updatedAt: true,
    },
  });

  /** Newest package wins per source identity. */
  const seen = new Set<string>();

  for (const row of packageRows) {
    report.packagesScanned += 1;
    const key = `${row.reportCode}:${row.fightId}:${row.reportRevision}:${acquisitionVersion}`;
    if (seen.has(key)) {
      report.rawSkipped += 1;
      continue;
    }
    seen.add(key);

    let pkg: CapabilityEvidencePackageV1 | null = null;
    try {
      pkg = await loadPackagePayload(options.prisma, row);
    } catch (err) {
      report.rawInvalid += 1;
      report.errors.push({
        source: `package:${row.id}`,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!pkg || pkg.complete !== true) {
      report.rawInvalid += 1;
      report.errors.push({
        source: `package:${row.id}`,
        reason: "incomplete_or_unloadable",
      });
      continue;
    }

    const identity = {
      reportCode: pkg.sourceKey.reportCode,
      fightId: pkg.sourceKey.fightId,
      reportRevision: pkg.sourceKey.reportRevision,
      acquisitionVersion,
    };

    const existing = await rawRuns.find(identity);
    if (existing) {
      report.rawReused += 1;
    } else if (!options.dryRun) {
      await rawRuns.save({
        ...identity,
        payload: asJson(pkg),
        fetchedAt: row.updatedAt,
        providerCost: asJson({
          contentHash: pkg.contentHash,
          pagesFetched: pkg.accounting.pagesFetched,
          filterBatchCount: pkg.accounting.filterBatchCount,
          providerCalls: pkg.accounting.providerCalls,
          migratedFrom: "capability_evidence_package_records",
          legacyPackageRecordId: row.id,
        }),
      });
      report.rawMigrated += 1;
    } else {
      report.rawMigrated += 1;
    }

    const raw = existing ?? (options.dryRun ? null : await rawRuns.find(identity));
    if (!raw) {
      report.digestsSkipped += 1;
      continue;
    }

    // Migrate participant digests that have a stable characterId.
    const digestRows = await options.prisma.participantScoringDigest.findMany({
      where: {
        reportCode: identity.reportCode,
        fightId: identity.fightId,
        reportRevision: identity.reportRevision,
        characterId: { not: null },
      },
      select: {
        id: true,
        characterId: true,
        extractorCompatVersion: true,
        artifactId: true,
        contentHash: true,
      },
    });

    for (const digestRow of digestRows) {
      if (!digestRow.characterId) {
        report.digestsSkipped += 1;
        continue;
      }
      const extractorVersion = digestRow.extractorCompatVersion;
      const found = await digests.find({
        rawRunId: raw.id,
        characterId: digestRow.characterId,
        extractorVersion,
      });
      if (found) {
        report.digestsReused += 1;
        continue;
      }

      try {
        const artifacts = createArtifactRepository(options.prisma);
        const bytes = await artifacts.readVerified(digestRow.artifactId);
        const digestPayload = JSON.parse(bytes.toString("utf8")) as {
          performance?: unknown;
          utility?: unknown;
          survival?: unknown;
          participantActorId?: number;
          capabilityPackageContentHash?: string;
          catalogVersion?: string;
        };
        if (!options.dryRun) {
          await digests.save({
            rawRunId: raw.id,
            characterId: digestRow.characterId,
            extractorVersion,
            offensive: asJson(digestPayload.performance ?? {}),
            utility: asJson(digestPayload.utility ?? {}),
            survival: asJson(digestPayload.survival ?? {}),
            sourceMetadata: asJson({
              digest: digestPayload,
              participantActorId: digestPayload.participantActorId ?? null,
              capabilityPackageContentHash:
                digestPayload.capabilityPackageContentHash ?? null,
              catalogVersion: digestPayload.catalogVersion ?? null,
              migratedFrom: "participant_scoring_digests",
              legacyDigestRecordId: digestRow.id,
            }),
          });
        }
        report.digestsMigrated += 1;
      } catch (err) {
        report.digestsSkipped += 1;
        report.errors.push({
          source: `digest:${digestRow.id}`,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Ranking facts: only skip in this pass — unambiguous character+revision
    // ranking rows are rare in the legacy evidence store without actor mapping.
    report.rankingsSkipped += 1;
  }

  return report;
}
