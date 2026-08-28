import type {
  ActivateScoreModelResult,
  AdminAbilityCatalogResponse,
  AdminRealmSyncResponse,
  AdminScoreModelDTO,
  AbilityCatalogDraftValidation,
  AbilityCatalogReviewBatchSummary,
  AbilityCatalogReviewItemSummary,
  AbilityCatalogReleaseSummary,
  ManualCatalogEditDetail,
  ManualCatalogEditSummary,
  BacktestSummary,
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
  DeleteModelResult,
  MetaResponse,
  ModelValidationResult,
  MplusApiClient,
  PublicFaqListResponse,
  PublicScoringContextDTO,
  AdminFaqListResponse,
  AdminFaqEntryDTO,
  RefreshStatusResponse,
  RegionCode,
} from "./types";
import { normalizeRealmOptions } from "./realm-options";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryable?: boolean;

  constructor(message: string, status: number, code: string, details?: unknown, retryable?: boolean) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      body &&
      typeof body === "object" &&
      "status" in body &&
      typeof (body as { status: unknown }).status === "string"
    ) {
      return body as T;
    }
    const envelope = body as {
      error?: { message?: string; code?: string; details?: unknown; retryable?: boolean };
    } | null;
    throw new ApiClientError(
      envelope?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      envelope?.error?.code ?? "HTTP_ERROR",
      envelope?.error?.details,
      envelope?.error?.retryable,
    );
  }
  return body as T;
}

function identityPath(identity: CharacterIdentityInput): string {
  return `/api/v1/characters/${encodeURIComponent(identity.region)}/${encodeURIComponent(identity.realmSlug)}/${encodeURIComponent(identity.name)}`;
}

/** JSON Accept always; Content-Type only when a body is present (Fastify rejects empty JSON bodies). */
export function jsonFetchHeaders(hasBody: boolean): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (hasBody) headers.set("Content-Type", "application/json");
  return headers;
}

