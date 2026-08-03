/**
 * Export-time packaging of freeze-relevant evidence into CAS.
 * Live EvidenceManifest / fact sets / dimensions / snapshots are read ONLY here;
 * freeze assembles exclusively from freezeSnapshot refs + verified CAS bytes.
 */
import type { ArtifactRepository, PrismaClient } from "@mplus/database";
import {
  buildCalibrationContentRefV2,
  computeArtifactSha256Hex,
  type CalibrationContentRefV2,
  type FreezeSnapshotContentRefV2,
  type FreezeSnapshotMemberEvidenceV2,
  type ScoringV2PublicDimension,
} from "@mplus/scoring";

const PHASE1_DIMENSIONS: ScoringV2PublicDimension[] = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
];

export interface FreezeEvidencePackageBlocker {
  code: string;
  severity: "blocker" | "warning" | "info";
  message: string;
  memberId?: string | null;
}

export interface PackageMemberEvidenceInput {
  prisma: PrismaClient;
  artifacts: ArtifactRepository;
  exportId: string;
  member: {
    id: string;
    characterId: string | null;
    included: boolean;
    exclusionCode: string | null;
  };
  seasonId: string;
  activeModelId: string | null;
  /** When true, compute refs without writing new RawArtifact rows. */
  dryRun?: boolean;
}

