import type { MetricObservationDTO, ScoreSnapshotDTO } from "@mplus/contracts";
import { calculateScore } from "../calculate.js";
import { computeInputFingerprint } from "../fingerprint.js";
import type { ScoringContext } from "../types.js";
import { defaultBoostFlagSource, type BoostFlagSource } from "./boost-flags.js";
import { GRADE_RANK, LABEL_RANK, type CohortManifest, type CohortManifestMember } from "./manifest.js";
import { buildCalibrationStatistics } from "./stats.js";
import type {
  CalibrationMemberEvidence,
  CalibrationModelRef,
  CalibrationReport,
  CalibrationRunOptions,
  CoverageRefreshState,
  PerCharacterCalibrationResult,
  PublicBoostFlag,
  UtilityCostSummary,
} from "./types.js";
import { CALIBRATION_REPORT_SCHEMA_VERSION } from "./types.js";

const DISCLAIMER =
  "Calibration harness output only — no conclusion about final model calibration. " +
  "Does not activate score models. Live cohorts require explicit user-provided/approved characters.";

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

function scoreFromObservations(input: {
  member: CohortManifestMember;
  observations: MetricObservationDTO[];
  model: CalibrationModelRef;
  calculatedAt: string;
  seasonSlug: string;
}): ScoreSnapshotDTO {
  const context: ScoringContext = {
    role: input.member.role,
    classSlug: input.member.classSlug,
    specSlug: input.member.specSlug,
    freshness: 0.85,
    selectedRunCoverage: 0.75,
  };
  const fingerprint = computeInputFingerprint({
    characterId: input.member.id,
    seasonSlug: input.seasonSlug,
    model: input.model.config,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: input.observations,
    context,
  });
  return calculateScore({
    characterId: input.member.id,
    seasonSlug: input.seasonSlug,
    model: input.model.config,
    scopeType: "CHARACTER",
    scopeKey: null,
    observations: input.observations,
    calculatedAt: input.calculatedAt,
    inputFingerprint: fingerprint,
    context,
  });
}

function evaluateMember(input: {
  member: CohortManifestMember;
  evidence: CalibrationMemberEvidence;
  options: CalibrationRunOptions;
  boost: PublicBoostFlag;
}): PerCharacterCalibrationResult {
  const { member, evidence, options, boost } = input;
  const base: Omit<
    PerCharacterCalibrationResult,
    | "overallScore"
    | "grade"
    | "confidence"
    | "dimensions"
    | "expectedVersusActual"
    | "lowConfidence"
    | "isUnrated"
    | "error"
    | "evaluationModelKey"
    | "evaluationModelVersion"
    | "evaluationModelStatus"
  > = {
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
    boost,
    activeModelKey: options.activeModel?.key ?? null,
    activeModelVersion: options.activeModel?.version ?? null,
    utilityCost: evidence.utilityCost ?? emptyUtility(),
  };

  try {
    if (options.mode === "refresh-then-evaluate") {
      throw new Error(
        "refresh-then-evaluate is disabled by default and has no provider port in this harness",
      );
    }

    let snapshot: ScoreSnapshotDTO | null = null;
    let evalModel: CalibrationModelRef | null = null;

    if (options.mode === "persisted-snapshot-only") {
      if (!evidence.snapshot) {
        throw new Error(
          `persisted-snapshot-only requires a snapshot for member ${member.id}`,
        );
      }
      snapshot = evidence.snapshot;
      evalModel = options.evaluationModel ?? options.activeModel ?? null;
    } else if (options.mode === "draft-model-evaluate") {
      if (!options.evaluationModel) {
        throw new Error("draft-model-evaluate requires options.evaluationModel");
      }
      if (options.evaluationModel.isActive) {
        throw new Error(
          "draft-model-evaluate refuses evaluationModel.isActive=true (would look like activation)",
        );
      }
      if (options.evaluationModel.status === "ACTIVE") {
        throw new Error(
          "draft-model-evaluate refuses status=ACTIVE — pass DRAFT/FIXTURE without activating",
        );
      }
      const observations = evidence.observations;
      if (!observations || observations.length === 0) {
        // Allow empty observations → score engine still runs (may produce U / low scores).
      }
      evalModel = options.evaluationModel;
      snapshot = scoreFromObservations({
        member,
        observations: observations ?? [],
        model: evalModel,
        calculatedAt: options.calculatedAt ?? "2026-07-31T12:00:00.000Z",
        seasonSlug: evidence.seasonSlug ?? member.seasonSlug ?? "fixture-season",
      });
    } else {
      const _exhaustive: never = options.mode;
      throw new Error(`Unsupported mode: ${String(_exhaustive)}`);
    }

    const confidence = snapshot.confidence;
    const minConf = evalModel?.config.minConfidenceForGrade ?? 0.35;
    const lowConfidence = confidence < minConf;
    const isUnrated = snapshot.grade === "U";

    return {
      ...base,
      overallScore: snapshot.overallScore,
      grade: snapshot.grade,
      confidence,
      dimensions: mapDimensions(snapshot),
      evaluationModelKey: evalModel?.key ?? snapshot.modelKey,
      evaluationModelVersion: evalModel?.version ?? snapshot.modelVersion,
      evaluationModelStatus: evalModel?.status ?? null,
      expectedVersusActual: {
        expectedLabel: member.expectedLabel,
        actualGrade: snapshot.grade,
        actualScore: snapshot.overallScore,
        labelRank: LABEL_RANK[member.expectedLabel],
        scoreRank: null,
      },
      lowConfidence,
      isUnrated,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      overallScore: null,
      grade: null,
      confidence: null,
      dimensions: [],
      evaluationModelKey: options.evaluationModel?.key ?? null,
      evaluationModelVersion: options.evaluationModel?.version ?? null,
      evaluationModelStatus: options.evaluationModel?.status ?? null,
      expectedVersusActual: {
        expectedLabel: member.expectedLabel,
        actualGrade: null,
        actualScore: null,
        labelRank: LABEL_RANK[member.expectedLabel],
        scoreRank: null,
      },
      lowConfidence: false,
      isUnrated: false,
      error: message,
    };
  }
}

