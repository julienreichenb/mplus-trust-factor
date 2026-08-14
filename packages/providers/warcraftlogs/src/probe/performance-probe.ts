import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterIdentityInput } from "@mplus/contracts";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { parseRateLimitSnapshot } from "../rate/rate-budget.js";
import { mapRegionToWcl } from "../discovery/run-discovery.js";
import { type MplusZoneConfig } from "../discovery/mplus-zone.js";
import { OPERATIONS } from "../operations/queries.js";
import type { WclRateLimitSnapshot } from "../types.js";
import {
  SPEED_FASTESTKILL_ENCODING_NOTE,
  buildZoneEncounters,
  collectUnavailableEncounters,
  mergePointsAndDamage,
  normalizePointsAndDamage,
  parseJsonScalar,
  resolveCurrentPartition,
} from "./performance-probe-logic.js";
import type {
  GraphQlErrorRecord,
  PerformanceProbeDataset,
  PerformanceProbeIdentity,
  ProbeCharacterRecord,
  ProbeRateLimitRecord,
  ProbeZoneRecord,
} from "./types.js";

export interface PerformanceProbeOptions {
  identity: PerformanceProbeIdentity;
  outputDir: string;
  client: WclGraphQlClient;
  zoneConfig?: MplusZoneConfig;
  partition?: number | null;
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

export async function cleanProbeOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const entries = await readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => rm(join(outputDir, entry.name), { recursive: true, force: true })),
  );
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

