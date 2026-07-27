import type {
  AdminScoreModelDTO,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  Grade,
  JobStatusDTO,
  MetaResponse,
  RedFlagDTO,
  RefreshStatusResponse,
  RegionCode,
  ScoreModelConfig,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
  AnalyzedRunSummary,
  EquipmentSummary,
  TalentSummary,
  SeasonSummary,
  ProfileEntitlements,
  ProfileWarning,
  ScoringRunSelectionProfileDTO,
  ScoringSelectedRunProfileDTO,
} from "@mplus/contracts";

/** Field visibility flags — launch may unlock everything. */
export type Entitlements = ProfileEntitlements;

/**
 * Wave 4 UX: one highest-key run per active-season dungeon.
 * Optional until Agent 21 freezes the shared selection contract; fixtures populate it for rendering.
 */
export interface SelectedRunView {
  runId: string;
  dungeonName: string;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
  timed: boolean | null;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  selectionReason: "HIGHEST_KEY" | "HIGHEST_SCORE_TIEBREAK" | "LATEST_TIEBREAK";
  parsePercentile: number | null;
  keyDifficultyPercentile: number | null;
  evidenceSummary: string | null;
  missingMetrics: string[];
}

/**
 * Enriched profile view for the UI — API response plus optional Wave 4 rendering fields.
 */
export type CharacterProfileView = CharacterProfileResponse & {
  selectedRuns?: SelectedRunView[] | null;
  selectedRunExpectedCount?: number | null;
};

export interface RealmOption {
  slug: string;
  name: string;
}

export interface ModelValidationResult {
  valid: boolean;
  errors: string[];
  weightSum: number;
}

export interface BacktestSummary {
  cohortSize: number;
  meanOverall: number;
  gradeDistribution: Record<Grade, number>;
  notes: string;
}

export interface EditableModelConfig extends ScoreModelConfig {
  nestedMetricWeights: {
    performance: Record<string, number>;
    survival: Record<string, number>;
    utility: Record<string, number>;
    experienceConsistency: Record<string, number>;
    mythicRaid: Record<string, number>;
  };
  confidenceParameters: {
    minRunsForFullConfidence: number;
    shrinkageFloor: number;
  };
  boostThresholds: {
    suspicionSoft: number;
    suspicionHard: number;
  };
}

export type ApiMode = "mock" | "live";

export interface MplusApiClient {
  getMeta(signal?: AbortSignal): Promise<MetaResponse>;
  searchRealms(region: RegionCode, query: string, signal?: AbortSignal): Promise<RealmOption[]>;
  getCharacterProfile(
    identity: CharacterIdentityInput,
    signal?: AbortSignal,
  ): Promise<CharacterProfileView>;
  refreshCharacter(
    identity: CharacterIdentityInput,
    signal?: AbortSignal,
  ): Promise<RefreshStatusResponse>;
  getRefreshStatus(identity: CharacterIdentityInput, signal?: AbortSignal): Promise<RefreshStatusResponse>;
  compareCharacters(
    request: CharacterComparisonRequest,
    signal?: AbortSignal,
  ): Promise<CharacterComparisonResponse>;
  listModels(signal?: AbortSignal): Promise<AdminScoreModelDTO[]>;
  cloneModel(modelId: string, signal?: AbortSignal): Promise<AdminScoreModelDTO>;
  updateModel(
    modelId: string,
    config: unknown,
    signal?: AbortSignal,
  ): Promise<AdminScoreModelDTO>;
  validateModel(modelId: string, config: unknown, signal?: AbortSignal): Promise<ModelValidationResult>;
  backtestModel(modelId: string, signal?: AbortSignal): Promise<BacktestSummary>;
  activateModel(modelId: string, signal?: AbortSignal): Promise<AdminScoreModelDTO>;
}

export type {
  AdminScoreModelDTO,
  AnalyzedRunSummary,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  EquipmentSummary,
  Grade,
  JobStatusDTO,
  MetaResponse,
  ProfileWarning,
  RedFlagDTO,
  RefreshStatusResponse,
  RegionCode,
  ScoreSnapshotDTO,
  ScoringRunSelectionProfileDTO,
  ScoringSelectedRunProfileDTO,
  SearchCharacterResponse,
  SeasonSummary,
  TalentSummary,
};
