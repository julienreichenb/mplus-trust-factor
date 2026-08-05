/**
 * Shared evidence ingest coordinator.
 * One logical fetch per compatibility key; analyzers consume bundles only.
 * Persistence is injected so probe (filesystem) and worker (RunAnalysis/external_payloads) share logic.
 */
import type { WclGraphQlClient } from "../client/graphql-client.js";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
  evidenceDatasetReuseDecision,
  fetchSharedEventDataset,
  fetchSharedMasterData,
  fingerprintPayload,
  isRealMasterData,
  synthesizeMasterDataFromActors,
} from "./wcl-run-evidence.js";
import {
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  buildSharedEvidenceCompatibilityKey,
  unionRequiredDatasets,
  type SharedEvidenceDatasetKey,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "./wcl-run-evidence-types.js";

export interface SharedEvidenceStore {
  loadDataset(compatibilityKey: string): Promise<WclRunEvidenceDataset | null>;
  saveDataset(
    compatibilityKey: string,
    dataset: WclRunEvidenceDataset,
    meta: {
      reportCode: string;
      reportRevision: number | null;
      fightId: number;
      dataset: SharedEvidenceDatasetKey;
    },
  ): Promise<void>;
  loadBundleSummary?(
    reportCode: string,
    fightId: number,
    reportRevision: number | null,
  ): Promise<WclRunEvidenceBundle | null>;
  saveBundleSummary?(bundle: WclRunEvidenceBundle): Promise<void>;
}

export class InMemorySharedEvidenceStore implements SharedEvidenceStore {
  private readonly datasets = new Map<string, WclRunEvidenceDataset>();
  private readonly bundles = new Map<string, WclRunEvidenceBundle>();
  private fetchCount = 0;

  get providerFetchCount(): number {
    return this.fetchCount;
  }

  bumpFetch(): void {
    this.fetchCount += 1;
  }

  async loadDataset(key: string): Promise<WclRunEvidenceDataset | null> {
    return this.datasets.get(key) ?? null;
  }

  async saveDataset(
    key: string,
    dataset: WclRunEvidenceDataset,
    _meta?: {
      reportCode: string;
      reportRevision: number | null;
      fightId: number;
      dataset: SharedEvidenceDatasetKey;
    },
  ): Promise<void> {
    this.datasets.set(key, { ...dataset, source: "persisted", state: "PERSISTED" });
  }

  async loadBundleSummary(
    reportCode: string,
    fightId: number,
    reportRevision: number | null,
  ): Promise<WclRunEvidenceBundle | null> {
    return this.bundles.get(`${reportCode}:${fightId}:${reportRevision}`) ?? null;
  }

  async saveBundleSummary(bundle: WclRunEvidenceBundle): Promise<void> {
    this.bundles.set(
      `${bundle.reportCode}:${bundle.fightId}:${bundle.reportRevision}`,
      bundle,
    );
  }
}

export interface IngestSharedEvidenceInput {
  client: WclGraphQlClient | null;
  store: SharedEvidenceStore;
  reportCode: string;
  reportRevision: number | null;
  fightId: number;
  playerActorId: number | null;
  ownedPetActorIds: number[];
  dungeonSlug: string;
  startTime: number | null;
  endTime: number | null;
  consumers: Array<"survival" | "utility">;
  datasets?: SharedEvidenceDatasetKey[];
  forceRefetch?: boolean;
  region?: string;
  /** Model recalculation / catalog change — never triggers provider fetch. */
  localOnly?: boolean;
  coalesceKey?: string;
  /** Override pagination (Survival parity defaults when survival is a consumer). */
  maxPages?: number;
  pageLimit?: number;
}

/** Source ID policy matching Survival canonical fetch. */
export function sharedEvidenceSourceIdForDataset(
  dataset: SharedEvidenceDatasetKey,
  playerActorId: number | null,
): number | null {
  if (dataset === "Casts" || dataset === "HostileCasts" || dataset === "masterData") {
    return null;
  }
  if (dataset === "Interrupts" || dataset === "Dispels" || dataset === "DamageDone") {
    return null;
  }
  return playerActorId;
}

export function sharedEvidenceFilterTag(
  dataset: SharedEvidenceDatasetKey,
  includeResources: boolean,
): string | null {
  if (dataset === "HostileCasts") {
    return includeResources ? "hostile-npc-casts;+resources" : "hostile-npc-casts";
  }
  return includeResources ? "+resources" : null;
}

/** In-flight coalescing for concurrent refresh requests. */
const inFlight = new Map<string, Promise<WclRunEvidenceBundle>>();

export async function ingestSharedEvidenceBundle(
  input: IngestSharedEvidenceInput,
): Promise<WclRunEvidenceBundle> {
  const coalesceKey =
    input.coalesceKey ??
    [
      input.reportCode,
      input.fightId,
      input.reportRevision ?? "r?",
      (input.datasets ?? unionRequiredDatasets(input.consumers)).join(","),
      input.forceRefetch ? "force" : "reuse",
    ].join("|");

  const existing = inFlight.get(coalesceKey);
  if (existing) return existing;

  const promise = ingestSharedEvidenceBundleInner(input).finally(() => {
    inFlight.delete(coalesceKey);
  });
  inFlight.set(coalesceKey, promise);
  return promise;
}

async function ingestSharedEvidenceBundleInner(
  input: IngestSharedEvidenceInput,
): Promise<WclRunEvidenceBundle> {
  const required = input.datasets ?? unionRequiredDatasets(input.consumers);
  const survivalParity = input.consumers.includes("survival");
  const maxPages = input.maxPages ?? (survivalParity ? 200 : 12);
  const pageLimit = input.pageLimit ?? 1000;

  let bundle = buildEmptyBundle({
    reportCode: input.reportCode,
    reportRevision: input.reportRevision,
    fightId: input.fightId,
    playerActorId: input.playerActorId,
    ownedPetActorIds: input.ownedPetActorIds,
    dungeonSlug: input.dungeonSlug,
    startTime: input.startTime,
    endTime: input.endTime,
    consumers: input.consumers,
  });
  bundle.completeness.required = required;
  bundle.accounting.consumers = input.consumers;

  for (const datasetKey of required) {
    if (datasetKey === "masterData") {
      continue;
    }

    const includeResources =
      survivalParity &&
      (datasetKey === "DamageTaken" || datasetKey === "Healing" || datasetKey === "Deaths");
    const sourceId = sharedEvidenceSourceIdForDataset(datasetKey, input.playerActorId);
    const filterTag = sharedEvidenceFilterTag(datasetKey, includeResources);

    const compatibilityKey = buildSharedEvidenceCompatibilityKey({
      reportCode: input.reportCode,
      reportRevision: input.reportRevision,
      fightId: input.fightId,
      actorId: input.playerActorId,
      dataset: datasetKey,
      startTime: input.startTime,
      endTime: input.endTime,
      filterExpression: filterTag,
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
      payloadFingerprint: null,
    });

    const persisted = await input.store.loadDataset(compatibilityKey);
    const decision = evidenceDatasetReuseDecision({
      existing: persisted,
      reportRevision: input.reportRevision,
      expectedRevision: input.reportRevision,
      forceRefetch: input.forceRefetch === true,
    });

    if (decision === "reuse" && persisted) {
      const reused: WclRunEvidenceDataset = {
        ...persisted,
        source: "persisted",
        state: "PERSISTED",
        wclRequests: 0,
        pointsConsumed: 0,
        costSource: "measured",
        requestCostUnits: [],
        consumers: [
          ...new Set([
            ...persisted.consumers,
            ...(input.consumers.includes("survival") ? (["survival"] as const) : []),
            ...(input.consumers.includes("utility") ? (["utility"] as const) : []),
          ]),
        ],
      };
      bundle = attachDatasetToBundle(bundle, reused, { fromPersisted: true });
      continue;
    }

    if (input.localOnly || !input.client) {
      const missing: WclRunEvidenceDataset = {
        key: datasetKey,
        state: "MISSING",
        truncated: false,
        pageCount: 0,
        eventCount: 0,
        filterSourceId: null,
        filterExpression: filterTag,
        pages: [],
        events: [],
        consumers: input.consumers,
        pointsConsumed: null,
        costSource: "unknown",
        requestCostUnits: [],
        wclRequests: 0,
        fetchedAt: null,
        source: "missing",
      };
      bundle = attachDatasetToBundle(bundle, missing);
      continue;
    }

    const fetched = await fetchSharedEventDataset({
      client: input.client,
      reportCode: input.reportCode,
      fightId: input.fightId,
      dataset: datasetKey,
      sourceId,
      includeResources,
      maxPages,
      pageLimit,
      region: input.region,
      startTime: input.startTime,
      endTime: input.endTime,
    });
    await input.store.saveDataset(compatibilityKey, fetched.dataset, {
      reportCode: input.reportCode,
      reportRevision: input.reportRevision,
      fightId: input.fightId,
      dataset: datasetKey,
    });
    bundle = attachDatasetToBundle(bundle, fetched.dataset);
  }

  // masterData is required for Utility actor/pet attribution (and Survival). Prefer
  // persisted bundle, then live fetch, then a synthetic actor table from known IDs.
  if (required.includes("masterData")) {
    const existingSummary = input.store.loadBundleSummary
      ? await input.store.loadBundleSummary(
          input.reportCode,
          input.fightId,
          input.reportRevision,
        )
      : null;
    if (
      existingSummary?.masterData != null &&
      isRealMasterData(existingSummary.masterData) &&
      input.forceRefetch !== true
    ) {
      bundle = { ...bundle, masterData: existingSummary.masterData };
      bundle.accounting = {
        ...bundle.accounting,
        cacheHits: bundle.accounting.cacheHits + 1,
        persistedHits: bundle.accounting.persistedHits + 1,
      };
    } else {
      // Prefer durable masterData pages before live fetch / synthesize.
      const masterKey = buildSharedEvidenceCompatibilityKey({
        reportCode: input.reportCode,
        reportRevision: input.reportRevision,
        fightId: input.fightId,
        actorId: input.playerActorId,
        dataset: "masterData",
        startTime: input.startTime,
        endTime: input.endTime,
        filterExpression: null,
        providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
        payloadFingerprint: null,
      });
      const persistedMaster =
        input.forceRefetch === true ? null : await input.store.loadDataset(masterKey);
      const fromPage = persistedMaster?.events?.find(
        (ev) =>
          ev != null &&
          typeof ev === "object" &&
          (ev as { __masterData?: unknown }).__masterData === true,
      ) as { masterData?: unknown } | undefined;
      if (fromPage?.masterData != null) {
        bundle = { ...bundle, masterData: fromPage.masterData };
        bundle.accounting = {
          ...bundle.accounting,
          cacheHits: bundle.accounting.cacheHits + 1,
          persistedHits: bundle.accounting.persistedHits + 1,
          pages: bundle.accounting.pages + (persistedMaster?.pageCount ?? 0),
        };
      } else if (!input.localOnly && input.client) {
        try {
          const master = await fetchSharedMasterData({
            client: input.client,
            reportCode: input.reportCode,
            fightId: input.fightId,
            region: input.region,
          });
          bundle = { ...bundle, masterData: master.masterData };
          bundle.accounting = {
            ...bundle.accounting,
            providerCalls: bundle.accounting.providerCalls + master.wclRequests,
            pages: bundle.accounting.pages + 1,
          };
          if (master.pointsConsumed != null) {
            bundle.accounting.pointsConsumed =
              (bundle.accounting.pointsConsumed ?? 0) + master.pointsConsumed;
            bundle.accounting.costSource = "measured";
          }
          const masterDataset: WclRunEvidenceDataset = {
            key: "masterData",
            state: "OK",
            truncated: false,
            pageCount: 1,
            eventCount: 1,
            filterSourceId: null,
            filterExpression: null,
            pages: [
              {
                pageIndex: 0,
                startTime: null,
                nextPageTimestamp: null,
                eventCount: 1,
                payloadFingerprint: fingerprintPayload(master.masterData),
              },
            ],
            events: [{ __masterData: true, masterData: master.masterData }],
            consumers: input.consumers,
            pointsConsumed: master.pointsConsumed,
            costSource: master.pointsConsumed != null ? "measured" : "unknown",
            requestCostUnits: [],
            wclRequests: master.wclRequests,
            fetchedAt: new Date().toISOString(),
            source: "provider",
          };
          await input.store.saveDataset(masterKey, masterDataset, {
            reportCode: input.reportCode,
            reportRevision: input.reportRevision,
            fightId: input.fightId,
            dataset: "masterData",
          });
        } catch {
          const synthesized = synthesizeMasterDataFromActors({
            playerActorId: input.playerActorId,
            ownedPetActorIds: input.ownedPetActorIds,
          });
          if (synthesized) {
            bundle = { ...bundle, masterData: synthesized };
          }
        }
      } else {
        const synthesized = synthesizeMasterDataFromActors({
          playerActorId: input.playerActorId,
          ownedPetActorIds: input.ownedPetActorIds,
        });
        if (synthesized) {
          bundle = { ...bundle, masterData: synthesized };
        }
      }
    }

    if (bundle.masterData != null && isRealMasterData(bundle.masterData)) {
      const present = [
        ...new Set([...bundle.completeness.present, "masterData" as SharedEvidenceDatasetKey]),
      ];
      bundle.completeness = {
        ...bundle.completeness,
        present,
        missing: bundle.completeness.required.filter((k) => !present.includes(k)),
      };
    } else if (required.includes("masterData")) {
      // Synthesized stub / absent masterData remains missing for durability gates.
      bundle.completeness = {
        ...bundle.completeness,
        missing: [
          ...new Set([
            ...bundle.completeness.missing,
            "masterData" as SharedEvidenceDatasetKey,
          ]),
        ],
        present: bundle.completeness.present.filter((k) => k !== "masterData"),
      };
    }
  }

  if (input.store.saveBundleSummary) {
    await input.store.saveBundleSummary(bundle);
  }

  return bundle;
}

export function modelOnlyRecalculationMakesZeroWclCalls(
  store: SharedEvidenceStore,
  input: Omit<IngestSharedEvidenceInput, "client" | "localOnly" | "forceRefetch">,
): Promise<WclRunEvidenceBundle> {
  return ingestSharedEvidenceBundle({
    ...input,
    client: null,
    localOnly: true,
    forceRefetch: false,
  });
}

export { WCL_RUN_EVIDENCE_ANALYSIS_VERSION };
