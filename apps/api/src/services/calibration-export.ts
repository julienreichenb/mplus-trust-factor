import type { PrismaClient, ScoreModel } from "@mplus/database";
import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import {
  buildCalibrationInputBundle,
  createDefaultModelV6,
  hasReplayableScoringContext,
  type CalibrationBacktestMode,
  type CalibrationInputBundleV1,
  type CalibrationMemberEvidence,
  type CalibrationModelRef,
  type CalibrationRole,
  type CohortManifest,
  type QualitativeLabel,
  type ScoreModelConfigV1,
  COHORT_MANIFEST_SCHEMA_VERSION,
} from "@mplus/scoring";
import type { ScoreSnapshotWithRelations } from "@mplus/worker";
import { mapScoreSnapshot } from "../lib/mappers.js";

const DEFAULT_COHORT_LIMIT = 48;

export interface CalibrationExportDeps {
  prisma: PrismaClient;
  listObservations: (characterId: string, seasonId: string) => Promise<MetricObservationDTO[]>;
}

export interface BuildPersistedCalibrationBundleInput {
  evaluationModel: ScoreModel;
  activeModel: ScoreModel | null;
  /** Max distinct characters to include. */
  limit?: number;
  /** Optional explicit character IDs (admin cohort selection). */
  characterIds?: string[] | null;
  generatedAt?: string;
}

function asConfigV1(model: ScoreModel): ScoreModelConfigV1 {
  const raw = model.config as unknown as Partial<ScoreModelConfigV1>;
  // Admin drafts may only edit a subset of fields; merge onto the canonical v6 base
  // so Agent 10 harness / ablation receive a complete ScoreModelConfigV1.
  return createDefaultModelV6({
    ...raw,
    key: model.key,
    version: model.version,
  });
}

