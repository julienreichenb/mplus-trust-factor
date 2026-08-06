/**
 * Assemble a real CalibrationInputBundleV2 from a completed evidence export.
 * Provider-free. Uses export-time freezeSnapshot + verified CAS bytes only.
 * Never queries live EvidenceManifest, factSet, dimensionComputation, ScoreSnapshot,
 * Character, cohort members, ACTIVE model, or season current for evaluation.
 */
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import { CALIBRATION_LABEL_TO_QUALITATIVE } from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import {
  ArtifactDigestMismatchError,
  ArtifactMissingError,
  type ArtifactRepository,
} from "@mplus/database";
import {
  COHORT_MANIFEST_SCHEMA_VERSION,
  buildCalibrationContentRefV2,
  buildCalibrationInputBundleV2,
  computeArtifactSha256Hex,
  createMapArtifactResolverV2,
  freezeSnapshotModelToCalibrationRef,
  parseAndVerifyFreezeSnapshot,
  parseArtifactByteDigest,
  preflightCalibrationBundleV2,
  resolveFrozenDimensionConfigsForModel,
  type CalibrationContentRefV2,
  type CalibrationInputBundleV2,
  type CalibrationMemberReplayV2,
  type CalibrationPreflightIssueV2,
  type CalibrationRole,
  type CohortManifest,
  type FreezeSnapshotContentRefV2,
  type FreezeSnapshotV1,
  type QualitativeLabel,
  type ScoringPublicDimension,
} from "@mplus/scoring";
import type { ScoringIssueDTO } from "@mplus/contracts";

const PHASE1_DIMENSIONS: ScoringPublicDimension[] = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
];

export interface BundleFreezeBlocker {
  code: string;
  severity: "blocker" | "warning" | "info";
  message: string;
  memberId?: string | null;
}

export interface AssembleBundleV2Result {
  ok: boolean;
  blockers: BundleFreezeBlocker[];
  warnings: BundleFreezeBlocker[];
  bundle: CalibrationInputBundleV2 | null;
  /** Content-addressed bytes keyed by hash (for preflight resolver + persistence). */
  artifactBytes: Map<string, Buffer>;
}

