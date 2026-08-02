/**
 * Provider-free four-dimension shadow finalizer.
 * Isolates failures per dimension; never mutates publication state.
 */

import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import {
  computePerformanceV2,
  toPerformanceV2ShadowDimensionPayload,
  type PerformanceRunParseFactV2,
  type SeasonDifficultyPolicyV2,
} from "../../performance/v2/index.js";
import {
  computeExperienceV3,
  toExperienceV3ShadowDimensionPayload,
} from "../../experience/v3/index.js";
import {
  computeSurvivalV2,
  toSurvivalV2ShadowDimensionPayload,
  type SurvivalFactDocumentV2,
  type SurvivalV2RelativeDamageMode,
} from "../../survival/v2/index.js";
import {
  computeUtilityV2,
  toUtilityV2ShadowDimensionPayload,
  type UtilityV2RunFactSet,
} from "../../utility/v2/index.js";
import {
  adaptExperienceComputeInput,
  adaptPerformanceComputeInput,
  adaptSurvivalComputeInput,
  adaptUtilityComputeInput,
  algorithmVersionForDimension,
  buildUnavailableInputFingerprint,
  type ExperienceHistoryInputs,
  type PersistedFactSetRef,
  validateFrozenManifestIdentities,
  verifyManifestContentHash,
} from "./adapters.js";
import {
  availabilityFromComputeState,
  availabilityFromUtilityResult,
  buildUnavailableShadowDimensionRecord,
  normalizeShadowDimensionRecord,
  type DimensionAvailabilityState,
  type NormalizedShadowDimensionRecord,
  type ScoringV2PublicDimension,
} from "./shadow-record.js";

export type ShadowDimensionFinalizerOutcomeStatus =
  | "COMPUTED"
  | "UNAVAILABLE"
  | "FAILED";

export interface ShadowDimensionFinalizerOutcome {
  dimension: ScoringV2PublicDimension;
  status: ShadowDimensionFinalizerOutcomeStatus;
  record: NormalizedShadowDimensionRecord;
  errorMessage?: string;
}

export interface FinalizeShadowDimensionsInput {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  /** Frozen EvidenceManifestV2 document. */
  manifest: CharacterSeasonEvidenceManifestV2;
  /** Must equal manifest.contentHash — fail closed on mismatch. */
  expectedManifestContentHash: string;
  enabledDimensions: ScoringV2PublicDimension[];
  factSets: PersistedFactSetRef[];
  /** Optional fixture / future typed Performance facts. */
  performanceRunParseFacts?: PerformanceRunParseFactV2[];
  performanceProfileAggregate?: Parameters<
    typeof adaptPerformanceComputeInput
  >[0]["profileAggregate"];
  difficultyPolicy?: SeasonDifficultyPolicyV2 | null;
  expectedPartition?: number | null;
  logFreshness?: number;
  /** Optional fixture Survival documents. */
  survivalDocuments?: SurvivalFactDocumentV2[];
  relativeDamageMode?: SurvivalV2RelativeDamageMode;
  /** Optional fixture Utility fact sets. */
  utilityFactSets?: UtilityV2RunFactSet[];
  /** Experience history — null → UNAVAILABLE (no provider fetch). */
  experienceHistory?: ExperienceHistoryInputs | null;
  computedAt: Date;
}

export interface FinalizeShadowDimensionsResult {
  ok: boolean;
  /** Hard fail before any dimension (hash / identity). */
  blockedReason: string | null;
  outcomes: ShadowDimensionFinalizerOutcome[];
}

