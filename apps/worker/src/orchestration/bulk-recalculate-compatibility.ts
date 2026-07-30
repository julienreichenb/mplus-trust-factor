import type {
  RefreshContractStaleReason,
  RefreshContractVersions,
} from "@mplus/contracts";
import { refreshContractStaleReasons } from "@mplus/contracts";

/** Model bumps are expected for RECALCULATE_ONLY (Agent 08 activation). */
const RECALCULATE_ALLOWED_STALE_REASONS = new Set<RefreshContractStaleReason>([
  "SCORING_MODEL_CHANGED",
]);

export interface RecalculateCompatibilityInput {
  /** True when the character has at least one metric observation for the target season. */
  hasSeasonObservations: boolean;
  /**
   * Refresh contract embedded in the latest score snapshot explanation, when present.
   * Used to detect adapter / schema / run-selection drift.
   */
  storedRefreshContract: unknown | null;
  currentRefreshContract: RefreshContractVersions;
  /**
   * Fallback when no snapshot contract exists: observation.schemaVersion values.
   * Empty/null schema versions are treated as unknown → incompatible.
   */
  observationSchemaVersions?: Array<string | null | undefined>;
}

export interface RecalculateCompatibilityResult {
  compatible: boolean;
  /** Explicit skip / report reason when incompatible. */
  reason: string | null;
  staleReasons: RefreshContractStaleReason[];
}

/**
 * RECALCULATE_ONLY may reuse evidence when season observations exist and the stored
 * refresh contract differs only by scoring model (or matches fully).
 * Adapter, observation-schema, run-selection, catalog, season, or zone drift → incompatible.
 */
export function evaluateRecalculateCompatibility(
  input: RecalculateCompatibilityInput,
): RecalculateCompatibilityResult {
  if (!input.hasSeasonObservations) {
    return {
      compatible: false,
      reason: "MISSING_SEASON_EVIDENCE",
      staleReasons: ["CONTRACT_MISSING"],
    };
  }

  if (input.storedRefreshContract != null) {
    const staleReasons = refreshContractStaleReasons(
      input.storedRefreshContract,
      input.currentRefreshContract,
    );
    const blocking = staleReasons.filter((r) => !RECALCULATE_ALLOWED_STALE_REASONS.has(r));
    if (blocking.length === 0) {
      return { compatible: true, reason: null, staleReasons };
    }
    return {
      compatible: false,
      reason: `INCOMPATIBLE_REFRESH_CONTRACT:${blocking.join(",")}`,
      staleReasons,
    };
  }

  const versions = (input.observationSchemaVersions ?? []).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (versions.length === 0) {
    return {
      compatible: false,
      reason: "MISSING_REFRESH_CONTRACT_AND_SCHEMA_VERSION",
      staleReasons: ["CONTRACT_MISSING"],
    };
  }
  const expected = input.currentRefreshContract.observationSchemaVersion;
  if (versions.every((v) => v === expected)) {
    return { compatible: true, reason: null, staleReasons: [] };
  }
  return {
    compatible: false,
    reason: "INCOMPATIBLE_OBSERVATION_SCHEMA",
    staleReasons: ["OBSERVATION_SCHEMA_CHANGED"],
  };
}
