/**
 * Shadow Canary discovery — public timed candidates via production WCL path.
 */
import type { EvidenceCandidateMetadataV2, ProviderFetchContext } from "@mplus/contracts";
import {
  ENCOUNTER_DUNGEON_MAP,
  hydrateFightUnknownCandidates,
  MAX_COVERAGE_AWARE_HYDRATION_REPORTS,
  OPERATIONS,
  planCandidateDiscovery,
  resolveMplusZoneConfig,
  slugifyDungeonName,
  toCandidateMetadataV2,
  type DiscoverySourceRow,
  type HydrationCoverageDiagnostics,
  type RankingParseEvidenceV2,
} from "@mplus/provider-warcraftlogs";
import { resolveActiveSeasonDungeonPool } from "@mplus/scoring";
import type { WorkerContainer } from "../../../container.js";

export interface ShadowCanaryDiscoveryResult {
  seasonId: string;
  seasonSlug: string;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  /** Ranking/parse rows from zone rankings discovery — not capability event pages. */
  rankingEvidence: RankingParseEvidenceV2[];
  scoreModelId: string;
  highKeyPolicyId: string;
  diagnostics: {
    discoveredCandidateCount: number;
    privateOrHiddenExclusions: number;
    untimedExclusions: number;
    timedUnknownExclusions: number;
    inaccessibleExclusions: number;
    dungeonPoolSource: string;
    providerCalls: number;
    hydration: HydrationCoverageDiagnostics | null;
    reportsListed: number;
    reportsHydrated: number;
    unhydratedReportCount: number;
    omittedReports: Array<{
      reportCode: string;
      reason: string;
      dungeonSlug: string | null;
    }>;
  };
}