function unavailableOutcome(input: {
  dimension: ScoringV2PublicDimension;
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  manifestContentHash: string;
  computedAt: Date;
  limitations: string[];
  failureReasons: string[];
  status?: ShadowDimensionFinalizerOutcomeStatus;
  errorMessage?: string;
  explanation?: Record<string, unknown>;
}): ShadowDimensionFinalizerOutcome {
  const algorithmVersion = algorithmVersionForDimension(input.dimension);
  const inputFingerprint = buildUnavailableInputFingerprint({
    dimension: input.dimension,
    algorithmVersion,
    manifestContentHash: input.manifestContentHash,
    reasons: input.failureReasons,
  });
  const record = buildUnavailableShadowDimensionRecord({
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    dimension: input.dimension,
    algorithmVersion,
    inputFingerprint,
    computedAt: input.computedAt,
    limitations: input.limitations,
    failureReasons: input.failureReasons,
    extraMetrics: {
      manifestContentHash: input.manifestContentHash,
    },
    explanation: input.explanation,
  });
  return {
    dimension: input.dimension,
    status: input.status ?? "UNAVAILABLE",
    record,
    errorMessage: input.errorMessage,
  };
}

function finalizeOneDimension(
  dimension: ScoringV2PublicDimension,
  input: FinalizeShadowDimensionsInput,
): ShadowDimensionFinalizerOutcome {
  const base = {
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    manifestContentHash: input.manifest.contentHash,
    computedAt: input.computedAt,
  };

  try {
    switch (dimension) {
      case "PERFORMANCE": {
        const adapted = adaptPerformanceComputeInput({
          manifest: input.manifest,
          factSets: input.factSets,
          runParseFacts: input.performanceRunParseFacts,
          profileAggregate: input.performanceProfileAggregate,
          difficultyPolicy: input.difficultyPolicy,
          expectedPartition: input.expectedPartition,
          logFreshness: input.logFreshness,
          computedAt: input.computedAt.toISOString(),
        });
        if (!adapted.ok) {
          return unavailableOutcome({
            ...base,
            dimension,
            limitations: adapted.limitations,
            failureReasons: adapted.failureReasons,
          });
        }
        const result = computePerformanceV2(adapted.input);
        const payload = toPerformanceV2ShadowDimensionPayload({
          characterId: input.characterId,
          seasonId: input.seasonId,
          manifestId: input.manifestId,
          scoreModelId: input.scoreModelId,
          result,
          computedAt: input.computedAt,
        });
        return {
          dimension,
          status: "COMPUTED",
          record: normalizeShadowDimensionRecord({
            payload,
            availabilityState: availabilityFromComputeState(result.state),
          }),
        };
      }
      case "SURVIVAL": {
        const adapted = adaptSurvivalComputeInput({
          manifest: input.manifest,
          factSets: input.factSets,
          parsedDocuments: input.survivalDocuments,
          relativeDamageMode: input.relativeDamageMode ?? "off",
          scoreModelId: input.scoreModelId,
        });
        if (!adapted.ok) {
          return unavailableOutcome({
            ...base,
            dimension,
            limitations: adapted.limitations,
            failureReasons: adapted.failureReasons,
          });
        }
        const result = computeSurvivalV2(adapted.input);
        const payload = toSurvivalV2ShadowDimensionPayload({
          characterId: input.characterId,
          seasonId: input.seasonId,
          manifestId: input.manifestId,
          scoreModelId: input.scoreModelId,
          result,
          computedAt: input.computedAt,
        });
        return {
          dimension,
          status: "COMPUTED",
          record: normalizeShadowDimensionRecord({
            payload,
            availabilityState: availabilityFromComputeState(result.state),
          }),
        };
      }
      case "UTILITY": {
        const adapted = adaptUtilityComputeInput({
          manifest: input.manifest,
          factSets: input.factSets,
          typedFactSets: input.utilityFactSets,
        });
        if (!adapted.ok) {
          return unavailableOutcome({
            ...base,
            dimension,
            limitations: adapted.limitations,
            failureReasons: adapted.failureReasons,
          });
        }
        const result = computeUtilityV2(adapted.input);
        const payload = toUtilityV2ShadowDimensionPayload({
          characterId: input.characterId,
          seasonId: input.seasonId,
          manifestId: input.manifestId,
          scoreModelId: input.scoreModelId,
          result,
          computedAt: input.computedAt,
        });
        return {
          dimension,
          status: "COMPUTED",
          record: normalizeShadowDimensionRecord({
            payload,
            availabilityState: availabilityFromUtilityResult(result.availabilityState),
          }),
        };
      }
      case "EXPERIENCE": {
        const adapted = adaptExperienceComputeInput({
          manifest: input.manifest,
          history: input.experienceHistory ?? null,
          computedAt: input.computedAt.toISOString(),
        });
        if (!adapted.ok) {
          return unavailableOutcome({
            ...base,
            dimension,
            limitations: adapted.limitations,
            failureReasons: adapted.failureReasons,
          });
        }
        const result = computeExperienceV3(adapted.input);
        const payload = toExperienceV3ShadowDimensionPayload({
          characterId: input.characterId,
          seasonId: input.seasonId,
          manifestId: input.manifestId,
          scoreModelId: input.scoreModelId,
          result,
          computedAt: input.computedAt,
        });
        return {
          dimension,
          status: "COMPUTED",
          record: normalizeShadowDimensionRecord({
            payload,
            availabilityState: availabilityFromComputeState(result.state),
          }),
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_dimension_error";
    return unavailableOutcome({
      ...base,
      dimension,
      limitations: ["dimension_compute_exception"],
      failureReasons: [`compute_exception:${dimension}`],
      status: "FAILED",
      errorMessage: message,
      explanation: { error: message },
    });
  }
}

/**
 * Finalize enabled dimensions independently.
 * Hard-blocks on manifest hash mismatch or invalid frozen identities.
 * Per-dimension failures produce UNAVAILABLE/FAILED outcomes without aborting siblings.
 */
export function finalizeShadowDimensions(
  input: FinalizeShadowDimensionsInput,
): FinalizeShadowDimensionsResult {
  const hashCheck = verifyManifestContentHash(
    input.manifest,
    input.expectedManifestContentHash,
  );
  if (!hashCheck.ok) {
    return {
      ok: false,
      blockedReason: hashCheck.reason,
      outcomes: [],
    };
  }

  const identityIssues = validateFrozenManifestIdentities(input.manifest);
  const hardIdentity = identityIssues.filter(
    (i) =>
      i.code === "DUPLICATE_FROZEN_IDENTITY" ||
      i.code === "MISSING_REPORT_REVISION" ||
      i.code === "MISSING_IDENTITY" ||
      i.code === "MISSING_REPORT_CODE" ||
      i.code === "MISSING_FIGHT_ID",
  );

  // Identity issues on selected slots are soft for empty selections; hard when any SELECTED.
  const hasSelected = input.manifest.slots.some((s) => s.state === "SELECTED");
  if (hasSelected && hardIdentity.length > 0) {
    // Still produce per-dimension UNAVAILABLE rows so enabled dims are never skipped.
    const reasons = hardIdentity.map((i) => `${i.code}:${i.slotId}`);
    const outcomes = input.enabledDimensions.map((dimension) =>
      unavailableOutcome({
        dimension,
        characterId: input.characterId,
        seasonId: input.seasonId,
        manifestId: input.manifestId,
        scoreModelId: input.scoreModelId,
        manifestContentHash: input.manifest.contentHash,
        computedAt: input.computedAt,
        limitations: ["frozen_identity_invalid"],
        failureReasons: reasons,
      }),
    );
    return {
      ok: false,
      blockedReason: `frozen_identity_validation_failed:${reasons.join(",")}`,
      outcomes,
    };
  }

  const outcomes: ShadowDimensionFinalizerOutcome[] = [];
  for (const dimension of input.enabledDimensions) {
    outcomes.push(finalizeOneDimension(dimension, input));
  }

  return {
    ok: true,
    blockedReason: null,
    outcomes,
  };
}

export type { DimensionAvailabilityState, ScoringV2PublicDimension };
