import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAbilityCatalog } from "@mplus/abilities";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { parseRateLimitSnapshot } from "../rate/rate-budget.js";
import {
  CURRENT_MPLUS_ZONE_DUNGEON_SLUGS,
  mapRegionToWcl,
  mapZoneRankings,
  classifyReportVisibility,
  recentReportsToCandidates,
  countParseStyleRankingRows,
} from "../discovery/run-discovery.js";
import { resolveMplusZoneConfig, type MplusZoneConfig } from "../discovery/mplus-zone.js";
import {
  buildActorMap,
  resolveActorSourceIdStrict,
  resolveOwnedPetActorIds,
} from "../discovery/run-matching.js";
import {
  candidatesFromHydratedReport,
  prioritizeReportsForHydration,
  type HydrationReportPayload,
} from "../discovery/report-hydration.js";
import { MAX_RECENT_REPORTS_LIMIT } from "../discovery/bounds.js";
import { OPERATIONS, type EventDataType } from "../operations/queries.js";
import type { WclRateLimitSnapshot } from "../types.js";
import {
  buildZoneEncounters,
  parseJsonScalar,
  resolveCurrentPartition,
} from "./performance-probe-logic.js";
import type {
  GraphQlErrorRecord,
  ProbeCharacterRecord,
  ProbeRateLimitRecord,
  ProbeZoneRecord,
} from "./types.js";
import {
  activeSeasonDungeonPool,
  buildSurvivalCandidateQueuesFromHydrated,
  classSlugFromWclClassId,
  emptyRejection,
  extractAggregateDungeonHints,
  normalizeSpecSlug,
  rankingsToSurvivalCandidates,
} from "./survival-probe-logic.js";
import type { SurvivalRunCandidate } from "./survival-probe-types.js";
import {
  aggregateUtilityDungeon,
  buildHostileValidatedByDamage,
  buildUtilityGlobalSummary,
  normalizeUtilityRun,
  summarizeUtilityRun,
} from "./utility-probe-logic.js";
import { UTILITY_CORE_EVENT_TYPES, UTILITY_EVENT_TYPES } from "./utility-probe-types.js";
import type {
  UtilityActorContext,
  UtilityCostDiagnostics,
  UtilityEventDataType,
  UtilityProbeDataset,
  UtilityProbeDiagnostics,
  UtilityProbeIdentity,
  UtilityRawEventDataset,
  UtilityRawEventPage,
} from "./utility-probe-types.js";

const DEFAULT_MAX_RUNS_PER_DUNGEON = 3;
const DEFAULT_MAX_REPORTS_PER_DUNGEON = 8;
const PROBE_MAX_HYDRATION_REPORTS = 40;
const PROBE_MAX_EVENT_PAGES = 200;
const PROBE_EVENT_PAGE_LIMIT = 1000;

export interface UtilityProbeOptions {
  identity: UtilityProbeIdentity;
  outputDir: string;
  client: WclGraphQlClient;
  zoneConfig?: MplusZoneConfig;
  partition?: number | null;
  now?: Date;
  maxRunsPerDungeon?: number;
  maxReportsInspectedPerDungeon?: number;
  maxEventPages?: number;
  eventPageLimit?: number;
  /**
   * Maximum number of recentReports pages to fetch when zoneRankings returns
   * no direct report links. WCL returns up to 100 reports per page.
   * Defaults to 1 (first page only). Set higher when a PARTIAL run needs more
   * report coverage to find missing dungeons.
   */
  maxRecentReportPages?: number;
  /**
   * When set, the probe will only attempt to collect runs for these dungeon
   * slugs. Dungeons not in this list are skipped entirely (no event fetching).
   * Use for PARTIAL resume: pass the list of still-missing dungeons.
   * The caller must merge staging output with a snapshot — never write focus
   * probe output directly to canonical artifacts.
   */
  focusDungeons?: string[] | null;
  /**
   * When false, skip cleaning the output directory before writing artifacts.
   * Resume staging directories should use the default true on a fresh staging path.
   */
  cleanOutputDir?: boolean;
}

export interface UtilityProbeResult {
  dataset: UtilityProbeDataset;
  outputFiles: Record<string, string>;
}

type CachedReport = {
  code: string;
  title: string;
  revision: number;
  startTime: number;
  endTime: number;
  visibility: string;
  zone: { id: number; name?: string | null } | null;
  fights: Array<{
    id: number;
    encounterID?: number | null;
    name?: string | null;
    difficulty?: number | null;
    kill?: boolean | null;
    startTime: number;
    endTime: number;
    keystoneLevel?: number | null;
    friendlyPlayers?: Array<number | { id: number }>;
  }>;
  actors: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    server?: string | null;
    petOwner?: number | null;
  }>;
  abilities: Array<{ gameID: number; type?: number | null }>;
  rawMasterData: unknown;
  rawReportPayload: unknown;
};

async function cleanProbeOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const entries = await readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => rm(join(outputDir, entry.name), { recursive: true, force: true })),
  );
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function collectGraphQlErrors(
  bucket: GraphQlErrorRecord[],
  operationName: string,
  errors: Array<{ message: string }> | undefined,
): string[] {
  const messages = (errors ?? []).map((e) => e.message);
  if (messages.length > 0) bucket.push({ operationName, messages });
  return messages;
}

function rateLimitFromExtensions(
  extensions:
    | {
        rateLimit?: {
          cost?: number;
          limitPerHour?: number;
          pointsSpentThisHour?: number;
          pointsResetIn?: number;
        };
      }
    | undefined,
): WclRateLimitSnapshot | null {
  const rl = extensions?.rateLimit;
  if (!rl || typeof rl.limitPerHour !== "number" || typeof rl.pointsSpentThisHour !== "number") {
    return null;
  }
  return parseRateLimitSnapshot({
    limitPerHour: rl.limitPerHour,
    pointsSpentThisHour: rl.pointsSpentThisHour,
    pointsResetIn: rl.pointsResetIn,
  });
}