export function toCalibrationModelRef(model: ScoreModel, isActive: boolean): CalibrationModelRef {
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

function readCoverageNumber(
  explanation: unknown,
  key: "freshness" | "selectedRunCoverage",
): number | null {
  if (!explanation || typeof explanation !== "object") return null;
  const coverage = (explanation as { coverage?: unknown }).coverage;
  if (!coverage || typeof coverage !== "object") return null;
  const value = (coverage as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function labelFromScore(score: number | null, grade: string): QualitativeLabel {
  if (grade === "U" || score == null) return "weak";
  if (score >= 90) return "excellent";
  if (score >= 80) return "good";
  if (score >= 65) return "average";
  if (score >= 50) return "weak";
  return "overrated";
}

function roleOf(character: { role?: string | null }): CalibrationRole {
  if (character.role === "TANK" || character.role === "HEALER" || character.role === "DPS") {
    return character.role;
  }
  return "DPS";
}

/**
 * Build a portable CalibrationInputBundle from persisted public snapshots + observations.
 * Never enqueues providers. Prefers active-versus-draft when replay context is available.
 */
export type CalibrationExportDegradedReason =
  | "NO_PUBLIC_SNAPSHOTS"
  | "NO_REPLAYABLE_EVIDENCE"
  | "EVALUATION_NOT_DRAFT"
  | "NO_ACTIVE_MODEL";

export interface BuildPersistedCalibrationBundleResult {
  bundle: CalibrationInputBundleV1;
  mode: CalibrationBacktestMode;
  notes: string[];
  /** Present only when mode is persisted-snapshot-only for a genuine evidence reason. */
  degradedReason: CalibrationExportDegradedReason | null;
}

export async function buildPersistedCalibrationBundle(
  deps: CalibrationExportDeps,
  input: BuildPersistedCalibrationBundleInput,
): Promise<BuildPersistedCalibrationBundleResult> {
  const limit = input.limit ?? DEFAULT_COHORT_LIMIT;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const notes: string[] = [];

  const snapshots = await deps.prisma.scoreSnapshot.findMany({
    where: {
      isPublic: true,
      publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
      scopeType: "CHARACTER",
      ...(input.characterIds?.length
        ? { characterId: { in: input.characterIds } }
        : {}),
    },
    include: {
      dimensionScores: true,
      scoreModel: true,
      season: true,
      character: {
        include: {
          region: true,
          realm: true,
          gameClass: true,
          activeSpec: true,
        },
      },
    },
    orderBy: { calculatedAt: "desc" },
    take: Math.max(limit * 3, limit),
  });

  const seenCharacters = new Set<string>();
  const selected: typeof snapshots = [];
  for (const snap of snapshots) {
    if (seenCharacters.has(snap.characterId)) continue;
    seenCharacters.add(snap.characterId);
    selected.push(snap);
    if (selected.length >= limit) break;
  }

  if (selected.length === 0) {
    notes.push("No persisted public CHARACTER score snapshots available for cohort export.");
    const emptyManifest: CohortManifest = {
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: `empty-persisted-${generatedAt.slice(0, 10)}`,
      description: "No public score snapshots found.",
      createdAt: generatedAt,
      members: [],
    };
    const bundle = buildCalibrationInputBundle({
      manifest: emptyManifest,
      evidenceByMemberId: {},
      activeModel: input.activeModel
        ? toCalibrationModelRef(input.activeModel, true)
        : undefined,
      evaluationModel: toCalibrationModelRef(input.evaluationModel, false),
      generatedAt,
      source: "persisted-export",
      mode: "persisted-snapshot-only",
    });
    return {
      bundle,
      mode: "persisted-snapshot-only",
      notes,
      degradedReason: "NO_PUBLIC_SNAPSHOTS",
    };
  }

  const evidenceByMemberId: Record<string, CalibrationMemberEvidence> = {};
  const members: CohortManifest["members"] = [];
  let replayableCount = 0;

  for (const snap of selected) {
    const memberId = snap.characterId;
    const character = snap.character;
    const dto = mapScoreSnapshot(snap as ScoreSnapshotWithRelations);
    const observations = await deps.listObservations(snap.characterId, snap.seasonId);
    const freshness = readCoverageNumber(snap.explanation, "freshness");
    const selectedRunCoverage = readCoverageNumber(snap.explanation, "selectedRunCoverage");
    const role = roleOf(character);
    const scoringContext =
      freshness != null && selectedRunCoverage != null
        ? {
            role,
            classSlug: character.gameClass?.slug ?? null,
            specSlug: character.activeSpec?.slug ?? null,
            freshness,
            selectedRunCoverage,
          }
        : null;

    const evidence: CalibrationMemberEvidence = {
      memberId,
      characterId: snap.characterId,
      snapshotId: snap.id,
      snapshot: dto as ScoreSnapshotDTO,
      observations: observations.length > 0 ? observations : null,
      scoringContext,
      calculatedAt: snap.calculatedAt.toISOString(),
      inputFingerprint: snap.inputFingerprint,
      seasonSlug: snap.season.slug,
      evidenceCoverage: {
        selectedRunCoverage,
        analyzedRunCoverage: null,
        modelCoverageRatio:
          typeof dto.modelCoverageRatio === "number" ? dto.modelCoverageRatio : null,
        availableModelWeight:
          typeof dto.availableModelWeight === "number" ? dto.availableModelWeight : null,
        totalModelWeight: typeof dto.totalModelWeight === "number" ? dto.totalModelWeight : null,
        utilityEvidenceCoverage: null,
        dimensionAvailabilityRatio:
          dto.dimensions.length === 0
            ? null
            : dto.dimensions.filter((d: { score: number | null }) => d.score != null).length /
              dto.dimensions.length,
      },
      coverageRefresh: {
        coverageState: snap.coverageState,
        publicationStatus: snap.publicationStatus,
        refreshState: null,
        providerDataAsOf: snap.providerDataAsOf?.toISOString() ?? null,
        scoreFreshness: null,
      },
    };

    if (
      observations.length > 0 &&
      hasReplayableScoringContext(scoringContext)
    ) {
      replayableCount += 1;
    }

    evidenceByMemberId[memberId] = evidence;
    members.push({
      id: memberId,
      region: character.region.code,
      realm: character.realm.slug,
      character: character.displayName,
      role,
      classSlug: character.gameClass?.slug ?? "unknown",
      specSlug: character.activeSpec?.slug ?? "unknown",
      expectedLabel: labelFromScore(Number(snap.overallScore), snap.grade),
      meta: false,
      rationale: "Persisted public snapshot export for admin backtest.",
      suspectedBoost: false,
      source: "stratified-auto",
      seasonSlug: snap.season.slug,
      snapshotIds: [snap.id],
    });
  }

  const canCompare =
    Boolean(input.activeModel) &&
    input.evaluationModel.status === "DRAFT" &&
    replayableCount > 0;

  let degradedReason: CalibrationExportDegradedReason | null = null;
  if (!canCompare) {
    if (replayableCount === 0) {
      degradedReason = "NO_REPLAYABLE_EVIDENCE";
    } else if (!input.activeModel) {
      degradedReason = "NO_ACTIVE_MODEL";
    } else if (input.evaluationModel.status !== "DRAFT") {
      degradedReason = "EVALUATION_NOT_DRAFT";
    }
  }

  const mode: CalibrationBacktestMode = canCompare
    ? "active-versus-draft"
    : "persisted-snapshot-only";

  if (canCompare) {
    notes.push(
      `Real cohort export: ${members.length} characters, ${replayableCount} replayable for active-versus-draft.`,
    );
  } else if (degradedReason === "NO_REPLAYABLE_EVIDENCE") {
    notes.push(
      `Real cohort export: ${members.length} public snapshots (persisted-snapshot-only; no replayable scoringContext/observations for draft compare).`,
    );
  } else {
    notes.push(
      `Real cohort export: ${members.length} public snapshots (persisted-snapshot-only; ${degradedReason ?? "unspecified"}).`,
    );
  }

  const bundle = buildCalibrationInputBundle({
    manifest: {
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: `persisted-admin-${generatedAt.slice(0, 10)}`,
      description: "Exported from public ScoreSnapshot rows for admin model backtest.",
      createdAt: generatedAt,
      members,
    },
    evidenceByMemberId,
    activeModel: input.activeModel
      ? toCalibrationModelRef(input.activeModel, true)
      : undefined,
    evaluationModel: toCalibrationModelRef(input.evaluationModel, false),
    generatedAt,
    source: "persisted-export",
    mode,
  });

  return { bundle, mode, notes, degradedReason };
}
