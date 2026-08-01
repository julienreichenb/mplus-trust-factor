/**
 * Boost shadow Phase 2 — offline/backtest harness contracts.
 * Shadow-only: no production scoring, authenticity write-back, or public flags.
 */

import type { BoostFeatureFactsV1, BoostFeatureKeyV1 } from "../types.js";
import type { BoostShadowExperimentParamsV1 } from "./experiment-params.js";

/** Report schema — bump when JSON/CSV/MD shapes change. */
export const BOOST_SHADOW_BACKTEST_REPORT_SCHEMA = "boost-shadow-backtest-report-v1" as const;

/** Portable evidence bundle schema. */
export const BOOST_SHADOW_EVIDENCE_BUNDLE_SCHEMA = "boost-shadow-evidence-bundle-v1" as const;

/** Phase 2 feature keys (verified-alt is Phase 4 — not loaded here). */
export const PHASE2_FEATURE_KEYS = [
  "progressionVelocity",
  "teammateScoreGap",
  "repeatedStrongerTeammateCohort",
  "highKeyGroupConcentration",
] as const satisfies ReadonlyArray<BoostFeatureKeyV1>;

export type Phase2FeatureKey = (typeof PHASE2_FEATURE_KEYS)[number];

/**
 * Research labels — never auto-inferred from authenticity output.
 * `unlabeled` / `uncertain` are excluded from supervised denominators.
 */
export type ResearchLabelClass =
  | "suspicious_consensus"
  | "legitimate_consensus"
  | "uncertain"
  | "synthetic_fixture"
  | "unlabeled";

export interface ResearchLabelV1 {
  class: ResearchLabelClass;
  /** e.g. reviewer_consensus | synthetic_fixture | external_evidence */
  source: string;
  /** 0..1 when labeled; null when unlabeled. */
  confidence: number | null;
  /** ISO timestamp; null when unlabeled. */
  labeledAt: string | null;
  /** Labeling policy / rubric version. */
  policyVersion: string;
  /** Independent reviewers; null when N/A (synthetic / unlabeled). */
  reviewerCount: number | null;
}

/** Read-only production authenticity snapshot for compare-only analysis. */
export interface ProductionAuthenticityCompareV1 {
  authenticityScore: number | null;
  boostSuspected: boolean | null;
  atypicalProgression: boolean | null;
  redFlagKeys: string[];
  snapshotId: string | null;
  calculatedAt: string | null;
  /** Provenance only — never used as ground truth. */
  source: "score_snapshot_readonly" | "bundle" | "none";
}

export type BoostShadowSplitName = "train" | "evaluation" | "coverage_only";

export interface BoostShadowSplitAssignmentV1 {
  memberId: string;
  characterId: string;
  split: BoostShadowSplitName;
  /** Stable teammate-cohort fingerprint used for leakage grouping. */
  teammateCohortFingerprint: string | null;
  /** Latest run completedAt used for temporal ordering (ISO). */
  latestRunAt: string | null;
  /** Evaluation cutoff applied when computing features. */
  evaluationCutoff: string | null;
  exclusionReason: string | null;
}

export interface BoostShadowFeatureRowV1 {
  memberId: string;
  characterId: string;
  seasonId: string;
  role: string | null;
  keyBand: string | null;
  split: BoostShadowSplitName;
  label: ResearchLabelV1;
  /** True when label may enter supervised denominators. */
  labeledForSupervised: boolean;
  features: Partial<Record<Phase2FeatureKey, number | null>>;
  featureConfidence: Partial<Record<Phase2FeatureKey, number | null>>;
  featureCoverage: Partial<Record<Phase2FeatureKey, number | null>>;
  omittedFeatures: Array<{ featureKey: string; reasonCode: string }>;
  highKeyRunsEligible: number;
  highKeyRunsExcluded: number;
  patternClass:
    | "fixed_team_low_gap"
    | "repeated_stronger_teammate"
    | "high_gap_diverse"
    | "rapid_progression"
    | "insufficient_evidence"
    | "mixed"
    | "unknown";
  productionAuthenticity: ProductionAuthenticityCompareV1;
  facts: BoostFeatureFactsV1;
  error: string | null;
}

export interface FeatureAvailabilitySummary {
  featureKey: Phase2FeatureKey;
  computedCount: number;
  omittedCount: number;
  missingnessRate: number;
  omissionReasonCounts: Record<string, number>;
}

