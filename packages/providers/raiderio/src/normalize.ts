import type {
  RaiderIoAttribution,
  RaiderIoBoostSupportFacts,
  RaiderIoCharacterProfile,
  RaiderIoCutoffLabel,
  RaiderIoCutoffQuantile,
  RaiderIoCutoffThreshold,
  RaiderIoGearItem,
  RaiderIoGearSummary,
  RaiderIoPeriod,
  RaiderIoRaidProgressionEntry,
  RaiderIoRankSummary,
  RaiderIoRosterMember,
  RaiderIoRunCandidate,
  RaiderIoRunDetails,
  RaiderIoScoreSummary,
  RaiderIoSeasonCutoffs,
  RaiderIoStaticData,
  RaiderIoStaticDungeon,
  RaiderIoStaticSeason,
  RaiderIoTalentSummary,
  RegionCode,
} from "@mplus/contracts";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import { RAIDERIO_ATTRIBUTION, RAIDERIO_STALE_CRAWL_THRESHOLD_MS } from "./constants.js";
import type {
  RawCharacterProfileResponse,
  RawCutoffQuantile,
  RawGear,
  RawKeystoneRun,
  RawMythicPlusRanks,
  RawPeriod,
  RawRaidProgressionEntry,
  RawRankBucket,
  RawRegionPeriods,
  RawRosterMember,
  RawRunDetailsResponse,
  RawSeasonCutoffsResponse,
  RawStaticDataResponse,
} from "./raw-types.js";

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapRole(value: string | undefined): "DPS" | "TANK" | "HEALER" | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === "DPS" || upper === "TANK" || upper === "HEALER") return upper;
  return null;
}

export function buildAttribution(profileUrl?: string | null): RaiderIoAttribution {
  return {
    ...RAIDERIO_ATTRIBUTION,
    profileUrl: profileUrl ?? null,
    sourceUrl: profileUrl ?? RAIDERIO_ATTRIBUTION.homepageUrl,
  };
}

function mapScores(raw: { all: number; dps?: number; healer?: number; tank?: number }): RaiderIoScoreSummary {
  return {
    all: raw.all,
    dps: raw.dps ?? null,
    healer: raw.healer ?? null,
    tank: raw.tank ?? null,
  };
}

function rankNumber(value: number | RawRankBucket | undefined, prefer: "world" | "region" | "realm" = "world"): number | null {
  if (typeof value === "number") return value;
  if (!value || typeof value !== "object") return null;
  return value[prefer] ?? value.world ?? value.region ?? value.realm ?? null;
}

export function mapRanks(raw: RawMythicPlusRanks): RaiderIoRankSummary {
  const overallBucket = typeof raw.overall === "object" ? raw.overall : null;
  const classBucket = typeof raw.class === "object" ? raw.class : null;
  const role =
    raw.role ??
    (raw.dps ? "dps" : raw.tank ? "tank" : raw.healer ? "healer" : null);

  return {
    overall: rankNumber(raw.overall, "world"),
    class: rankNumber(raw.class, "world"),
    server: overallBucket?.realm ?? classBucket?.realm ?? raw.server ?? null,
    world: overallBucket?.world ?? (typeof raw.world === "number" ? raw.world : rankNumber(raw.overall, "world")),
    region: overallBucket?.region ?? (typeof raw.region === "number" ? raw.region : rankNumber(raw.overall, "region")),
    role,
  };
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.slug === "string") return record.slug;
    if (typeof record.name === "string") return record.name;
    if (typeof record.short_name === "string") return record.short_name;
  }
  return null;
}

function mapRosterMember(member: RawRosterMember, region: RegionCode): RaiderIoRosterMember {
  const character = member.character;
  const realmRaw = asString(character.realm) ?? "unknown";
  const regionRaw = asString(character.region) ?? region;
  const classRaw = asString(character.class);
  const specRaw =
    character.active_spec_name ??
    character.spec?.name ??
    character.spec?.slug ??
    null;
  const roleRaw = member.role ?? character.active_spec_role ?? character.spec?.role;
  const realmSlug = normalizeRealmSlug(realmRaw);
  const normalizedName = normalizeName(character.name);
  const overallRank = rankNumber(member.ranks?.overall, "world");

  return {
    providerCharacterKey: `${normalizeRegion(regionRaw)}:${realmSlug}:${normalizedName}`,
    displayName: character.name,
    realmSlug,
    region: normalizeRegion(regionRaw),
    classSlug: classRaw ? slugify(classRaw) : null,
    specSlug: specRaw ? slugify(specRaw) : null,
    role: mapRole(roleRaw),
    mythicRating: overallRank,
    rankOverall: overallRank,
  };
}