function assignScoreRanks(rows: PerCharacterCalibrationResult[]): void {
  const scored = rows
    .filter((r) => r.overallScore != null)
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  scored.forEach((row, idx) => {
    row.expectedVersusActual.scoreRank = idx + 1;
  });
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
    if (!options.allowRefreshThenEvaluate) {
      throw new Error(
        "refresh-then-evaluate requires allowRefreshThenEvaluate=true (disabled by default)",
      );
    }
    throw new Error(
      "refresh-then-evaluate is budget-bound and has no live provider implementation in Agent 10 harness",
    );
  }

  // Guard: never activate.
  if (options.evaluationModel?.isActive && options.mode === "draft-model-evaluate") {
    throw new Error("Refusing draft evaluation against isActive=true model ref");
  }

  const boostSource = deps.boostFlags ?? defaultBoostFlagSource;
  const calculatedAt = options.calculatedAt ?? "2026-07-31T12:00:00.000Z";
  const runOptions: CalibrationRunOptions = { ...options, calculatedAt };

  const characters: PerCharacterCalibrationResult[] = [];
  for (const member of manifest.members) {
    const evidence = deps.evidence.loadMemberEvidence(member);
    const boost = boostSource.resolve({
      memberId: member.id,
      suspectedBoostManifest: member.suspectedBoost,
      persistedPublic: evidence.boost,
    });
    characters.push(evaluateMember({ member, evidence, options: runOptions, boost }));
  }

  assignScoreRanks(characters);

  const statistics = buildCalibrationStatistics(characters, {
    bootstrapSeed: options.bootstrapSeed ?? 42,
    bootstrapIterations: options.bootstrapIterations ?? 200,
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

  // Stable sort for reproducible JSON: by memberId.
  characters.sort((a, b) => a.memberId.localeCompare(b.memberId));

  return {
    schemaVersion: CALIBRATION_REPORT_SCHEMA_VERSION,
    generatedAt: calculatedAt,
    mode: options.mode,
    cohortId: manifest.cohortId,
    cohortSchemaVersion: String(manifest.schemaVersion),
    cohortSize: manifest.members.length,
    evaluatedCount: characters.filter((c) => !c.error).length,
    errorCount: characters.filter((c) => c.error).length,
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
    utilityCostAggregate,
  };
}

/** Compare grade ordering helper for tests / Agent 08. */
export function gradeRank(grade: string | null): number {
  if (!grade) return -1;
  return GRADE_RANK[grade] ?? -1;
}
