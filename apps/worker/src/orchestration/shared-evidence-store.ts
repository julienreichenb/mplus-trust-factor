/**
 * Worker adapter: persist shared WCL evidence via RunAnalysis.
 * Utility remains offline — this store is for Survival now and Utility later.
 */
import {
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  WCL_RUN_EVIDENCE_SCHEMA_VERSION,
  type SharedEvidenceDatasetKey,
  type SharedEvidenceStore,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import type { RunRepository } from "../persistence/run-repository.js";

export interface DurableSharedEvidenceStoreOptions {
  runRepository: RunRepository;
  characterId: string;
  runId: string;
  now?: Date;
}

/** Maps evidence datasets into RunAnalysis summary — no parallel tables. */
/** Consumed by Survival analysis and Utility OBSERVED_CONTRIBUTION shadow scoring. */
export function createDurableSharedEvidenceStore(
  options: DurableSharedEvidenceStoreOptions,
): SharedEvidenceStore {
  const { runRepository, characterId, runId } = options;
  const now = options.now ?? new Date();

  return {
    async loadDataset(compatibilityKey: string): Promise<WclRunEvidenceDataset | null> {
      const analysis = await runRepository.findRunAnalysis(
        runId,
        characterId,
        WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
      );
      if (!analysis?.summary || typeof analysis.summary !== "object") return null;
      const summary = analysis.summary as {
        datasetsByCompatibilityKey?: Record<string, WclRunEvidenceDataset>;
      };
      return summary.datasetsByCompatibilityKey?.[compatibilityKey] ?? null;
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
      const existing = await runRepository.findRunAnalysis(
        runId,
        characterId,
        WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
      );
      const prev =
        existing?.summary && typeof existing.summary === "object"
          ? (existing.summary as Record<string, unknown>)
          : {};
      const datasetsByCompatibilityKey = {
        ...((prev.datasetsByCompatibilityKey as Record<string, WclRunEvidenceDataset>) ?? {}),
        [compatibilityKey]: dataset,
      };
      const sourcePayloadIds = Array.isArray(existing?.sourcePayloadIds)
        ? (existing.sourcePayloadIds as string[])
        : [];
      await runRepository.upsertRunAnalysis({
        runId,
        characterId,
        analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
        analyzedAt: now,
        coverage: Object.keys(datasetsByCompatibilityKey).length > 0 ? 1 : 0,
        summary: {
          ...prev,
          schemaVersion: "1.0.0",
          analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
          reportCode: meta.reportCode,
          reportRevision: meta.reportRevision,
          fightId: meta.fightId,
          datasetsByCompatibilityKey,
          updatedAt: now.toISOString(),
        },
        sourcePayloadIds,
      });
    },

    async loadBundleSummary(
      reportCode: string,
      fightId: number,
      reportRevision: number | null,
    ): Promise<WclRunEvidenceBundle | null> {
      const analysis = await runRepository.findRunAnalysis(
        runId,
        characterId,
        WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
      );
      if (!analysis?.summary || typeof analysis.summary !== "object") return null;
      const summary = analysis.summary as {
        bundle?: WclRunEvidenceBundle;
        datasetsByCompatibilityKey?: Record<string, WclRunEvidenceDataset>;
        reportCode?: string;
        fightId?: number;
        reportRevision?: number | null;
      };

      const matchesKeys = (b: {
        reportCode: string;
        fightId: number;
        reportRevision: number | null;
      }): boolean => {
        if (b.reportCode !== reportCode || b.fightId !== fightId) return false;
        if (
          reportRevision != null &&
          b.reportRevision != null &&
          b.reportRevision !== reportRevision
        ) {
          return false;
        }
        return true;
      };

      const bundle = summary.bundle;
      if (bundle && matchesKeys(bundle)) {
        // Prefer the persisted bundle; fill eventDatasets from keyed store when empty.
        if (
          Object.keys(bundle.eventDatasets ?? {}).length === 0 &&
          summary.datasetsByCompatibilityKey
        ) {
          return reconstructBundleFromDatasets(summary, reportCode, fightId, reportRevision);
        }
        return bundle;
      }

      // Older rows may have datasets without a full bundle summary.
      if (summary.datasetsByCompatibilityKey) {
        return reconstructBundleFromDatasets(summary, reportCode, fightId, reportRevision);
      }
      return null;
    },

    async saveBundleSummary(bundle: WclRunEvidenceBundle): Promise<void> {
      const existing = await runRepository.findRunAnalysis(
        runId,
        characterId,
        WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
      );
      const prev =
        existing?.summary && typeof existing.summary === "object"
          ? (existing.summary as Record<string, unknown>)
          : {};
      const sourcePayloadIds = Array.isArray(existing?.sourcePayloadIds)
        ? (existing.sourcePayloadIds as string[])
        : [];
      await runRepository.upsertRunAnalysis({
        runId,
        characterId,
        analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
        analyzedAt: now,
        coverage: 1,
        summary: {
          ...prev,
          schemaVersion: "1.0.0",
          analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
          reportCode: bundle.reportCode,
          reportRevision: bundle.reportRevision,
          fightId: bundle.fightId,
          bundle,
          updatedAt: now.toISOString(),
        },
        sourcePayloadIds,
      });
    },
  };
}

function reconstructBundleFromDatasets(
  summary: {
    bundle?: WclRunEvidenceBundle;
    datasetsByCompatibilityKey?: Record<string, WclRunEvidenceDataset>;
    reportCode?: string;
    fightId?: number;
    reportRevision?: number | null;
  },
  reportCode: string,
  fightId: number,
  reportRevision: number | null,
): WclRunEvidenceBundle | null {
  const datasets = summary.datasetsByCompatibilityKey ?? {};
  const matched = Object.entries(datasets).filter(([key]) => {
    // Compatibility keys embed report/fight/revision — prefer matching those.
    const hasReport = key.includes(reportCode);
    const hasFight = key.includes(`f${fightId}`);
    const hasRevision =
      reportRevision == null || key.includes(`r${reportRevision}`) || key.includes("runknown");
    return hasReport && hasFight && hasRevision;
  });
  if (matched.length === 0 && !summary.bundle) return null;

  const eventDatasets: Partial<Record<SharedEvidenceDatasetKey, WclRunEvidenceDataset>> = {
    ...(summary.bundle?.eventDatasets ?? {}),
  };
  for (const [, ds] of matched) {
    eventDatasets[ds.key] = ds;
  }

  const base = summary.bundle;
  const present = Object.keys(eventDatasets) as SharedEvidenceDatasetKey[];
  if (base?.masterData != null && !present.includes("masterData")) {
    present.push("masterData");
  }

  return {
    schemaVersion: WCL_RUN_EVIDENCE_SCHEMA_VERSION,
    analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    reportCode,
    reportRevision: reportRevision ?? base?.reportRevision ?? summary.reportRevision ?? null,
    fightId,
    playerActorId: base?.playerActorId ?? null,
    ownedPetActorIds: base?.ownedPetActorIds ?? [],
    dungeonSlug: base?.dungeonSlug ?? "",
    startTime: base?.startTime ?? null,
    endTime: base?.endTime ?? null,
    masterData: base?.masterData ?? null,
    eventDatasets,
    completeness: {
      required: base?.completeness.required ?? present,
      present,
      missing: (base?.completeness.required ?? []).filter((k) => !present.includes(k)),
      truncated: present.filter((k) => eventDatasets[k]?.truncated),
    },
    fetchedAt: base?.fetchedAt ?? new Date().toISOString(),
    payloadFingerprints: base?.payloadFingerprints ?? {},
    accounting: base?.accounting ?? {
      datasetsRequested: present,
      cacheHits: 0,
      persistedHits: matched.length,
      providerCalls: 0,
      pages: 0,
      pointsConsumed: 0,
      estimatedPointsConsumed: 0,
      costSource: "measured",
      consumers: ["survival", "utility"],
      duplicatedLogicalFetches: 0,
    },
  };
}
