/**
 * DB-only Experience V3 history loader for Scoring V2 finalization.
 *
 * Reads persisted MythicRun / CharacterProviderState / ExternalPayload only.
 * Never calls providers, queues, or refresh pipelines. No Warcraft Logs dependency.
 */

import { createHash } from "node:crypto";
import type { CharacterSeasonEvidenceManifestV2, RaiderIoCharacterProfile } from "@mplus/contracts";
import { buildRequestFingerprint } from "@mplus/domain";
import type { PrismaClient, ProviderLifecycleState } from "@mplus/database";
import {
  RAIDERIO_SCHEMA_VERSION,
  buildMinimalCharacterFields,
} from "@mplus/provider-raiderio";
import {
  createHistoricalRankPolicyV3,
  createPreviousSeasonPolicyV3,
  mergePriorSeasonCount,
  resolveExperienceProvenance,
  resolvePriorSeasonSourceDepth,
  selectScoringRuns,
  type ExperienceHistoryInputs,
  type ExperienceV3CurrentExposureFact,
  type ExperienceV3EliteHistoryFact,
  type ExperienceV3HistoricalRankFact,
  type ExperienceV3PreviousSeasonFact,
} from "@mplus/scoring";

/** Must match RAIDERIO_ENDPOINTS.characterProfile (fingerprint identity). */
const RAIDERIO_CHARACTER_PROFILE_ENDPOINT = "characters.profile";
/** Stable MANUAL previous-season normalization thresholds (platform seed; not live cutoffs). */
export const EXPERIENCE_V3_PREVIOUS_SEASON_DEFAULT_K = {
  k50: 2000,
  k90: 2800,
  k99: 3200,
  confidence: 0.7,
} as const;

export interface PersistedProviderStateView {
  provider: "blizzard" | "raiderio" | "warcraftlogs";
  state: ProviderLifecycleState;
  lastSuccessAt: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  detail: string | null;
}

export interface PersistedRunView {
  seasonId: string;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: string;
  durationMs: number | null;
  scoreValue: number | null;
  canonicalFingerprint: string;
  timed: boolean | null;
}

export interface PersistedRioProfileView {
  contentHash: string;
  fetchedAt: string;
  profile: RaiderIoCharacterProfile;
  stale: boolean;
}

export interface PersistedExperienceEvidenceSnapshot {
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  regionCode: string;
  realmSlug: string;
  displayName: string;
  normalizedName: string;
  expectedDungeonCount: number;
  evidenceCutoffAt: string;
  /** Prior season row when known (same region, most recent before current). */
  previousSeasonId: string | null;
  previousSeasonSlug: string | null;
  providerStates: PersistedProviderStateView[];
  currentSeasonRuns: PersistedRunView[];
  /** Distinct prior season ids with local target runs. */
  localPriorSeasonIds: string[];
  /** Optional persisted Raider.IO character profile payload (normalized). */
  rioProfile: PersistedRioProfileView | null;
  allowedDungeonSlugs: string[];
}

export interface ExperienceHistoryLoadSuccess {
  ok: true;
  history: ExperienceHistoryInputs;
  evidenceRevision: string;
  limitations: string[];
  sourceStatuses: Record<string, string>;
}

export interface ExperienceHistoryLoadFailure {
  ok: false;
  reason: string;
  limitations: string[];
}

export type ExperienceHistoryLoadResult =
  | ExperienceHistoryLoadSuccess
  | ExperienceHistoryLoadFailure;

function isProviderSuccess(state: ProviderLifecycleState): boolean {
  return state === "OK" || state === "STALE";
}

function isProviderFailure(state: ProviderLifecycleState): boolean {
  return (
    state === "UNAVAILABLE" ||
    state === "RATE_LIMITED" ||
    state === "PRIVATE_OR_HIDDEN" ||
    state === "NOT_FOUND"
  );
}

function maxIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (best == null || v > best) best = v;
  }
  return best;
}

function isStaleRelativeToCutoff(input: {
  fetchedAt: string | null;
  expiresAt: string | null;
  state: ProviderLifecycleState | null;
  evidenceCutoffAt: string;
}): boolean {
  if (input.state === "STALE") return true;
  if (input.expiresAt && input.expiresAt < input.evidenceCutoffAt) return true;
  if (input.fetchedAt && input.fetchedAt > input.evidenceCutoffAt) {
    // Fetched after cutoff is still usable; not stale by cutoff.
    return false;
  }
  return false;
}

function raiderIoProfileFingerprints(input: {
  regionCode: string;
  realmSlug: string;
  displayName: string;
  normalizedName: string;
}): string[] {
  const fields = buildMinimalCharacterFields();
  const region = input.regionCode.toUpperCase();
  const regionQuery = region.toLowerCase();
  const names = [...new Set([input.displayName, input.normalizedName].filter((n) => n.length > 0))];
  return names.map((name) =>
    buildRequestFingerprint({
      provider: "raiderio",
      region,
      endpointKey: RAIDERIO_CHARACTER_PROFILE_ENDPOINT,
      pathParams: {},
      queryParams: {
        region: regionQuery,
        realm: input.realmSlug,
        name,
        fields,
        schemaVersion: RAIDERIO_SCHEMA_VERSION,
      },
    }),
  );
}

function asRioProfile(payload: unknown): RaiderIoCharacterProfile | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as Partial<RaiderIoCharacterProfile>;
  if (typeof row.normalizedName !== "string" || typeof row.realmSlug !== "string") return null;
  return row as RaiderIoCharacterProfile;
}

/**
 * Pure builder — maps a frozen persisted evidence snapshot into ExperienceHistoryInputs.
 * Deterministic for identical snapshots (no wall-clock).
 */
