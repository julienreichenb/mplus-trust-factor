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
    countParseStyleRankingRows,
} from "../discovery/run-discovery.js";
import { resolveMplusZoneConfig, type MplusZoneConfig } from "../discovery/mplus-zone.js";
import {
  buildActorMap,
  resolveActorSourceIdStrict,
  resolveOwnedPetActorIds,
} from "../discovery/run-matching.js";
import { OPERATIONS } from "../operations/queries.js";
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
  classSlugFromWclClassId,
  emptyRejection,
  extractAggregateDungeonHints,
  normalizeSpecSlug,
  normalizeSurvivalDataset,
  rankingsToSurvivalCandidates,
} from "./survival-probe-logic.js";
import { fetchSurvivalEventDataset } from "./survival-probe.js";
import type {
  SurvivalEventDataType,
  SurvivalProbeIdentity,
  SurvivalRawEventDataset,
  SurvivalRunCandidate,
} from "./survival-probe-types.js";
import { SURVIVAL_EVENT_TYPES } from "./survival-probe-types.js";
import {
  aggregateDungeonCalibration,
  buildGlobalCalibrationSummary,
  enrichSurvivalCalibrationRun,
} from "./survival-calibration-logic.js";
import type {
  SurvivalCalibrationCostDiagnostics,
  SurvivalCalibrationDataset,
  SurvivalCalibrationDiagnostics,
  SurvivalCalibrationRun,
} from "./survival-calibration-types.js";

const DEFAULT_MAX_RUNS_PER_DUNGEON = 3;
const DEFAULT_MAX_REPORTS_PER_DUNGEON = 8;
const PROBE_MAX_EVENT_PAGES = 200;
const PROBE_EVENT_PAGE_LIMIT = 1000;

export interface SurvivalCalibrationProbeOptions {
  identity: SurvivalProbeIdentity;
  outputDir: string;
  client: WclGraphQlClient;
  zoneConfig?: MplusZoneConfig;
  partition?: number | null;
  now?: Date;
  maxRunsPerDungeon?: number;
  maxReportsInspectedPerDungeon?: number;
  maxEventPages?: number;
  eventPageLimit?: number;
}

export interface SurvivalCalibrationProbeResult {
  dataset: SurvivalCalibrationDataset;
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
  identity: SurvivalProbeIdentity,
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
  identity: SurvivalProbeIdentity,
  reportCode: string,
  cache: Map<string, CachedReport>,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
  opCounts: Record<string, number>,
  cost: SurvivalCalibrationCostDiagnostics["cache"],
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

function emptyEventDatasets(
  note: string,
): Record<SurvivalEventDataType, SurvivalRawEventDataset> {
  return Object.fromEntries(
    SURVIVAL_EVENT_TYPES.map((t) => [
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
      } satisfies SurvivalRawEventDataset,
    ]),
  ) as unknown as Record<SurvivalEventDataType, SurvivalRawEventDataset>;
}

