import { createHash, randomUUID } from "node:crypto";
import type {
  CanonicalCharacter,
  CharacterIdentityInput,
  CharacterSnapshotDTO,
  EquipmentSnapshotDTO,
  MythicRunDTO,
  ProviderFetchContext,
  ProviderRequestMetadata,
  ProviderResult,
  RegionCode,
  SourceProvenance,
  TalentSnapshotDTO,
  BlizzardCharacterMediaDTO,
  BlizzardDungeonDTO,
  BlizzardItemDTO,
  BlizzardMythicKeystoneProfileDTO,
  BlizzardMythicLeaderboardDTO,
  BlizzardRealmDTO,
  BlizzardSeasonDTO,
} from "@mplus/contracts";
import {
  buildRequestFingerprint,
  computeRunFingerprint,
  normalizeName,
  normalizeRealmSlug,
  normalizeRegion,
  toCharacterRef,
} from "@mplus/domain";
import { SCHEMA_VERSION } from "./config.js";
import type {
  CharacterProfilePayload,
  EquipmentPayload,
  MediaPayload,
  MythicBestRunPayload,
  MythicKeystoneProfileIndexPayload,
  MythicKeystoneSeasonProfilePayload,
  SpecializationsPayload,
} from "./schemas.js";

export function characterCanonicalId(region: RegionCode, realmSlug: string, normalizedName: string): string {
  return `blizzard:${normalizeRegion(region)}:${normalizeRealmSlug(realmSlug)}:${normalizedName}`;
}

export function slugifyLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function roleFromSpecType(type: string | null | undefined | { type?: string }): CanonicalCharacter["role"] {
  const raw = typeof type === "object" && type !== null ? type.type : type;
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "TANK") return "TANK";
  if (upper === "HEALER") return "HEALER";
  if (upper === "DAMAGE" || upper === "DPS") return "DPS";
  return null;
}

export function refLabel(
  ref:
    | {
        name?: string;
        type?: string | { type?: string; name?: string };
      }
    | null
    | undefined,
): string | null {
  if (!ref) return null;
  if (typeof ref.type === "string") return ref.type;
  if (ref.type && typeof ref.type === "object") return ref.type.type ?? ref.type.name ?? ref.name ?? null;
  return ref.name ?? null;
}

export function encodeCharacterPath(realmSlug: string, characterName: string): string {
  const realm = encodeURIComponent(normalizeRealmSlug(realmSlug));
  const name = encodeURIComponent(normalizeName(characterName));
  return `${realm}/${name}`;
}

export interface BlizzardIdentityDiagnostics {
  submitted: CharacterIdentityInput;
  canonical: {
    region: RegionCode;
    realmSlug: string;
    normalizedName: string;
    displayName: string;
  };
  matchesSubmitted: boolean;
}

export function normalizeCharacterProfile(
  payload: CharacterProfilePayload,
  identity: CharacterIdentityInput,
): CanonicalCharacter {
  const ref = toCharacterRef(identity);
  const realmSlug = normalizeRealmSlug(payload.realm.slug || identity.realmSlug);
  const displayName = payload.name;
  const normalized = normalizeName(displayName);
  return {
    id: characterCanonicalId(ref.region, realmSlug, normalized),
    region: ref.region,
    realmSlug,
    normalizedName: normalized,
    displayName,
    classSlug: slugifyLabel(payload.character_class?.name) ?? null,
    specSlug: slugifyLabel(payload.active_spec?.name) ?? null,
    role: roleFromSpecType(payload.active_spec?.type),
    blizzardCharacterId: String(payload.id),
    wclCanonicalId: null,
    raiderioProfileUrl: null,
    lastSeenAt: payload.last_login_timestamp
      ? new Date(payload.last_login_timestamp).toISOString()
      : null,
    lastPublicRefreshAt: null,
  };
}