export function buildExperienceHistoryFromPersistedEvidence(
  snapshot: PersistedExperienceEvidenceSnapshot,
): ExperienceHistoryLoadResult {
  const limitations: string[] = [];
  const sourceStatuses: Record<string, string> = {};

  const blizzard = snapshot.providerStates.find((p) => p.provider === "blizzard") ?? null;
  const raiderio = snapshot.providerStates.find((p) => p.provider === "raiderio") ?? null;

  const blizzardOk = blizzard != null && isProviderSuccess(blizzard.state);
  const raiderIoOk = raiderio != null && isProviderSuccess(raiderio.state);
  const blizzardFailed = blizzard != null && isProviderFailure(blizzard.state);
  const raiderIoFailed = raiderio != null && isProviderFailure(raiderio.state);
  const blizzardQueried = blizzard != null;
  const raiderIoQueried = raiderio != null;

  sourceStatuses.blizzard = blizzard?.state ?? "NOT_QUERIED";
  sourceStatuses.raiderio = raiderio?.state ?? "NOT_QUERIED";

  if (!blizzardQueried) limitations.push("blizzard_provider_state_absent");
  if (!raiderIoQueried) limitations.push("raiderio_provider_state_absent");

  const blizzardStale =
    blizzard != null &&
    isStaleRelativeToCutoff({
      fetchedAt: blizzard.fetchedAt,
      expiresAt: blizzard.expiresAt,
      state: blizzard.state,
      evidenceCutoffAt: snapshot.evidenceCutoffAt,
    });
  const rioStale =
    (raiderio != null &&
      isStaleRelativeToCutoff({
        fetchedAt: raiderio.fetchedAt,
        expiresAt: raiderio.expiresAt,
        state: raiderio.state,
        evidenceCutoffAt: snapshot.evidenceCutoffAt,
      })) ||
    Boolean(snapshot.rioProfile?.stale);

  if (blizzardStale) {
    limitations.push("blizzard_evidence_stale");
    sourceStatuses.blizzardFreshness = "STALE";
  } else if (blizzardOk) {
    sourceStatuses.blizzardFreshness = "FRESH";
  }
  if (rioStale) {
    limitations.push("raiderio_evidence_stale");
    sourceStatuses.raiderioFreshness = "STALE";
  } else if (raiderIoOk) {
    sourceStatuses.raiderioFreshness = "FRESH";
  }

  // Wrong-season guard: only current-season runs enter exposure.
  const seasonRuns = snapshot.currentSeasonRuns
    .filter((r) => r.seasonId === snapshot.seasonId)
    .map((r) => ({
      dungeonSlug: r.dungeonSlug,
      keyLevel: r.keyLevel,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      scoreValue: r.scoreValue,
      canonicalFingerprint: r.canonicalFingerprint,
      timed: r.timed,
    }))
    .sort((a, b) =>
      `${a.dungeonSlug}:${a.keyLevel}:${a.completedAt}`.localeCompare(
        `${b.dungeonSlug}:${b.keyLevel}:${b.completedAt}`,
      ),
    );

  const ignoredWrongSeason = snapshot.currentSeasonRuns.length - seasonRuns.length;
  if (ignoredWrongSeason > 0) {
    limitations.push("wrong_season_runs_ignored");
  }

  const selection = selectScoringRuns(
    seasonRuns.map((r) => ({
      canonicalRunId: r.canonicalFingerprint,
      dungeonSlug: r.dungeonSlug,
      keyLevel: r.keyLevel,
      timed: r.timed,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      scoreValue: r.scoreValue,
      hasWclSource: false,
    })),
    {
      seasonSlug: snapshot.seasonSlug,
      expectedDungeonCount: snapshot.expectedDungeonCount,
      allowedDungeonSlugs:
        snapshot.allowedDungeonSlugs.length > 0 ? snapshot.allowedDungeonSlugs : undefined,
    },
  );

  const selectedRuns = selection.selectedRuns.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    keyLevel: r.keyLevel,
    completedAt: r.completedAt,
  }));
  const exposureSeasonRuns = seasonRuns.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    keyLevel: r.keyLevel,
    completedAt: r.completedAt,
  }));

  const rioPrior =
    snapshot.rioProfile?.profile.previousSeason != null &&
    snapshot.rioProfile.profile.previousSeason.seasonSlug !== snapshot.seasonSlug
      ? 1
      : 0;
  if (
    snapshot.rioProfile?.profile.previousSeason != null &&
    snapshot.rioProfile.profile.previousSeason.seasonSlug === snapshot.seasonSlug
  ) {
    limitations.push("rio_previous_season_matches_current_ignored");
  }

  const localPrior = snapshot.localPriorSeasonIds.filter((id) => id !== snapshot.seasonId).length;
  const priorSeasonCount = mergePriorSeasonCount(rioPrior, localPrior);
  const priorSeasonSourceDepth = resolvePriorSeasonSourceDepth({
    rioPriorSeasonCount: rioPrior,
    localPriorSeasonCount: localPrior,
  });

  const hasHistorySignal =
    selectedRuns.length > 0 || exposureSeasonRuns.length > 0 || priorSeasonCount > 0;

  // Missing provider-state rows are "not queried" — not automatic inactivity.
  let provenance: ExperienceV3CurrentExposureFact["provenance"];
  if (!blizzardQueried && !raiderIoQueried) {
    // Local runs alone can still prove HAS_HISTORY without provider rows.
    provenance = hasHistorySignal ? "PARTIAL_SOURCES" : "PROVIDER_FAILURE";
    if (!hasHistorySignal) limitations.push("provider_states_absent_no_history");
  } else if (blizzardFailed && raiderIoFailed && !hasHistorySignal) {
    provenance = "PROVIDER_FAILURE";
    limitations.push("provider_failure_no_confirmed_activity");
  } else {
    provenance = resolveExperienceProvenance({
      blizzardOk: blizzardOk || (!blizzardQueried && hasHistorySignal),
      raiderIoOk: raiderIoOk || (!raiderIoQueried && hasHistorySignal),
      hasAnyHistorySignal: hasHistorySignal,
    });
    // Confirmed absence only when at least one history provider succeeded with empty activity.
    if (
      provenance === "CONFIRMED_ABSENCE" &&
      !(blizzardOk || raiderIoOk)
    ) {
      provenance = "PROVIDER_FAILURE";
      limitations.push("inactivity_requires_successful_provider_query");
    }
  }

  if (blizzardStale || rioStale) {
    if (provenance === "HAS_HISTORY") provenance = "PARTIAL_SOURCES";
    else if (provenance === "CONFIRMED_ABSENCE") provenance = "PARTIAL_SOURCES";
  }

  const observedAt =
    maxIso(
      blizzard?.fetchedAt,
      blizzard?.lastSuccessAt,
      raiderio?.fetchedAt,
      raiderio?.lastSuccessAt,
      snapshot.rioProfile?.fetchedAt,
      seasonRuns[0]?.completedAt,
      snapshot.evidenceCutoffAt,
    ) ?? snapshot.evidenceCutoffAt;

  const currentExposure: ExperienceV3CurrentExposureFact = {
    expectedDungeonCount: snapshot.expectedDungeonCount,
    selectedRuns,
    seasonRuns: exposureSeasonRuns,
    priorSeasonCount,
    priorSeasonSourceDepth,
    provenance,
    observedAt,
  };

  const previousSeason = buildPreviousSeasonFact(snapshot, {
    raiderIoOk,
    raiderIoFailed,
    raiderIoQueried,
    limitations,
  });

  const eliteHistory: ExperienceV3EliteHistoryFact = {
    evidenceState: "UNKNOWN",
    achievements: [],
  };
  limitations.push("elite_achievements_not_persisted");

  const historicalRank = buildHistoricalRankFact(snapshot, limitations);

  const previousSeasonPolicy = createPreviousSeasonPolicyV3({
    seasonId:
      previousSeason.seasonId ??
      snapshot.previousSeasonId ??
      `unknown-prev-${snapshot.seasonSlug}`,
    seasonSlug:
      previousSeason.seasonSlug ??
      snapshot.previousSeasonSlug ??
      "previous-season-unknown",
    region: snapshot.regionCode.toLowerCase(),
    k50: EXPERIENCE_V3_PREVIOUS_SEASON_DEFAULT_K.k50,
    k90: EXPERIENCE_V3_PREVIOUS_SEASON_DEFAULT_K.k90,
    k99: EXPERIENCE_V3_PREVIOUS_SEASON_DEFAULT_K.k99,
    source: previousSeason.source === "RAIDER_IO" ? "RAIDER_IO" : "MANUAL",
    confidence: EXPERIENCE_V3_PREVIOUS_SEASON_DEFAULT_K.confidence,
  });

  const historicalRankPolicy = createHistoricalRankPolicyV3({
    confidence: 0.65,
  });

  const history: ExperienceHistoryInputs = {
    currentExposure,
    previousSeason,
    previousSeasonPolicy,
    eliteHistory,
    historicalRank,
    historicalRankPolicy,
  };

  const evidenceRevision = buildEvidenceRevision({
    characterId: snapshot.characterId,
    seasonId: snapshot.seasonId,
    evidenceCutoffAt: snapshot.evidenceCutoffAt,
    blizzardFetchedAt: blizzard?.fetchedAt ?? null,
    raiderIoFetchedAt: raiderio?.fetchedAt ?? null,
    rioContentHash: snapshot.rioProfile?.contentHash ?? null,
    runFingerprints: seasonRuns.map((r) => r.canonicalFingerprint),
    provenance,
    previousSeasonState: previousSeason.evidenceState,
    previousSeasonScore: previousSeason.score,
  });

  sourceStatuses.noWarcraftLogs = "true";
  sourceStatuses.evidenceRevision = evidenceRevision;

  return {
    ok: true,
    history,
    evidenceRevision,
    limitations: [...new Set(limitations)].slice(0, 32),
    sourceStatuses,
  };
}

