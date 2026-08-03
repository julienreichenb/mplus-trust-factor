/**
 * Assemble a real CalibrationInputBundleV2 from a completed evidence export.
 * Provider-free. Uses export-time freezeSnapshot (not live ACTIVE/cohort).
 * Verifies artifact integrity before freeze. No refresh enqueue.
 */
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import { CALIBRATION_LABEL_TO_QUALITATIVE } from "@mplus/contracts";
import type { PrismaClient, ScoreModel } from "@mplus/database";
import type { ArtifactRepository } from "@mplus/database";
import {
  COHORT_MANIFEST_SCHEMA_VERSION,
  buildCalibrationContentRefV2,
  buildCalibrationInputBundleV2,
  computeArtifactSha256Hex,
  createMapArtifactResolverV2,
  freezeSnapshotModelToCalibrationRef,
  parseAndVerifyFreezeSnapshot,
  preflightCalibrationBundleV2,
  resolveFrozenDimensionConfigsForModel,
  type CalibrationContentRefV2,
  type CalibrationInputBundleV2,
  type CalibrationMemberReplayV2,
  type CalibrationModelRef,
  type CalibrationPreflightIssueV2,
  type CalibrationRole,
  type CohortManifest,
  type FreezeSnapshotV1,
  type QualitativeLabel,
  type ScoringV2PublicDimension,
  createDefaultModelV6,
  type ScoreModelConfigV1,
} from "@mplus/scoring";
import type { ScoringV2IssueDTO } from "@mplus/contracts";

const PHASE1_DIMENSIONS: ScoringV2PublicDimension[] = [
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

function asConfigV1(model: ScoreModel): ScoreModelConfigV1 {
  const raw = model.config as unknown as Partial<ScoreModelConfigV1>;
  return createDefaultModelV6({
    ...raw,
    key: model.key,
    version: model.version,
  });
}

function toModelRef(model: ScoreModel, isActive: boolean): CalibrationModelRef {
  const status =
    model.status === "DRAFT" || model.status === "ACTIVE" || model.status === "ARCHIVED"
      ? model.status
      : "FIXTURE";
  return {
    id: model.id,
    key: model.key,
    version: model.version,
    status: isActive ? "ACTIVE" : status === "ACTIVE" ? "DRAFT" : status,
    config: asConfigV1(model),
    isActive,
  };
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

function toIssueDto(issues: BundleFreezeBlocker[]): ScoringV2IssueDTO[] {
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

/**
 * Build a complete CalibrationInputBundleV2 for an evidence export.
 * Does not mutate character/evidence/score rows. Provider-free.
 * Freeze inputs come exclusively from export-time freezeSnapshot.
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

  const exportRow = await input.prisma.scoringV2EvidenceExport.findUnique({
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

  let evaluationModel: ScoreModel | null = null;
  if (input.evaluationModelId) {
    evaluationModel = await input.prisma.scoreModel.findUnique({
      where: { id: input.evaluationModelId },
    });
    if (!evaluationModel) {
      blockers.push({
        code: "EVALUATION_MODEL_MISSING",
        severity: "blocker",
        message: "Selected evaluation model was not found",
      });
    }
  }

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
  const activeModelId = snapshotActive?.id ?? null;

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

    const manifest = await input.prisma.evidenceManifest.findFirst({
      where: { characterId: member.characterId, seasonId: season.seasonId },
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
      continue;
    }
    if (!manifest.contentHash || !/^[a-f0-9]{64}$/i.test(manifest.contentHash)) {
      blockers.push({
        code: "MANIFEST_HASH_INVALID",
        severity: "blocker",
        message: `EvidenceManifest content hash missing/invalid for member ${memberId}`,
        memberId,
      });
      continue;
    }

    // EvidenceManifest.contentHash is the logical domain identity (hash-input schema).
    // Durable CAS key is the sha256 of exact serialized document bytes.
    const manifestBytes = Buffer.from(canonicalJson(manifest.document), "utf8");
    const byteDigestHex = storeArtifactBytes(artifactBytes, manifestBytes);
    if (sha256Hex(manifestBytes) !== byteDigestHex) {
      blockers.push({
        code: "MANIFEST_BYTE_DIGEST_MISMATCH",
        severity: "blocker",
        message: `Manifest byte digest mismatch for member ${memberId}`,
        memberId,
      });
      continue;
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
      continue;
    }
    if (!dryRun) {
      const write = await input.artifacts.persist({
        provider: "INTERNAL",
        bytes: manifestBytes,
        compression: "NONE",
        artifactClass: "evidence_manifest",
        owner: { ownerType: "CalibrationFrozenExport", ownerId: exportRow.id },
      });
      if (write.write.contentHash.toLowerCase() !== byteDigestHex) {
        blockers.push({
          code: "MANIFEST_STORE_HASH_MISMATCH",
          severity: "blocker",
          message: `Artifact store hash mismatch for manifest member ${memberId}`,
          memberId,
        });
        continue;
      }
    }

    const manifestRef = buildCalibrationContentRefV2({
      bytes: manifestBytes,
      artifactClass: "evidence_manifest",
      logicalContentHash: manifest.contentHash.toLowerCase(),
      schemaVersion: manifest.schemaVersion,
    });

    const factSets: CalibrationContentRefV2[] = [];
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
        const ref = await persistRef(
          input.artifacts,
          exportRow.id,
          "run_fact_set",
          payload,
          artifactBytes,
          dryRun,
        );
        factSets.push(ref);
      }
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

    const dims = await input.prisma.dimensionComputation.findMany({
      where: {
        characterId: member.characterId,
        seasonId: season.seasonId,
        manifestId: manifest.id,
        ...(activeModelId ? { scoreModelId: activeModelId } : {}),
      },
    });
    const dimensionExports: Partial<Record<ScoringV2PublicDimension, CalibrationContentRefV2>> = {};
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
      dimensionExports[publicDim] = await persistRef(
        input.artifacts,
        exportRow.id,
        "dimension_replay_export",
        exportDoc,
        artifactBytes,
        dryRun,
      );
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

    const previousSnapshot = await input.prisma.scoreSnapshot.findFirst({
      where: {
        characterId: member.characterId,
        seasonId: season.seasonId,
        isPublic: true,
        publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
        scopeType: "CHARACTER",
      },
      orderBy: { calculatedAt: "desc" },
      select: { id: true },
    });

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
      previousSnapshotId: previousSnapshot?.id ?? null,
    });
  }

  if (!snapshotActive || !season.seasonId || blockers.some((b) => b.severity === "blocker")) {
    return { ok: false, blockers, warnings, bundle: null, artifactBytes };
  }

  const activeRef = freezeSnapshotModelToCalibrationRef(snapshotActive);
  const evaluationRef = evaluationModel ? toModelRef(evaluationModel, false) : null;

  let activeDimensionConfigs = snapshotActive.dimensionConfigs;
  let evaluationDimensionConfigs = null as ReturnType<
    typeof resolveFrozenDimensionConfigsForModel
  > | null;
  if (!activeDimensionConfigs) {
    try {
      const mode =
        activeRef.config && "scoringV2" in activeRef.config && activeRef.config.scoringV2
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
    try {
      const mode =
        evaluationRef.config &&
        "scoringV2" in evaluationRef.config &&
        evaluationRef.config.scoringV2
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

