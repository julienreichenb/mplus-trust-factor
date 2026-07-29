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
    level: typeof payload.level === "number" && payload.level > 0 ? payload.level : null,
    faction: payload.faction?.name ?? null,
    itemLevelEquipped:
      typeof payload.equipped_item_level === "number" && payload.equipped_item_level > 0
        ? payload.equipped_item_level
        : null,
    itemLevelAverage:
      typeof payload.average_item_level === "number" && payload.average_item_level > 0
        ? payload.average_item_level
        : null,
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
  const items = (equipment.equipped_items ?? []).map((item) => {
    const raw = item as {
      enchantments?: Array<{ display_string?: string; enchantment_id?: number }>;
      sockets?: Array<{ item?: { name?: string; id?: number }; display_string?: string }>;
      media?: { id?: number };
      bonus_list?: unknown;
    };
    const enchantments = (raw.enchantments ?? [])
      .map((e) => e.display_string?.trim())
      .filter((s): s is string => Boolean(s));
    const gems = (raw.sockets ?? [])
      .map((s) => {
        const name = s.item?.name?.trim() || s.display_string?.trim() || null;
        if (!name) return null;
        return { name, itemId: s.item?.id ?? null };
      })
      .filter((g): g is { name: string; itemId: number | null } => g != null);
    const bonusList = Array.isArray(raw.bonus_list)
      ? raw.bonus_list.filter(
          (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0,
        )
      : [];

    return {
      itemId: item.item.id,
      slot: refLabel(item.slot),
      name: item.name ?? null,
      quality: refLabel(item.quality),
      itemLevel: resolveEquippedItemLevel(item.level),
      iconUrl: null as string | null,
      enchantments,
      gems,
      bonusList,
    };
  });
  const keyItems = items.filter((entry) => {
    const slot = String(entry.slot ?? "").toUpperCase();
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

/** Prefer numeric level.value; fall back to parsing "Item Level N" display strings.
 * When both disagree, keep the higher — scaled/crafted gear sometimes exposes base in `value`.
 */
export function resolveEquippedItemLevel(
  level: { value?: number; display_string?: string } | null | undefined,
): number | null {
  const fromValue =
    typeof level?.value === "number" && Number.isFinite(level.value) && level.value > 0
      ? level.value
      : null;
  let fromDisplay: number | null = null;
  const display = level?.display_string;
  if (typeof display === "string") {
    const match = display.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) fromDisplay = Math.round(parsed);
    }
  }
  if (fromValue != null && fromDisplay != null) return Math.max(fromValue, fromDisplay);
  return fromValue ?? fromDisplay;
}

/** Attach HTTPS icon URLs onto equipment items (mutates a shallow copy). Soft-fail per item. */
export function attachEquipmentIconUrls(
  snapshot: EquipmentSnapshotDTO,
  iconByItemId: Map<number, string | null>,
): EquipmentSnapshotDTO {
  const attach = (raw: unknown): unknown => {
    if (!Array.isArray(raw)) return raw;
    return raw.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const item = entry as { itemId?: unknown; iconUrl?: unknown };
      const id = typeof item.itemId === "number" ? item.itemId : null;
      if (id == null) return entry;
      const icon = iconByItemId.get(id);
      if (!icon) return entry;
      return { ...item, iconUrl: sanitizeHttpsUrl(icon) };
    });
  };
  return {
    ...snapshot,
    items: attach(snapshot.items),
    keyItems: attach(snapshot.keyItems),
  };
}

export function sanitizeHttpsUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
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
  const loadouts = (activeEntry?.loadouts ?? []) as Array<{
    is_active?: boolean;
    talent_loadout_code?: string;
    selected_class_talents?: unknown[];
    selected_spec_talents?: unknown[];
    selected_hero_talents?: unknown[];
    selected_hero_talent_tree?: { id?: number; name?: string };
  }>;
  const loadout = loadouts.find((entry) => entry.is_active === true) ?? loadouts[0];
  const selectedTalents = extractSelectedTalentsFromLoadout(loadout);
  const activeHeroTree =
    loadout?.selected_hero_talent_tree ??
    (specs as { active_hero_talent_tree?: { id?: number; name?: string } }).active_hero_talent_tree ??
    null;
  const heroTalentName =
    typeof activeHeroTree?.name === "string" && activeHeroTree.name.trim()
      ? activeHeroTree.name.trim()
      : null;
  return {
    id: randomUUID(),
    characterSnapshotId: characterId,
    specializationSlug: slugifyLabel(active?.name) ?? null,
    loadoutCode: loadout?.talent_loadout_code ?? null,
    talents: {
      specializations: specs.specializations ?? [],
      activeSpecialization: active ?? null,
      activeHeroTalentTree: activeHeroTree,
      heroTalentName,
      selectedTalents,
    },
    sourcePayloadId: null,
  };
}

type TalentTreeKind = "CLASS" | "SPEC" | "HERO" | "UNKNOWN";

export interface NormalizedSelectedTalent {
  id: number | null;
  name: string | null;
  spellId: number | null;
  rank: number | null;
  tree: TalentTreeKind;
  iconUrl: string | null;
}

function positiveTalentInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function mapTalentNode(raw: unknown, tree: TalentTreeKind): NormalizedSelectedTalent | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as {
    id?: unknown;
    rank?: unknown;
    tooltip?: {
      talent?: { id?: unknown; name?: unknown };
      spell_tooltip?: { spell?: { id?: unknown; name?: unknown } };
    };
  };
  const talentId = positiveTalentInt(node.tooltip?.talent?.id) ?? positiveTalentInt(node.id);
  const spellId = positiveTalentInt(node.tooltip?.spell_tooltip?.spell?.id);
  const name =
    (typeof node.tooltip?.talent?.name === "string" && node.tooltip.talent.name.trim()
      ? node.tooltip.talent.name.trim()
      : null) ??
    (typeof node.tooltip?.spell_tooltip?.spell?.name === "string" &&
    node.tooltip.spell_tooltip.spell.name.trim()
      ? node.tooltip.spell_tooltip.spell.name.trim()
      : null);
  const rank =
    typeof node.rank === "number" && Number.isFinite(node.rank) && node.rank > 0
      ? Math.round(node.rank)
      : null;
  if (talentId == null && spellId == null && !name) return null;
  return { id: talentId, name, spellId, rank, tree, iconUrl: null };
}

export function extractSelectedTalentsFromLoadout(
  loadout:
    | {
        selected_class_talents?: unknown[];
        selected_spec_talents?: unknown[];
        selected_hero_talents?: unknown[];
      }
    | null
    | undefined,
): NormalizedSelectedTalent[] {
  if (!loadout) return [];
  const selected = [
    ...(loadout.selected_class_talents ?? []).map((n) => mapTalentNode(n, "CLASS")),
    ...(loadout.selected_spec_talents ?? []).map((n) => mapTalentNode(n, "SPEC")),
    ...(loadout.selected_hero_talents ?? []).map((n) => mapTalentNode(n, "HERO")),
  ].filter((n): n is NormalizedSelectedTalent => n != null);

  const seen = new Set<string>();
  const unique: NormalizedSelectedTalent[] = [];
  for (const talent of selected) {
    const key = talent.spellId != null ? `s:${talent.spellId}` : `t:${talent.id ?? talent.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(talent);
  }
  return unique;
}

/** Attach HTTPS spell icons onto selected talents (mutates a shallow copy of the snapshot). */
export function attachTalentSpellIcons(
  snapshot: TalentSnapshotDTO,
  iconBySpellId: Map<number, string | null>,
): TalentSnapshotDTO {
  const blob = snapshot.talents as { selectedTalents?: NormalizedSelectedTalent[] } | null;
  if (!blob || !Array.isArray(blob.selectedTalents) || blob.selectedTalents.length === 0) {
    return snapshot;
  }
  const selectedTalents = blob.selectedTalents.map((talent) => {
    if (talent.spellId == null) return talent;
    const icon = iconBySpellId.get(talent.spellId);
    if (!icon) return talent;
    return { ...talent, iconUrl: sanitizeHttpsUrl(icon) };
  });
  return {
    ...snapshot,
    talents: {
      ...blob,
      selectedTalents,
    },
  };
}

export function normalizeMedia(payload: MediaPayload): BlizzardCharacterMediaDTO {
  const assets = (payload.assets ?? []).map((a) => ({
    key: a.key,
    url: sanitizeHttpsUrl(a.value) ?? a.value,
  }));
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a.url]));
  return {
    avatarUrl: sanitizeHttpsUrl(byKey.avatar ?? null),
    insetUrl: sanitizeHttpsUrl(byKey.inset ?? null),
    mainUrl: sanitizeHttpsUrl(byKey.main ?? byKey["main-raw"] ?? null),
    assets: assets.filter((a) => sanitizeHttpsUrl(a.url) != null),
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
  category?: string | { type?: string; name?: string };
  is_tournament?: boolean;
  connected_realm?: { id?: number; href?: string };
}, region: RegionCode): BlizzardRealmDTO {
  let connectedRealmId: number | null = payload.connected_realm?.id ?? null;
  if (connectedRealmId === null && payload.connected_realm?.href) {
    const match = /connected-realm\/(\d+)/.exec(payload.connected_realm.href);
    if (match?.[1]) connectedRealmId = Number(match[1]);
  }
  let category: string | null = null;
  if (typeof payload.category === "string") {
    category = payload.category;
  } else if (payload.category && typeof payload.category === "object") {
    category = payload.category.name ?? payload.category.type ?? null;
  }
  return {
    blizzardRealmId: payload.id,
    slug: normalizeRealmSlug(payload.slug),
    name: payload.name,
    region: normalizeRegion(region),
    locale: payload.locale ?? null,
    timezone: payload.timezone ?? null,
    connectedRealmId,
    category,
    isTournament: payload.is_tournament === true,
  };
}

export function normalizeRealmIndexEntry(payload: {
  id: number;
  slug: string;
  name?: string;
}): import("@mplus/contracts").BlizzardRealmIndexEntryDTO {
  return {
    blizzardRealmId: payload.id,
    slug: normalizeRealmSlug(payload.slug),
    name: payload.name?.trim() || payload.slug,
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
    queryParams: {
      ...(parts.queryParams ?? {}),
      // Adapter/schema bumps must not reuse prior ExternalPayload cache entries.
      schemaVersion: SCHEMA_VERSION,
    },
    authScopeType: "client_credentials",
  });
}