function mapRun(
  run: RawKeystoneRun,
  region: RegionCode,
  seasonSlug: string,
  source: RaiderIoRunCandidate["source"],
): RaiderIoRunCandidate {
  const roster = (run.roster ?? []).map((m) => mapRosterMember(m, region));
  const timerMs = run.par_time_ms ?? null;
  const timed =
    run.num_keystone_upgrades !== undefined
      ? run.num_keystone_upgrades > 0
      : timerMs !== null
        ? run.clear_time_ms <= timerMs
        : false;
  return {
    externalRunId: String(run.keystone_run_id),
    seasonSlug,
    dungeonSlug: slugify(run.dungeon ?? run.short_name),
    dungeonName: run.dungeon,
    keyLevel: run.mythic_level,
    completedAt: run.completed_at,
    durationMs: run.clear_time_ms,
    timerMs,
    timed,
    scoreValue: run.score ?? null,
    source,
    roster,
    rosterComplete: roster.length >= 4,
    profileUrl: run.url ?? null,
  };
}

function mapRaidProgression(
  raw: Record<string, RawRaidProgressionEntry> | undefined,
): RaiderIoRaidProgressionEntry[] {
  if (!raw) return [];
  return Object.entries(raw).map(([raidSlug, entry]) => ({
    raidSlug,
    raidName: entry.raid ?? raidSlug,
    summary: entry.summary ?? "",
    totalBosses: entry.total_bosses ?? 0,
    normalBossesKilled: entry.normal_bosses_killed ?? 0,
    heroicBossesKilled: entry.heroic_bosses_killed ?? 0,
    mythicBossesKilled: entry.mythic_bosses_killed ?? 0,
  }));
}

export function mapGear(raw: RawGear | undefined): RaiderIoGearSummary | null {
  if (!raw) return null;
  const items: RaiderIoGearItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const [index, item] of raw.items.entries()) {
      if (!item) continue;
      items.push({
        slot: `slot-${index}`,
        itemId: item.item_id ?? null,
        itemLevel: item.item_level ?? null,
        name: item.name ?? null,
        icon: item.icon ?? null,
        quality: item.item_quality ?? null,
      });
    }
  } else if (raw.items && typeof raw.items === "object") {
    for (const [slot, item] of Object.entries(raw.items)) {
      if (!item) continue;
      items.push({
        slot,
        itemId: item.item_id ?? null,
        itemLevel: item.item_level ?? null,
        name: item.name ?? null,
        icon: item.icon ?? null,
        quality: item.item_quality ?? null,
      });
    }
  }

  return {
    itemLevelEquipped: raw.item_level_equipped ?? null,
    itemLevelTotal: raw.item_level_total ?? null,
    items,
  };
}

export function mapTalents(raw: unknown): RaiderIoTalentSummary | null {
  if (raw === undefined || raw === null) {
    return { present: false, shape: "absent" };
  }
  if (Array.isArray(raw)) {
    return { present: raw.length > 0, shape: "array" };
  }
  if (typeof raw === "object") {
    return { present: Object.keys(raw as object).length > 0, shape: "object" };
  }
  return { present: false, shape: "absent" };
}

export function isCrawlStale(
  lastCrawledAt: string | null | undefined,
  nowMs = Date.now(),
  thresholdMs = RAIDERIO_STALE_CRAWL_THRESHOLD_MS,
): boolean {
  if (!lastCrawledAt) return true;
  const crawledMs = Date.parse(lastCrawledAt);
  if (Number.isNaN(crawledMs)) return true;
  return nowMs - crawledMs > thresholdMs;
}

function firstTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object") {
    for (const candidate of Object.values(value as Record<string, unknown>)) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return null;
}

export function normalizeCharacterProfile(
  raw: RawCharacterProfileResponse,
  region: RegionCode,
  nowMs = Date.now(),
): RaiderIoCharacterProfile {
  const normalizedRegion = normalizeRegion(raw.region || region);
  const realmSlug = normalizeRealmSlug(raw.realm);
  const normalizedName = normalizeName(raw.name);
  const profileUrl =
    raw.profile_url ??
    `https://raider.io/characters/${normalizedRegion.toLowerCase()}/${realmSlug}/${encodeURIComponent(raw.name)}`;

  const seasons = raw.mythic_plus_scores_by_season ?? [];
  const currentSeason = seasons[0]
    ? {
        seasonSlug: seasons[0].season,
        scores: mapScores(seasons[0].scores),
        isCurrentSeason: true,
        isPreviousSeason: false,
      }
    : null;
  const previousSeason = seasons[1]
    ? {
        seasonSlug: seasons[1].season,
        scores: mapScores(seasons[1].scores),
        isCurrentSeason: false,
        isPreviousSeason: true,
      }
    : null;

  const seasonSlug = currentSeason?.seasonSlug ?? "current";
  const recentRuns = (raw.mythic_plus_recent_runs ?? []).map((r) =>
    mapRun(r, normalizedRegion, seasonSlug, "recent"),
  );
  const bestRuns = (raw.mythic_plus_best_runs ?? []).map((r) =>
    mapRun(r, normalizedRegion, seasonSlug, "best"),
  );
  const highestLevelRuns = (raw.mythic_plus_highest_level_runs ?? []).map((r) =>
    mapRun(r, normalizedRegion, seasonSlug, "highest_level"),
  );

  const allRuns = [...recentRuns, ...bestRuns, ...highestLevelRuns];
  const representedRunCount = allRuns.length;
  const runHistoryIncomplete = representedRunCount > 0 && allRuns.some((r) => !r.rosterComplete);
  const lastCrawledAt = raw.last_crawled_at ?? null;

  return {
    region: normalizedRegion,
    realmSlug,
    normalizedName,
    displayName: raw.name,
    classSlug: raw.class ? slugify(raw.class) : null,
    specSlug: raw.active_spec_name ? slugify(raw.active_spec_name) : null,
    role: mapRole(raw.active_spec_role),
    profileUrl,
    lastCrawledAt,
    crawlStale: isCrawlStale(lastCrawledAt, nowMs),
    gear: mapGear(raw.gear),
    talents: mapTalents(raw.talents),
    currentSeason,
    previousSeason,
    ranks: raw.mythic_plus_ranks ? mapRanks(raw.mythic_plus_ranks) : null,
    recentRuns,
    bestRuns,
    highestLevelRuns,
    raidProgression: mapRaidProgression(raw.raid_progression),
    runHistoryIncomplete,
    representedRunCount,
    attribution: buildAttribution(profileUrl),
  };
}

export function normalizeSeasonCutoffs(
  raw: RawSeasonCutoffsResponse,
  region: RegionCode,
  seasonSlug: string,
): RaiderIoSeasonCutoffs {
  const cutoffs = raw.cutoffs;

  return {
    region: normalizeRegion(region),
    seasonSlug: seasonSlug || null,
    updatedAt: cutoffs?.updatedAt ?? null,
    // Semantic map (do not invert): p999 = 99.9th pct ≈ top 0.1%, etc.
    top0_1Percent: normalizeCutoffThreshold(cutoffs?.p999, "p999", "top_0_1_percent"),
    top1Percent: normalizeCutoffThreshold(cutoffs?.p990, "p990", "top_1_percent"),
    top10Percent: normalizeCutoffThreshold(cutoffs?.p900, "p900", "top_10_percent"),
    top25Percent: normalizeCutoffThreshold(cutoffs?.p750, "p750", "top_25_percent"),
    top40Percent: normalizeCutoffThreshold(cutoffs?.p600, "p600", "top_40_percent"),
    attribution: buildAttribution(),
  };
}