function bumpOpCount(counts: Record<string, number>, operationName: string): void {
  counts[operationName] = (counts[operationName] ?? 0) + 1;
}

async function fetchRateLimitData(
  client: WclGraphQlClient,
  region: string,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
  opCounts: Record<string, number>,
): Promise<WclRateLimitSnapshot | null> {
  bumpOpCount(opCounts, OPERATIONS.RateLimitData.operationName);
  const result = await client.requestPermissive<{
    rateLimitData?: {
      limitPerHour: number;
      pointsSpentThisHour: number;
      pointsResetIn?: number;
    };
  }>({
    operationName: OPERATIONS.RateLimitData.operationName,
    query: OPERATIONS.RateLimitData.query,
    region,
  });
  collectGraphQlErrors(graphqlErrors, OPERATIONS.RateLimitData.operationName, result.response.errors);
  perOperation.push({
    operationName: OPERATIONS.RateLimitData.operationName,
    costUnits: result.costUnits,
    durationMs: result.durationMs,
    snapshot: result.response.data?.rateLimitData
      ? parseRateLimitSnapshot(result.response.data.rateLimitData)
      : rateLimitFromExtensions(result.response.extensions),
  });
  return result.response.data?.rateLimitData
    ? parseRateLimitSnapshot(result.response.data.rateLimitData)
    : null;
}

async function resolveCharacterAndZone(
  client: WclGraphQlClient,
  identity: UtilityProbeIdentity,
  zoneConfig: MplusZoneConfig,
  partitionOverride: number | null | undefined,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
  opCounts: Record<string, number>,
): Promise<{ character: ProbeCharacterRecord | null; zone: ProbeZoneRecord }> {
  bumpOpCount(opCounts, OPERATIONS.ResolveCharacter.operationName);
  const charResult = await client.requestPermissive<{
    characterData?: {
      character?: {
        id: number;
        canonicalID: number;
        name: string;
        level?: number | null;
        classID?: number | null;
        hidden: boolean;
        server: { slug: string; region?: { name?: string } };
      } | null;
    };
  }>({
    operationName: OPERATIONS.ResolveCharacter.operationName,
    query: OPERATIONS.ResolveCharacter.query,
    variables: {
      name: identity.name,
      serverSlug: identity.realmSlug,
      serverRegion: mapRegionToWcl(identity.region),
    },
    region: identity.region,
  });
  collectGraphQlErrors(
    graphqlErrors,
    OPERATIONS.ResolveCharacter.operationName,
    charResult.response.errors,
  );
  perOperation.push({
    operationName: OPERATIONS.ResolveCharacter.operationName,
    costUnits: charResult.costUnits,
    durationMs: charResult.durationMs,
    snapshot: rateLimitFromExtensions(charResult.response.extensions),
  });

  const rawCharacter = charResult.response.data?.characterData?.character ?? null;
  const character: ProbeCharacterRecord | null = rawCharacter
    ? {
        id: rawCharacter.id,
        canonicalID: rawCharacter.canonicalID,
        name: rawCharacter.name,
        level: rawCharacter.level ?? null,
        classID: rawCharacter.classID ?? null,
        hidden: rawCharacter.hidden,
        server: {
          slug: rawCharacter.server.slug,
          regionName: rawCharacter.server.region?.name ?? null,
        },
      }
    : null;

  bumpOpCount(opCounts, OPERATIONS.WorldDataZone.operationName);
  const zoneResult = await client.requestPermissive<{
    worldData?: {
      zone?: {
        id: number;
        name: string;
        frozen?: boolean | null;
        encounters?: Array<{ id: number; name?: string | null }> | null;
        partitions?: Array<{ id: number; name?: string | null }> | null;
      } | null;
    };
  }>({
    operationName: OPERATIONS.WorldDataZone.operationName,
    query: OPERATIONS.WorldDataZone.query,
    variables: { id: zoneConfig.zoneId },
    region: identity.region,
  });
  collectGraphQlErrors(graphqlErrors, OPERATIONS.WorldDataZone.operationName, zoneResult.response.errors);
  perOperation.push({
    operationName: OPERATIONS.WorldDataZone.operationName,
    costUnits: zoneResult.costUnits,
    durationMs: zoneResult.durationMs,
    snapshot: rateLimitFromExtensions(zoneResult.response.extensions),
  });

  const worldZone = zoneResult.response.data?.worldData?.zone ?? null;
  const encounters = buildZoneEncounters(worldZone?.encounters ?? null);
  const partitions = (worldZone?.partitions ?? []).map((p) => ({
    id: p.id,
    name: p.name ?? null,
  }));

  return {
    character,
    zone: {
      config: zoneConfig,
      worldData: worldZone
        ? {
            id: worldZone.id,
            name: worldZone.name,
            frozen: worldZone.frozen ?? null,
            encounters,
            partitions,
          }
        : {
            id: zoneConfig.zoneId,
            name: `zone-${zoneConfig.zoneId}`,
            frozen: null,
            encounters,
            partitions,
          },
      partitionUsed: resolveCurrentPartition(partitions, partitionOverride),
    },
  };
}

