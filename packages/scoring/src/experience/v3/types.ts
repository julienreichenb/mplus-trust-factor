import type {
  ExperienceV3CalibrationStatus,
  ExperienceV3ModelConfig,
} from "./constants.js";

/** Provider-state semantics for previous-season and related history facts. */
export type ExperienceEvidenceStateV3 =
  | "HAS_VALUE"
  | "CONFIRMED_NO_ACTIVITY"
  | "PARTIAL"
  | "PROVIDER_FAILURE"
  | "UNKNOWN";

/** Achievement completion visibility — account-visible ≠ character-confirmed. */
export type EliteAchievementVisibilityV3 =
  | "CHARACTER_CONFIRMED"
  | "ACCOUNT_VISIBLE"
  | "AMBIGUOUS"
  | "ABSENT"
  | "UNKNOWN";

export type HistoricalRankSourceV3 =
  | "LOCAL_LEADERBOARD"
  | "BLIZZARD"
  | "RAIDER_IO"
  | "UNKNOWN";

export type ExperienceV3AvailabilityState =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE";

export type ExperienceV3ComponentKey =
  | "currentExposure"
  | "previousSeasonStrength"
  | "eliteHistory"
  | "historicalRank";

/** Versioned elite achievement catalog entry (normative spec §5). */
export interface EliteAchievementCatalogEntryV3 {
  achievementId: number;
  seasonIdOrSlug: string;
  title: string;
  /** Population percentile represented by the title (e.g. 0.1 for top 0.1%). */
  percentile: number;
  regionScope: string | null;
  evidenceSemantics: string;
  version: string;
}

/** Versioned previous-season normalization policy. */
export interface PreviousSeasonNormalizationPolicyV3 {
  id: string;
  version: string;
  seasonId: string;
  seasonSlug: string;
  region: string;
  /** Absolute Mythic+ score thresholds for the prior season. */
  k50: number;
  k90: number;
  k99: number;
  source: "PLATFORM" | "BLIZZARD" | "RAIDER_IO" | "MANUAL";
  sampleSize: number | null;
  confidence: number;
}

/** Versioned historical-rank policy. */
export interface HistoricalRankPolicyV3 {
  id: string;
  version: string;
  /** Prefer local snapshots over Blizzard over Raider.IO. */
  sourcePriority: HistoricalRankSourceV3[];
  /** Max seasons of age before mild decay applies (informational). */
  maxAgeSeasonsBeforeDecay: number;
  confidence: number;
}

/** Current durable exposure inputs — mirrors Experience V2 run facts (no WCL). */
export interface ExperienceV3ExposureRunInput {
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
}

export interface ExperienceV3CurrentExposureFact {
  expectedDungeonCount: number;
  selectedRuns: ExperienceV3ExposureRunInput[];
  seasonRuns: ExperienceV3ExposureRunInput[];
  /**
   * Distinct prior seasons with public character history (V2 historical_seasons).
   * Distinct from previous-season *strength* (score magnitude).
   */
  priorSeasonCount: number;
  priorSeasonSourceDepth?: number;
  provenance:
    | "CONFIRMED_ABSENCE"
    | "HAS_HISTORY"
    | "PARTIAL_SOURCES"
    | "PROVIDER_FAILURE";
  observedAt: string;
}

/** Previous-season Mythic+ strength fact (provider-state-safe). */
export interface ExperienceV3PreviousSeasonFact {
  evidenceState: ExperienceEvidenceStateV3;
  /** Absolute prior-season overall score when known. */
  score: number | null;
  seasonId: string | null;
  seasonSlug: string | null;
  source: "BLIZZARD" | "LOCAL_HISTORY" | "RAIDER_IO" | "UNKNOWN";
  /** Source quality 0–1 for confidence. */
  sourceConfidence: number;
  fetchedAt: string | null;
}

/** One observed elite achievement / title. */
export interface ExperienceV3EliteAchievementFact {
  achievementId: number;
  visibility: EliteAchievementVisibilityV3;
  /** Seasons since the achievement's season (0 = current/prior). */
  seasonsAgo: number | null;
  observedAt: string | null;
}

export interface ExperienceV3EliteHistoryFact {
  evidenceState: ExperienceEvidenceStateV3;
  achievements: ExperienceV3EliteAchievementFact[];
}

/** Exceptional historical ranking fact (optional). */
export interface ExperienceV3HistoricalRankFact {
  evidenceState: ExperienceEvidenceStateV3;
  source: HistoricalRankSourceV3;
  seasonId: string | null;
  seasonSlug: string | null;
  region: string | null;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  /** Absolute rank when known (1 = best). */
  rank: number | null;
  /** Population size when known. */
  population: number | null;
  /** Explicit percentile 0–100 when known (lower is better for rank). */
  percentile: number | null;
  /** True when top-10 class/spec/region. */
  top10ClassSpecRegion: boolean;
  fetchedAt: string | null;
  sourceConfidence: number;
}