/** Retain submitted identity alongside Blizzard-canonical values for diagnostics. */
export function buildIdentityDiagnostics(
  identity: CharacterIdentityInput,
  canonical: CanonicalCharacter,
): BlizzardIdentityDiagnostics {
  const submitted = {
    region: normalizeRegion(identity.region),
    realmSlug: normalizeRealmSlug(identity.realmSlug),
    name: identity.name,
  };
  const matchesSubmitted =
    normalizeRegion(submitted.region) === normalizeRegion(canonical.region) &&
    normalizeRealmSlug(submitted.realmSlug) === canonical.realmSlug &&
    normalizeName(submitted.name) === canonical.normalizedName;
  return {
    submitted,
    canonical: {
      region: canonical.region,
      realmSlug: canonical.realmSlug,
      normalizedName: canonical.normalizedName,
      displayName: canonical.displayName,
    },
    matchesSubmitted,
  };
}

/** Package-local period DTO (contracts CR not opened in Wave 3 Agent 12). */
export interface BlizzardPeriodDTO {
  blizzardPeriodId: number;
  startTimestamp: number | null;
  endTimestamp: number | null;
}

export interface BlizzardCurrentSeasonPeriod {
  seasonId: number;
  season: BlizzardSeasonDTO;
  periodId: number | null;
  period: BlizzardPeriodDTO | null;
  source: "season_index.current_season" | "season_index.last" | "period_index.current_period";
}

export function normalizePeriod(payload: {
  id: number;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
}): BlizzardPeriodDTO {
  return {
    blizzardPeriodId: payload.id,
    startTimestamp: payload.start_timestamp ?? null,
    endTimestamp: payload.end_timestamp ?? null,
  };
}

/**
 * Resolve current season id from the season index without hardcoding.
 * Prefer `current_season`; fall back to the last listed season id only as a last resort.
 */
export function resolveCurrentSeasonIdFromIndex(payload: {
  seasons: Array<{ id: number }>;
  current_season?: { id: number } | null;
}): { seasonId: number; source: BlizzardCurrentSeasonPeriod["source"] } {
  if (payload.current_season?.id != null) {
    return { seasonId: payload.current_season.id, source: "season_index.current_season" };
  }
  const last = payload.seasons[payload.seasons.length - 1];
  if (!last) {
    throw new Error("Blizzard season index contained no seasons");
  }
  return { seasonId: last.id, source: "season_index.last" };
}

export function normalizeCharacterSnapshot(
  identity: CharacterIdentityInput,
  equipment: EquipmentPayload,
  extras?: { mythicRating?: number | null; activeSpecSlug?: string | null; role?: CanonicalCharacter["role"] },
): CharacterSnapshotDTO {
  const ref = toCharacterRef(identity);
  const characterId = characterCanonicalId(ref.region, ref.realmSlug, ref.normalizedName);
  return {
    id: randomUUID(),
    characterId,
    capturedAt: new Date().toISOString(),
    itemLevelEquipped: equipment.equipped_item_level ?? null,
    activeSpecSlug: extras?.activeSpecSlug ?? null,
    role: extras?.role ?? null,
    mythicRating: extras?.mythicRating ?? null,
    sourcePayloadId: null,
  };
}

export function normalizeEquipmentSnapshot(
  identity: CharacterIdentityInput,
  equipment: EquipmentPayload,
): EquipmentSnapshotDTO {
  const ref = toCharacterRef(identity);
  const characterId = characterCanonicalId(ref.region, ref.realmSlug, ref.normalizedName);
  const items = (equipment.equipped_items ?? []).map((item) => ({
    itemId: item.item.id,
    slot: refLabel(item.slot),
    name: item.name ?? null,
    quality: refLabel(item.quality),
    itemLevel: item.level?.value ?? null,
  }));
  const keyItems = items.filter((item) => {
    const slot = String(item.slot ?? "").toUpperCase();
    return slot.includes("TRINKET") || slot.includes("FINGER") || slot.includes("NECK");
  });
  return {
    id: randomUUID(),
    characterSnapshotId: characterId,
    capturedAt: new Date().toISOString(),
    averageItemLevel: equipment.average_item_level ?? null,
    equippedItemLevel: equipment.equipped_item_level ?? null,
    items,
    keyItems,
    sourcePayloadId: null,
  };
}

