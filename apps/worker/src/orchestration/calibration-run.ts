import { createHash } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import {
  CALIBRATION_EVIDENCE_SOURCE_CANONICAL,
  type CalibrationRunJob,
  type Grade,
  type ScoreSnapshotDTO,
} from "@mplus/contracts";
import {
  runCalibrationHarnessFromBundle,
  buildCalibrationDigestV1,
  buildCalibrationStatistics,
  CALIBRATION_REPORT_SCHEMA_VERSION,
  LABEL_RANK,
  type CalibrationBacktestMode,
  type CalibrationInputBundleV1,
  type CalibrationMemberEvidence,
  type CalibrationModelRef,
  type CalibrationReport,
  type CohortManifestMember,
  type PerCharacterCalibrationResult,
  type PublicBoostFlag,
  type QualitativeLabel,
} from "@mplus/scoring";
import type { Logger } from "@mplus/observability";
import type { WorkerContainer } from "../container.js";
import {
  acquireAndEvaluateCalibrationMember,
  CalibrationAcquireEvaluateError,
} from "./scoring/calibration-acquire-evaluate.js";

export interface CalibrationRunProcessorDeps {
  prisma: PrismaClient;
  logger: Logger;
  /** Defense in depth — the queue producer already gates enqueue on this flag. */
  calibrationEnabled: boolean;
  /**
   * Required for CANONICAL_ACQUIRE_EVALUATE product runs (WCL discovery + scoreCharacter).
   * Legacy frozen-snapshot harness runs only need prisma/logger.
   */
  container?: WorkerContainer;
}

export interface CalibrationRunProcessorResult {
  status:
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED"
    | "SKIPPED_DISABLED"
    | "NOT_FOUND"
    | "NOOP_TERMINAL";
}

const MODE_MAP: Record<string, CalibrationBacktestMode> = {
  PERSISTED_SNAPSHOT_ONLY: "persisted-snapshot-only",
  DRAFT_MODEL_EVALUATE: "draft-model-evaluate",
  ACTIVE_VERSUS_DRAFT: "active-versus-draft",
};

const DISCLAIMER =
  "Calibration acquire/evaluate output — no operational CharacterScore publication. " +
  "Does not activate score models.";

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function emptyCoverage() {
  return {
    coverageState: null,
    publicationStatus: null,
    refreshState: null,
    providerDataAsOf: null,
    scoreFreshness: null,
  };
}

function emptyBoost(): PublicBoostFlag {
  return {
    suspected: false,
    confidence: null,
    evidenceKeys: [],
    source: "none",
  };
}

function emptyUtility() {
  return {
    baselineRequestCost: 0,
    fallbackRequestCost: 0,
    fallbackTriggered: false,
    fallbackStopReason: null,
  };
}

function mapDimensions(snapshot: ScoreSnapshotDTO): PerCharacterCalibrationResult["dimensions"] {
  return snapshot.dimensions.map((d) => ({
    dimension: d.dimension,
    score: d.score,
    confidence: d.confidence,
    weight: d.weight,
    state: d.state,
  }));
}

function assignScoreRanks(rows: PerCharacterCalibrationResult[]): void {
  const scored = rows
    .filter((r) => r.overallScore != null && !r.error && !r.validationFailure)
    .sort(
      (a, b) =>
        (b.overallScore ?? 0) - (a.overallScore ?? 0) || a.memberId.localeCompare(b.memberId),
    );
  let rank = 1;
  for (let i = 0; i < scored.length; i++) {
    if (i > 0 && scored[i]!.overallScore !== scored[i - 1]!.overallScore) {
      rank = i + 1;
    }
    scored[i]!.expectedVersusActual.scoreRank = rank;
  }
}

