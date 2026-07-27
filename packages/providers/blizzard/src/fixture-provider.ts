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
import { ExternalApiError } from "@mplus/contracts";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import type { BlizzardClientOptions } from "./config.js";
import { DEFAULT_TTL_SECONDS, getRegionConfig } from "./config.js";
import { mapStatusToError } from "./errors.js";
import { FixtureStore } from "./fixture-store.js";
import {
  buildProviderResult,
  normalizeCharacterProfile,
  normalizeCharacterSnapshot,
  normalizeDungeon,
  normalizeEquipmentSnapshot,
  normalizeItem,
  normalizeLeaderboard,
  normalizeMedia,
  normalizeMythicProfileIndex,
  normalizeMythicRuns,
  normalizeRealm,
  normalizeSeason,
  normalizeTalentSnapshot,
  refLabel,
  roleFromSpecType,
  slugifyLabel,
} from "./normalize.js";
import {
  characterProfileSchema,
  dungeonIndexSchema,
  dungeonSchema,
  equipmentSchema,
  itemMediaSchema,
  itemSchema,
  mediaSchema,
  mythicKeystoneProfileIndexSchema,
  mythicKeystoneSeasonProfileSchema,
  realmSchema,
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

  async getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>> {
    const bundle = this.bundle(identity);
    const raw = parseOrThrow(characterProfileSchema, bundle.profile, "character.profile");
    return buildProviderResult({
      data: normalizeCharacterProfile(raw, identity),
      ctx,
      endpointKey: "character.profile",
      sourceUrl: this.characterSource(identity, ""),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterProfile),
    });
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
      sourceUrl: this.characterSource(identity, "/media"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterMedia),
    });
  }

  async getMythicKeystoneProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<BlizzardMythicKeystoneProfileDTO>> {
    const bundle = this.bundle(identity);
    const raw = parseOrThrow(mythicKeystoneProfileIndexSchema, bundle.mythicIndex, "character.mplus.index");
    return buildProviderResult({
      data: normalizeMythicProfileIndex(raw, identity),
      ctx,
      endpointKey: "character.mplus.index",
      sourceUrl: this.characterSource(identity, "/mythic-keystone-profile"),
      cacheHit: true,
      statusCode: 200,
      expiresAt: ttlExpiry(DEFAULT_TTL_SECONDS.characterMplusIndex),
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

  /** Test helper to simulate rate-limit / 5xx fixture errors. */
  simulateError(kind: "429" | "500"): never {
    const relative = this.store.manifest.errors[kind];
    const body = relative ? this.store.readJson(relative) : {};
    throw mapStatusToError({
      statusCode: Number(kind),
      message: `Simulated Blizzard ${kind}`,
      reason: kind === "429" ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
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