export function normalizeTalentSnapshot(
  identity: CharacterIdentityInput,
  specs: SpecializationsPayload,
): TalentSnapshotDTO {
  const ref = toCharacterRef(identity);
  const characterId = characterCanonicalId(ref.region, ref.realmSlug, ref.normalizedName);
  const active = specs.active_specialization;
  const activeEntry = (specs.specializations ?? []).find(
    (entry) => entry.specialization?.id && active?.id && entry.specialization.id === active.id,
  );
  const loadout = activeEntry?.loadouts?.[0] as { talent_loadout_code?: string } | undefined;
  return {
    id: randomUUID(),
    characterSnapshotId: characterId,
    specializationSlug: slugifyLabel(active?.name) ?? null,
    loadoutCode: loadout?.talent_loadout_code ?? null,
    talents: {
      specializations: specs.specializations ?? [],
      activeSpecialization: active ?? null,
    },
    sourcePayloadId: null,
  };
}

export function normalizeMedia(payload: MediaPayload): BlizzardCharacterMediaDTO {
  const assets = (payload.assets ?? []).map((a) => ({ key: a.key, url: a.value }));
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a.url]));
  return {
    avatarUrl: byKey.avatar ?? null,
    insetUrl: byKey.inset ?? null,
    mainUrl: byKey.main ?? byKey["main-raw"] ?? null,
    assets,
  };
}

export function normalizeMythicProfileIndex(
  payload: MythicKeystoneProfileIndexPayload,
  identity: CharacterIdentityInput,
  preferredCurrentSeasonId?: number | null,
): BlizzardMythicKeystoneProfileDTO {
  const seasons = (payload.seasons ?? []).map((s) => ({ seasonId: s.id }));
  const fromPreferred =
    preferredCurrentSeasonId != null && seasons.some((s) => s.seasonId === preferredCurrentSeasonId)
      ? preferredCurrentSeasonId
      : null;
  const currentSeasonId =
    fromPreferred ?? (seasons.length > 0 ? (seasons[seasons.length - 1]?.seasonId ?? null) : null);
  return {
    currentMythicRating: payload.current_mythic_rating?.rating ?? null,
    currentSeasonId,
    seasons,
    character: {
      region: normalizeRegion(identity.region),
      realmSlug: normalizeRealmSlug(identity.realmSlug),
      name: identity.name,
    },
  };
}

export function normalizeMythicRuns(
  payload: MythicKeystoneSeasonProfilePayload,
  identity: CharacterIdentityInput,
  seasonId: number,
): MythicRunDTO[] {
  const region = normalizeRegion(identity.region);
  const seasonSlug = `blizzard-season-${seasonId}`;
  return (payload.best_runs ?? []).map((run) => normalizeBestRun(run, region, seasonSlug, identity));
}

