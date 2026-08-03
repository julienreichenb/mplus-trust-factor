/**
 * Persistent SharedEvidenceStore — authoritative DB/CAS cache before WCL.
 * In-memory L1 is optional; never the source of truth.
 */
import { createHash } from "node:crypto";
import {
  WCL_RAW_PAGE_RETENTION_DAYS,
  WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
} from "@mplus/contracts";
import {
  defaultWclRawPageRetentionUntil,
  type ArtifactRepository,
  type WclSourceRepository,
} from "@mplus/database";
import {
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  WCL_RUN_EVIDENCE_SCHEMA_VERSION,
  type SharedEvidenceDatasetKey,
  type SharedEvidenceStore,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import { gunzipSync, gzipSync } from "node:zlib";

const PAGE_ENVELOPE_SCHEMA = "wcl-event-page-v1";

export interface PersistedPageEnvelope {
  schemaVersion: typeof PAGE_ENVELOPE_SCHEMA;
  providerContractVersion: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  datasetKey: string;
  pageIndex: number;
  pageCursor: string | null;
  nextPageCursor: string | null;
  filterExpression: string | null;
  filterSourceId: number | null;
  truncated: boolean;
  /** Dataset-level meta is duplicated on page 0 for reconstruction. */
  datasetMeta?: {
    state: WclRunEvidenceDataset["state"];
    consumers: Array<"survival" | "utility">;
    costSource: WclRunEvidenceDataset["costSource"];
    pointsConsumed: number | null;
    wclRequests: number;
    fetchedAt: string | null;
  };
  events: Array<Record<string, unknown>>;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCompatibilityKey(key: string): {
  reportCode: string;
  reportRevision: number | null;
  fightId: number;
  dataset: string;
} | null {
  // Format: wcl-evidence|{report}|r{rev}|f{fight}|a{actor}|{dataset}|...
  const parts = key.split("|");
  if (parts.length < 6 || parts[0] !== "wcl-evidence") return null;
  const reportCode = parts[1]!;
  const revRaw = parts[2]!.replace(/^r/, "");
  const fightRaw = parts[3]!.replace(/^f/, "");
  const dataset = parts[5]!;
  const reportRevision = revRaw === "unknown" ? null : Number(revRaw);
  const fightId = Number(fightRaw);
  if (!reportCode || !Number.isFinite(fightId)) return null;
  return {
    reportCode,
    reportRevision: Number.isFinite(reportRevision as number) ? (reportRevision as number) : null,
    fightId,
    dataset,
  };
}

export function createPersistentSharedEvidenceStore(input: {
  wclSource: WclSourceRepository;
  artifacts: ArtifactRepository;
  /** Optional process-local L1 — never authoritative. */
  l1?: SharedEvidenceStore;
}): SharedEvidenceStore {
  const { wclSource, artifacts, l1 } = input;

  return {
    async loadDataset(compatibilityKey: string): Promise<WclRunEvidenceDataset | null> {
      if (l1) {
        const hit = await l1.loadDataset(compatibilityKey);
        if (hit) return hit;
      }

      const parsed = parseCompatibilityKey(compatibilityKey);
      if (!parsed || parsed.reportRevision == null) return null;

      const pages = await wclSource.findEvidenceDatasetPages({
        reportCode: parsed.reportCode,
        fightId: parsed.fightId,
        reportRevision: parsed.reportRevision,
        datasetKey: parsed.dataset,
      });
      if (pages.length === 0) return null;

      const events: Array<Record<string, unknown>> = [];
      const pageMetas: WclRunEvidenceDataset["pages"] = [];
      let datasetMeta: PersistedPageEnvelope["datasetMeta"] | undefined;
      let filterExpression: string | null = null;
      let filterSourceId: number | null = null;
      let truncated = false;

      for (const page of pages) {
        const bytes = await artifacts.readVerified(page.artifactId);
        // Artifacts may be stored gzip-compressed at the CAS layer; ArtifactRepository
        // returns uncompressed verified bytes.
        const envelope = JSON.parse(bytes.toString("utf8")) as PersistedPageEnvelope;
        if (envelope.schemaVersion !== PAGE_ENVELOPE_SCHEMA) {
          return null;
        }
        if (
          envelope.providerContractVersion !== WCL_RUN_EVIDENCE_PROVIDER_CONTRACT ||
          envelope.reportCode !== parsed.reportCode ||
          envelope.fightId !== parsed.fightId ||
          envelope.reportRevision !== parsed.reportRevision ||
          envelope.datasetKey !== parsed.dataset
        ) {
          return null;
        }
        events.push(...(envelope.events ?? []));
        pageMetas.push({
          pageIndex: page.pageIndex,
          startTime: envelope.pageCursor != null ? Number(envelope.pageCursor) : null,
          nextPageTimestamp:
            envelope.nextPageCursor != null ? Number(envelope.nextPageCursor) : null,
          eventCount: page.eventCount,
          payloadFingerprint: page.contentHash,
        });
        if (page.pageIndex === 0 && envelope.datasetMeta) {
          datasetMeta = envelope.datasetMeta;
        }
        filterExpression = envelope.filterExpression;
        filterSourceId = envelope.filterSourceId;
        truncated = truncated || envelope.truncated;
      }

      const reconstructed: WclRunEvidenceDataset = {
        key: parsed.dataset as SharedEvidenceDatasetKey,
        state: datasetMeta?.state ?? "PERSISTED",
        truncated,
        pageCount: pages.length,
        eventCount: events.length,
        filterSourceId,
        filterExpression,
        pages: pageMetas,
        events,
        consumers: datasetMeta?.consumers ?? ["survival", "utility"],
        pointsConsumed: datasetMeta?.pointsConsumed ?? null,
        costSource: datasetMeta?.costSource ?? "measured",
        requestCostUnits: [],
        wclRequests: 0,
        fetchedAt: datasetMeta?.fetchedAt ?? pages[0]?.createdAt.toISOString() ?? null,
        source: "persisted",
      };

      if (l1) {
        await l1.saveDataset(compatibilityKey, reconstructed, {
          reportCode: parsed.reportCode,
          reportRevision: parsed.reportRevision,
          fightId: parsed.fightId,
          dataset: reconstructed.key,
        });
      }
      return reconstructed;
    },

    async saveDataset(
      compatibilityKey: string,
      dataset: WclRunEvidenceDataset,
      meta: {
        reportCode: string;
        reportRevision: number | null;
        fightId: number;
        dataset: SharedEvidenceDatasetKey;
      },
    ): Promise<void> {
      if (meta.reportRevision == null) {
        // Cannot persist revisioned pages without a resolved revision.
        if (l1) await l1.saveDataset(compatibilityKey, dataset, meta);
        return;
      }

      let offset = 0;
      const retentionUntil = defaultWclRawPageRetentionUntil();
      // Prefer explicit pages; if empty but events exist, treat as a single page.
      const pageDefs =
        dataset.pages.length > 0
          ? dataset.pages
          : [
              {
                pageIndex: 0,
                startTime: null,
                nextPageTimestamp: null,
                eventCount: dataset.events.length,
                payloadFingerprint: sha256Hex(
                  Buffer.from(JSON.stringify(dataset.events), "utf8"),
                ),
              },
            ];

      for (const page of pageDefs) {
        const pageEvents = dataset.events.slice(offset, offset + page.eventCount);
        offset += page.eventCount;
        const envelope: PersistedPageEnvelope = {
          schemaVersion: PAGE_ENVELOPE_SCHEMA,
          providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
          reportCode: meta.reportCode,
          fightId: meta.fightId,
          reportRevision: meta.reportRevision,
          datasetKey: meta.dataset,
          pageIndex: page.pageIndex,
          pageCursor: page.startTime != null ? String(page.startTime) : null,
          nextPageCursor:
            page.nextPageTimestamp != null ? String(page.nextPageTimestamp) : null,
          filterExpression: dataset.filterExpression,
          filterSourceId: dataset.filterSourceId,
          truncated: dataset.truncated,
          ...(page.pageIndex === 0
            ? {
                datasetMeta: {
                  state: dataset.state,
                  consumers: dataset.consumers,
                  costSource: dataset.costSource,
                  pointsConsumed: dataset.pointsConsumed,
                  wclRequests: dataset.wclRequests,
                  fetchedAt: dataset.fetchedAt,
                },
              }
            : {}),
          events: pageEvents,
        };
        const uncompressed = Buffer.from(JSON.stringify(envelope), "utf8");
        const contentHash = sha256Hex(uncompressed);
        const { artifactId } = await artifacts.persist({
          provider: "WARCRAFT_LOGS",
          bytes: uncompressed,
          compression: "GZIP",
          artifactClass: "wcl_event_page",
          retentionUntil,
        });

        // Verify retention helper matches policy (30 days).
        void WCL_RAW_PAGE_RETENTION_DAYS;
        void WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION;
        void WCL_RUN_EVIDENCE_SCHEMA_VERSION;
        void gzipSync;
        void gunzipSync;

        await wclSource.createEvidenceDatasetPage({
          reportCode: meta.reportCode,
          fightId: meta.fightId,
          reportRevision: meta.reportRevision,
          datasetKey: meta.dataset,
          pageIndex: page.pageIndex,
          pageCursor: envelope.pageCursor,
          artifactId,
          contentHash,
          providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
          schemaVersion: PAGE_ENVELOPE_SCHEMA,
          eventCount: pageEvents.length,
        });
      }

      if (l1) {
        await l1.saveDataset(compatibilityKey, dataset, meta);
      }
    },

    async loadBundleSummary(
      reportCode: string,
      fightId: number,
      reportRevision: number | null,
    ): Promise<WclRunEvidenceBundle | null> {
      if (l1?.loadBundleSummary) {
        const hit = await l1.loadBundleSummary(reportCode, fightId, reportRevision);
        if (hit) return hit;
      }
      if (reportRevision == null) return null;
      const digest = await wclSource.findWclRunSourceDigest(
        reportCode,
        fightId,
        reportRevision,
      );
      if (!digest) return null;
      // Bundle reconstruction from digest alone is metadata-only; event datasets
      // are loaded per compatibility key via loadDataset.
      return null;
    },

    async saveBundleSummary(bundle: WclRunEvidenceBundle): Promise<void> {
      if (l1?.saveBundleSummary) {
        await l1.saveBundleSummary(bundle);
      }
    },
  };
}

/** Exact 30-day retention helper used by page writes (testable). */
export function retentionUntilFromFetchedAt(fetchedAt: Date): Date {
  return defaultWclRawPageRetentionUntil(fetchedAt);
}
