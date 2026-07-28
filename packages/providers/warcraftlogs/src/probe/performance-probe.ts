import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterIdentityInput } from "@mplus/contracts";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { parseRateLimitSnapshot } from "../rate/rate-budget.js";
import { mapRegionToWcl } from "../discovery/run-discovery.js";
import { resolveMplusZoneConfig, type MplusZoneConfig } from "../discovery/mplus-zone.js";
import { OPERATIONS } from "../operations/queries.js";
import type { WclRateLimitSnapshot } from "../types.js";
import {
  SPEED_FASTESTKILL_ENCODING_NOTE,
  buildZoneEncounters,
  collectUnavailableEncounters,
  mergeScoreAndExecution,
  normalizeExecutionZoneRankings,
  normalizeScoreZoneRankings,
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

/** Remove prior probe artifacts so only the current four files remain. */
export async function cleanProbeOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const entries = await readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      rm(join(outputDir, entry.name), { recursive: true, force: true }),
    ),
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

async function fetchZoneRankingsByMetric(
  client: WclGraphQlClient,
  identity: PerformanceProbeIdentity,
  zoneId: number,
  partition: number | null,
  metric: "playerscore" | "dps",
  graphqlErrors: GraphQlErrorRecord[],
  perOperation: ProbeRateLimitRecord[],
): Promise<{ raw: unknown; ok: boolean; messages: string[] }> {
  const operation =
    metric === "playerscore"
      ? OPERATIONS.CharacterZoneRankingsPerformanceScore
      : OPERATIONS.CharacterZoneRankingsPerformanceExecution;
  const operationLabel = `${operation.operationName}`;
  const variables: Record<string, unknown> = {
    name: identity.name,
    serverSlug: identity.realmSlug,
    serverRegion: mapRegionToWcl(identity.region),
    zoneID: zoneId,
  };
  if (partition != null) {
    variables.partition = partition;
  }

  const result = await client.requestPermissive<{
    characterData?: {
      character?: {
        zoneRankings?: unknown;
      } | null;
    };
  }>({
    operationName: operation.operationName,
    query: operation.query,
    variables,
    region: identity.region,
  });
  const messages = collectGraphQlErrors(graphqlErrors, operationLabel, result.response.errors);
  perOperation.push({
    operationName: operationLabel,
    costUnits: result.costUnits,
    durationMs: result.durationMs,
    snapshot: rateLimitFromExtensions(result.response.extensions),
  });

  if (messages.length > 0) {
    return { raw: null, ok: false, messages };
  }

  const raw = parseJsonScalar(
    result.response.data?.characterData?.character?.zoneRankings ?? null,
  );
  if (raw == null) {
    const missing = [`${operationLabel}: zoneRankings payload was null`];
    graphqlErrors.push({ operationName: operationLabel, messages: missing });
    return { raw: null, ok: false, messages: missing };
  }

  return { raw, ok: true, messages: [] };
}

const PROBE_OK_NOTE =
  "Performance merges independent playerscore + dps zoneRankings by encounter.id. " +
  "Logged run counts affect confidence only. " +
  "scoreRankPercent is not an execution percentile. " +
  `${SPEED_FASTESTKILL_ENCODING_NOTE} ` +
  "No recentReports / report.fights / masterData / events.";

