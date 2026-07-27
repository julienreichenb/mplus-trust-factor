import type {
  BlizzardProvider,
  BlizzardCharacterMediaDTO,
  BlizzardDungeonDTO,
  BlizzardItemDTO,
  BlizzardMythicKeystoneProfileDTO,
  BlizzardMythicLeaderboardDTO,
  BlizzardRealmDTO,
  BlizzardSeasonDTO,
  CanonicalCharacter,
  CharacterIdentityInput,
  CharacterSnapshotDTO,
  EquipmentSnapshotDTO,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderResult,
  TalentSnapshotDTO,
} from "@mplus/contracts";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { BlizzardClientOptions, BlizzardRegionKey } from "./config.js";
import { DEFAULT_TTL_SECONDS } from "./config.js";
import { mapStatusToError } from "./errors.js";
import { BlizzardHttpClient, regionFromContext } from "./http-client.js";
import {
  buildIdentityDiagnostics,
  buildObservationEnvelope,
  buildProviderResult,
  encodeCharacterPath,
  fingerprintFor,
  normalizeCharacterProfile,
  normalizeDungeon,
  normalizeEquipmentSnapshot,
  normalizeItem,
  normalizeLeaderboard,
  normalizeMedia,
  normalizeMythicProfileIndex,
  normalizeMythicRuns,
  normalizePeriod,
  normalizeRealm,
  normalizeSeason,
  normalizeTalentSnapshot,
  refLabel,
  resolveCurrentSeasonIdFromIndex,
  type BlizzardCurrentSeasonPeriod,
  type BlizzardIdentityDiagnostics,
  type BlizzardPeriodDTO,
} from "./normalize.js";
import {
  characterProfileSchema,
  dungeonIndexSchema,
  dungeonSchema,
  equipmentSchema,
  itemMediaSchema,
  itemSchema,
  leaderboardSchema,
  mediaSchema,
  mythicKeystoneProfileIndexSchema,
  mythicKeystoneSeasonProfileSchema,
  periodIndexSchema,
  periodSchema,
  realmSchema,
  seasonIndexSchema,
  seasonSchema,
  specializationsSchema,
} from "./schemas.js";
import { BlizzardTokenManager } from "./token-manager.js";
import type { z } from "zod";

