import type { Grade } from "@mplus/contracts";
import { buildCalibrationArtifacts } from "./reports.js";
import { runCalibrationHarness, type CalibrationHarnessDeps } from "./evaluate.js";
import { validateCohortManifest, type CohortManifest } from "./manifest.js";
import type {
  CalibrationArtifacts,
  CalibrationReport,
  CalibrationRunOptions,
} from "./types.js";

/**
 * Admin backtest summary compatible with the existing fixture endpoint shape
 * (`BacktestResultDTO` in apps/api). Agent 08 should map/extend this.
 */
export interface AdminBacktestSummaryV1 {
  scoreModelId: string;
  sampleSize: number;
  gradeDistribution: Partial<Record<Grade, number>>;
  /** Absolute grade counts (not forced quotas / percentages). */
  gradeCounts: Partial<Record<Grade, number>>;
  meanScore: number;
  meanConfidence: number | null;
  generatedAt: string;
  note: string;
  /** Full harness schema version for clients that want the rich report. */
  calibrationSchemaVersion: string;
  cohortId: string;
  mode: CalibrationRunOptions["mode"];
  modelActivated: false;
  providerCallsMade: boolean;
  outliers: CalibrationReport["statistics"]["outliers"];
  monotonicSpearman: number | null;
  roleSlices: CalibrationReport["statistics"]["roleSlices"];
  metaVersusNonMeta: CalibrationReport["statistics"]["metaVersusNonMeta"];
  disclaimer: string;
}

export interface RunAdminCalibrationBacktestInput {
  /** Score model UUID (or fixture id) returned to admin clients. */
  scoreModelId: string;
  manifest: unknown;
  options: CalibrationRunOptions;
  deps: CalibrationHarnessDeps;
  /** When true, return anonymized character rows inside the rich report only. */
  publicSafe?: boolean;
}

