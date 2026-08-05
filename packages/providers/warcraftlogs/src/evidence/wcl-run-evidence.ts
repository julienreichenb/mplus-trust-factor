/**
 * Shared WCL evidence fetch helpers.
 * One logical fetch per report/fight/revision/dataset; pagination may use multiple HTTP requests.
 * HostileCasts uses filterExpression because Casts dataType alone returns friendly casts.
 */
import { createHash } from "node:crypto";
import {
  parseWithSchema,
  reportFightSchema,
  type WclGraphQlClient,
} from "../client/graphql-client.js";
import { OPERATIONS, type EventDataType } from "../operations/queries.js";
import {
  HOSTILE_CAST_FILTER_EXPRESSION,
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  WCL_RUN_EVIDENCE_SCHEMA_VERSION,
  buildSharedEvidenceCompatibilityKey,
  consumersForDataset,
  type SharedEvidenceDatasetKey,
  type SharedEvidencePaginationStopReason,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
  type WclRunEvidenceDatasetPage,
} from "./wcl-run-evidence-types.js";
import { resolveBatchCostAccounting } from "./wcl-batch-cost-accounting.js";
import {
  buildPaginationDiagnostics,
  decideSharedEvidencePageContinuation,
  eventIdentityKey,
  pageTimestampBounds,
  SharedEvidencePaginationError,
} from "./shared-evidence-pagination.js";

export {
  buildPaginationDiagnostics,
  computePaginationCoverageRatio,
  decideSharedEvidencePageContinuation,
  eventIdentityKey,
  SharedEvidencePaginationError,
} from "./shared-evidence-pagination.js";

export function fingerprintPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

