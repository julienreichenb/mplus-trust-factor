import type { WclGraphQlClient } from "../client/graphql-client.js";
import { OPERATIONS, type EventDataType } from "../operations/queries.js";
import type { SurvivalCalibrationRun } from "./survival-calibration-types.js";
import type { SurvivalProbeIdentity } from "./survival-probe-types.js";
import {
  collectExplicitHealthSnapshots,
  collectHealthFromPlayerDetails,
  discoverHealthSchemaVariants,
} from "./survival-v1_1-health.js";
import type { ExplicitHealthSnapshot, HealthSchemaVariant } from "./survival-v1_1-types.js";

export type HealthDiscoveryDataType =
  | "DamageTaken"
  | "Healing"
  | "Deaths"
  | "Casts"
  | "Buffs"
  | "Resources"
  | "All";

export interface HealthDiscoveryRawDataset {
  dataType: HealthDiscoveryDataType | "playerDetails";
  includeResources: boolean;
  state: "OK" | "ERROR" | "EMPTY";
  pageCount: number;
  eventCount: number;
  truncated: boolean;
  events: Array<Record<string, unknown>>;
  rawPages: Array<{
    pageIndex: number;
    startTime: number | null;
    nextPageTimestamp: number | null;
    eventCount: number;
    rawResponseData: unknown;
    graphqlErrors: string[];
  }>;
  errors: string[];
}

export interface PerRunHealthDiscovery {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  playerActorId: number;
  datasets: HealthDiscoveryRawDataset[];
  snapshots: ExplicitHealthSnapshot[];
  schemaVariants: HealthSchemaVariant[];
  wclRequestCount: number;
}

function collectGraphQlErrors(
  sink: Array<{ operationName: string; message: string }>,
  operationName: string,
  errors: Array<{ message?: string }> | undefined,
): string[] {
  const messages = (errors ?? []).map((e) => e.message ?? "unknown GraphQL error");
  for (const message of messages) sink.push({ operationName, message });
  return messages;
}

export async function fetchEventsWithOptionalResources(
  client: WclGraphQlClient,
  input: {
    identity: SurvivalProbeIdentity;
    reportCode: string;
    fightId: number;
    dataType: HealthDiscoveryDataType;
    sourceId: number | null;
    includeResources: boolean;
    startTime?: number;
    endTime?: number;
    maxEventPages?: number;
    eventPageLimit?: number;
  },
): Promise<{ dataset: HealthDiscoveryRawDataset; requestCount: number }> {
  const maxPages = input.maxEventPages ?? 200;
  const pageLimit = input.eventPageLimit ?? 1000;
  const pages: HealthDiscoveryRawDataset["rawPages"] = [];
  const events: Array<Record<string, unknown>> = [];
  const datasetErrors: string[] = [];
  const graphqlSink: Array<{ operationName: string; message: string }> = [];
  let startTime: number | undefined = input.startTime;
  let truncated = false;
  let requestCount = 0;
  const seenTimestamps = new Set<number>();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const opName = `${OPERATIONS.ReportEvents.operationName}:${input.dataType}${input.includeResources ? "+resources" : ""}`;
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
        includeResources: input.includeResources ? true : undefined,
      },
      region: input.identity.region,
    });
    requestCount += 1;

    const messages = collectGraphQlErrors(graphqlSink, opName, result.response.errors);
    const pageEvents = result.response.data?.reportData?.report?.events?.data ?? [];
    const next = result.response.data?.reportData?.report?.events?.nextPageTimestamp ?? null;

    pages.push({
      pageIndex,
      startTime: startTime ?? null,
      nextPageTimestamp: next,
      eventCount: pageEvents.length,
      rawResponseData: result.response.data ?? null,
      graphqlErrors: messages,
    });

    if (messages.length > 0 && pageEvents.length === 0) {
      datasetErrors.push(...messages);
      return {
        dataset: {
          dataType: input.dataType,
          includeResources: input.includeResources,
          state: "ERROR",
          pageCount: pages.length,
          eventCount: 0,
          truncated: false,
          events: [],
          rawPages: pages,
          errors: datasetErrors,
        },
        requestCount,
      };
    }

    events.push(...pageEvents);
    if (next == null) break;
    if (seenTimestamps.has(next)) {
      truncated = true;
      break;
    }
    seenTimestamps.add(next);
    startTime = next;
    if (pageIndex === maxPages - 1) truncated = true;
  }

  return {
    dataset: {
      dataType: input.dataType,
      includeResources: input.includeResources,
      state: events.length === 0 ? "EMPTY" : "OK",
      pageCount: pages.length,
      eventCount: events.length,
      truncated,
      events,
      rawPages: pages,
      errors: datasetErrors,
    },
    requestCount,
  };
}

export async function fetchPlayerDetails(
  client: WclGraphQlClient,
  input: {
    identity: SurvivalProbeIdentity;
    reportCode: string;
    fightId: number;
  },
): Promise<{ dataset: HealthDiscoveryRawDataset; requestCount: number }> {
  const result = await client.requestPermissive<{
    reportData?: { report?: { playerDetails?: unknown } };
  }>({
    operationName: OPERATIONS.ReportPlayerDetails.operationName,
    query: OPERATIONS.ReportPlayerDetails.query,
    variables: {
      code: input.reportCode,
      fightIDs: [input.fightId],
      includeCombatantInfo: true,
    },
    region: input.identity.region,
  });

  const messages = (result.response.errors ?? []).map((e) => e.message ?? "unknown");
  const details = result.response.data?.reportData?.report?.playerDetails ?? null;
  const events =
    details == null
      ? []
      : Array.isArray(details)
        ? (details as Array<Record<string, unknown>>)
        : [details as Record<string, unknown>];

  return {
    dataset: {
      dataType: "playerDetails",
      includeResources: false,
      state: messages.length > 0 && events.length === 0 ? "ERROR" : events.length === 0 ? "EMPTY" : "OK",
      pageCount: 1,
      eventCount: events.length,
      truncated: false,
      events,
      rawPages: [
        {
          pageIndex: 0,
          startTime: null,
          nextPageTimestamp: null,
          eventCount: events.length,
          rawResponseData: result.response.data ?? null,
          graphqlErrors: messages,
        },
      ],
      errors: messages,
    },
    requestCount: 1,
  };
}