function sha256Hex(bytes: Buffer | string): string {
  return computeArtifactSha256Hex(bytes);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function storeArtifactBytes(
  artifactBytes: Map<string, Buffer>,
  bytes: Buffer,
): string {
  const contentHash = sha256Hex(bytes);
  artifactBytes.set(contentHash, bytes);
  return contentHash;
}

async function persistRef(
  artifacts: ArtifactRepository,
  ownerId: string,
  artifactClass: string,
  value: unknown,
  artifactBytes: Map<string, Buffer>,
  dryRun: boolean,
  logicalContentHash?: string | null,
): Promise<CalibrationContentRefV2> {
  const json = canonicalJson(value);
  const bytes = Buffer.from(json, "utf8");
  const contentHash = storeArtifactBytes(artifactBytes, bytes);
  let storageUri: string | undefined;
  let byteLength = bytes.byteLength;
  if (!dryRun) {
    const write = await artifacts.persist({
      provider: "INTERNAL",
      bytes,
      compression: "NONE",
      artifactClass,
      owner: { ownerType: "CalibrationFrozenExport", ownerId },
    });
    storageUri = write.write.storageUri;
    byteLength = write.write.uncompressedSizeBytes;
    // Content-addressed store hash must match our durable byte digest.
    if (write.write.contentHash.toLowerCase() !== contentHash) {
      throw new Error(
        `artifact store contentHash mismatch: store=${write.write.contentHash} computed=${contentHash}`,
      );
    }
    artifactBytes.set(write.write.contentHash, bytes);
  }
  const schemaVersion =
    value && typeof value === "object" && "schemaVersion" in (value as object)
      ? String((value as { schemaVersion?: unknown }).schemaVersion ?? null)
      : null;
  return {
    ...buildCalibrationContentRefV2({
      bytes,
      artifactClass: artifactClass as CalibrationContentRefV2["artifactClass"],
      logicalContentHash: logicalContentHash ?? null,
      schemaVersion,
      storageUri,
    }),
    byteLength,
  };
}

function freezeRefToCalibrationRef(ref: FreezeSnapshotContentRefV2): CalibrationContentRefV2 {
  return {
    contentHash: ref.contentHash,
    logicalContentHash: ref.logicalContentHash,
    byteDigest: ref.byteDigest,
    digestAlgorithm: ref.digestAlgorithm,
    storageUri: ref.storageUri,
    byteLength: ref.byteLength,
    artifactClass: ref.artifactClass,
    schemaVersion: ref.schemaVersion,
  };
}

async function resolveEvidenceRef(input: {
  artifacts: ArtifactRepository;
  ref: FreezeSnapshotContentRefV2;
  artifactBytes: Map<string, Buffer>;
  memberId: string;
  blockers: BundleFreezeBlocker[];
}): Promise<CalibrationContentRefV2 | null> {
  const { ref, memberId, blockers, artifactBytes } = input;
  try {
    const bytes = await input.artifacts.readVerifiedByContentHash(ref.contentHash);
    const actualHex = sha256Hex(bytes).toLowerCase();
    if (actualHex !== ref.contentHash.toLowerCase()) {
      blockers.push({
        code: "ARTIFACT_DIGEST_MISMATCH",
        severity: "blocker",
        message: `CAS byte digest mismatch for ${ref.artifactClass} member ${memberId}`,
        memberId,
      });
      return null;
    }
    const parsedDigest = ref.byteDigest ? parseArtifactByteDigest(ref.byteDigest) : null;
    if (!parsedDigest || parsedDigest.hex !== actualHex) {
      blockers.push({
        code: "ARTIFACT_DIGEST_MISMATCH",
        severity: "blocker",
        message: `byteDigest mismatch for ${ref.artifactClass} member ${memberId}`,
        memberId,
      });
      return null;
    }
    if (typeof ref.byteLength === "number" && ref.byteLength !== bytes.byteLength) {
      blockers.push({
        code: "ARTIFACT_DIGEST_MISMATCH",
        severity: "blocker",
        message: `byteLength mismatch for ${ref.artifactClass} member ${memberId}`,
        memberId,
      });
      return null;
    }
    artifactBytes.set(actualHex, bytes);
    return freezeRefToCalibrationRef(ref);
  } catch (error) {
    if (error instanceof ArtifactMissingError) {
      blockers.push({
        code: "ARTIFACT_MISSING",
        severity: "blocker",
        message: `Missing CAS artifact ${ref.contentHash} for member ${memberId}`,
        memberId,
      });
      return null;
    }
    if (error instanceof ArtifactDigestMismatchError) {
      blockers.push({
        code: "ARTIFACT_DIGEST_MISMATCH",
        severity: "blocker",
        message: error.message.slice(0, 500),
        memberId,
      });
      return null;
    }
    blockers.push({
      code: "ARTIFACT_MISSING",
      severity: "blocker",
      message:
        error instanceof Error
          ? error.message.slice(0, 500)
          : `Failed to resolve CAS artifact for member ${memberId}`,
      memberId,
    });
    return null;
  }
}

function mapLabel(label: string): QualitativeLabel {
  const mapped =
    CALIBRATION_LABEL_TO_QUALITATIVE[
      label as keyof typeof CALIBRATION_LABEL_TO_QUALITATIVE
    ];
  if (mapped) return mapped;
  const lower = label.toLowerCase();
  if (
    lower === "excellent" ||
    lower === "good" ||
    lower === "average" ||
    lower === "weak" ||
    lower === "overrated"
  ) {
    return lower;
  }
  return "average";
}

function mapRole(role: string | null | undefined): CalibrationRole {
  if (role === "DPS" || role === "TANK" || role === "HEALER") return role;
  return "DPS";
}

function toIssueDto(issues: BundleFreezeBlocker[]): ScoringIssueDTO[] {
  return issues.map((i) => ({
    code: i.code,
    severity: i.severity,
    message: i.message,
    memberId: i.memberId ?? null,
  }));
}

export function mapPreflightIssuesToFreezeBlockers(
  issues: CalibrationPreflightIssueV2[],
): BundleFreezeBlocker[] {
  return issues.map((i) => ({
    code: i.code,
    severity:
      i.severity === "BLOCKING" ? "blocker" : i.severity === "WARNING" ? "warning" : "info",
    message: i.message,
    memberId: i.memberId,
  }));
}

function previousSnapshotIdFromBytes(bytes: Buffer | undefined): string | null {
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
  } catch {
    return null;
  }
}

/**
 * Build a complete CalibrationInputBundleV2 for an evidence export.
 * Does not mutate character/evidence/score rows. Provider-free.
 * Freeze inputs come exclusively from export-time freezeSnapshot + CAS.
 */
