/**
 * Offline experiment parameters — hypotheses only, not product thresholds.
 * Phase 1 high-key / feature constants remain authoritative for feature extraction.
 */

export const BOOST_SHADOW_EXPERIMENT_PARAMS_VERSION = "boost-shadow-experiment-params-v1" as const;

export interface BoostShadowExperimentParamsV1 {
  schemaVersion: typeof BOOST_SHADOW_EXPERIMENT_PARAMS_VERSION;
  /**
   * Hypothesis: fraction of temporally ordered members held out for evaluation.
   * Remaining earlier members form the train split (when labeled).
   */
  temporalHoldoutFraction: number;
  /**
   * Hypothesis: offline rule thresholds for experimental non-product classifier.
   * Not authenticityScore / boost_suspected product thresholds.
   */
  experimentalUnusualPattern: {
    teammateScoreGapMin: number;
    repeatedStrongerCohortMin: number;
    highKeyConcentrationMin: number;
  };
  /**
   * Hypothesis: concentration + gap bands used to distinguish fixed teams
   * from repeated-stronger-teammate patterns in shadow reports.
   */
  patternDiscrimination: {
    concentrationHighMin: number;
    gapLowMax: number;
    gapHighMin: number;
    cohortHighMin: number;
  };
  /** Minimum label confidence to include in supervised denominators. */
  minLabelConfidenceForSupervised: number;
  /** Minimum reviewer count for consensus labels (synthetic may omit). */
  minReviewerCountForConsensus: number;
}

export const DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS: BoostShadowExperimentParamsV1 = {
  schemaVersion: BOOST_SHADOW_EXPERIMENT_PARAMS_VERSION,
  temporalHoldoutFraction: 0.3,
  experimentalUnusualPattern: {
    teammateScoreGapMin: 0.4,
    repeatedStrongerCohortMin: 0.4,
    highKeyConcentrationMin: 0.5,
  },
  patternDiscrimination: {
    concentrationHighMin: 0.5,
    gapLowMax: 0.15,
    gapHighMin: 0.4,
    cohortHighMin: 0.4,
  },
  minLabelConfidenceForSupervised: 0.6,
  minReviewerCountForConsensus: 2,
};

export function mergeExperimentParams(
  partial?: Partial<BoostShadowExperimentParamsV1>,
): BoostShadowExperimentParamsV1 {
  if (!partial) return { ...DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS };
  return {
    ...DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS,
    ...partial,
    schemaVersion: BOOST_SHADOW_EXPERIMENT_PARAMS_VERSION,
    experimentalUnusualPattern: {
      ...DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS.experimentalUnusualPattern,
      ...partial.experimentalUnusualPattern,
    },
    patternDiscrimination: {
      ...DEFAULT_BOOST_SHADOW_EXPERIMENT_PARAMS.patternDiscrimination,
      ...partial.patternDiscrimination,
    },
  };
}