async function fetchPointsAndDamage(
  client: WclGraphQlClient,
  identity: PerformanceProbeIdentity,
  zoneId: number,
  partition: number | null,
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<{ raw: unknown; ok: boolean }> {
  const operation = OPERATIONS.CharacterZoneRankingsPointsAndDamage;
  const variables: Record<string, unknown> = {
    name: identity.name,
    serverSlug: identity.realmSlug,
    serverRegion: mapRegionToWcl(identity.region),
    zoneID: zoneId,
  };
  if (partition != null) variables.partition = partition;

  const result = await client.requestPermissive<{
    characterData?: { character?: { zoneRankings?: unknown } | null };
  }>({
    operationName: operation.operationName,
    query: operation.query,
    variables,
    region: identity.region,
  });

  const messages = collectGraphQlErrors(graphqlErrors, operation.operationName, result.response.errors);
  perOperation.push({
    operationName: operation.operationName,
    costUnits: result.costUnits,
    durationMs: result.durationMs,
    snapshot: rateLimitFromExtensions(result.response.extensions),
  });

  if (messages.length > 0) {
    return { raw: null, ok: false };
  }

  const raw = parseJsonScalar(result.response.data?.characterData?.character?.zoneRankings ?? null);
  if (raw == null) {
    graphqlErrors.push({
      operationName: operation.operationName,
      messages: [`${operation.operationName}: zoneRankings payload was null`],
    });
    return { raw: null, ok: false };
  }

  return { raw, ok: true };
}

const PROBE_OK_NOTE =
  "Performance uses Character.zoneRankings metric:points_and_damage (Points & Damage By Level). " +
  "Throughput Best%/Median%/DPS come from throughputRankings, not a standalone dps query. " +
  "Global Best/Median averages are arithmetic means of the 8 per-dungeon percentiles. " +
  "Displayed run counts are contextual; throughput sample size may differ. " +
  `${SPEED_FASTESTKILL_ENCODING_NOTE} ` +
  "No recentReports / report.fights / masterData / events.";

export async function runPerformanceProbe(
  options: PerformanceProbeOptions,
): Promise<PerformanceProbeResult> {
  const probedAt = (options.now ?? new Date()).toISOString();
  const zoneConfig =
    options.zoneConfig ??
    (() => {
      throw new Error(
        "Performance probe requires zoneConfig (explicit --zone-id / constructor zoneId from catalog).",
      );
    })();

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
    options.partition,
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

  const fetchResult = await fetchPointsAndDamage(
    options.client,
    options.identity,
    zoneConfig.zoneId,
    zone.partitionUsed,
    graphqlErrors,
    perOperation,
  );

  const state: "OK" | "ERROR" = fetchResult.ok ? "OK" : "ERROR";

  let summary: PerformanceProbeDataset["summary"] = {
    global: null,
    dungeons: [],
    unavailableEncounters: [],
  };
  let averageComparison: PerformanceProbeDataset["diagnostics"]["averageComparison"] = null;
  let payloadTopKeys: string[] = [];

  if (fetchResult.ok) {
    const normalized = normalizePointsAndDamage(fetchResult.raw);
    payloadTopKeys = normalized.payloadTopKeys;
    const merged = mergePointsAndDamage(normalized);
    const scoreIds = new Set(
      normalized.scoreDungeons
        .map((d) => d.encounterId)
        .filter((id): id is number => id != null),
    );
    const throughputIds = new Set(
      normalized.throughputDungeons
        .map((d) => d.encounterId)
        .filter((id): id is number => id != null),
    );
    summary = {
      global: merged.global,
      dungeons: merged.dungeons,
      unavailableEncounters: collectUnavailableEncounters(
        zone.worldData?.encounters ?? [],
        scoreIds,
        throughputIds,
      ),
    };
    averageComparison = {
      computedBestAverage: merged.global.bestDpsPercentileAverage,
      wclBestPerformanceAverage: merged.global.wclBestPerformanceAverage,
      computedMedianAverage: merged.global.medianDpsPercentileAverage,
      wclMedianPerformanceAverage: merged.global.wclMedianPerformanceAverage,
    };
  }

  const rankingsPayload = {
    probedAt,
    identity: options.identity,
    zoneId: zoneConfig.zoneId,
    partition: zone.partitionUsed,
    metric: "points_and_damage" as const,
    state,
    payloadTopKeys,
    rawZoneRankings: fetchResult.raw,
    normalized: fetchResult.ok ? normalizePointsAndDamage(fetchResult.raw) : null,
    graphqlErrors: graphqlErrors.filter(
      (e) => e.operationName === OPERATIONS.CharacterZoneRankingsPointsAndDamage.operationName,
    ),
    rateLimit: perOperation.filter(
      (r) => r.operationName === OPERATIONS.CharacterZoneRankingsPointsAndDamage.operationName,
    ),
  };

  const finalRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
  );

  const dataset: PerformanceProbeDataset = {
    probeVersion: "4",
    probedAt,
    identity: options.identity,
    state,
    character,
    zone,
    summary,
    rawZoneRankingsPointsAndDamage: fetchResult.raw,
    diagnostics: {
      source: "character.zoneRankings",
      state,
      query: {
        zoneID: zoneConfig.zoneId,
        metric: "points_and_damage",
        byBracket: true,
        partition: zone.partitionUsed,
        ok: fetchResult.ok,
      },
      dungeonRowCount: summary.dungeons.length,
      unavailableEncounterCount: summary.unavailableEncounters.length,
      averageComparison,
      note:
        state === "ERROR"
          ? "ERROR: points_and_damage zoneRankings query failed. GraphQL errors are listed; " +
            "summary is empty (no fabricated unavailable encounters or zeroed rankings)."
          : PROBE_OK_NOTE,
    },
    graphqlErrors,
    rateLimit: {
      initial: initialRateLimit,
      final: finalRateLimit,
      perOperation,
    },
  };

  await cleanProbeOutputDir(options.outputDir);
  const outputFiles = {
    characterZone: join(options.outputDir, "01-character-zone.json"),
    zoneRankingsPointsAndDamage: join(options.outputDir, "02-zone-rankings-points-and-damage.json"),
    performanceDataset: join(options.outputDir, "04-performance-dataset.json"),
  };

  await Promise.all([
    writeJson(outputFiles.characterZone, characterZonePayload),
    writeJson(outputFiles.zoneRankingsPointsAndDamage, rankingsPayload),
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

export function buildPerformanceDatasetFromRaw(options: {
  identity: PerformanceProbeIdentity;
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  rawZoneRankingsPointsAndDamage: unknown;
  probedAt?: string;
}): PerformanceProbeDataset {
  const probedAt = options.probedAt ?? new Date().toISOString();
  const normalized = normalizePointsAndDamage(options.rawZoneRankingsPointsAndDamage);
  const merged = mergePointsAndDamage(normalized);
  const scoreIds = new Set(
    normalized.scoreDungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
  );
  const throughputIds = new Set(
    normalized.throughputDungeons
      .map((d) => d.encounterId)
      .filter((id): id is number => id != null),
  );
  const unavailableEncounters = collectUnavailableEncounters(
    options.zone.worldData?.encounters ?? [],
    scoreIds,
    throughputIds,
  );

  return {
    probeVersion: "4",
    probedAt,
    identity: options.identity,
    state: "OK",
    character: options.character,
    zone: options.zone,
    summary: {
      global: merged.global,
      dungeons: merged.dungeons,
      unavailableEncounters,
    },
    rawZoneRankingsPointsAndDamage: options.rawZoneRankingsPointsAndDamage,
    diagnostics: {
      source: "character.zoneRankings",
      state: "OK",
      query: {
        zoneID: options.zone.config.zoneId,
        metric: "points_and_damage",
        byBracket: true,
        partition: options.zone.partitionUsed,
        ok: true,
      },
      dungeonRowCount: merged.dungeons.length,
      unavailableEncounterCount: unavailableEncounters.length,
      averageComparison: {
        computedBestAverage: merged.global.bestDpsPercentileAverage,
        wclBestPerformanceAverage: merged.global.wclBestPerformanceAverage,
        computedMedianAverage: merged.global.medianDpsPercentileAverage,
        wclMedianPerformanceAverage: merged.global.wclMedianPerformanceAverage,
      },
      note: PROBE_OK_NOTE,
    },
    graphqlErrors: [],
    rateLimit: { initial: null, final: null, perOperation: [] },
  };
}