export interface FeatureDistributionSummary {
  featureKey: Phase2FeatureKey;
  sampleSize: number;
  mean: number | null;
  stdev: number | null;
  min: number | null;
  max: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

export interface ConfusionMatrixV1 {
  /** Positive class = suspicious_consensus (or synthetic suspicious). */
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  /** Denominator = labeled supervised rows only. */
  labeledSampleSize: number;
  unlabeledExcluded: number;
}

export interface PrecisionRecallSummary {
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
  sampleSize: number;
  note: string;
}

export interface SliceSummaryV1 {
  key: string;
  count: number;
  labeledCount: number;
  meanFeatureValues: Partial<Record<Phase2FeatureKey, number | null>>;
}

export interface TemporalStabilitySummary {
  /** Spearman of feature values between early vs late half of temporally ordered labeled rows. */
  featureKey: Phase2FeatureKey;
  earlyLateSpearman: number | null;
  sampleSize: number;
}

export interface PairwiseOverlapSummary {
  featureA: Phase2FeatureKey;
  featureB: Phase2FeatureKey;
  bothComputed: number;
  eitherComputed: number;
  overlapRate: number | null;
  pearson: number | null;
}

export interface FixedTeamVersusStrongerSummary {
  fixedTeamLowGapCount: number;
  repeatedStrongerTeammateCount: number;
  highGapDiverseCount: number;
  distinguishable: boolean;
  note: string;
}

export interface AuthenticityCompareSummary {
  rowsWithAuthenticity: number;
  boostSuspectedAgreement: {
    bothPositive: number;
    shadowOnly: number;
    authenticityOnly: number;
    bothNegative: number;
    unlabeledOrMissing: number;
  };
  note: string;
}

export interface BoostShadowBacktestAnalysisV1 {
  featureAvailability: FeatureAvailabilitySummary[];
  featureDistributions: FeatureDistributionSummary[];
  correlationMatrix: Array<{
    featureA: Phase2FeatureKey;
    featureB: Phase2FeatureKey;
    pearson: number | null;
    sampleSize: number;
  }>;
  pairwiseOverlap: PairwiseOverlapSummary[];
  labelDistribution: Record<string, number>;
  confusionMatrix: ConfusionMatrixV1 | null;
  precisionRecall: PrecisionRecallSummary | null;
  temporalStability: TemporalStabilitySummary[];
  roleSlices: SliceSummaryV1[];
  keyBandSlices: SliceSummaryV1[];
  fixedTeamVersusStronger: FixedTeamVersusStrongerSummary;
  authenticityCompare: AuthenticityCompareSummary;
  evidenceCoverage: {
    membersRequested: number;
    membersWithRuns: number;
    membersWithAlignedRatings: number;
    membersMissingRuns: number;
    unlabeledRetainedForCoverage: number;
    labeledSupervisedCount: number;
  };
  splitProvenance: {
    trainCount: number;
    evaluationCount: number;
    coverageOnlyCount: number;
    assignments: BoostShadowSplitAssignmentV1[];
  };
}

export interface BoostShadowBacktestReportV1 {
  schemaVersion: typeof BOOST_SHADOW_BACKTEST_REPORT_SCHEMA;
  evaluationKind: "boost_shadow_phase2_backtest_v1";
  generatedAt: string;
  disclaimer: string;
  isolation: {
    shadowOnly: true;
    productionScoreEffect: false;
    authenticityWriteBack: false;
    publicFlags: false;
    addonChange: false;
    providerCalls: false;
    databaseMigration: false;
    verifiedOwnershipUsage: false;
    modelActivation: false;
    persistsBoostFeatureSnapshot: false;
  };
  highKeyPolicyVersion: string;
  extractorVersion: string;
  experimentParams: BoostShadowExperimentParamsV1;
  cohort: {
    cohortId: string;
    schemaVersion: string;
    description: string;
    memberCount: number;
  };
  /** Offline experimental classifier — never a product boost probability. */
  experimentalClassifier: {
    kind: "offline_non_product_rule_v1";
    label: "OFFLINE_NON_PRODUCT";
    ruleDescription: string;
    thresholds: {
      teammateScoreGapMin: number;
      repeatedStrongerCohortMin: number;
      highKeyConcentrationMin: number;
    };
  };
  rows: BoostShadowFeatureRowV1[];
  analysis: BoostShadowBacktestAnalysisV1;
  providerCallsMade: false;
  scoreSnapshotsWritten: false;
  characterRedFlagsWritten: false;
  authenticityInputsMutated: false;
}

export interface BoostShadowBacktestArtifacts {
  report: BoostShadowBacktestReportV1;
  json: string;
  csv: string;
  markdown: string;
  publicSafeReport: BoostShadowBacktestReportV1;
  publicSafeJson: string;
  publicSafeMarkdown: string;
  publicSafeCsv: string;
}

export interface BoostShadowBacktestRunOptions {
  generatedAt: string;
  experimentParams?: Partial<BoostShadowExperimentParamsV1>;
  /** When true, strip identities from primary artifacts too. */
  publicSafe?: boolean;
}