function failedMemberRow(input: {
  member: CohortManifestMember;
  error: string;
  stage?: string | null;
  activeModel: CalibrationModelRef | null;
  evaluationModel: CalibrationModelRef | null;
}): PerCharacterCalibrationResult {
  const { member } = input;
  return {
    memberId: member.id,
    region: member.region,
    realm: member.realm,
    character: member.character,
    displayName: `${member.region}/${member.realm}/${member.character}`,
    role: member.role,
    classSlug: member.classSlug,
    specSlug: member.specSlug,
    expectedLabel: member.expectedLabel,
    meta: member.meta,
    source: member.source,
    suspectedBoostManifest: member.suspectedBoost,
    rationale: member.rationale,
    snapshotId: null,
    coverageRefresh: emptyCoverage(),
    evidenceCoverage: null,
    boost: emptyBoost(),
    activeModelKey: input.activeModel?.key ?? null,
    activeModelVersion: input.activeModel?.version ?? null,
    utilityCost: emptyUtility(),
    overallScore: null,
    grade: null,
    confidence: null,
    dimensions: [],
    evaluationModelKey: input.evaluationModel?.key ?? null,
    evaluationModelVersion: input.evaluationModel?.version ?? null,
    evaluationModelStatus: input.evaluationModel?.status ?? null,
    scoreModelKey: null,
    scoreModelVersion: null,
    expectedVersusActual: {
      expectedLabel: member.expectedLabel,
      actualGrade: null,
      actualScore: null,
      labelRank: LABEL_RANK[member.expectedLabel as QualitativeLabel] ?? 0,
      scoreRank: null,
    },
    lowConfidence: false,
    isUnrated: false,
    error: input.stage ? `[${input.stage}] ${input.error}` : input.error,
    validationFailure: null,
    evaluationKind: "failed",
    evidenceFingerprint: null,
  };
}

function rowFromAcquireSnapshot(input: {
  member: CohortManifestMember;
  snapshot: ScoreSnapshotDTO;
  activeModel: CalibrationModelRef | null;
  evaluationModel: CalibrationModelRef | null;
  evidenceFingerprint: string | null;
}): PerCharacterCalibrationResult {
  const { member, snapshot, evaluationModel } = input;
  const dimensions = mapDimensions(snapshot);
  const minConf =
    evaluationModel?.config.minConfidenceForGrade ??
    input.activeModel?.config.minConfidenceForGrade ??
    0.35;
  return {
    memberId: member.id,
    region: member.region,
    realm: member.realm,
    character: member.character,
    displayName: `${member.region}/${member.realm}/${member.character}`,
    role: member.role,
    classSlug: member.classSlug,
    specSlug: member.specSlug,
    expectedLabel: member.expectedLabel,
    meta: member.meta,
    source: member.source,
    suspectedBoostManifest: member.suspectedBoost,
    rationale: member.rationale,
    snapshotId: null,
    coverageRefresh: emptyCoverage(),
    evidenceCoverage: null,
    boost: emptyBoost(),
    activeModelKey: input.activeModel?.key ?? null,
    activeModelVersion: input.activeModel?.version ?? null,
    utilityCost: emptyUtility(),
    overallScore: snapshot.overallScore,
    grade: snapshot.grade,
    confidence: snapshot.confidence,
    dimensions,
    evaluationModelKey: evaluationModel?.key ?? snapshot.modelKey,
    evaluationModelVersion: evaluationModel?.version ?? snapshot.modelVersion,
    evaluationModelStatus: evaluationModel?.status ?? null,
    scoreModelKey: snapshot.modelKey,
    scoreModelVersion: snapshot.modelVersion,
    expectedVersusActual: {
      expectedLabel: member.expectedLabel,
      actualGrade: snapshot.grade,
      actualScore: snapshot.overallScore,
      labelRank: LABEL_RANK[member.expectedLabel as QualitativeLabel] ?? 0,
      scoreRank: null,
    },
    lowConfidence: snapshot.confidence < minConf,
    isUnrated: snapshot.grade === "U",
    error: null,
    validationFailure: null,
    evaluationKind: "replay",
    evidenceFingerprint: input.evidenceFingerprint,
  };
}

