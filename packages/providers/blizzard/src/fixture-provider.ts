import type {
  BlizzardProvider,
  BlizzardCharacterAchievementsDTO,
  BlizzardCharacterMediaDTO,
  BlizzardDungeonDTO,
  BlizzardItemDTO,
  BlizzardJournalInstanceDTO,
  BlizzardJournalInstanceMediaDTO,
  BlizzardMythicKeystoneProfileDTO,
  BlizzardMythicLeaderboardDTO,
  BlizzardRealmDTO,
  BlizzardRealmIndexEntryDTO,
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
import { ExternalApiError } from "@mplus/contracts";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { BlizzardClientOptions } from "./config.js";
import { DEFAULT_TTL_SECONDS, getRegionConfig } from "./config.js";
import { mapStatusToError } from "./errors.js";
import { FixtureStore } from "./fixture-store.js";
import {
  buildIdentityDiagnostics,
  buildObservationEnvelope,
  buildProviderResult,
  normalizeCharacterAchievements,
  normalizeCharacterProfile,
  normalizeCharacterSnapshot,
  normalizeDungeon,
  normalizeEquipmentSnapshot,
  normalizeItem,
  normalizeJournalInstance,
  normalizeJournalInstanceMedia,
  normalizeLeaderboard,
  normalizeMedia,
  normalizeMythicProfileIndex,
  normalizeMythicRuns,
  normalizePeriod,
  normalizeRealm,
  normalizeRealmIndexEntry,
  normalizeSeason,
  normalizeTalentSnapshot,
  pickSeasonProfileMythicRating,
  refLabel,
  resolveCurrentSeasonIdFromIndex,
  roleFromSpecType,
  slugifyLabel,
  type BlizzardCurrentSeasonPeriod,
  type BlizzardIdentityDiagnostics,
  type BlizzardPeriodDTO,
} from "./normalize.js";
import {
  characterAchievementsSchema,
  characterProfileSchema,
  dungeonIndexSchema,
  dungeonSchema,
  equipmentSchema,
  itemMediaSchema,
  itemSchema,
  journalInstanceIndexSchema,
  journalInstanceMediaSchema,
  mediaSchema,
  mythicKeystoneProfileIndexSchema,
  mythicKeystoneSeasonProfileSchema,
  periodIndexSchema,
  periodSchema,
  realmSchema,
  realmIndexSchema,
  seasonIndexSchema,
  seasonSchema,
  specializationsSchema,
} from "./schemas.js";

function parseOrThrow<T>(
  schema: { parse: (data: unknown) => T },
  data: unknown,
  endpointKey: string,
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    throw mapStatusToError({
      statusCode: null,
      message: `Invalid Blizzard fixture payload for ${endpointKey}`,
      reason: "INVALID_PROVIDER_RESPONSE",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

export class FixtureBlizzardProvider implements BlizzardProvider {
  readonly name = "blizzard" as const;
  private readonly store: FixtureStore;

  constructor(options: BlizzardClientOptions = {}) {
    this.store = new FixtureStore(options.fixtureDir);
  }

  async getRealm(realmSlug: string, ctx: ProviderFetchContext): Promise<ProviderResult<BlizzardRealmDTO>> {
    const slug = normalizeRealmSlug(realmSlug);
    const relative = this.store.manifest.realms[slug];
    if (!relative) {
      throw mapStatusToError({
        statusCode: 404,
        message: `Realm not found in fixtures: ${slug}`,
        reason: "NOT_FOUND",
      });
    }
    const raw = parseOrThrow(realmSchema, this.store.readJson(relative), "realm.get");
    const region = getRegionConfig(String(ctx.region)).regionCode;
    return buildProviderResult({
      data: normalizeRealm(raw, region),
      ctx,
      endpointKey: "realm.get",
      sourceUrl: `fixture://blizzard/realm/${slug}`,
      cacheHit: true,
      statusCode: 200,
    });
  }

  async getRealmIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardRealmIndexEntryDTO[]>> {
    const indexRelative = this.store.manifest.realmIndex;
    const region = getRegionConfig(String(ctx.region)).regionCode;
    if (indexRelative) {
      const raw = parseOrThrow(realmIndexSchema, this.store.readJson(indexRelative), "realm.index");
      return buildProviderResult({
        data: raw.realms.map(normalizeRealmIndexEntry),
        ctx,
        endpointKey: "realm.index",
        sourceUrl: `fixture://blizzard/realm-index`,
        cacheHit: true,
        statusCode: 200,
      });
    }
    // Fallback: synthesize an index from per-realm fixtures.
    const entries = Object.keys(this.store.manifest.realms).map((slug) => {
      const relative = this.store.manifest.realms[slug]!;
      const raw = parseOrThrow(realmSchema, this.store.readJson(relative), "realm.get");
      return normalizeRealmIndexEntry({ id: raw.id, slug: raw.slug, name: raw.name });
    });
    void region;
    return buildProviderResult({
      data: entries,
      ctx,
      endpointKey: "realm.index",
      sourceUrl: "fixture://blizzard/realm-index",
      cacheHit: true,
      statusCode: 200,
    });
  }

  async getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>> {
    const bundle = this.bundle(identity);
    const raw = parseOrThrow(characterProfileSchema, bundle.profile, "character.profile");
    const data = normalizeCharacterProfile(raw, identity);
    const result = buildProviderResult({
      data,
      ctx,
      endpointKey: "character.profile",
      sourceUrl: this.characterSource(identity, ""),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterProfile),
    });
    (result as ProviderResult<CanonicalCharacter> & {
      identityDiagnostics: BlizzardIdentityDiagnostics;
    }).identityDiagnostics = buildIdentityDiagnostics(identity, data);
    return result;
  }

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
    const bundle = this.bundle(identity);
    const equipment = parseOrThrow(equipmentSchema, bundle.equipment, "character.equipment");
    const specs = parseOrThrow(specializationsSchema, bundle.specializations, "character.specializations");
    const mythic = parseOrThrow(
      mythicKeystoneProfileIndexSchema,
      bundle.mythicIndex,
      "character.mplus.index",
    );
    return buildProviderResult({
      data: normalizeCharacterSnapshot(identity, equipment, {
        mythicRating: mythic.current_mythic_rating?.rating ?? null,
        activeSpecSlug: slugifyLabel(specs.active_specialization?.name),
        role: roleFromSpecType(specs.active_specialization?.type),
      }),
      ctx,
      endpointKey: "character.equipment",
      sourceUrl: this.characterSource(identity, "/equipment"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterEquipment),
    });
  }

  async getEquipmentSnapshot(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<EquipmentSnapshotDTO>> {
    const bundle = this.bundle(identity);
    const equipment = parseOrThrow(equipmentSchema, bundle.equipment, "character.equipment");
    return buildProviderResult({
      data: normalizeEquipmentSnapshot(identity, equipment),
      ctx,
      endpointKey: "character.equipment.snapshot",
      sourceUrl: this.characterSource(identity, "/equipment"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterEquipment),
    });
  }

  async getTalentSnapshot(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<TalentSnapshotDTO>> {
    const bundle = this.bundle(identity);
    const specs = parseOrThrow(specializationsSchema, bundle.specializations, "character.specializations");
    return buildProviderResult({
      data: normalizeTalentSnapshot(identity, specs),
      ctx,
      endpointKey: "character.specializations",
      sourceUrl: this.characterSource(identity, "/specializations"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterSpecializations),
    });
  }

  async getCharacterMedia(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardCharacterMediaDTO>> {
    const bundle = this.bundle(identity);
    const media = parseOrThrow(mediaSchema, bundle.media, "character.media");
    return buildProviderResult({
      data: normalizeMedia(media),
      ctx,
      endpointKey: "character.media",
      sourceUrl: this.characterSource(identity, "/character-media"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterMedia),
    });
  }

  async getCharacterAchievements(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardCharacterAchievementsDTO>> {
    const bundle = this.bundle(identity);
    const raw = parseOrThrow(
      characterAchievementsSchema,
      bundle.achievements,
      "character.achievements",
    );
    return buildProviderResult({
      data: normalizeCharacterAchievements(raw),
      ctx,
      endpointKey: "character.achievements",
      sourceUrl: this.characterSource(identity, "/achievements"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterAchievements),
    });
  }

  async getMythicKeystoneProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicKeystoneProfileDTO>> {
    const authoritative = await this.resolveAuthoritativeCurrentSeasonId(ctx);
    const bundle = this.bundle(identity);
    const raw = parseOrThrow(mythicKeystoneProfileIndexSchema, bundle.mythicIndex, "character.mplus.index");
    return buildProviderResult({
      data: normalizeMythicProfileIndex(raw, identity, authoritative.data.seasonId),
      ctx,
      endpointKey: "character.mplus.index",
      sourceUrl: this.characterSource(identity, "/mythic-keystone-profile"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterMplusIndex),
    });
  }

  async resolveAuthoritativeCurrentSeasonId(
    ctx: ProviderFetchContext,
  ): Promise<
    ProviderResult<{
      seasonId: number;
      slug: string;
      source: "season_index.current_season" | "season_index.last";
    }>
  > {
    const raw = parseOrThrow(
      seasonIndexSchema,
      this.store.readJson(this.store.manifest.seasons.index),
      "mplus.season.index",
    );
    const { seasonId, source } = resolveCurrentSeasonIdFromIndex(raw);
    return buildProviderResult({
      data: {
        seasonId,
        slug: `blizzard-season-${seasonId}`,
        source,
      },
      ctx,
      endpointKey: "mplus.season.authoritative_current",
      sourceUrl: "fixture://blizzard/mythic-keystone/season/index",
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.seasonIndex),
    });
  }

  async getMythicKeystoneSeasonProfile(
    identity: CharacterIdentityInput,
    seasonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{ profile: BlizzardMythicKeystoneProfileDTO; runs: MythicRunDTO[] }>> {
    const bundle = this.bundle(identity);
    const raw = parseOrThrow(
      mythicKeystoneSeasonProfileSchema,
      bundle.mythicSeason,
      "character.mplus.season",
    );
    const profile = normalizeMythicProfileIndex(
      {
        seasons: [{ id: seasonId }],
        current_mythic_rating: pickSeasonProfileMythicRating(raw),
        character: raw.character,
      },
      identity,
      seasonId,
    );
    return buildProviderResult({
      data: {
        profile: { ...profile, currentSeasonId: seasonId },
        runs: normalizeMythicRuns(raw, identity, seasonId),
      },
      ctx,
      endpointKey: "character.mplus.season",
      sourceUrl: this.characterSource(identity, `/mythic-keystone-profile/season/${seasonId}`),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterMplusSeasonCurrent),
    });
  }

  async getMythicKeystoneSeasonIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardSeasonDTO[]>> {
    const raw = parseOrThrow(
      seasonIndexSchema,
      this.store.readJson(this.store.manifest.seasons.index),
      "mplus.season.index",
    );
    // Index only — do not cascade season detail fetches for every id.
    const seasons = raw.seasons.map((s) => normalizeSeason({ id: s.id }));
    return buildProviderResult({
      data: seasons,
      ctx,
      endpointKey: "mplus.season.index",
      sourceUrl: "fixture://blizzard/mythic-keystone/season/index",
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.seasonIndex),
    });
  }

  async getMythicKeystoneSeason(
    seasonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardSeasonDTO>> {
    const relative = this.store.manifest.seasons.byId[String(seasonId)];
    if (!relative) {
      throw mapStatusToError({
        statusCode: 404,
        message: `Season not found in fixtures: ${seasonId}`,
        reason: "NOT_FOUND",
      });
    }
    const raw = parseOrThrow(seasonSchema, this.store.readJson(relative), "mplus.season.get");
    return buildProviderResult({
      data: normalizeSeason(raw),
      ctx,
      endpointKey: "mplus.season.get",
      sourceUrl: `fixture://blizzard/mythic-keystone/season/${seasonId}`,
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.seasonHistorical),
    });
  }

  async getMythicKeystonePeriodIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<{ periods: BlizzardPeriodDTO[]; currentPeriodId: number | null }>> {
    const raw = parseOrThrow(
      periodIndexSchema,
      this.store.readJson(this.store.manifest.periods.index),
      "mplus.period.index",
    );
    return buildProviderResult({
      data: {
        periods: raw.periods.map((p) => normalizePeriod({ id: p.id })),
        currentPeriodId: raw.current_period?.id ?? null,
      },
      ctx,
      endpointKey: "mplus.period.index",
      sourceUrl: "fixture://blizzard/mythic-keystone/period/index",
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.seasonIndex),
    });
  }

  async getMythicKeystonePeriod(
    periodId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardPeriodDTO>> {
    const relative = this.store.manifest.periods.byId[String(periodId)];
    if (!relative) {
      throw mapStatusToError({
        statusCode: 404,
        message: `Period not found in fixtures: ${periodId}`,
        reason: "NOT_FOUND",
      });
    }
    const raw = parseOrThrow(periodSchema, this.store.readJson(relative), "mplus.period.get");
    return buildProviderResult({
      data: normalizePeriod(raw),
      ctx,
      endpointKey: "mplus.period.get",
      sourceUrl: `fixture://blizzard/mythic-keystone/period/${periodId}`,
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.seasonHistorical),
    });
  }

  async resolveCurrentSeasonPeriod(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardCurrentSeasonPeriod>> {
    const index = parseOrThrow(
      seasonIndexSchema,
      this.store.readJson(this.store.manifest.seasons.index),
      "mplus.season.index",
    );
    const { seasonId, source } = resolveCurrentSeasonIdFromIndex(index);
    const season = await this.getMythicKeystoneSeason(seasonId, ctx);
    const periodIndex = await this.getMythicKeystonePeriodIndex(ctx);
    const periodId = periodIndex.data.currentPeriodId;
    const period =
      periodId != null ? (await this.getMythicKeystonePeriod(periodId, ctx)).data : null;
    return buildProviderResult({
      data: {
        seasonId,
        season: season.data,
        periodId,
        period,
        source: periodId != null ? "period_index.current_period" : source,
      },
      ctx,
      endpointKey: "mplus.current.season_period",
      sourceUrl: "fixture://blizzard/mythic-keystone/current",
      cacheHit: true,
      statusCode: 200,
      expiresAt: season.freshness.expiresAt,
    });
  }

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
      cacheHit: true,
      statusCode: 200,
      expiresAt: seasonProfile.freshness.expiresAt,
    });
  }

  async getMythicKeystoneDungeonIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardDungeonDTO[]>> {
    const raw = parseOrThrow(
      dungeonIndexSchema,
      this.store.readJson(this.store.manifest.dungeons.index),
      "mplus.dungeon.index",
    );
    const dungeons = raw.dungeons.map((d) => {
      const relative = this.store.manifest.dungeons.byId[String(d.id)];
      if (!relative) {
        return normalizeDungeon({ id: d.id, name: d.name ?? `Dungeon ${d.id}` });
      }
      const detail = parseOrThrow(dungeonSchema, this.store.readJson(relative), "mplus.dungeon.get");
      return normalizeDungeon(detail);
    });
    return buildProviderResult({
      data: dungeons,
      ctx,
      endpointKey: "mplus.dungeon.index",
      sourceUrl: "fixture://blizzard/mythic-keystone/dungeon/index",
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.dungeon),
    });
  }

  async getMythicKeystoneDungeon(
    dungeonId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardDungeonDTO>> {
    const relative = this.store.manifest.dungeons.byId[String(dungeonId)];
    if (!relative) {
      throw mapStatusToError({
        statusCode: 404,
        message: `Dungeon not found in fixtures: ${dungeonId}`,
        reason: "NOT_FOUND",
      });
    }
    const raw = parseOrThrow(dungeonSchema, this.store.readJson(relative), "mplus.dungeon.get");
    return buildProviderResult({
      data: normalizeDungeon(raw),
      ctx,
      endpointKey: "mplus.dungeon.get",
      sourceUrl: `fixture://blizzard/mythic-keystone/dungeon/${dungeonId}`,
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.dungeon),
    });
  }

  async getJournalInstanceIndex(
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardJournalInstanceDTO[]>> {
    const relative = this.store.manifest.journalInstances?.index;
    if (!relative) {
      return buildProviderResult({
        data: [],
        ctx,
        endpointKey: "journal-instance.index",
        sourceUrl: "fixture://blizzard/journal-instance/index",
        cacheHit: true,
        statusCode: 200,
        expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.dungeon),
      });
    }
    const raw = parseOrThrow(
      journalInstanceIndexSchema,
      this.store.readJson(relative),
      "journal-instance.index",
    );
    return buildProviderResult({
      data: raw.instances.map((row) => normalizeJournalInstance(row)),
      ctx,
      endpointKey: "journal-instance.index",
      sourceUrl: "fixture://blizzard/journal-instance/index",
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.dungeon),
    });
  }

  async getJournalInstanceMedia(
    journalInstanceId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardJournalInstanceMediaDTO>> {
    const relative = this.store.manifest.journalInstances?.mediaById[String(journalInstanceId)];
    if (!relative) {
      throw mapStatusToError({
        statusCode: 404,
        message: `Journal instance media not found in fixtures: ${journalInstanceId}`,
        reason: "NOT_FOUND",
      });
    }
    const raw = parseOrThrow(
      journalInstanceMediaSchema,
      this.store.readJson(relative),
      "journal-instance.media",
    );
    return buildProviderResult({
      data: normalizeJournalInstanceMedia(journalInstanceId, raw),
      ctx,
      endpointKey: "journal-instance.media",
      sourceUrl: `fixture://blizzard/media/journal-instance/${journalInstanceId}`,
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.dungeon),
    });
  }

  async getItems(itemIds: number[], ctx: ProviderFetchContext): Promise<ProviderResult<BlizzardItemDTO[]>> {
    const unique = [...new Set(itemIds)];
    const items: BlizzardItemDTO[] = [];
    for (const id of unique) {
      const entry = this.store.manifest.items[String(id)];
      if (!entry) continue;
      const item = parseOrThrow(itemSchema, this.store.readJson(entry.item), "item.get");
      const media = parseOrThrow(itemMediaSchema, this.store.readJson(entry.media), "item.media");
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
    }
    return buildProviderResult({
      data: items,
      ctx,
      endpointKey: "item.batch",
      sourceUrl: "fixture://blizzard/item",
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.item),
    });
  }

  async getConnectedRealmMythicLeaderboard(
    connectedRealmId: number,
    dungeonId: number,
    periodId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicLeaderboardDTO>> {
    // Explicit method only — fixtures return an empty leading set; no crawl.
    return buildProviderResult({
      data: normalizeLeaderboard(connectedRealmId, dungeonId, periodId, { leading_groups: [] }),
      ctx,
      endpointKey: "mythic.leaderboard",
      sourceUrl: `fixture://blizzard/connected-realm/${connectedRealmId}/mythic-leaderboard/${dungeonId}/period/${periodId}`,
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.leaderboard),
    });
  }

  /** Test helper to simulate rate-limit / 5xx / privacy / invalid fixture errors. */
  simulateError(kind: "400" | "403" | "404" | "429" | "500" | "profile-404"): never {
    if (kind === "profile-404") {
      throw mapStatusToError({
        statusCode: 404,
        message: "Simulated Blizzard character profile 404",
        reason: "PROFILE_UNAVAILABLE",
        endpointKey: "character.profile",
        details: { body: this.store.readJson(this.store.manifest.errors["404"] ?? "errors/404.json") },
      });
    }
    const relative = this.store.manifest.errors[kind];
    const body = relative ? this.store.readJson(relative) : {};
    throw mapStatusToError({
      statusCode: Number(kind),
      message: `Simulated Blizzard ${kind}`,
      endpointKey: kind === "404" ? "realm.get" : undefined,
      details: { body },
    });
  }

  private bundle(identity: CharacterIdentityInput) {
    return this.store.getCharacterBundle(
      normalizeRegion(identity.region),
      normalizeRealmSlug(identity.realmSlug),
      normalizeName(identity.name),
    );
  }

  private characterSource(identity: CharacterIdentityInput, suffix: string): string {
    const region = getRegionConfig(String(identity.region));
    return `${region.apiHost}/profile/wow/character/${normalizeRealmSlug(identity.realmSlug)}/${normalizeName(identity.name)}${suffix}`;
  }
}

function ttlExpiry(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function isExternalApiError(error: unknown): error is ExternalApiError {
  return error instanceof ExternalApiError;
}