export interface AdminCalibrationBacktestResult {
  summary: AdminBacktestSummaryV1;
  artifacts: CalibrationArtifacts;
  validationErrors: string[];
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Convert a calibration report into the admin backtest summary DTO.
 * Does not write to the database or activate models.
 */
export function toAdminBacktestSummary(
  scoreModelId: string,
  report: CalibrationReport,
): AdminBacktestSummaryV1 {
  const scores = report.characters
    .map((c) => c.overallScore)
    .filter((s): s is number => typeof s === "number");
  const confs = report.characters
    .map((c) => c.confidence)
    .filter((c): c is number => typeof c === "number");

  const gradeCounts = { ...report.statistics.gradeDistribution };
  const total = Object.values(gradeCounts).reduce<number>((a, b) => a + (b ?? 0), 0);
  const gradeDistribution: Partial<Record<Grade, number>> = {};
  for (const [grade, count] of Object.entries(gradeCounts)) {
    gradeDistribution[grade as Grade] = total === 0 ? 0 : (count ?? 0) / total;
  }

  return {
    scoreModelId,
    sampleSize: report.evaluatedCount,
    gradeDistribution,
    gradeCounts,
    meanScore: meanOf(scores),
    meanConfidence: confs.length === 0 ? null : meanOf(confs),
    generatedAt: report.generatedAt,
    note:
      "Calibration harness summary — not a final calibration conclusion. " +
      "Wire full artifacts via Agent 10 runAdminCalibrationBacktest.",
    calibrationSchemaVersion: report.schemaVersion,
    cohortId: report.cohortId,
    mode: report.mode,
    modelActivated: false,
    providerCallsMade: report.providerCallsMade,
    outliers: report.statistics.outliers,
    monotonicSpearman: report.statistics.monotonicOrdering.labelScoreSpearman,
    roleSlices: report.statistics.roleSlices,
    metaVersusNonMeta: report.statistics.metaVersusNonMeta,
    disclaimer: report.disclaimer,
  };
}

/**
 * Service entry point for Agent 08 admin backtest endpoint.
 *
 * Contract:
 * - Validates cohort manifest
 * - Runs harness in the requested mode (default should be persisted-snapshot-only)
 * - Never activates the evaluation model
 * - Never performs provider calls (refresh mode remains disabled unless explicitly allowed,
 *   and even then this package ships no provider port)
 */
export function runAdminCalibrationBacktest(
  input: RunAdminCalibrationBacktestInput,
): AdminCalibrationBacktestResult {
  const validated = validateCohortManifest(input.manifest);
  if (!validated.ok || !validated.manifest) {
    return {
      summary: {
        scoreModelId: input.scoreModelId,
        sampleSize: 0,
        gradeDistribution: {},
        gradeCounts: {},
        meanScore: 0,
        meanConfidence: null,
        generatedAt: input.options.calculatedAt ?? new Date().toISOString(),
        note: `Invalid cohort manifest: ${validated.errors.join("; ")}`,
        calibrationSchemaVersion: "1.0.0",
        cohortId: "invalid",
        mode: input.options.mode,
        modelActivated: false,
        providerCallsMade: false,
        outliers: [],
        monotonicSpearman: null,
        roleSlices: [],
        metaVersusNonMeta: {
          meta: {
            key: "meta",
            count: 0,
            meanScore: null,
            meanConfidence: null,
            gradeDistribution: {},
            labelDistribution: {},
          },
          nonMeta: {
            key: "non-meta",
            count: 0,
            meanScore: null,
            meanConfidence: null,
            gradeDistribution: {},
            labelDistribution: {},
          },
        },
        disclaimer: "Invalid cohort — no evaluation performed.",
      },
      artifacts: buildCalibrationArtifacts({
        schemaVersion: "1.0.0",
        generatedAt: input.options.calculatedAt ?? "1970-01-01T00:00:00.000Z",
        mode: input.options.mode,
        cohortId: "invalid",
        cohortSchemaVersion: "1.0.0",
        cohortSize: 0,
        evaluatedCount: 0,
        errorCount: 0,
        activeModel: {
          key: null,
          version: null,
          status: null,
          isActive: false,
        },
        evaluationModel: {
          key: null,
          version: null,
          status: null,
          isActive: false,
        },
        modelActivated: false,
        providerCallsMade: false,
        disclaimer: "Invalid cohort — no evaluation performed.",
        characters: [],
        statistics: {
          monotonicOrdering: {
            labelScoreSpearman: null,
            pairwiseConcordance: null,
            pairwiseDiscordance: null,
            pairwiseTies: null,
            inversions: [],
          },
          outliers: [],
          dimensionSaturation: [],
          confidenceVersusCoverage: [],
          metaVersusNonMeta: {
            meta: {
              key: "meta",
              count: 0,
              meanScore: null,
              meanConfidence: null,
              gradeDistribution: {},
              labelDistribution: {},
            },
            nonMeta: {
              key: "non-meta",
              count: 0,
              meanScore: null,
              meanConfidence: null,
              gradeDistribution: {},
              labelDistribution: {},
            },
          },
          roleSlices: [],
          classSpecSlices: [],
          missingDataSlices: [],
          gradeDistribution: {},
          gradeDistributionNote: "No data",
          weightAblation: [],
          bootstrapIntervals: [],
        },
        utilityCostAggregate: {
          totalBaseline: 0,
          totalFallback: 0,
          fallbackTriggeredCount: 0,
        },
      }),
      validationErrors: validated.errors,
    };
  }

  const report = runCalibrationHarness(
    validated.manifest as CohortManifest,
    input.options,
    input.deps,
  );
  const artifacts = buildCalibrationArtifacts(report);
  const chosen = input.publicSafe ? artifacts.publicSafeReport : artifacts.report;

  return {
    summary: toAdminBacktestSummary(input.scoreModelId, chosen),
    artifacts,
    validationErrors: [],
  };
}