export function dedupeEventsByIdentity(
  events: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const ev of events) {
    const key = eventIdentityKey(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

/** Datasets that need hitPoints/maxHitPoints for Survival max-HP parity. */
export const SHARED_EVIDENCE_RESOURCE_DATASETS: SharedEvidenceDatasetKey[] = [
  "DamageTaken",
  "Healing",
  "Deaths",
];

export function sharedEvidenceNeedsResources(dataset: SharedEvidenceDatasetKey): boolean {
  return SHARED_EVIDENCE_RESOURCE_DATASETS.includes(dataset);
}

export async function fetchSharedEventDataset(input: {
  client: WclGraphQlClient;
  reportCode: string;
  fightId: number;
  dataset: SharedEvidenceDatasetKey;
  sourceId?: number | null;
  filterExpression?: string | null;
  hostilityType?: "Friendlies" | "Enemies" | null;
  /** When true, request hitPoints/maxHitPoints (DamageTaken/Healing/Deaths). */
  includeResources?: boolean;
  maxPages?: number;
  pageLimit?: number;
  region?: string;
  /** Fight window start forwarded to ReportEvents. */
  startTime?: number | null;
  /** Fight window end forwarded to ReportEvents. */
  endTime?: number | null;
}): Promise<{
  dataset: WclRunEvidenceDataset;
  pointsConsumed: number | null;
  wclRequests: number;
}> {
  if (input.dataset === "masterData") {
    throw new Error("Use fetchSharedMasterData for masterData dataset");
  }

  const includeResources =
    input.includeResources === true ||
    (input.includeResources !== false && sharedEvidenceNeedsResources(input.dataset));
  const filterExpression =
    input.filterExpression ??
    (input.dataset === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null);
  const hostilityType =
    input.hostilityType ?? (input.dataset === "HostileCasts" ? "Enemies" : null);
  const dataType: EventDataType =
    input.dataset === "HostileCasts" ? "Casts" : (input.dataset as EventDataType);

  const maxPages = input.maxPages ?? 12;
  const pageLimit = input.pageLimit ?? 1000;
  const fightStartMs =
    input.startTime != null && Number.isFinite(input.startTime) ? input.startTime : null;
  const fightEndMs =
    input.endTime != null && Number.isFinite(input.endTime) ? input.endTime : null;

  const pages: WclRunEvidenceDatasetPage[] = [];
  const events: Array<Record<string, unknown>> = [];
  const requestCostUnits: Array<number | null> = [];
  const seenPageCursors = new Set<number>();
  const seenEventKeys = new Set<string>();
  let startTime: number | undefined = fightStartMs ?? undefined;
  let truncated = false;
  let wclRequests = 0;
  let state: WclRunEvidenceDataset["state"] = "OK";
  let stopReason: SharedEvidencePaginationStopReason = "MAX_PAGES";
  let complete = false;
  let lastNextPageTimestamp: number | null = null;
  let firstEventTimestampMs: number | null = null;
  let lastEventTimestampMs: number | null = null;
  let highWaterTimestamp: number | null = null;
  let hitMaxPages = false;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const result = await input.client.requestPermissive<{
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
        dataType,
        sourceID: input.sourceId ?? undefined,
        startTime,
        endTime: fightEndMs ?? undefined,
        limit: pageLimit,
        translate: false,
        useAbilityIDs: false,
        useActorIDs: false,
        includeResources: includeResources ? true : undefined,
        filterExpression: filterExpression ?? undefined,
        hostilityType: hostilityType ?? undefined,
      },
      region: input.region,
    });
    wclRequests += 1;
    requestCostUnits.push(result.costUnits ?? null);

    if (result.response.errors?.length) {
      state = "ERROR";
      stopReason = "GRAPHQL_ERROR";
      complete = false;
      truncated = true;
      break;
    }

    const page = result.response.data?.reportData?.report?.events;
    const pageEventsRaw = page?.data ?? [];
    const pageEvents: Array<Record<string, unknown>> = [];
    for (const ev of pageEventsRaw) {
      const key = eventIdentityKey(ev);
      if (seenEventKeys.has(key)) continue;
      seenEventKeys.add(key);
      pageEvents.push(ev);
    }

    const bounds = pageTimestampBounds(pageEvents);
    if (bounds.first != null) {
      firstEventTimestampMs =
        firstEventTimestampMs == null
          ? bounds.first
          : Math.min(firstEventTimestampMs, bounds.first);
    }
    if (bounds.last != null) {
      lastEventTimestampMs =
        lastEventTimestampMs == null
          ? bounds.last
          : Math.max(lastEventTimestampMs, bounds.last);
    }

    const nextRaw = page?.nextPageTimestamp;
    const next =
      typeof nextRaw === "number" && Number.isFinite(nextRaw) ? nextRaw : null;
    lastNextPageTimestamp = next;

    pages.push({
      pageIndex,
      startTime: startTime ?? null,
      nextPageTimestamp: next,
      eventCount: pageEvents.length,
      payloadFingerprint: fingerprintPayload({
        reportCode: input.reportCode,
        fightId: input.fightId,
        dataset: input.dataset,
        pageIndex,
        startTime: startTime ?? null,
        events: pageEvents,
      }),
    });
    events.push(...pageEvents);

    const decision = decideSharedEvidencePageContinuation({
      pageEventsRawCount: pageEventsRaw.length,
      pageLimit,
      nextPageTimestamp: next,
      pageLastTimestampMs: bounds.last,
      fightEndMs,
      seenPageCursors,
      highWaterTimestamp,
      datasetLabel: input.dataset,
    });

    if (bounds.last != null) {
      highWaterTimestamp =
        highWaterTimestamp == null ? bounds.last : Math.max(highWaterTimestamp, bounds.last);
    }

    if (decision.fail) {
      throw new SharedEvidencePaginationError(
        `Non-progressing ReportEvents cursor for ${input.dataset} at startTime=${startTime ?? "none"} next=${next ?? "null"} lastTs=${bounds.last ?? "none"}`,
        "NON_PROGRESSING_CURSOR",
      );
    }

    if (!decision.continue) {
      stopReason = decision.stopReason ?? "NEXT_PAGE_NULL";
      complete = decision.complete === true;
      truncated = decision.truncated === true;
      break;
    }

    if (decision.nextStartTime == null) {
      throw new SharedEvidencePaginationError(
        `Pagination continue without nextStartTime for ${input.dataset}`,
        "NON_PROGRESSING_CURSOR",
      );
    }
    seenPageCursors.add(decision.nextStartTime);
    startTime = decision.nextStartTime;

    if (pageIndex === maxPages - 1) {
      hitMaxPages = true;
    }
  }

  if (hitMaxPages && !complete) {
    stopReason = "MAX_PAGES";
    truncated = true;
    complete = false;
  }

  const pagination = buildPaginationDiagnostics({
    requestedFightStartMs: fightStartMs,
    requestedFightEndMs: fightEndMs,
    firstEventTimestampMs,
    lastEventTimestampMs,
    nextPageTimestamp: lastNextPageTimestamp,
    pageCount: pages.length,
    stopReason,
    complete,
  });

  const pageCost = resolveBatchCostAccounting({
    before: null,
    after: null,
    perRequestCostUnits: requestCostUnits,
    requestCount: wclRequests,
    pageCount: pages.length,
  });
  return {
    pointsConsumed: pageCost.pointsConsumed,
    wclRequests,
    dataset: {
      key: input.dataset,
      state,
      truncated,
      pageCount: pages.length,
      eventCount: events.length,
      filterSourceId: input.sourceId ?? null,
      filterExpression: [
        hostilityType != null ? `hostilityType=${hostilityType}` : null,
        includeResources ? "+resources" : null,
        filterExpression,
      ]
        .filter(Boolean)
        .join(";") || null,
      pages,
      events,
      consumers: consumersForDataset(input.dataset),
      pointsConsumed: pageCost.pointsConsumed,
      costSource: pageCost.costSource,
      requestCostUnits,
      wclRequests,
      fetchedAt: new Date().toISOString(),
      source: "provider",
      pagination,
    },
  };
}