/**
 * Read-only Performance probe: dual Character.zoneRankings (playerscore + dps).
 * Does not call recentReports, report.fights, masterData, or events.
 */
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

  const scoreFetch = await fetchZoneRankingsByMetric(
    options.client,
    options.identity,
    zoneConfig.zoneId,
    zone.partitionUsed,
    "playerscore",
    graphqlErrors,
    perOperation,
  );
  const executionFetch = await fetchZoneRankingsByMetric(
    options.client,
    options.identity,
    zoneConfig.zoneId,
    zone.partitionUsed,
    "dps",
    graphqlErrors,
    perOperation,
  );

  const rankingQueryFailed = !scoreFetch.ok || !executionFetch.ok;
  const state: "OK" | "ERROR" = rankingQueryFailed ? "ERROR" : "OK";

  let summary: PerformanceProbeDataset["summary"] = {
    global: null,
    dungeons: [],
    unavailableEncounters: [],
  };

  if (!rankingQueryFailed) {
    const score = normalizeScoreZoneRankings(scoreFetch.raw);
    const execution = normalizeExecutionZoneRankings(executionFetch.raw);
    const merged = mergeScoreAndExecution(score, execution);
    const scoreIds = new Set(
      score.dungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
    );
    const executionIds = new Set(
      execution.dungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
    );
    summary = {
      global: merged.global,
      dungeons: merged.dungeons,
      unavailableEncounters: collectUnavailableEncounters(
        zone.worldData?.encounters ?? [],
        merged.dungeons,
        scoreIds,
        executionIds,
      ),
    };
  }

  const scorePayload = {
    probedAt,
    identity: options.identity,
    zoneId: zoneConfig.zoneId,
    partition: zone.partitionUsed,
    metric: "playerscore" as const,
    state: scoreFetch.ok ? ("OK" as const) : ("ERROR" as const),
    rawZoneRankings: scoreFetch.raw,
    normalized: scoreFetch.ok ? normalizeScoreZoneRankings(scoreFetch.raw) : null,
    graphqlErrors: graphqlErrors.filter(
      (e) => e.operationName === OPERATIONS.CharacterZoneRankingsPerformanceScore.operationName,
    ),
    rateLimit: perOperation.filter(
      (r) => r.operationName === OPERATIONS.CharacterZoneRankingsPerformanceScore.operationName,
    ),
  };

  const executionPayload = {
    probedAt,
    identity: options.identity,
    zoneId: zoneConfig.zoneId,
    partition: zone.partitionUsed,
    metric: "dps" as const,
    state: executionFetch.ok ? ("OK" as const) : ("ERROR" as const),
    rawZoneRankings: executionFetch.raw,
    normalized: executionFetch.ok ? normalizeExecutionZoneRankings(executionFetch.raw) : null,
    graphqlErrors: graphqlErrors.filter(
      (e) => e.operationName === OPERATIONS.CharacterZoneRankingsPerformanceExecution.operationName,
    ),
    rateLimit: perOperation.filter(
      (r) => r.operationName === OPERATIONS.CharacterZoneRankingsPerformanceExecution.operationName,
    ),
  };

  const finalRateLimit = await fetchRateLimitData(
    options.client,
    options.identity.region,
    graphqlErrors,
    perOperation,
  );

  const dataset: PerformanceProbeDataset = {
    probeVersion: "3",
    probedAt,
    identity: options.identity,
    state,
    character,
    zone,
    summary,
    rawZoneRankingsScore: scoreFetch.raw,
    rawZoneRankingsExecution: executionFetch.raw,
    diagnostics: {
      source: "character.zoneRankings",
      state,
      scoreQuery: {
        zoneID: zoneConfig.zoneId,
        metric: "playerscore",
        byBracket: true,
        partition: zone.partitionUsed,
        ok: scoreFetch.ok,
      },
      executionQuery: {
        zoneID: zoneConfig.zoneId,
        metric: "dps",
        byBracket: true,
        partition: zone.partitionUsed,
        ok: executionFetch.ok,
      },
      dungeonRowCount: summary.dungeons.length,
      unavailableEncounterCount: summary.unavailableEncounters.length,
      note: rankingQueryFailed
        ? "ERROR: one or both zoneRankings queries failed. GraphQL errors are listed; " +
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
    zoneRankingsScore: join(options.outputDir, "02-zone-rankings-score.json"),
    zoneRankingsExecution: join(options.outputDir, "03-zone-rankings-execution.json"),
    performanceDataset: join(options.outputDir, "04-performance-dataset.json"),
  };

  await Promise.all([
    writeJson(outputFiles.characterZone, characterZonePayload),
    writeJson(outputFiles.zoneRankingsScore, scorePayload),
    writeJson(outputFiles.zoneRankingsExecution, executionPayload),
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

/** Offline merge helper for fixtures / tests (no network). */
export function buildPerformanceDatasetFromRaw(options: {
  identity: PerformanceProbeIdentity;
  character: ProbeCharacterRecord | null;
  zone: ProbeZoneRecord;
  rawZoneRankingsScore: unknown;
  rawZoneRankingsExecution: unknown;
  probedAt?: string;
}): PerformanceProbeDataset {
  const probedAt = options.probedAt ?? new Date().toISOString();
  const score = normalizeScoreZoneRankings(options.rawZoneRankingsScore);
  const execution = normalizeExecutionZoneRankings(options.rawZoneRankingsExecution);
  const merged = mergeScoreAndExecution(score, execution);
  const scoreIds = new Set(
    score.dungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
  );
  const executionIds = new Set(
    execution.dungeons.map((d) => d.encounterId).filter((id): id is number => id != null),
  );
  const unavailableEncounters = collectUnavailableEncounters(
    options.zone.worldData?.encounters ?? [],
    merged.dungeons,
    scoreIds,
    executionIds,
  );

  return {
    probeVersion: "3",
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
    rawZoneRankingsScore: options.rawZoneRankingsScore,
    rawZoneRankingsExecution: options.rawZoneRankingsExecution,
    diagnostics: {
      source: "character.zoneRankings",
      state: "OK",
      scoreQuery: {
        zoneID: options.zone.config.zoneId,
        metric: "playerscore",
        byBracket: true,
        partition: options.zone.partitionUsed,
        ok: true,
      },
      executionQuery: {
        zoneID: options.zone.config.zoneId,
        metric: "dps",
        byBracket: true,
        partition: options.zone.partitionUsed,
        ok: true,
      },
      dungeonRowCount: merged.dungeons.length,
      unavailableEncounterCount: unavailableEncounters.length,
      note: PROBE_OK_NOTE,
    },
    graphqlErrors: [],
    rateLimit: { initial: null, final: null, perOperation: [] },
  };
}
