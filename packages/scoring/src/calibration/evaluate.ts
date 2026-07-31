import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import { calculateScore } from "../calculate.js";
import { computeInputFingerprint } from "../fingerprint.js";
import type { ScoringContext } from "../types.js";
import {
  computeEngineWeightAblation,
  type AblationReplayInput,
} from "./ablation.js";
import { defaultBoostFlagSource, type BoostFlagSource } from "./boost-flags.js";
import {
  buildActiveDraftComparison,
  snapshotOnlyComparisonNote,
  type PairwiseReplayResult,
} from "./comparison.js";
import {
  resolvePersistedProvenanceModel,
  validateMemberEvidence,
} from "./evidence-validation.js";
import { GRADE_RANK, LABEL_RANK, type CohortManifest, type CohortManifestMember } from "./manifest.js";
import { buildCalibrationStatistics } from "./stats.js";
import type {
  CalibrationEvidenceCoverage,
  CalibrationMemberEvidence,
  CalibrationModelRef,
  CalibrationReport,
  CalibrationRunOptions,
  CoverageRefreshState,
  EvidenceValidationIssue,
  PerCharacterCalibrationResult,
  PublicBoostFlag,
  UtilityCostSummary,
} from "./types.js";
import { CALIBRATION_REPORT_SCHEMA_VERSION } from "./types.js";

const DISCLAIMER =
  "Calibration harness output only — no conclusion about final model calibration. " +
  "Does not activate score models. Live cohorts require explicit user-provided/approved characters.";

const MAX_BOOTSTRAP_ITERATIONS = 5000;
const MIN_BOOTSTRAP_ITERATIONS = 1;

export interface CalibrationEvidencePort {
  /** Load persisted/fixture evidence for a member. Must not call live providers. */
  loadMemberEvidence(member: CohortManifestMember): CalibrationMemberEvidence;
}

export interface CalibrationHarnessDeps {
  evidence: CalibrationEvidencePort;
  boostFlags?: BoostFlagSource;
}

function emptyCoverage(): CoverageRefreshState {
  return {
    coverageState: null,
    publicationStatus: null,
    refreshState: null,
    providerDataAsOf: null,
    scoreFreshness: null,
  };
}

function emptyUtility(): UtilityCostSummary {
  return {
    baselineRequestCost: 0,
    fallbackRequestCost: 0,
    fallbackTriggered: false,
    fallbackStopReason: null,
  };
}

function mapDimensions(snapshot: ScoreSnapshotDTO): PerCharacterCalibrationResult["dimensions"] {
  return snapshot.dimensions.map((d: ScoreSnapshotDTO["dimensions"][number]) => ({
    dimension: d.dimension,
    score: d.score,
    confidence: d.confidence,
    weight: d.weight,
    state: d.state,
  }));
}

function dimensionAvailabilityRatio(
  dimensions: PerCharacterCalibrationResult["dimensions"],
): number | null {
  if (dimensions.length === 0) return null;
  const present = dimensions.filter((d) => d.score != null).length;
  return present / dimensions.length;
}

function mergeEvidenceCoverage(
  evidence: CalibrationMemberEvidence,
  snapshot: ScoreSnapshotDTO | null,
  dimensions: PerCharacterCalibrationResult["dimensions"],
): CalibrationEvidenceCoverage {
  const fromEvidence = evidence.evidenceCoverage;
  const dimAvail = dimensionAvailabilityRatio(dimensions);
  return {
    selectedRunCoverage:
      fromEvidence?.selectedRunCoverage ??
      evidence.scoringContext?.selectedRunCoverage ??
      null,
    analyzedRunCoverage: fromEvidence?.analyzedRunCoverage ?? null,
    modelCoverageRatio:
      fromEvidence?.modelCoverageRatio ?? snapshot?.modelCoverageRatio ?? null,
    availableModelWeight:
      fromEvidence?.availableModelWeight ?? snapshot?.availableModelWeight ?? null,
    totalModelWeight: fromEvidence?.totalModelWeight ?? snapshot?.totalModelWeight ?? null,
    utilityEvidenceCoverage: fromEvidence?.utilityEvidenceCoverage ?? null,
    dimensionAvailabilityRatio: fromEvidence?.dimensionAvailabilityRatio ?? dimAvail,
  };
}

