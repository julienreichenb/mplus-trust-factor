import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterIdentityInput } from "@mplus/contracts";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { parseRateLimitSnapshot } from "../rate/rate-budget.js";
import { mapRegionToWcl } from "../discovery/run-discovery.js";
import { resolveMplusZoneConfig, type MplusZoneConfig } from "../discovery/mplus-zone.js";
import { OPERATIONS } from "../operations/queries.js";
import type { WclRateLimitSnapshot } from "../types.js";
import {
  PROBE_RECENT_REPORTS_PAGE_LIMIT,
  buildZoneEncounters,
  collectUnavailableEncounters,
  fightToEligibleRun,
  isEligibleMplusFight,
  isPublicAccessibleReport,
  mapRawFightRow,
  parseJsonScalar,
  selectHighestRatedRunPerEncounter,
  zoneEncounterIdSet,
} from "./performance-probe-logic.js";
import type {
  EligibleLoggedRun,
  GraphQlErrorRecord,
  PerformanceProbeDataset,
  PerformanceProbeIdentity,
  ProbeCharacterRecord,
  ProbeRateLimitRecord,
  ProbeReportFightsRecord,
  ProbeReportPage,
  ProbeRecentReportRow,
  ProbeZoneRecord,
} from "./types.js";

export interface PerformanceProbeOptions {
  identity: PerformanceProbeIdentity;
  outputDir: string;
  client: WclGraphQlClient;
  zoneConfig?: MplusZoneConfig;
  now?: Date;
}

export interface PerformanceProbeResult {
  dataset: PerformanceProbeDataset;
  outputFiles: Record<string, string>;
}

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
  extensions: { rateLimit?: { cost?: number; limitPerHour?: number; pointsSpentThisHour?: number; pointsResetIn?: number } } | undefined,
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
  identity: PerformanceProbeIdentity,
  zoneConfig: MplusZoneConfig,
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
          }
        : {
            id: zoneConfig.zoneId,
            name: `zone-${zoneConfig.zoneId}`,
            frozen: null,
            encounters,
          },
    },
  };
}

