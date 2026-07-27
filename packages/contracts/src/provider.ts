import type { IsoDateTime, RegionCode } from "./identity.js";
import type { CharacterIdentityInput, CharacterSnapshotDTO, CanonicalCharacter } from "./identity.js";
import type { MythicRunDTO } from "./runs.js";

export type ProviderName = "blizzard" | "warcraftlogs" | "raiderio";

export interface ProviderFetchContext {
  region: RegionCode;
  requestId: string;
  correlationId: string | null;
  forceRefresh: boolean;
  now: IsoDateTime;
}

export interface ProviderRequestMetadata {
  provider: ProviderName;
  endpointKey: string;
  requestFingerprint: string;
  requestedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  statusCode: number | null;
  cacheHit: boolean;
  retryCount: number;
  costUnits: number | null;
  etag: string | null;
  expiresAt: IsoDateTime | null;
}

export interface DataFreshness {
  fetchedAt: IsoDateTime;
  expiresAt: IsoDateTime | null;
  stale: boolean;
}

export interface SourceProvenance {
  provider: ProviderName;
  externalRequestId: string | null;
  sourcePayloadId: string | null;
  sourceUrl: string | null;
  fetchedAt: IsoDateTime;
  schemaVersion: string;
}

export interface ProviderResult<T> {
  data: T;
  provenance: SourceProvenance;
  freshness: DataFreshness;
  metadata: ProviderRequestMetadata;
}

export type ExternalApiErrorCode =
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "CIRCUIT_OPEN"
  | "BUDGET_EXCEEDED"
  | "UNKNOWN";

export class ExternalApiError extends Error {
  readonly code: ExternalApiErrorCode;
  readonly provider: ProviderName;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly details: unknown;

  constructor(input: {
    message: string;
    code: ExternalApiErrorCode;
    provider: ProviderName;
    retryable?: boolean;
    statusCode?: number | null;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ExternalApiError";
    this.code = input.code;
    this.provider = input.provider;
    this.retryable = input.retryable ?? false;
    this.statusCode = input.statusCode ?? null;
    this.details = input.details ?? null;
  }
}

export interface BlizzardProvider {
  readonly name: "blizzard";
  getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>>;
  getCharacterEquipment(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CharacterSnapshotDTO>>;
  getMythicKeystoneProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>>;
}

export interface WarcraftLogsProvider {
  readonly name: "warcraftlogs";
  discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>>;
  getReportFightDetails(
    reportCode: string,
    fightId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>>;
}

export interface RaiderIoProvider {
  readonly name: "raiderio";
  getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>>;
  getSeasonCutoffs(
    region: RegionCode,
    seasonSlug: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>>;
}
