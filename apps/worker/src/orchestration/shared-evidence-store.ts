/**
 * Worker adapter: persist shared WCL evidence via RunAnalysis.
 * Utility remains offline — this store is for Survival now and Utility later.
 */
import {
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
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
      const summary = analysis.summary as { bundle?: WclRunEvidenceBundle };
      const bundle = summary.bundle;
      if (!bundle) return null;
      if (
        bundle.reportCode !== reportCode ||
        bundle.fightId !== fightId ||
        (reportRevision != null &&
          bundle.reportRevision != null &&
          bundle.reportRevision !== reportRevision)
      ) {
        return null;
      }
      return bundle;
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
          bundle,
          updatedAt: now.toISOString(),
        },
        sourcePayloadIds,
      });
    },
  };
}
