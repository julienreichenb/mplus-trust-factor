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
  classSlugFromWclClassId,
  describePetOwnership,
  emptyRejection,
  flattenCandidateInspectionOrder,
  normalizeSpecSlug,
  normalizeSurvivalDataset,
  rankingsToSurvivalCandidates,
} from "./survival-probe-logic.js";
import type {
  SurvivalEventDataType,
  SurvivalProbeDataset,
  SurvivalProbeDiagnostics,
  SurvivalProbeIdentity,
  SurvivalRawEventDataset,
  SurvivalRawEventPage,
  SurvivalRunCandidate,
} from "./survival-probe-types.js";
import { SURVIVAL_EVENT_TYPES } from "./survival-probe-types.js";

async function cleanProbeOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const entries = await readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => rm(join(outputDir, entry.name), { recursive: true, force: true })),
  );
}

export interface SurvivalProbeOptions {
  identity: SurvivalProbeIdentity;
  outputDir: string;
  client: WclGraphQlClient;
  zoneConfig?: MplusZoneConfig;
  partition?: number | null;
  now?: Date;
  /** Safety cap for event pagination (probe fetches until nextPageTimestamp is null). */
  maxEventPages?: number;
  eventPageLimit?: number;
}

export interface SurvivalProbeResult {
  dataset: SurvivalProbeDataset;
  outputFiles: Record<string, string>;
}

const PROBE_MAX_EVENT_PAGES = 200;
const PROBE_EVENT_PAGE_LIMIT = 1000;

function collectGraphQlErrors(
  bucket: GraphQlErrorRecord[],
  operationName: string,
  errors: Array<{ message: string }> | undefined,
): string[] {
  const messages = (errors ?? []).map((e) => e.message);
  if (messages.length > 0) {
    bucket.push({ operationName, messages });
  }
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

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function fetchRateLimitData(
  client: WclGraphQlClient,
  region: string,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<WclRateLimitSnapshot | null> {
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
): Promise<{ character: ProbeCharacterRecord | null; zone: ProbeZoneRecord }> {
  const wclRegion = mapRegionToWcl(identity.region);
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
      serverRegion: wclRegion,
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
  const partitionUsed = resolveCurrentPartition(partitions, partitionOverride);

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
      partitionUsed,
    },
  };
}

type MasterDataActor = {
  id: number;
  name: string;
  type: string;
  subType?: string | null;
  server?: string | null;
  petOwner?: number | null;
};

type ResolvedReportFight = {
  report: {
    code: string;
    title: string;
    revision: number;
    startTime: number;
    endTime: number;
    visibility: string;
    zone: { id: number; name?: string | null } | null;
  };
  fight: {
    id: number;
    encounterID: number | null;
    name: string | null;
    difficulty: number | null;
    kill: boolean | null;
    startTime: number;
    endTime: number;
    keystoneLevel: number | null;
  };
  actors: MasterDataActor[];
  abilities: Array<{ gameID: number; type?: number | null }>;
  rawMasterData: unknown;
  rawReportPayload: unknown;
};