export async function discoverShadowCanaryCandidates(input: {
  container: WorkerContainer;
  region: "EU" | "US" | "KR" | "TW";
  realmSlug: string;
  characterName: string;
  characterId: string;
}): Promise<ShadowCanaryDiscoveryResult> {
  const season = await input.container.prisma.season.findFirst({
    where: { isCurrent: true },
    orderBy: { createdAt: "desc" },
  });
  if (!season) {
    throw new Error("shadow_canary_season_required");
  }

  const activeModel = await input.container.repositories.score.getActiveModel();
  if (!activeModel) {
    throw new Error("shadow_canary_score_model_required");
  }

  const wcl = input.container.providers.warcraftlogs as {
    discoverCharacter?: (
      identity: { region: string; realmSlug: string; name: string },
      ctx: ProviderFetchContext,
    ) => Promise<{
      candidates: Array<Record<string, unknown>>;
      rankings?: Array<Record<string, unknown>>;
    }>;
    getGraphQlClient?: () => {
      requestPermissive: <T>(args: {
        operationName: string;
        query: string;
        variables: Record<string, unknown>;
        region: string;
      }) => Promise<{ response: { data?: T }; costUnits?: number }>;
    };
  };

  if (typeof wcl.discoverCharacter !== "function") {
    throw new Error("shadow_canary_wcl_discover_unavailable");
  }

  let providerCalls = 0;
  const zoneConfig = resolveMplusZoneConfig({
    env: process.env,
    allowFixtureDefault: input.container.env.APP_ENV === "test",
  });

  let zoneDungeonSlugs: string[] = [];
  const liveEncounterSlugById = new Map<number, string>();
  if (typeof wcl.getGraphQlClient === "function") {
    const client = wcl.getGraphQlClient();
    const zoneResult = await client.requestPermissive<{
      worldData?: {
        zone?: {
          id: number;
          name: string;
          encounters?: Array<{ id: number; name?: string | null }> | null;
        } | null;
      };
    }>({
      operationName: OPERATIONS.WorldDataZone.operationName,
      query: OPERATIONS.WorldDataZone.query,
      variables: { id: zoneConfig.zoneId },
      region: input.region,
    });
    providerCalls += 1;
    const encounters = zoneResult.response.data?.worldData?.zone?.encounters ?? [];
    for (const e of encounters) {
      const slug =
        ENCOUNTER_DUNGEON_MAP[e.id] ?? (e.name ? slugifyDungeonName(e.name) : null);
      if (slug) liveEncounterSlugById.set(e.id, slug);
    }
    zoneDungeonSlugs = [...new Set(liveEncounterSlugById.values())].sort();
  }

  const dungeonPool = resolveActiveSeasonDungeonPool({
    expectedDungeonCount: Math.max(1, zoneDungeonSlugs.length),
    blizzardSeasonDungeonSlugs: zoneDungeonSlugs,
    wclDungeonSlugs: zoneDungeonSlugs,
  });
  const activeDungeonSlugs = dungeonPool.canonicalSlugs;
  const activeDungeonSet = new Set(activeDungeonSlugs.map((s) => s.trim().toLowerCase()));

  const ctx: ProviderFetchContext = {
    region: input.region,
    requestId: `shadow-canary-discover-${input.characterId}`,
    correlationId: `shadow-canary-${input.characterId}`,
    forceRefresh: false,
    now: new Date().toISOString(),
  };

  const discovery = await wcl.discoverCharacter(
    {
      region: input.region,
      realmSlug: input.realmSlug,
      name: input.characterName,
    },
    ctx,
  );
  providerCalls += 5;

  const rankingEvidenceFromDiscovery: RankingParseEvidenceV2[] = [];
  for (const raw of discovery.rankings ?? []) {
    const reportCode =
      typeof raw.reportCode === "string"
        ? raw.reportCode
        : typeof (raw as { report?: { code?: string } }).report?.code === "string"
          ? (raw as { report: { code: string } }).report.code
          : null;
    const fightId = Number(
      raw.fightId ?? (raw as { fightID?: number }).fightID ?? 0,
    );
    if (!reportCode || !Number.isFinite(fightId) || fightId <= 0) continue;
    const encounterId = Number(
      raw.encounterId ?? (raw as { encounterID?: number }).encounterID ?? 0,
    );
    const dungeonSlug =
      (typeof raw.dungeonSlug === "string" ? raw.dungeonSlug.toLowerCase() : null) ??
      (Number.isFinite(encounterId) && encounterId > 0
        ? liveEncounterSlugById.get(encounterId) ??
          ENCOUNTER_DUNGEON_MAP[encounterId] ??
          null
        : null);
    if (!dungeonSlug || !activeDungeonSet.has(dungeonSlug)) continue;
    const keyLevel = Number(
      raw.keyLevel ?? raw.bracket ?? (raw as { bracket?: number }).bracket ?? 0,
    );
    if (!Number.isFinite(keyLevel) || keyLevel <= 0) continue;
    rankingEvidenceFromDiscovery.push({
      reportCode,
      fightId,
      reportRevision:
        typeof raw.reportRevision === "number" ? raw.reportRevision : 1,
      dungeonSlug,
      keyLevel,
      bracketPercent:
        typeof raw.bracketPercent === "number" ? raw.bracketPercent : null,
      rankPercent:
        typeof raw.rankPercent === "number"
          ? raw.rankPercent
          : typeof raw.percentile === "number"
            ? raw.percentile
            : null,
      amountPercent: null,
      amount: typeof raw.amount === "number" ? raw.amount : null,
      partition: typeof raw.partition === "number" ? raw.partition : null,
    });
  }

  let hydratedCandidates = discovery.candidates;
  let hydrationDiagnostics: HydrationCoverageDiagnostics | null = null;
  if (typeof wcl.getGraphQlClient === "function") {
    const client = wcl.getGraphQlClient();
    const hydrationHints = rankingEvidenceFromDiscovery.map((r) => ({
      completedAt: new Date().toISOString(),
      dungeonSlug: r.dungeonSlug,
      keyLevel: r.keyLevel,
      reportCode: r.reportCode,
    }));
    const hydrated = await hydrateFightUnknownCandidates({
      candidates: discovery.candidates as never,
      characterName: input.characterName,
      realmSlug: input.realmSlug,
      hints: hydrationHints,
      activeDungeonSlugs,
      maxReports: MAX_COVERAGE_AWARE_HYDRATION_REPORTS,
      fetchReport: async (code: string) => {
        // Count before the call so thrown/network failures match reportFetchAttempts.
        providerCalls += 1;
        const reportResult = await client.requestPermissive<{
          reportData?: {
            report?: Record<string, unknown> | null;
          };
        }>({
          operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
          query: OPERATIONS.ReportWithFightAndMasterData.query,
          variables: { code },
          region: input.region,
        });
        return (reportResult.response.data?.reportData?.report ?? null) as never;
      },
    });
    hydratedCandidates = hydrated.candidates as unknown as Array<Record<string, unknown>>;
    hydrationDiagnostics = hydrated.diagnostics;
  }

  const sourceRows: DiscoverySourceRow[] = [];
  for (const raw of hydratedCandidates) {
    const fightId = Number(raw.fightId ?? 0);
    if (!Number.isFinite(fightId) || fightId <= 0) continue;
    const incompleteness = raw.incompleteness as { fightUnknown?: boolean } | undefined;
    if (incompleteness?.fightUnknown) continue;

    const dungeonSlugRaw =
      typeof raw.dungeonSlug === "string"
        ? raw.dungeonSlug.toLowerCase()
        : typeof raw.encounterId === "number"
          ? liveEncounterSlugById.get(raw.encounterId) ??
            ENCOUNTER_DUNGEON_MAP[raw.encounterId] ??
            null
          : null;
    const dungeonSlug = dungeonSlugRaw?.trim().toLowerCase() ?? null;
    if (!dungeonSlug || !activeDungeonSet.has(dungeonSlug)) continue;
    const keyLevel = typeof raw.keyLevel === "number" ? raw.keyLevel : null;
    if (keyLevel == null || keyLevel <= 0) continue;

    const visibilityRaw =
      typeof raw.visibility === "string" ? raw.visibility.toLowerCase() : "public";
    const visibility =
      visibilityRaw === "private" || visibilityRaw === "hidden" || visibilityRaw === "unknown"
        ? visibilityRaw
        : "public";

    sourceRows.push({
      reportCode: String(raw.reportCode ?? ""),
      fightId,
      dungeonSlug,
      keyLevel,
      timed: typeof raw.timed === "boolean" ? raw.timed : null,
      runScore: typeof raw.runScore === "number" ? raw.runScore : typeof raw.score === "number" ? raw.score : null,
      completedAt:
        typeof raw.completedAt === "string"
          ? raw.completedAt
          : typeof raw.startTime === "number"
            ? new Date(raw.startTime).toISOString()
            : null,
      fightDurationMs: typeof raw.durationMs === "number" ? raw.durationMs : null,
      actorId:
        typeof raw.targetActorId === "number"
          ? raw.targetActorId
          : typeof raw.actorId === "number"
            ? raw.actorId
            : null,
      reportRevision: typeof raw.reportRevision === "number" ? raw.reportRevision : null,
      source: "zone_rankings",
      visibility,
      fightAccessible: visibility === "public",
      hardError: false,
      identityResolution: "RESOLVED",
    });
  }

  const planned = planCandidateDiscovery({
    zoneRankingCandidates: sourceRows,
    activeDungeonSlugs,
  });

  const candidates: EvidenceCandidateMetadataV2[] = [];
  for (const plannedCandidate of planned.candidates) {
    const dungeonSlug = plannedCandidate.dungeonSlug?.trim().toLowerCase() ?? null;
    if (dungeonSlug == null || plannedCandidate.keyLevel == null || plannedCandidate.keyLevel <= 0) {
      continue;
    }
    if (!activeDungeonSet.has(dungeonSlug)) continue;
    try {
      candidates.push(
        toCandidateMetadataV2(plannedCandidate, {
          dungeonSlug,
          keyLevel: plannedCandidate.keyLevel,
        }),
      );
    } catch {
      // skip incomplete
    }
  }

  let privateOrHiddenExclusions = 0;
  let untimedExclusions = 0;
  let timedUnknownExclusions = 0;
  let inaccessibleExclusions = 0;
  // Timer counters are diagnostic state counts — timed===null is NOT a plan exclusion.
  for (const row of sourceRows) {
    if (row.visibility === "private" || row.visibility === "hidden") {
      privateOrHiddenExclusions += 1;
    } else if (row.timed === false) {
      untimedExclusions += 1;
    } else if (row.timed == null) {
      timedUnknownExclusions += 1;
    } else if (row.fightAccessible === false) {
      inaccessibleExclusions += 1;
    }
  }

  // Prefer ranking rows tied to selected candidate fights; fall back to discovery rankings.
  const rankingByFight = new Map(
    rankingEvidenceFromDiscovery.map((r) => [`${r.reportCode}:${r.fightId}`, r]),
  );
  const rankingEvidence: RankingParseEvidenceV2[] = [];
  const seenRanking = new Set<string>();
  for (const c of candidates) {
    const key = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
    if (seenRanking.has(key)) continue;
    seenRanking.add(key);
    const fromDiscovery = rankingByFight.get(key);
    if (fromDiscovery) {
      rankingEvidence.push({
        ...fromDiscovery,
        reportRevision: c.reportRevision ?? fromDiscovery.reportRevision,
        dungeonSlug: c.dungeonSlug,
        keyLevel: c.keyLevel,
      });
    }
  }

  return {
    seasonId: season.id,
    seasonSlug: season.slug,
    activeDungeonSlugs,
    candidates,
    rankingEvidence,
    scoreModelId: activeModel.id,
    highKeyPolicyId: "shadow-canary-v1",
    diagnostics: {
      discoveredCandidateCount: sourceRows.length,
      privateOrHiddenExclusions,
      untimedExclusions,
      timedUnknownExclusions,
      inaccessibleExclusions,
      dungeonPoolSource: dungeonPool.source,
      providerCalls,
      hydration: hydrationDiagnostics,
      reportsListed: hydrationDiagnostics?.recentReportsDiscovered ?? 0,
      reportsHydrated: hydrationDiagnostics?.reportsHydrated ?? 0,
      unhydratedReportCount: hydrationDiagnostics?.reportsLeftUnhydratedBudget ?? 0,
      omittedReports: (hydrationDiagnostics?.omittedReports ?? []).map((o) => ({
        reportCode: o.reportCode,
        reason: o.reason,
        dungeonSlug: o.dungeonSlug,
      })),
    },
  };
}