export async function fetchSharedMasterData(input: {
  client: WclGraphQlClient;
  reportCode: string;
  fightId: number;
  region?: string;
}): Promise<{
  masterData: {
    actors: Array<{
      id: number;
      name?: string;
      type: string;
      subType?: string | null;
      petOwner?: number | null;
      server?: string | null;
    }>;
    abilities?: Array<{ gameID: number; type?: number | null }>;
  };
  wclRequests: number;
  pointsConsumed: number | null;
  costSource: "measured" | "estimated" | "unknown";
}> {
  const result = await input.client.request({
    operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
    query: OPERATIONS.ReportWithFightAndMasterData.query,
    variables: { code: input.reportCode, fightIDs: [input.fightId] },
    region: input.region,
  });
  const parsed = parseWithSchema(reportFightSchema, result.response.data, "ReportMasterData");
  const report = parsed.reportData.report;
  const actors = (report?.masterData?.actors ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    subType: a.subType ?? null,
    petOwner: a.petOwner ?? null,
    server: a.server ?? null,
  }));
  const cost =
    typeof result.costUnits === "number" && Number.isFinite(result.costUnits)
      ? result.costUnits
      : null;
  return {
    masterData: {
      actors,
      abilities: (report?.masterData?.abilities ?? []).map((ab) => ({
        gameID: ab.gameID,
        type: ab.type ?? null,
      })),
    },
    wclRequests: 1,
    pointsConsumed: cost,
    costSource: cost != null ? "measured" : "unknown",
  };
}

/**
 * When WCL masterData was never persisted, synthesize a minimal actor table from
 * the known target + owned pets so Utility can attribute pet-owned casts.
 */
export function synthesizeMasterDataFromActors(input: {
  playerActorId: number | null;
  ownedPetActorIds: number[];
}): { actors: Array<{ id: number; name: string; type: string; subType: null; petOwner: number | null }> } | null {
  if (input.playerActorId == null) return null;
  return {
    actors: [
      {
        id: input.playerActorId,
        name: "target",
        type: "Player",
        subType: null,
        petOwner: null,
      },
      ...input.ownedPetActorIds.map((id) => ({
        id,
        name: `pet-${id}`,
        type: "Pet",
        subType: null,
        petOwner: input.playerActorId,
      })),
    ],
  };
}