/**
 * Discover health sources for one calibration run.
 * Strategy: DamageTaken+resources (primary), Healing+resources, Deaths+resources,
 * Resources stream, playerDetails; optional narrow All around first death.
 */
export async function discoverHealthSourcesForRun(
  client: WclGraphQlClient,
  input: {
    identity: SurvivalProbeIdentity;
    run: SurvivalCalibrationRun;
    /** When true, also fetch EventDataType.All in a narrow window around first death. */
    fetchNarrowAllAroundDeath?: boolean;
    /** When true, fetch Casts/Buffs with includeResources (costly). */
    fetchCastBuffResources?: boolean;
  },
): Promise<PerRunHealthDiscovery> {
  const run = input.run;
  const playerActorId = run.playerActorId;
  const datasets: HealthDiscoveryRawDataset[] = [];
  let wclRequestCount = 0;

  const primaryTypes: Array<{
    dataType: HealthDiscoveryDataType;
    sourceId: number | null;
    includeResources: boolean;
  }> = [
    { dataType: "DamageTaken", sourceId: playerActorId, includeResources: true },
    { dataType: "Healing", sourceId: playerActorId, includeResources: true },
    { dataType: "Deaths", sourceId: playerActorId, includeResources: true },
    { dataType: "Resources", sourceId: playerActorId, includeResources: false },
  ];

  if (input.fetchCastBuffResources) {
    primaryTypes.push(
      { dataType: "Casts", sourceId: playerActorId, includeResources: true },
      { dataType: "Buffs", sourceId: playerActorId, includeResources: true },
    );
  }

  for (const spec of primaryTypes) {
    const { dataset, requestCount } = await fetchEventsWithOptionalResources(client, {
      identity: input.identity,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dataType: spec.dataType,
      sourceId: spec.sourceId,
      includeResources: spec.includeResources,
    });
    datasets.push(dataset);
    wclRequestCount += requestCount;
  }

  {
    const { dataset, requestCount } = await fetchPlayerDetails(client, {
      identity: input.identity,
      reportCode: run.reportCode,
      fightId: run.fightId,
    });
    datasets.push(dataset);
    wclRequestCount += requestCount;
  }

  if (input.fetchNarrowAllAroundDeath) {
    const deathTs = run.deaths.deaths
      .map((d) => d.timestamp)
      .filter((t): t is number => t != null)
      .sort((a, b) => a - b)[0];
    if (deathTs != null) {
      const { dataset, requestCount } = await fetchEventsWithOptionalResources(client, {
        identity: input.identity,
        reportCode: run.reportCode,
        fightId: run.fightId,
        dataType: "All",
        sourceId: playerActorId,
        includeResources: true,
        startTime: Math.max(run.normalized.run.startTime, deathTs - 10_000),
        endTime: Math.min(run.normalized.run.endTime, deathTs + 2_000),
        maxEventPages: 5,
      });
      datasets.push(dataset);
      wclRequestCount += requestCount;
    }
  }

  const snapshots: ExplicitHealthSnapshot[] = [];
  const schemaVariants: HealthSchemaVariant[] = [];

  for (const ds of datasets) {
    if (ds.dataType === "playerDetails") {
      snapshots.push(
        ...collectHealthFromPlayerDetails(
          ds.rawPages[0]?.rawResponseData,
          playerActorId,
          input.identity.name,
        ),
      );
      schemaVariants.push(
        ...discoverHealthSchemaVariants(
          ds.rawPages[0]?.rawResponseData,
          `${run.runId}:playerDetails`,
          "playerDetails",
        ),
      );
      continue;
    }
    snapshots.push(...collectExplicitHealthSnapshots(ds.events, ds.dataType, playerActorId));
    // Sample first page + up to 20 events for schema discovery
    schemaVariants.push(
      ...discoverHealthSchemaVariants(ds.events.slice(0, 20), `${run.runId}:${ds.dataType}`, ds.dataType),
    );
    if (ds.rawPages[0]) {
      schemaVariants.push(
        ...discoverHealthSchemaVariants(
          ds.rawPages[0].rawResponseData,
          `${run.runId}:${ds.dataType}:rawPage0`,
          ds.dataType,
        ),
      );
    }
  }

  // Also inspect existing calibration combatantInfo (offline baseline)
  if (run.normalized.combatantInfo.raw) {
    schemaVariants.push(
      ...discoverHealthSchemaVariants(
        run.normalized.combatantInfo.raw,
        `${run.runId}:calibrationCombatantInfo`,
        "CombatantInfo",
      ),
    );
    snapshots.push(
      ...collectExplicitHealthSnapshots(
        [run.normalized.combatantInfo.raw as Record<string, unknown>],
        "CombatantInfo",
        playerActorId,
      ),
    );
  }

  return {
    runId: run.runId,
    reportCode: run.reportCode,
    fightId: run.fightId,
    dungeonSlug: run.dungeonSlug,
    playerActorId,
    datasets,
    snapshots,
    schemaVariants,
    wclRequestCount,
  };
}
