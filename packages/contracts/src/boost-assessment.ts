export type BoostAssessmentStatus = "AVAILABLE" | "PARTIAL" | "INSUFFICIENT_DATA";
export type BoostSuspicionBand = "LOW" | "ELEVATED" | "HIGH";
export type BoostAssessmentCompleteness = "FULL" | "PARTIAL_PRIMARY_MISSING" | "INSUFFICIENT";

export type BoostAssessmentApplicabilityStatus =
  | "APPLICABLE"
  | "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL"
  | "INSUFFICIENT_CONTEXT";

export interface BoostAssessmentApplicabilityDTO {
  status: BoostAssessmentApplicabilityStatus;
}

export type BoostSignalCode =
  | "HIGH_KEY_PERFORMANCE_MISMATCH"
  | "STRONG_PEER_PERFORMANCE_GAP"
  | "RECURRENT_STRONG_PEER_COHORT"
  | "HIGH_KEY_SURVIVAL_MISMATCH"
  | "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE"
  | "HIGHEST_RUN_TEMPORAL_CLUSTER"
  | "RECURRENT_HIGH_KEY_COHORT"
  | "STRONGER_RECURRENT_COHORT";

export interface BoostAssessmentSampleDTO {
  highKeyRunCount: number;
  boostSampleSize?: number | null;
  timedRunCountUsedForMedian?: number | null;
  parseCoverage: number | null;
  peerComparableRunCount?: number | null;
  peerCoverage?: number | null;
  completeRosterRunCount: number | null;
  seasonContextAvailable: boolean;
  subjectMedianTimedKey?: number | null;
  subjectMedianKeyPercentileBps?: number | null;
  subjectMedianKeyPercentileLabel?: string | null;
  p99KeyThreshold: number | null;
  p999KeyThreshold: number | null;
  appliedAnchorPercentileLabel: string | null;
  exceptionalOperatingLevel?: boolean;
}

export interface BoostCoverageDungeonDTO {
  dungeonSlug: string;
  blizzardBestKeyLevel: number | null;
  publicAnalysableBestKeyLevel: number | null;
  keyLevelVerificationGap: number | null;
  analysable: boolean;
}

export interface BoostAssessmentCoverageDTO {
  expectedTopRuns: number;
  analyzableTopRuns: number;
  unavailableTopRuns: number;
  dungeons: BoostCoverageDungeonDTO[];
}

export type BoostPeerGapClassificationPublic =
  | "EXTREME_RED"
  | "RED"
  | "NEUTRAL"
  | "GREEN"
  | "EXTREME_GREEN"
  | "UNAVAILABLE";

export interface BoostRunEvidencePublicDTO {
  dungeonSlug: string;
  slot: "PRIMARY" | "SECONDARY";
  keyLevel: number | null;
  subjectKeyPercent: number | null;
  peerMedianKeyPercent: number | null;
  performanceDelta: number | null;
  classification: BoostPeerGapClassificationPublic;
  reportUrl: string | null;
}

export type BoostSignalFactsDTO =
  | {
      code: "STRONG_PEER_PERFORMANCE_GAP";
      peerComparableRunCount: number | null;
      analyzablePrimaryRunCount: number | null;
      redPrimaryCount: number | null;
      extremePrimaryCount: number | null;
      weightedRedSeverity: number | null;
      weightedGreenSeverity: number | null;
      materiallyNegativePrimaryCount: number | null;
      severeNegativePrimaryCount: number | null;
      medianPrimaryPerformanceDelta: number | null;
      severePrimaryRatio: number | null;
    }
  | {
      code: "RECURRENT_STRONG_PEER_COHORT";
      gapDungeonCount: number | null;
      identities: Array<{ displayName: string | null }>;
    }
  | {
      code: "HIGH_KEY_SURVIVAL_MISMATCH";
      verifiedPrimaryRunCount: number | null;
      totalDeaths: number | null;
      runsWithAtLeastOneDeath: number | null;
      runsWithAtLeastTwoDeaths: number | null;
      runsWithAtLeastThreeDeaths: number | null;
    }
  | {
      code: "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE";
      unverifiableTopRunCount: number | null;
    }
  | {
      code: "HIGHEST_RUN_TEMPORAL_CLUSTER";
      maxDistinctDungeons24h: number | null;
      maxDistinctDungeons48h: number | null;
    }
  | { code: "HIGH_KEY_PERFORMANCE_MISMATCH" }
  | { code: "RECURRENT_HIGH_KEY_COHORT" }
  | { code: "STRONGER_RECURRENT_COHORT" };

export interface BoostAssessmentSignalDTO {
  code: BoostSignalCode;
  contribution: number;
  confidence: number;
  status: "COMPUTED" | "UNAVAILABLE";
  summary: string;
  missingReason?: string | null;
  displayOrder: number;
  facts: BoostSignalFactsDTO;
}

export interface BoostAssessmentPublicDTO {
  status: BoostAssessmentStatus;
  suspicionScore: number | null;
  suspicionBand: BoostSuspicionBand | null;
  confidence: number;
  primaryEvidenceAvailable?: boolean;
  assessmentCompleteness?: BoostAssessmentCompleteness;
  applicability: BoostAssessmentApplicabilityDTO;
  coverage: BoostAssessmentCoverageDTO;
  runEvidence: BoostRunEvidencePublicDTO[];
  detectorVersion: string;
  calculatedAt: string;
  sample: BoostAssessmentSampleDTO;
  signals: BoostAssessmentSignalDTO[];
  disclaimer: string;
}

export const BOOST_ASSESSMENT_PUBLIC_DISCLAIMER =
  "Heuristic indicator based on public gameplay evidence. It does not prove paid boosting, account sharing, or player identity.";