async function fetchAndCacheReport(
  client: WclGraphQlClient,
  identity: UtilityProbeIdentity,
  reportCode: string,
  cache: Map<string, CachedReport>,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
  opCounts: Record<string, number>,
  cost: UtilityCostDiagnostics["cache"],
): Promise<{ ok: true; data: CachedReport } | { ok: false; reason: string }> {
  const cached = cache.get(reportCode);
  if (cached) {
    cost.reportMasterDataHits += 1;
    return { ok: true, data: cached };
  }
  cost.reportMasterDataMisses += 1;
  bumpOpCount(opCounts, OPERATIONS.ReportWithFightAndMasterData.operationName);

  const result = await client.requestPermissive<{
    reportData?: {
      report?: {
        code: string;
        title: string;
        revision: number;
        startTime: number;
        endTime: number;
        visibility: string;
        zone?: { id: number; name?: string | null } | null;
        fights?: CachedReport["fights"];
        masterData?: {
          actors?: CachedReport["actors"];
          abilities?: CachedReport["abilities"];
        } | null;
      } | null;
    };
  }>({
    operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
    query: OPERATIONS.ReportWithFightAndMasterData.query,
    variables: { code: reportCode },
    region: identity.region,
  });

  const messages = collectGraphQlErrors(
    graphqlErrors,
    OPERATIONS.ReportWithFightAndMasterData.operationName,
    result.response.errors,
  );
  perOperation.push({
    operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
    costUnits: result.costUnits,
    durationMs: result.durationMs,
    snapshot: rateLimitFromExtensions(result.response.extensions),
  });
  if (messages.length > 0) {
    return { ok: false, reason: `graphql_error: ${messages.join("; ")}` };
  }

  const report = result.response.data?.reportData?.report ?? null;
  if (!report) return { ok: false, reason: "report_not_found" };
  const vis = classifyReportVisibility(report.visibility);
  if (!vis.isPublic) return { ok: false, reason: `report_not_public:${report.visibility}` };

  const data: CachedReport = {
    code: report.code,
    title: report.title,
    revision: report.revision,
    startTime: report.startTime,
    endTime: report.endTime,
    visibility: report.visibility,
    zone: report.zone ?? null,
    fights: report.fights ?? [],
    actors: report.masterData?.actors ?? [],
    abilities: report.masterData?.abilities ?? [],
    rawMasterData: report.masterData ?? null,
    rawReportPayload: result.response.data,
  };
  cache.set(reportCode, data);
  return { ok: true, data };
}

/** CombatantInfo is player-scoped (cheaper); Deaths stays unfiltered for battle-rez context. */
function sourceIdForDataType(
  dataType: UtilityEventDataType,
  playerActorId: number,
): number | null {
  if (dataType === "CombatantInfo") return playerActorId;
  return null;
}

/**
 * Paginate ReportEvents with nextPageTimestamp, preserving every raw page payload.
 * GraphQL errors fail this dataset explicitly (state=ERROR).
 */
export async function fetchUtilityEventDataset(
  client: WclGraphQlClient,
  input: {
    identity: UtilityProbeIdentity;
    reportCode: string;
    fightId: number;
    dataType: UtilityEventDataType;
    sourceId: number | null;
    maxEventPages?: number;
    eventPageLimit?: number;
  },
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<UtilityRawEventDataset> {
  const maxPages = input.maxEventPages ?? PROBE_MAX_EVENT_PAGES;
  const pageLimit = input.eventPageLimit ?? PROBE_EVENT_PAGE_LIMIT;
  const pages: UtilityRawEventPage[] = [];
  const events: Array<Record<string, unknown>> = [];
  const datasetErrors: string[] = [];
  let startTime: number | undefined;
  let truncated = false;
  const seenTimestamps = new Set<number>();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const opName = `${OPERATIONS.ReportEvents.operationName}:${input.dataType}`;
    const result = await client.requestPermissive<{
      reportData?: {
        report?: {
          events?: {
            data?: Array<Record<string, unknown>>;
            nextPageTimestamp?: number | null;
          } | null;
        } | null;
      };
    }>({
      operationName: OPERATIONS.ReportEvents.operationName,
      query: OPERATIONS.ReportEvents.query,
      variables: {
        code: input.reportCode,
        fightIDs: [input.fightId],
        dataType: input.dataType as EventDataType,
        sourceID: input.sourceId ?? undefined,
        startTime,
        limit: pageLimit,
        translate: false,
        useAbilityIDs: false,
        useActorIDs: false,
      },
      region: input.identity.region,
    });

    const messages = collectGraphQlErrors(graphqlErrors, opName, result.response.errors);
    perOperation.push({
      operationName: opName,
      costUnits: result.costUnits,
      durationMs: result.durationMs,
      snapshot: rateLimitFromExtensions(result.response.extensions),
    });

    if (messages.length > 0) {
      datasetErrors.push(...messages);
      pages.push({
        pageIndex,
        startTime: startTime ?? null,
        nextPageTimestamp: null,
        eventCount: 0,
        rawResponseData: result.response.data ?? null,
        graphqlErrors: messages,
      });
      return {
        dataType: input.dataType,
        state: "ERROR",
        pageCount: pages.length,
        truncated: false,
        filterSourceId: input.sourceId,
        events,
        pages,
        graphqlErrors: datasetErrors,
        note: `GraphQL errors failed ${input.dataType} dataset`,
      };
    }

    const page = result.response.data?.reportData?.report?.events;
    const pageEvents = page?.data ?? [];
    const nextPageTimestamp = page?.nextPageTimestamp ?? null;

    pages.push({
      pageIndex,
      startTime: startTime ?? null,
      nextPageTimestamp,
      eventCount: pageEvents.length,
      rawResponseData: result.response.data ?? null,
      graphqlErrors: [],
    });
    events.push(...pageEvents);

    if (nextPageTimestamp == null) {
      return {
        dataType: input.dataType,
        state: "OK",
        pageCount: pages.length,
        truncated: false,
        filterSourceId: input.sourceId,
        events,
        pages,
        graphqlErrors: [],
        note: null,
      };
    }
    if (seenTimestamps.has(nextPageTimestamp)) {
      truncated = true;
      break;
    }
    seenTimestamps.add(nextPageTimestamp);
    startTime = nextPageTimestamp;
  }

  truncated = true;
  return {
    dataType: input.dataType,
    state: "OK",
    pageCount: pages.length,
    truncated,
    filterSourceId: input.sourceId,
    events,
    pages,
    graphqlErrors: [],
    note: `Pagination truncated at maxEventPages=${maxPages}`,
  };
}

function emptyEventDatasets(note: string): Record<UtilityEventDataType, UtilityRawEventDataset> {
  return Object.fromEntries(
    UTILITY_EVENT_TYPES.map((t) => [
      t,
      {
        dataType: t,
        state: "MISSING" as const,
        pageCount: 0,
        truncated: false,
        filterSourceId: null,
        events: [],
        pages: [],
        graphqlErrors: [],
        note,
      } satisfies UtilityRawEventDataset,
    ]),
  ) as unknown as Record<UtilityEventDataType, UtilityRawEventDataset>;
}