function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  endpointKey: string,
): z.infer<S> {
  try {
    return schema.parse(data);
  } catch (error) {
    throw mapStatusToError({
      statusCode: null,
      message: `Invalid Blizzard response for ${endpointKey}`,
      reason: "INVALID_PROVIDER_RESPONSE",
      endpointKey,
      details: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

export class LiveBlizzardProvider implements BlizzardProvider {
  readonly name = "blizzard" as const;
  private readonly http: BlizzardHttpClient;
  private readonly defaultRegion: BlizzardRegionKey;
  private readonly defaultLocale: string;
  private readonly characterTtlSeconds: number;

  constructor(options: BlizzardClientOptions = {}) {
    if (!options.clientId || !options.clientSecret) {
      throw mapStatusToError({
        statusCode: null,
        message: "Live Blizzard provider requires clientId and clientSecret",
        reason: "CONFIGURATION_ERROR",
      });
    }
    this.defaultRegion = options.defaultRegion ?? "eu";
    this.defaultLocale = options.defaultLocale ?? "en_GB";
    this.characterTtlSeconds = options.characterTtlSeconds ?? DEFAULT_TTL_SECONDS.characterProfile;
    const tokenManager = new BlizzardTokenManager({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    this.http = new BlizzardHttpClient(tokenManager, options);
  }

  async getRealm(realmSlug: string, ctx: ProviderFetchContext): Promise<ProviderResult<BlizzardRealmDTO>> {
    const region = this.region(ctx);
    const slug = normalizeRealmSlug(realmSlug);
    const endpointKey = "realm.get";
    const path = `data/wow/realm/${encodeURIComponent(slug)}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: { realmSlug: slug },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.realm,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(realmSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeRealm(raw, region.regionCode),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>> {
    const region = this.region(ctx);
    const endpointKey = "character.profile";
    const charPath = encodeCharacterPath(identity.realmSlug, identity.name);
    const path = `profile/wow/character/${charPath}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: normalizeName(identity.name),
      },
    });
    try {
      const result = await this.http.getJson<unknown>({
        regionConfig: region,
        namespaceKind: "profile",
        path,
        endpointKey,
        fingerprint,
        ttlSeconds: this.characterTtlSeconds,
        forceRefresh: ctx.forceRefresh,
        locale: this.defaultLocale,
        negativeCache: true,
      });
      const raw = parseOrThrow(characterProfileSchema, result.data, endpointKey);
      const data = normalizeCharacterProfile(raw, identity);
      const providerResult = buildProviderResult({
        data,
        ctx,
        endpointKey,
        sourceUrl: result.sourceUrl,
        cacheHit: result.cacheHit,
        statusCode: result.statusCode,
        retryCount: result.retryCount,
        etag: result.etag,
        expiresAt: result.expiresAt,
        pathParams: {
          realmSlug: normalizeRealmSlug(identity.realmSlug),
          name: normalizeName(identity.name),
        },
      });
      // Attach diagnostics without leaking into DTO contracts.
      (providerResult as ProviderResult<CanonicalCharacter> & {
        identityDiagnostics: BlizzardIdentityDiagnostics;
      }).identityDiagnostics = buildIdentityDiagnostics(identity, data);
      return providerResult;
    } catch (error) {
      throw enrichIdentityError(error, identity, endpointKey);
    }
  }

  /**
   * Profile + identity diagnostics + observation envelope (Wave 3 live hardening helper).
   */
  async resolveCharacterIdentity(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<{
    result: ProviderResult<CanonicalCharacter>;
    identityDiagnostics: BlizzardIdentityDiagnostics;
    observation: Record<string, unknown>;
  }> {
    const result = await this.getCharacterProfile(identity, ctx);
    const identityDiagnostics =
      (result as ProviderResult<CanonicalCharacter> & {
        identityDiagnostics?: BlizzardIdentityDiagnostics;
      }).identityDiagnostics ?? buildIdentityDiagnostics(identity, result.data);
    return {
      result,
      identityDiagnostics,
      observation: buildObservationEnvelope({
        observationKey: "blizzard.character.identity",
        value: {
          blizzardCharacterId: result.data.blizzardCharacterId,
          classSlug: result.data.classSlug,
          specSlug: result.data.specSlug,
          role: result.data.role,
        },
        result,
        identityDiagnostics,
      }),
    };
  }

  async getCharacterEquipment(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CharacterSnapshotDTO>> {
    const [equipment, talents, mythic] = await Promise.all([
      this.getEquipmentSnapshot(identity, ctx),
      this.getTalentSnapshot(identity, ctx),
      this.getMythicKeystoneProfile(identity, ctx),
    ]);
    return buildProviderResult({
      data: {
        id: equipment.data.id,
        characterId: talents.data.characterSnapshotId,
        capturedAt: equipment.data.capturedAt,
        itemLevelEquipped: equipment.data.equippedItemLevel,
        activeSpecSlug: talents.data.specializationSlug,
        role: null,
        mythicRating: mythic.data.currentMythicRating,
        sourcePayloadId: null,
      },
      ctx,
      endpointKey: "character.equipment",
      sourceUrl: equipment.provenance.sourceUrl,
      cacheHit: equipment.metadata.cacheHit && talents.metadata.cacheHit,
      statusCode: equipment.metadata.statusCode,
      expiresAt: equipment.freshness.expiresAt,
    });
  }

  async getEquipmentSnapshot(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<EquipmentSnapshotDTO>> {
    const region = this.region(ctx);
    const endpointKey = "character.equipment";
    const charPath = encodeCharacterPath(identity.realmSlug, identity.name);
    const path = `profile/wow/character/${charPath}/equipment`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: normalizeName(identity.name),
      },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "profile",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.characterEquipment,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(equipmentSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeEquipmentSnapshot(identity, raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getTalentSnapshot(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<TalentSnapshotDTO>> {
    const region = this.region(ctx);
    const endpointKey = "character.specializations";
    const charPath = encodeCharacterPath(identity.realmSlug, identity.name);
    const path = `profile/wow/character/${charPath}/specializations`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: normalizeName(identity.name),
      },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "profile",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.characterSpecializations,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(specializationsSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeTalentSnapshot(identity, raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getCharacterMedia(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardCharacterMediaDTO>> {
    const region = this.region(ctx);
    const endpointKey = "character.media";
    const charPath = encodeCharacterPath(identity.realmSlug, identity.name);
    // Official Profile API path is character-media (not /media).
    const path = `profile/wow/character/${charPath}/character-media`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: normalizeName(identity.name),
      },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "profile",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.characterMedia,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(mediaSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeMedia(raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystoneProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicKeystoneProfileDTO>> {
    const region = this.region(ctx);
    const endpointKey = "character.mplus.index";
    const charPath = encodeCharacterPath(identity.realmSlug, identity.name);
    const path = `profile/wow/character/${charPath}/mythic-keystone-profile`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: normalizeName(identity.name),
      },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "profile",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.characterMplusIndex,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(mythicKeystoneProfileIndexSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeMythicProfileIndex(raw, identity),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystoneSeasonProfile(
    identity: CharacterIdentityInput,
    seasonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{ profile: BlizzardMythicKeystoneProfileDTO; runs: MythicRunDTO[] }>> {
    const region = this.region(ctx);
    const endpointKey = "character.mplus.season";
    const charPath = encodeCharacterPath(identity.realmSlug, identity.name);
    const path = `profile/wow/character/${charPath}/mythic-keystone-profile/season/${seasonId}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: normalizeName(identity.name),
        seasonId: String(seasonId),
      },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "profile",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.characterMplusSeasonCurrent,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(mythicKeystoneSeasonProfileSchema, result.data, endpointKey);
    const profile = normalizeMythicProfileIndex(
      {
        seasons: [{ id: seasonId }],
        current_mythic_rating: raw.current_mythic_rating,
        character: raw.character,
      },
      identity,
    );
    return buildProviderResult({
      data: {
        profile: { ...profile, currentSeasonId: seasonId },
        runs: normalizeMythicRuns(raw, identity, seasonId),
      },
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystoneSeasonIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardSeasonDTO[]>> {
    const region = this.region(ctx);
    const endpointKey = "mplus.season.index";
    const path = "data/wow/mythic-keystone/season/index";
    const fingerprint = fingerprintFor({ region: region.key, endpointKey, pathParams: {} });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.seasonIndex,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(seasonIndexSchema, result.data, endpointKey);
    // Index only — do not cascade into every season detail (avoids bulk calls).
    const seasons = raw.seasons.map((season) => normalizeSeason({ id: season.id }));
    return buildProviderResult({
      data: seasons,
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystonePeriodIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{ periods: BlizzardPeriodDTO[]; currentPeriodId: number | null }>> {
    const region = this.region(ctx);
    const endpointKey = "mplus.period.index";
    const path = "data/wow/mythic-keystone/period/index";
    const fingerprint = fingerprintFor({ region: region.key, endpointKey, pathParams: {} });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.seasonIndex,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(periodIndexSchema, result.data, endpointKey);
    return buildProviderResult({
      data: {
        periods: raw.periods.map((p) => normalizePeriod({ id: p.id })),
        currentPeriodId: raw.current_period?.id ?? null,
      },
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystonePeriod(
    periodId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardPeriodDTO>> {
    const region = this.region(ctx);
    const endpointKey = "mplus.period.get";
    const path = `data/wow/mythic-keystone/period/${periodId}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: { periodId: String(periodId) },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.seasonHistorical,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(periodSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizePeriod(raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  /**
   * Resolve dynamic current season + period without hardcoding season IDs.
   */
  async resolveCurrentSeasonPeriod(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardCurrentSeasonPeriod>> {
    const region = this.region(ctx);
    const indexFp = fingerprintFor({
      region: region.key,
      endpointKey: "mplus.season.index",
      pathParams: {},
    });
    const indexResult = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path: "data/wow/mythic-keystone/season/index",
      endpointKey: "mplus.season.index",
      fingerprint: indexFp,
      ttlSeconds: DEFAULT_TTL_SECONDS.seasonIndex,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const index = parseOrThrow(seasonIndexSchema, indexResult.data, "mplus.season.index");
    const { seasonId, source } = resolveCurrentSeasonIdFromIndex(index);
    const season = await this.getMythicKeystoneSeason(seasonId, ctx);

    let periodId: number | null = null;
    let period: BlizzardPeriodDTO | null = null;
    let periodSource: BlizzardCurrentSeasonPeriod["source"] = source;
    try {
      const periodIndex = await this.getMythicKeystonePeriodIndex(ctx);
      periodId = periodIndex.data.currentPeriodId;
      if (periodId != null) {
        const periodResult = await this.getMythicKeystonePeriod(periodId, ctx);
        period = periodResult.data;
        periodSource = "period_index.current_period";
      }
    } catch {
      // Period endpoints are best-effort; season resolution remains authoritative.
    }

    return buildProviderResult({
      data: {
        seasonId,
        season: season.data,
        periodId,
        period,
        source: periodId != null ? periodSource : source,
      },
      ctx,
      endpointKey: "mplus.current.season_period",
      sourceUrl: indexResult.sourceUrl,
      cacheHit: indexResult.cacheHit && season.metadata.cacheHit,
      statusCode: indexResult.statusCode,
      retryCount: indexResult.retryCount,
      etag: indexResult.etag,
      expiresAt: season.freshness.expiresAt,
    });
  }

  /**
   * Fetch current-season best runs after resolving the season id dynamically.
   * Best runs are not a complete history.
   */
  async getCurrentSeasonBestRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<
    ProviderResult<{
      seasonId: number;
      profile: BlizzardMythicKeystoneProfileDTO;
      runs: MythicRunDTO[];
    }>
  > {
    const current = await this.resolveCurrentSeasonPeriod(ctx);
    const seasonProfile = await this.getMythicKeystoneSeasonProfile(
      identity,
      current.data.seasonId,
      ctx,
    );
    return buildProviderResult({
      data: {
        seasonId: current.data.seasonId,
        profile: seasonProfile.data.profile,
        runs: seasonProfile.data.runs,
      },
      ctx,
      endpointKey: "character.mplus.season.current",
      sourceUrl: seasonProfile.provenance.sourceUrl,
      cacheHit: current.metadata.cacheHit && seasonProfile.metadata.cacheHit,
      statusCode: seasonProfile.metadata.statusCode,
      retryCount: seasonProfile.metadata.retryCount,
      expiresAt: seasonProfile.freshness.expiresAt,
    });
  }

  async getMythicKeystoneSeason(
    seasonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardSeasonDTO>> {
    const region = this.region(ctx);
    const endpointKey = "mplus.season.get";
    const path = `data/wow/mythic-keystone/season/${seasonId}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: { seasonId: String(seasonId) },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.seasonHistorical,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(seasonSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeSeason(raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystoneDungeonIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardDungeonDTO[]>> {
    const region = this.region(ctx);
    const endpointKey = "mplus.dungeon.index";
    const path = "data/wow/mythic-keystone/dungeon/index";
    const fingerprint = fingerprintFor({ region: region.key, endpointKey, pathParams: {} });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.dungeon,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(dungeonIndexSchema, result.data, endpointKey);
    // Index only — do not cascade into every dungeon detail (avoids bulk calls).
    const dungeons = raw.dungeons.map((dungeon) =>
      normalizeDungeon({ id: dungeon.id, name: dungeon.name ?? `Dungeon ${dungeon.id}` }),
    );
    return buildProviderResult({
      data: dungeons,
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getMythicKeystoneDungeon(
    dungeonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardDungeonDTO>> {
    const region = this.region(ctx);
    const endpointKey = "mplus.dungeon.get";
    const path = `data/wow/mythic-keystone/dungeon/${dungeonId}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: { dungeonId: String(dungeonId) },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.dungeon,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(dungeonSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeDungeon(raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  async getItems(itemIds: number[], ctx: ProviderFetchContext): Promise<ProviderResult<BlizzardItemDTO[]>> {
    const region = this.region(ctx);
    const unique = [...new Set(itemIds)];
    const items: BlizzardItemDTO[] = [];
    let cacheHit = true;
    let statusCode: number | null = 200;
    let sourceUrl: string | null = null;

    for (const itemId of unique) {
      const itemFp = fingerprintFor({
        region: region.key,
        endpointKey: "item.get",
        pathParams: { itemId: String(itemId) },
      });
      const itemResult = await this.http.getJson<unknown>({
        regionConfig: region,
        namespaceKind: "static",
        path: `data/wow/item/${itemId}`,
        endpointKey: "item.get",
        fingerprint: itemFp,
        ttlSeconds: DEFAULT_TTL_SECONDS.item,
        forceRefresh: ctx.forceRefresh,
        locale: this.defaultLocale,
      });
      const mediaFp = fingerprintFor({
        region: region.key,
        endpointKey: "item.media",
        pathParams: { itemId: String(itemId) },
      });
      const mediaResult = await this.http.getJson<unknown>({
        regionConfig: region,
        namespaceKind: "static",
        path: `data/wow/media/item/${itemId}`,
        endpointKey: "item.media",
        fingerprint: mediaFp,
        ttlSeconds: DEFAULT_TTL_SECONDS.item,
        forceRefresh: ctx.forceRefresh,
        locale: this.defaultLocale,
      });
      const item = parseOrThrow(itemSchema, itemResult.data, "item.get");
      const media = parseOrThrow(itemMediaSchema, mediaResult.data, "item.media");
      const icon = media.assets.find((a) => a.key === "icon")?.value ?? null;
      items.push(
        normalizeItem(
          {
            id: item.id,
            name: item.name,
            quality: item.quality ? { type: refLabel(item.quality) ?? undefined, name: item.quality.name } : null,
            level: item.level ?? undefined,
            required_level: item.required_level ?? undefined,
          },
          icon,
        ),
      );
      cacheHit = cacheHit && itemResult.cacheHit && mediaResult.cacheHit;
      statusCode = itemResult.statusCode;
      sourceUrl = itemResult.sourceUrl;
    }

    return buildProviderResult({
      data: items,
      ctx,
      endpointKey: "item.batch",
      sourceUrl,
      cacheHit,
      statusCode,
      expiresAt: new Date(Date.now() + DEFAULT_TTL_SECONDS.item * 1000).toISOString(),
    });
  }

  async getConnectedRealmMythicLeaderboard(
    connectedRealmId: number,
    dungeonId: number,
    periodId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicLeaderboardDTO>> {
    const region = this.region(ctx);
    const endpointKey = "mythic.leaderboard";
    const path = `data/wow/connected-realm/${connectedRealmId}/mythic-leaderboard/${dungeonId}/period/${periodId}`;
    const fingerprint = fingerprintFor({
      region: region.key,
      endpointKey,
      pathParams: {
        connectedRealmId: String(connectedRealmId),
        dungeonId: String(dungeonId),
        periodId: String(periodId),
      },
    });
    const result = await this.http.getJson<unknown>({
      regionConfig: region,
      namespaceKind: "dynamic",
      path,
      endpointKey,
      fingerprint,
      ttlSeconds: DEFAULT_TTL_SECONDS.leaderboard,
      forceRefresh: ctx.forceRefresh,
      locale: this.defaultLocale,
    });
    const raw = parseOrThrow(leaderboardSchema, result.data, endpointKey);
    return buildProviderResult({
      data: normalizeLeaderboard(connectedRealmId, dungeonId, periodId, raw),
      ctx,
      endpointKey,
      sourceUrl: result.sourceUrl,
      cacheHit: result.cacheHit,
      statusCode: result.statusCode,
      retryCount: result.retryCount,
      etag: result.etag,
      expiresAt: result.expiresAt,
    });
  }

  /** Exposed for tests — HTTP cache layer. */
  getHttpClient(): BlizzardHttpClient {
    return this.http;
  }

  private region(ctx: ProviderFetchContext) {
    return regionFromContext(normalizeRegion(ctx.region), this.defaultRegion, this.defaultLocale);
  }
}

function enrichIdentityError(
  error: unknown,
  identity: CharacterIdentityInput,
  endpointKey: string,
): never {
  if (error && typeof error === "object" && "details" in error) {
    const details = (error as { details?: Record<string, unknown> }).details ?? {};
    (error as { details: Record<string, unknown> }).details = {
      ...details,
      endpointKey,
      submittedIdentity: {
        region: normalizeRegion(identity.region),
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        name: identity.name,
        normalizedName: normalizeName(identity.name),
      },
    };
  }
  throw error;
}
