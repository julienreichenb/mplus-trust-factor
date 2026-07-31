import type { AdminAbilityCatalogResponse } from "@mplus/abilities";
import type {
  AdminScoreModelDTO,
  CharacterAutocompleteSuggestion,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  CharacterResolveRequest,
  CharacterResolveResponse,
  DeleteScoreModelResponse,
  Grade,
  JobStatusDTO,
  MetaResponse,
  RedFlagDTO,
  RefreshStatusResponse,
  RegionCode,
  RealmCatalogOption,
  ScoreModelDependencyCounts,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
  ScoringRunSelection,
  SelectedRunSummary,
  AnalyzedRunSummary,
  EquipmentSummary,
  TalentSummary,
  SelectedTalentDTO,
  TalentTreeKind,
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
  region?: RegionCode;
  locale?: string | null;
  connectedRealmId?: number | null;
  displayLabel?: string;
  category?: string | null;
  timezone?: string | null;
}

export interface ModelValidationResult {
  valid: boolean;
  errors: string[];
  weightSum: number;
}

export interface BacktestSummary {
  cohortSize: number;
  meanOverall: number;
  gradeDistribution: Record<Grade, number> | Partial<Record<Grade, number>>;
  notes: string;
  meanConfidence?: number | null;
  mode?: string;
  outliers?: unknown[];
  confidenceVersusCoverage?: unknown[];
  activeDraftComparison?: {
    comparable?: boolean;
    note?: string;
    aggregate?: {
      comparableCount?: number;
      meanScoreDelta?: number | null;
      meanOverallDelta?: number | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  source?: string;
  /** Present only for genuine non-replayable snapshot-only responses. */
  degradedReason?: string | null;
  cohortId?: string;
}

export interface ActivateScoreModelResult extends AdminScoreModelDTO {
  previousActiveId: string | null;
  previousActiveVersion: number | null;
  bulkOperationId: string | null;
  bulkEnqueueError: string | null;
}

export type DeleteModelResult = DeleteScoreModelResponse;

/** @deprecated Use ModelConfigFormState from ./model-config — kept as alias for gradual migration. */
export type { ModelConfigFormState as EditableModelConfig } from "./model-config";

export type ApiMode = "mock" | "live";

export type SearchUiState =
  | "IDLE"
  | "VALIDATING"
  | "RESOLVING"
  | "QUEUED"
  | "PROCESSING"
  | "READY"
  | "NOT_FOUND"
  | "RETRYABLE_ERROR"
  | "TERMINAL_ERROR";

export interface MplusApiClient {
  getMeta(signal?: AbortSignal): Promise<MetaResponse>;
  searchRealms(
    region: RegionCode | null | undefined,
    query: string,
    signal?: AbortSignal,
    limit?: number,
  ): Promise<RealmOption[]>;
  searchCharacters(
    region: RegionCode,
    query: string,
    signal?: AbortSignal,
  ): Promise<CharacterAutocompleteSuggestion[]>;
  resolveCharacter(
    request: CharacterResolveRequest & { forceRetry?: boolean },
    signal?: AbortSignal,
  ): Promise<CharacterResolveResponse>;
  getCharacterProfile(
    identity: CharacterIdentityInput,
    signal?: AbortSignal,
  ): Promise<CharacterProfileView>;
  refreshCharacter(
    identity: CharacterIdentityInput,
    signal?: AbortSignal,
    opts?: { force?: boolean },
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
  activateModel(
    modelId: string,
    opts?: {
      confirm?: boolean;
      expectedPreviousActiveId?: string | null;
      signal?: AbortSignal;
    },
  ): Promise<ActivateScoreModelResult>;
  /** Deletes a DRAFT model. Never deletes ACTIVE/ARCHIVED — server enforces this transactionally. */
  deleteModel(modelId: string, signal?: AbortSignal): Promise<DeleteModelResult>;
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
  CharacterResolveRequest,
  CharacterResolveResponse,
  DeleteScoreModelResponse,
  EquipmentSummary,
  Grade,
  JobStatusDTO,
  MetaResponse,
  ProfileWarning,
  RealmCatalogOption,
  RedFlagDTO,
  RefreshStatusResponse,
  RegionCode,
  ScoreModelDependencyCounts,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
  ScoringRunSelection,
  SelectedRunSummary,
  SeasonSummary,
  SelectedTalentDTO,
  TalentSummary,
  TalentTreeKind,
};