export function buildEmptyBundle(input: {
  reportCode: string;
  reportRevision: number | null;
  fightId: number;
  playerActorId: number | null;
  ownedPetActorIds: number[];
  dungeonSlug: string;
  startTime: number | null;
  endTime: number | null;
  consumers: Array<"survival" | "utility">;
}): WclRunEvidenceBundle {
  return {
    schemaVersion: WCL_RUN_EVIDENCE_SCHEMA_VERSION,
    analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    reportCode: input.reportCode,
    reportRevision: input.reportRevision,
    fightId: input.fightId,
    playerActorId: input.playerActorId,
    ownedPetActorIds: input.ownedPetActorIds,
    dungeonSlug: input.dungeonSlug,
    startTime: input.startTime,
    endTime: input.endTime,
    masterData: null,
    eventDatasets: {},
    completeness: {
      required: [],
      present: [],
      missing: [],
      truncated: [],
    },
    fetchedAt: new Date().toISOString(),
    payloadFingerprints: {},
    accounting: {
      datasetsRequested: [],
      cacheHits: 0,
      persistedHits: 0,
      providerCalls: 0,
      pages: 0,
      pointsConsumed: null,
      estimatedPointsConsumed: null,
      costSource: "unknown",
      consumers: input.consumers,
      duplicatedLogicalFetches: 0,
    },
  };
}

export function attachDatasetToBundle(
  bundle: WclRunEvidenceBundle,
  dataset: WclRunEvidenceDataset,
  opts: { fromPersisted?: boolean; fromCache?: boolean } = {},
): WclRunEvidenceBundle {
  const next = { ...bundle, eventDatasets: { ...bundle.eventDatasets } };
  next.eventDatasets[dataset.key] = dataset;
  next.accounting = { ...bundle.accounting };
  next.accounting.datasetsRequested = [
    ...new Set([...bundle.accounting.datasetsRequested, dataset.key]),
  ];
  next.accounting.pages += dataset.pageCount;
  next.accounting.providerCalls += dataset.wclRequests;
  if (opts.fromPersisted) next.accounting.persistedHits += 1;
  if (opts.fromCache) next.accounting.cacheHits += 1;

  if (next.accounting.providerCalls === 0) {
    // Fully persisted/cache reuse — measured zero spend for this ingest.
    next.accounting.pointsConsumed = 0;
    next.accounting.estimatedPointsConsumed = 0;
    next.accounting.costSource = "measured";
  } else {
    const requestCosts = Object.values(next.eventDatasets).flatMap(
      (d) => d?.requestCostUnits ?? [],
    );
    const resolved = resolveBatchCostAccounting({
      before: null,
      after: null,
      perRequestCostUnits: requestCosts,
      requestCount: next.accounting.providerCalls,
      pageCount: next.accounting.pages,
    });
    next.accounting.pointsConsumed = resolved.pointsConsumed;
    next.accounting.estimatedPointsConsumed = resolved.estimatedPointsConsumed;
    next.accounting.costSource = resolved.costSource;
  }

  const fp = fingerprintPayload({
    key: dataset.key,
    eventCount: dataset.eventCount,
    pages: dataset.pages.map((p) => p.payloadFingerprint),
  });
  next.payloadFingerprints = { ...bundle.payloadFingerprints, [dataset.key]: fp };

  // MISSING/ERROR placeholders must not count as present — otherwise localOnly
  // ingest looks "complete" with zero durable pages.
  const present = (Object.keys(next.eventDatasets) as SharedEvidenceDatasetKey[]).filter(
    (k) => isDurableEvidenceDatasetState(next.eventDatasets[k]?.state),
  );
  next.completeness = {
    ...bundle.completeness,
    present,
    truncated: present.filter((k) => next.eventDatasets[k]?.truncated),
    missing: bundle.completeness.required.filter((k) => !present.includes(k)),
  };
  next.fetchedAt = new Date().toISOString();
  return next;
}