export interface PackageMemberEvidenceResult {
  ok: boolean;
  blockers: FreezeEvidencePackageBlocker[];
  evidence: FreezeSnapshotMemberEvidenceV2 | null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function toFreezeRef(ref: CalibrationContentRefV2): FreezeSnapshotContentRefV2 {
  return {
    contentHash: ref.contentHash,
    logicalContentHash: ref.logicalContentHash ?? null,
    byteDigest: ref.byteDigest ?? `sha256:${ref.contentHash}`,
    digestAlgorithm: "sha256",
    artifactClass: ref.artifactClass,
    schemaVersion: ref.schemaVersion ?? null,
    byteLength: ref.byteLength ?? 0,
    storageUri: ref.storageUri ?? null,
  };
}

async function persistCanonicalJson(input: {
  artifacts: ArtifactRepository;
  exportId: string;
  artifactClass: CalibrationContentRefV2["artifactClass"];
  value: unknown;
  logicalContentHash?: string | null;
  schemaVersion?: string | null;
  dryRun: boolean;
}): Promise<FreezeSnapshotContentRefV2> {
  const bytes = Buffer.from(canonicalJson(input.value), "utf8");
  let storageUri: string | null = null;
  let byteLength = bytes.byteLength;
  if (!input.dryRun) {
    const write = await input.artifacts.persist({
      provider: "INTERNAL",
      bytes,
      compression: "NONE",
      artifactClass: input.artifactClass,
      owner: { ownerType: "CalibrationFrozenExport", ownerId: input.exportId },
    });
    const expected = computeArtifactSha256Hex(bytes);
    if (write.write.contentHash.toLowerCase() !== expected) {
      throw new Error(
        `artifact store contentHash mismatch: store=${write.write.contentHash} computed=${expected}`,
      );
    }
    storageUri = write.write.storageUri;
    byteLength = write.write.uncompressedSizeBytes;
  }
  return toFreezeRef(
    buildCalibrationContentRefV2({
      bytes,
      artifactClass: input.artifactClass,
      logicalContentHash: input.logicalContentHash ?? null,
      schemaVersion: input.schemaVersion ?? null,
      storageUri,
    }),
  );
}

/**
 * Package freeze-relevant evidence for one cohort member into CAS + content refs.
 * Excluded members return evidence: null. Included members require a full package.
 */
export async function packageMemberEvidenceForFreeze(
  input: PackageMemberEvidenceInput,
): Promise<PackageMemberEvidenceResult> {
  const blockers: FreezeEvidencePackageBlocker[] = [];
  const memberId = input.member.id;
  const dryRun = input.dryRun === true;
  const included = input.member.included && !input.member.exclusionCode;

  if (!included) {
    return { ok: true, blockers: [], evidence: null };
  }

  if (!input.member.characterId || !input.seasonId) {
    blockers.push({
      code: "IDENTITY_MISSING",
      severity: "blocker",
      message: `Included member ${memberId} lacks character/season binding`,
      memberId,
    });
    return { ok: false, blockers, evidence: null };
  }

  const characterId = input.member.characterId;
  const seasonId = input.seasonId;

  const manifest = await input.prisma.evidenceManifest.findFirst({
    where: { characterId, seasonId },
    orderBy: { frozenAt: "desc" },
    include: {
      slots: {
        include: {
          factSets: true,
        },
      },
    },
  });

  if (!manifest) {
    blockers.push({
      code: "MANIFEST_MISSING",
      severity: "blocker",
      message: `No EvidenceManifestV2 for member ${memberId}`,
      memberId,
    });
    return { ok: false, blockers, evidence: null };
  }
  if (!manifest.contentHash || !/^[a-f0-9]{64}$/i.test(manifest.contentHash)) {
    blockers.push({
      code: "MANIFEST_HASH_INVALID",
      severity: "blocker",
      message: `EvidenceManifest content hash missing/invalid for member ${memberId}`,
      memberId,
    });
    return { ok: false, blockers, evidence: null };
  }

  const documentLogical =
    manifest.document &&
    typeof manifest.document === "object" &&
    manifest.document !== null &&
    "contentHash" in (manifest.document as object)
      ? String((manifest.document as { contentHash?: unknown }).contentHash ?? "")
      : "";
  if (
    documentLogical &&
    documentLogical.toLowerCase() !== manifest.contentHash.toLowerCase()
  ) {
    blockers.push({
      code: "MANIFEST_LOGICAL_HASH_MISMATCH",
      severity: "blocker",
      message: `Manifest document.contentHash does not match logical contentHash for member ${memberId}`,
      memberId,
    });
    return { ok: false, blockers, evidence: null };
  }

  let manifestRef: FreezeSnapshotContentRefV2;
  try {
    manifestRef = await persistCanonicalJson({
      artifacts: input.artifacts,
      exportId: input.exportId,
      artifactClass: "evidence_manifest",
      value: manifest.document,
      logicalContentHash: manifest.contentHash.toLowerCase(),
      schemaVersion: manifest.schemaVersion,
      dryRun,
    });
  } catch (error) {
    blockers.push({
      code: "MANIFEST_STORE_HASH_MISMATCH",
      severity: "blocker",
      message:
        error instanceof Error
          ? error.message.slice(0, 500)
          : `Artifact store hash mismatch for manifest member ${memberId}`,
      memberId,
    });
    return { ok: false, blockers, evidence: null };
  }

  const factSets: FreezeSnapshotContentRefV2[] = [];
  for (const slot of manifest.slots) {
    for (const fs of slot.factSets) {
      const payload = {
        schemaVersion: fs.schemaVersion,
        extractorFamily: fs.extractorFamily,
        extractorVersion: fs.extractorVersion,
        inputFingerprint: fs.inputFingerprint,
        facts: fs.facts,
        coverage: fs.coverage,
        limitations: fs.limitations,
        computedAt: fs.computedAt.toISOString(),
      };
      factSets.push(
        await persistCanonicalJson({
          artifacts: input.artifacts,
          exportId: input.exportId,
          artifactClass: "run_fact_set",
          value: payload,
          schemaVersion: fs.schemaVersion,
          dryRun,
        }),
      );
    }
  }
  if (factSets.length === 0) {
    blockers.push({
      code: "FACT_SET_MISSING",
      severity: "blocker",
      message: `No fact sets for member ${memberId}`,
      memberId,
    });
    return { ok: false, blockers, evidence: null };
  }

  const dims = await input.prisma.dimensionComputation.findMany({
    where: {
      characterId,
      seasonId,
      manifestId: manifest.id,
      ...(input.activeModelId ? { scoreModelId: input.activeModelId } : {}),
    },
  });
  const dimensionExports: Partial<
    Record<ScoringV2PublicDimension, FreezeSnapshotContentRefV2>
  > = {};
  for (const dim of dims) {
    const publicDim = dim.dimension as ScoringV2PublicDimension;
    if (!PHASE1_DIMENSIONS.includes(publicDim)) continue;
    const exportDoc = {
      schemaVersion: "2.0.0",
      dimension: publicDim,
      algorithmVersion: dim.algorithmVersion,
      inputFingerprint: dim.inputFingerprint,
      score: dim.score != null ? Number(dim.score) : null,
      confidence: Number(dim.confidence),
      state: dim.state,
      metrics: dim.metrics,
      explanation: dim.explanation,
      computedAt: dim.computedAt.toISOString(),
    };
    dimensionExports[publicDim] = await persistCanonicalJson({
      artifacts: input.artifacts,
      exportId: input.exportId,
      artifactClass: "dimension_replay_export",
      value: exportDoc,
      schemaVersion: "2.0.0",
      dryRun,
    });
  }
  for (const required of PHASE1_DIMENSIONS) {
    if (!dimensionExports[required]) {
      blockers.push({
        code: "DIMENSION_EXPORT_MISSING",
        severity: "blocker",
        message: `Missing ${required} dimension export for member ${memberId}`,
        memberId,
      });
    }
  }
  if (blockers.some((b) => b.severity === "blocker")) {
    return { ok: false, blockers, evidence: null };
  }

  const previousSnapshotRow = await input.prisma.scoreSnapshot.findFirst({
    where: {
      characterId,
      seasonId,
      isPublic: true,
      publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
      scopeType: "CHARACTER",
    },
    orderBy: { calculatedAt: "desc" },
    select: {
      id: true,
      characterId: true,
      seasonId: true,
      scoreModelId: true,
      scopeType: true,
      scopeKey: true,
      overallScore: true,
      grade: true,
      skillScore: true,
      authenticityScore: true,
      confidence: true,
      calculatedAt: true,
      inputFingerprint: true,
      explanation: true,
      publicationStatus: true,
      isPublic: true,
      evidenceManifestId: true,
    },
  });

  let previousSnapshot: FreezeSnapshotContentRefV2 | null = null;
  if (previousSnapshotRow) {
    const payload = {
      schemaVersion: "score-snapshot-export-v1",
      id: previousSnapshotRow.id,
      characterId: previousSnapshotRow.characterId,
      seasonId: previousSnapshotRow.seasonId,
      scoreModelId: previousSnapshotRow.scoreModelId,
      scopeType: previousSnapshotRow.scopeType,
      scopeKey: previousSnapshotRow.scopeKey,
      overallScore: Number(previousSnapshotRow.overallScore),
      grade: previousSnapshotRow.grade,
      skillScore: Number(previousSnapshotRow.skillScore),
      authenticityScore: Number(previousSnapshotRow.authenticityScore),
      confidence: Number(previousSnapshotRow.confidence),
      calculatedAt: previousSnapshotRow.calculatedAt.toISOString(),
      inputFingerprint: previousSnapshotRow.inputFingerprint,
      explanation: previousSnapshotRow.explanation,
      publicationStatus: previousSnapshotRow.publicationStatus,
      isPublic: previousSnapshotRow.isPublic,
      evidenceManifestId: previousSnapshotRow.evidenceManifestId,
    };
    // "other" is the allowed CalibrationContentRef class for snapshot payloads.
    previousSnapshot = await persistCanonicalJson({
      artifacts: input.artifacts,
      exportId: input.exportId,
      artifactClass: "other",
      value: payload,
      schemaVersion: "score-snapshot-export-v1",
      dryRun,
    });
  }

  return {
    ok: true,
    blockers,
    evidence: {
      manifest: manifestRef,
      factSets,
      dimensionExports,
      previousSnapshot,
    },
  };
}