function buildPreviousSeasonFact(
  snapshot: PersistedExperienceEvidenceSnapshot,
  ctx: {
    raiderIoOk: boolean;
    raiderIoFailed: boolean;
    raiderIoQueried: boolean;
    limitations: string[];
  },
): ExperienceV3PreviousSeasonFact {
  const profile = snapshot.rioProfile?.profile ?? null;
  const prev = profile?.previousSeason ?? null;

  if (ctx.raiderIoFailed) {
    ctx.limitations.push("previous_season_provider_failure");
    return {
      evidenceState: "PROVIDER_FAILURE",
      score: null,
      seasonId: snapshot.previousSeasonId,
      seasonSlug: snapshot.previousSeasonSlug,
      source: "RAIDER_IO",
      sourceConfidence: 0,
      fetchedAt: snapshot.rioProfile?.fetchedAt ?? null,
    };
  }

  if (!ctx.raiderIoQueried) {
    ctx.limitations.push("previous_season_source_not_queried");
    return {
      evidenceState: "UNKNOWN",
      score: null,
      seasonId: snapshot.previousSeasonId,
      seasonSlug: snapshot.previousSeasonSlug,
      source: "UNKNOWN",
      sourceConfidence: 0,
      fetchedAt: null,
    };
  }

  if (ctx.raiderIoOk && snapshot.rioProfile == null) {
    // Successful sync recorded, but profile payload not recoverable → not inactivity.
    ctx.limitations.push("previous_season_payload_absent");
    return {
      evidenceState: "UNKNOWN",
      score: null,
      seasonId: snapshot.previousSeasonId,
      seasonSlug: snapshot.previousSeasonSlug,
      source: "RAIDER_IO",
      sourceConfidence: 0.2,
      fetchedAt: null,
    };
  }

  if (prev != null && prev.seasonSlug === snapshot.seasonSlug) {
    ctx.limitations.push("previous_season_incompatible_slug");
    return {
      evidenceState: "UNKNOWN",
      score: null,
      seasonId: snapshot.previousSeasonId,
      seasonSlug: snapshot.previousSeasonSlug,
      source: "RAIDER_IO",
      sourceConfidence: 0.2,
      fetchedAt: snapshot.rioProfile?.fetchedAt ?? null,
    };
  }

  if (prev != null && Number.isFinite(prev.scores.all)) {
    return {
      evidenceState: "HAS_VALUE",
      score: prev.scores.all,
      seasonId: snapshot.previousSeasonId,
      seasonSlug: prev.seasonSlug,
      source: "RAIDER_IO",
      sourceConfidence: snapshot.rioProfile?.stale ? 0.45 : 0.85,
      fetchedAt: snapshot.rioProfile?.fetchedAt ?? null,
    };
  }

  // Successful RIO profile with explicit null previous season → confirmed inactivity.
  if (ctx.raiderIoOk && snapshot.rioProfile != null && prev == null) {
    return {
      evidenceState: "CONFIRMED_NO_ACTIVITY",
      score: null,
      seasonId: snapshot.previousSeasonId,
      seasonSlug: snapshot.previousSeasonSlug,
      source: "RAIDER_IO",
      sourceConfidence: 0.85,
      fetchedAt: snapshot.rioProfile.fetchedAt,
    };
  }

  ctx.limitations.push("previous_season_unknown");
  return {
    evidenceState: "UNKNOWN",
    score: null,
    seasonId: snapshot.previousSeasonId,
    seasonSlug: snapshot.previousSeasonSlug,
    source: "UNKNOWN",
    sourceConfidence: 0,
    fetchedAt: null,
  };
}