/** Durable event-dataset states that may satisfy completeness / reuse gates. */
export function isDurableEvidenceDatasetState(
  state: WclRunEvidenceDataset["state"] | null | undefined,
): boolean {
  return state === "OK" || state === "CACHED" || state === "PERSISTED";
}

/**
 * Shared-evidence bundle is reusable as durable source only when every required
 * event dataset is durable (pages present or intentional empty OK) and masterData
 * is real (not a synthesized stub).
 */
export function isDurableSharedEvidenceBundle(
  bundle: WclRunEvidenceBundle,
  requiredKeys?: SharedEvidenceDatasetKey[],
): boolean {
  const required = requiredKeys ?? bundle.completeness.required;
  if (required.length === 0) return false;
  for (const key of required) {
    if (key === "masterData") {
      if (!isRealMasterData(bundle.masterData)) return false;
      continue;
    }
    const ds = bundle.eventDatasets[key];
    if (!ds || !isDurableEvidenceDatasetState(ds.state)) return false;
    // Durable reuse requires at least one persisted/fetched page envelope
    // (empty-valid datasets still write a page with eventCount 0).
    if (ds.pageCount <= 0) return false;
    if (ds.truncated) return false;
    if (ds.pagination && ds.pagination.complete === false) return false;
  }
  return bundle.completeness.missing.length === 0;
}

/** True when masterData looks like a real WCL actor table (not synthesizeMasterData stub). */
export function isRealMasterData(masterData: unknown): boolean {
  if (masterData == null || typeof masterData !== "object") return false;
  const actors = Array.isArray((masterData as { actors?: unknown }).actors)
    ? ((masterData as { actors: unknown[] }).actors)
    : [];
  const players = actors.filter((raw) => {
    const a = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    return a?.type === "Player";
  });
  if (players.length === 0) return false;
  // Synthesized stub uses a single Player named "target" with no server.
  if (
    players.length === 1 &&
    typeof (players[0] as { name?: unknown }).name === "string" &&
    (players[0] as { name: string }).name === "target" &&
    (players[0] as { server?: unknown }).server == null
  ) {
    return false;
  }
  return true;
}

export function evidenceDatasetReuseDecision(input: {
  existing: WclRunEvidenceDataset | null | undefined;
  /** Revision recorded with the persisted evidence. */
  persistedReportRevision?: number | null;
  /** Current report revision from provider/metadata. */
  reportRevision: number | null;
  expectedRevision?: number | null;
  forceRefetch: boolean;
}): "reuse" | "refetch_revision_changed" | "refetch_forced" | "fetch_missing" {
  if (input.forceRefetch) return "refetch_forced";
  if (!input.existing || input.existing.state === "MISSING" || input.existing.state === "ERROR") {
    return "fetch_missing";
  }
  // Page-less legacy cache is never durable source.
  if (input.existing.pageCount <= 0 || !isDurableEvidenceDatasetState(input.existing.state)) {
    return "fetch_missing";
  }
  const persisted =
    input.persistedReportRevision ??
    input.expectedRevision ??
    null;
  if (
    persisted != null &&
    input.reportRevision != null &&
    persisted !== input.reportRevision
  ) {
    return "refetch_revision_changed";
  }
  return "reuse";
}

export function isPlayerDeadAt(
  deathEvents: Array<Record<string, unknown>>,
  playerActorId: number,
  timestamp: number,
  reviveGraceMs = 0,
): boolean {
  const deaths = deathEvents
    .filter((ev) => {
      const target = ev.target as { id?: number } | undefined;
      const tid = typeof ev.targetID === "number" ? ev.targetID : target?.id;
      return tid === playerActorId && typeof ev.timestamp === "number";
    })
    .map((ev) => ev.timestamp as number)
    .sort((a, b) => a - b);

  let dead = false;
  for (const ts of deaths) {
    if (ts <= timestamp) dead = true;
    // Simple model: death sticks until end unless a later resurrection event is modeled separately
  }
  void reviveGraceMs;
  return dead;
}

export { buildSharedEvidenceCompatibilityKey };
