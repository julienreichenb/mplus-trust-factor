import type { BoostAssessmentPublicDTO, BoostAssessmentStatus, BoostSuspicionBand } from "@mplus/contracts";
import type { BOOST_ASSESSMENT_SCHEMA_VERSION, PeerGapClass } from "./policy.js";
import type { BoostRunParticipantInput } from "./identity.js";

export type BoostMissingReasonCode =
  | "MISSING_SEASON_CONTEXT"
  | "INSUFFICIENT_SAMPLE"
  | "INSUFFICIENT_HIGH_KEYS"
  | "SUBJECT_NOT_EXCEPTIONAL_KEY_LEVEL"
  | "MISSING_PARSE_DATA"
  | "MISSING_PEER_PARSE_DATA"
  | "INCOMPLETE_ROSTERS"
  | "AMBIGUOUS_IDENTITY"
  | "AMBIGUOUS_WCL_ALIGNMENT"
  | "MISSING_SURVIVAL_EVIDENCE"
  | "INSUFFICIENT_PEER_RECURRENCE"
  | "NO_MATERIAL_PEER_GAP"
  | "CANONICAL_EVIDENCE_MANIFEST_MISSING"
  | "CANONICAL_SLOT_MISSING"
  | "NO_COMPATIBLE_RAW"
  | "NO_RANKING_SNAPSHOT"
  | "INCOMPATIBLE_RANKING_SEMANTIC"
  | "SUBJECT_ACTOR_UNALIGNED"
  | "SUBJECT_BRACKET_PERCENT_MISSING"
  | "CANONICAL_EIGHT_RUN_SELECTION_MISSING"
  | "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE";

export type BoostSignalCode =
  | "STRONG_PEER_PERFORMANCE_GAP"
  | "RECURRENT_STRONG_PEER_COHORT"
  | "HIGH_KEY_SURVIVAL_MISMATCH"
  | "TOP_RUN_PUBLIC_EVIDENCE_UNAVAILABLE"
  | "HIGHEST_RUN_TEMPORAL_CLUSTER"
  | "HIGH_KEY_PERFORMANCE_MISMATCH";

export interface BoostPeerParse {
  identityKey: string;
  displayName: string | null;
  keyParse: number;
  role: string | null;
}

export interface BoostRunInput {
  runId: string;
  seasonId: string;
  dungeonSlug?: string | null;
  dungeonName?: string | null;
  keyLevel: number;
  timed: boolean;
  scoreValue?: number | null;
  completedAt: string | null;
  participants: BoostRunParticipantInput[];
  /** @deprecated Use subjectKeyParse (WCL Key % / bracketPercent). */
  parsePercentile?: number | null;
  /** WCL Key % — bracketPercent only. */
  subjectKeyParse?: number | null;
  parseSemantic?: "BRACKET_PERCENT" | "UNAVAILABLE" | null;
  parseRole?: string | null;
  peerKeyParses?: BoostPeerParse[];
  deathCount?: number | null;
  survivalAvailable?: boolean;
  usedForMedian?: boolean;
  alignmentStatus?: "ALIGNED" | "AMBIGUOUS" | "MISSING";
  evidenceSource?: string | null;
  missingReason?: BoostMissingReasonCode | null;
  rankingSnapshotId?: string | null;
  rankingSnapshotContentHash?: string | null;
  slotId?: string | null;
  slotIndex?: number | null;
  /** Canonical WCL report code. Named `wclCode` so persisted JSON avoids the isolation substring `reportCode`. */
  wclCode?: string | null;
  wclFightId?: number | null;
}

export interface BoostDungeonContext {
  dungeonSlug: string;
  blizzardBestKeyLevel: number | null;
  blizzardBestCompletedAt: string | null;
  blizzardBestMythicRunId: string | null;
  publicAnalysableBestKeyLevel: number | null;
  publicAnalysableCode: string | null;
  publicAnalysableFightId: number | null;
  topPublicEvidenceAvailable: boolean;
  keyLevelVerificationGap: number | null;
}

export interface SeasonHighKeyContext {
  available: boolean;
  contextRevisionId: string | null;
  contextRevisionKey: string;
  distributionSnapshotId: string | null;
  p99KeyThreshold: number | null;
  p999KeyThreshold: number | null;
  appliedAnchorPercentileLabel: string | null;
  subjectMedianTimedKey?: number | null;
  subjectMedianKeyPercentileBps?: number | null;
  subjectMedianKeyPercentileLabel?: string | null;
  timedRunCountUsedForMedian?: number;
  exceptionalOperatingLevel?: boolean;
  canonicalSelectionComplete?: boolean;
  missingReason?: BoostMissingReasonCode;
}