function normalizeCutoffThreshold(
  node: RawCutoffQuantile | undefined,
  quantile: RaiderIoCutoffQuantile,
  label: RaiderIoCutoffLabel,
): RaiderIoCutoffThreshold | null {
  // Current seasons expose top-level `score`; remapped/historical seasons often
  // only expose `all.quantileMinValue` (observed for season-tww-3 / isRemappedSeason).
  const scoreCandidate =
    node?.score !== undefined && Number.isFinite(node.score)
      ? node.score
      : node?.all?.quantileMinValue !== undefined && Number.isFinite(node.all.quantileMinValue)
        ? node.all.quantileMinValue
        : undefined;
  if (scoreCandidate === undefined) return null;
  const all = node?.all;
  const quantilePopulationCount =
    all?.quantilePopulationCount !== undefined && Number.isFinite(all.quantilePopulationCount)
      ? all.quantilePopulationCount
      : null;
  const totalPopulationCount =
    all?.totalPopulationCount !== undefined && Number.isFinite(all.totalPopulationCount)
      ? all.totalPopulationCount
      : null;
  return {
    score: scoreCandidate,
    quantile,
    label,
    quantilePopulationCount,
    totalPopulationCount,
  };
}

/** True when at least one recognized regional percentile threshold is present. */
export function seasonCutoffsHaveAnyThreshold(data: RaiderIoSeasonCutoffs): boolean {
  return Boolean(
    data.top0_1Percent ||
      data.top1Percent ||
      data.top10Percent ||
      data.top25Percent ||
      data.top40Percent,
  );
}

export function unavailableSeasonCutoffs(region: RegionCode, seasonSlug: string): RaiderIoSeasonCutoffs {
  return {
    region: normalizeRegion(region),
    seasonSlug: seasonSlug || null,
    updatedAt: null,
    top0_1Percent: null,
    top1Percent: null,
    top10Percent: null,
    top25Percent: null,
    top40Percent: null,
    attribution: buildAttribution(),
  };
}

export function normalizeStaticData(
  raw: RawStaticDataResponse,
  expansionId: number,
  nowMs = Date.now(),
): RaiderIoStaticData {
  const dungeons: RaiderIoStaticDungeon[] = (raw.dungeons ?? []).map((d) => ({
    slug: d.slug ?? slugify(d.name ?? "unknown"),
    name: d.name ?? d.slug ?? "Unknown",
    shortName: d.short_name ?? d.slug ?? "",
    mapChallengeModeId: d.map_challenge_mode_id ?? d.challenge_mode_id ?? null,
    zoneId: d.zone_id ?? d.id ?? null,
  }));

  const seasons: RaiderIoStaticSeason[] = (raw.seasons ?? []).map((s) => {
    const startsAt = firstTimestamp(s.starts ?? s.starts_at);
    const endsAt = firstTimestamp(s.ends ?? s.ends_at);
    const startMs = startsAt ? Date.parse(startsAt) : Number.NaN;
    const endMs = endsAt ? Date.parse(endsAt) : Number.NaN;
    const isCurrent =
      s.is_current ??
      (!Number.isNaN(startMs) &&
        startMs <= nowMs &&
        (Number.isNaN(endMs) || endMs >= nowMs));

    return {
      slug: s.slug ?? slugify(s.name ?? "unknown"),
      name: s.name ?? s.slug ?? "Unknown",
      startsAt,
      endsAt,
      isCurrent,
      dungeonSlugs: (s.dungeons ?? []).map((d) => d.slug ?? slugify(d.name ?? "")),
    };
  });

  return {
    expansionId,
    seasons,
    dungeons,
    attribution: buildAttribution(),
  };
}

export function extractRegionFromRunDetails(
  raw: RawRunDetailsResponse,
  fallback: RegionCode,
): RegionCode {
  for (const member of raw.roster ?? []) {
    const regionRaw = asString(member.character?.region);
    if (regionRaw) return normalizeRegion(regionRaw);
  }
  return normalizeRegion(fallback);
}

