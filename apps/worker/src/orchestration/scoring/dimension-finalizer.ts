/**
 * Worker IO for Scoring V2 shadow dimension finalization.
 * Provider-free: reads persisted manifest/facts only.
 */

import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import {
  finalizeShadowDimensions,
  type ExperienceHistoryInputs,
  type FinalizeShadowDimensionsResult,
  type ScoringV2PublicDimension,
} from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import { loadExperienceHistoryFromDb } from "./experience-history-loader.js";

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
  /**
   * Optional injected Experience history (tests). When omitted, loads from DB.
   * Pass `null` explicitly to skip loading and force UNAVAILABLE.
   */
  experienceHistory?: ExperienceHistoryInputs | null;
}

export interface PersistShadowDimensionSuccess {
  dimension: ScoringV2PublicDimension;
  ok: true;
  computationId: string;
  created: boolean;
  status: string;
  availabilityState: unknown;
}

export interface PersistShadowDimensionFailure {
  dimension: ScoringV2PublicDimension;
  ok: false;
  status: string;
  availabilityState: unknown;
  error: string;
  integrityConflict: boolean;
}

export type PersistShadowDimensionOutcome =
  | PersistShadowDimensionSuccess
  | PersistShadowDimensionFailure;

export interface PersistShadowDimensionsResult {
  finalization: FinalizeShadowDimensionsResult;
  persisted: PersistShadowDimensionSuccess[];
  failed: PersistShadowDimensionFailure[];
  /** True when every enabled outcome was persisted successfully. */
  allPersisted: boolean;
}

function isManifestDocument(value: unknown): value is CharacterSeasonEvidenceManifestV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { contentHash?: unknown }).contentHash === "string" &&
    Array.isArray((value as { slots?: unknown }).slots)
  );
}

function isIntegrityConflict(message: string): boolean {
  return (
    message.includes("dimension_computation_conflict") ||
    message.includes("fingerprint_mismatch") ||
    message.includes("content_mismatch")
  );
}

/**
 * Load persisted facts, run shared finalizer, idempotently persist SHADOW rows.
 * Never calls providers. Never mutates CharacterPublishedScore.
 *
 * Persistence is isolated per dimension: one write failure does not prevent
 * sibling dimensions from being attempted. Integrity conflicts remain failures.
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

  // Experience history: DB-only. Loader failure isolates to Experience (null → UNAVAILABLE).
  let experienceHistory: ExperienceHistoryInputs | null =
    input.experienceHistory === undefined ? null : input.experienceHistory;
  if (input.experienceHistory === undefined) {
    const needsExperience = input.enabledDimensions.includes("EXPERIENCE");
    if (needsExperience) {
      try {
        const loaded = await loadExperienceHistoryFromDb({
          prisma: container.prisma,
          characterId: input.characterId,
          seasonId: input.seasonId,
          manifest: input.manifestDocument,
          findFreshPayloadByFingerprint:
            container.repositories.externalRequest.findFreshPayloadByFingerprint,
        });
        if (loaded.ok) {
          experienceHistory = loaded.history;
          container.logger.info(
            {
              event: "scoring_v2_experience_history_loaded",
              characterId: input.characterId,
              seasonId: input.seasonId,
              evidenceRevision: loaded.evidenceRevision,
              limitationCount: loaded.limitations.length,
              sourceStatuses: loaded.sourceStatuses,
            },
            "scoring_v2 experience history loaded from persisted evidence",
          );
        } else {
          container.logger.warn?.(
            {
              event: "scoring_v2_experience_history_unavailable",
              characterId: input.characterId,
              seasonId: input.seasonId,
              reason: loaded.reason,
              limitations: loaded.limitations,
            },
            "scoring_v2 experience history unavailable; siblings continue",
          );
          experienceHistory = null;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "loader_threw";
        container.logger.warn?.(
          {
            event: "scoring_v2_experience_history_loader_failed",
            characterId: input.characterId,
            seasonId: input.seasonId,
            reason: message.slice(0, 160),
          },
          "scoring_v2 experience history loader failed; siblings continue",
        );
        experienceHistory = null;
      }
    }
  }

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
    experienceHistory,
    relativeDamageMode: input.relativeDamageMode ?? "off",
    computedAt,
  });

  if (!finalization.ok && finalization.outcomes.length === 0) {
    throw new Error(finalization.blockedReason ?? "shadow_dimension_finalization_blocked");
  }

  const persisted: PersistShadowDimensionSuccess[] = [];
  const failed: PersistShadowDimensionFailure[] = [];

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
        ok: true,
        dimension: record.dimension,
        computationId: row.id,
        created,
        status: outcome.status,
        availabilityState: record.metrics.availabilityState,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      container.logger.error(
        {
          event: "scoring_v2_dimension_persist_failed",
          dimension: record.dimension,
          error: message,
          integrityConflict: isIntegrityConflict(message),
        },
        "shadow dimension persistence failed for one dimension; continuing siblings",
      );
      failed.push({
        ok: false,
        dimension: record.dimension,
        status: outcome.status,
        availabilityState: record.metrics.availabilityState,
        error: message,
        integrityConflict: isIntegrityConflict(message),
      });
    }
  }

  return {
    finalization,
    persisted,
    failed,
    allPersisted: failed.length === 0 && persisted.length === finalization.outcomes.length,
  };
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
