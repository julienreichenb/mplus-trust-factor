/**
 * Shadow Canary discovery — public timed candidates via encounterRankings only.
 *
 * Cold path:
 *   active season → aliased Character.encounterRankings → timed selection
 * No recentReports listing and no mass report hydration for run discovery.
 */
import type { EvidenceCandidateMetadataV2, ProviderFetchContext } from "@mplus/contracts";
import {
  ENCOUNTER_DUNGEON_MAP,
  OPERATIONS,
  planCandidateDiscovery,
  requireActiveDungeonEncounters,
  resolveMplusZoneConfig,
  slugifyDungeonName,
  timedEligibleCoverageByDungeon,
  toCandidateMetadataV2,
  type DiscoverySourceRow,
  type RankingParseEvidenceV2,
  type WclRunCandidate,
} from "@mplus/provider-warcraftlogs";
import { resolveActiveSeasonDungeonPool } from "@mplus/scoring";
import type { WorkerContainer } from "../../../container.js";
import { canonicalDungeonKey } from "../../run-fusion.js";

/** Ranking evidence may lack reportRevision until selected-fight revision resolve. */
export type ShadowCanaryRankingEvidence = Omit<RankingParseEvidenceV2, "reportRevision"> & {
  reportRevision: number | null;
};

export interface ShadowCanaryDiscoveryResult {
  seasonId: string;
  seasonSlug: string;
  activeDungeonSlugs: string[];
  candidates: EvidenceCandidateMetadataV2[];
  /** Ranking/parse rows from encounter/zone rankings — not capability event pages. */
  rankingEvidence: ShadowCanaryRankingEvidence[];
  scoreModelId: string;
  highKeyPolicyId: string;
  diagnostics: {
    discoveredCandidateCount: number;
    privateOrHiddenExclusions: number;
    untimedExclusions: number;
    timedUnknownExclusions: number;
    inaccessibleExclusions: number;
    dungeonPoolSource: string;
    discoveryStrategy: "encounter_rankings";
    providerCalls: number;
    providerCallBreakdown: {
      zoneCatalog: number;
      characterDiscovery: number;
    };
    candidateNormalization: {
      total: number;
      invalidFightId: number;
      missingDungeonSlug: number;
      dungeonSlugNotInActivePool: number;
      invalidKeyLevel: number;
      visibilityExcluded: number;
      byDungeonSlug: Record<string, number>;
    };
  };
}

async function countCallsDuring<T>(
  client: {
    request: (...args: never[]) => Promise<unknown>;
    requestPermissive?: (...args: never[]) => Promise<unknown>;
  } | null,
  fn: () => Promise<T>,
): Promise<{ value: T; calls: number }> {
  if (!client) {
    return { value: await fn(), calls: 0 };
  }
  let calls = 0;
  const origRequest = client.request.bind(client);
  const origPermissive = client.requestPermissive?.bind(client);
  (client as { request: typeof origRequest }).request = (async (...args: never[]) => {
    calls += 1;
    return origRequest(...args);
  }) as typeof origRequest;
  if (origPermissive && client.requestPermissive) {
    (client as { requestPermissive: typeof origPermissive }).requestPermissive = (async (
      ...args: never[]
    ) => {
      calls += 1;
      return origPermissive(...args);
    }) as typeof origPermissive;
  }
  try {
    return { value: await fn(), calls };
  } finally {
    (client as { request: typeof origRequest }).request = origRequest;
    if (origPermissive) {
      (client as { requestPermissive: typeof origPermissive }).requestPermissive =
        origPermissive;
    }
  }
}

function asWclCandidates(raw: Array<Record<string, unknown>>): WclRunCandidate[] {
  return raw as unknown as WclRunCandidate[];
}