export function normalizeRunDetails(
  raw: RawRunDetailsResponse,
  region: RegionCode,
): RaiderIoRunDetails {
  const normalizedRegion = normalizeRegion(region);
  const timerMs = raw.keystone_time_ms ?? null;
  const timed = timerMs !== null ? (raw.clear_time_ms ?? 0) <= timerMs : false;
  const roster = (raw.roster ?? []).map((m) => mapRosterMember(m, normalizedRegion));
  const profileUrl =
    raw.url ??
    (raw.season && raw.keystone_run_id
      ? `https://raider.io/mythic-plus-runs/${raw.season}/${raw.keystone_run_id}`
      : null);

  return {
    externalRunId: String(raw.keystone_run_id ?? ""),
    seasonSlug: raw.season ?? "current",
    dungeonSlug: slugify(raw.dungeon?.slug ?? raw.dungeon?.short_name ?? raw.dungeon?.name ?? "unknown"),
    dungeonName: raw.dungeon?.name ?? "Unknown",
    keyLevel: raw.mythic_level ?? 0,
    completedAt: raw.completed_at ?? new Date(0).toISOString(),
    durationMs: raw.clear_time_ms ?? 0,
    timerMs,
    timed,
    scoreValue: raw.score ?? null,
    roster,
    profileUrl,
    attribution: buildAttribution(profileUrl),
  };
}

function isLegacyPeriod(value: unknown): value is RawPeriod {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as RawPeriod).id === "number" &&
    typeof (value as RawPeriod).starts_at === "string"
  );
}

function isRegionPeriod(value: unknown): value is RawRegionPeriods {
  return !!value && typeof value === "object" && "current" in (value as object);
}

export function normalizePeriods(rawPeriods: unknown): RaiderIoPeriod[] {
  if (!Array.isArray(rawPeriods)) return [];

  if (rawPeriods.every(isLegacyPeriod)) {
    return rawPeriods.map((p) => ({
      id: p.id,
      seasonSlug: p.season ?? null,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
    }));
  }

  const out: RaiderIoPeriod[] = [];
  for (const entry of rawPeriods) {
    if (!isRegionPeriod(entry)) continue;
    for (const window of [entry.previous, entry.current, entry.next]) {
      if (!window?.period || !window.start || !window.end) continue;
      out.push({
        id: window.period,
        seasonSlug: null,
        startsAt: window.start,
        endsAt: window.end,
      });
    }
  }
  return out;
}

export function extractBoostSupportFacts(profile: RaiderIoCharacterProfile): RaiderIoBoostSupportFacts {
  const allRuns = [...profile.recentRuns, ...profile.bestRuns, ...profile.highestLevelRuns];
  const teammateCounts = new Map<string, { count: number; scores: number[] }>();
  const targetKey = `${profile.region}:${profile.realmSlug}:${profile.normalizedName}`;

  for (const run of allRuns) {
    for (const teammate of run.roster) {
      if (teammate.providerCharacterKey === targetKey) continue;
      const existing = teammateCounts.get(teammate.providerCharacterKey) ?? { count: 0, scores: [] };
      existing.count += 1;
      if (teammate.mythicRating !== null) existing.scores.push(teammate.mythicRating);
      teammateCounts.set(teammate.providerCharacterKey, existing);
    }
  }

  return {
    targetCharacterKey: targetKey,
    snapshotAt: profile.lastCrawledAt ?? new Date().toISOString(),
    currentSeasonScore: profile.currentSeason?.scores.all ?? null,
    previousSeasonScore: profile.previousSeason?.scores.all ?? null,
    currentRanks: profile.ranks,
    runs: allRuns.map((run) => ({
      externalRunId: run.externalRunId,
      completedAt: run.completedAt,
      dungeonSlug: run.dungeonSlug,
      keyLevel: run.keyLevel,
      durationMs: run.durationMs,
      timed: run.timed,
      scoreValue: run.scoreValue,
      source: run.source,
      teammates: run.roster.filter((m) => m.providerCharacterKey !== targetKey),
    })),
    teammateRecurrence: [...teammateCounts.entries()].map(([key, data]) => ({
      providerCharacterKey: key,
      sharedRunCount: data.count,
      averageTeammateScore:
        data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : null,
    })),
    representedRunCount: profile.representedRunCount,
    historyIncomplete: profile.runHistoryIncomplete,
    attribution: profile.attribution,
  };
}
