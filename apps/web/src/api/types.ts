import type { AdminAbilityCatalogResponse } from "@mplus/abilities";
import type {
  AdminScoreModelDTO,
  CharacterAutocompleteSuggestion,
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
  ScoringRunSelection,
  SelectedRunSummary,
  AnalyzedRunSummary,
  EquipmentSummary,
  TalentSummary,
  SeasonSummary,
  ProfileEntitlements,
  ProfileWarning,
} from "@mplus/contracts";

/** Field visibility flags — launch may unlock everything. */
export type Entitlements = ProfileEntitlements;

/**
 * Enriched profile view for the UI — same shape as API `CharacterProfileResponse` enrichments.
 */
export type CharacterProfileView = CharacterProfileResponse;

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
  searchCharacters(
    region: RegionCode,
    query: string,
    signal?: AbortSignal,
  ): Promise<CharacterAutocompleteSuggestion[]>;
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
  getAdminAbilityCatalog(
    params?: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ): Promise<AdminAbilityCatalogResponse>;
}

export type { AdminAbilityCatalogResponse };

export type {
  AdminScoreModelDTO,
  AnalyzedRunSummary,
  CharacterAutocompleteSuggestion,
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
  SearchCharacterResponse,
  ScoringRunSelection,
  SelectedRunSummary,
  SeasonSummary,
  TalentSummary,
};