function usesCanonicalAcquire(algorithmVersions: unknown): boolean {
  if (!algorithmVersions || typeof algorithmVersions !== "object") return false;
  const source = (algorithmVersions as Record<string, unknown>).evidenceSource;
  return source === CALIBRATION_EVIDENCE_SOURCE_CANONICAL;
}

async function persistSucceededReport(input: {
  prisma: PrismaClient;
  runId: string;
  report: CalibrationReport;
  membersProgress: Array<Record<string, unknown>>;
}): Promise<void> {
  const { prisma, runId, report, membersProgress } = input;
  const digest = buildCalibrationDigestV1(report);
  const reportJson = JSON.stringify(report);
  const contentHash = createHash("sha256").update(reportJson).digest("hex");
  const now = new Date();

  const scored: CalibrationReport["characters"] = report.characters.filter(
    (c) => c.overallScore != null && !c.error && !c.validationFailure,
  );
  const meanScore = meanOf(scored.map((c) => c.overallScore!));
  const confidences = scored
    .map((c) => c.confidence)
    .filter((c): c is number => typeof c === "number");
  const meanConfidence = meanOf(confidences);
  const exactMatchCount = report.characters.filter((c) => {
    if (c.grade == null || c.validationFailure || c.error) return false;
    const expected = c.expectedVersusActual?.expectedLabel;
    const actual = c.expectedVersusActual?.actualGrade;
    if (!expected || !actual || actual === "U") return false;
    const labelToTier: Record<string, string> = {
      excellent: "S",
      good: "A",
      average: "B",
      weak: "C",
      overrated: "D",
    };
    return labelToTier[expected] === actual;
  }).length;

  const finalProgress = {
    total: report.cohortSize,
    completed: report.evaluatedCount,
    failed: report.errorCount + report.validationFailureCount,
    currentIndex: null,
    currentCharacterName: null,
    currentRealm: null,
    members: membersProgress,
    updatedAt: now.toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    await tx.calibrationReport.upsert({
      where: { runId },
      create: {
        runId,
        schemaVersion: CALIBRATION_REPORT_SCHEMA_VERSION,
        digestAlgorithmVersion: digest.algorithmVersion,
        recommendationAlgorithmVersion: null,
        summaryJson: {
          cohortId: report.cohortId,
          mode: report.mode,
          cohortSize: report.cohortSize,
          evaluatedCount: report.evaluatedCount,
          errorCount: report.errorCount,
          validationFailureCount: report.validationFailureCount,
          exactMatchCount,
          gradeDistribution: report.statistics.gradeDistribution,
          activeModel: report.activeModel,
          evaluationModel: report.evaluationModel,
          modelActivated: report.modelActivated,
          providerCallsMade: report.providerCallsMade,
          activeDraftComparison: report.activeDraftComparison,
        } as object,
        reportJson: report as unknown as object,
        digestJson: digest as unknown as object,
        limitationsJson: digest.limitations as unknown as object,
        cohortSize: report.cohortSize,
        evaluatedCount: report.evaluatedCount,
        failedOrExcludedCount: report.errorCount + report.validationFailureCount,
        spearman: report.statistics.monotonicOrdering.labelScoreSpearman,
        pairwiseConcordance: report.statistics.monotonicOrdering.pairwiseConcordance,
        meanScore,
        meanConfidence,
        outlierCount: report.statistics.outliers.length,
        contentHash,
        generatedAt: now,
      },
      update: {},
    });
    await tx.calibrationRun.update({
      where: { id: runId },
      data: {
        status: "SUCCEEDED",
        completedAt: now,
        progressJson: finalProgress as object,
      },
    });
  });
}