function normalizeBestRun(
  run: MythicBestRunPayload,
  region: RegionCode,
  seasonSlug: string,
  identity: CharacterIdentityInput,
): MythicRunDTO {
  const dungeonName = run.dungeon?.name ?? "unknown";
  const dungeonSlug = slugifyLabel(dungeonName) ?? `dungeon-${run.dungeon?.id ?? "unknown"}`;
  const completedAtMs = run.completed_timestamp;
  const rosterKeys = (run.members ?? []).map((member) => {
    const name = member.character?.name ?? "unknown";
    const realm = member.character?.realm?.slug ?? "unknown";
    return `${normalizeRegion(region)}:${normalizeRealmSlug(realm)}:${normalizeName(name)}`;
  });
  const fingerprint = computeRunFingerprint({
    region,
    seasonKey: seasonSlug,
    dungeonKey: dungeonSlug,
    completedAtMs,
    keyLevel: run.keystone_level,
    durationMs: run.duration,
    rosterCanonicalKeys: rosterKeys,
  });
  const targetKey = `${normalizeRegion(identity.region)}:${normalizeRealmSlug(identity.realmSlug)}:${normalizeName(identity.name)}`;
  return {
    id: createHash("sha256").update(fingerprint, "utf8").digest("hex").slice(0, 32),
    region,
    seasonSlug,
    dungeonSlug,
    keyLevel: run.keystone_level,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: run.duration,
    timerMs: null,
    timed: run.is_completed_within_time ?? false,
    scoreValue: run.mythic_rating?.rating ?? null,
    canonicalFingerprint: fingerprint,
    affixes: (run.affixes ?? []).map((a) => ({
      id: a.id ?? null,
      name: a.name ?? null,
      slug: slugifyLabel(a.name),
    })),
    participants: (run.members ?? []).map((member) => {
      const displayName = member.character?.name ?? "Unknown";
      const realmSlug = normalizeRealmSlug(member.character?.realm?.slug ?? "unknown");
      const providerCharacterKey = `${region}:${realmSlug}:${normalizeName(displayName)}`;
      return {
        providerCharacterKey,
        displayName,
        realmSlug,
        region,
        classSlug: null,
        specSlug: slugifyLabel(member.specialization?.name),
        role: roleFromSpecType(member.specialization?.type),
        itemLevel: member.equipped_item_level ?? null,
        mythicRatingAtRun: null,
        isTargetCharacter: providerCharacterKey === targetKey,
        characterId: null,
      };
    }),
    sources: [
      {
        provider: "BLIZZARD",
        externalRunId: fingerprint,
        externalUrl: null,
        reportCode: null,
        fightId: null,
        revision: null,
      },
    ],
  };
}

export function normalizeRealm(payload: {
  id: number;
  slug: string;
  name: string;
  locale?: string;
  timezone?: string;
  connected_realm?: { id?: number; href?: string };
}, region: RegionCode): BlizzardRealmDTO {
  let connectedRealmId: number | null = payload.connected_realm?.id ?? null;
  if (connectedRealmId === null && payload.connected_realm?.href) {
    const match = /connected-realm\/(\d+)/.exec(payload.connected_realm.href);
    if (match?.[1]) connectedRealmId = Number(match[1]);
  }
  return {
    blizzardRealmId: payload.id,
    slug: normalizeRealmSlug(payload.slug),
    name: payload.name,
    region: normalizeRegion(region),
    locale: payload.locale ?? null,
    timezone: payload.timezone ?? null,
    connectedRealmId,
  };
}

export function normalizeSeason(payload: {
  id: number;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
}): BlizzardSeasonDTO {
  return {
    blizzardSeasonId: payload.id,
    slug: `blizzard-season-${payload.id}`,
    name: `Season ${payload.id}`,
    startTimestamp: payload.start_timestamp ?? null,
    endTimestamp: payload.end_timestamp ?? null,
  };
}

export function normalizeDungeon(payload: {
  id: number;
  name: string;
  map?: { id?: number; name?: string };
}): BlizzardDungeonDTO {
  return {
    blizzardDungeonId: payload.id,
    slug: slugifyLabel(payload.name) ?? `dungeon-${payload.id}`,
    name: payload.name,
    mapId: payload.map?.id ?? null,
  };
}

export function normalizeItem(
  payload: {
    id: number;
    name: string;
    quality?: { type?: string; name?: string } | null;
    level?: number;
    required_level?: number;
  },
  mediaUrl: string | null,
): BlizzardItemDTO {
  const qualityType =
    payload.quality && typeof payload.quality === "object"
      ? (payload.quality.type ?? payload.quality.name ?? null)
      : null;
  return {
    blizzardItemId: payload.id,
    name: payload.name,
    quality: qualityType,
    level: payload.level ?? null,
    requiredLevel: payload.required_level ?? null,
    mediaUrl,
  };
}