/**
 * Phase 2 verified account-linked boost — contract only; must stay disabled.
 * No public account-link inference.
 */
export interface ExperienceV3AccountBoostContract {
  enabled: false;
  linkedCharacterContribution: null;
  ownershipConfidence: null;
  note: "Phase 2 verified Battle.net-linked boost is not implemented; disabled.";
}

export interface ExperienceV3ComponentResult {
  key: ExperienceV3ComponentKey;
  /** Whether this component contributes to the blended score. */
  available: boolean;
  /** Normalized 0–100 when available; null when excluded. */
  score: number | null;
  confidence: number;
  weight: number;
  /** Effective weight after renormalization (0 when unavailable). */
  effectiveWeight: number;
  evidenceState: ExperienceEvidenceStateV3 | "N_A";
  detail: Record<string, unknown>;
}

export interface ExperienceV3ContributorDiagnostic {
  key: string;
  value: number | null;
  weight: number | null;
  note: string | null;
}

export interface ExperienceV3Explanation {
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: ExperienceV3CalibrationStatus;
  components: ExperienceV3ComponentResult[];
  currentExposure: {
    score: number | null;
    v2Components: Array<{
      metricKey: string;
      normalizedValue: number;
      confidence: number;
    }>;
    evidence: Record<string, unknown>;
  };
  previousSeason: {
    evidenceState: ExperienceEvidenceStateV3;
    source: ExperienceV3PreviousSeasonFact["source"];
    rawScore: number | null;
    normalizedScore: number | null;
    policyId: string;
    policyVersion: string;
  };
  eliteHistory: {
    evidenceState: ExperienceEvidenceStateV3;
    confirmedTitleCount: number;
    accountVisibleOnlyCount: number;
    catalogVersion: string;
    normalizedScore: number | null;
    ambiguityNotes: string[];
  };
  historicalRank: {
    evidenceState: ExperienceEvidenceStateV3;
    source: HistoricalRankSourceV3;
    percentile: number | null;
    rank: number | null;
    seasonSlug: string | null;
    normalizedScore: number | null;
    optional: true;
  };
  accountLinkedBoost: ExperienceV3AccountBoostContract;
  missingEvidenceReasons: string[];
  confidenceLimits: string[];
  noWclDependency: true;
  noCurrentPerformanceLeakage: true;
  noPublicAccountLinkInference: true;
  phase2State: "INACTIVE";
  contributors: ExperienceV3ContributorDiagnostic[];
}

/** Frozen manifest identity stamps — Experience does not require WCL slots. */
export interface ExperienceV3ManifestIdentity {
  contentHash: string;
  schemaVersion: string;
  selectorVersion: string;
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  highKeyPolicyId: string;
  evidenceCutoffAt: string;
}

export interface ExperienceV3ComputeInput {
  manifest: ExperienceV3ManifestIdentity;
  currentExposure: ExperienceV3CurrentExposureFact;
  previousSeason: ExperienceV3PreviousSeasonFact;
  previousSeasonPolicy: PreviousSeasonNormalizationPolicyV3;
  eliteHistory: ExperienceV3EliteHistoryFact;
  /** Optional; null / UNKNOWN → component excluded and weights renormalized. */
  historicalRank: ExperienceV3HistoricalRankFact | null;
  historicalRankPolicy: HistoricalRankPolicyV3;
  /** Wall-clock for deterministic explanation stamps only. */
  computedAt: string;
  /** Optional config override for calibration ablations (defaults to MODEL_CONFIG). */
  config?: ExperienceV3ModelConfig;
}

export interface ExperienceV3ComputeResult {
  score: number | null;
  confidence: number;
  state: ExperienceV3AvailabilityState;
  algorithmVersion: string;
  modelLabel: string;
  calibrationStatus: ExperienceV3CalibrationStatus;
  inputFingerprint: string;
  components: ExperienceV3ComponentResult[];
  explanation: ExperienceV3Explanation;
  metrics: Record<string, unknown>;
}

export interface ExperienceV3CalibrationExport {
  schemaVersion: typeof import("./constants.js").EXPERIENCE_V3_SCHEMA_VERSION;
  algorithmVersion: string;
  modelConfig: ExperienceV3ModelConfig;
  input: ExperienceV3ComputeInput;
  result: Pick<
    ExperienceV3ComputeResult,
    "score" | "confidence" | "state" | "inputFingerprint" | "components"
  >;
  contributors: ExperienceV3ContributorDiagnostic[];
}