export interface BoostFeatureEvidence {
  value: number;
  confidence: number;
  sampleSize: number;
  coverage: number;
}

export type BoostFeatureComputeResult =
  | {
      status: "computed";
      evidence: BoostFeatureEvidence;
      summary: string;
      publicEvidence: Record<string, unknown>;
    }
  | {
      status: "unavailable";
      reasonCode: BoostMissingReasonCode;
      summary: string;
      publicEvidence: Record<string, unknown>;
      confidence?: number;
    };

export interface BoostAssessmentInternalSignal {
  code: BoostSignalCode;
  contribution: number;
  confidence: number;
  status: "COMPUTED" | "UNAVAILABLE";
  summary: string;
  missingReason: BoostMissingReasonCode | null;
  evidence: Record<string, unknown>;
}

export interface BoostAnalyzedRunRow {
  runId: string;
  dungeonSlug: string | null;
  dungeonName: string | null;
  completedAt: string | null;
  keyLevel: number;
  timed: boolean;
  usedForMedian: boolean;
  usedInBoostSample: boolean;
  subjectKeyParse: number | null;
  peerMedianKeyParse: number | null;
  peerMaxKeyParse: number | null;
  performanceDelta: number | null;
  peerPerformanceGap: number | null;
  gapClass: PeerGapClass;
  gapPolarity: "RED" | "GREEN" | "NEUTRAL" | "UNAVAILABLE";
  slotIndex: number | null;
  dungeonSlotRole: "PRIMARY" | "SECONDARY";
  dungeonSlotWeight: number;
  peerGapSeverity: number | null;
  peerGapWeightedContribution: number | null;
  peerCount: number;
  peerKeyParses: BoostPeerParse[];
  deathCount: number | null;
  rosterComplete: boolean;
  recurringStrongPeers: string[];
  evidenceSource: string | null;
  missingReason: BoostMissingReasonCode | null;
  wclCode?: string | null;
  wclFightId?: number | null;
}

export interface BoostAssessmentResult {
  schemaVersion: typeof BOOST_ASSESSMENT_SCHEMA_VERSION;
  detectorVersion: string;
  policyVersion: string;
  subjectCharacterId: string;
  seasonId: string;
  contextRevisionKey: string;
  contextRevisionId: string | null;
  status: BoostAssessmentStatus;
  suspicionScore: number | null;
  suspicionBand: BoostSuspicionBand | null;
  confidence: number;
  primaryEvidenceAvailable: boolean;
  assessmentCompleteness: "FULL" | "PARTIAL_PRIMARY_MISSING" | "INSUFFICIENT";
  calculatedAt: string;
  signals: BoostAssessmentInternalSignal[];
  sample: {
    highKeyRunCount: number;
    boostSampleSize: number;
    timedRunCountUsedForMedian: number;
    parseCoveredRunCount: number;
    parseCoverage: number | null;
    peerComparableRunCount: number;
    peerCoverage: number | null;
    completeRosterRunCount: number;
    seasonContextAvailable: boolean;
    subjectMedianTimedKey: number | null;
    subjectMedianKeyPercentileBps: number | null;
    subjectMedianKeyPercentileLabel: string | null;
    p99KeyThreshold: number | null;
    p999KeyThreshold: number | null;
    appliedAnchorPercentileLabel: string | null;
    exceptionalOperatingLevel: boolean;
    dungeonContexts?: BoostDungeonContext[];
    analyzedRuns: BoostAnalyzedRunRow[];
    rankingSnapshotIds?: string[];
    primaryEvidenceAvailable?: boolean;
    assessmentCompleteness?: BoostAssessmentResult["assessmentCompleteness"];
  };
  evidenceFingerprint: string;
  isolation: BoostAssessmentIsolationGuarantees;
}

export interface BoostAssessmentIsolationGuarantees {
  altersCharacterScore: false;
  altersCompositeScore: false;
  altersContextualScore: false;
  altersSkillDimensions: false;
  altersGrade: false;
  altersScoringConfidence: false;
  altersEligibility: false;
  altersPublishedScoreSelection: false;
  altersRefreshStatus: false;
  writesRedFlags: false;
  usesAuthenticityScore: false;
  fetchesProviders: false;
}

export interface BoostAssessmentExtractorInput {
  subjectCharacterId: string;
  seasonId: string;
  calculatedAt: string;
  runs: BoostRunInput[];
  seasonHighKeyContext: SeasonHighKeyContext;
  dungeonContexts?: BoostDungeonContext[];
}

export type { BoostAssessmentPublicDTO };