function scoreFromReplay(input: {
  characterId: string;
  observations: MetricObservationDTO[];
  model: CalibrationModelRef;
  calculatedAt: string;
  seasonSlug: string;
  context: ScoringContext;
}): { snapshot: ScoreSnapshotDTO; fingerprint: string } {
  const fingerprint = computeInputFingerprint({
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    model: input.model.config,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: input.observations,
    context: input.context,
  });
  const snapshot = calculateScore({
    characterId: input.characterId,
    seasonSlug: input.seasonSlug,
    model: input.model.config,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: input.observations,
    calculatedAt: input.calculatedAt,
    inputFingerprint: fingerprint,
    context: input.context,
  });
  return { snapshot, fingerprint };
}

function failedRow(input: {
  member: CohortManifestMember;
  evidence: CalibrationMemberEvidence;
  options: CalibrationRunOptions;
  boost: PublicBoostFlag;
  error: string | null;
  validationFailure: EvidenceValidationIssue | null;
}): PerCharacterCalibrationResult {
  const { member, evidence, options, boost } = input;
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
    snapshotId: evidence.snapshotId ?? member.snapshotIds?.[0] ?? null,
    coverageRefresh: evidence.coverageRefresh ?? emptyCoverage(),
    evidenceCoverage: evidence.evidenceCoverage ?? null,
    boost,
    activeModelKey: options.activeModel?.key ?? null,
    activeModelVersion: options.activeModel?.version ?? null,
    utilityCost: evidence.utilityCost ?? emptyUtility(),
    overallScore: null,
    grade: null,
    confidence: null,
    dimensions: [],
    evaluationModelKey: options.evaluationModel?.key ?? null,
    evaluationModelVersion: options.evaluationModel?.version ?? null,
    evaluationModelStatus: options.evaluationModel?.status ?? null,
    scoreModelKey: null,
    scoreModelVersion: null,
    expectedVersusActual: {
      expectedLabel: member.expectedLabel,
      actualGrade: null,
      actualScore: null,
      labelRank: LABEL_RANK[member.expectedLabel],
      scoreRank: null,
    },
    lowConfidence: false,
    isUnrated: false,
    error: input.error,
    validationFailure: input.validationFailure,
    evaluationKind: "failed",
    evidenceFingerprint: null,
  };
}

function rowFromSnapshot(input: {
  member: CohortManifestMember;
  evidence: CalibrationMemberEvidence;
  options: CalibrationRunOptions;
  boost: PublicBoostFlag;
  snapshot: ScoreSnapshotDTO;
  evalModel: CalibrationModelRef | null;
  evaluationKind: "snapshot-only" | "replay";
  evidenceFingerprint: string | null;
}): PerCharacterCalibrationResult {
  const { member, evidence, options, boost, snapshot, evalModel } = input;
  const dimensions = mapDimensions(snapshot);
  const minConf = evalModel?.config.minConfidenceForGrade ?? options.activeModel?.config.minConfidenceForGrade ?? 0.35;
  const confidence = snapshot.confidence;
  const provenance =
    input.evaluationKind === "snapshot-only"
      ? resolvePersistedProvenanceModel(snapshot, {
          evaluationModel: options.evaluationModel,
          activeModel: options.activeModel,
        })
      : {
          key: evalModel?.key ?? snapshot.modelKey,
          version: evalModel?.version ?? snapshot.modelVersion,
          status: evalModel?.status ?? null,
        };

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
    snapshotId: evidence.snapshotId ?? member.snapshotIds?.[0] ?? null,
    coverageRefresh: evidence.coverageRefresh ?? emptyCoverage(),
    evidenceCoverage: mergeEvidenceCoverage(evidence, snapshot, dimensions),
    boost,
    activeModelKey: options.activeModel?.key ?? null,
    activeModelVersion: options.activeModel?.version ?? null,
    utilityCost: evidence.utilityCost ?? emptyUtility(),
    overallScore: snapshot.overallScore,
    grade: snapshot.grade,
    confidence,
    dimensions,
    evaluationModelKey: provenance.key,
    evaluationModelVersion: provenance.version,
    evaluationModelStatus: provenance.status,
    scoreModelKey: snapshot.modelKey,
    scoreModelVersion: snapshot.modelVersion,
    expectedVersusActual: {
      expectedLabel: member.expectedLabel,
      actualGrade: snapshot.grade,
      actualScore: snapshot.overallScore,
      labelRank: LABEL_RANK[member.expectedLabel],
      scoreRank: null,
    },
    lowConfidence: confidence < minConf,
    isUnrated: snapshot.grade === "U",
    error: null,
    validationFailure: null,
    evaluationKind: input.evaluationKind,
    evidenceFingerprint: input.evidenceFingerprint,
  };
}

