import type {
  AdminScoreModelDTO,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileView,
  MetaResponse,
  ModelValidationResult,
  MplusApiClient,
  BacktestSummary,
  RealmOption,
  RefreshStatusResponse,
  RegionCode,
} from "./types";

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
    const response = await fetch(`${base}${path}`, {
      method,
      headers: headers({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    return parseJson<T>(response);
  }

  return {
    getMeta: (signal) => get<MetaResponse>("/api/v1/meta", signal),

    searchRealms: (region: RegionCode, query: string, signal) =>
      get<{ realms: RealmOption[] }>(
        `/api/v1/realms?region=${encodeURIComponent(String(region))}&q=${encodeURIComponent(query)}`,
        signal,
      ).then((r) => r.realms),

    getCharacterProfile: (identity: CharacterIdentityInput, signal) =>
      get<CharacterProfileView>(
        `/api/v1/characters/${encodeURIComponent(identity.region)}/${encodeURIComponent(identity.realmSlug)}/${encodeURIComponent(identity.name)}`,
        signal,
      ),

    refreshCharacter: (identity, signal) =>
      send<RefreshStatusResponse>("POST", "/api/v1/characters/refresh", identity, signal),

    getRefreshStatus: (characterId, signal) =>
      get<RefreshStatusResponse>(
        `/api/v1/characters/${encodeURIComponent(characterId)}/refresh-status`,
        signal,
      ),

    compareCharacters: (request: CharacterComparisonRequest, signal) =>
      send<CharacterComparisonResponse>("POST", "/api/v1/compare", request, signal),

    listModels: (signal) => get<AdminScoreModelDTO[]>("/api/v1/admin/models", signal),

    cloneModel: (modelId, signal) =>
      send<AdminScoreModelDTO>("POST", `/api/v1/admin/models/${encodeURIComponent(modelId)}/clone`, {}, signal),

    updateModel: (modelId, config, signal) =>
      send<AdminScoreModelDTO>("PUT", `/api/v1/admin/models/${encodeURIComponent(modelId)}`, { config }, signal),

    validateModel: (modelId, config, signal) =>
      send<ModelValidationResult>(
        "POST",
        `/api/v1/admin/models/${encodeURIComponent(modelId)}/validate`,
        { config },
        signal,
      ),

    backtestModel: (modelId, signal) =>
      send<BacktestSummary>(
        "POST",
        `/api/v1/admin/models/${encodeURIComponent(modelId)}/backtest`,
        {},
        signal,
      ),

    activateModel: (modelId, signal) =>
      send<AdminScoreModelDTO>(
        "POST",
        `/api/v1/admin/models/${encodeURIComponent(modelId)}/activate`,
        {},
        signal,
      ),
  };
}