async function fetchZoneRankingsRaw(
  client: WclGraphQlClient,
  identity: PerformanceProbeIdentity,
  zoneId: number,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<unknown> {
  const result = await client.requestPermissive<{
    characterData?: {
      character?: {
        zoneRankings?: unknown;
      } | null;
    };
  }>({
    operationName: OPERATIONS.CharacterZoneRankings.operationName,
    query: OPERATIONS.CharacterZoneRankings.query,
    variables: {
      name: identity.name,
      serverSlug: identity.realmSlug,
      serverRegion: mapRegionToWcl(identity.region),
      zoneID: zoneId,
    },
    region: identity.region,
  });
  collectGraphQlErrors(
    graphqlErrors,
    OPERATIONS.CharacterZoneRankings.operationName,
    result.response.errors,
  );
  perOperation.push({
    operationName: OPERATIONS.CharacterZoneRankings.operationName,
    costUnits: result.costUnits,
    durationMs: result.durationMs,
    snapshot: rateLimitFromExtensions(result.response.extensions),
  });
  const raw = result.response.data?.characterData?.character?.zoneRankings ?? null;
  return parseJsonScalar(raw);
}

async function paginateRecentReports(
  client: WclGraphQlClient,
  identity: PerformanceProbeIdentity,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<{ pages: ProbeReportPage[]; publicReports: ProbeRecentReportRow[] }> {
  const pages: ProbeReportPage[] = [];
  const publicReports: ProbeRecentReportRow[] = [];
  const wclRegion = mapRegionToWcl(identity.region);
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const result = await client.requestPermissive<{
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
    }>({
      operationName: OPERATIONS.CharacterRecentReports.operationName,
      query: OPERATIONS.CharacterRecentReports.query,
      variables: {
        name: identity.name,
        serverSlug: identity.realmSlug,
        serverRegion: wclRegion,
        limit: PROBE_RECENT_REPORTS_PAGE_LIMIT,
        page,
      },
      region: identity.region,
    });

    const messages = collectGraphQlErrors(
      graphqlErrors,
      `${OPERATIONS.CharacterRecentReports.operationName}:page${page}`,
      result.response.errors,
    );
    perOperation.push({
      operationName: `${OPERATIONS.CharacterRecentReports.operationName}:page${page}`,
      costUnits: result.costUnits,
      durationMs: result.durationMs,
      snapshot: rateLimitFromExtensions(result.response.extensions),
    });

    const recent = result.response.data?.characterData?.character?.recentReports;
    const rows = (recent?.data ?? []).map((row) => ({
      code: row.code,
      title: row.title ?? null,
      startTime: row.startTime,
      endTime: row.endTime ?? null,
      visibility: row.visibility ?? null,
      zone: row.zone ? { id: row.zone.id, name: row.zone.name ?? null } : null,
    }));

    pages.push({
      page,
      limit: PROBE_RECENT_REPORTS_PAGE_LIMIT,
      total: recent?.total ?? null,
      hasMorePages: recent?.has_more_pages ?? null,
      reports: rows,
      graphqlErrors: messages,
      costUnits: result.costUnits,
      durationMs: result.durationMs,
    });

    for (const row of rows) {
      if (isPublicAccessibleReport(row.visibility)) {
        publicReports.push(row);
      }
    }

    hasMore = recent?.has_more_pages === true;
    page += 1;
    if (!recent || rows.length === 0) break;
  }

  return { pages, publicReports };
}

async function fetchReportFights(
  client: WclGraphQlClient,
  identity: PerformanceProbeIdentity,
  reportCode: string,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<ProbeReportFightsRecord> {
  try {
    const result = await client.requestPermissive<{
      reportData?: {
        report?: {
          code: string;
          title?: string | null;
          startTime: number;
          endTime?: number | null;
          visibility?: string | null;
          zone?: { id: number; name?: string | null } | null;
          fights?: Array<Record<string, unknown>>;
        } | null;
      };
    }>({
      operationName: OPERATIONS.ReportFightsForPerformanceProbe.operationName,
      query: OPERATIONS.ReportFightsForPerformanceProbe.query,
      variables: { code: reportCode },
      region: identity.region,
    });

    const messages = collectGraphQlErrors(
      graphqlErrors,
      `${OPERATIONS.ReportFightsForPerformanceProbe.operationName}:${reportCode}`,
      result.response.errors,
    );
    perOperation.push({
      operationName: `${OPERATIONS.ReportFightsForPerformanceProbe.operationName}:${reportCode}`,
      costUnits: result.costUnits,
      durationMs: result.durationMs,
      snapshot: rateLimitFromExtensions(result.response.extensions),
    });

    const report = result.response.data?.reportData?.report ?? null;
    const reportStartTimeMs = report?.startTime ?? 0;
    const fights = (report?.fights ?? []).map((fight) => mapRawFightRow(fight, reportStartTimeMs));

    return {
      reportCode,
      report: report
        ? {
            code: report.code,
            title: report.title ?? null,
            startTime: report.startTime,
            endTime: report.endTime ?? null,
            visibility: report.visibility ?? null,
            zone: report.zone ? { id: report.zone.id, name: report.zone.name ?? null } : null,
          }
        : null,
      fights,
      graphqlErrors: messages,
      costUnits: result.costUnits,
      durationMs: result.durationMs,
      fetchError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      reportCode,
      report: null,
      fights: [],
      graphqlErrors: [],
      costUnits: null,
      durationMs: 0,
      fetchError: message,
    };
  }
}

export async function runPerformanceProbe(
  options: PerformanceProbeOptions,
): Promise<PerformanceProbeResult> {
  const probedAt = (options.now ?? new Date()).toISOString();
  const zoneConfig =
    options.zoneConfig ??
    resolveMplusZoneConfig({
      env: process.env,
      allowFixtureDefault: false,
    });

  const graphqlErrors: GraphQlErrorRecord[] = [];
  const perOperation: ProbeRateLimitRecord[] = [];

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
    graphqlErrors,
    perOperation,
  );

  const characterZonePayload = {
    probedAt,
    identity: options.identity,
    character,
    zone,
    graphqlErrors: graphqlErrors.filter(
      (e) =>
        e.operationName === OPERATIONS.ResolveCharacter.operationName ||
        e.operationName === OPERATIONS.WorldDataZone.operationName,
    ),
    rateLimit: {
      initial: initialRateLimit,
      perOperation: perOperation.filter(
        (r) =>
          r.operationName === OPERATIONS.RateLimitData.operationName ||
          r.operationName === OPERATIONS.ResolveCharacter.operationName ||
          r.operationName === OPERATIONS.WorldDataZone.operationName,
      ),
    },
  };

  const rawZoneRankings = await fetchZoneRankingsRaw(
    options.client,
    options.identity,
    zoneConfig.zoneId,
    graphqlErrors,
    perOperation,
  );

  const zoneRankingsPayload = {
    probedAt,
    identity: options.identity,
    zoneId: zoneConfig.zoneId,
    rawZoneRankings,
    graphqlErrors: graphqlErrors.filter(
      (e) => e.operationName === OPERATIONS.CharacterZoneRankings.operationName,
    ),
    rateLimit: perOperation.filter(
      (r) => r.operationName === OPERATIONS.CharacterZoneRankings.operationName,
    ),
  };

  const { pages, publicReports } = await paginateRecentReports(
    options.client,
    options.identity,
    graphqlErrors,
    perOperation,
  );

  const reportPagesPayload = {
    probedAt,
    identity: options.identity,
    paginationDiagnostics: {
      pageLimit: PROBE_RECENT_REPORTS_PAGE_LIMIT,
      pagesFetched: pages.length,
      totalReportsListed: pages[0]?.total ?? null,
      publicReportsKept: publicReports.length,
    },
    pages,
    graphqlErrors: graphqlErrors.filter((e) =>
      e.operationName.startsWith(OPERATIONS.CharacterRecentReports.operationName),
    ),
    rateLimit: perOperation.filter((r) =>
      r.operationName.startsWith(OPERATIONS.CharacterRecentReports.operationName),
    ),
  };

  const zoneEncounterIds = zoneEncounterIdSet(zone.worldData?.encounters ?? []);
  const reportFightRecords: ProbeReportFightsRecord[] = [];
  const eligibleLoggedRuns: EligibleLoggedRun[] = [];
  let totalFightsSeen = 0;

  for (const report of publicReports) {
    const record = await fetchReportFights(
      options.client,
      options.identity,
      report.code,
      graphqlErrors,
      perOperation,
    );
    reportFightRecords.push(record);
    if (!record.report) continue;

    totalFightsSeen += record.fights.length;
    for (const fight of record.fights) {
      if (!isEligibleMplusFight(fight, zoneEncounterIds)) continue;
      const eligible = fightToEligibleRun(
        fight,
        record.reportCode,
        record.report.startTime,
        zone.worldData?.encounters ?? [],
      );
      if (eligible) eligibleLoggedRuns.push(eligible);
    }
  }

  const reportFightsPayload = {
    probedAt,
    identity: options.identity,
    reports: reportFightRecords,
    graphqlErrors: graphqlErrors.filter((e) =>
      e.operationName.startsWith(OPERATIONS.ReportFightsForPerformanceProbe.operationName),
    ),
    rateLimit: perOperation.filter((r) =>
      r.operationName.startsWith(OPERATIONS.ReportFightsForPerformanceProbe.operationName),
    ),
  };

  const selectedHighestRatedRuns = selectHighestRatedRunPerEncounter(eligibleLoggedRuns);
  const unavailableEncounters = collectUnavailableEncounters(
    zone.worldData?.encounters ?? [],
    selectedHighestRatedRuns,
  );

  const finalRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
  );

  const dataset: PerformanceProbeDataset = {
    probeVersion: "1",
    probedAt,
    identity: options.identity,
    character,
    zone,
    reports: {
      totalFromApi: pages[0]?.total ?? null,
      publicAccessibleCount: publicReports.length,
      pagesFetched: pages.length,
      rows: publicReports,
    },
    eligibleLoggedRuns,
    selectedHighestRatedRuns,
    unavailableEncounters,
    rawZoneRankings,
    paginationDiagnostics: {
      pageLimit: PROBE_RECENT_REPORTS_PAGE_LIMIT,
      pagesFetched: pages.length,
      totalReportsListed: pages[0]?.total ?? null,
      publicReportsKept: publicReports.length,
      reportsWithFightsFetched: reportFightRecords.length,
      reportsWithFetchErrors: reportFightRecords.filter((r) => r.fetchError != null).length,
      totalFightsSeen,
      eligibleFightCount: eligibleLoggedRuns.length,
    },
    graphqlErrors,
    rateLimit: {
      initial: initialRateLimit,
      final: finalRateLimit,
      perOperation,
    },
  };

  await mkdir(options.outputDir, { recursive: true });
  const outputFiles = {
    characterZone: join(options.outputDir, "01-character-zone.json"),
    zoneRankings: join(options.outputDir, "02-zone-rankings.json"),
    reportPages: join(options.outputDir, "03-report-pages.json"),
    reportFights: join(options.outputDir, "04-report-fights.json"),
    performanceDataset: join(options.outputDir, "05-performance-dataset.json"),
  };

  await Promise.all([
    writeJson(outputFiles.characterZone, characterZonePayload),
    writeJson(outputFiles.zoneRankings, zoneRankingsPayload),
    writeJson(outputFiles.reportPages, reportPagesPayload),
    writeJson(outputFiles.reportFights, reportFightsPayload),
    writeJson(outputFiles.performanceDataset, dataset),
  ]);

  return { dataset, outputFiles };
}

export function toCharacterIdentityInput(
  identity: PerformanceProbeIdentity,
): CharacterIdentityInput {
  return {
    region: identity.region,
    realmSlug: identity.realmSlug,
    name: identity.name,
  };
}