async function fetchReportFightMasterData(
  client: WclGraphQlClient,
  identity: SurvivalProbeIdentity,
  candidate: SurvivalRunCandidate,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<{ ok: true; data: ResolvedReportFight } | { ok: false; reason: string }> {
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
        fights?: Array<{
          id: number;
          encounterID?: number | null;
          name?: string | null;
          difficulty?: number | null;
          kill?: boolean | null;
          startTime: number;
          endTime: number;
          keystoneLevel?: number | null;
        }>;
        masterData?: {
          actors?: MasterDataActor[];
          abilities?: Array<{ gameID: number; type?: number | null }>;
        } | null;
      } | null;
    };
  }>({
    operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
    query: OPERATIONS.ReportWithFightAndMasterData.query,
    variables: { code: candidate.reportCode, fightIDs: [candidate.fightId] },
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
  if (!report) {
    return { ok: false, reason: "report_not_found" };
  }

  const vis = classifyReportVisibility(report.visibility);
  if (!vis.isPublic) {
    return { ok: false, reason: `report_not_public:${report.visibility}` };
  }

  const fight = (report.fights ?? []).find((f) => f.id === candidate.fightId);
  if (!fight) {
    return { ok: false, reason: "fight_not_found" };
  }

  if (typeof fight.keystoneLevel !== "number" || fight.keystoneLevel <= 0) {
    return { ok: false, reason: "not_mythic_plus_fight" };
  }

  const actors = report.masterData?.actors ?? [];
  if (actors.length === 0) {
    return { ok: false, reason: "master_data_actors_missing" };
  }

  return {
    ok: true,
    data: {
      report: {
        code: report.code,
        title: report.title,
        revision: report.revision,
        startTime: report.startTime,
        endTime: report.endTime,
        visibility: report.visibility,
        zone: report.zone ?? null,
      },
      fight: {
        id: fight.id,
        encounterID: fight.encounterID ?? null,
        name: fight.name ?? null,
        difficulty: fight.difficulty ?? null,
        kill: fight.kill ?? null,
        startTime: fight.startTime,
        endTime: fight.endTime,
        keystoneLevel: fight.keystoneLevel ?? null,
      },
      actors,
      abilities: report.masterData?.abilities ?? [],
      rawMasterData: report.masterData ?? null,
      rawReportPayload: result.response.data,
    },
  };
}

/**
 * Paginate ReportEvents with nextPageTimestamp, preserving every raw page payload.
 * GraphQL errors fail this dataset explicitly (state=ERROR).
 */
export async function fetchSurvivalEventDataset(
  client: WclGraphQlClient,
  input: {
    identity: SurvivalProbeIdentity;
    reportCode: string;
    fightId: number;
    dataType: SurvivalEventDataType;
    sourceId: number | null;
    maxEventPages?: number;
    eventPageLimit?: number;
    /** When true, request hitPoints/maxHitPoints (DamageTaken/Healing/Deaths). */
    includeResources?: boolean;
    startTime?: number;
    endTime?: number;
  },
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<SurvivalRawEventDataset> {
  const maxPages = input.maxEventPages ?? PROBE_MAX_EVENT_PAGES;
  const pageLimit = input.eventPageLimit ?? PROBE_EVENT_PAGE_LIMIT;
  const pages: SurvivalRawEventPage[] = [];
  const events: Array<Record<string, unknown>> = [];
  const datasetErrors: string[] = [];
  let startTime: number | undefined = input.startTime;
  let truncated = false;
  const seenTimestamps = new Set<number>();
  const resourcesSuffix = input.includeResources ? "+resources" : "";

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const opName = `${OPERATIONS.ReportEvents.operationName}:${input.dataType}${resourcesSuffix}`;
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
        endTime: input.endTime,
        limit: pageLimit,
        translate: false,
        useAbilityIDs: false,
        useActorIDs: false,
        includeResources: input.includeResources === true ? true : undefined,
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
    note: truncated ? `Pagination truncated at maxEventPages=${maxPages}` : null,
  };
}

export async function runSurvivalProbe(
  options: SurvivalProbeOptions,
): Promise<SurvivalProbeResult> {
  const probedAt = (options.now ?? new Date()).toISOString();
  const zoneConfig =
    options.zoneConfig ??
    resolveMplusZoneConfig({
      env: process.env,
      allowFixtureDefault: false,
    });

  const graphqlErrors: GraphQlErrorRecord[] = [];
  const perOperation: ProbeRateLimitRecord[] = [];
  const schemaWarnings: string[] = [];
  const reportsInspected = new Set<string>();
  const fightsInspected: Array<{ reportCode: string; fightId: number }> = [];
  const candidateRunsRejected: SurvivalProbeDiagnostics["candidateRunsRejected"] = [];
  const dungeonPool = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);

  const initialRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
  );

  const { character, zone } = await resolveCharacterAndZone(
    options.client,
    options.identity,
    zoneConfig,
    options.partition,
    graphqlErrors,
    perOperation,
  );

  if (zoneConfig.warning) schemaWarnings.push(zoneConfig.warning);

  // Zone rankings with compare:Parses → report/fight candidates
  const rankingsOp = OPERATIONS.CharacterZoneRankings;
  const rankingsResult = await options.client.requestPermissive<{
    characterData?: { character?: { zoneRankings?: unknown } | null };
  }>({
    operationName: rankingsOp.operationName,
    query: rankingsOp.query,
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
    rankingsOp.operationName,
    rankingsResult.response.errors,
  );
  perOperation.push({
    operationName: rankingsOp.operationName,
    costUnits: rankingsResult.costUnits,
    durationMs: rankingsResult.durationMs,
    snapshot: rateLimitFromExtensions(rankingsResult.response.extensions),
  });

  const rawZoneRankings = rankingsMessages.length
    ? null
    : parseJsonScalar(rankingsResult.response.data?.characterData?.character?.zoneRankings ?? null);

  if (rankingsMessages.length > 0) {
    schemaWarnings.push("CharacterZoneRankings GraphQL errors — no parse candidates available");
  } else if (rawZoneRankings == null) {
    schemaWarnings.push("CharacterZoneRankings returned null zoneRankings payload");
  }

  const rankingObservations = mapZoneRankings(
    (rawZoneRankings as { rankings?: unknown[] } | null) ?? null,
    zoneConfig.zoneId,
  );
  const parseCounts = countParseStyleRankingRows(
    (rawZoneRankings as { rankings?: unknown[] } | null) ?? null,
  );
  if (parseCounts.totalRows > 0 && parseCounts.parseRows === 0) {
    schemaWarnings.push(
      `zoneRankings returned ${parseCounts.totalRows} aggregate row(s) without report/fightID — skipping (recentReports discovery removed; encounterRankings-only)`,
    );
  }

  const byDungeon = rankingsToSurvivalCandidates(rankingObservations, dungeonPool);

  // Rankings-only discovery: no recentReports / fightUnknown mass-hydration fallback.
  if ([...byDungeon.values()].every((bucket) => bucket.length === 0)) {
    schemaWarnings.push(
      "No zoneRankings parse-linked candidates; recentReports fallback removed — empty queues skipped",
    );
  }

  const inspectionOrder = flattenCandidateInspectionOrder(
    byDungeon,
    [...byDungeon.keys()].length > 0 ? [...byDungeon.keys()] : dungeonPool,
  );

  let selected: {
    candidate: SurvivalRunCandidate;
    reportFight: ResolvedReportFight;
    playerActorId: number;
    ownedPetActorIds: number[];
    actorMap: ReturnType<typeof buildActorMap>;
  } | null = null;

  for (const candidate of inspectionOrder) {
    reportsInspected.add(candidate.reportCode);
    fightsInspected.push({ reportCode: candidate.reportCode, fightId: candidate.fightId });

    const fetched = await fetchReportFightMasterData(
      options.client,
      options.identity,
      candidate,
      graphqlErrors,
      perOperation,
    );
    if (!fetched.ok) {
      candidateRunsRejected.push(emptyRejection(candidate, fetched.reason));
      continue;
    }

    const actorMap = buildActorMap(fetched.data.actors);
    const resolved = resolveActorSourceIdStrict(
      actorMap,
      options.identity.name,
      options.identity.realmSlug,
    );
    if ("error" in resolved) {
      candidateRunsRejected.push(
        emptyRejection(candidate, `actor_resolution_${resolved.error.toLowerCase()}: ${resolved.message}`),
      );
      continue;
    }

    const ownedPetActorIds = resolveOwnedPetActorIds(
      actorMap,
      resolved.sourceId,
      options.identity.name,
    );

    selected = {
      candidate,
      reportFight: fetched.data,
      playerActorId: resolved.sourceId,
      ownedPetActorIds,
      actorMap,
    };
    break;
  }

  const eventDatasets = Object.fromEntries(
    SURVIVAL_EVENT_TYPES.map((t) => [
      t,
      {
        dataType: t,
        state: "MISSING" as const,
        pageCount: 0,
        truncated: false,
        filterSourceId: null,
        events: [] as Array<Record<string, unknown>>,
        pages: [] as SurvivalRawEventPage[],
        graphqlErrors: [] as string[],
        note: selected ? "not_fetched" : "no_usable_run",
      } satisfies SurvivalRawEventDataset,
    ]),
  ) as Record<SurvivalEventDataType, SurvivalRawEventDataset>;

  let normalized: ReturnType<typeof normalizeSurvivalDataset> | null = null;
  let petDiag: SurvivalProbeDiagnostics["petOwnershipResolution"] = {
    ownedPetActorIds: [],
    method: "none",
    pets: [],
  };

  if (selected && character) {
    petDiag = {
      ownedPetActorIds: selected.ownedPetActorIds,
      ...describePetOwnership(
        selected.actorMap,
        selected.playerActorId,
        options.identity.name,
        selected.ownedPetActorIds,
      ),
    };

    for (const dataType of SURVIVAL_EVENT_TYPES) {
      const filterSourceId =
        dataType === "Casts" ? null : selected.playerActorId;
      const includeResources =
        dataType === "DamageTaken" ||
        dataType === "Healing" ||
        dataType === "Deaths";

      const dataset = await fetchSurvivalEventDataset(
        options.client,
        {
          identity: options.identity,
          reportCode: selected.candidate.reportCode,
          fightId: selected.candidate.fightId,
          dataType,
          sourceId: filterSourceId,
          maxEventPages: options.maxEventPages ?? PROBE_MAX_EVENT_PAGES,
          eventPageLimit: options.eventPageLimit ?? PROBE_EVENT_PAGE_LIMIT,
          includeResources,
        },
        graphqlErrors,
        perOperation,
      );

      // Preserve all raw events; attribution filtering happens during normalization only.
      eventDatasets[dataType] = dataset;
    }

    const classSlug = classSlugFromWclClassId(character.classID);
    const specSlug = normalizeSpecSlug(selected.candidate.specSlug);
    const catalog = getAbilityCatalog({
      classSlug,
      specSlug,
    });

    normalized = normalizeSurvivalDataset({
      identity: options.identity,
      probedAt,
      candidate: {
        ...selected.candidate,
        keyLevel: selected.reportFight.fight.keystoneLevel ?? selected.candidate.keyLevel,
      },
      wclCharacterId: character.id,
      wclCanonicalId: character.canonicalID,
      playerActorId: selected.playerActorId,
      ownedPetActorIds: selected.ownedPetActorIds,
      fightStartTime: selected.reportFight.fight.startTime,
      fightEndTime: selected.reportFight.fight.endTime,
      keyLevel: selected.reportFight.fight.keystoneLevel,
      encounterId: selected.reportFight.fight.encounterID,
      encounterName: selected.reportFight.fight.name,
      eventDatasets,
      catalog,
      classSlug,
      specSlug,
    });
  }

  const missingDatasets = SURVIVAL_EVENT_TYPES.filter(
    (t) => eventDatasets[t].state !== "OK",
  );

  const paginationPageCount = Object.fromEntries(
    SURVIVAL_EVENT_TYPES.map((t) => [t, eventDatasets[t].pageCount]),
  ) as Record<SurvivalEventDataType, number>;

  const matchedAbilityCatalogRules =
    normalized?.defensiveUsage
      .concat(normalized.selfHealingAndConsumables.consumableAndSelfHealCasts)
      .map((u) => ({
        spellId: u.spellId,
        canonicalKey: u.canonicalKey,
        category: u.category,
        availability: u.availability,
        supportCertainty: u.talentDependentOrUncertain ? "uncertain" : null,
      })) ?? [];

  const diagnostics: SurvivalProbeDiagnostics = {
    reportsInspected: [...reportsInspected],
    fightsInspected,
    candidateRunsRejected,
    paginationPageCount,
    actorResolution: {
      wclCharacterId: character?.id ?? null,
      playerActorId: selected?.playerActorId ?? null,
      method: selected ? "name+realm_strict" : null,
      ok: selected != null,
      message: selected
        ? null
        : character
          ? "No usable logged Mythic+ run found in active-season dungeon pool"
          : "Character not resolved",
    },
    petOwnershipResolution: petDiag,
    matchedAbilityCatalogRules,
    unmatchedSpellIds: normalized?.abilityCatalog.unmatchedSpellIds ?? [],
    ambiguousSpellIds: normalized?.abilityCatalog.ambiguousSpellIds ?? [],
    missingDatasets,
    graphqlErrors: [...graphqlErrors],
    schemaWarnings,
    activeDungeonPool: dungeonPool,
    selectedCandidate: selected?.candidate ?? null,
    note:
      "Survival probe only — no survival score, death-rate percentile, avoidable-damage, defensive-usage, or consumable scores are calculated.",
  };

  const state: "OK" | "ERROR" =
    selected != null && character != null && normalized != null ? "OK" : "ERROR";

  const finalRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
  );

  const dataset: SurvivalProbeDataset = {
    probeVersion: "1",
    probedAt,
    identity: options.identity,
    state,
    character,
    zone,
    selectedRun: normalized?.run ?? null,
    normalized,
    diagnostics: {
      ...diagnostics,
      graphqlErrors: [...graphqlErrors],
    },
    graphqlErrors,
    rateLimit: {
      initial: initialRateLimit,
      final: finalRateLimit,
      perOperation,
    },
    zoneConfig,
  };

  await cleanProbeOutputDir(options.outputDir);

  const resolutionPayload = {
    probedAt,
    identity: options.identity,
    character,
    zone,
    wclCharacterId: character?.id ?? null,
    wclCanonicalId: character?.canonicalID ?? null,
    selectedRun: selected
      ? {
          dungeonSlug: selected.candidate.dungeonSlug,
          reportCode: selected.candidate.reportCode,
          fightId: selected.candidate.fightId,
          playerActorId: selected.playerActorId,
          ownedPetActorIds: selected.ownedPetActorIds,
          startTime: selected.reportFight.fight.startTime,
          endTime: selected.reportFight.fight.endTime,
          keyLevel: selected.reportFight.fight.keystoneLevel,
          encounterId: selected.reportFight.fight.encounterID,
          encounterName: selected.reportFight.fight.name,
          dungeonMapping: {
            encounterId: selected.reportFight.fight.encounterID,
            dungeonSlug: selected.candidate.dungeonSlug,
          },
        }
      : null,
    candidateInspectionOrder: inspectionOrder,
    rejected: candidateRunsRejected,
    note: "playerActorId is report-local; wclCharacterId/canonicalID are global WCL IDs.",
  };

  const masterDataPayload = {
    probedAt,
    report: selected?.reportFight.report ?? null,
    fight: selected?.reportFight.fight ?? null,
    actors: selected?.reportFight.actors ?? [],
    abilities: selected?.reportFight.abilities ?? [],
    rawMasterData: selected?.reportFight.rawMasterData ?? null,
    playerActorId: selected?.playerActorId ?? null,
    ownedPetActorIds: selected?.ownedPetActorIds ?? [],
  };

  const outputFiles = {
    characterAndReportResolution: join(options.outputDir, "01-character-and-report-resolution.json"),
    masterData: join(options.outputDir, "02-master-data.json"),
    deathsRaw: join(options.outputDir, "03-deaths-raw.json"),
    damageTakenRaw: join(options.outputDir, "04-damage-taken-raw.json"),
    castsRaw: join(options.outputDir, "05-casts-raw.json"),
    buffsRaw: join(options.outputDir, "06-buffs-raw.json"),
    healingRaw: join(options.outputDir, "07-healing-raw.json"),
    combatantInfoRaw: join(options.outputDir, "08-combatant-info-raw.json"),
    survivalNormalized: join(options.outputDir, "09-survival-normalized.json"),
    survivalDiagnostics: join(options.outputDir, "10-survival-diagnostics.json"),
  };

  await Promise.all([
    writeJson(outputFiles.characterAndReportResolution, resolutionPayload),
    writeJson(outputFiles.masterData, masterDataPayload),
    writeJson(outputFiles.deathsRaw, eventDatasets.Deaths),
    writeJson(outputFiles.damageTakenRaw, eventDatasets.DamageTaken),
    writeJson(outputFiles.castsRaw, eventDatasets.Casts),
    writeJson(outputFiles.buffsRaw, eventDatasets.Buffs),
    writeJson(outputFiles.healingRaw, eventDatasets.Healing),
    writeJson(outputFiles.combatantInfoRaw, eventDatasets.CombatantInfo),
    writeJson(outputFiles.survivalNormalized, normalized),
    writeJson(outputFiles.survivalDiagnostics, {
      ...diagnostics,
      rateLimit: dataset.rateLimit,
      state,
    }),
  ]);

  return { dataset, outputFiles };
}
