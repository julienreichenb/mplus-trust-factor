/**
 * Worker IO for Scoring V2 shadow dimension finalization.
 * Provider-free: reads persisted manifest/facts only.
 */

import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import {
  finalizeShadowDimensions,
  type FinalizeShadowDimensionsResult,
  type ScoringV2PublicDimension,
} from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";

export interface PersistShadowDimensionsInput {
  characterId: string;
  seasonId: string;
  scoreModelId: string;
  manifestId: string;
  /** Frozen document from EvidenceManifest.document */
  manifestDocument: CharacterSeasonEvidenceManifestV2;
  expectedManifestContentHash: string;
  enabledDimensions: ScoringV2PublicDimension[];
  relativeDamageMode?: "off" | "shadow" | "active";
  computedAt?: Date;
}

export interface PersistShadowDimensionsResult {
  finalization: FinalizeShadowDimensionsResult;
  persisted: Array<{
    dimension: ScoringV2PublicDimension;
    computationId: string;
    created: boolean;
    status: string;
    availabilityState: unknown;
  }>;
}

function isManifestDocument(value: unknown): value is CharacterSeasonEvidenceManifestV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { contentHash?: unknown }).contentHash === "string" &&
    Array.isArray((value as { slots?: unknown }).slots)
  );
}

/**
 * Load persisted facts, run shared finalizer, idempotently persist SHADOW rows.
 * Never calls providers. Never mutates CharacterPublishedScore.
 */
export async function persistShadowDimensionComputations(
  container: WorkerContainer,
  input: PersistShadowDimensionsInput,
): Promise<PersistShadowDimensionsResult> {
  if (!isManifestDocument(input.manifestDocument)) {
    throw new Error("invalid_evidence_manifest_document");
  }

  const factRows = await container.repositories.evidence.listFactSetsForManifest(
    input.manifestId,
  );
  const factSets = factRows.map((row) => ({
    extractorFamily: row.extractorFamily,
    extractorVersion: row.extractorVersion,
    schemaVersion: row.schemaVersion,
    inputFingerprint: row.inputFingerprint,
    facts: row.facts,
    limitations: row.limitations,
    manifestSlotId: row.manifestSlotId,
    reportCode: row.reportCode,
    fightId: row.fightId,
    reportRevision: row.reportRevision,
    dungeonSlug: row.dungeonSlug,
    slotIndex: row.slotIndex,
  }));

  const computedAt = input.computedAt ?? new Date();
  const finalization = finalizeShadowDimensions({
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    manifest: input.manifestDocument,
    expectedManifestContentHash: input.expectedManifestContentHash,
    enabledDimensions: input.enabledDimensions,
    factSets,
    // Experience history is not loaded from providers in WS10 — UNAVAILABLE until adapters land.
    experienceHistory: null,
    relativeDamageMode: input.relativeDamageMode ?? "off",
    computedAt,
  });

  if (!finalization.ok && finalization.outcomes.length === 0) {
    throw new Error(finalization.blockedReason ?? "shadow_dimension_finalization_blocked");
  }

  const persisted: PersistShadowDimensionsResult["persisted"] = [];

  for (const outcome of finalization.outcomes) {
    const record = outcome.record;
    try {
      const { row, created } =
        await container.repositories.evidence.createDimensionComputationIdempotent({
          characterId: record.characterId,
          seasonId: record.seasonId,
          manifestId: record.manifestId,
          scoreModelId: record.scoreModelId,
          dimension: record.dimension,
          algorithmVersion: record.algorithmVersion,
          inputFingerprint: record.inputFingerprint,
          score: record.score,
          confidence: record.confidence,
          state: record.state,
          metrics: record.metrics as never,
          explanation: record.explanation as never,
          computedAt: record.computedAt,
        });
      persisted.push({
        dimension: record.dimension,
        computationId: row.id,
        created,
        status: outcome.status,
        availabilityState: record.metrics.availabilityState,
      });
    } catch (error) {
      // Isolate persistence failures so sibling dimensions still attempt write.
      container.logger.error(
        {
          event: "scoring_v2_dimension_persist_failed",
          dimension: record.dimension,
          error: error instanceof Error ? error.message : String(error),
        },
        "shadow dimension persistence failed for one dimension",
      );
      throw error;
    }
  }

  return { finalization, persisted };
}

export function resolveEnabledShadowDimensions(env: {
  SCORING_V2_PERFORMANCE_ENABLED: boolean;
  SCORING_V2_SURVIVAL_ENABLED: boolean;
  SCORING_V2_UTILITY_ENABLED: boolean;
  SCORING_V2_EXPERIENCE_ENABLED: boolean;
}): ScoringV2PublicDimension[] {
  const dims: ScoringV2PublicDimension[] = [];
  if (env.SCORING_V2_PERFORMANCE_ENABLED) dims.push("PERFORMANCE");
  if (env.SCORING_V2_SURVIVAL_ENABLED) dims.push("SURVIVAL");
  if (env.SCORING_V2_UTILITY_ENABLED) dims.push("UTILITY");
  if (env.SCORING_V2_EXPERIENCE_ENABLED) dims.push("EXPERIENCE");
  return dims;
}