export function normalizeLeaderboard(
  connectedRealmId: number,
  dungeonId: number,
  periodId: number,
  payload: { leading_groups?: unknown[]; map?: unknown },
): BlizzardMythicLeaderboardDTO {
  return {
    connectedRealmId,
    dungeonId,
    periodId,
    leadingGroups: payload.leading_groups ?? [],
    map: payload.map ?? null,
  };
}

export function buildProviderResult<T>(input: {
  data: T;
  ctx: ProviderFetchContext;
  endpointKey: string;
  sourceUrl: string | null;
  cacheHit: boolean;
  statusCode: number | null;
  retryCount?: number;
  etag?: string | null;
  expiresAt?: string | null;
  requestedAt?: string;
  completedAt?: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string>;
}): ProviderResult<T> {
  const requestedAt = input.requestedAt ?? input.ctx.now;
  const completedAt = input.completedAt ?? new Date().toISOString();
  const pathParams = input.pathParams ?? {};
  const queryParams = input.queryParams ?? {};
  const fingerprint = buildRequestFingerprint({
    provider: "blizzard",
    region: String(input.ctx.region),
    endpointKey: input.endpointKey,
    pathParams,
    queryParams,
    authScopeType: "client_credentials",
  });
  const provenance: SourceProvenance = {
    provider: "blizzard",
    externalRequestId: input.ctx.requestId,
    sourcePayloadId: null,
    // Never persist query credentials; callers must pass already-redacted URLs.
    sourceUrl: input.sourceUrl,
    fetchedAt: completedAt,
    schemaVersion: SCHEMA_VERSION,
  };
  const metadata: ProviderRequestMetadata = {
    provider: "blizzard",
    endpointKey: input.endpointKey,
    requestFingerprint: fingerprint,
    requestedAt,
    completedAt,
    statusCode: input.statusCode,
    cacheHit: input.cacheHit,
    retryCount: input.retryCount ?? 0,
    costUnits: 1,
    etag: input.etag ?? null,
    expiresAt: input.expiresAt ?? null,
  };
  return {
    data: input.data,
    provenance,
    freshness: {
      fetchedAt: completedAt,
      expiresAt: input.expiresAt ?? null,
      stale: false,
    },
    metadata,
  };
}

/**
 * Normalized observation envelope for downstream scoring (no secrets / auth headers).
 */
export function buildObservationEnvelope(input: {
  observationKey: string;
  value: unknown;
  result: ProviderResult<unknown>;
  identityDiagnostics?: BlizzardIdentityDiagnostics | null;
}): Record<string, unknown> {
  return {
    observationKey: input.observationKey,
    provider: "blizzard",
    value: input.value,
    fetchedAt: input.result.freshness.fetchedAt,
    expiresAt: input.result.freshness.expiresAt,
    endpointKey: input.result.metadata.endpointKey,
    requestFingerprint: input.result.metadata.requestFingerprint,
    statusCode: input.result.metadata.statusCode,
    cacheHit: input.result.metadata.cacheHit,
    schemaVersion: input.result.provenance.schemaVersion,
    sourceUrl: input.result.provenance.sourceUrl,
    identity: input.identityDiagnostics ?? null,
  };
}

export function fingerprintFor(parts: {
  region: string;
  endpointKey: string;
  pathParams: Record<string, string>;
  queryParams?: Record<string, string>;
}): string {
  return buildRequestFingerprint({
    provider: "blizzard",
    region: parts.region,
    endpointKey: parts.endpointKey,
    pathParams: parts.pathParams,
    queryParams: parts.queryParams ?? {},
    authScopeType: "client_credentials",
  });
}