function assignScoreRanks(rows: PerCharacterCalibrationResult[]): void {
  const scored = rows
    .filter((r) => r.overallScore != null && !r.error && !r.validationFailure)
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0) || a.memberId.localeCompare(b.memberId));
  // Dense ranks by score; ties share the first index (display only — Spearman uses midranks).
  let rank = 1;
  for (let i = 0; i < scored.length; i++) {
    if (i > 0 && scored[i]!.overallScore !== scored[i - 1]!.overallScore) {
      rank = i + 1;
    }
    scored[i]!.expectedVersusActual.scoreRank = rank;
  }
}

function clampBootstrapIterations(n: number | undefined): number {
  const value = n ?? 200;
  if (!Number.isFinite(value) || value < MIN_BOOTSTRAP_ITERATIONS) {
    return MIN_BOOTSTRAP_ITERATIONS;
  }
  return Math.min(MAX_BOOTSTRAP_ITERATIONS, Math.floor(value));
}

/**
 * Run the calibration/backtest harness.
 * Pure orchestration over ports — no DB writes, no model activation, no providers.
 */
export function runCalibrationHarness(
  manifest: CohortManifest,
  options: CalibrationRunOptions,
  deps: CalibrationHarnessDeps,
): CalibrationReport {
  if (options.mode === "refresh-then-evaluate") {
    throw new Error(
      "UNSUPPORTED_MODE: refresh-then-evaluate is not executable in this package (no provider refresh port)",
    );
  }

  if (options.evaluationModel?.isActive && options.mode !== "persisted-snapshot-only") {
    throw new Error("Refusing draft/comparison evaluation against isActive=true model ref");
  }

  if (
    (options.mode === "draft-model-evaluate" || options.mode === "active-versus-draft") &&
    !options.evaluationModel
  ) {
    throw new Error(`${options.mode} requires options.evaluationModel`);
  }

  if (options.mode === "active-versus-draft" && !options.activeModel) {
    throw new Error("active-versus-draft requires options.activeModel with config for replay");
  }

  if (
    options.evaluationModel &&
    (options.mode === "draft-model-evaluate" || options.mode === "active-versus-draft")
  ) {
    if (options.evaluationModel.status === "ACTIVE") {
      throw new Error(
        "draft/comparison refuses status=ACTIVE — pass DRAFT/FIXTURE without activating",
      );
    }
  }

  const boostSource = deps.boostFlags ?? defaultBoostFlagSource;
  const calculatedAt = options.calculatedAt ?? "2026-07-31T12:00:00.000Z";
  const runOptions: CalibrationRunOptions = { ...options, calculatedAt };
  const claimedSnapshotIds = new Set<string>();
  const validationFailures: EvidenceValidationIssue[] = [];
  const ablationMembers: AblationReplayInput[] = [];
  const comparisonPairs: PairwiseReplayResult[] = [];

  const characters: PerCharacterCalibrationResult[] = [];

  for (const member of manifest.members) {
    const evidence = deps.evidence.loadMemberEvidence(member);
    const boost = boostSource.resolve({
      memberId: member.id,
      suspectedBoostManifest: member.suspectedBoost,
      persistedPublic: evidence.boost,
    });

    const validationFailure = validateMemberEvidence({
      member,
      evidence,
      mode: runOptions.mode,
      activeModel: runOptions.activeModel,
      evaluationModel: runOptions.evaluationModel,
      claimedSnapshotIds,
    });

    if (validationFailure) {
      validationFailures.push(validationFailure);
      characters.push(
        failedRow({
          member,
          evidence,
          options: runOptions,
          boost,
          error: null,
          validationFailure,
        }),
      );
      if (runOptions.mode === "active-versus-draft") {
        comparisonPairs.push({
          memberId: member.id,
          role: member.role,
          classSlug: member.classSlug,
          specSlug: member.specSlug,
          expectedLabel: member.expectedLabel,
          meta: member.meta,
          lowConfidence: false,
          hasMissingDim: true,
          evidenceFingerprint: null,
          active: null,
          draft: null,
        });
      }
      continue;
    }

    try {
      if (runOptions.mode === "persisted-snapshot-only") {
        const snapshot = evidence.snapshot!;
        const row = rowFromSnapshot({
          member,
          evidence,
          options: runOptions,
          boost,
          snapshot,
          evalModel: runOptions.evaluationModel ?? runOptions.activeModel ?? null,
          evaluationKind: "snapshot-only",
          evidenceFingerprint: snapshot.inputFingerprint ?? null,
        });
        characters.push(row);
        continue;
      }

      const seasonSlug = evidence.seasonSlug ?? member.seasonSlug ?? "fixture-season";
      const characterId = evidence.characterId ?? member.id;
      const context = evidence.scoringContext!;
      const observations = evidence.observations!;
      const replayAt = evidence.calculatedAt ?? calculatedAt;

      if (runOptions.mode === "draft-model-evaluate") {
        const evalModel = runOptions.evaluationModel!;
        const { snapshot, fingerprint } = scoreFromReplay({
          characterId,
          observations,
          model: evalModel,
          calculatedAt: replayAt,
          seasonSlug,
          context,
        });
        const row = rowFromSnapshot({
          member,
          evidence,
          options: runOptions,
          boost,
          snapshot,
          evalModel,
          evaluationKind: "replay",
          evidenceFingerprint: fingerprint,
        });
        characters.push(row);
        ablationMembers.push({
          characterId,
          seasonSlug,
          observations,
          context,
          calculatedAt: replayAt,
          baselineScore: snapshot.overallScore,
          baselineGrade: snapshot.grade,
        });
        continue;
      }

      // active-versus-draft: replay both models on identical inputs
      const activeModel = runOptions.activeModel!;
      const draftModel = runOptions.evaluationModel!;
      const activeReplay = scoreFromReplay({
        characterId,
        observations,
        model: activeModel,
        calculatedAt: replayAt,
        seasonSlug,
        context,
      });
      const draftReplay = scoreFromReplay({
        characterId,
        observations,
        model: draftModel,
        calculatedAt: replayAt,
        seasonSlug,
        context,
      });

      // Primary report row uses draft evaluation (evaluation model under test).
      const draftRow = rowFromSnapshot({
        member,
        evidence,
        options: runOptions,
        boost,
        snapshot: draftReplay.snapshot,
        evalModel: draftModel,
        evaluationKind: "replay",
        evidenceFingerprint: draftReplay.fingerprint,
      });
      const activeRow = rowFromSnapshot({
        member,
        evidence,
        options: { ...runOptions, evaluationModel: activeModel },
        boost,
        snapshot: activeReplay.snapshot,
        evalModel: activeModel,
        evaluationKind: "replay",
        evidenceFingerprint: activeReplay.fingerprint,
      });
      // Fingerprints differ by model config; shared evidence fingerprint hashes observations+context without model.
      // For equivalence proof we require identical observations/context/calculatedAt (already true).
      const sharedEvidenceFingerprint = `${activeReplay.fingerprint}::${draftReplay.fingerprint}`;
      draftRow.evidenceFingerprint = sharedEvidenceFingerprint;
      activeRow.evidenceFingerprint = sharedEvidenceFingerprint;

      characters.push(draftRow);
      ablationMembers.push({
        characterId,
        seasonSlug,
        observations,
        context,
        calculatedAt: replayAt,
        baselineScore: draftReplay.snapshot.overallScore,
        baselineGrade: draftReplay.snapshot.grade,
      });
      comparisonPairs.push({
        memberId: member.id,
        role: member.role,
        classSlug: member.classSlug,
        specSlug: member.specSlug,
        expectedLabel: member.expectedLabel,
        meta: member.meta,
        lowConfidence: draftRow.lowConfidence || activeRow.lowConfidence,
        hasMissingDim: draftRow.dimensions.some(
          (d) => d.score == null || d.state === "UNAVAILABLE" || d.state === "PARTIAL",
        ),
        evidenceFingerprint: sharedEvidenceFingerprint,
        active: activeRow,
        draft: draftRow,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      characters.push(
        failedRow({
          member,
          evidence,
          options: runOptions,
          boost,
          error: message,
          validationFailure: null,
        }),
      );
    }
  }

  assignScoreRanks(characters);

  const ablationModel =
    runOptions.evaluationModel?.config ?? runOptions.activeModel?.config ?? null;
  const weightAblation =
    ablationModel && ablationMembers.length > 0
      ? computeEngineWeightAblation({
          model: ablationModel,
          members: ablationMembers,
        })
      : [];

  const statistics = buildCalibrationStatistics(characters, {
    bootstrapSeed: options.bootstrapSeed ?? 42,
    bootstrapIterations: clampBootstrapIterations(options.bootstrapIterations),
    weightAblation,
  });

  const utilityCostAggregate = characters.reduce(
    (acc, row) => {
      const u = row.utilityCost;
      if (!u) return acc;
      return {
        totalBaseline: acc.totalBaseline + u.baselineRequestCost,
        totalFallback: acc.totalFallback + u.fallbackRequestCost,
        fallbackTriggeredCount:
          acc.fallbackTriggeredCount + (u.fallbackTriggered ? 1 : 0),
      };
    },
    { totalBaseline: 0, totalFallback: 0, fallbackTriggeredCount: 0 },
  );

  characters.sort((a, b) => a.memberId.localeCompare(b.memberId));

  let activeDraftComparison = null;
  if (runOptions.mode === "active-versus-draft") {
    activeDraftComparison = buildActiveDraftComparison(comparisonPairs);
  } else if (runOptions.mode === "persisted-snapshot-only") {
    activeDraftComparison = snapshotOnlyComparisonNote();
  }

  return {
    schemaVersion: CALIBRATION_REPORT_SCHEMA_VERSION,
    generatedAt: calculatedAt,
    mode: options.mode,
    cohortId: manifest.cohortId,
    cohortSchemaVersion: String(manifest.schemaVersion),
    cohortSize: manifest.members.length,
    evaluatedCount: characters.filter((c) => !c.error && !c.validationFailure).length,
    errorCount: characters.filter((c) => c.error).length,
    validationFailureCount: validationFailures.length,
    activeModel: {
      key: options.activeModel?.key ?? null,
      version: options.activeModel?.version ?? null,
      status: options.activeModel?.status ?? null,
      isActive: options.activeModel?.isActive ?? false,
    },
    evaluationModel: {
      key: options.evaluationModel?.key ?? options.activeModel?.key ?? null,
      version: options.evaluationModel?.version ?? options.activeModel?.version ?? null,
      status: options.evaluationModel?.status ?? options.activeModel?.status ?? null,
      isActive: options.evaluationModel?.isActive ?? false,
    },
    modelActivated: false,
    providerCallsMade: false,
    disclaimer: DISCLAIMER,
    characters,
    statistics,
    activeDraftComparison,
    validationFailures,
    utilityCostAggregate,
  };
}

/** Compare grade ordering helper for tests / Agent 08. */
export function gradeRank(grade: string | null): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}