export async function runSurvivalCalibrationProbe(
  options: SurvivalCalibrationProbeOptions,
): Promise<SurvivalCalibrationProbeResult> {
  const probedAt = (options.now ?? new Date()).toISOString();
  const maxRuns = options.maxRunsPerDungeon ?? DEFAULT_MAX_RUNS_PER_DUNGEON;
  const maxReportsPerDungeon =
    options.maxReportsInspectedPerDungeon ?? DEFAULT_MAX_REPORTS_PER_DUNGEON;
  const zoneConfig =
    options.zoneConfig ??
    resolveMplusZoneConfig({ env: process.env, allowFixtureDefault: false });

  const graphqlErrors: GraphQlErrorRecord[] = [];
  const perOperation: ProbeRateLimitRecord[] = [];
  const opCounts: Record<string, number> = {};
  const schemaWarnings: string[] = [];
  const reportsInspected = new Set<string>();
  const fightsInspected: Array<{ reportCode: string; fightId: number }> = [];
  const runsRejected: SurvivalCalibrationDiagnostics["runsRejected"] = [];
  const dungeonPool = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);
  const reportCache = new Map<string, CachedReport>();
  const eventCache = new Map<string, SurvivalRawEventDataset>();
  const cacheStats: SurvivalCalibrationCostDiagnostics["cache"] = {
    reportMasterDataHits: 0,
    reportMasterDataMisses: 0,
    eventDatasetHits: 0,
    eventDatasetMisses: 0,
  };
  const paginationTotals = Object.fromEntries(
    SURVIVAL_EVENT_TYPES.map((t) => [t, 0]),
  ) as Record<SurvivalEventDataType, number>;

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
      `zoneRankings returned ${parseCounts.totalRows} aggregate row(s) without report/fightID — skipping (recentReports discovery removed; encounterRankings-only)`,
    );
  }

  const rankingObservations = mapZoneRankings(
    (rawZoneRankings as { rankings?: unknown[] } | null) ?? null,
    zoneConfig.zoneId,
  );
  const byDungeon = rankingsToSurvivalCandidates(rankingObservations, dungeonPool);
  const aggregateHints = extractAggregateDungeonHints(rawZoneRankings);

  // Rankings-only discovery: no recentReports / fightUnknown mass-hydration fallback.
  if ([...byDungeon.values()].every((b) => b.length === 0)) {
    schemaWarnings.push(
      "No zoneRankings parse-linked candidates; recentReports fallback removed — empty queues skipped",
    );
  }

  const candidatesByDungeon: Record<string, SurvivalRunCandidate[]> = {};
  for (const slug of dungeonPool) {
    candidatesByDungeon[slug] = byDungeon.get(slug) ?? [];
  }

  const calibrationRuns: SurvivalCalibrationRun[] = [];
  let candidateRunsInspected = 0;
  const incompleteDatasets: SurvivalCalibrationDiagnostics["incompleteDatasets"] = [];

  if (character) {
    const classSlug = classSlugFromWclClassId(character.classID);

    for (const dungeonSlug of dungeonPool) {
      const queue = byDungeon.get(dungeonSlug) ?? [];
      const usable: SurvivalCalibrationRun[] = [];
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

        const eventDatasets = emptyEventDatasets("pending");
        for (const dataType of SURVIVAL_EVENT_TYPES) {
          const cacheKey = `${candidate.reportCode}:${candidate.fightId}:${dataType}:${
            dataType === "Casts" ? "all" : resolved.sourceId
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
          const dataset = await fetchSurvivalEventDataset(
            options.client,
            {
              identity: options.identity,
              reportCode: candidate.reportCode,
              fightId: candidate.fightId,
              dataType,
              sourceId: dataType === "Casts" ? null : resolved.sourceId,
              maxEventPages: options.maxEventPages ?? PROBE_MAX_EVENT_PAGES,
              eventPageLimit: options.eventPageLimit ?? PROBE_EVENT_PAGE_LIMIT,
            },
            graphqlErrors,
            perOperation,
          );
          // Count new ReportEvents ops added by fetchSurvivalEventDataset
          for (let i = beforeLen; i < perOperation.length; i += 1) {
            const name = perOperation[i]?.operationName ?? "ReportEvents";
            bumpOpCount(opCounts, name);
          }
          eventCache.set(cacheKey, dataset);
          eventDatasets[dataType] = dataset;
          paginationTotals[dataType] += dataset.pageCount;
        }

        const specSlug =
          normalizeSpecSlug(candidate.specSlug) ??
          normalizeSpecSlug(aggregateHints.get(dungeonSlug)?.specSlug ?? null);
        const catalog = getAbilityCatalog({ classSlug, specSlug });
        const normalized = normalizeSurvivalDataset({
          identity: options.identity,
          probedAt,
          candidate: {
            ...candidate,
            keyLevel: fight.keystoneLevel ?? candidate.keyLevel,
            dungeonSlug,
          },
          wclCharacterId: character.id,
          wclCanonicalId: character.canonicalID,
          playerActorId: resolved.sourceId,
          ownedPetActorIds,
          fightStartTime: fight.startTime,
          fightEndTime: fight.endTime,
          keyLevel: fight.keystoneLevel ?? null,
          encounterId: fight.encounterID ?? null,
          encounterName: fight.name ?? null,
          eventDatasets,
          catalog,
          classSlug,
          specSlug,
        });

        // Prefer ranking/combatant specialization on the calibration run.
        if (!normalized.combatantInfo.specialization && specSlug) {
          normalized.combatantInfo.specialization = specSlug;
        }

        const missingDatasets = SURVIVAL_EVENT_TYPES.filter(
          (t) => eventDatasets[t].state !== "OK",
        );
        const calibrationRun = enrichSurvivalCalibrationRun({
          normalized,
          timed: null,
          depleted: null,
          completed: fight.kill ?? null,
          score: candidate.score ?? aggregateHints.get(dungeonSlug)?.score ?? null,
          missingDatasets,
        });

        if (missingDatasets.length > 0) {
          incompleteDatasets.push({
            runId: calibrationRun.runId,
            missing: missingDatasets,
          });
        }

        // Require core datasets for "usable" calibration row
        const coreOk =
          eventDatasets.Deaths.state === "OK" &&
          eventDatasets.DamageTaken.state === "OK" &&
          eventDatasets.Casts.state === "OK";
        if (!coreOk) {
          runsRejected.push(
            emptyRejection(candidate, `incomplete_core_datasets:${missingDatasets.join(",")}`),
          );
          continue;
        }

        usable.push(calibrationRun);
      }

      calibrationRuns.push(...usable);
    }
  }

  const perDungeon = dungeonPool.map((slug) =>
    aggregateDungeonCalibration(
      slug,
      calibrationRuns.filter((r) => r.dungeonSlug === slug),
    ),
  );
  const global = buildGlobalCalibrationSummary(perDungeon, dungeonPool);

  const unmatchedSpellIds = [
    ...new Set(calibrationRuns.flatMap((r) => r.unmatchedSpellIds)),
  ].sort((a, b) => a - b);
  const ambiguousSpellIds = [
    ...new Set(calibrationRuns.flatMap((r) => r.ambiguousSpellIds)),
  ].sort((a, b) => a - b);

  const totalWclRequests = Object.values(opCounts).reduce((a, b) => a + b, 0);
  const estimatedQueryCostUnits = perOperation.reduce(
    (sum, op) => sum + (op.costUnits ?? 0),
    0,
  );

  const cost: SurvivalCalibrationCostDiagnostics = {
    totalWclRequests,
    estimatedQueryCostUnits: estimatedQueryCostUnits > 0 ? estimatedQueryCostUnits : null,
    cache: cacheStats,
    perOperationRequestCounts: opCounts,
    paginationPageCountTotal: paginationTotals,
    maxRunsPerDungeon: maxRuns,
    maxReportsInspectedPerDungeon: maxReportsPerDungeon,
  };

  const diagnostics: SurvivalCalibrationDiagnostics = {
    candidateRunsInspected,
    reportsInspected: [...reportsInspected],
    fightsInspected,
    runsRejected,
    queryPageCounts: paginationTotals,
    totalWclRequests,
    cacheReuse: cacheStats,
    unmatchedSpellIds,
    ambiguousSpellIds,
    incompleteDatasets,
    graphqlErrors: [...graphqlErrors],
    schemaWarnings,
    cost,
    activeDungeonPool: dungeonPool,
    note:
      "Survival calibration probe — no Survival score. Theoretical defensive max uses are diagnostic only.",
  };

  const finalRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
    opCounts,
  );

  const state: SurvivalCalibrationDataset["state"] =
    !character || calibrationRuns.length === 0
      ? "ERROR"
      : global.coverage.dungeonsMissingRuns.length > 0
        ? "PARTIAL"
        : "OK";

  // Refresh totals after final rate-limit call
  cost.totalWclRequests = Object.values(opCounts).reduce((a, b) => a + b, 0);
  diagnostics.totalWclRequests = cost.totalWclRequests;
  diagnostics.graphqlErrors = [...graphqlErrors];

  const dataset: SurvivalCalibrationDataset = {
    probeVersion: "calibration-1",
    probedAt,
    identity: options.identity,
    state,
    character,
    zone,
    runs: calibrationRuns,
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

  await cleanProbeOutputDir(options.outputDir);
  const runsDir = join(options.outputDir, "runs");
  await mkdir(runsDir, { recursive: true });

  const summaryPath = join(options.outputDir, "00-calibration-summary.json");
  const perDungeonPath = join(options.outputDir, "01-per-dungeon-aggregates.json");
  const globalPath = join(options.outputDir, "02-global-calibration.json");
  const diagnosticsPath = join(options.outputDir, "03-calibration-diagnostics.json");
  const runsIndexPath = join(options.outputDir, "04-runs-index.json");

  const outputFiles: Record<string, string> = {
    summary: summaryPath,
    perDungeon: perDungeonPath,
    global: globalPath,
    diagnostics: diagnosticsPath,
    runsIndex: runsIndexPath,
  };

  const writes: Array<Promise<void>> = [
    writeJson(summaryPath, dataset),
    writeJson(perDungeonPath, perDungeon),
    writeJson(globalPath, global),
    writeJson(diagnosticsPath, diagnostics),
    writeJson(
      runsIndexPath,
      calibrationRuns.map((r) => ({
        runId: r.runId,
        dungeonSlug: r.dungeonSlug,
        reportCode: r.reportCode,
        fightId: r.fightId,
        keyLevel: r.keyLevel,
        deathCount: r.deaths.deathCount,
        damageTakenPerMinute: r.damageTaken.damageTakenPerMinute,
      })),
    ),
  ];

  for (const run of calibrationRuns) {
    const safeId = run.runId.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const runPath = join(runsDir, `${run.dungeonSlug}__${safeId}.json`);
    outputFiles[`run:${run.runId}`] = runPath;
    writes.push(writeJson(runPath, run));

    // Preserve raw-ish normalized + master pointers alongside each run
    const rawDir = join(runsDir, `${run.dungeonSlug}__${safeId}`);
    await mkdir(rawDir, { recursive: true });
    const report = reportCache.get(run.reportCode);
    writes.push(
      writeJson(join(rawDir, "normalized.json"), run.normalized),
      writeJson(join(rawDir, "calibration.json"), run),
      writeJson(join(rawDir, "master-data.json"), {
        report: report
          ? {
              code: report.code,
              title: report.title,
              revision: report.revision,
              visibility: report.visibility,
              zone: report.zone,
            }
          : null,
        fight: report?.fights.find((f) => f.id === run.fightId) ?? null,
        actors: report?.actors ?? [],
        rawMasterData: report?.rawMasterData ?? null,
        playerActorId: run.playerActorId,
        ownedPetActorIds: run.ownedPetActorIds,
      }),
    );
  }

  await Promise.all(writes);
  return { dataset, outputFiles };
}
