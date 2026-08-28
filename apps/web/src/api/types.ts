import type { AdminAbilityCatalogResponse } from "@mplus/abilities";
import type {
  AdminScoreModelDTO,
  CalibrationCohortDTO,
  CalibrationCohortMemberDTO,
  CalibrationExpectedRank,
  CalibrationReportDTO,
  CalibrationRunDTO,
  CharacterAutocompleteSuggestion,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  CharacterResolveRequest,
  CharacterResolveResponse,
  DeleteScoreModelResponse,
  EstimateConfidence,
  Grade,
  JobStatusDTO,
  MetaResponse,
  RedFlagDTO,
  RefreshEtaFields,
  RefreshSchedulingState,
  RefreshStatusResponse,
  RegionCode,
  RealmCatalogOption,
  ScoreModelDependencyCounts,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
  ScoringRunSelection,
  SelectedRunSummary,
  SelectedRunSummaryDTO,
  AnalyzedRunSummary,
  EquipmentSummary,
  TalentSummary,
  SelectedTalentDTO,
  TalentTreeKind,
  SeasonSummary,
  ProfileEntitlements,
  ProfileWarning,
  AdminRealmSyncResponse,
  AdminFaqEntryDTO,
  CreateFaqEntryRequest,
  PublicFaqEntryDTO,
  PublicFaqListResponse,
  PublicScoringContextDTO,
  AdminFaqListResponse,
  UpdateFaqEntryRequest,
  MoveFaqEntryRequest,
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

export interface AbilityCatalogReviewBatchSummary {
  id: string;
  reportDigest: string;
  reviewPlanDigest?: string;
  datasetKind: string;
  wowBuild: string | null;
  simcRevision: string | null;
  blizzardNamespace: string | null;
  status: string;
  summaryCounts: Record<string, number>;
  decisionCounts: {
    total: number;
    pending: number;
    decided: number;
    accepted: number;
    rejected: number;
    deferred: number;
    draftsNeedsMetadata: number;
    draftsReadyForPublishReview: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface AbilityCatalogDraftValidation {
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW";
  readyForPublishReview: boolean;
  reasonCodes: string[];
  errors: Array<{ severity: string; code: string; message: string; field?: string }>;
  warnings: Array<{ severity: string; code: string; message: string; field?: string }>;
}

export interface ManualCatalogEditSummary {
  canonicalKey: string;
  draftRuleId: string;
  version: number;
  status: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW";
  name: string;
}

export interface ManualCatalogEditDetail {
  canonicalKey: string;
  activeRule: unknown;
  draft: unknown | null;
  draftRuleId: string | null;
  draftVersion: number | null;
  draftStatus: "NEEDS_METADATA" | "READY_FOR_PUBLISH_REVIEW" | null;
  draftValidation: AbilityCatalogDraftValidation | null;
}

export interface AbilityCatalogReleaseSummary {
  id: string;
  releaseKey: string;
  contentDigest: string;
  status: string;
  publishedAt?: string | null;
  createdAt?: string;
  validatedAt?: string | null;
}

export interface AbilityCatalogReviewDecisionEvent {
  id: string;
  actorUserId: string | null;
  actorType: string;
  previousState: unknown;
  newState: unknown;
  note: string | null;
  createdAt: string;
}

export interface AbilityCatalogReviewItemSummary {
  id: string;
  batchId: string;
  kind: string;
  name: string;
  primarySpellId: number | null;
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
  decisionAction: string | null;
  version: number;
  reviewReason: string;
  eligibilityState: string | null;
  evidence: unknown;
  sourceProvenance: unknown;
  matchedCanonicalKey: string | null;
  draftRule: Record<string, unknown> | null;
  draftTopology: Record<string, unknown> | null;
  draftStatus: string | null;
  draftValidation: AbilityCatalogDraftValidation | null;
  decisionEvents: AbilityCatalogReviewDecisionEvent[];
  wowheadUrl: string | null;
}

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
    request: CharacterResolveRequest,
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
  listFaq(signal?: AbortSignal): Promise<PublicFaqListResponse>;
  getPublishedScoringContext(signal?: AbortSignal): Promise<PublicScoringContextDTO>;
  listPublicScoreModels(signal?: AbortSignal): Promise<AdminScoreModelDTO[]>;
  listAdminFaq(signal?: AbortSignal): Promise<AdminFaqListResponse>;
  createFaq(input: CreateFaqEntryRequest, signal?: AbortSignal): Promise<AdminFaqEntryDTO>;
  updateFaq(id: string, input: UpdateFaqEntryRequest, signal?: AbortSignal): Promise<AdminFaqEntryDTO>;
  moveFaq(id: string, input: MoveFaqEntryRequest, signal?: AbortSignal): Promise<AdminFaqEntryDTO>;
  deleteFaq(id: string, signal?: AbortSignal): Promise<{ id: string }>;
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
  listAbilityCatalogReviewBatches(signal?: AbortSignal): Promise<{
    batches: AbilityCatalogReviewBatchSummary[];
  }>;
  listAbilityCatalogReviewItems(
    batchId: string,
    params?: Record<string, string | undefined>,
    signal?: AbortSignal,
  ): Promise<{ items: AbilityCatalogReviewItemSummary[] }>;
  decideAbilityCatalogReviewItem(
    itemId: string,
    body: {
      expectedVersion: number;
      action: string;
      businessMetadata?: {
        category?: string | null;
        availability?: string | null;
      };
      note?: string;
    },
    signal?: AbortSignal,
  ): Promise<AbilityCatalogReviewItemSummary>;
  getAbilityCatalogReviewItem(
    itemId: string,
    signal?: AbortSignal,
  ): Promise<AbilityCatalogReviewItemSummary>;
  listAbilityCatalogReleases(signal?: AbortSignal): Promise<{
    releases: AbilityCatalogReleaseSummary[];
  }>;
  getAbilityCatalogActiveRelease(signal?: AbortSignal): Promise<{
    active: AbilityCatalogReleaseSummary | null;
    limitations?: { racialReplayCoverage?: string; trustReplay?: string };
    notice?: string;
  }>;
  getAbilityCatalogWorkflow(signal?: AbortSignal): Promise<Record<string, unknown>>;
  refreshAbilityCatalog(signal?: AbortSignal): Promise<Record<string, unknown>>;
  activateAbilityCatalogRelease(
    releaseId: string,
    body: {
      confirmationDigest: string;
      confirm: true;
      expectedPreviousActiveId?: string | null;
    },
    signal?: AbortSignal,
  ): Promise<{
    release: AbilityCatalogReleaseSummary;
    activation: { id: string };
    notice?: string;
  }>;
  rollbackAbilityCatalogRelease(
    releaseId: string,
    body: {
      confirmationDigest: string;
      confirm: true;
      reason: string;
      expectedPreviousActiveId?: string | null;
    },
    signal?: AbortSignal,
  ): Promise<{
    release: AbilityCatalogReleaseSummary;
    activation: { id: string };
    notice?: string;
  }>;
  updateAbilityCatalogDraft(
    itemId: string,
    body: {
      expectedVersion: number;
      businessMetadata: {
        category?: string | null;
        availability?: string | null;
      };
      note?: string;
    },
    signal?: AbortSignal,
  ): Promise<AbilityCatalogReviewItemSummary>;
  ensureAbilityCatalogDraft(
    itemId: string,
    body?: {
      businessMetadata?: {
        category?: string | null;
        availability?: string | null;
      };
    },
    signal?: AbortSignal,
  ): Promise<AbilityCatalogReviewItemSummary>;
  validateAbilityCatalogDraft(
    itemId: string,
    body?: {
      businessMetadata?: {
        category?: string | null;
        availability?: string | null;
      };
    },
    signal?: AbortSignal,
  ): Promise<{
    itemId: string;
    validation: AbilityCatalogDraftValidation;
    draft: unknown | null;
  }>;
  listManualCatalogEdits(signal?: AbortSignal): Promise<{ edits: ManualCatalogEditSummary[] }>;
  getManualCatalogEdit(canonicalKey: string, signal?: AbortSignal): Promise<ManualCatalogEditDetail>;
  saveManualCatalogEdit(
    canonicalKey: string,
    body: {
      expectedVersion?: number;
      draft: {
        category?: string | null;
        availability?: string | null;
      };
      note?: string;
    },
    signal?: AbortSignal,
  ): Promise<ManualCatalogEditDetail>;
  discardManualCatalogEdit(
    canonicalKey: string,
    signal?: AbortSignal,
  ): Promise<{ discarded: true }>;
  syncRealmCatalog(
    input?: {
      regions?: RegionCode[];
      forceDetails?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<AdminRealmSyncResponse>;

  listCalibrationCohorts(signal?: AbortSignal): Promise<CalibrationCohortDTO[]>;
  createCalibrationCohort(
    input: { name: string; description?: string },
    signal?: AbortSignal,
  ): Promise<CalibrationCohortDTO>;
  getCalibrationCohort(cohortId: string, signal?: AbortSignal): Promise<CalibrationCohortDTO>;
  patchCalibrationCohort(
    cohortId: string,
    input: { name?: string; description?: string },
    signal?: AbortSignal,
  ): Promise<CalibrationCohortDTO>;
  deleteCalibrationCohort(cohortId: string, signal?: AbortSignal): Promise<{ id: string }>;
  resolveCalibrationMember(
    cohortId: string,
    input: {
      region: string;
      realmSlug: string;
      characterName: string;
      expectedRank: CalibrationExpectedRank;
      rationale?: string;
    },
    signal?: AbortSignal,
  ): Promise<CalibrationCohortMemberDTO & { resolveStatus?: string }>;
  patchCalibrationMember(
    cohortId: string,
    memberId: string,
    input: { expectedRank?: CalibrationExpectedRank; rationale?: string },
    signal?: AbortSignal,
  ): Promise<CalibrationCohortMemberDTO>;
  deleteCalibrationMember(
    cohortId: string,
    memberId: string,
    signal?: AbortSignal,
  ): Promise<{ id: string }>;
  createCalibrationRun(
    cohortId: string,
    input: { scoreModelId: string; expectedCohortRevision?: number },
    signal?: AbortSignal,
  ): Promise<CalibrationRunDTO>;
  listCalibrationRuns(cohortId?: string, signal?: AbortSignal): Promise<CalibrationRunDTO[]>;
  getCalibrationRun(runId: string, signal?: AbortSignal): Promise<CalibrationRunDTO>;
  getCalibrationReport(runId: string, signal?: AbortSignal): Promise<CalibrationReportDTO>;
}

export type { AdminAbilityCatalogResponse };

export type {
  AdminScoreModelDTO,
  AnalyzedRunSummary,
  CalibrationCohortDTO,
  CalibrationCohortMemberDTO,
  CalibrationReportDTO,
  CalibrationRunDTO,
  CharacterAutocompleteSuggestion,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  CharacterResolveRequest,
  CharacterResolveResponse,
  DeleteScoreModelResponse,
  EquipmentSummary,
  EstimateConfidence,
  Grade,
  JobStatusDTO,
  MetaResponse,
  ProfileWarning,
  RealmCatalogOption,
  RedFlagDTO,
  RefreshEtaFields,
  RefreshSchedulingState,
  RefreshStatusResponse,
  RegionCode,
  ScoreModelDependencyCounts,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
  ScoringRunSelection,
  SelectedRunSummary,
  SelectedRunSummaryDTO,
  SeasonSummary,
  SelectedTalentDTO,
  TalentSummary,
  TalentTreeKind,
  AdminRealmSyncResponse,
  AdminFaqEntryDTO,
  CreateFaqEntryRequest,
  PublicFaqListResponse,
  AdminFaqListResponse,
  UpdateFaqEntryRequest,
  MoveFaqEntryRequest,
  PublicFaqEntryDTO,
  PublicScoringContextDTO,
};