export async function discoverShadowCanaryCandidates(input: {
  container: WorkerContainer;
  region: "EU" | "US" | "KR" | "TW";
  realmSlug: string;
  characterName: string;
  characterId: string;
  /** Prefer season authority from resolveCanarySeasonCatalog / SeasonDungeon. */
  activeDungeonSlugs?: readonly string[];
  activeDungeonEncounters?: ReadonlyArray<{
    dungeonSlug: string;
    encounterId: number | null;
  }>;
  dungeonPoolSource?: string;
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
      request: (...args: never[]) => Promise<unknown>;
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

  const zoneConfig = resolveMplusZoneConfig({
    env: process.env,
    allowFixtureDefault: input.container.env.APP_ENV === "test",
  });

  let zoneCatalogCalls = 0;
  let zoneDungeonSlugs: string[] = [];
  const liveEncounterSlugById = new Map<number, string>();

  // Prefer SeasonDungeon / caller authority for the active pool.
  const seasonDungeonRows =
    (await input.container.prisma.seasonDungeon?.findMany?.({
      where: { seasonId: season.id },
      include: { dungeon: true },
      orderBy: { sortOrder: "asc" },
    })) ?? [];

  const fromSeasonRows = seasonDungeonRows.map(
    (row: {
      dungeon: { slug: string; wclZoneOrEncounterId: bigint | number | null };
    }) => {
      const dungeonSlug = canonicalDungeonKey(row.dungeon.slug);
      const encounterId =
        row.dungeon.wclZoneOrEncounterId != null
          ? Number(row.dungeon.wclZoneOrEncounterId)
          : null;
      return {
        dungeonSlug,
        encounterId:
          encounterId != null && Number.isFinite(encounterId) && encounterId > 0
            ? encounterId
            : null,
      };
    },
  );

  const authorityEncounters =
    input.activeDungeonEncounters?.map((e) => ({
      dungeonSlug: canonicalDungeonKey(e.dungeonSlug),
      encounterId: e.encounterId,
    })) ?? fromSeasonRows;

  let activeDungeonSlugs = (input.activeDungeonSlugs ?? [])
    .map((s) => canonicalDungeonKey(s))
    .filter(Boolean);
  let dungeonPoolSource =
    input.dungeonPoolSource ??
    (fromSeasonRows.length > 0
      ? "season_dungeon_bindings"
      : activeDungeonSlugs.length > 0
        ? "caller_authority"
        : "zone_catalog_fallback");

  if (activeDungeonSlugs.length === 0 && fromSeasonRows.length > 0) {
    activeDungeonSlugs = fromSeasonRows.map((r) => r.dungeonSlug);
    dungeonPoolSource = "season_dungeon_bindings";
  }

  if (
    activeDungeonSlugs.length === 0 &&
    typeof wcl.getGraphQlClient === "function"
  ) {
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
    zoneCatalogCalls += 1;
    const encounters = zoneResult.response.data?.worldData?.zone?.encounters ?? [];
    for (const e of encounters) {
      const slug =
        ENCOUNTER_DUNGEON_MAP[e.id] ?? (e.name ? slugifyDungeonName(e.name) : null);
      if (slug) liveEncounterSlugById.set(e.id, slug);
    }
    zoneDungeonSlugs = [...new Set(liveEncounterSlugById.values())].sort();
    const dungeonPool = resolveActiveSeasonDungeonPool({
      expectedDungeonCount: Math.max(1, zoneDungeonSlugs.length),
      blizzardSeasonDungeonSlugs: zoneDungeonSlugs,
      wclDungeonSlugs: zoneDungeonSlugs,
    });
    activeDungeonSlugs = dungeonPool.canonicalSlugs;
    dungeonPoolSource = dungeonPool.source;
  }

  const activeDungeonSet = new Set(activeDungeonSlugs.map((s) => s.trim().toLowerCase()));

  let encounterBindings: Array<{ dungeonSlug: string; encounterId: number }> = [];
  let encounterBindingsError: string | null = null;
  if (activeDungeonSlugs.length > 0 && authorityEncounters.length > 0) {
    try {
      encounterBindings = requireActiveDungeonEncounters({
        activeDungeonSlugs,
        authoritativeEncounters: authorityEncounters,
      });
    } catch (err) {
      encounterBindingsError = err instanceof Error ? err.message : String(err);
      encounterBindings = [];
    }
  }

  const ctx: ProviderFetchContext = {
    region: input.region,
    requestId: `shadow-canary-discover-${input.characterId}`,
    correlationId: `shadow-canary-${input.characterId}`,
    forceRefresh: false,
    now: new Date().toISOString(),
    wclActiveDungeonSlugs: activeDungeonSlugs,
    ...(encounterBindings.length > 0
      ? { wclActiveDungeonEncounters: encounterBindings }
      : {}),
  };

  const gqlClient =
    typeof wcl.getGraphQlClient === "function" ? wcl.getGraphQlClient() : null;
  const { value: discovery, calls: characterDiscoveryCalls } = await countCallsDuring(
    gqlClient,
    () =>
      wcl.discoverCharacter!(
        {
          region: input.region,
          realmSlug: input.realmSlug,
          name: input.characterName,
        },
        ctx,
      ),
  );

  const rankingEvidenceFromDiscovery: ShadowCanaryRankingEvidence[] = [];
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
      (typeof raw.dungeonSlug === "string"
        ? canonicalDungeonKey(raw.dungeonSlug)
        : null) ??
      (Number.isFinite(encounterId) && encounterId > 0
        ? liveEncounterSlugById.get(encounterId) ??
          ENCOUNTER_DUNGEON_MAP[encounterId] ??
          encounterBindings.find((b) => b.encounterId === encounterId)?.dungeonSlug ??
          null
        : null);
    if (!dungeonSlug || !activeDungeonSet.has(dungeonSlug)) continue;
    const keyLevel = Number(
      raw.keyLevel ?? raw.bracket ?? (raw as { bracket?: number }).bracket ?? 0,
    );
    if (!Number.isFinite(keyLevel) || keyLevel <= 0) continue;
    const revisionRaw =
      typeof raw.reportRevision === "number"
        ? raw.reportRevision
        : typeof (raw as { revision?: number }).revision === "number"
          ? (raw as { revision: number }).revision
          : null;
    rankingEvidenceFromDiscovery.push({
      reportCode,
      fightId,
      // Never invent revision from rankings; selected-fight resolve supplies it.
      reportRevision:
        revisionRaw != null && Number.isFinite(revisionRaw) ? revisionRaw : null,
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

  const rankingCandidates = discovery.candidates;

  const sourceRows: DiscoverySourceRow[] = [];

  const candidateNormalization = {
    total: rankingCandidates.length,
    invalidFightId: 0,
    missingDungeonSlug: 0,
    dungeonSlugNotInActivePool: 0,
    invalidKeyLevel: 0,
    visibilityExcluded: 0,
    byDungeonSlug: {} as Record<string, number>,
  };
  for (const raw of rankingCandidates) {
    const fightId = Number(raw.fightId ?? 0);
    if (!Number.isFinite(fightId) || fightId <= 0) {
      candidateNormalization.invalidFightId += 1;
      continue;
    }

    const dungeonSlugRaw =
      typeof raw.dungeonSlug === "string"
        ? canonicalDungeonKey(raw.dungeonSlug) ?? slugifyDungeonName(raw.dungeonSlug)
        : typeof raw.encounterId === "number"
          ? liveEncounterSlugById.get(raw.encounterId) ??
            ENCOUNTER_DUNGEON_MAP[raw.encounterId] ??
            encounterBindings.find((b) => b.encounterId === raw.encounterId)?.dungeonSlug ??
            null
          : null;
    const dungeonSlug = dungeonSlugRaw?.trim().toLowerCase() ?? null;
    if (!dungeonSlug) {
      candidateNormalization.missingDungeonSlug += 1;
      continue;
    }
    if (!activeDungeonSet.has(dungeonSlug)) {
      candidateNormalization.dungeonSlugNotInActivePool += 1;
      continue;
    }

    candidateNormalization.byDungeonSlug[dungeonSlug] =
      (candidateNormalization.byDungeonSlug[dungeonSlug] ?? 0) + 1;
    const keyLevel = typeof raw.keyLevel === "number" ? raw.keyLevel : null;
    if (keyLevel == null || keyLevel <= 0) {
      candidateNormalization.invalidKeyLevel += 1;
      continue;
    }

    const visibilityRaw =
      typeof raw.visibility === "string" ? raw.visibility.toLowerCase() : "public";
    const visibility =
      visibilityRaw === "private" ||
      visibilityRaw === "hidden" ||
      visibilityRaw === "unknown"
        ? visibilityRaw
        : "public";

    sourceRows.push({
      reportCode: String(raw.reportCode ?? ""),
      fightId,
      dungeonSlug,
      keyLevel,
      timed: typeof raw.timed === "boolean" ? raw.timed : null,
      runScore:
        typeof raw.runScore === "number"
          ? raw.runScore
          : typeof raw.score === "number"
            ? raw.score
            : null,
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
    if (
      dungeonSlug == null ||
      plannedCandidate.keyLevel == null ||
      plannedCandidate.keyLevel <= 0
    ) {
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

  // Transport ranking evidence even when revision is still unresolved.
  const rankingByFight = new Map(
    rankingEvidenceFromDiscovery.map((r) => [`${r.reportCode}:${r.fightId}`, r]),
  );
  const rankingEvidence: ShadowCanaryRankingEvidence[] = [];
  const seenRanking = new Set<string>();
  for (const c of candidates) {
    const key = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
    if (seenRanking.has(key)) continue;
    seenRanking.add(key);
    const fromDiscovery = rankingByFight.get(key);
    if (!fromDiscovery) continue;
    const revision =
      typeof c.reportRevision === "number" && Number.isFinite(c.reportRevision)
        ? c.reportRevision
        : fromDiscovery.reportRevision != null &&
            Number.isFinite(fromDiscovery.reportRevision)
          ? fromDiscovery.reportRevision
          : null;
    rankingEvidence.push({
      ...fromDiscovery,
      reportRevision: revision,
      dungeonSlug: c.dungeonSlug,
      keyLevel: c.keyLevel,
    });
  }

  const providerCalls = zoneCatalogCalls + characterDiscoveryCalls;

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
      dungeonPoolSource,
      discoveryStrategy: "encounter_rankings",
      providerCalls,
      providerCallBreakdown: {
        zoneCatalog: zoneCatalogCalls,
        characterDiscovery: characterDiscoveryCalls,
      },
      candidateNormalization,
    },
  };
}