export async function assembleCalibrationInputBundleV2(input: {
  prisma: PrismaClient;
  artifacts: ArtifactRepository;
  exportId: string;
  evaluationModelId?: string | null;
  /** When true, evaluate eligibility without writing RawArtifact rows. */
  dryRun?: boolean;
}): Promise<AssembleBundleV2Result> {
  const blockers: BundleFreezeBlocker[] = [];
  const warnings: BundleFreezeBlocker[] = [];
  const artifactBytes = new Map<string, Buffer>();
  const dryRun = input.dryRun === true;

  const exportRow = await input.prisma.scoringEvidenceExport.findUnique({
    where: { id: input.exportId },
    include: {
      cohort: {
        select: {
          id: true,
          externalKey: true,
          name: true,
          description: true,
          createdAt: true,
          seasonId: true,
          revision: true,
        },
      },
    },
  });
  if (!exportRow) {
    return {
      ok: false,
      blockers: [{ code: "EXPORT_NOT_FOUND", severity: "blocker", message: "Evidence export not found" }],
      warnings: [],
      bundle: null,
      artifactBytes,
    };
  }
  if (exportRow.status !== "COMPLETED") {
    return {
      ok: false,
      blockers: [
        {
          code: "EXPORT_NOT_COMPLETED",
          severity: "blocker",
          message: "Evidence export must be COMPLETED before freeze",
        },
      ],
      warnings: [],
      bundle: null,
      artifactBytes,
    };
  }
  if (exportRow.blockerCount > 0) {
    blockers.push({
      code: "EXPORT_HAS_BLOCKERS",
      severity: "blocker",
      message: `Evidence export has ${exportRow.blockerCount} blocker(s)`,
    });
  }

  const snapshotParse = parseAndVerifyFreezeSnapshot(exportRow.freezeSnapshot);
  if (!snapshotParse.ok || !snapshotParse.snapshot) {
    const code =
      snapshotParse.code === "FREEZE_SNAPSHOT_HASH_MISMATCH"
        ? "FREEZE_SNAPSHOT_HASH_MISMATCH"
        : snapshotParse.code === "FREEZE_SNAPSHOT_INVALID"
          ? "FREEZE_SNAPSHOT_INVALID"
          : "FREEZE_SNAPSHOT_MISSING";
    return {
      ok: false,
      blockers: [
        {
          code,
          severity: "blocker",
          message: snapshotParse.message ?? "Freeze snapshot missing or corrupt",
        },
      ],
      warnings: [],
      bundle: null,
      artifactBytes,
    };
  }
  const snapshot: FreezeSnapshotV1 = snapshotParse.snapshot;

  const season = snapshot.season;
  if (!season.seasonId || !season.seasonSlug) {
    blockers.push({
      code: "SEASON_MISSING",
      severity: "blocker",
      message: "Season binding missing in freeze snapshot",
    });
  }

  const snapshotActive = snapshot.activeModel;
  if (!snapshotActive) {
    blockers.push({
      code: "ACTIVE_MODEL_MISSING",
      severity: "blocker",
      message: "No ACTIVE score model in freeze snapshot",
    });
  }

  // Evaluation model comes only from freezeSnapshot — never live ScoreModel.
  if (input.evaluationModelId) {
    if (!snapshot.evaluationModel || snapshot.evaluationModel.id !== input.evaluationModelId) {
      blockers.push({
        code: "EVALUATION_MODEL_NOT_IN_SNAPSHOT",
        severity: "blocker",
        message:
          "evaluationModelId must match freezeSnapshot.evaluationModel.id; re-export with evaluation model pinned",
      });
    }
  }
  const snapshotEvaluation = snapshot.evaluationModel;

  // Deterministic timestamps from export-time snapshot (not wall clock / live cohort).
  const generatedAt = snapshot.generatedAt;
  const evidenceCutoffAt = snapshot.evidenceCutoffAt;

  const cohortManifest: CohortManifest = {
    schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
    cohortId: snapshot.cohortExternalKey ?? snapshot.cohortId,
    description: snapshot.cohortDescription || snapshot.cohortName,
    createdAt: snapshot.cohortCreatedAt,
    members: snapshot.members.map((m) => ({
      id: m.externalMemberKey ?? m.id,
      region: m.region.toLowerCase(),
      realm: m.realmSlug.toLowerCase(),
      character: m.characterName,
      role: mapRole(m.role),
      classSlug: m.classSlug ?? "unknown",
      specSlug: m.specSlug ?? "unknown",
      expectedLabel: mapLabel(m.expectedLabel),
      meta: false,
      rationale: m.rationale,
      suspectedBoost: false,
      source: m.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
      seasonSlug: season.seasonSlug,
    })),
    notes: `Frozen from evidence export ${exportRow.id} at cohort revision ${snapshot.cohortRevision}`,
  };

  const replayMembers: CalibrationMemberReplayV2[] = [];

  for (const member of snapshot.members) {
    const memberId = member.id;
    const included = member.included && !member.exclusionCode;
    const expectedLabel = mapLabel(member.expectedLabel);
    const role = mapRole(member.role ?? null);
    const classSlug = member.classSlug;
    const specSlug = member.specSlug;

    if (!included) {
      const stub = {
        schemaVersion: "2.0.0",
        kind: "excluded-member-stub",
        memberId,
        exclusionCode: member.exclusionCode,
      };
      const stubRef = await persistRef(
        input.artifacts,
        exportRow.id,
        "evidence_manifest",
        stub,
        artifactBytes,
        dryRun,
      );
      replayMembers.push({
        memberId,
        characterId: member.characterId,
        expectedLabel,
        rationale: member.rationale,
        role,
        classSlug,
        specSlug,
        included: false,
        exclusionCode: member.exclusionCode,
        evidenceCutoffAt: member.evidenceCutoffAt ?? evidenceCutoffAt,
        manifest: stubRef,
        factSets: [],
        dimensionExports: {},
        previousSnapshotId: null,
      });
      continue;
    }

    if (!member.characterId || !season.seasonId) {
      blockers.push({
        code: "IDENTITY_MISSING",
        severity: "blocker",
        message: `Included member ${memberId} lacks character/season binding`,
        memberId,
      });
      continue;
    }

    const evidence = member.evidence;
    if (!evidence) {
      blockers.push({
        code: "EVIDENCE_PACKAGE_MISSING",
        severity: "blocker",
        message: `Included member ${memberId} lacks packaged evidence in freezeSnapshot`,
        memberId,
      });
      continue;
    }

    const manifestRef = await resolveEvidenceRef({
      artifacts: input.artifacts,
      ref: evidence.manifest,
      artifactBytes,
      memberId,
      blockers,
    });
    if (!manifestRef) continue;

    const factSets: CalibrationContentRefV2[] = [];
    for (const fsRef of evidence.factSets) {
      const resolved = await resolveEvidenceRef({
        artifacts: input.artifacts,
        ref: fsRef,
        artifactBytes,
        memberId,
        blockers,
      });
      if (resolved) factSets.push(resolved);
    }
    if (factSets.length === 0) {
      blockers.push({
        code: "FACT_SET_MISSING",
        severity: "blocker",
        message: `No fact sets for member ${memberId}`,
        memberId,
      });
      continue;
    }

    const dimensionExports: Partial<Record<ScoringPublicDimension, CalibrationContentRefV2>> =
      {};
    for (const dim of PHASE1_DIMENSIONS) {
      const dimRef = evidence.dimensionExports[dim];
      if (!dimRef) {
        blockers.push({
          code: "DIMENSION_EXPORT_MISSING",
          severity: "blocker",
          message: `Missing ${dim} dimension export for member ${memberId}`,
          memberId,
        });
        continue;
      }
      const resolved = await resolveEvidenceRef({
        artifacts: input.artifacts,
        ref: dimRef,
        artifactBytes,
        memberId,
        blockers,
      });
      if (resolved) dimensionExports[dim] = resolved;
    }

    let previousSnapshotId: string | null = null;
    if (evidence.previousSnapshot) {
      const prevRef = await resolveEvidenceRef({
        artifacts: input.artifacts,
        ref: evidence.previousSnapshot,
        artifactBytes,
        memberId,
        blockers,
      });
      if (prevRef) {
        previousSnapshotId = previousSnapshotIdFromBytes(
          artifactBytes.get(prevRef.contentHash),
        );
      }
    }

    if (blockers.some((b) => b.severity === "blocker" && b.memberId === memberId)) {
      continue;
    }

    replayMembers.push({
      memberId,
      characterId: member.characterId,
      expectedLabel,
      rationale: member.rationale,
      role,
      classSlug,
      specSlug,
      included: true,
      exclusionCode: null,
      evidenceCutoffAt: member.evidenceCutoffAt ?? evidenceCutoffAt,
      manifest: manifestRef,
      factSets,
      dimensionExports,
      previousSnapshotId,
    });
  }

  if (!snapshotActive || !season.seasonId || blockers.some((b) => b.severity === "blocker")) {
    return { ok: false, blockers, warnings, bundle: null, artifactBytes };
  }

  const activeRef = freezeSnapshotModelToCalibrationRef(snapshotActive);
  const evaluationRef = snapshotEvaluation
    ? freezeSnapshotModelToCalibrationRef({
        ...snapshotEvaluation,
        isActive: false,
      })
    : null;

  let activeDimensionConfigs = snapshotActive.dimensionConfigs;
  let evaluationDimensionConfigs = null as ReturnType<
    typeof resolveFrozenDimensionConfigsForModel
  > | null;
  if (!activeDimensionConfigs) {
    try {
      const mode =
        activeRef.config && "scoring" in activeRef.config && activeRef.config.scoring
          ? "calibration-strict"
          : "phase1-default";
      activeDimensionConfigs = resolveFrozenDimensionConfigsForModel(activeRef, mode);
    } catch (error) {
      blockers.push({
        code: "ACTIVE_CONFIG_INVALID",
        severity: "blocker",
        message: error instanceof Error ? error.message : "Active dimension configs invalid",
      });
    }
  }
  if (evaluationRef) {
    if (snapshotEvaluation?.dimensionConfigs) {
      evaluationDimensionConfigs = snapshotEvaluation.dimensionConfigs;
    } else {
      try {
        const mode =
          evaluationRef.config &&
          "scoring" in evaluationRef.config &&
          evaluationRef.config.scoring
            ? "calibration-strict"
            : "phase1-default";
        evaluationDimensionConfigs = resolveFrozenDimensionConfigsForModel(evaluationRef, mode);
      } catch (error) {
        blockers.push({
          code: "EVALUATION_CONFIG_INVALID",
          severity: "blocker",
          message: error instanceof Error ? error.message : "Evaluation dimension configs invalid",
        });
      }
    }
  }

  if (blockers.some((b) => b.severity === "blocker")) {
    return { ok: false, blockers, warnings, bundle: null, artifactBytes };
  }

  const policies = snapshot.policies;
  // Soft check: ability catalog pin still present in runtime (info only — snapshot wins).
  if (
    policies.abilityCatalogVersions.length > 0 &&
    !policies.abilityCatalogVersions.includes(CURRENT_CATALOG_VERSION_ID)
  ) {
    warnings.push({
      code: "ABILITY_CATALOG_DRIFT",
      severity: "warning",
      message: `Snapshot ability catalog differs from runtime ${CURRENT_CATALOG_VERSION_ID}`,
    });
  }

  let bundle: CalibrationInputBundleV2;
  try {
    const artifactPackageRef =
      artifactBytes.size > 0
        ? await persistRef(
            input.artifacts,
            exportRow.id,
            "other",
            {
              schemaVersion: "2.0.0",
              kind: "calibration-artifact-package-v2",
              entries: [...artifactBytes.entries()]
                .map(([contentHash, bytes]) => ({
                  contentHash,
                  byteLength: bytes.byteLength,
                  encoding: "utf8-json",
                  payload: bytes.toString("utf8"),
                }))
                .sort((a, b) => a.contentHash.localeCompare(b.contentHash)),
            },
            artifactBytes,
            dryRun,
          )
        : null;

    bundle = buildCalibrationInputBundleV2({
      generatedAt,
      evidenceCutoffAt,
      source: "persisted-export",
      mode: evaluationRef ? "active-versus-draft" : "persisted-snapshot-only",
      deterministicSeed: 0,
      cohort: cohortManifest,
      season: {
        seasonId: season.seasonId,
        seasonSlug: season.seasonSlug,
        region: season.region ?? null,
      },
      activeModel: activeRef,
      evaluationModel: evaluationRef,
      activeDimensionConfigs,
      evaluationDimensionConfigs,
      policies,
      members: replayMembers,
      artifactPackage: artifactPackageRef,
    });
  } catch (error) {
    blockers.push({
      code: "BUNDLE_BUILD_FAILED",
      severity: "blocker",
      message: error instanceof Error ? error.message.slice(0, 500) : "Bundle build failed",
    });
    return { ok: false, blockers, warnings, bundle: null, artifactBytes };
  }

  const resolver = createMapArtifactResolverV2(artifactBytes);
  const preflight = await preflightCalibrationBundleV2({
    bundle,
    resolver,
    requireCatalogVersions: true,
    requireByteIntegrity: true,
  });
  for (const issue of mapPreflightIssuesToFreezeBlockers(preflight.blocking)) {
    blockers.push(issue);
  }
  for (const issue of mapPreflightIssuesToFreezeBlockers(preflight.warnings)) {
    warnings.push(issue);
  }
  for (const issue of mapPreflightIssuesToFreezeBlockers(preflight.info)) {
    warnings.push(issue);
  }

  const ok = blockers.every((b) => b.severity !== "blocker") && preflight.ok;
  return {
    ok,
    blockers,
    warnings,
    bundle: ok ? bundle : null,
    artifactBytes,
  };
}

export { toIssueDto };