function buildHistoricalRankFact(
  snapshot: PersistedExperienceEvidenceSnapshot,
  limitations: string[],
): ExperienceV3HistoricalRankFact | null {
  const ranks = snapshot.rioProfile?.profile.ranks ?? null;
  if (!snapshot.rioProfile || ranks == null) {
    limitations.push("historical_rank_absent");
    return null;
  }
  const rank = ranks.overall ?? ranks.world ?? ranks.region ?? ranks.class ?? null;
  if (rank == null || !(rank > 0)) {
    limitations.push("historical_rank_unusable");
    return null;
  }
  return {
    evidenceState: "HAS_VALUE",
    source: "RAIDER_IO",
    seasonId: snapshot.seasonId,
    seasonSlug: snapshot.seasonSlug,
    region: snapshot.regionCode,
    classSlug: snapshot.rioProfile.profile.classSlug,
    specSlug: snapshot.rioProfile.profile.specSlug,
    role: snapshot.rioProfile.profile.role,
    rank,
    population: null,
    percentile: null,
    top10ClassSpecRegion: rank <= 10,
    fetchedAt: snapshot.rioProfile.fetchedAt,
    sourceConfidence: snapshot.rioProfile.stale ? 0.4 : 0.7,
  };
}

export function buildEvidenceRevision(parts: {
  characterId: string;
  seasonId: string;
  evidenceCutoffAt: string;
  blizzardFetchedAt: string | null;
  raiderIoFetchedAt: string | null;
  rioContentHash: string | null;
  runFingerprints: string[];
  provenance: string;
  previousSeasonState: string;
  previousSeasonScore: number | null;
}): string {
  const payload = [
    parts.characterId,
    parts.seasonId,
    parts.evidenceCutoffAt,
    parts.blizzardFetchedAt ?? "",
    parts.raiderIoFetchedAt ?? "",
    parts.rioContentHash ?? "",
    [...parts.runFingerprints].sort().join(","),
    parts.provenance,
    parts.previousSeasonState,
    parts.previousSeasonScore == null ? "" : String(parts.previousSeasonScore),
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Load persisted Experience evidence from the database (no provider / refresh / queue).
 */
export async function loadExperienceHistoryFromDb(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
  manifest: CharacterSeasonEvidenceManifestV2;
  findFreshPayloadByFingerprint: (input: {
    requestFingerprint: string;
  }) => Promise<{
    request: { expiresAt: Date | null };
    payload: { contentHash: string; fetchedAt: Date; payload: unknown };
  } | null>;
}): Promise<ExperienceHistoryLoadResult> {
  try {
    const character = await input.prisma.character.findUnique({
      where: { id: input.characterId },
      include: {
        region: { select: { code: true } },
        realm: { select: { slug: true } },
      },
    });
    if (!character) {
      return {
        ok: false,
        reason: "character_not_found",
        limitations: ["character_not_found"],
      };
    }

    const season = await input.prisma.season.findUnique({
      where: { id: input.seasonId },
      include: {
        seasonDungeons: { include: { dungeon: { select: { slug: true } } } },
      },
    });
    if (!season) {
      return {
        ok: false,
        reason: "season_not_found",
        limitations: ["season_not_found"],
      };
    }

    const previousSeason = await input.prisma.season.findFirst({
      where: {
        regionId: character.regionId,
        id: { not: input.seasonId },
        ...(season.startsAt
          ? {
              OR: [
                { endsAt: { lt: season.startsAt } },
                { startsAt: { lt: season.startsAt } },
              ],
            }
          : { isCurrent: false }),
      },
      orderBy: { startsAt: "desc" },
      select: { id: true, slug: true },
    });

    const providerRows = await input.prisma.characterProviderState.findMany({
      where: { characterId: input.characterId },
    });

    const providerStates: PersistedProviderStateView[] = providerRows.map((row) => ({
      provider:
        row.provider === "BLIZZARD"
          ? "blizzard"
          : row.provider === "RAIDER_IO"
            ? "raiderio"
            : "warcraftlogs",
      state: row.state,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      fetchedAt: row.fetchedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      detail: row.detail,
    }));

    const runParticipants = await input.prisma.runParticipant.findMany({
      where: {
        characterId: input.characterId,
        isTargetCharacter: true,
        run: { seasonId: input.seasonId },
      },
      include: {
        run: { include: { dungeon: { select: { slug: true } } } },
      },
      orderBy: [{ run: { completedAt: "desc" } }],
    });

    const currentSeasonRuns: PersistedRunView[] = [];
    const seenRuns = new Set<string>();
    for (const p of runParticipants) {
      if (seenRuns.has(p.run.id)) continue;
      seenRuns.add(p.run.id);
      currentSeasonRuns.push({
        seasonId: p.run.seasonId,
        dungeonSlug: p.run.dungeon.slug,
        keyLevel: p.run.keyLevel,
        completedAt: p.run.completedAt.toISOString(),
        durationMs: p.run.durationMs,
        scoreValue: p.run.scoreValue,
        canonicalFingerprint: p.run.canonicalFingerprint,
        timed: p.run.timed,
      });
    }

    const priorRunSeasons = await input.prisma.mythicRun.findMany({
      where: {
        seasonId: { not: input.seasonId },
        participants: {
          some: { characterId: input.characterId, isTargetCharacter: true },
        },
      },
      distinct: ["seasonId"],
      select: { seasonId: true },
    });

    const fingerprints = raiderIoProfileFingerprints({
      regionCode: character.region.code,
      realmSlug: character.realm.slug,
      displayName: character.displayName,
      normalizedName: character.normalizedName,
    });

    let rioProfile: PersistedRioProfileView | null = null;
    for (const fp of fingerprints) {
      const hit = await input.findFreshPayloadByFingerprint({ requestFingerprint: fp });
      if (!hit) continue;
      const profile = asRioProfile(hit.payload.payload);
      if (!profile) continue;
      const stale =
        (hit.request.expiresAt != null &&
          hit.request.expiresAt.getTime() <= Date.parse(input.manifest.evidenceCutoffAt)) ||
        profile.crawlStale;
      rioProfile = {
        contentHash: hit.payload.contentHash,
        fetchedAt: hit.payload.fetchedAt.toISOString(),
        profile,
        stale,
      };
      break;
    }

    const expectedDungeonCount =
      season.dungeonCount > 0
        ? season.dungeonCount
        : season.seasonDungeons.length > 0
          ? season.seasonDungeons.length
          : Math.max(1, input.manifest.activeDungeonSlugs.length);

    const snapshot: PersistedExperienceEvidenceSnapshot = {
      characterId: input.characterId,
      seasonId: input.seasonId,
      seasonSlug: season.slug,
      regionCode: character.region.code,
      realmSlug: character.realm.slug,
      displayName: character.displayName,
      normalizedName: character.normalizedName,
      expectedDungeonCount,
      evidenceCutoffAt: input.manifest.evidenceCutoffAt,
      previousSeasonId: previousSeason?.id ?? null,
      previousSeasonSlug: previousSeason?.slug ?? null,
      providerStates,
      currentSeasonRuns,
      localPriorSeasonIds: priorRunSeasons.map((r) => r.seasonId),
      rioProfile,
      allowedDungeonSlugs:
        input.manifest.activeDungeonSlugs.length > 0
          ? input.manifest.activeDungeonSlugs
          : season.seasonDungeons.map((d) => d.dungeon.slug),
    };

    return buildExperienceHistoryFromPersistedEvidence(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "experience_history_load_failed";
    return {
      ok: false,
      reason: "loader_exception",
      limitations: ["experience_history_loader_failed", message.slice(0, 120)],
    };
  }
}