export async function runUtilityProbe(options: UtilityProbeOptions): Promise<UtilityProbeResult> {
  const probedAt = (options.now ?? new Date()).toISOString();
  const maxRuns = options.maxRunsPerDungeon ?? DEFAULT_MAX_RUNS_PER_DUNGEON;
  const maxReportsPerDungeon =
    options.maxReportsInspectedPerDungeon ?? DEFAULT_MAX_REPORTS_PER_DUNGEON;
  const maxRecentReportPages = Math.max(1, options.maxRecentReportPages ?? 1);
  const focusDungeons = options.focusDungeons?.length ? new Set(options.focusDungeons) : null;
  const zoneConfig =
    options.zoneConfig ??
    resolveMplusZoneConfig({ env: process.env, allowFixtureDefault: false });

  const graphqlErrors: GraphQlErrorRecord[] = [];
  const perOperation: ProbeRateLimitRecord[] = [];
  const opCounts: Record<string, number> = {};
  const schemaWarnings: string[] = [];
  const reportsInspected = new Set<string>();
  const fightsInspected: Array<{ reportCode: string; fightId: number }> = [];
  const runsRejected: UtilityProbeDiagnostics["candidateRunsRejected"] = [];
  const dungeonPool = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);
  const reportCache = new Map<string, CachedReport>();
  const eventCache = new Map<string, UtilityRawEventDataset>();
  const cacheStats: UtilityCostDiagnostics["cache"] = {
    reportMasterDataHits: 0,
    reportMasterDataMisses: 0,
    eventDatasetHits: 0,
    eventDatasetMisses: 0,
  };
  const paginationTotals = Object.fromEntries(
    UTILITY_EVENT_TYPES.map((t) => [t, 0]),
  ) as Record<UtilityEventDataType, number>;

  const initialRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
    opCounts,
  );

  const { character, zone } = await resolveCharacterAndZone(
    options.client,
    options.identity,
    zoneConfig,
    options.partition,
    graphqlErrors,
    perOperation,
    opCounts,
  );
  if (zoneConfig.warning) schemaWarnings.push(zoneConfig.warning);

  bumpOpCount(opCounts, OPERATIONS.CharacterZoneRankings.operationName);
  const rankingsResult = await options.client.requestPermissive<{
    characterData?: { character?: { zoneRankings?: unknown } | null };
  }>({
    operationName: OPERATIONS.CharacterZoneRankings.operationName,
    query: OPERATIONS.CharacterZoneRankings.query,
    variables: {
      name: options.identity.name,
      serverSlug: options.identity.realmSlug,
      serverRegion: mapRegionToWcl(options.identity.region),
      zoneID: zoneConfig.zoneId,
    },
    region: options.identity.region,
  });
  const rankingsMessages = collectGraphQlErrors(
    graphqlErrors,
    OPERATIONS.CharacterZoneRankings.operationName,
    rankingsResult.response.errors,
  );
  perOperation.push({
    operationName: OPERATIONS.CharacterZoneRankings.operationName,
    costUnits: rankingsResult.costUnits,
    durationMs: rankingsResult.durationMs,
    snapshot: rateLimitFromExtensions(rankingsResult.response.extensions),
  });

  const rawZoneRankings = rankingsMessages.length
    ? null
    : parseJsonScalar(rankingsResult.response.data?.characterData?.character?.zoneRankings ?? null);
  if (rankingsMessages.length > 0) {
    schemaWarnings.push("CharacterZoneRankings GraphQL errors");
  }
  const parseCounts = countParseStyleRankingRows(
    (rawZoneRankings as { rankings?: unknown[] } | null) ?? null,
  );
  if (parseCounts.totalRows > 0 && parseCounts.parseRows === 0) {
    schemaWarnings.push(
      `zoneRankings returned ${parseCounts.totalRows} aggregate row(s) without report/fightID — hydrating recentReports`,
    );
  }

  const rankingObservations = mapZoneRankings(
    (rawZoneRankings as { rankings?: unknown[] } | null) ?? null,
    zoneConfig.zoneId,
  );
  let byDungeon = rankingsToSurvivalCandidates(rankingObservations, dungeonPool);
  const aggregateHints = extractAggregateDungeonHints(rawZoneRankings);

  // Determine if we need to fall back to recentReports discovery.
  // When focusDungeons is set, only lack of candidates for those specific dungeons triggers it.
  // When all queues are empty (full run), always trigger.
  const allQueuesEmpty = [...byDungeon.values()].every((b) => b.length === 0);
  const focusDungeonsNeedingCandidates = focusDungeons
    ? [...focusDungeons].filter((d) => (byDungeon.get(d) ?? []).length === 0)
    : null;
  const needsRecentReports =
    allQueuesEmpty || (focusDungeonsNeedingCandidates != null && focusDungeonsNeedingCandidates.length > 0);

  if (needsRecentReports) {
    type RecentReportsResponse = {
      characterData?: {
        character?: {
          recentReports?: {
            data?: Array<{
              code: string;
              title?: string | null;
              startTime: number;
              endTime?: number | null;
              visibility?: string | null;
              zone?: { id: number; name?: string | null } | null;
            }>;
            total?: number | null;
            has_more_pages?: boolean | null;
          } | null;
        } | null;
      };
    };

    const allRecentCandidates: ReturnType<typeof recentReportsToCandidates>["candidates"] = [];
    let hasMore = true;
    let page = 0;

    while (hasMore && page < maxRecentReportPages) {
      page += 1;
      bumpOpCount(opCounts, OPERATIONS.CharacterRecentReports.operationName);
      const recentResult = await options.client.requestPermissive<RecentReportsResponse>({
        operationName: OPERATIONS.CharacterRecentReports.operationName,
        query: OPERATIONS.CharacterRecentReports.query,
        variables: {
          name: options.identity.name,
          serverSlug: options.identity.realmSlug,
          serverRegion: mapRegionToWcl(options.identity.region),
          limit: MAX_RECENT_REPORTS_LIMIT,
          page,
        },
        region: options.identity.region,
      });
      collectGraphQlErrors(
        graphqlErrors,
        OPERATIONS.CharacterRecentReports.operationName,
        recentResult.response.errors,
      );
      perOperation.push({
        operationName: OPERATIONS.CharacterRecentReports.operationName,
        costUnits: recentResult.costUnits,
        durationMs: recentResult.durationMs,
        snapshot: rateLimitFromExtensions(recentResult.response.extensions),
      });

      const pageData = recentResult.response.data?.characterData?.character?.recentReports;
      const recentMapped = recentReportsToCandidates(pageData);
      allRecentCandidates.push(...recentMapped.candidates);

      hasMore = pageData?.has_more_pages === true;
      // If we already have candidates for all focus dungeons, stop paging early
      if (focusDungeonsNeedingCandidates != null) {
        const tempQueues = buildSurvivalCandidateQueuesFromHydrated(
          allRecentCandidates.map((c) => ({
            reportCode: c.reportCode,
            fightId: 0,
            encounterId: 0,
            dungeonSlug: null,
            keyLevel: null,
            score: null,
            durationMs: null,
            startTimeMs: null,
            completedAt: null,
          })),
          aggregateHints,
          dungeonPool,
        );
        // allRecentCandidates are stubs without dungeonSlug yet — can't early-exit here
        // so we rely on maxRecentReportPages as the stop condition
        void tempQueues; // unused check; keep loop for pagination
      }
    }

    if (allRecentCandidates.length > 0) {
      schemaWarnings.push(
        `recentReports discovery: ${allRecentCandidates.length} stubs collected across ${page} page(s)` +
        (page < maxRecentReportPages && hasMore ? ` (more pages available — increase maxRecentReportPages beyond ${maxRecentReportPages})` : "") +
        (!hasMore && page < maxRecentReportPages ? ` (all pages exhausted after ${page})` : ""),
      );
    }

    const prioritized = prioritizeReportsForHydration(
      allRecentCandidates,
      [],
      PROBE_MAX_HYDRATION_REPORTS,
    );

    const hydratedCandidates: Array<{
      reportCode: string;
      fightId: number;
      encounterId: number;
      dungeonSlug: string | null;
      keyLevel: number | null;
      score: number | null;
      durationMs: number | null;
      startTimeMs: number | null;
      completedAt: string | null;
    }> = [];

    for (const stub of prioritized) {
      reportsInspected.add(stub.reportCode);
      const fetched = await fetchAndCacheReport(
        options.client,
        options.identity,
        stub.reportCode,
        reportCache,
        graphqlErrors,
        perOperation,
        opCounts,
        cacheStats,
      );
      if (!fetched.ok) {
        runsRejected.push({
          reportCode: stub.reportCode,
          fightId: 0,
          dungeonSlug: null,
          reason: `hydrate_${fetched.reason}`,
        });
        continue;
      }
      const mapped = candidatesFromHydratedReport(
        {
          code: fetched.data.code,
          startTime: fetched.data.startTime,
          endTime: fetched.data.endTime,
          visibility: fetched.data.visibility,
          zone: fetched.data.zone,
          fights: fetched.data.fights,
          masterData: { actors: fetched.data.actors },
        } satisfies HydrationReportPayload,
        options.identity.name,
        options.identity.realmSlug,
      );
      for (const reason of mapped.rejected) {
        runsRejected.push({
          reportCode: stub.reportCode,
          fightId: 0,
          dungeonSlug: null,
          reason: `hydrate_${reason}`,
        });
      }
      for (const c of mapped.candidates) {
        fightsInspected.push({ reportCode: c.reportCode, fightId: c.fightId });
        hydratedCandidates.push({
          reportCode: c.reportCode,
          fightId: c.fightId,
          encounterId: c.encounterId,
          dungeonSlug: c.dungeonSlug,
          keyLevel: c.keyLevel,
          score: c.score,
          durationMs: c.durationMs,
          startTimeMs: c.startTimeMs,
          completedAt: c.completedAt,
        });
      }
    }

    byDungeon = buildSurvivalCandidateQueuesFromHydrated(
      hydratedCandidates,
      aggregateHints,
      dungeonPool,
    );
  }

  const candidatesByDungeon: Record<string, SurvivalRunCandidate[]> = {};
  for (const slug of dungeonPool) {
    candidatesByDungeon[slug] = byDungeon.get(slug) ?? [];
  }

  const utilityRuns: ReturnType<typeof summarizeUtilityRun>[] = [];
  const runDetails: Array<{
    runId: string;
    reportCode: string;
    fightId: number;
    dungeonSlug: string;
    playerActorId: number;
    ownedPetActorIds: number[];
    eventDatasets: Record<UtilityEventDataType, UtilityRawEventDataset>;
  }> = [];
  let candidateRunsInspected = 0;

  if (character) {
    const classSlug = classSlugFromWclClassId(character.classID);

    for (const dungeonSlug of dungeonPool) {
      // When focusDungeons is set, skip dungeons not in the focus set
      if (focusDungeons && !focusDungeons.has(dungeonSlug)) continue;

      const queue = byDungeon.get(dungeonSlug) ?? [];
      const usable: ReturnType<typeof summarizeUtilityRun>[] = [];
      const reportsTried = new Set<string>();

      for (const candidate of queue) {
        if (usable.length >= maxRuns) break;
        if (reportsTried.size >= maxReportsPerDungeon && !reportsTried.has(candidate.reportCode)) {
          runsRejected.push(
            emptyRejection(
              candidate,
              `max_reports_inspected_per_dungeon_cap:${maxReportsPerDungeon}`,
            ),
          );
          continue;
        }

        candidateRunsInspected += 1;
        reportsInspected.add(candidate.reportCode);
        reportsTried.add(candidate.reportCode);
        fightsInspected.push({
          reportCode: candidate.reportCode,
          fightId: candidate.fightId,
        });

        const fetched = await fetchAndCacheReport(
          options.client,
          options.identity,
          candidate.reportCode,
          reportCache,
          graphqlErrors,
          perOperation,
          opCounts,
          cacheStats,
        );
        if (!fetched.ok) {
          runsRejected.push(emptyRejection(candidate, fetched.reason));
          continue;
        }

        const fight = fetched.data.fights.find((f) => f.id === candidate.fightId);
        if (!fight) {
          runsRejected.push(emptyRejection(candidate, "fight_not_found"));
          continue;
        }
        if (typeof fight.keystoneLevel !== "number" || fight.keystoneLevel <= 0) {
          runsRejected.push(emptyRejection(candidate, "not_mythic_plus_fight"));
          continue;
        }
        if (fetched.data.actors.length === 0) {
          runsRejected.push(emptyRejection(candidate, "master_data_actors_missing"));
          continue;
        }

        const actorMap = buildActorMap(fetched.data.actors);
        const resolved = resolveActorSourceIdStrict(
          actorMap,
          options.identity.name,
          options.identity.realmSlug,
        );
        if ("error" in resolved) {
          runsRejected.push(
            emptyRejection(
              candidate,
              `actor_resolution_${resolved.error.toLowerCase()}: ${resolved.message}`,
            ),
          );
          continue;
        }

        const friendlyIds = new Set(
          ((fight as { friendlyPlayers?: Array<number | { id: number }> }).friendlyPlayers ?? [])
            .map((entry) => (typeof entry === "number" ? entry : entry.id))
            .filter((id): id is number => typeof id === "number"),
        );
        if (friendlyIds.size > 0 && !friendlyIds.has(resolved.sourceId)) {
          runsRejected.push(
            emptyRejection(
              candidate,
              `player_actor_not_in_fight_friendlyPlayers:actor=${resolved.sourceId}`,
            ),
          );
          continue;
        }

        const ownedPetActorIds = resolveOwnedPetActorIds(
          actorMap,
          resolved.sourceId,
          options.identity.name,
        );

        const actorsById = new Map(
          fetched.data.actors.map((a) => [
            a.id,
            {
              id: a.id,
              name: a.name,
              type: a.type,
              subType: a.subType ?? null,
              petOwner: a.petOwner ?? null,
            },
          ]),
        );

        const baseActorCtx: Omit<UtilityActorContext, "hostileValidatedByDamage"> = {
          playerActorId: resolved.sourceId,
          ownedPetActorIds,
          friendlyPlayerIds: [...friendlyIds],
          actorsById,
        };

        const eventDatasets = emptyEventDatasets("pending");
        for (const dataType of UTILITY_EVENT_TYPES) {
          const filterSourceId = sourceIdForDataType(dataType, resolved.sourceId);
          const cacheKey = `${candidate.reportCode}:${candidate.fightId}:${dataType}:${
            filterSourceId ?? "all"
          }`;
          const cachedEvent = eventCache.get(cacheKey);
          if (cachedEvent) {
            cacheStats.eventDatasetHits += 1;
            eventDatasets[dataType] = cachedEvent;
            paginationTotals[dataType] += cachedEvent.pageCount;
            continue;
          }
          cacheStats.eventDatasetMisses += 1;
          const beforeLen = perOperation.length;
          const dataset = await fetchUtilityEventDataset(
            options.client,
            {
              identity: options.identity,
              reportCode: candidate.reportCode,
              fightId: candidate.fightId,
              dataType,
              sourceId: filterSourceId,
              maxEventPages: options.maxEventPages ?? PROBE_MAX_EVENT_PAGES,
              eventPageLimit: options.eventPageLimit ?? PROBE_EVENT_PAGE_LIMIT,
            },
            graphqlErrors,
            perOperation,
          );
          for (let i = beforeLen; i < perOperation.length; i += 1) {
            const name = perOperation[i]?.operationName ?? "ReportEvents";
            bumpOpCount(opCounts, name);
          }
          eventCache.set(cacheKey, dataset);
          eventDatasets[dataType] = dataset;
          paginationTotals[dataType] += dataset.pageCount;
        }

        const hostileValidatedByDamage = buildHostileValidatedByDamage(
          eventDatasets.DamageDone.state === "OK" ? eventDatasets.DamageDone.events : [],
          baseActorCtx,
          candidate.fightId,
          candidate.reportCode,
        );
        const actorCtx: UtilityActorContext = { ...baseActorCtx, hostileValidatedByDamage };

        const specSlug =
          normalizeSpecSlug(candidate.specSlug) ??
          normalizeSpecSlug(aggregateHints.get(dungeonSlug)?.specSlug ?? null);
        const catalog = getAbilityCatalog({ classSlug, specSlug });

        const normalized = normalizeUtilityRun({
          reportCode: candidate.reportCode,
          fightId: candidate.fightId,
          dungeonSlug,
          keyLevel: fight.keystoneLevel ?? candidate.keyLevel,
          durationMs: Math.max(0, fight.endTime - fight.startTime),
          specialization: specSlug,
          classSlug,
          specSlug,
          roleSlug: candidate.roleSlug ?? null,
          catalog,
          actorCtx,
          eventDatasets,
          fightEndTime: fight.endTime,
        });

        const missingDatasets = UTILITY_EVENT_TYPES.filter((t) => eventDatasets[t].state !== "OK");

        const coreOk = UTILITY_CORE_EVENT_TYPES.every((t) => eventDatasets[t].state === "OK");
        if (!coreOk) {
          runsRejected.push(
            emptyRejection(candidate, `incomplete_core_datasets:${missingDatasets.join(",")}`),
          );
          continue;
        }

        const summary = summarizeUtilityRun(normalized);
        usable.push(summary);
        runDetails.push({
          runId: summary.runId,
          reportCode: candidate.reportCode,
          fightId: candidate.fightId,
          dungeonSlug,
          playerActorId: resolved.sourceId,
          ownedPetActorIds,
          eventDatasets,
        });
      }

      utilityRuns.push(...usable);
    }
  }

  const perDungeon = dungeonPool.map((slug) =>
    aggregateUtilityDungeon(
      slug,
      utilityRuns.filter((r) => r.dungeonSlug === slug),
    ),
  );

  // Classify why each missing dungeon has no run.
  const missingDungeonReasons: Record<string, string> = {};
  for (const slug of dungeonPool) {
    const hasFocusSkip = focusDungeons && !focusDungeons.has(slug);
    if (hasFocusSkip) continue; // intentionally skipped — not missing
    const hasRun = utilityRuns.some((r) => r.dungeonSlug === slug);
    if (hasRun) continue;
    const hasCandidates = (byDungeon.get(slug) ?? []).length > 0;
    if (!hasCandidates) {
      missingDungeonReasons[slug] = "no_candidates";
      continue;
    }
    // Candidates existed — find the dominant rejection reason
    const dungeonRejections = runsRejected
      .filter((r) => r.dungeonSlug === slug)
      .map((r) => r.reason);
    if (dungeonRejections.length === 0) {
      missingDungeonReasons[slug] = "unknown";
      continue;
    }
    const hasActorAbsent = dungeonRejections.some((r) => r.includes("player_actor_not_in_fight"));
    const hasReportCap = dungeonRejections.some((r) => r.includes("max_reports_inspected_per_dungeon_cap"));
    const hasPrivate = dungeonRejections.some((r) => r.includes("private") || r.includes("unauthorized"));
    if (hasPrivate) missingDungeonReasons[slug] = "report_private";
    else if (hasActorAbsent && !hasReportCap) missingDungeonReasons[slug] = "actor_absent";
    else if (hasReportCap && !hasActorAbsent) missingDungeonReasons[slug] = "report_cap_reached";
    else if (hasActorAbsent && hasReportCap) missingDungeonReasons[slug] = "actor_absent_and_cap_reached";
    else missingDungeonReasons[slug] = dungeonRejections[0] ?? "unknown";
  }

  const global = buildUtilityGlobalSummary(perDungeon, dungeonPool, missingDungeonReasons);

  const catalogMatchedSpellIds = new Set<number>();
  const catalogUnmatchedSpellIds = new Set<number>();
  const unresolvedOpportunityReasons: Record<string, number> = {};
  const successfulUses = {
    interrupts: 0,
    cc: 0,
    dispels: 0,
    purges: 0,
    externalGroupUtility: 0,
    classSpecific: 0,
  };
  let candidateOpportunitiesInterrupt = 0;
  let candidateOpportunitiesDispelPurge = 0;
  const actorAndPetResolution: UtilityProbeDiagnostics["actorAndPetResolution"] = [];
  const incompleteDatasetsDiag: UtilityProbeDiagnostics["incompleteDatasets"] = [];

  for (const run of utilityRuns) {
    const n = run.normalized;
    for (const e of [
      ...n.interruptEvents,
      ...n.ccEvents,
      ...n.dispelPurgeEvents,
      ...n.externalGroupUtilityEvents,
      ...n.classSpecificEvents,
    ]) {
      if (e.canonical) catalogMatchedSpellIds.add(e.canonical.spellId);
    }
    for (const id of n.unmatchedAbilityIds) catalogUnmatchedSpellIds.add(id);
    successfulUses.interrupts += run.successfulInterrupts;
    successfulUses.cc += run.ccUses;
    successfulUses.dispels += run.dispels;
    successfulUses.purges += run.purges;
    successfulUses.externalGroupUtility += run.externalGroupUtilityUses;
    successfulUses.classSpecific += run.classSpecificUses;
    candidateOpportunitiesInterrupt += n.interruptOpportunities.length;
    candidateOpportunitiesDispelPurge += n.dispelPurgeOpportunities.length;
    for (const opp of n.interruptOpportunities) {
      for (const reason of opp.unresolvedReasons) {
        unresolvedOpportunityReasons[reason] = (unresolvedOpportunityReasons[reason] ?? 0) + 1;
      }
    }
    for (const opp of n.dispelPurgeOpportunities) {
      for (const reason of opp.unresolvedReasons) {
        unresolvedOpportunityReasons[reason] = (unresolvedOpportunityReasons[reason] ?? 0) + 1;
      }
    }
    actorAndPetResolution.push({
      runId: run.runId,
      playerActorId: run.playerActorId,
      petActorIds: run.petActorIds,
    });
    if (run.incompleteDatasets.length > 0) {
      incompleteDatasetsDiag.push({ runId: run.runId, missing: run.incompleteDatasets });
    }
  }

  const totalWclRequests = Object.values(opCounts).reduce((a, b) => a + b, 0);
  const estimatedQueryCostUnits = perOperation.reduce(
    (sum, op) => sum + (op.costUnits ?? 0),
    0,
  );

  const cost: UtilityCostDiagnostics = {
    totalWclRequests,
    estimatedQueryCostUnits: estimatedQueryCostUnits > 0 ? estimatedQueryCostUnits : null,
    cache: cacheStats,
    perOperationRequestCounts: opCounts,
    paginationPageCountTotal: paginationTotals,
    maxRunsPerDungeon: maxRuns,
    maxReportsInspectedPerDungeon: maxReportsPerDungeon,
  };

  const diagnostics: UtilityProbeDiagnostics = {
    reportsInspected: [...reportsInspected],
    fightsInspected,
    candidateRunsRejected: runsRejected,
    candidateRunsInspected,
    wclRequestCount: totalWclRequests,
    graphqlOperationCount: perOperation.length,
    cacheHits: cacheStats.reportMasterDataHits + cacheStats.eventDatasetHits,
    cacheMisses: cacheStats.reportMasterDataMisses + cacheStats.eventDatasetMisses,
    paginationPagesByDataset: paginationTotals,
    actorAndPetResolution,
    catalogMatches: {
      matchedSpellIds: [...catalogMatchedSpellIds].sort((a, b) => a - b),
      unmatchedSpellIds: [...catalogUnmatchedSpellIds].sort((a, b) => a - b),
    },
    successfulUses,
    candidateOpportunities: {
      interrupt: candidateOpportunitiesInterrupt,
      dispelPurge: candidateOpportunitiesDispelPurge,
    },
    unresolvedOpportunityReasons,
    datasetsInsufficientForStandaloneScoring: global.reliabilityAssessment.diagnosticOnly,
    incompleteDatasets: incompleteDatasetsDiag,
    graphqlErrors: [...graphqlErrors],
    schemaWarnings,
    cost,
    activeDungeonPool: dungeonPool,
    note:
      "Utility probe — no Utility score. Interrupt/CC/dispel-purge opportunity metrics remain diagnostic only.",
  };

  const finalRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
    opCounts,
  );

  const state: UtilityProbeDataset["state"] =
    !character || utilityRuns.length === 0
      ? "ERROR"
      : global.coverage.dungeonsMissingRuns.length > 0
        ? "PARTIAL"
        : "OK";

  cost.totalWclRequests = Object.values(opCounts).reduce((a, b) => a + b, 0);
  diagnostics.wclRequestCount = cost.totalWclRequests;
  diagnostics.graphqlErrors = [...graphqlErrors];

  const dataset: UtilityProbeDataset = {
    probeVersion: "utility-1",
    probedAt,
    identity: options.identity,
    state,
    character,
    zone,
    runs: utilityRuns,
    perDungeon,
    global,
    diagnostics,
    graphqlErrors,
    rateLimit: {
      initial: initialRateLimit,
      final: finalRateLimit,
      perOperation,
    },
    candidatesByDungeon,
  };

  if (options.cleanOutputDir !== false) {
    await cleanProbeOutputDir(options.outputDir);
  } else {
    await mkdir(options.outputDir, { recursive: true });
  }

  const selectedRunsIndex = runDetails.map((r) => ({
    runId: r.runId,
    dungeonSlug: r.dungeonSlug,
    reportCode: r.reportCode,
    fightId: r.fightId,
    playerActorId: r.playerActorId,
    ownedPetActorIds: r.ownedPetActorIds,
  }));

  const runSelectionPayload = {
    probedAt,
    identity: options.identity,
    activeDungeonPool: dungeonPool,
    candidatesByDungeon,
    rejected: runsRejected,
    selectedRuns: selectedRunsIndex,
  };

  const masterDataByReportCode: Record<string, unknown> = {};
  for (const code of new Set(runDetails.map((r) => r.reportCode))) {
    const report = reportCache.get(code);
    if (!report) continue;
    masterDataByReportCode[code] = {
      report: {
        code: report.code,
        title: report.title,
        revision: report.revision,
        startTime: report.startTime,
        endTime: report.endTime,
        visibility: report.visibility,
        zone: report.zone,
      },
      fights: report.fights,
      actors: report.actors,
      abilities: report.abilities,
      rawMasterData: report.rawMasterData,
    };
  }

  const interruptsRaw = runDetails.map((r) => ({
    runId: r.runId,
    reportCode: r.reportCode,
    fightId: r.fightId,
    dataset: r.eventDatasets.Interrupts,
  }));
  const castsRaw = runDetails.map((r) => ({
    runId: r.runId,
    reportCode: r.reportCode,
    fightId: r.fightId,
    dataset: r.eventDatasets.Casts,
  }));
  const buffsDebuffsRaw = runDetails.map((r) => ({
    runId: r.runId,
    reportCode: r.reportCode,
    fightId: r.fightId,
    buffs: r.eventDatasets.Buffs,
    debuffs: r.eventDatasets.Debuffs,
  }));
  const dispelsRaw = runDetails.map((r) => ({
    runId: r.runId,
    reportCode: r.reportCode,
    fightId: r.fightId,
    dataset: r.eventDatasets.Dispels,
  }));

  const normalizedRuns = utilityRuns.map((r) => r.normalized);
  const opportunitiesPayload = utilityRuns.map((r) => ({
    runId: r.runId,
    reportCode: r.reportCode,
    fightId: r.fightId,
    interruptOpportunities: r.normalized.interruptOpportunities,
    dispelPurgeOpportunities: r.normalized.dispelPurgeOpportunities,
  }));

  const runSelectionPath = join(options.outputDir, "01-utility-run-selection.json");
  const masterDataPath = join(options.outputDir, "02-master-data.json");
  const interruptsRawPath = join(options.outputDir, "03-interrupts-raw.json");
  const castsRawPath = join(options.outputDir, "04-casts-raw.json");
  const buffsDebuffsRawPath = join(options.outputDir, "05-buffs-debuffs-raw.json");
  const dispelsRawPath = join(options.outputDir, "06-dispels-raw.json");
  const normalizedRunsPath = join(options.outputDir, "07-utility-normalized-runs.json");
  const opportunitiesPath = join(options.outputDir, "08-utility-opportunities.json");
  const perDungeonPath = join(options.outputDir, "09-utility-per-dungeon.json");
  const diagnosticsPath = join(options.outputDir, "10-utility-diagnostics.json");

  const outputFiles: Record<string, string> = {
    runSelection: runSelectionPath,
    masterData: masterDataPath,
    interruptsRaw: interruptsRawPath,
    castsRaw: castsRawPath,
    buffsDebuffsRaw: buffsDebuffsRawPath,
    dispelsRaw: dispelsRawPath,
    normalizedRuns: normalizedRunsPath,
    opportunities: opportunitiesPath,
    perDungeon: perDungeonPath,
    diagnostics: diagnosticsPath,
  };

  await Promise.all([
    writeJson(runSelectionPath, runSelectionPayload),
    writeJson(masterDataPath, masterDataByReportCode),
    writeJson(interruptsRawPath, interruptsRaw),
    writeJson(castsRawPath, castsRaw),
    writeJson(buffsDebuffsRawPath, buffsDebuffsRaw),
    writeJson(dispelsRawPath, dispelsRaw),
    writeJson(normalizedRunsPath, normalizedRuns),
    writeJson(opportunitiesPath, opportunitiesPayload),
    writeJson(perDungeonPath, { perDungeon, global }),
    writeJson(diagnosticsPath, diagnostics),
  ]);

  return { dataset, outputFiles };
}
