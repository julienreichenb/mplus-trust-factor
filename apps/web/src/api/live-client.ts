import type {
  ActivateScoreModelResult,
  AdminAbilityCatalogResponse,
  AdminScoreModelDTO,
  BacktestSummary,
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

  function headers(extra?: HeadersInit): Headers {
    const h = new Headers(extra);
    h.set("Accept", "application/json");
    return h;
  }

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: "GET",
      headers: headers(),
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
      headers: headers(hasBody ? { "Content-Type": "application/json" } : undefined),
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

    resolveCharacter: (request: CharacterResolveRequest & { forceRetry?: boolean }, signal) =>
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
  };
}

