/**
 * Private boost feature contract — Phase 1 shadow only.
 * Never a public DTO. Must not populate AuthenticityFeatureInput.
 */

import type { BOOST_FEATURE_SCHEMA_VERSION } from "./constants.js";

/** Per-feature evidence. Omitted feature key = not computed; value 0 = computed, no signal. */
export interface BoostFeatureEvidenceV1 {
  value: number;
  confidence: number;
  sampleSize: number;
  coverage: number;
}

export type BoostFeatureKeyV1 =
  | "progressionVelocity"
  | "teammateScoreGap"
  | "repeatedStrongerTeammateCohort"
  | "highKeyGroupConcentration"
  | "verifiedAltExperienceMitigation";

export type BoostMissingReasonCode =
  | "INSUFFICIENT_DATED_RUNS"
  | "NO_BASELINE"
  | "LOW_DATED_RUN_COVERAGE"
  | "INSUFFICIENT_HIGH_KEYS"
  | "NO_TIME_ALIGNED_SUBJECT_RATING"
  | "NO_TIME_ALIGNED_GAPS"
  | "AMBIGUOUS_IDENTITY"
  | "INCOMPLETE_ROSTERS"
  | "NO_VERIFIED_SUBJECT"
  | "OWNERSHIP_NOT_VALID_AT_T"
  | "NO_ELIGIBLE_ALT_EVIDENCE"
  | "CROSS_REGION_UNSUPPORTED";

export interface BoostFeatureMissingV1 {
  featureKey: BoostFeatureKeyV1;
  reasonCode: BoostMissingReasonCode;
}

export interface BoostFeatureDiagnosticsV1 {
  startingBestKey?: number | null;
  endingBestKey?: number | null;
  keyLevelDelta?: number | null;
  elapsedDays?: number | null;
  intermediateBandsObserved?: number | null;
  datedRunCoverage?: number | null;
  topKeyRunCount?: number | null;
  meanAlignedTeammateGap?: number | null;
  topCohortSharedHighKeys?: number | null;
  highKeyCoreOverlapFraction?: number | null;
  verifiedAltMitigationPresent?: boolean;
  verifiedAltScoreMargin?: number | null;
}

export interface BoostFeatureFactsV1 {
  schemaVersion: typeof BOOST_FEATURE_SCHEMA_VERSION;
  extractorVersion: string;
  highKeyPolicyVersion: string;
  subjectCharacterId: string;
  seasonId: string;
  calculatedAt: string;
  sourceProvenance: {
    primary: "persisted_runs" | "raiderio_facts" | "mixed" | "in_memory";
    runSourceCounts?: Record<string, number>;
  };
  highKeySet: {
    runsEligible: number;
    runsExcluded: number;
    exclusionReasonCounts: Record<string, number>;
  };
  features: {
    progressionVelocity?: BoostFeatureEvidenceV1;
    teammateScoreGap?: BoostFeatureEvidenceV1;
    repeatedStrongerTeammateCohort?: BoostFeatureEvidenceV1;
    highKeyGroupConcentration?: BoostFeatureEvidenceV1;
    verifiedAltExperienceMitigation?: BoostFeatureEvidenceV1;
  };
  missing: BoostFeatureMissingV1[];
  diagnostics?: BoostFeatureDiagnosticsV1;
}

/** Shadow-only isolation markers — compile-time + runtime proof of no production effect. */
export interface BoostShadowIsolationGuarantees {
  altersAuthenticityScore: false;
  writesAuthenticityFeatureInput: false;
  altersRedFlags: false;
  altersTrustScore: false;
  altersGrades: false;
  altersConfidence: false;
  altersEligibility: false;
  affectsRefreshPublication: false;
  emitsPublicExplanations: false;
  emitsAddonBits: false;
  persistsToDatabase: false;
  infersOwnershipFromNamesGuildsIpsOrRoster: false;
}

export type TeammateIdentityConfidence = "character_id" | "provider_key" | "normalized_fallback" | "ambiguous";

export interface CanonicalTeammateIdentity {
  /** Private internal key — never public. */
  canonicalKey: string;
  confidence: TeammateIdentityConfidence;
}

export interface BoostShadowRunParticipantInput {
  characterId?: string | null;
  providerCharacterKey?: string | null;
  regionCode: string;
  realmSlug: string;
  /** Display name only for identity fallback — never stored in feature output. */
  displayName?: string | null;
  isTargetCharacter: boolean;
  mythicRatingAtRun?: number | null;
}

export interface BoostShadowRatingSnapshotInput {
  characterId: string;
  mythicRating: number;
  capturedAt: string;
  seasonId?: string | null;
}

export type BoostShadowRatingSource =
  | "run_participant"
  | "snapshot_at_or_before"
  | "explicit_time_aligned";

export interface TimeAlignedRating {
  rating: number;
  source: BoostShadowRatingSource;
  capturedAt: string;
}

export interface BoostShadowRunInput {
  runId: string;
  seasonId: string;
  keyLevel: number;
  timed: boolean;
  scoreValue?: number | null;
  completedAt: string | null;
  participants: BoostShadowRunParticipantInput[];
  /** Optional explicit time-aligned ratings keyed by canonical participant key. */
  explicitAlignedRatings?: Record<string, { rating: number; capturedAt: string }>;
  source?: string;
}

export type OwnershipStatusInput = "CURRENT" | "HISTORICAL" | "STALE" | "REVOKED";
export type OwnershipConfidenceInput = "CONFIRMED" | "LIKELY" | "WEAK";

/** Point-in-time ownership evidence — verified Battle.net only. */
export interface VerifiedOwnershipEvidenceInput {
  ownershipId: string;
  battleNetAccountId: string;
  characterId: string | null;
  regionId: string;
  status: OwnershipStatusInput;
  confidence: OwnershipConfidenceInput;
  verifiedAt: string;
  revokedAt: string | null;
  accountClaimed: boolean;
  accountUnlinkedAt: string | null;
  currentSeasonMythicRating: number | null;
  currentSeasonMythicSeasonId: string | null;
  currentSeasonMythicFetchedAt: string | null;
}

export interface BoostFeatureExtractorInput {
  subjectCharacterId: string;
  seasonId: string;
  regionId: string;
  calculatedAt: string;
  runs: BoostShadowRunInput[];
  /** Optional rating snapshots for time-alignment hierarchy step 2. */
  ratingSnapshots?: BoostShadowRatingSnapshotInput[];
  /** Optional verified ownership records for mitigation (PIT filtered at calculatedAt). */
  ownershipEvidence?: VerifiedOwnershipEvidenceInput[];
  sourceProvenance?: BoostFeatureFactsV1["sourceProvenance"];
}

export type FeatureComputeResult =
  | { status: "computed"; evidence: BoostFeatureEvidenceV1; diagnostics?: Partial<BoostFeatureDiagnosticsV1> }
  | { status: "omitted"; reasonCode: BoostMissingReasonCode; diagnostics?: Partial<BoostFeatureDiagnosticsV1> };
