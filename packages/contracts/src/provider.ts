import type { IsoDateTime, RegionCode } from "./identity.js";
import type {
  CharacterIdentityInput,
  CharacterSnapshotDTO,
  CanonicalCharacter,
  EquipmentSnapshotDTO,
  TalentSnapshotDTO,
} from "./identity.js";
import type {
  RaiderIoCharacterProfile,
  RaiderIoPeriod,
  RaiderIoRunDetails,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticData,
} from "./raiderio.js";
import type { MythicRunDTO } from "./runs.js";
import type { WclCharacterSummaryDTO } from "./warcraftlogs.js";

export type ProviderName = "blizzard" | "warcraftlogs" | "raiderio";

export interface ProviderFetchContext {
  region: RegionCode;
  requestId: string;
  correlationId: string | null;
  forceRefresh: boolean;
  now: IsoDateTime;
  /** Character under refresh — used for WCL actor resolution in report fight details. */
  targetCharacter?: CharacterIdentityInput;
  /**
   * Optional current-season Blizzard/Raider.IO run hints for prioritizing
   * recentReports hydration (completedAt / dungeon / key).
   */
  wclHydrationHints?: Array<{
    completedAt: IsoDateTime;
    dungeonSlug?: string;
    keyLevel?: number;
  }>;
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
  | "SCHEMA_UNSUPPORTED"
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

/** Static realm metadata normalized from Blizzard game data. */
export interface BlizzardRealmDTO {
  blizzardRealmId: number;
  slug: string;
  name: string;
  region: RegionCode;
  locale: string | null;
  timezone: string | null;
  connectedRealmId: number | null;
  category: string | null;
  isTournament: boolean;
}

/** Lightweight realm index entry from `GET /data/wow/realm/index`. */
export interface BlizzardRealmIndexEntryDTO {
  blizzardRealmId: number;
  slug: string;
  name: string;
}

/** Static season / dungeon / item records from Blizzard game data. */
export interface BlizzardSeasonDTO {
  blizzardSeasonId: number;
  slug: string;
  name: string | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
}

export interface BlizzardDungeonDTO {
  blizzardDungeonId: number;
  slug: string;
  name: string;
  mapId: number | null;
}

export interface BlizzardItemDTO {
  blizzardItemId: number;
  name: string;
  quality: string | null;
  level: number | null;
  requiredLevel: number | null;
  mediaUrl: string | null;
}

export interface BlizzardCharacterMediaDTO {
  avatarUrl: string | null;
  insetUrl: string | null;
  mainUrl: string | null;
  assets: Array<{ key: string; url: string }>;
}

export interface BlizzardMythicKeystoneProfileDTO {
  currentMythicRating: number | null;
  currentSeasonId: number | null;
  seasons: Array<{ seasonId: number }>;
  character: CharacterIdentityInput;
}

export interface BlizzardMythicLeaderboardDTO {
  connectedRealmId: number;
  dungeonId: number;
  periodId: number;
  leadingGroups: unknown;
  map: unknown;
}

export interface BlizzardProvider {
  readonly name: "blizzard";
  getRealm(realmSlug: string, ctx: ProviderFetchContext): Promise<ProviderResult<BlizzardRealmDTO>>;
  /** Retail realm index for a region (dynamic namespace). */
  getRealmIndex(ctx: ProviderFetchContext): Promise<ProviderResult<BlizzardRealmIndexEntryDTO[]>>;
  getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>>;
  /** Compatibility method: character snapshot derived from equipment/profile. */
  getCharacterEquipment(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CharacterSnapshotDTO>>;
  getEquipmentSnapshot(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<EquipmentSnapshotDTO>>;
  getTalentSnapshot(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<TalentSnapshotDTO>>;
  getCharacterMedia(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardCharacterMediaDTO>>;
  getMythicKeystoneProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicKeystoneProfileDTO>>;
  getMythicKeystoneSeasonProfile(
    identity: CharacterIdentityInput,
    seasonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{ profile: BlizzardMythicKeystoneProfileDTO; runs: MythicRunDTO[] }>>;
  /**
   * Resolve the region-authoritative Mythic+ season from
   * `data/wow/mythic-keystone/season/index` → `current_season.id`.
   * Must never invent a season from a character profile seasons array.
   * Results are cached via the provider season-index TTL.
   */
  resolveAuthoritativeCurrentSeasonId(
    ctx: ProviderFetchContext,
  ): Promise<
    ProviderResult<{
      seasonId: number;
      slug: string;
      source: "season_index.current_season" | "season_index.last";
    }>
  >;
  getMythicKeystoneSeasonIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardSeasonDTO[]>>;
  getMythicKeystoneSeason(
    seasonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardSeasonDTO>>;
  getMythicKeystoneDungeonIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardDungeonDTO[]>>;
  getMythicKeystoneDungeon(
    dungeonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardDungeonDTO>>;
  /** Fetch item details only for explicitly requested IDs (aggressively cached). */
  getItems(
    itemIds: number[],
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardItemDTO[]>>;
  /**
   * Explicit connected-realm leaderboard fetch. Callers must not bulk-crawl.
   */
  getConnectedRealmMythicLeaderboard(
    connectedRealmId: number,
    dungeonId: number,
    periodId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicLeaderboardDTO>>;
}

export interface WarcraftLogsProvider {
  readonly name: "warcraftlogs";
  /**
   * Explicit opt-in for the rate-limit admission capability.
   * Disabled/proxied providers must leave this unset/false so type guards cannot
   * mistake a catch-all proxy method for a real capability.
   */
  readonly rateLimitSupported?: boolean;
  /**
   * Optional WCL rate-limit capability used by refresh admission snapshot refreshers.
   * Returns only normalized budget fields — never raw GraphQL payloads.
   * Present only when `rateLimitSupported === true` (see `hasWarcraftLogsRateLimitCapability`).
   */
  fetchRateLimit?(ctx: ProviderFetchContext): Promise<WclRateBudgetDecisionDTO>;
  discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>>;
  getReportFightDetails(
    reportCode: string,
    fightId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>>;
  fetchSurvivalHealthSnapshots?(
    input: { reportCode: string; fightId: number; sourceId: number },
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{
    snapshots: Array<{
      timestamp: number;
      currentHp: number | null;
      maxHp: number | null;
      absorb: number | null;
      path: string;
      dataType: string;
      abilityGameID: number | null;
      sourceID: number | null;
      targetID: number | null;
      eventType: string | null;
    }>;
    truncated: boolean;
    eventCount: number;
    events?: Array<Record<string, unknown>>;
  }>>;
  /** Optional Wave 3 character-level discovery summary (visibility without requiring runs). */
  discoverCharacterSummary?(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<WclCharacterSummaryDTO>>;
}

/** Normalized WCL rate snapshot for admission / budget gates (no GraphQL payload). */
export interface WclRateLimitSnapshotDTO {
  pointsRemaining: number;
  /** Window points limit (from provider `limitPerHour`). */
  pointsLimit: number;
  resetAt: IsoDateTime | null;
  fetchedAt: IsoDateTime;
}

export type WclRateBudgetAction = "OK" | "WARN" | "DEFER" | "STOP";

export interface WclRateBudgetDecisionDTO {
  action: WclRateBudgetAction;
  utilizationPercent: number;
  snapshot: WclRateLimitSnapshotDTO;
}

/** Providers that implement the typed rate-limit capability for admission. */
export interface WarcraftLogsRateLimitCapability {
  readonly rateLimitSupported: true;
  fetchRateLimit(ctx: ProviderFetchContext): Promise<WclRateBudgetDecisionDTO>;
}

/**
 * Type guard for the WCL rate-limit capability.
 * Requires the explicit `rateLimitSupported` flag so disabled provider proxies
 * (which return functions for every property) cannot pass falsely.
 */
export function hasWarcraftLogsRateLimitCapability(
  provider: WarcraftLogsProvider,
): provider is WarcraftLogsProvider & WarcraftLogsRateLimitCapability {
  return (
    provider.rateLimitSupported === true &&
    typeof provider.fetchRateLimit === "function"
  );
}

/**
 * WCL `rateLimitData` is account-global (GraphQL transport region `"global"`).
 * `ProviderFetchContext.region` is still required by the canonical context contract;
 * admission uses `EU` as a synthetic placeholder and must not be treated as a
 * character-scoped region for this call.
 */
export const WCL_RATE_LIMIT_CONTEXT_REGION: RegionCode = "EU";

/** Build a canonical ProviderFetchContext for the global WCL rate-limit query. */
export function buildWclRateLimitFetchContext(input?: {
  requestId?: string;
  correlationId?: string | null;
  now?: IsoDateTime;
  forceRefresh?: boolean;
}): ProviderFetchContext {
  const now = input?.now ?? new Date().toISOString();
  const requestId = input?.requestId ?? `wcl-rate-limit-${Date.now()}`;
  return {
    region: WCL_RATE_LIMIT_CONTEXT_REGION,
    requestId,
    correlationId: input?.correlationId ?? requestId,
    forceRefresh: input?.forceRefresh ?? true,
    now,
  };
}


export interface RaiderIoProvider {
  readonly name: "raiderio";
  /** When false, callers should skip Raider.IO refresh steps. */
  readonly enabled: boolean;
  getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoCharacterProfile>>;
  getSeasonCutoffs(
    region: RegionCode,
    seasonSlug: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoSeasonCutoffs>>;
  getStaticData(ctx: ProviderFetchContext): Promise<ProviderResult<RaiderIoStaticData>>;
  getRunDetails(
    seasonSlug: string,
    externalRunId: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<RaiderIoRunDetails>>;
  getPeriods(ctx: ProviderFetchContext): Promise<ProviderResult<RaiderIoPeriod[]>>;
}
