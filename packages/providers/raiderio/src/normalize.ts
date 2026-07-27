import type {
  RaiderIoAttribution,
  RaiderIoBoostSupportFacts,
  RaiderIoCharacterProfile,
  RaiderIoCutoffThreshold,
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
  RegionCode,
} from "@mplus/contracts";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import { RAIDERIO_ATTRIBUTION } from "./constants.js";
import type {
  RawCharacterProfileResponse,
  RawKeystoneRun,
  RawPeriod,
  RawRaidProgressionEntry,
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

function mapRanks(raw: {
  overall?: number;
  class?: number;
  server?: number;
  world?: number;
  region?: number;
  role?: string;
}): RaiderIoRankSummary {
  return {
    overall: raw.overall ?? null,
    class: raw.class ?? null,
    server: raw.server ?? null,
    world: raw.world ?? null,
    region: raw.region ?? null,
    role: raw.role ?? null,
  };
}

function mapRosterMember(member: RawRosterMember, region: RegionCode): RaiderIoRosterMember {
  const character = member.character;
  const realmSlug = normalizeRealmSlug(character.realm);
  const normalizedName = normalizeName(character.name);
  return {
    providerCharacterKey: `${normalizeRegion(character.region || region)}:${realmSlug}:${normalizedName}`,
    displayName: character.name,
    realmSlug,
    region: normalizeRegion(character.region || region),
    classSlug: character.class ? slugify(character.class) : null,
    specSlug: character.active_spec_name ? slugify(character.active_spec_name) : null,
    role: mapRole(member.role ?? character.active_spec_role),
    mythicRating: member.ranks?.overall ?? null,
    rankOverall: member.ranks?.overall ?? null,
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
    dungeonSlug: slugify(run.short_name ?? run.dungeon),
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

export function normalizeCharacterProfile(
  raw: RawCharacterProfileResponse,
  region: RegionCode,
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

  return {
    region: normalizedRegion,
    realmSlug,
    normalizedName,
    displayName: raw.name,
    classSlug: raw.class ? slugify(raw.class) : null,
    specSlug: raw.active_spec_name ? slugify(raw.active_spec_name) : null,
    role: mapRole(raw.active_spec_role),
    profileUrl,
    lastCrawledAt: raw.last_crawled_at ?? null,
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
  const top25Percent: RaiderIoCutoffThreshold | null =
    cutoffs?.p750?.score !== undefined
      ? { score: cutoffs.p750.score, quantile: "p750", label: "top_25_percent" }
      : null;

  return {
    region: normalizeRegion(region),
    seasonSlug: seasonSlug || null,
    updatedAt: cutoffs?.updatedAt ?? null,
    top25Percent,
    attribution: buildAttribution(),
  };
}

export function normalizeStaticData(
  raw: RawStaticDataResponse,
  expansionId: number,
): RaiderIoStaticData {
  const dungeons: RaiderIoStaticDungeon[] = (raw.dungeons ?? []).map((d) => ({
    slug: d.slug ?? slugify(d.name ?? "unknown"),
    name: d.name ?? d.slug ?? "Unknown",
    shortName: d.short_name ?? d.slug ?? "",
    mapChallengeModeId: d.map_challenge_mode_id ?? null,
    zoneId: d.zone_id ?? null,
  }));

  const seasons: RaiderIoStaticSeason[] = (raw.seasons ?? []).map((s) => ({
    slug: s.slug ?? slugify(s.name ?? "unknown"),
    name: s.name ?? s.slug ?? "Unknown",
    startsAt: s.starts_at ?? null,
    endsAt: s.ends_at ?? null,
    isCurrent: s.is_current ?? false,
    dungeonSlugs: (s.dungeons ?? []).map((d) => d.slug ?? slugify(d.name ?? "")),
  }));

  return {
    expansionId,
    seasons,
    dungeons,
    attribution: buildAttribution(),
  };
}

export function normalizeRunDetails(
  raw: RawRunDetailsResponse,
  region: RegionCode,
): RaiderIoRunDetails {
  const normalizedRegion = normalizeRegion(region);
  const timerMs = raw.keystone_time_ms ?? null;
  const timed = timerMs !== null ? (raw.clear_time_ms ?? 0) <= timerMs : false;
  const roster = (raw.roster ?? []).map((m) => mapRosterMember(m, normalizedRegion));

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
    profileUrl: raw.url ?? null,
    attribution: buildAttribution(raw.url),
  };
}

export function normalizePeriods(raw: RawPeriod[]): RaiderIoPeriod[] {
  return raw.map((p) => ({
    id: p.id,
    seasonSlug: p.season ?? null,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
  }));
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