async function runCanonicalAcquireCalibration(input: {
  deps: CalibrationRunProcessorDeps;
  run: {
    id: string;
    mode: string;
    seasonId: string;
    evaluationModelId: string | null;
    evaluationModelConfig: unknown;
    activeModelConfig: unknown;
    inputBundle: unknown;
    algorithmVersions: unknown;
    createdAt: Date;
    cancelRequestedAt: Date | null;
  };
}): Promise<CalibrationRunProcessorResult> {
  const { deps, run } = input;
  const { prisma, logger } = deps;
  if (!deps.container) {
    throw new Error(
      "CANONICAL_ACQUIRE_EVALUATE calibration requires WorkerContainer (providers)",
    );
  }
  const container = deps.container;
  const bundle = run.inputBundle as CalibrationInputBundleV1;
  const members = bundle.manifest?.members ?? [];
  const mode = MODE_MAP[run.mode] ?? "persisted-snapshot-only";
  const evaluationModel = bundle.evaluationModel ?? null;
  const activeModel = bundle.activeModel ?? null;
  const scoreModelId =
    run.evaluationModelId ??
    ((run.algorithmVersions as Record<string, unknown> | null)?.scoreModelId as
      | string
      | undefined) ??
    null;
  if (!scoreModelId || !evaluationModel) {
    throw new Error("Canonical acquire calibration requires evaluationModel + scoreModelId");
  }

  const frozenConfig =
    run.evaluationModelConfig != null && typeof run.evaluationModelConfig === "object"
      ? (run.evaluationModelConfig as Record<string, unknown>)
      : evaluationModel.config;

  const characters: PerCharacterCalibrationResult[] = [];
  const membersProgress: Array<Record<string, unknown>> = members.map((m) => ({
    memberId: m.id,
    characterName: m.character,
    realm: m.realm,
    region: m.region,
    status: "pending",
    expectedRank: null,
    actualGrade: null,
    overallScore: null,
    error: null,
    failureStage: null,
  }));

  let anyProviderCalls = false;

  for (let index = 0; index < members.length; index++) {
    const member = members[index]!;
    const fresh = await prisma.calibrationRun.findUnique({
      where: { id: run.id },
      select: { cancelRequestedAt: true },
    });
    if (fresh?.cancelRequestedAt) {
      await prisma.calibrationRun.update({
        where: { id: run.id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          errorCode: "CANCELLED",
          errorMessage: "Cancelled during execution",
        },
      });
      return { status: "CANCELLED" };
    }

    membersProgress[index] = {
      ...membersProgress[index],
      status: "running",
    };
    await prisma.calibrationRun.update({
      where: { id: run.id },
      data: {
        progressJson: {
          total: members.length,
          completed: characters.filter((c) => !c.error).length,
          failed: characters.filter((c) => c.error).length,
          currentIndex: index,
          currentCharacterName: member.character,
          currentRealm: member.realm,
          members: membersProgress,
          updatedAt: new Date().toISOString(),
        } as object,
      },
    });

    const evidence = bundle.evidenceByMemberId?.[member.id] as
      | CalibrationMemberEvidence
      | undefined;
    const characterId = evidence?.characterId ?? null;

    let row: PerCharacterCalibrationResult;
    try {
      if (!characterId) {
        throw new CalibrationAcquireEvaluateError(
          "BLIZZARD_RESOLUTION",
          "CHARACTER_NOT_RESOLVED",
          "Member has no resolved Character — Blizzard resolve required before calibration",
        );
      }

      const result = await acquireAndEvaluateCalibrationMember(container, {
        characterId,
        seasonId: run.seasonId,
        scoreModelId,
        scoreModelKey: evaluationModel.key,
        scoreModelVersion: evaluationModel.version,
        scoreModelConfig: frozenConfig as Record<string, unknown>,
        role: member.role as never,
        classSlug: member.classSlug === "unknown" ? null : member.classSlug,
        specSlug: member.specSlug === "unknown" ? null : member.specSlug,
        correlationId: run.id,
      });

      if (result.providerCalls > 0) anyProviderCalls = true;
      if (result.characterScoreId != null) {
        throw new CalibrationAcquireEvaluateError(
          "CALIBRATION_PERSISTENCE",
          "CHARACTER_SCORE_WRITE_FORBIDDEN",
          "Calibration must not write CharacterScore",
        );
      }

      row = rowFromAcquireSnapshot({
        member,
        snapshot: result.snapshot,
        activeModel,
        evaluationModel,
        evidenceFingerprint: result.snapshot.inputFingerprint,
      });
      membersProgress[index] = {
        ...membersProgress[index],
        status: "completed",
        actualGrade: row.grade,
        overallScore: row.overallScore,
        error: null,
        failureStage: null,
        digestsCreated: result.digestsCreated,
        digestsReused: result.digestsReused,
        packagesCreated: result.packagesCreated,
        packagesReused: result.packagesReused,
        selectedSlotCount: result.selectedSlotCount,
      };
    } catch (error) {
      const stage =
        error instanceof CalibrationAcquireEvaluateError ? error.stage : "SCORING_EVALUATION";
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { err: error, calibrationRunId: run.id, memberId: member.id, stage },
        "calibration member acquire/evaluate failed — continuing",
      );
      row = failedMemberRow({
        member,
        error: message.slice(0, 500),
        stage,
        activeModel,
        evaluationModel,
      });
      membersProgress[index] = {
        ...membersProgress[index],
        status: "failed",
        actualGrade: null,
        overallScore: null,
        error: row.error,
        failureStage: stage,
      };
    }

    characters.push(row);
  }

  assignScoreRanks(characters);
  characters.sort((a, b) => a.memberId.localeCompare(b.memberId));

  const calculatedAt = new Date().toISOString();
  const statistics = buildCalibrationStatistics(characters, {
    bootstrapSeed: 42,
    bootstrapIterations: 200,
    weightAblation: [],
  });

  const report: CalibrationReport = {
    schemaVersion: CALIBRATION_REPORT_SCHEMA_VERSION,
    generatedAt: calculatedAt,
    mode,
    cohortId: bundle.manifest.cohortId,
    cohortSchemaVersion: String(bundle.manifest.schemaVersion),
    cohortSize: members.length,
    evaluatedCount: characters.filter((c) => !c.error && !c.validationFailure).length,
    errorCount: characters.filter((c) => c.error).length,
    validationFailureCount: 0,
    activeModel: {
      key: activeModel?.key ?? null,
      version: activeModel?.version ?? null,
      status: activeModel?.status ?? null,
      isActive: activeModel?.isActive ?? false,
    },
    evaluationModel: {
      key: evaluationModel.key,
      version: evaluationModel.version,
      status: evaluationModel.status,
      isActive: evaluationModel.isActive,
    },
    modelActivated: false,
    providerCallsMade: anyProviderCalls,
    disclaimer: DISCLAIMER,
    characters,
    statistics,
    activeDraftComparison: null,
    validationFailures: [],
    utilityCostAggregate: {
      totalBaseline: 0,
      totalFallback: 0,
      fallbackTriggeredCount: 0,
    },
  };

  await persistSucceededReport({
    prisma,
    runId: run.id,
    report,
    membersProgress,
  });
  return { status: "SUCCEEDED" };
}

