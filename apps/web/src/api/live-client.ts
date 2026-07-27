import type {
  AdminScoreModelDTO,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  MetaResponse,
  ModelValidationResult,
  MplusApiClient,
  BacktestSummary,
  RealmOption,
  RefreshStatusResponse,
  RegionCode,
} from "./types";
import { normalizeRealmOptions } from "./realm-options";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = body as { error?: { message?: string; code?: string; details?: unknown } } | null;
    throw new ApiClientError(
      envelope?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      envelope?.error?.code ?? "HTTP_ERROR",
      envelope?.error?.details,
    );
  }
  return body as T;
}

function identityPath(identity: CharacterIdentityInput): string {
  return `/api/v1/characters/${encodeURIComponent(identity.region)}/${encodeURIComponent(identity.realmSlug)}/${encodeURIComponent(identity.name)}`;
}

export function createLiveApiClient(options: {
  baseUrl: string;
  adminApiKey?: string;
}): MplusApiClient {
  const base = options.baseUrl.replace(/\/$/, "");

  function headers(extra?: HeadersInit): Headers {
    const h = new Headers(extra);
    h.set("Accept", "application/json");
    if (options.adminApiKey) {
      h.set("X-Admin-Api-Key", options.adminApiKey);
    }
    return h;
  }

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: "GET", headers: headers(), signal });
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
      signal,
    });
    return parseJson<T>(response);
  }

  return {
    getMeta: (signal) => get<MetaResponse>("/api/v1/meta", signal),

    searchRealms: (region: RegionCode, query: string, signal) =>
      get<{ realms: Array<{ slug: string; name?: string | null }> }>(
        `/api/v1/realms?region=${encodeURIComponent(String(region))}&query=${encodeURIComponent(query)}`,
        signal,
      ).then((r) => normalizeRealmOptions(r.realms)),

    getCharacterProfile: (identity: CharacterIdentityInput, signal) =>
      get<CharacterProfileResponse>(identityPath(identity), signal),

    refreshCharacter: (identity, signal) =>
      send<RefreshStatusResponse>("POST", `${identityPath(identity)}/refresh`, undefined, signal),

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
        gradeDistribution: Record<string, number>;
        note: string;
      }>(
        "POST",
        `/api/v1/admin/score-models/${encodeURIComponent(modelId)}/backtest`,
        {},
        signal,
      ).then((r) => ({
        cohortSize: r.sampleSize ?? 0,
        meanOverall: r.meanScore ?? 0,
        gradeDistribution: r.gradeDistribution ?? {},
        notes: r.note ?? "",
      })),

    activateModel: (modelId, signal) =>
      send<AdminScoreModelDTO>(
        "POST",
        `/api/v1/admin/score-models/${encodeURIComponent(modelId)}/activate`,
        {},
        signal,
      ),
  };
}