function buildQueryString(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function createLiveApiClient(options: {
  baseUrl: string;
}): MplusApiClient {
  const base = options.baseUrl.replace(/\/$/, "");

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: "GET",
      headers: jsonFetchHeaders(false),
      credentials: "include",
      signal,
    });
    return parseJson<T>(response);
  }

  async function send<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const hasBody = body !== undefined;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: jsonFetchHeaders(hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal,
    });
    return parseJson<T>(response);
  }

  return {
    getMeta: (signal) => get<MetaResponse>("/api/v1/meta", signal),

    searchRealms: (region, query, signal, limit = 25) => {
      const params = new URLSearchParams();
      if (region) params.set("region", String(region));
      if (query) params.set("query", query);
      params.set("limit", String(limit));
      return get<{ realms: Array<Record<string, unknown>> }>(`/api/v1/realms?${params}`, signal).then(
        (r) => normalizeRealmOptions(r.realms as Array<{ slug: string; name?: string | null }>),
      );
    },

    searchCharacters: (region: RegionCode, query: string, signal) =>
      get<{ suggestions: CharacterAutocompleteSuggestion[] }>(
        `/api/v1/characters/autocomplete?region=${encodeURIComponent(String(region))}&query=${encodeURIComponent(query)}`,
        signal,
      ).then((r) => r.suggestions),

    resolveCharacter: (request: CharacterResolveRequest, signal) =>
      send<CharacterResolveResponse>("POST", "/api/v1/characters/resolve", request, signal),

    getCharacterProfile: (identity: CharacterIdentityInput, signal) =>
      get<CharacterProfileResponse>(identityPath(identity), signal),

    refreshCharacter: (identity, signal, opts) => {
      const forceQs = opts?.force ? "?force=true" : "";
      return send<RefreshStatusResponse>(
        "POST",
        `${identityPath(identity)}/refresh${forceQs}`,
        undefined,
        signal,
      );
    },

    getRefreshStatus: (identity, signal) =>
      get<RefreshStatusResponse>(`${identityPath(identity)}/refresh-status`, signal),

    compareCharacters: (request: CharacterComparisonRequest, signal) =>
      send<CharacterComparisonResponse>("POST", "/api/v1/comparisons", request, signal),

    listFaq: (signal) => get<PublicFaqListResponse>("/api/v1/faq", signal),
    getPublishedScoringContext: (signal) => get<PublicScoringContextDTO>("/api/v1/scoring/context", signal),
    listPublicScoreModels: (signal) =>
      get<{ models: AdminScoreModelDTO[] }>("/api/v1/score-models/public", signal).then((r) => r.models),

    listAdminFaq: (signal) => get<AdminFaqListResponse>("/api/v1/admin/faq", signal),

    createFaq: (input, signal) => send<AdminFaqEntryDTO>("POST", "/api/v1/admin/faq", input, signal),

    updateFaq: (id, input, signal) =>
      send<AdminFaqEntryDTO>("PATCH", `/api/v1/admin/faq/${encodeURIComponent(id)}`, input, signal),

    moveFaq: (id, input, signal) =>
      send<AdminFaqEntryDTO>("POST", `/api/v1/admin/faq/${encodeURIComponent(id)}/move`, input, signal),

    deleteFaq: (id, signal) =>
      send<{ id: string }>("DELETE", `/api/v1/admin/faq/${encodeURIComponent(id)}`, undefined, signal),

    listModels: (signal) =>
      get<{ models: AdminScoreModelDTO[] }>("/api/v1/admin/score-models", signal).then((r) => r.models),

    cloneModel: (modelId, signal) =>
      send<AdminScoreModelDTO>("POST", `/api/v1/admin/score-models/${encodeURIComponent(modelId)}/clone`, {}, signal),

    updateModel: (modelId, config, signal) =>
      send<AdminScoreModelDTO>("PUT", `/api/v1/admin/score-models/${encodeURIComponent(modelId)}`, { config }, signal),

    validateModel: (modelId, config, signal) =>
      send<ModelValidationResult>(
        "POST",
        `/api/v1/admin/score-models/${encodeURIComponent(modelId)}/validate`,
        config === undefined ? {} : { config },
        signal,
      ),

    backtestModel: (modelId, signal) =>
      send<{
        sampleSize: number;
        meanScore: number;
        meanConfidence?: number | null;
        gradeDistribution: Record<string, number>;
        note: string;
        mode?: string;
        outliers?: unknown[];
        confidenceVersusCoverage?: unknown[];
        activeDraftComparison?: BacktestSummary["activeDraftComparison"];
        source?: string;
        degradedReason?: string | null;
        cohortId?: string;
      }>(
        "POST",
        `/api/v1/admin/score-models/${encodeURIComponent(modelId)}/backtest`,
        {},
        signal,
      ).then((r) => ({
        cohortSize: r.sampleSize ?? 0,
        meanOverall: r.meanScore ?? 0,
        meanConfidence: r.meanConfidence ?? null,
        gradeDistribution: r.gradeDistribution ?? {},
        notes: r.note ?? "",
        mode: r.mode,
        outliers: r.outliers ?? [],
        confidenceVersusCoverage: r.confidenceVersusCoverage ?? [],
        activeDraftComparison: r.activeDraftComparison ?? null,
        source: r.source,
        degradedReason: r.degradedReason ?? null,
        cohortId: r.cohortId,
      })),

    deleteModel: (modelId, signal) =>
      send<DeleteModelResult>(
        "DELETE",
        `/api/v1/admin/score-models/${encodeURIComponent(modelId)}`,
        undefined,
        signal,
      ),

    activateModel: (modelId, opts) =>
      send<ActivateScoreModelResult>(
        "POST",
        `/api/v1/admin/score-models/${encodeURIComponent(modelId)}/activate`,
        {
          confirm: opts?.confirm ?? true,
          expectedPreviousActiveId: opts?.expectedPreviousActiveId,
        },
        opts?.signal,
      ),

    getAdminAbilityCatalog: (params, signal) =>
      get<AdminAbilityCatalogResponse>(
        `/api/v1/admin/ability-catalog${buildQueryString(params)}`,
        signal,
      ),

    listAbilityCatalogReviewBatches: (signal) =>
      get<{ batches: AbilityCatalogReviewBatchSummary[] }>(
        "/api/v1/admin/ability-catalog/review/batches",
        signal,
      ),

    listAbilityCatalogReviewItems: (batchId, params, signal) =>
      get<{ items: AbilityCatalogReviewItemSummary[] }>(
        `/api/v1/admin/ability-catalog/review/batches/${encodeURIComponent(batchId)}/items${buildQueryString(params)}`,
        signal,
      ),

    decideAbilityCatalogReviewItem: (itemId, body, signal) =>
      send<AbilityCatalogReviewItemSummary>(
        "POST",
        `/api/v1/admin/ability-catalog/review/items/${encodeURIComponent(itemId)}/decide`,
        body,
        signal,
      ),

    getAbilityCatalogReviewItem: (itemId, signal) =>
      get<AbilityCatalogReviewItemSummary>(
        `/api/v1/admin/ability-catalog/review/items/${encodeURIComponent(itemId)}`,
        signal,
      ),

    listAbilityCatalogExclusions: (signal) =>
      get<{
        exclusions: Array<{
          id: string;
          stableAbilityIdentity: string;
          canonicalKey: string | null;
          primarySpellId: number | null;
          excludedByUserId: string | null;
          createdAt: string;
          updatedAt: string;
        }>;
      }>("/api/v1/admin/ability-catalog/exclusions", signal),

    createAbilityCatalogExclusion: (body, signal) =>
      send<{
        id: string;
        stableAbilityIdentity: string;
        canonicalKey: string | null;
        primarySpellId: number | null;
      }>("POST", "/api/v1/admin/ability-catalog/exclusions", body, signal),

    clearAbilityCatalogExclusion: (body, signal) =>
      send<{ cleared: number }>(
        "DELETE",
        "/api/v1/admin/ability-catalog/exclusions",
        body,
        signal,
      ),

    listAbilityCatalogReleases: (signal) =>
      get<{ releases: AbilityCatalogReleaseSummary[] }>(
        "/api/v1/admin/ability-catalog/releases",
        signal,
      ),

    getAbilityCatalogActiveRelease: (signal) =>
      get<{
        active: AbilityCatalogReleaseSummary | null;
        limitations?: { racialReplayCoverage?: string; trustReplay?: string };
        notice?: string;
      }>("/api/v1/admin/ability-catalog/releases/active", signal),

    getAbilityCatalogWorkflow: (signal) =>
      get<Record<string, unknown>>("/api/v1/admin/ability-catalog/workflow", signal),

    getAbilityCatalogPublishStatus: (signal) =>
      get<Record<string, unknown>>("/api/v1/admin/ability-catalog/publish-status", signal),

    publishAbilityCatalogChanges: (body, signal) =>
      send<{
        success: boolean;
        stage: string;
        message: string;
        previousActive?: { id: string; releaseKey: string; contentDigest: string } | null;
        newActive?: { id: string; releaseKey: string; contentDigest: string; activatedAt: string } | null;
        candidateRelease?: { id: string; releaseKey: string; validationStatus: string | null } | null;
        replay?: { id: string; status: string } | null;
        errors?: string[];
      }>("POST", "/api/v1/admin/ability-catalog/publish", body ?? {}, signal),

    refreshAbilityCatalog: (signal) =>
      send<Record<string, unknown>>("POST", "/api/v1/admin/ability-catalog/refresh", {}, signal),

    activateAbilityCatalogRelease: (releaseId, body, signal) =>
      send<{
        release: AbilityCatalogReleaseSummary;
        activation: { id: string };
        notice?: string;
      }>(
        "POST",
        `/api/v1/admin/ability-catalog/releases/${encodeURIComponent(releaseId)}/activate`,
        body,
        signal,
      ),

    rollbackAbilityCatalogRelease: (releaseId, body, signal) =>
      send<{
        release: AbilityCatalogReleaseSummary;
        activation: { id: string };
        notice?: string;
      }>(
        "POST",
        `/api/v1/admin/ability-catalog/releases/${encodeURIComponent(releaseId)}/rollback`,
        body,
        signal,
      ),

    updateAbilityCatalogDraft: (itemId, body, signal) =>
      send<AbilityCatalogReviewItemSummary>(
        "PATCH",
        `/api/v1/admin/ability-catalog/review/items/${encodeURIComponent(itemId)}/draft`,
        body,
        signal,
      ),

    ensureAbilityCatalogDraft: (itemId, body, signal) =>
      send<AbilityCatalogReviewItemSummary>(
        "POST",
        `/api/v1/admin/ability-catalog/review/items/${encodeURIComponent(itemId)}/draft/ensure`,
        body ?? {},
        signal,
      ),

    validateAbilityCatalogDraft: (itemId, body, signal) =>
      send<{
        itemId: string;
        validation: AbilityCatalogDraftValidation;
        draft: unknown | null;
      }>(
        "POST",
        `/api/v1/admin/ability-catalog/review/items/${encodeURIComponent(itemId)}/draft/validate`,
        body ?? {},
        signal,
      ),

    listManualCatalogEdits: (signal) =>
      get<{ edits: ManualCatalogEditSummary[] }>(
        "/api/v1/admin/ability-catalog/manual-edits",
        signal,
      ),

    getManualCatalogEdit: (canonicalKey, signal) =>
      get<ManualCatalogEditDetail>(
        `/api/v1/admin/ability-catalog/rules/${encodeURIComponent(canonicalKey)}/manual-edit`,
        signal,
      ),

    saveManualCatalogEdit: (canonicalKey, body, signal) =>
      send<ManualCatalogEditDetail>(
        "PUT",
        `/api/v1/admin/ability-catalog/rules/${encodeURIComponent(canonicalKey)}/manual-edit`,
        body,
        signal,
      ),

    discardManualCatalogEdit: (canonicalKey, signal) =>
      send<{ discarded: true }>(
        "DELETE",
        `/api/v1/admin/ability-catalog/rules/${encodeURIComponent(canonicalKey)}/manual-edit`,
        undefined,
        signal,
      ),

    syncRealmCatalog: (input, signal) =>
      send<AdminRealmSyncResponse>(
        "POST",
        "/api/v1/admin/misc/realms/sync",
        {
          regions: input?.regions,
          forceDetails: input?.forceDetails,
        },
        signal,
      ),

    listCalibrationCohorts: (signal) =>
      get<{ cohorts: CalibrationCohortDTO[] }>("/api/v1/admin/calibration/cohorts", signal).then(
        (r) => r.cohorts,
      ),

    createCalibrationCohort: (input, signal) =>
      send<CalibrationCohortDTO>("POST", "/api/v1/admin/calibration/cohorts", input, signal),

    getCalibrationCohort: (cohortId, signal) =>
      get<CalibrationCohortDTO>(
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}`,
        signal,
      ),

    patchCalibrationCohort: (cohortId, input, signal) =>
      send<CalibrationCohortDTO>(
        "PATCH",
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}`,
        input,
        signal,
      ),

    deleteCalibrationCohort: (cohortId, signal) =>
      send<{ id: string }>(
        "DELETE",
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}`,
        undefined,
        signal,
      ),

    resolveCalibrationMember: (cohortId, input, signal) =>
      send<CalibrationCohortMemberDTO & { resolveStatus?: string }>(
        "POST",
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}/members/resolve`,
        input,
        signal,
      ),

    patchCalibrationMember: (cohortId, memberId, input, signal) =>
      send<CalibrationCohortMemberDTO>(
        "PATCH",
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}/members/${encodeURIComponent(memberId)}`,
        input,
        signal,
      ),

    deleteCalibrationMember: (cohortId, memberId, signal) =>
      send<{ id: string }>(
        "DELETE",
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}/members/${encodeURIComponent(memberId)}`,
        undefined,
        signal,
      ),

    createCalibrationRun: (cohortId, input, signal) =>
      send<CalibrationRunDTO>(
        "POST",
        `/api/v1/admin/calibration/cohorts/${encodeURIComponent(cohortId)}/runs`,
        input,
        signal,
      ),

    listCalibrationRuns: (cohortId, signal) => {
      const qs = cohortId ? `?cohortId=${encodeURIComponent(cohortId)}` : "";
      return get<{ runs: CalibrationRunDTO[] }>(`/api/v1/admin/calibration/runs${qs}`, signal).then(
        (r) => r.runs,
      );
    },

    getCalibrationRun: (runId, signal) =>
      get<CalibrationRunDTO>(`/api/v1/admin/calibration/runs/${encodeURIComponent(runId)}`, signal),

    getCalibrationReport: (runId, signal) =>
      get<CalibrationReportDTO>(
        `/api/v1/admin/calibration/runs/${encodeURIComponent(runId)}/report`,
        signal,
      ),
  };
}