/**
 * Dedicated `calibration-run` queue processor.
 * Product runs (evidenceSource=CANONICAL_ACQUIRE_EVALUATE) reuse canonical WCL
 * acquisition + scoreCharacter(persistCharacterScore=false). Legacy snapshot
 * harness runs remain provider-free.
 */
export async function runCalibrationRunJob(
  deps: CalibrationRunProcessorDeps,
  job: CalibrationRunJob,
): Promise<CalibrationRunProcessorResult> {
  const { prisma, logger } = deps;

  if (!deps.calibrationEnabled) {
    logger.warn(
      { calibrationRunId: job.calibrationRunId },
      "calibration-run job received while ADMIN_CALIBRATION_ENABLED=false — ignoring",
    );
    return { status: "SKIPPED_DISABLED" };
  }

  const run = await prisma.calibrationRun.findUnique({ where: { id: job.calibrationRunId } });
  if (!run) {
    logger.warn({ calibrationRunId: job.calibrationRunId }, "calibration run not found — dropping job");
    return { status: "NOT_FOUND" };
  }

  if (run.status === "SUCCEEDED" || run.status === "CANCELLED" || run.status === "FAILED") {
    return { status: "NOOP_TERMINAL" };
  }

  if (run.cancelRequestedAt) {
    await prisma.calibrationRun.update({
      where: { id: run.id },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        errorCode: "CANCELLED",
        errorMessage: "Cancelled before execution started",
      },
    });
    return { status: "CANCELLED" };
  }

  const claimed = await prisma.calibrationRun.updateMany({
    where: { id: run.id, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) {
    const current = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    if (!current || current.status !== "RUNNING") {
      return { status: "NOOP_TERMINAL" };
    }
  }

  try {
    if (usesCanonicalAcquire(run.algorithmVersions)) {
      return await runCanonicalAcquireCalibration({ deps, run });
    }

    const mode = MODE_MAP[run.mode] ?? "persisted-snapshot-only";
    const bundle = run.inputBundle as { generatedAt?: string; manifest?: { members?: unknown[] } };
    const priorProgress =
      run.progressJson && typeof run.progressJson === "object" && !Array.isArray(run.progressJson)
        ? (run.progressJson as Record<string, unknown>)
        : {};
    const membersProgress = Array.isArray(priorProgress.members)
      ? [...(priorProgress.members as Array<Record<string, unknown>>)]
      : [];

    const { report } = runCalibrationHarnessFromBundle(run.inputBundle, {
      mode,
      calculatedAt: bundle.generatedAt ?? run.createdAt.toISOString(),
      onMemberProgress: (event) => {
        const idx = membersProgress.findIndex((m) => m.memberId === event.memberId);
        const row = {
          memberId: event.memberId,
          characterName: event.characterName,
          realm: event.realm,
          region: event.region,
          status: event.status,
          expectedRank: null,
          actualGrade: event.result.grade as Grade | null,
          overallScore: event.result.overallScore,
          error:
            event.result.error ??
            event.result.validationFailure?.message ??
            null,
        };
        if (idx >= 0) membersProgress[idx] = { ...membersProgress[idx], ...row };
        else membersProgress.push(row);
        const completed = membersProgress.filter((m) => m.status === "completed").length;
        const failed = membersProgress.filter((m) => m.status === "failed").length;
        void prisma.calibrationRun
          .update({
            where: { id: run.id },
            data: {
              progressJson: {
                total: event.total,
                completed,
                failed,
                currentIndex: event.index,
                currentCharacterName: event.characterName,
                currentRealm: event.realm,
                members: membersProgress,
                updatedAt: new Date().toISOString(),
              } as object,
            },
          })
          .catch(() => undefined);
      },
    });

    const fresh = await prisma.calibrationRun.findUnique({ where: { id: run.id } });
    if (fresh?.cancelRequestedAt) {
      await prisma.calibrationRun.update({
        where: { id: run.id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          errorCode: "CANCELLED",
          errorMessage: "Cancelled during execution",
        },
      });
      return { status: "CANCELLED" };
    }

    await persistSucceededReport({
      prisma,
      runId: run.id,
      report,
      membersProgress,
    });
    return { status: "SUCCEEDED" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.calibrationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: "CALIBRATION_HARNESS_ERROR",
        errorMessage: message.slice(0, 2000),
      },
    });
    logger.error({ err: error, calibrationRunId: run.id }, "calibration run failed");
    return { status: "FAILED" };
  }
}
